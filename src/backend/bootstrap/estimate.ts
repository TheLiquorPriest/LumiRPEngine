// The bootstrap's estimate (DEPTH-PLAN §8.1 step 1, §8.3): calls, tokens, money and wall-clock time
// per stage for what remains, from the survey's counts and the chosen models. The first guess uses
// rates per chunk from the plan's shape of the work; once this chat's own chunks have run, each stage
// uses its measured rates instead (tokens, money and time per chunk), so the estimate learns. Money
// is known only where the connection reports a price; it is never guessed.

import type { BootstrapEstimate, BootstrapStage, StageCounts, StageEstimate } from "../../shared/bootstrap";
import { BOOTSTRAP_STAGES } from "../../shared/bootstrap";
import type { ChatId } from "../../shared/ids";
import type { BootstrapKnobs } from "./run";
import type { SpoolManifest } from "./spool";

/** Chunks a chapter takes, until the author's own chapter ends are known. */
const CHUNKS_PER_CHAPTER = 4;
/** Characters with a mind that a chunk reaches, of all those with one, until measured. */
const REACHED = 0.6;
/** A beat per this many tokens of prose; a third of the beats reach a minded character only in part. */
const TOKENS_PER_BEAT = 250;
const PARTIAL = 0.3;
/** The first guess at how fast a model reads and writes: tokens per second. */
const READ_TPS = 4000;
const WRITE_TPS = 60;

interface Rate {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** Money per token, where the connection reported a price. */
  costPerToken: number | null;
  ms: number;
}

/** The first guess per unit of each stage (a chunk; a chapter for reconcile), before anything ran. */
function guess(stage: BootstrapStage, chunkTokens: number, minds: number): Rate | null {
  const beats = chunkTokens / TOKENS_PER_BEAT;
  const per = (calls: number, tokensIn: number, tokensOut: number): Rate => ({ calls, tokensIn, tokensOut, costPerToken: null, ms: calls * (tokensIn / calls / READ_TPS + tokensOut / calls / WRITE_TPS) * 1000 });
  switch (stage) {
    case "survey":
    case "import":
      return null;
    case "historian":
      // Its quotes are spans into the chat, not words copied out, and it reads at low effort.
      return per(1, chunkTokens + 6000, chunkTokens * 0.15);
    case "author":
      // A light pass per chunk, and a chapter's deep revision spread over its chunks; each writes its notebook's edits, never whole files again.
      return per(1 + 1 / CHUNKS_PER_CHAPTER, chunkTokens * 1.3 + 8000 + (chunkTokens * 0.3 * CHUNKS_PER_CHAPTER) / CHUNKS_PER_CHAPTER, 1000 + 1500 / CHUNKS_PER_CHAPTER);
    case "pov": {
      const calls = Math.max(0, beats * PARTIAL * Math.min(1, minds));
      return per(calls, calls * 1500, calls * 350);
    }
    case "minds": {
      // Each reached character's catch-up, and its reflection at a chapter's end.
      const calls = minds * REACHED + minds / CHUNKS_PER_CHAPTER;
      return per(calls, calls * 9000, calls * 1800);
    }
    case "truthlink":
      // Once a chapter, over its beats, beside every mind's beliefs: a unit is a chapter.
      return per(1, chunkTokens * 0.3 * CHUNKS_PER_CHAPTER + 4000 + minds * 800, 2400);
    case "reconcile":
      return per(1, 12000 + chunkTokens * 0.3 * CHUNKS_PER_CHAPTER, 1500);
  }
}

function measured(spent: StageCounts, units: number): Rate | null {
  if (units <= 0 || spent.calls === 0) return null;
  const tokens = spent.tokensIn + spent.tokensOut;
  return { calls: spent.calls / units, tokensIn: spent.tokensIn / units, tokensOut: spent.tokensOut / units, costPerToken: spent.cost !== null && tokens > 0 ? spent.cost / tokens : null, ms: spent.ms / units };
}

export interface EstimateInput {
  chatId: ChatId;
  manifest: SpoolManifest;
  knobs: BootstrapKnobs;
  routes: Readonly<Record<BootstrapStage, { connection: string | null; model: string | null }>>;
  spent: Readonly<Record<BootstrapStage, StageCounts>>;
  units: Readonly<Record<BootstrapStage, number>>;
  /** Chunks the run finished, and chapters it closed. */
  done: number;
  chapters: number;
  /** Characters with a mind, or the world's people until the author's picks are known. */
  minds: number;
  /** The largest resident memory the run measured so far, in bytes; null before it ran. */
  rss: number | null;
  /** The author's jumpstart over the chat's LumiBooks records, still to run: its calls and the records' tokens; null or absent where none is to run. */
  jumpstart?: { calls: number; tokens: number } | null;
}

/** What the rest of the run would take, per stage and in all (§8.1, §8.3). */
export function estimateRemaining(i: EstimateInput): BootstrapEstimate {
  const { manifest, knobs } = i;
  const chunks = manifest.chunks.length;
  const left = Math.max(0, chunks - i.done);
  const avgTokens = chunks > 0 ? manifest.totals.tokens / chunks : 0;
  const leftChapters = Math.max(0, Math.ceil(left / CHUNKS_PER_CHAPTER));
  const notes: string[] = [];
  const stages: StageEstimate[] = [];
  const priced = new Map<BootstrapStage, number>();
  for (const stage of BOOTSTRAP_STAGES) {
    const units = stage === "reconcile" || stage === "truthlink" ? leftChapters : left;
    const m = measured(i.spent[stage], i.units[stage]);
    const g = guess(stage, avgTokens, i.minds);
    const rate = m ?? g;
    const route = i.routes[stage];
    if (!rate || units === 0) {
      stages.push({ stage, calls: 0, tokensIn: 0, tokensOut: 0, cost: 0, ms: 0, connection: route.connection, model: route.model, measured: m !== null });
      continue;
    }
    // A known price per token, measured on any stage of the same model, prices a stage not yet run on it.
    const perToken = rate.costPerToken ?? null;
    if (perToken !== null) priced.set(stage, perToken);
    const tokensIn = Math.round(rate.tokensIn * units);
    const tokensOut = Math.round(rate.tokensOut * units);
    // The minds and the points of view run several at once; the historian and the author one at a time.
    const parallel = stage === "minds" || stage === "pov" ? Math.max(1, knobs.atOnce.minds) : 1;
    stages.push({ stage, calls: Math.round(rate.calls * units), tokensIn, tokensOut, cost: perToken === null ? null : perToken * (tokensIn + tokensOut), ms: Math.round((rate.ms * units) / parallel), connection: route.connection, model: route.model, measured: m !== null });
  }
  // The jumpstart runs first, a call per volume reading its records whole; until its entry lands the read counts every message.
  const jump = i.jumpstart;
  if (jump && jump.calls > 0) {
    const author = stages.find((s) => s.stage === "author");
    if (author) {
      const tokensIn = jump.tokens + 3000 * jump.calls;
      const tokensOut = 3000 * jump.calls;
      const perToken = priced.get("author");
      author.calls += jump.calls;
      author.tokensIn += tokensIn;
      author.tokensOut += tokensOut;
      author.cost = perToken !== undefined && author.cost !== null ? author.cost + perToken * (tokensIn + tokensOut) : null;
      author.ms += 60000 * jump.calls;
    }
    notes.push(`First the author's jumpstart reads the chat's LumiBooks records (${jump.calls} call${jump.calls === 1 ? "" : "s"}); once it lands, the read skips the messages they cover, and until then every message is counted.`);
  }
  for (const s of stages) {
    if (s.cost !== null || s.calls === 0) continue;
    const same = stages.find((o) => o.cost !== null && o.model === s.model && o.connection === s.connection && priced.has(o.stage));
    const perToken = same ? priced.get(same.stage) : undefined;
    if (perToken !== undefined) s.cost = perToken * (s.tokensIn + s.tokensOut);
  }
  const total: StageCounts = { calls: 0, tokensIn: 0, tokensOut: 0, cost: 0, ms: 0 };
  let unpriced = false;
  for (const s of stages) {
    total.calls += s.calls;
    total.tokensIn += s.tokensIn;
    total.tokensOut += s.tokensOut;
    if (s.cost === null) unpriced = unpriced || s.calls > 0;
    else total.cost = (total.cost ?? 0) + s.cost;
  }
  if (unpriced) total.cost = null;
  // The lanes overlap: the historian runs ahead while the rest follow, so the wall clock is the longer lane, not their sum.
  const byStage = new Map(stages.map((s) => [s.stage, s.ms]));
  const historian = byStage.get("historian") ?? 0;
  const rest = ["author", "pov", "minds", "truthlink", "reconcile"].reduce((n, s) => n + (byStage.get(s as BootstrapStage) ?? 0), 0);
  total.ms = Math.max(historian, rest) + Math.min(historian, rest) / Math.max(1, left);
  if (i.done === 0) {
    const { messages, words } = manifest.totals;
    notes.push(`A first guess from the chat's ${messages.toLocaleString("en-US")} message${messages === 1 ? "" : "s"} (${words.toLocaleString("en-US")} word${words === 1 ? "" : "s"}) in ${chunks} chunk${chunks === 1 ? "" : "s"}, assuming ${i.minds} character${i.minds === 1 ? "" : "s"} get${i.minds === 1 ? "s" : ""} a mind and a chapter every ${CHUNKS_PER_CHAPTER} chunks; after the first chapters it uses this chat's measured rates.`);
  } else notes.push(`From this chat's own rates over ${i.done} chunk${i.done === 1 ? "" : "s"}${i.chapters > 0 ? ` and ${i.chapters} chapter${i.chapters === 1 ? "" : "s"}` : ""}.`);
  if (unpriced) notes.push("Money isn't shown where the connection reports no price; the token counts stand, and a token cap binds either way.");
  if (i.rss !== null) notes.push(`The run has used up to ${Math.round(i.rss / 1048576)} MB of memory; the rest should need about as much, since the jobs at once bound it, not the chat's length.`);
  return { chatId: i.chatId, messages: manifest.totals.messages, words: manifest.totals.words, tokens: manifest.totals.tokens, chunks, minds: i.minds, stages, total, notes, rss: i.rss };
}

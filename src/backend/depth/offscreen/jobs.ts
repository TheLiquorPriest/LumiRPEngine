// The world beyond view after each turn (DEPTH-PLAN §4.6, §6.4, §6.5): what the poll reads of it, and
// the off-screen jobs it asks for.
//
//   facts   the open drafts on the chain, each with what has happened since its story time and what it
//           read that changed since; the drafts a swipe took off the chain (rebase candidates: their
//           basis message is on the chain showing another swipe, under the same prefix; a branch's
//           include those it inherits from its parent, landed before it was made); what this story
//           interval's allowances leave per treatment, with the player's threshold; and the episodes
//           held for his answer past an allowance
//   jobs    in order: the drops (no call), the rebases (the same draft landed again where the story now
//           is: its pins are read when it settles), the settlements (the author reads each against
//           its pins; a redraft comes back as an episode), then the episodes it opened, each drafted
//           at its treatments
//
// The budget dial's allowances are the user's hard control (§6.5): a part whose treatment this
// interval's allowance has spent slides down the ladder (live, campfire, room, written) and says so in
// its rationale; one past "written" too is left unwritten until it matters, said. Where the author
// marked such a part major and Settings → Depth → Budget → Ask me is on, the episode is held for the
// player instead (`author.ask`, its chip `offscreen/asks.ts`), and drafted once he answers
// (`draftAnswered`). The ceilings bind too: once one does, the settlements and episodes not yet
// started are put off, said in the treatment log. What a job couldn't do is said, never dropped
// silently; nothing here throws.

import { AUTHOR_ASK, AUTHOR_SPEND, askEvent, spendEvent, type AskData } from "../../../shared/author";
import { AUTHOR_DROP, dropEvent, STORY_DRAFT, type DraftData } from "../../../shared/episodes";
import { DEPTH_TREATMENT_LABEL, DEPTH_TREATMENTS, thresholdGuidance, type DepthBudget, type DepthTreatment } from "../../../shared/depth-settings";
import type { ChatId, UserId } from "../../../shared/ids";
import type { Basis, LayerEntry, LayerSummary } from "../../../shared/layer";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { layerEntryId } from "../../../engine/ledger/layer";
import { NOTEBOOK_DIR } from "../../../engine/notebook";
import type { WorldState } from "../../../engine/state";
import type { WorldDoc } from "../../../shared/world";
import type { BasisRead } from "../../ledger-io";
import type { CeilingBind } from "../budget";
import type { ModelPort } from "../port";
import { intervalAt, INTERVAL_MINUTES, spendData } from "../spend";
import { namesOf, tag, type DraftLine, type EpisodeAsk, type OffscreenFacts } from "../scene/author";
import { draftOf } from "../../../shared/episodes";
import { askLine, openAsks } from "./asks";
import { draftsOn, draftWithTexts, type DraftOn } from "./drafts";
import { changedInputs, draftEpisode, episodeOf, landEntry, type DraftOut, type OffscreenPlugs, type OffscreenRt } from "./episode";
import { settleDraft } from "./settle";

/** What the world beyond view reads of the runtime besides an episode's: the layer entries the chat folds, a branch's inherited ones included, for the rebase candidates (`Runtime` is one). */
export interface JobsRt extends OffscreenRt {
  readonly ledger: OffscreenRt["ledger"] & {
    layerSummaries(chatId: ChatId, userId: UserId, o?: { inherited?: boolean }): Promise<LayerSummary[]>;
    readLayerEntry(chatId: ChatId, userId: UserId, id: string): Promise<LayerEntry | null>;
  };
}

/** The ladder a part slides down when its treatment's allowance is spent: each treatment's next cheaper one, in `DEPTH_TREATMENT_DEFS`' order. */
const CHEAPER = Object.fromEntries(DEPTH_TREATMENTS.map((t, i) => [t, DEPTH_TREATMENTS[i + 1] ?? null])) as Readonly<Record<DepthTreatment, DepthTreatment | null>>;

/** The parts this story interval's drafts spent per treatment: every live draft on the chain, settled, dropped or open, whose story time falls in the interval holding `clock`. */
export function spentIn(drafts: readonly Pick<DraftOn, "draft">[], budget: Pick<DepthBudget, "interval">, clock: number): Record<DepthTreatment, number> {
  const len = INTERVAL_MINUTES[budget.interval];
  const from = intervalAt(budget.interval, clock).from;
  const out = Object.fromEntries(DEPTH_TREATMENTS.map((t) => [t, 0])) as Record<DepthTreatment, number>;
  for (const { draft } of drafts) {
    if (draft.at < from || draft.at >= from + len) continue;
    for (const p of draft.episode.parts) out[p.treatment]++;
  }
  return out;
}

/** What one draft is, as the poll reads it. */
function draftLine(world: WorldDoc, state: Readonly<WorldState>, story: BasisRead["story"], draft: DraftData): DraftLine {
  const names = namesOf(world, state);
  const cal = calendarOf(world);
  const inputs = changedInputs(state, draft);
  const changed = [...inputs.minds.map((who) => `${tag(names, who)}'s mind`), ...inputs.notebook.map((path) => `your notebook's ${path.slice(NOTEBOOK_DIR.length)}`)];
  const holds = draft.touches
    .slice(0, 12)
    .map((t) => `${"entity" in t.ref ? tag(names, t.ref.entity) : "place" in t.ref ? (world.places[t.ref.place]?.name ?? t.ref.place) : "thing" in t.ref ? t.ref.thing : t.ref.fact} from ${formatClock(cal, t.from)}`)
    .join(", ");
  return {
    id: draft.id,
    when: formatClock(cal, draft.at),
    summary: draft.summary,
    treatments: draft.episode.parts.map((p) => `${"who" in p.subject ? tag(names, p.subject.who) : p.subject.event}: ${p.treatment}`).join("; "),
    holds: holds || "no one",
    since: story.beats.filter((p) => p.beat.at >= draft.at).length,
    changed,
  };
}

/**
 * The rebase candidates at the chain as it stands: the drafts the chat folds (a branch's inherited
 * ones too) whose basis message shows another swipe under the same prefix, not on this chain under
 * their id (`onChain`: the ids of the drafts the fold holds).
 */
export async function rebaseCandidates(rt: Pick<JobsRt, "ledger">, chatId: ChatId, userId: UserId, onChain: ReadonlySet<string>): Promise<DraftData[]> {
  const bases = await rt.ledger.chainBases(chatId, userId);
  const out: DraftData[] = [];
  for (const s of await rt.ledger.layerSummaries(chatId, userId, { inherited: true })) {
    if (s.kind !== STORY_DRAFT) continue;
    const b = bases.find((x) => x.message === s.basis.message);
    if (!b || b.swipe === s.basis.swipe || b.parentPath !== s.basis.parentPath) continue;
    const entry = await rt.ledger.readLayerEntry(chatId, userId, s.id);
    const event = entry?.events.find((e) => e.type === STORY_DRAFT);
    const draft = event && "data" in event ? draftOf(event.data) : null;
    if (!draft || onChain.has(draft.id) || out.some((r) => r.id === draft.id)) continue;
    out.push(draft);
  }
  return out;
}

/**
 * What the poll reads of the world beyond view at `at` (the fold at the reply, its live events of the
 * draft types read with it): the open drafts, the rebase candidates, and what the allowances leave.
 */
export async function offscreenFacts(rt: JobsRt, chatId: ChatId, userId: UserId, at: Pick<BasisRead, "world" | "state" | "story" | "events">, budget: DepthBudget): Promise<OffscreenFacts> {
  const { world, state, story } = at;
  const drafts = await Promise.all(draftsOn(at.events).map(async (d) => ({ ...d, draft: await draftWithTexts(rt.blobs, userId, d.draft) })));
  const open = drafts.filter((d) => d.state === "open");
  const candidates = await rebaseCandidates(rt, chatId, userId, new Set(drafts.map((d) => d.draft.id)));
  const rebase = (await Promise.all(candidates.map((d) => draftWithTexts(rt.blobs, userId, d)))).map((d) => draftLine(world, state, story, d));
  const spent = spentIn(drafts, budget, state.clock);
  const allowances = DEPTH_TREATMENTS.map((t) => {
    const a = budget.allowances[t];
    return a === "none" ? `${DEPTH_TREATMENT_LABEL[t]}: no limit` : `${DEPTH_TREATMENT_LABEL[t]}: ${Math.max(0, a - spent[t])} of ${a} left this story ${budget.interval}`;
  });
  const names = namesOf(world, state);
  const asked = openAsks(at.events).map((a) => askLine(a.ask, (id) => tag(names, id)));
  return { drafts: open.map((d) => draftLine(world, state, story, d.draft)), rebase, allowances, threshold: thresholdGuidance(budget), asked, ask: budget.ask };
}

/**
 * The parts of `ask` the player is asked about (§6.5): those the author marked major whose treatment
 * this interval's allowance has spent, counting the episode's own earlier parts, each with the
 * allowance and what the interval had spent of it. Empty while Ask me is off.
 */
export function overAllowance(ask: EpisodeAsk, budget: DepthBudget, spent: Readonly<Record<DepthTreatment, number>>): AskData["over"] {
  if (!budget.ask) return [];
  const counted = { ...spent };
  const over: AskData["over"] = [];
  ask.parts.forEach((p, part) => {
    const a = budget.allowances[p.treatment];
    if (a === "none" || counted[p.treatment] < a) {
      counted[p.treatment]++;
      return;
    }
    if (p.major) over.push({ part, allowance: a, spent: counted[p.treatment] });
  });
  return over;
}

/** The episode's parts within this interval's allowances: one past its treatment's slides down the ladder, said in its rationale; one past "written" too is left out, a line in `put` (the treatment log's). */
export function withinAllowances(ask: EpisodeAsk, budget: DepthBudget, spent: Record<DepthTreatment, number>, put: string[]): EpisodeAsk {
  const parts: EpisodeAsk["parts"] = [];
  for (const p of ask.parts) {
    let t: DepthTreatment | null = p.treatment;
    while (t !== null) {
      const a = budget.allowances[t];
      if (a === "none" || spent[t] < a) break;
      t = CHEAPER[t];
    }
    const subject = "who" in p.subject ? p.subject.who : p.subject.event;
    if (t === null) {
      put.push(`${subject}: this story ${budget.interval}'s allowances are spent down to written, so it is left unwritten until it matters`);
      continue;
    }
    spent[t]++;
    parts.push(t === p.treatment ? p : { ...p, treatment: t, rationale: `${p.rationale} (this story ${budget.interval}'s ${DEPTH_TREATMENT_LABEL[p.treatment].toLowerCase()} allowance is spent: ${DEPTH_TREATMENT_LABEL[t].toLowerCase()} instead)`.trim() });
  }
  return { ...ask, parts };
}

/** What the off-screen jobs did, by draft id. */
export interface OffscreenOut {
  dropped: string[];
  rebased: string[];
  settled: string[];
  drafted: string[];
  /** The episodes held for the player's answer past an allowance, by episode id. */
  asked: string[];
  /** What a ceiling or a spent allowance put off, in words, a line each: the treatment log's (`author.spend`'s `put`). */
  put: string[];
  /** What a job couldn't do or said, in words. */
  said: string[];
}

/** The poll's off-screen verdicts and episodes (`PollResult`'s). */
export interface OffscreenAsks {
  episodes: readonly EpisodeAsk[];
  settle: readonly { draft: string; why: string }[];
  drop: readonly { draft: string; why: string }[];
  rebase: readonly { draft: string; why: string }[];
}

/**
 * Runs the poll's off-screen jobs at `basis` (the reply it read), in order: drops, rebases,
 * settlements (a redraft opens its episode again for later), then the episodes, each drafted, slid
 * down the ladder or held for the player as its allowances say. Once `o.binds` says a ceiling binds,
 * or the off-screen lane is paused (GM → Depth's Work off screen, read before each job: X4), the
 * settlements and episodes not yet started are put off, said. Never throws.
 */
export async function offscreenJobs(rt: JobsRt, chatId: ChatId, userId: UserId, basis: Basis, asks: OffscreenAsks, o: { budget: DepthBudget; model?: ModelPort; signal?: AbortSignal; plugs?: OffscreenPlugs; binds?: () => CeilingBind | null; first?: number }): Promise<OffscreenOut> {
  const out: OffscreenOut = { dropped: [], rebased: [], settled: [], drafted: [], asked: [], put: [], said: [] };
  const fail = (what: string, error: unknown): void => {
    out.said.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
  };
  // A ceiling that binds, or the lane's pause, puts off what hasn't started, a line each.
  const held = async (what: string): Promise<boolean> => {
    const bind = o.binds?.() ?? null;
    if (bind) out.put.push(`${what}: ${bind.words}`);
    else if (!(await rt.settings.get(userId)).depth.background.offscreen) out.put.push(`${what}: Work off screen is paused (GM → Depth)`);
    else return false;
    return true;
  };
  const common = { ...(o.model ? { model: o.model } : {}), ...(o.signal ? { signal: o.signal } : {}), ...(o.plugs ? { plugs: o.plugs } : {}) };
  for (const d of asks.drop) {
    try {
      const r = await landEntry(rt, chatId, userId, { id: layerEntryId(AUTHOR_DROP, chatId, d.draft, basis.message, basis.swipe), basis, kind: AUTHOR_DROP, events: [dropEvent({ draft: d.draft, why: d.why || "The story overtook it." })], by: { role: "author" } }, {});
      if (r.status === "refused") out.said.push(`dropping ${d.draft}: ${r.reason}`);
      else out.dropped.push(d.draft);
    } catch (error) {
      fail(`dropping ${d.draft}`, error);
    }
  }
  if (asks.rebase.length > 0) {
    try {
      const wanted = new Set(asks.rebase.map((r) => r.draft));
      for (const s of await rt.ledger.layerSummaries(chatId, userId, { inherited: true })) {
        if (s.kind !== STORY_DRAFT || wanted.size === 0) continue;
        const entry = await rt.ledger.readLayerEntry(chatId, userId, s.id);
        const event = entry?.events.find((e) => e.type === STORY_DRAFT);
        const draft = event && "data" in event ? draftOf(event.data) : null;
        if (!entry || !draft || !wanted.has(draft.id)) continue;
        wanted.delete(draft.id);
        const r = await landEntry(rt, chatId, userId, { id: layerEntryId(STORY_DRAFT, chatId, draft.id, basis.message, basis.swipe), basis, kind: STORY_DRAFT, events: entry.events, by: { role: "author" } }, {});
        if (r.status === "refused") out.said.push(`rebasing ${draft.id}: ${r.reason}`);
        else out.rebased.push(draft.id);
      }
      for (const id of wanted) out.said.push(`rebasing ${id}: no such draft in this chat`);
    } catch (error) {
      fail("rebasing", error);
    }
  }
  const episodes: EpisodeAsk[] = [...asks.episodes];
  for (const s of asks.settle) {
    if (await held(`Settling draft ${s.draft}`)) continue;
    try {
      const r = await settleDraft(rt, chatId, userId, s.draft, { basis, why: s.why, ...common });
      out.said.push(...r.said.map((line) => `settling ${s.draft}: ${line}`));
      if (r.landed?.status === "refused") out.said.push(`settling ${s.draft}: ${r.landed.reason}`);
      if (r.verdict === "settle" && r.landed?.status !== "refused" && r.landed) out.settled.push(s.draft);
      if (r.verdict === "drop" && r.landed?.status !== "refused" && r.landed) out.dropped.push(s.draft);
      if (r.redraft) {
        const at = await rt.ledger.foldAtBasis(chatId, userId, basis, [STORY_DRAFT]);
        const found = at ? draftsOn(at.events).find((d) => d.draft.id === s.draft)?.draft : undefined;
        const was = found ? await draftWithTexts(rt.blobs, userId, found) : undefined;
        if (was) episodes.push({ why: was.episode.why, in: r.redraft.in, minutes: Math.max(1, was.episode.span[1] - was.episode.span[0]), places: was.episode.places, people: was.episode.people, parts: was.episode.parts });
      }
    } catch (error) {
      fail(`settling ${s.draft}`, error);
    }
  }
  if (episodes.length > 0) {
    const at = await rt.ledger.foldAtBasis(chatId, userId, basis, [STORY_DRAFT]);
    const spent = at ? spentIn(draftsOn(at.events), o.budget, at.state.clock) : (Object.fromEntries(DEPTH_TREATMENTS.map((t) => [t, 0])) as Record<DepthTreatment, number>);
    for (const [n, ask] of episodes.entries()) {
      // Its place among the episodes polls opened at this reply: after any an earlier poll there opened (`first`).
      const index = (o.first ?? 0) + n;
      if (o.signal?.aborted) break;
      if (await held(`Episode ${index + 1} (${ask.why.trim() || "no reason given"})`)) continue;
      // A major part past its allowance: held for the player's answer, its chip under this reply.
      const over = at ? overAllowance(ask, o.budget, spent) : [];
      if (at && over.length > 0) {
        const id = episodeOf(chatId, basis, index, ask, at.state.clock).id;
        const data: AskData = { id, index, why: ask.why, in: ask.in, minutes: ask.minutes, places: ask.places, people: ask.people, parts: ask.parts, over, interval: o.budget.interval };
        try {
          const r = await landEntry(rt, chatId, userId, { id: layerEntryId(AUTHOR_ASK, chatId, id, basis.message, basis.swipe), basis, kind: AUTHOR_ASK, events: [askEvent(data)], by: { role: "author" } }, {});
          if (r.status === "refused") out.said.push(`episode ${index + 1}: asking the player: ${r.reason}`);
          else out.asked.push(id);
        } catch (error) {
          fail(`episode ${index + 1}: asking the player`, error);
        }
        continue;
      }
      const left: string[] = [];
      const within = withinAllowances(ask, o.budget, spent, left);
      out.put.push(...left.map((line) => `Episode ${index + 1}: ${line}`));
      if (within.parts.length === 0) continue;
      try {
        const r = await draftEpisode(rt, chatId, userId, basis, within, { index, ...common });
        out.said.push(...r.said.map((line) => `episode ${index + 1}: ${line}`));
        if (r.landed?.status === "refused") out.said.push(`episode ${index + 1}: ${r.landed.reason}`);
        else if (r.draft && r.landed) out.drafted.push(r.draft.id);
      } catch (error) {
        fail(`episode ${index + 1}`, error);
      }
    }
  }
  return out;
}

/**
 * The episode of an answered ask, drafted at the ask's basis (so it keeps the episode's id and
 * minute): at the treatments the author wanted when the player spent past the allowance (each such
 * part's rationale says so), else within the allowances, a step down the ladder (said).
 */
export async function draftAnswered(rt: OffscreenRt, chatId: ChatId, userId: UserId, answered: { ask: AskData; basis: Basis; spend: boolean }, o: { budget: DepthBudget; model?: ModelPort; signal?: AbortSignal; plugs?: OffscreenPlugs }): Promise<DraftOut> {
  const { ask, basis } = answered;
  const over = new Set(ask.over.map((x) => x.part));
  const wanted: EpisodeAsk = { why: ask.why, in: ask.in, minutes: ask.minutes, places: ask.places, people: ask.people, parts: ask.parts.map((p) => ({ subject: p.subject, treatment: p.treatment, rationale: p.rationale })) };
  let episode: EpisodeAsk;
  const said: string[] = [];
  if (answered.spend) {
    episode = { ...wanted, parts: wanted.parts.map((p, i) => (over.has(i) ? { ...p, rationale: `${p.rationale} (you spent one more past this story ${ask.interval}'s ${DEPTH_TREATMENT_LABEL[p.treatment].toLowerCase()} allowance)`.trim() } : p)) };
  } else {
    const at = await rt.ledger.foldAtBasis(chatId, userId, basis, [STORY_DRAFT]);
    const spent = at ? spentIn(draftsOn(at.events), o.budget, at.state.clock) : (Object.fromEntries(DEPTH_TREATMENTS.map((t) => [t, 0])) as Record<DepthTreatment, number>);
    episode = withinAllowances(wanted, o.budget, spent, said);
    // What it left unwritten goes in the treatment log too, as the poll's put-offs do.
    const put = spendData({ cost: { calls: 0, tokensIn: 0, tokensOut: 0 }, roles: {} }, { treatment: "written", interval: o.budget.interval, at: at?.state.clock ?? 0, for: ask.id, put: said });
    if (put) await landEntry(rt, chatId, userId, { id: layerEntryId(AUTHOR_SPEND, chatId, ask.id, "unwritten", basis.message, basis.swipe), basis, kind: AUTHOR_SPEND, events: [spendEvent(put)], by: { role: "author" } }, {});
    if (episode.parts.length === 0) return { draft: null, landed: null, said };
  }
  const r = await draftEpisode(rt, chatId, userId, basis, episode, { index: ask.index, ...(o.model ? { model: o.model } : {}), ...(o.signal ? { signal: o.signal } : {}), ...(o.plugs ? { plugs: o.plugs } : {}) });
  return { ...r, said: [...said, ...r.said] };
}

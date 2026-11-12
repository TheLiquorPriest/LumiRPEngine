// The narration tools on the harness engine (DEPTH2-PLAN §3.3): `narration_read` hands the narrator
// what reached the point-of-view character in this turn that no passage told yet, `passage_draft`
// records its drafts, `passage_read` gives whoever checks a passage its beats whole, and
// `passage_check` records the check. What they keep is the turn's own (`HarnessTurn.stageBook`,
// `backend/story/narration.ts`), which the release gate reads when the author releases a passage.
//
// Who may call each is held here, by the call's own definition and instance, never by an argument:
// a narrator sees through the eyes the author named when it started it (`as`), or the player
// character's; only the author names other eyes as it reads. The narrator is never given a beat's
// truth beyond what reached those eyes; whoever checks reads every beat whole.

import { feedItem } from "../../../../engine/story/feed";
import { HARNESS_AGENT, HARNESS_FAMILY } from "../../../../shared/harness-texts";
import { STAGE_NOTE, STAGE_TEXT, STAGE_TOOL } from "../../../../shared/harness-texts-stage";
import type { Beat } from "../../../../shared/ledger";
import { turnBeats } from "../../../story/feed";
import { PLAYER, whoNamed } from "../../../story/minds";
import { draftsAllowed, narrationOf, type Passage, passageView, quoteFindings, quotesReaching, sceneOf, type StageBook, tail } from "../../../story/narration";
import { findModule } from "../../../story/preset";
import type { ToolOutcome } from "../../runtime";
import type { HarnessTurn } from "../harness-turn";
import { boolArg, missing, wordsArg } from "../propose";
import type { ToolReadView } from "../read-view";
import type { ToolEnv } from "../registry";
import { integer, intArg, objectSchema, text, textArg } from "../schema";
import { type HarnessToolDefinition, words } from "./kit";

/** The turn a narration call works in, with its book; the answer that says why not where the run writes no reply (a job's, or a conversation beside the chat). */
function stageOf(view: ToolReadView, env: ToolEnv): { turn: HarnessTurn; book: StageBook } | ToolOutcome {
  const turn = env.turn;
  const book = turn?.stageBook;
  if (!turn || !book || turn.reply !== null || turn.job !== undefined) return view.refuse(STAGE_NOTE.notTurn);
  return { turn, book };
}

/** The chat's prose before the turn, its replies' as written, the last `chars` of it: what the narrator matches its voice to. */
async function recentProse(turn: HarnessTurn, env: ToolEnv, chars: number): Promise<string> {
  if (chars === 0) return "";
  const messages = await turn.host.chats.messages(env.chatId, env.userId);
  const at = turn.said.messageId === null ? -1 : messages.findIndex((m) => m.id === turn.said.messageId);
  const before = at < 0 ? messages : messages.slice(0, at);
  return tail(
    before
      .filter((m) => !m.isUser)
      .map((m) => m.content.trim())
      .filter((t) => t !== "")
      .join("\n\n"),
    chars,
  );
}

/** The quote notes on a draft, in the user's words: the quotes it lacks and the spoken words no beat holds. */
function quoteNotes(view: ToolReadView, draft: string, passage: Passage, beats: readonly Beat[]): string[] {
  const found = quoteFindings(draft, quotesReaching(beats, passage.beats, passage.pov));
  const quoted = (list: readonly string[]): string => list.map((q) => `"${q}"`).join(", ");
  const pov = view.name(passage.pov === PLAYER ? view.pov : passage.pov);
  return [...(found.missing.length > 0 ? [view.text(STAGE_NOTE.quotesMissing, { pov, quotes: quoted(found.missing) })] : []), ...(found.unheld.length > 0 ? [view.text(STAGE_NOTE.quotesUnheld, { quotes: quoted(found.unheld) })] : [])];
}

const READ = STAGE_TOOL.narrationRead;
const DRAFT = STAGE_TOOL.passageDraft;
const CHECK = STAGE_TOOL.passageCheck;

export const STAGE_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: READ,
    family: HARNESS_FAMILY.narration,
    tier: "read",
    parameters: () => objectSchema({ pov: text(), modules: words() }),
    async run(args, env) {
      const view = await env.reader.view();
      const at = stageOf(view, env);
      if (!("book" in at)) return at;
      const { turn, book } = at;
      const narrator = env.agent.role === HARNESS_AGENT.narrator;
      if (!narrator && !turn.main) return view.refuse(STAGE_NOTE.narratorOnly, { tool: READ });
      const asked = textArg(args, "pov");
      if (narrator && asked !== null) return view.refuse(STAGE_NOTE.povAuthor);
      // A narrator's eyes are those the author started it with; the author names them as it reads.
      const pov = whoNamed(view, narrator ? env.agent.as?.trim() || PLAYER : (asked ?? PLAYER));
      if (typeof pov !== "string") return pov;
      const preset = await book.presetOf();
      const named = (wordsArg(args, "modules") ?? []).map((name) => ({ name, module: preset ? findModule(preset, name) : null }));
      const unknown = named.filter((m) => m.module === null).map((m) => m.name);
      if (unknown.length > 0) return preset && preset.modules.length > 0 ? view.refuse(STAGE_NOTE.moduleUnknown, { names: unknown.join(", "), offered: preset.modules.map((m) => m.name).join(", ") }) : view.refuse(STAGE_NOTE.noModules);
      const asks = [...new Set(named.flatMap((m) => (m.module ? [m.module.name] : [])))];
      const beats = (await turnBeats(env)) ?? [];
      const reaching = beats.filter((b) => feedItem(b, pov) !== null).map((b) => b.id);
      const passage = narrator ? book.take(env.agent.id, pov, reaching, asks, turn.settings.narration) : { n: null, pov, beats: book.untold(reaching), drafts: [], modules: asks };
      const scene = sceneOf({ registry: view.registry, world: view.world, state: turn.whole?.() ?? view.state, pov, texts: view.texts });
      if (passage === null || passage.beats.length === 0) return view.refuse(STAGE_NOTE.nothing, { pov: scene.pov });
      const presentation = preset
        ? passage.modules.flatMap((name) => {
            const m = findModule(preset, name);
            return m ? [{ name: m.name, text: m.text }] : [];
          })
        : [];
      const prose = preset === null || (preset.parts.narrator.trim() === "" && preset.parts.voice.trim() === "") ? view.text(STAGE_TEXT.prose) : null;
      const s = turn.settings.narration;
      return view.answer(narrationOf({ passage, beats, scene, reply: tail(book.reply(), s.replyChars), recent: await recentProse(turn, env, s.recentChars), presentation, prose, allowed: draftsAllowed(s) }));
    },
  },
  {
    name: DRAFT,
    family: HARNESS_FAMILY.narration,
    tier: "write",
    parameters: () => objectSchema({ text: text() }, ["text"]),
    async run(args, env) {
      const view = await env.reader.view();
      const at = stageOf(view, env);
      if (!("book" in at)) return at;
      const { turn, book } = at;
      if (env.agent.role !== HARNESS_AGENT.narrator) return view.refuse(STAGE_NOTE.narratorOnly, { tool: DRAFT });
      const s = turn.settings.narration;
      const out = book.draft(env.agent.id, typeof args.text === "string" ? args.text : "", s);
      if ("note" in out) return view.refuse(out.note, out.vars);
      const { passage, draft } = out;
      const notes = quoteNotes(view, passage.drafts.at(-1)?.text ?? "", passage, (await turnBeats(env)) ?? []);
      const next = view.text(s.check === "none" ? STAGE_NOTE.draftedFree : STAGE_NOTE.draftedChecked);
      return view.answer({ drafted: [view.text(STAGE_NOTE.drafted, { n: String(passage.n), draft: String(draft), of: String(draftsAllowed(s)) }), ...notes, next].join(" ") });
    },
  },
  {
    name: STAGE_TOOL.passageRead,
    family: HARNESS_FAMILY.narration,
    tier: "read",
    parameters: () => objectSchema({ passage: integer({ minimum: 1 }) }),
    async run(args, env) {
      const view = await env.reader.view();
      const at = stageOf(view, env);
      if (!("book" in at)) return at;
      const { turn, book } = at;
      if (!turn.main && env.agent.role !== HARNESS_AGENT.gm) return view.refuse(STAGE_NOTE.readWho);
      const n = intArg(args, "passage");
      // Left out: the latest passage whose latest draft waits for its check, else the latest passage.
      const passage = n !== null ? book.passage(n) : (book.opened.findLast((p) => !p.released && p.drafts.at(-1)?.check === null) ?? book.opened.at(-1) ?? null);
      if (!passage) return n !== null ? view.refuse(STAGE_NOTE.noPassage, { n: String(n) }) : view.refuse(STAGE_NOTE.noneYet);
      const beats = (await turnBeats(env)) ?? [];
      const scene = sceneOf({ registry: view.registry, world: view.world, state: turn.whole?.() ?? view.state, pov: passage.pov, texts: view.texts });
      // Whoever checks reads everyone by name and id, the player's character as "player".
      const label = (who: string): string => (who === "world" ? who : `${view.name(who === PLAYER ? view.pov : who)} (${who})`);
      const latest = passage.drafts.at(-1);
      const notes = latest ? quoteNotes(view, latest.text, passage, beats) : [];
      return view.answer({ ...passageView({ passage, beats, label, scene, allowed: draftsAllowed(turn.settings.narration) }), ...(notes.length > 0 ? { quotes: notes } : {}) });
    },
  },
  {
    name: CHECK,
    family: HARNESS_FAMILY.narration,
    tier: "write",
    parameters: () => objectSchema({ passage: integer({ minimum: 1 }), holds: { type: "boolean" }, changes: words() }, ["passage", "holds"]),
    async run(args, env) {
      const view = await env.reader.view();
      const at = stageOf(view, env);
      if (!("book" in at)) return at;
      const { turn, book } = at;
      const s = turn.settings.narration;
      if (s.check === "none") return view.refuse(STAGE_NOTE.checkNone);
      if (s.check === "gm" ? env.agent.role !== HARNESS_AGENT.gm : !turn.main) return view.refuse(STAGE_NOTE.checkWho);
      const n = intArg(args, "passage");
      if (n === null) return missing(view, CHECK, "passage");
      const holds = boolArg(args, "holds");
      if (holds === null) return missing(view, CHECK, "holds");
      const changes = holds ? [] : (wordsArg(args, "changes") ?? []);
      if (!holds && (changes.length === 0 || changes.length > s.changes || changes.some((c) => c.length > s.changeChars))) return view.refuse(STAGE_NOTE.checkChanges, { most: String(s.changes), chars: String(s.changeChars) });
      const out = book.check(n, { holds, changes, by: env.agent.role }, s);
      if ("note" in out) return view.refuse(out.note, out.vars);
      const said = { n: String(n) };
      const next = holds ? view.text(STAGE_NOTE.checkedHolds, said) : out.left > 0 ? view.text(STAGE_NOTE.checkedRevise, { ...said, left: String(out.left) }) : view.text(STAGE_NOTE.checkedSpent, said);
      return view.answer({ checked: { passage: n, holds }, next });
    },
  },
];

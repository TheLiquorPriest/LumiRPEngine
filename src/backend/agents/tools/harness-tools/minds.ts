// A person's own mind on the harness engine (HARNESS-SLICE3: "Character"): the tools a character's
// agent works with, which stand in for the classic `mind` and `memory` steps. Its own files and its
// notes folded into its summary are `./files.ts`'s, behind the same gate (`ownMind`).
//
// - `mind_view` reads what that person perceives, knows and remembers: the context the mind step
//   builds for them (`mindContext`), or, once the turn's reply is written, the one the memory step
//   builds (`memoryContext`). After it come the names and sizes of the files they keep, when the
//   workspace is connected and they keep any, and, when some of their notes are due to fold into
//   their summary, what a classic consolidation reads (`consolidateContext`). It is the agent's
//   whole point of view: a character's agent holds no other read but its own files.
// - `mind_decide` records their decision for the turn, checked by `mindData` and staged as the
//   `minds.mind` event the mind step records.
// - `mind_remember` records what they take from the turn as written, checked by `memoryData` and
//   staged as the memory step's `minds.memory` event.
//
// Only an agent started as a character may call them, and only for the one person it is: its first
// call names who (`HarnessTurn.bind`), and it stays that person for the run. The author can't write
// a mind itself: it knows what no one person does, and a mind it wrote would be no one's own.
//
// Who was there holds after the reply as it does before it (DESIGN §24.4). Before it the mind
// step's own context tells the player's message only to whoever is with the player character. Once
// the reply is written the turn as written is a memory's to read, and a memory is theirs who heard
// the turn (the presence the engine recorded for it): anyone else is given their mind as before the
// reply, with nothing of the turn in it, and records no memory of it.
//
// What a mind records is the change type "Characters' minds" (`mind`): the player's mode for it
// refuses it, or sends it to the review card, as it does every other change.

import { WRITE_NOTE } from "../../../../shared/agent-tools-write";
import { hashJson } from "../../../../shared/hash";
import { HARNESS_AGENT, HARNESS_FAMILY, HARNESS_NOTE, HARNESS_TOOL } from "../../../../shared/harness-texts";
import { FILES_NOTE } from "../../../../shared/harness-texts-files";
import type { EntityId } from "../../../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../../../shared/json";
import type { LedgerEvent } from "../../../../shared/ledger";
import { COMMITMENT_KINDS, effectiveMemory, MINDS_EVENTS, type MindCuts, type MindMoment, PLAN_KINDS } from "../../../../shared/minds";
import { pinsFor } from "../../../../engine/lore-pins";
import { authorLines } from "../../../../engine/player-events";
import { placeOfEntity } from "../../../../engine/scope";
import { Working } from "../../../../engine/working";
import { fidelityOf } from "../../../../packs/minds/core/fidelity";
import { readPins } from "../../../lore-pins";
import { chatBefore, memoryData, mindData, notesToFold, unheldPlans } from "../../../minds";
import { consolidateContext, memoryContext, mindContext, type MindScope } from "../../../minds-context";
import type { ToolOutcome } from "../../runtime";
import type { HarnessFiles } from "../harness-ports";
import type { HarnessTurn } from "../harness-turn";
import type { ToolReadView } from "../read-view";
import type { ToolEnv } from "../registry";
import { resolvePerson } from "../resolve";
import { badValue, integer, needText, objectSchema, text, textArg } from "../schema";
import { type HarnessToolDefinition, list, presenceOf, stageChange, words } from "./kit";

/**
 * Why a mind recorded on the harness engine thought now, as the event keeps it and GM → Minds shows
 * it: the author asked for it. The engine's word, as every reason a mind runs for is, never the
 * model's; a recorded word, so it can't follow a setting.
 */
export const HARNESS_MIND_REASON = "author";

const MOMENTS = ["turn", "beat"] as const;
const RESOLVED = ["kept", "broken", "released"] as const;

const records = (v: JsonValue | undefined): JsonObject[] => (Array.isArray(v) ? v.filter((x): x is JsonObject => isRecord(x)) : []);

/**
 * The person the calling agent is, from the call's `who`, with the turn it works in; or the answer
 * that says why the call can't be its own: no turn, an agent that isn't a character, minds switched
 * off, the player character (whom the player decides for), or anyone but the person it already is.
 */
export async function ownMind(view: ToolReadView, env: ToolEnv, tool: string, args: JsonObject): Promise<{ turn: HarnessTurn; who: EntityId } | ToolOutcome> {
  const turn = env.turn;
  if (!turn) return view.refuse(HARNESS_NOTE.noTurn);
  if (env.agent.role !== HARNESS_AGENT.character) return view.refuse(HARNESS_NOTE.notCharacter, { tool });
  if (!turn.settings.minds.enabled) return view.refuse(HARNESS_NOTE.mindsOff);
  const said = needText(view, tool, args, "who");
  if (typeof said !== "string") return said;
  const named = resolvePerson(view, said);
  if ("refused" in named) return named.refused;
  if (named.id === view.pov) return view.refuse(HARNESS_NOTE.playerMind, { name: view.name(view.pov) });
  const self = turn.character;
  if (self !== null ? self !== named.id : !turn.bind(named.id)) return view.refuse(HARNESS_NOTE.otherMind, { self: view.name(turn.character ?? named.id), other: view.name(named.id), tool });
  return { turn, who: named.id };
}

/**
 * What `who`'s mind reads from, as the mind and memory steps build it: the turn's frozen settings,
 * the chat's messages and the lore pinned for the call. `remembers`: the call reads the turn as
 * written, as a memory does; else it reads a moment, as a mind does.
 */
async function mindScope(view: ToolReadView, env: ToolEnv, turn: HarnessTurn, who: EntityId, moment: MindMoment, remembers: boolean): Promise<MindScope> {
  const { registry: reg, world, state } = view;
  const { settings } = turn;
  const reads = settings.minds.reads;
  // A chat the host can't read reads as empty, as the mind and memory steps read one.
  const messages = await turn.host.chats.messages(env.chatId, env.userId).catch(() => []);
  // A memory reads the memory step's pins; a mind its own: theirs, every mind's and their place's.
  const refs = !reads.pinned.on ? [] : remembers ? pinsFor(world, null, undefined, ["memory"]) : pinsFor(world, placeOfEntity(state, who), who, ["mind"]);
  const pinned = await readPins(turn.host, world, refs, env.userId);
  const history = reads.history.on ? chatBefore(messages, true, turn.reply?.messageId) : undefined;
  // What they hold of the chat's facts is a mind's to read, while the chat tracks it; a memory reads the turn as written.
  const knowledge = turn.knowing && !remembers ? { knowledge: settings.minds.knowledge } : {};
  return { reg, world, state, who, memory: effectiveMemory(world, settings.minds), messages, hideJson: settings.hideJsonBlocks, reads, moment, pinned, ...(history ? { history } : {}), ...knowledge };
}

/**
 * The one folder of the chat's workspace a person's mind keeps its files in. Every character of
 * their id that could mean something in a path is written as its code, so no id reaches another
 * person's folder or leaves `minds/`, whatever an entity is called.
 */
export function mindFolder(who: EntityId): string {
  return `minds/${encodeURIComponent(who).replace(/\./g, "%2E")}/`;
}

/** A name a mind's file may have: plain, so none names a folder or leaves the mind's own. */
export const MIND_FILE_NAME = /^[A-Za-z0-9_-]+\.md$/;

/** One of a mind's own files as its tools list it: its name, its size in characters and its version. */
export interface MindFile {
  file: string;
  size: number;
  version: string;
}

/** The files `who`'s mind keeps, by name: those right in its folder under a name its tools take, none longer than `longest`. */
export async function mindFiles(files: HarnessFiles, who: EntityId, longest: number): Promise<MindFile[]> {
  const folder = mindFolder(who);
  return (await files.list(folder))
    .flatMap((f): MindFile[] => {
      const file = f.path.slice(folder.length);
      return f.path.startsWith(folder) && file.length <= longest && MIND_FILE_NAME.test(file) ? [{ file, size: f.size, version: f.version }] : [];
    })
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** An event the engine's validator made of a call, checked on the state the call read; the engine's own reason when it doesn't fit. */
export function fits(view: ToolReadView, event: LedgerEvent): { after: Working } | { reason: string } {
  const after = new Working(view.registry, view.world, view.state);
  const rejection = after.apply(event);
  return rejection ? { reason: rejection.reason } : { after };
}

/** What a tool says of the lengths its answer was cut to, when it was. */
export function cutNote(view: ToolReadView, cuts: MindCuts): { cut: MindCuts; note: string } | Record<string, never> {
  return Object.keys(cuts).length > 0 ? { cut: cuts, note: view.text(HARNESS_NOTE.cut) } : {};
}

export const MIND_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: HARNESS_TOOL.mindView,
    family: HARNESS_FAMILY.mind,
    tier: "read",
    parameters: () => objectSchema({ who: text() }, ["who"]),
    async run(args, env) {
      const view = await env.reader.view();
      const own = await ownMind(view, env, HARNESS_TOOL.mindView, args);
      if (!("who" in own)) return own;
      const { turn, who } = own;
      const reply = turn.reply;
      const presence = presenceOf(view, turn);
      // Once the reply is written, the turn as written is theirs only if they heard it. Whoever didn't reads their mind as before the reply, the moment holding nothing of the turn: not the player's message, not the reply.
      const written = reply !== null && presence.said.who.includes(who) ? reply : null;
      const absent = reply !== null && written === null;
      const moment: MindMoment = { kind: "turn", at: view.state.clock, reason: absent ? view.text(FILES_NOTE.viewAbsent) : "", user: absent ? "" : turn.said.user, reply: absent ? "" : turn.said.before };
      const scope = await mindScope(view, env, turn, who, moment, written !== null);
      // Their context is prose a mind reads as it is: sent as text, not as a JSON answer.
      const parts = [view.read(() => (written ? memoryContext(scope, { user: turn.said.user, reply: written.text, left: presence.left.includes(who) }) : mindContext(scope)))];
      // Their own files by name only: a file's text is read when the mind asks for it (`mind_file_read`).
      const kept = env.files ? await mindFiles(env.files, who, turn.settings.agents.harnessLimits.mindFileNameChars) : [];
      if (kept.length > 0) parts.push([view.text(FILES_NOTE.viewFiles), ...kept.map((f) => view.text(FILES_NOTE.viewFile, { file: f.file, size: f.size.toLocaleString("en-US") }))].join("\n"));
      // On the harness a memory is always there to read what is folded (`mind_remember`), so notes fold whenever the world's memory folds them.
      const fold = scope.memory.consolidate.enabled ? notesToFold(view.state, who, view.state.clock, scope.memory) : [];
      if (fold.length > 0) {
        // What a classic consolidation is given, so the mind folds from the same words; the recent chat is in its context above already.
        const pinned = await readPins(turn.host, view.world, pinsFor(view.world, null, undefined, ["consolidate"]), env.userId);
        const asked = view.read(() => consolidateContext({ reg: scope.reg, state: scope.state, world: scope.world, who, reads: scope.reads, pinned, hideJson: scope.hideJson }, fold));
        parts.push(`${view.text(FILES_NOTE.viewFold, { chars: turn.settings.minds.lengths.summary.toLocaleString("en-US") })}\n\n${asked}`);
      }
      return { text: parts.join("\n\n") };
    },
  },
  {
    name: HARNESS_TOOL.mindDecide,
    family: HARNESS_FAMILY.mind,
    tier: "write",
    parameters: () => objectSchema({ who: text(), monologue: text(), depiction: text(), intent: text(), reactions: words(), mood: text(), moment: text(MOMENTS), interrupt: objectSchema({ reason: text() }) }, ["who"]),
    async run(args, env) {
      const view = await env.reader.view();
      const own = await ownMind(view, env, HARNESS_TOOL.mindDecide, args);
      if (!("who" in own)) return own;
      const { turn, who } = own;
      const kind = textArg(args, "moment") ?? "turn";
      if (kind !== "turn" && kind !== "beat") return badValue(view, HARNESS_TOOL.mindDecide, "moment", kind, MOMENTS);
      const { registry: reg, world, state } = view;
      const moment: MindMoment = { kind, at: state.clock, reason: "", user: turn.said.user, reply: turn.said.before };
      // Their level on the ladder is recorded with the mind, as the mind step records it; the ladder reads the state, and picks no one here.
      const level = view.read(() => fidelityOf(view.ctx, { user: moment.user, reply: moment.reply })).find((s) => s.entity === who)?.level ?? "near";
      const cuts: MindCuts = {};
      const data = mindData(reg, world, state, who, args, moment, level, HARNESS_MIND_REASON, turn.settings.minds.lengths, cuts);
      if (!data) return view.refuse(HARNESS_NOTE.mindEmpty);
      const event: LedgerEvent = { type: MINDS_EVENTS.mind, data: data as unknown as JsonObject };
      const fit = fits(view, event);
      if ("reason" in fit) return view.refuse(HARNESS_NOTE.eventRefused, { reason: fit.reason, tool: HARNESS_TOOL.mindDecide });
      const staged = await stageChange(view, turn, { key: hashJson(["lre.harness.mind", event.data]), changeType: "mind", events: [event], lines: authorLines(reg, world, fit.after.state, [event], 1) });
      if ("refused" in staged) return staged.refused;
      return view.answer({ decided: { who: view.entity(who), intent: data.intent, mood: data.mood, ...(data.interrupt ? { interrupt: data.interrupt.reason } : {}), lands: staged.lands }, ...cutNote(view, cuts) });
    },
  },
  {
    name: HARNESS_TOOL.mindRemember,
    family: HARNESS_FAMILY.mind,
    tier: "write",
    parameters: () =>
      objectSchema(
        {
          who: text(),
          notes: list(objectSchema({ text: text(), salience: integer({ minimum: 1, maximum: 5 }) }, ["text"])),
          commitments: list(objectSchema({ kind: text(COMMITMENT_KINDS), with: words(), text: text(), due: text() }, ["text"])),
          resolved: list(objectSchema({ id: text(), status: text(RESOLVED) }, ["id", "status"])),
          plans: list(objectSchema({ what: text(), kind: text(PLAN_KINDS), when: objectSchema({ from: text(), to: text() }, ["from"]), where: text(), with: words(), priority: integer({ minimum: 1, maximum: 5 }), amount: text() }, ["what", "when"])),
          told: list(objectSchema({ to: words(), what: text() }, ["to", "what"])),
          summary: text(),
        },
        ["who"],
      ),
    async run(args, env) {
      const view = await env.reader.view();
      const own = await ownMind(view, env, HARNESS_TOOL.mindRemember, args);
      if (!("who" in own)) return own;
      const { turn, who } = own;
      const { registry: reg, world, state } = view;
      const presence = presenceOf(view, turn);
      // Once the reply is written the engine has recorded who heard the turn, and a memory of it is theirs alone: no one remembers a turn they weren't there for.
      if (turn.reply !== null && !presence.said.who.includes(who)) return view.refuse(FILES_NOTE.rememberAbsent);
      // Whom they could have told: who was there with them; no one while the chat tracks knowledge, whose agent records telling.
      const listeners = turn.knowing ? [] : presence.left.includes(who) ? presence.said.who : [...presence.said.who, ...(presence.met?.who ?? [])];
      const cuts: MindCuts = {};
      const data = memoryData(reg, world, state, who, args, listeners, turn.settings.minds.lengths, cuts);
      if (!data) return view.refuse(WRITE_NOTE.badOp);
      // What the validator left out of the call, said so the mind can give it again as the engine takes it.
      const left: string[] = [];
      const over = (key: keyof MindCuts): number => cuts[key] ?? 0;
      const count = (n: number): { count: string } => ({ count: String(n) });
      for (const [name, key] of [["notes", "text"], ["commitments", "text"], ["told", "what"]] as const) {
        const wordless = records(args[name]).filter((x) => typeof x[key] !== "string" || x[key].trim() === "").length;
        if (wordless > 0) left.push(view.text(HARNESS_NOTE.leftWordless, { ...count(wordless), list: name }));
      }
      const plans = records(args.plans).length - data.plans.length - over("plans");
      if (plans > 0) left.push(view.text(HARNESS_NOTE.leftPlans, count(plans)));
      const resolved = records(args.resolved).length - data.resolved.length;
      if (resolved > 0) left.push(view.text(HARNESS_NOTE.leftResolved, count(resolved)));
      const told = records(args.told).filter((x) => typeof x.what === "string" && x.what.trim() !== "").length - data.told.length - over("tolds");
      if (told > 0) left.push(turn.knowing ? view.text(HARNESS_NOTE.leftToldKnowing) : view.text(HARNESS_NOTE.leftTold, count(told)));
      const kept = { notes: data.notes.length, commitments: data.commitments.length, resolved: data.resolved.length, plans: data.plans.length, told: data.told.length };
      if (Object.values(kept).every((n) => n === 0) && data.summary === null) return view.refuse(HARNESS_NOTE.memoryEmpty, { why: left.join(" ") });
      // A plan they hold already (one another's memory of the turn recorded first, shared with them) is no second copy.
      const event: LedgerEvent = { type: MINDS_EVENTS.memory, data: { ...data, plans: unheldPlans(state, who, data.plans) } as unknown as JsonObject };
      const fit = fits(view, event);
      if ("reason" in fit) return view.refuse(HARNESS_NOTE.eventRefused, { reason: fit.reason, tool: HARNESS_TOOL.mindRemember });
      const staged = await stageChange(view, turn, { key: hashJson(["lre.harness.memory", event.data]), changeType: "mind", events: [event], lines: authorLines(reg, world, fit.after.state, [event], 1) });
      if ("refused" in staged) return staged.refused;
      return view.answer({ remembered: { who: view.entity(who), ...kept, summary: data.summary !== null, lands: staged.lands }, ...(left.length > 0 ? { leftOut: left } : {}), ...cutNote(view, cuts) });
    },
  },
];

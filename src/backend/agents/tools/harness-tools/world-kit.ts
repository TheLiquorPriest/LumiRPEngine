// What the tools of the world share (`world.ts`: the document as Build edits it; `world-build.ts`:
// a place, a path and a map made without hand-written JSON): who may call one, where a write goes,
// how a refusal is answered, and what every write answers.
//
// A chat plays its own world: the revision of its world's document it plays, with what this chat
// made or changed of it in play laid over (`engine/world-draft.ts`). A write of a place, a path, a
// map or the map settings goes there by default (`in: chat`, `chatTarget`): staged with the turn as
// one change of "The world as this chat plays it", under the mode the player set for it, played at
// once, and gone with the turn. `in: document` writes the world's draft instead, as Build does,
// through the store's own path for an editor's writes (`WorldBuild.edit`): nothing written there
// reaches the chat until the draft is committed as the world's next revision and the chat is brought
// to it (an Upgrade), which every such write's answer says. A read needs only the turn; a write
// needs the game master's tier too, which the author holds and may grant.
//
// Two rules hold for every write of the world's document, whichever tool makes it:
// - The player's Never for "The world's document" refuses it, the draft's own edits too (`worldCall`):
//   the draft is the user's working copy.
// - What is closed to agents (`CLOSED_PATHS`: who the player's character is, what the engine holds
//   agents to) is never changed, whatever the mode. A write of the draft that would leave one
//   changed is refused before the store is asked (`writeDraft`); a commit, a restore and an Upgrade
//   are held to the same paths where they are asked (`world.ts`) and where they are made
//   (`makeWorldActs`). This chat's own world holds none of them.

import { hashJson } from "../../../../shared/hash";
import { HARNESS_NOTE } from "../../../../shared/harness-texts";
import { WORLD_NOTE } from "../../../../shared/harness-texts-world";
import { hasOwn, isRecord, type JsonObject, type JsonValue } from "../../../../shared/json";
import { applyPatch, getAt, jsonEqual, parsePointer, pointerOf } from "../../../../shared/json-patch";
import { loreIsSecret } from "../../../../shared/lore";
import type { LintIssue } from "../../../../shared/protocol";
import type { WorldDoc } from "../../../../shared/world";
import { type Change, changedItem, changesBetween, groupOf } from "../../../../shared/world-diff";
import { own } from "../../../../engine/pack-kit";
import { baseWorld } from "../../../../engine/places-in-play";
import { Working } from "../../../../engine/working";
import { chatDraftOf, type DraftCollection, type DraftEdit, draftChanges, draftEvent } from "../../../../engine/world-draft";
import { type EditorResult, WorldError } from "../../../worlds";
import type { ToolOutcome } from "../../runtime";
import { closedChanges, type WorldActDetail, type WorldBuild, type WorldEdit } from "../harness-ports";
import type { HarnessTurn } from "../harness-turn";
import { refusedAnswer } from "../propose";
import type { ToolReadView } from "../read-view";
import type { ToolEnv } from "../registry";
import { badValue, textArg } from "../schema";
import { stageChange } from "./kit";

/** What a tool of the world's document runs with, once the call may be made. */
export interface WorldCall {
  view: ToolReadView;
  turn: HarnessTurn;
  build: WorldBuild;
}

/**
 * The call's view, turn and document, or the answer that says why it can't be made: no turn, no way
 * to the world's document from this call, or, for a `write`, a caller below the game master's tier,
 * or the player's Never for the world's document, which closes every write of it: an act on it and
 * an edit of its draft alike, answered as the writer answers a change under Never.
 */
export async function worldCall(env: ToolEnv, write: boolean): Promise<WorldCall | ToolOutcome> {
  const view = await env.reader.view();
  const turn = env.turn;
  if (!turn) return view.refuse(HARNESS_NOTE.noTurn);
  const build = env.build;
  if (!build) return view.refuse(WORLD_NOTE.noBuild);
  if (!write) return { view, turn, build };
  // The author holds the game master's tier; anyone else only once the author granted it.
  if ((turn.tier ?? (turn.main ? "gm" : "read")) !== "gm") return view.refuse(WORLD_NOTE.needsGm);
  const never = await build.never();
  return never === null ? { view, turn, build } : refusedAnswer({ refused: true, code: "mode_never", reason: never });
}

/** Whether `worldCall` answered instead of letting the call through. */
export function refusedCall(call: WorldCall | ToolOutcome): call is ToolOutcome {
  return "text" in call;
}

/** A lint issue as a tool's answer lists it: where, what, and the code a fix is found by. */
export interface LintLine {
  severity: LintIssue["severity"];
  path: string;
  code: string;
  message: string;
}

const RANK: Readonly<Record<LintIssue["severity"], number>> = { error: 0, warning: 1, info: 2 };
/** What makes two issues the same one, before a write and after it: both sides of `newIssues` read it. */
const sameIssue = (i: LintIssue): string => `${i.severity}\u0000${i.path}\u0000${i.code}\u0000${i.message}`;

/**
 * `issues` as an answer lists them, errors first, as many as fit in what one tool result may hold
 * (Settings → Agents, Tool results clipped past: half of it, so the rest of the answer fits too),
 * with how many more there are.
 */
export function lintLines(turn: HarnessTurn, issues: readonly LintIssue[]): { lines: LintLine[]; more: number } {
  const room = Math.floor(turn.settings.agents.clipChars / 2);
  const sorted = [...issues].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const lines: LintLine[] = [];
  let used = 0;
  for (const issue of sorted) {
    // Without the one-press fix Build offers for it: a patch of the draft, which an agent writes itself.
    const line: LintLine = { severity: issue.severity, path: issue.path, code: issue.code, message: issue.message };
    used += JSON.stringify(line).length + 1;
    if (used > room && lines.length > 0) break;
    lines.push(line);
  }
  return { lines, more: sorted.length - lines.length };
}

/** How many of `issues` there are of each severity, a severity with none left out. */
export function lintCounts(issues: readonly LintIssue[]): { errors?: number; warnings?: number; infos?: number } {
  const count = (severity: LintIssue["severity"]): number => issues.filter((i) => i.severity === severity).length;
  const errors = count("error");
  const warnings = count("warning");
  const infos = count("info");
  return { ...(errors > 0 ? { errors } : {}), ...(warnings > 0 ? { warnings } : {}), ...(infos > 0 ? { infos } : {}) };
}

/** The issues of `after` that `before` didn't have: what one write brought. */
export function newIssues(before: readonly LintIssue[], after: readonly LintIssue[]): LintIssue[] {
  const had = new Set(before.map(sameIssue));
  return after.filter((i) => !had.has(sameIssue(i)));
}

/**
 * The store's refusal as a tool answers it: its own message, which says what to fix, and for a
 * write its checks refused, the errors they found. Anything but the store's refusal is no answer:
 * it is thrown again.
 */
export function storeRefusal(call: Pick<WorldCall, "view" | "turn">, error: unknown): ToolOutcome {
  if (!(error instanceof WorldError)) throw error;
  const errors = error.lint.filter((i) => i.severity === "error");
  if (errors.length === 0) return call.view.refuse(WORLD_NOTE.refused, { reason: error.message });
  const { lines, more } = lintLines(call.turn, errors);
  return call.view.refuse(WORLD_NOTE.refusedLint, { reason: error.message, errors: [...lines.map((l) => `- ${l.path}: ${l.message} (${l.code})`), ...(more > 0 ? [`- ${call.view.text(WORLD_NOTE.more, { count: String(more) })}`] : [])].join("\n") });
}

/** The draft as it stands, with its lint; or the store's refusal as an answer. */
export async function draftOf(call: WorldCall): Promise<EditorResult | ToolOutcome> {
  try {
    return await call.build.edit({ op: "get" });
  } catch (error) {
    return storeRefusal(call, error);
  }
}

/** Whether `draftOf` answered instead of giving the draft. */
export function noDraft(draft: EditorResult | ToolOutcome): draft is ToolOutcome {
  return "text" in draft;
}

/**
 * One write of the draft, answered as every write of the world's document is: what changed in a
 * line (`changed`, in the tool's own words), the draft's version, the lint issues this write
 * brought (errors first) with the draft's counts, and the standing reminder that the draft reaches
 * this chat only once it is committed and the chat brought to it. `before`: the draft as the tool
 * read it, when it did; else it is read here, for the lint the write is compared with. The write is
 * pinned to that draft's version: what the tool checked is what it writes over, and the store
 * refuses it once someone else wrote to the draft since (Build is the same working copy). `extra`:
 * what the tool's answer says besides (an id it made, say). A write that changed nothing says so.
 */
export async function writeDraft(call: WorldCall, edit: Exclude<WorldEdit, { op: "get" }>, changed: string, input: { before?: EditorResult; extra?: Readonly<Record<string, unknown>> } = {}): Promise<ToolOutcome> {
  const before = input.before ?? (await draftOf(call));
  if (noDraft(before)) return before;
  const unchanged = (version: number): ToolOutcome => call.view.answer({ unchanged: call.view.text(WORLD_NOTE.unchanged), draft: { version }, ...(input.extra ?? {}) });
  // The store writes an item put back as it stands, and counts a version for it: here it is no write at all.
  if (edit.op === "put") {
    const items: unknown = (before.draft as unknown as Readonly<Record<string, unknown>>)[edit.collection];
    if (isRecord(items) && hasOwn(items, edit.id) && jsonEqual(items[edit.id], edit.value)) return unchanged(before.version);
  }
  const closed = closedBy(before.draft, edit);
  if (closed.length > 0) return call.view.refuse(WORLD_NOTE.closed, { paths: closed.join(", ") });
  let after: EditorResult;
  try {
    after = await call.build.edit({ ...edit, version: before.version });
  } catch (error) {
    return storeRefusal(call, error);
  }
  // The store counts a version for every other write it made: the same version is a write that changed nothing.
  if (after.version === before.version && after.stored === before.stored) return unchanged(after.version);
  const brought = newIssues(before.lint, after.lint);
  const { lines, more } = lintLines(call.turn, brought);
  return call.view.answer({
    changed,
    ...(input.extra ?? {}),
    draft: { version: after.version },
    lint: { ...lintCounts(after.lint), ...(lines.length > 0 ? { new: lines } : {}), ...(more > 0 ? { more } : {}) },
    next: call.view.text(WORLD_NOTE.next, { revision: call.view.state.revision }),
  });
}

/**
 * The closed paths (`CLOSED_PATHS`) `edit` would leave changed in `draft`, worked out before the
 * store is asked, so nothing is written and then taken back: a patch as the store applies one, an
 * item put or taken out, a part written whole (`meta`: the root's own members, of which only those
 * given change). A patch that can't be applied is the store's to refuse, in its own words.
 */
function closedBy(draft: WorldDoc, edit: Exclude<WorldEdit, { op: "get" }>): string[] {
  const doc = draft as unknown as JsonObject;
  switch (edit.op) {
    case "patch":
      try {
        return closedChanges(doc, applyPatch(doc, edit.ops));
      } catch {
        return [];
      }
    case "put":
    case "remove": {
      const held = doc[edit.collection];
      const items: Record<string, JsonValue> = { ...(isRecord(held) ? held : {}) };
      if (edit.op === "put") items[edit.id] = edit.value;
      else delete items[edit.id];
      return closedChanges(doc, { ...doc, [edit.collection]: items });
    }
    case "set":
      return closedChanges(doc, edit.part === "meta" ? { ...doc, ...(isRecord(edit.value) ? edit.value : {}) } : { ...doc, [edit.part]: edit.value });
    default:
      return [];
  }
}

// ---------------------------------------------------------------- where a building write goes

/** Where a write of the world goes: this chat's own world, played at once (`chat`, the default), or the world's document, played once committed and the chat brought to it (`document`). */
export const WORLD_INS = ["chat", "document"] as const;
export type WorldIn = (typeof WORLD_INS)[number];

/** A call's `in`, `fallback` where it is left out; or the refusal that says what it takes. */
export function inArg(view: ToolReadView, tool: string, args: JsonObject, fallback: WorldIn): WorldIn | ToolOutcome {
  const said = textArg(args, "in");
  if (said === null) return fallback;
  return WORLD_INS.find((w) => w === said) ?? badValue(view, tool, "in", said, WORLD_INS);
}

type Extra = Readonly<Record<string, unknown>>;

/**
 * What a building tool reads and writes, wherever its call writes: the world as there (as this chat
 * plays it, or the world's draft as stored), and its writes of a whole place, path or map, of an item
 * taken out, and of the map settings. One that leaves the world as it is writes nothing (`same`).
 */
export interface WorldTarget {
  in: WorldIn;
  view: ToolReadView;
  turn: HarnessTurn;
  doc: WorldDoc;
  put(collection: DraftCollection, id: string, value: object, changed: string, extra: Extra): Promise<ToolOutcome> | ToolOutcome;
  remove(collection: DraftCollection, id: string, changed: string, extra: Extra): Promise<ToolOutcome>;
  settings(value: JsonObject, changed: string, extra: Extra): Promise<ToolOutcome>;
  same(extra: Extra): ToolOutcome;
}

/** Where a building call writes (its `in`, this chat's own world when left out), with that world read; or the answer that says why the call can't be made. */
export async function worldTarget(env: ToolEnv, tool: string, args: JsonObject): Promise<WorldTarget | ToolOutcome> {
  const into = inArg(await env.reader.view(), tool, args, "chat");
  if (typeof into !== "string") return into;
  return into === "chat" ? chatTarget(env) : documentTarget(env);
}

/** Whether `worldTarget` answered instead of giving a target. */
export function noTarget(target: WorldTarget | ToolOutcome): target is ToolOutcome {
  return "text" in target;
}

/**
 * This chat's own world: the world as the caller plays it, each write one change of "The world as
 * this chat plays it" (`world_edit`), checked by the engine's own validator on what the caller reads
 * and staged with the turn (after the reply, in a job, written at once). The game master's tier
 * writes it, as it writes the world's document; the player's mode for the type decides the rest.
 */
export async function chatTarget(env: ToolEnv): Promise<WorldTarget | ToolOutcome> {
  const view = await env.reader.view();
  const turn = env.turn;
  if (!turn) return view.refuse(HARNESS_NOTE.noTurn);
  if ((turn.tier ?? (turn.main ? "gm" : "read")) !== "gm") return view.refuse(WORLD_NOTE.needsGm);
  const doc = view.ctx.world;
  const same = (extra: Extra): ToolOutcome => view.answer({ unchanged: view.text(WORLD_NOTE.unchangedChat), ...extra });
  const stage = async (edit: DraftEdit, changed: string, extra: Extra): Promise<ToolOutcome> => {
    const event = draftEvent(baseWorld(doc), chatDraftOf(view.state), edit);
    const bad = new Working(view.registry, doc, view.state).apply(event);
    if (bad) return view.refuse(WORLD_NOTE.chatRefused, { reason: bad.gm ?? bad.reason });
    const staged = await stageChange(view, turn, { key: hashJson(["lre.harness.world", event.data]), changeType: "world_edit", events: [event], lines: [changed] });
    if ("refused" in staged) return staged.refused;
    return view.answer({ changed, ...extra, lands: staged.lands, next: view.text(WORLD_NOTE.chatNext) });
  };
  return {
    in: "chat",
    view,
    turn,
    doc,
    put: (collection, id, value, changed, extra) => (jsonEqual(own(doc[collection] as Readonly<Record<string, unknown>>, id), value) ? same(extra) : stage({ collection, id, value: value as JsonObject }, changed, extra)),
    remove: (collection, id, changed, extra) => stage({ collection, id, gone: true }, changed, extra),
    settings: (value, changed, extra) => stage({ part: "mapSettings", value }, changed, extra),
    same,
  };
}

/** The world's document: its draft as stored, each write the store's own, as Build makes it (`writeDraft`). */
async function documentTarget(env: ToolEnv): Promise<WorldTarget | ToolOutcome> {
  const call = await worldCall(env, true);
  if (refusedCall(call)) return call;
  const before = await draftOf(call);
  if (noDraft(before)) return before;
  const doc = before.draft;
  const same = (extra: Extra): ToolOutcome => call.view.answer({ unchanged: call.view.text(WORLD_NOTE.unchanged), draft: { version: before.version }, ...extra });
  return {
    in: "document",
    view: call.view,
    turn: call.turn,
    doc,
    // The store counts a version for every item put, so only here can a write that changes nothing be told from one that does.
    put: (collection, id, value, changed, extra) => (jsonEqual(own(doc[collection] as Readonly<Record<string, unknown>>, id), value) ? same(extra) : writeDraft(call, { op: "put", collection, id, value: value as unknown as JsonValue }, changed, { before, extra })),
    remove: (collection, id, changed, extra) => writeDraft(call, { op: "remove", collection, id }, changed, { before, extra }),
    // The map settings are none of the parts the store sets: a patch writes them, whole.
    settings: (value, changed, extra) => writeDraft(call, { op: "patch", ops: [{ op: "add", path: pointerOf(["mapSettings"]), value: value as unknown as JsonValue }] }, changed, { before, extra }),
    same,
  };
}

/** What this chat made or changed of its world in play that the revision it plays doesn't have, as the caller reads it. */
export function chatChanges(view: ToolReadView): DraftEdit[] {
  return draftChanges(baseWorld(view.ctx.world), chatDraftOf(view.state));
}

/** Whether the item at `pointer` in `doc` is one the document keeps from the player's character: a restricted person, thing, place or track, or lore that is secret or read only by those who know it. */
export function keptFromPlayer(doc: unknown, pointer: string): boolean {
  const [collection, id] = parsePointer(pointer);
  const item = collection !== undefined && id !== undefined ? getAt(doc as JsonValue, [collection, id]) : undefined;
  if (!isRecord(item)) return false;
  const restricted = item.visibility !== undefined && item.visibility !== null && item.visibility !== "public";
  return collection === "lore" ? restricted || loreIsSecret(item) : restricted && (collection === "entities" || collection === "places" || collection === "tracks");
}

/** What heads the list of what a commit, a restore or an Upgrade changes: its text, and what fills it beside the count. */
export interface ChangesHead {
  id: string;
  vars?: Readonly<Record<string, string>>;
}

/**
 * What a write of the world's document changes, from `from` to `to`, by collection, in the engine's
 * own comparison (`changesBetween`: what Build and the command line show), as each reader is told
 * it (`WorldActDetail`): the agent that asked, with everything named and what the document keeps
 * from the player's character marked as a secret is marked in every read; and the player on the
 * review card, where such an item is counted and never named. One line a collection, the world's
 * parts in a line of their own, as many lines as fit in half of what one tool result may hold.
 */
export function changeDetail(call: Pick<WorldCall, "view" | "turn">, head: ChangesHead, from: unknown, to: unknown): WorldActDetail {
  const { view, turn } = call;
  const changes = changesBetween(from, to);
  if (changes.length === 0) return { agent: [view.text(WORLD_NOTE.changesNone)], player: [view.text(WORLD_NOTE.changesNone)] };
  const kept = (change: Change): boolean => keptFromPlayer(change.kind === "removed" ? from : to, change.key);
  const secrecy = { known: [], kept: [view.name(view.pov)] };
  const KINDS = [["added", WORLD_NOTE.changeAdded], ["changed", WORLD_NOTE.changeChanged], ["removed", WORLD_NOTE.changeRemoved]] as const;
  /** One line a group, in document order: a collection's items by what happened to them, or the parts that changed. */
  const linesFor = (shown: readonly Change[], named: (change: Change, name: string) => string): string[] => {
    const groups = new Map<string, Change[]>();
    for (const change of shown) {
      const group = changedItem(change) === null ? "" : groupOf(change.key);
      groups.set(group, [...(groups.get(group) ?? []), change]);
    }
    return [...groups].map(([group, list]) => {
      const parts = KINDS.flatMap(([kind, text]) => {
        const items = list.filter((change) => change.kind === kind).map((change) => named(change, changedItem(change) ?? change.label));
        return items.length > 0 ? [view.text(text, { items: items.join(", ") })] : [];
      });
      return view.text(WORLD_NOTE.changeItems, { collection: group === "" ? view.text(WORLD_NOTE.changeParts) : group, changes: parts.join("; ") });
    });
  };
  const fitted = (lines: readonly string[]): string[] => {
    const room = Math.floor(turn.settings.agents.clipChars / 2);
    const shown: string[] = [];
    let used = 0;
    for (const line of lines) {
      used += line.length + 1;
      if (used > room && shown.length > 0) break;
      shown.push(line);
    }
    return shown.length < lines.length ? [...shown, view.text(WORLD_NOTE.changesMore, { count: String(lines.length - shown.length) })] : shown;
  };
  const first = view.text(head.id, { ...head.vars, count: String(changes.length) });
  const open = changes.filter((change) => !kept(change));
  const hidden = changes.length - open.length;
  return {
    agent: [first, ...fitted(linesFor(changes, (change, name) => (kept(change) ? view.mark(name, secrecy) : name)))],
    player: [first, ...fitted(linesFor(open, (_change, name) => name)), ...(hidden > 0 ? [view.text(WORLD_NOTE.changesHidden, { count: String(hidden) })] : [])],
  };
}

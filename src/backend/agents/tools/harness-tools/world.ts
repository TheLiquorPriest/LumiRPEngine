// The world's document as an agent edits it: Build's own draft, lint, commit and Upgrade; and this
// chat's own world, which the chat plays.
//
// A chat plays one revision of its world, with what it made or changed of the world's places, paths
// and maps in play laid over (`engine/world-draft.ts`). An item of those collections is written to
// that, this chat's own world, by default (`chatTarget`): staged with the turn, played at once, gone
// with the turn, and kept into the world's document by `world_keep`. What exists only in the world's
// document (the calendar, schedules, routines, kinds, actions, checks, tracks, lore, tables, rules,
// sections and every other collection and part) is changed there, in the world's draft, exactly as
// the Build page changes it: the same operations through the same store (`WorldBuild`), so the same
// checks refuse the same writes. The draft is then committed as the world's next revision, and the
// chat brought to it. None of these tools decides anything: each reads or writes what its call names.
//
// What an answer may hold is the one limit a tool result has (Settings → Agents, Tool results
// clipped past): a value longer than that is answered as an outline to read further into, and a list
// of names is cut to half of it, as the lint issues are (`lintLines`).

import { HARNESS_FAMILY } from "../../../../shared/harness-text-kit";
import { BUILD_NOTE } from "../../../../shared/harness-texts-build";
import { PART_SHAPES, shapeTextId } from "../../../../shared/harness-texts-shapes";
import { WORLD_NOTE, WORLD_TOOL } from "../../../../shared/harness-texts-world";
import { hasOwn, isRecord, type JsonObject, type JsonValue } from "../../../../shared/json";
import { getAt, jsonEqual, parsePointer, pointerOf } from "../../../../shared/json-patch";
import type { JsonPatchOp, WorldCollection, WorldPart } from "../../../../shared/protocol";
import type { RevisionNote, WorldDoc } from "../../../../shared/world";
import { nameOf } from "../../../../shared/world-diff";
import { baseWorld } from "../../../../engine/places-in-play";
import { DRAFT_COLLECTIONS, type DraftCollection, type DraftEdit } from "../../../../engine/world-draft";
import { keepInWorld, madeInPlay } from "../../../gm";
import { WORLD_COLLECTIONS, WorldError } from "../../../worlds";
import type { ToolOutcome } from "../../runtime";
import { closedChanges, type WorldActDetail } from "../harness-ports";
import { boolArg, missing, propose, wordsArg } from "../propose";
import type { Secrecy, ToolReadView } from "../read-view";
import { argGiven, badValue, intArg, integer, jsonObject, jsonTextOf, needText, objectArg, objectSchema, text, textArg } from "../schema";
import { type HarnessToolDefinition, words } from "./kit";
import { changeDetail, chatChanges, chatTarget, draftOf, inArg, keptFromPlayer, lintCounts, lintLines, noDraft, noTarget, refusedCall, storeRefusal, type WorldCall, worldCall, WORLD_INS, writeDraft } from "./world-kit";

const COLLECTIONS = Object.keys(WORLD_COLLECTIONS) as WorldCollection[];
const PARTS = Object.keys(PART_SHAPES) as WorldPart[];
const SOURCES = ["draft", "playing"] as const;

/** Where each part is read in the document. `meta` is members of the root itself, and `tiers` two of them. */
const PART_AT: Readonly<Record<WorldPart, readonly string[]>> = {
  calendar: ["/calendar"],
  realism: ["/realism"],
  time: ["/time"],
  meta: [""],
  tiers: ["/tiers", "/spawnTier"],
  ruleset: ["/ruleset"],
  loreIndex: ["/loreIndex"],
  minds: ["/minds"],
  lorePins: ["/lorePins"],
  routineSettings: ["/routineSettings"],
  needs: ["/needs"],
};

/** How many of a collection's items `world_shape` points to as examples: enough to see what varies between items, few enough to read each. */
const EXAMPLES = 3;

/** An argument that takes one of `values`, or the note that says so: that it is missing, or the values it takes. */
function oneOf<T extends string>(view: ToolReadView, tool: string, args: JsonObject, key: string, values: readonly T[]): T | ToolOutcome {
  const said = needText(view, tool, args, key);
  if (typeof said !== "string") return said;
  return values.find((value) => value === said) ?? badValue(view, tool, key, said, values);
}

/** The `value` argument as the JSON object an item or a part is, or the note that says what it must be. */
function valueArg(view: ToolReadView, tool: string, args: JsonObject): { value: JsonObject } | { refused: ToolOutcome } {
  if (!argGiven(args, "value")) return { refused: missing(view, tool, "value") };
  const value = objectArg(args, "value");
  return value ? { value } : { refused: view.refuse(WORLD_NOTE.needsObject, { tool, arg: "value" }) };
}

/** `names` in a line, as many as fit in half of what one tool result may hold, with how many more there are. */
function named(call: Pick<WorldCall, "view" | "turn">, names: readonly string[]): string {
  const room = Math.floor(call.turn.settings.agents.clipChars / 2);
  const shown: string[] = [];
  let used = 0;
  for (const name of names) {
    used += name.length + 2;
    if (used > room && shown.length > 0) break;
    shown.push(name);
  }
  if (names.length === 0) return call.view.text(WORLD_NOTE.none);
  const list = shown.join(", ");
  return shown.length < names.length ? call.view.text(WORLD_NOTE.andMore, { list, count: String(names.length - shown.length) }) : list;
}

/** What a member holds, as an outline shows it: how many members, items or characters; a number, true, false and null as they are. */
function held(value: JsonValue): JsonValue {
  if (typeof value === "string") return { text: value.length };
  if (Array.isArray(value)) return { list: value.length };
  if (value !== null && typeof value === "object") return { object: Object.keys(value).length };
  return value;
}

/** A refusal with where its fix is found added; an answer as it is. */
function hinted(out: ToolOutcome, hint: string): ToolOutcome {
  return out.error === true ? { text: `${out.text} ${hint}`, error: true } : out;
}

/** The ids a collection of `doc` has. */
function idsOf(doc: object, collection: WorldCollection): string[] {
  const items = (doc as Readonly<Record<string, unknown>>)[collection];
  return items !== null && typeof items === "object" ? Object.keys(items) : [];
}

/** The collections whose items a document may keep from the player's character. */
const KEPT = ["entities", "places", "tracks", "lore"] as const;

/**
 * What, of what a read of `doc` at `tokens` shows, is kept from the player's character: each
 * restricted person, thing, place or track, each lore entry that is secret or read only by those
 * who know it, and each field of someone the chat plays that isn't everyone's to see; at or below
 * the pointer, or the item the pointer is inside. Each by its pointer and name, marked as every
 * read marks a secret: by who knows it, as the chat has it; one only the `draft` has, or has
 * otherwise, as kept from everyone. As many as fit in half of what one tool result may hold, with
 * how many more there are. None where the view doesn't mark.
 */
function secretsShown(call: Pick<WorldCall, "view" | "turn">, doc: JsonValue, tokens: readonly string[], draft: boolean): { secret: string[]; more: number } {
  const { view, turn } = call;
  if (!view.marked) return { secret: [], more: 0 };
  const unplayed: Secrecy = { known: [], kept: "everyone" };
  const lines: string[] = [];
  for (const collection of KEPT) {
    if (tokens.length > 0 && tokens[0] !== collection) continue;
    const items = getAt(doc, [collection]);
    if (!isRecord(items)) continue;
    for (const [id, item] of Object.entries(items)) {
      if (tokens.length > 1 && tokens[1] !== id) continue;
      const at = pointerOf([collection, id]);
      const lore = collection === "lore" && hasOwn(view.world.lore, id) ? view.world.lore[id] : undefined;
      const played = collection === "entities" ? view.entitySecrecy(id) : collection === "places" ? view.placeSecrecy(id) : collection === "tracks" ? view.trackSecrecy(id) : lore ? view.loreSecrecy(lore) : null;
      const secrecy = played ?? (draft && keptFromPlayer(doc, at) ? unplayed : null);
      if (secrecy) lines.push(view.mark(`${at}: ${nameOf(item) ?? id}`, secrecy));
      if (collection !== "entities" || !isRecord(item) || !isRecord(item.fields)) continue;
      for (const field of Object.keys(item.fields)) {
        const hidden = view.fieldSecrecy(id, field);
        if (hidden) lines.push(view.mark(pointerOf([collection, id, "fields", field]), hidden));
      }
    }
  }
  const room = Math.floor(turn.settings.agents.clipChars / 2);
  const secret: string[] = [];
  let used = 0;
  for (const line of lines) {
    used += line.length + 3;
    if (used > room && secret.length > 0) break;
    secret.push(line);
  }
  return { secret, more: lines.length - secret.length };
}

/** Which of the draft's issues `world_status` lists, and which of what a chat made `world_made` lists. */
const ISSUES: readonly string[] = ["all", "errors"];
const MADE_KINDS: readonly string[] = ["things", "places", "world"];

/** The collection of this chat's own world `collection` is, or null for one only the world's document holds. */
function carriedOf(collection: WorldCollection): DraftCollection | null {
  return DRAFT_COLLECTIONS.find((c) => c === collection) ?? null;
}

export const WORLD_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: WORLD_TOOL.status,
    family: HARNESS_FAMILY.world,
    tier: "read",
    parameters: () => objectSchema({ issues: text(ISSUES) }),
    async run(args, env) {
      const call = await worldCall(env, false);
      if (refusedCall(call)) return call;
      const { view, turn, build } = call;
      const draft = await draftOf(call);
      if (noDraft(draft)) return draft;
      let head: string;
      try {
        head = await build.head();
      } catch (error) {
        return storeRefusal(call, error);
      }
      const playing = view.state.revision;
      const which = textArg(args, "issues") ?? "all";
      if (!ISSUES.includes(which)) return badValue(view, WORLD_TOOL.status, "issues", which, ISSUES);
      // The counts are the draft's whole lint either way: only the list is narrowed.
      const { lines, more } = lintLines(turn, which === "errors" ? draft.lint.filter((i) => i.severity === "error") : draft.lint);
      const changes = chatChanges(view);
      return view.answer({
        playing,
        head,
        behind: playing !== head,
        ...(playing !== head ? { upgrade: view.text(WORLD_NOTE.behind, { head }) } : {}),
        ...(changes.length > 0 ? { chat: { changes: changes.length, note: view.text(WORLD_NOTE.chatChanges, { count: String(changes.length) }) } } : {}),
        draft: {
          stored: draft.stored,
          version: draft.version,
          base: draft.base,
          // A draft begun on an earlier head can't be committed: the store refuses it, as it does Build's.
          ...(draft.stored && draft.base !== null && draft.base !== head ? { stale: view.text(WORLD_NOTE.staleDraft, { base: draft.base }) } : {}),
        },
        lint: { ...lintCounts(draft.lint), ...(lines.length > 0 ? { issues: lines } : {}), ...(more > 0 ? { more } : {}) },
      });
    },
  },
  {
    name: WORLD_TOOL.read,
    family: HARNESS_FAMILY.world,
    tier: "read",
    parameters: () => objectSchema({ pointer: text(), source: text(SOURCES), after: text() }),
    async run(args, env) {
      const call = await worldCall(env, false);
      if (refusedCall(call)) return call;
      const { view, turn } = call;
      const said = textArg(args, "source");
      const source = said === null ? "draft" : SOURCES.find((s) => s === said);
      if (source === undefined) return badValue(view, WORLD_TOOL.read, "source", said ?? "", SOURCES);
      const pointer = textArg(args, "pointer") ?? "";
      let tokens: string[];
      try {
        tokens = parsePointer(pointer);
      } catch {
        return view.refuse(WORLD_NOTE.badPointer, { pointer });
      }
      let doc: JsonValue;
      let where: JsonObject;
      if (source === "draft") {
        const draft = await draftOf(call);
        if (noDraft(draft)) return draft;
        // A world document is plain JSON.
        doc = draft.draft as unknown as JsonValue;
        where = { source, version: draft.version, pointer };
      } else {
        doc = view.world as unknown as JsonValue;
        where = { source, revision: view.state.revision, pointer };
      }
      let at = doc;
      for (const [i, step] of tokens.entries()) {
        const next = getAt(at, [step]);
        if (next === undefined) {
          const good = pointerOf(tokens.slice(0, i));
          if (Array.isArray(at)) return view.refuse(WORLD_NOTE.noIndex, { pointer, at: good, step, count: String(at.length) });
          if (at !== null && typeof at === "object") return view.refuse(WORLD_NOTE.noMember, { pointer, at: good, step, keys: named(call, Object.keys(at)) });
          return view.refuse(WORLD_NOTE.noBelow, { pointer, at: good });
        }
        at = next;
      }
      const clip = turn.settings.agents.clipChars;
      // What the answer shows that is kept from the player's character, each by its pointer: the value itself stays the document's own JSON.
      const kept = view.read(() => secretsShown(call, doc, tokens, source === "draft"));
      const secret = kept.secret.length > 0 ? { secret: kept.secret, ...(kept.more > 0 ? { secretMore: kept.more } : {}) } : {};
      // A text has no members to outline: it is answered whole, and clipped as any long answer is.
      if (at === null || typeof at !== "object" || JSON.stringify(at).length <= clip) return view.answer({ ...where, value: at, ...secret });
      const members: [string, JsonValue][] = Array.isArray(at) ? at.map((value, i) => [String(i), value]) : Object.entries(at);
      // A list's index may come as the number it is.
      const after = typeof args.after === "number" ? String(args.after) : textArg(args, "after");
      const from = after === null ? 0 : members.findIndex(([key]) => key === after) + 1;
      if (after !== null && from === 0) return view.refuse(WORLD_NOTE.noMember, { pointer: `${pointer}/${after}`, at: pointer, step: after, keys: named(call, members.map(([key]) => key)) });
      const room = Math.floor(clip / 2);
      const outline: JsonObject = {};
      let used = 0;
      let shown = 0;
      let last = after ?? "";
      for (const [key, value] of members.slice(from)) {
        const holds = held(value);
        used += JSON.stringify(key).length + JSON.stringify(holds).length + 2;
        if (used > room && shown > 0) break;
        outline[key] = holds;
        last = key;
        shown++;
      }
      const left = members.length - from - shown;
      return view.answer({ ...where, holds: held(at), outline, note: view.text(WORLD_NOTE.outline, { pointer }), ...(left > 0 ? { more: view.text(WORLD_NOTE.outlineCut, { count: String(left), after: last }) } : {}), ...secret });
    },
  },
  {
    name: WORLD_TOOL.shape,
    family: HARNESS_FAMILY.world,
    tier: "read",
    parameters: () => objectSchema({ of: text([...COLLECTIONS, ...PARTS]) }, ["of"]),
    async run(args, env) {
      const call = await worldCall(env, false);
      if (refusedCall(call)) return call;
      const { view } = call;
      const said = needText(view, WORLD_TOOL.shape, args, "of");
      if (typeof said !== "string") return said;
      const part = PARTS.find((p) => p === said);
      if (part !== undefined) return view.answer({ part, shape: view.text(shapeTextId(part)), at: PART_AT[part], next: view.text(WORLD_NOTE.shapePart, { of: part }) });
      const collection = COLLECTIONS.find((c) => c === said);
      if (collection === undefined) return badValue(view, WORLD_TOOL.shape, "of", said, [...COLLECTIONS, ...PARTS]);
      const draft = await draftOf(call);
      if (noDraft(draft)) return draft;
      const ids = idsOf(draft.draft, collection);
      return view.answer({ collection, shape: view.text(shapeTextId(collection)), items: ids.length, examples: ids.slice(0, EXAMPLES).map((id) => pointerOf([collection, id])), next: view.text(WORLD_NOTE.shapeCollection, { of: collection }) });
    },
  },
  {
    name: WORLD_TOOL.put,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ collection: text(COLLECTIONS), id: text(), value: jsonObject(), in: text(WORLD_INS) }, ["collection", "id", "value"]),
    async run(args, env) {
      const view = await env.reader.view();
      const collection = oneOf(view, WORLD_TOOL.put, args, "collection", COLLECTIONS);
      if (typeof collection !== "string") return collection;
      const id = needText(view, WORLD_TOOL.put, args, "id");
      if (typeof id !== "string") return id;
      const item = valueArg(view, WORLD_TOOL.put, args);
      if ("refused" in item) return item.refused;
      const hint = view.text(WORLD_NOTE.shapeHint, { of: collection });
      const carried = carriedOf(collection);
      const into = inArg(view, WORLD_TOOL.put, args, carried === null ? "document" : "chat");
      if (typeof into !== "string") return into;
      if (into === "chat") {
        if (carried === null) return view.refuse(WORLD_NOTE.notCarried, { collection });
        const t = await chatTarget(env);
        if (noTarget(t)) return t;
        // A new item written without its id takes its key, as the store gives a draft's.
        const value = item.value.id === undefined ? { ...item.value, id } : item.value;
        const changed = view.text(idsOf(t.doc, collection).includes(id) ? WORLD_NOTE.replaced : WORLD_NOTE.added, { collection, id, where: view.text(BUILD_NOTE.inChat) });
        return hinted(await t.put(carried, id, value, changed, {}), hint);
      }
      const call = await worldCall(env, true);
      if (refusedCall(call)) return call;
      const before = await draftOf(call);
      if (noDraft(before)) return before;
      const changed = view.text(idsOf(before.draft, collection).includes(id) ? WORLD_NOTE.replaced : WORLD_NOTE.added, { collection, id, where: view.text(BUILD_NOTE.inDocument) });
      return hinted(await writeDraft(call, { op: "put", collection, id, value: item.value }, changed, { before }), hint);
    },
  },
  {
    name: WORLD_TOOL.remove,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ collection: text(COLLECTIONS), id: text(), in: text(WORLD_INS) }, ["collection", "id"]),
    async run(args, env) {
      const view = await env.reader.view();
      const collection = oneOf(view, WORLD_TOOL.remove, args, "collection", COLLECTIONS);
      if (typeof collection !== "string") return collection;
      const id = needText(view, WORLD_TOOL.remove, args, "id");
      if (typeof id !== "string") return id;
      const carried = carriedOf(collection);
      const into = inArg(view, WORLD_TOOL.remove, args, carried === null ? "document" : "chat");
      if (typeof into !== "string") return into;
      if (into === "chat") {
        if (carried === null) return view.refuse(WORLD_NOTE.notCarried, { collection });
        const t = await chatTarget(env);
        if (noTarget(t)) return t;
        const where = view.text(BUILD_NOTE.inChat);
        const ids = idsOf(t.doc, collection);
        if (!ids.includes(id)) return view.refuse(WORLD_NOTE.noItem, { collection, id, where, ids: named(t, ids) });
        return t.remove(carried, id, view.text(WORLD_NOTE.removed, { collection, id, where }), {});
      }
      const call = await worldCall(env, true);
      if (refusedCall(call)) return call;
      const before = await draftOf(call);
      if (noDraft(before)) return before;
      // The store takes the removal of an item that isn't there as a write, and counts a version for it.
      const where = view.text(BUILD_NOTE.inDocument);
      const ids = idsOf(before.draft, collection);
      if (!ids.includes(id)) return view.refuse(WORLD_NOTE.noItem, { collection, id, where, ids: named(call, ids) });
      return writeDraft(call, { op: "remove", collection, id }, view.text(WORLD_NOTE.removed, { collection, id, where }), { before });
    },
  },
  {
    name: WORLD_TOOL.set,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ part: text(PARTS), value: jsonObject() }, ["part", "value"]),
    async run(args, env) {
      const call = await worldCall(env, true);
      if (refusedCall(call)) return call;
      const { view } = call;
      const part = oneOf(view, WORLD_TOOL.set, args, "part", PARTS);
      if (typeof part !== "string") return part;
      const whole = valueArg(view, WORLD_TOOL.set, args);
      if ("refused" in whole) return whole.refused;
      return hinted(await writeDraft(call, { op: "set", part, value: whole.value }, view.text(WORLD_NOTE.wrotePart, { part })), view.text(WORLD_NOTE.shapeHint, { of: part }));
    },
  },
  {
    name: WORLD_TOOL.patch,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ ops: text() }, ["ops"]),
    async run(args, env) {
      const call = await worldCall(env, true);
      if (refusedCall(call)) return call;
      const { view } = call;
      const raw = args.ops;
      const ops = typeof raw === "string" ? jsonTextOf(raw) : raw;
      if (!Array.isArray(ops)) return view.refuse(WORLD_NOTE.needsOps);
      // The store reads each operation for its shape itself, and refuses the patch by the one that is wrong.
      return hinted(await writeDraft(call, { op: "patch", ops: ops as unknown as JsonPatchOp[] }, view.text(WORLD_NOTE.patched, { count: String(ops.length) })), view.text(WORLD_NOTE.shapeHintAny));
    },
  },
  {
    name: WORLD_TOOL.discard,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ version: integer({ minimum: 0 }) }, ["version"]),
    async run(args, env) {
      const call = await worldCall(env, true);
      if (refusedCall(call)) return call;
      const { view } = call;
      const before = await draftOf(call);
      if (noDraft(before)) return before;
      if (!before.stored) return view.refuse(WORLD_NOTE.nothingToDiscard);
      // The draft is the one working copy Build edits too: the caller names the version it read, so it never drops what it hasn't seen.
      const version = intArg(args, "version");
      if (version === null) return missing(view, WORLD_TOOL.discard, "version");
      if (version !== before.version) return view.refuse(WORLD_NOTE.draftMoved, { given: String(version), version: String(before.version) });
      return propose(view, env.writer, { kind: "world", act: { do: "discard", version }, line: view.text(WORLD_NOTE.askDiscard, { version: String(version) }) });
    },
  },
  {
    name: WORLD_TOOL.commit,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ note: text(), version: integer({ minimum: 0 }) }),
    async run(args, env) {
      const call = await worldCall(env, true);
      if (refusedCall(call)) return call;
      const { view, build } = call;
      const before = await draftOf(call);
      if (noDraft(before)) return before;
      // With no draft the store would commit the head again, as Build never asks it to.
      if (!before.stored) return view.refuse(WORLD_NOTE.nothingToCommit);
      // The draft is Build's working copy too: a caller that names the version it read commits nothing written since, unseen.
      const version = intArg(args, "version");
      if (version !== null && version !== before.version) return view.refuse(WORLD_NOTE.draftMoved, { given: String(version), version: String(before.version) });
      const errors = before.lint.filter((i) => i.severity === "error");
      const note = textArg(args, "note");
      let detail: WorldActDetail;
      try {
        // A draft begun on an older head can't be committed, and the engine never rebases one: said now, with the way on.
        const head = await build.head();
        if (before.base !== null && before.base !== head) return view.refuse(WORLD_NOTE.staleDraft, { base: before.base });
        // What can't be committed is said now, never left for the commit or the review card's Apply to find.
        if (errors.length > 0) return storeRefusal(call, new WorldError("validation", view.text(WORLD_NOTE.hasErrors), errors));
        // What is closed to agents no agent commits either: a draft that differs from the head there holds the user's own edit of it, theirs to commit in Build.
        const headDoc = await build.revision(head);
        const closed = closedChanges(headDoc, before.draft);
        if (closed.length > 0) return view.refuse(WORLD_NOTE.closedCommit, { paths: closed.join(", ") });
        // Everything the commit would make part of the world, the user's own unsaved edits too: listed for the agent and for the review card.
        detail = changeDetail(call, { id: WORLD_NOTE.changesCommit }, headDoc, before.draft);
      } catch (error) {
        return storeRefusal(call, error);
      }
      // Pinned to the draft as it was read: what the card lists is what its Apply commits, and the store refuses the commit once the draft has moved on.
      return propose(view, env.writer, { kind: "world", act: { do: "commit", note, version: before.version }, line: view.text(note === null ? WORLD_NOTE.askCommit : WORLD_NOTE.askCommitNoted, { note: note ?? "" }), detail });
    },
  },
  {
    name: WORLD_TOOL.upgrade,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ to: text() }),
    async run(args, env) {
      const call = await worldCall(env, true);
      if (refusedCall(call)) return call;
      const { view, build } = call;
      const to = textArg(args, "to");
      let detail: WorldActDetail;
      try {
        // A revision the world doesn't have is said now, never left for the commit or the review card's Apply to find.
        if (to !== null && !(await build.history()).some((n) => n.revision === to)) throw new WorldError("not_found", view.text(WORLD_NOTE.noRevision, { revision: to }));
        // With no revision named the move is to the head as it is when the move is made: a commit asked before it, still waiting, comes first. With no draft stored there is no such commit to wait for.
        const draft = to === null ? await draftOf(call) : null;
        const waiting = draft !== null && !noDraft(draft) && draft.stored ? draft.draft : null;
        const target = to ?? (await build.head());
        if (target === view.state.revision && waiting === null) return view.answer({ playing: target, unchanged: view.text(WORLD_NOTE.alreadyPlays, { revision: target }) });
        // What the move would bring into play: the revision named; else the draft a waiting commit makes the head; else the head.
        const playing = await build.revision(view.state.revision);
        const next = waiting ?? (await build.revision(target));
        // What is closed to agents no agent brings into play either: a revision that differs there from the one played is the user's to bring the chat to, in Build.
        const closed = closedChanges(playing, next);
        if (closed.length > 0) return view.refuse(WORLD_NOTE.closedUpgrade, { revision: target, paths: closed.join(", ") });
        detail = changeDetail(call, { id: WORLD_NOTE.changesUpgrade, vars: { playing: view.state.revision } }, playing, next);
      } catch (error) {
        const refused = storeRefusal(call, error);
        return error instanceof WorldError && error.code === "not_found" ? hinted(refused, view.text(WORLD_NOTE.revisionHint)) : refused;
      }
      return propose(view, env.writer, { kind: "world", act: { do: "upgrade", to }, line: to === null ? view.text(WORLD_NOTE.askUpgradeHead) : view.text(WORLD_NOTE.askUpgrade, { revision: to }), detail });
    },
  },
  {
    name: WORLD_TOOL.history,
    family: HARNESS_FAMILY.world,
    tier: "read",
    parameters: () => objectSchema({ limit: integer({ minimum: 1 }) }),
    async run(args, env) {
      const call = await worldCall(env, false);
      if (refusedCall(call)) return call;
      const { view, turn, build } = call;
      let notes: RevisionNote[];
      let head: string;
      try {
        notes = await build.history();
        head = await build.head();
      } catch (error) {
        return storeRefusal(call, error);
      }
      const playing = view.state.revision;
      const room = Math.floor(turn.settings.agents.clipChars / 2);
      const limit = intArg(args, "limit");
      const revisions: JsonObject[] = [];
      let used = 0;
      // Newest first: the head and what led to it are what a restore or an Upgrade is chosen from.
      for (const n of [...notes].reverse()) {
        const row: JsonObject = { revision: n.revision, at: new Date(n.at).toISOString(), by: n.source, ...(n.note !== undefined ? { note: n.note } : {}), ...(n.revision === head ? { head: true } : {}), ...(n.revision === playing ? { playing: true } : {}) };
        used += JSON.stringify(row).length + 1;
        if ((used > room && revisions.length > 0) || (limit !== null && revisions.length >= limit)) break;
        revisions.push(row);
      }
      return view.answer({ head, playing, revisions, ...(revisions.length < notes.length ? { more: notes.length - revisions.length } : {}) });
    },
  },
  {
    name: WORLD_TOOL.restore,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ revision: text() }, ["revision"]),
    async run(args, env) {
      const call = await worldCall(env, true);
      if (refusedCall(call)) return call;
      const { view, build } = call;
      const revision = needText(view, WORLD_TOOL.restore, args, "revision");
      if (typeof revision !== "string") return revision;
      const before = await draftOf(call);
      if (noDraft(before)) return before;
      let detail: WorldActDetail;
      try {
        if (!(await build.history()).some((n) => n.revision === revision)) throw new WorldError("not_found", view.text(WORLD_NOTE.noRevision, { revision }));
        const copy = await build.revision(revision);
        // What is closed to agents no agent restores either: a revision that differs there from the draft is the user's to restore, in Build.
        const closed = closedChanges(before.draft, copy);
        if (closed.length > 0) return view.refuse(WORLD_NOTE.closedRestore, { revision, paths: closed.join(", ") });
        detail = changeDetail(call, { id: WORLD_NOTE.changesRestore }, await build.revision(await build.head()), copy);
      } catch (error) {
        return hinted(storeRefusal(call, error), view.text(WORLD_NOTE.revisionHint));
      }
      // Pinned to the draft as it was read, so a restore replaces no draft its caller hasn't seen.
      return propose(view, env.writer, { kind: "world", act: { do: "restore", revision, version: before.version }, line: view.text(WORLD_NOTE.askRestore, { revision }), detail });
    },
  },
  {
    name: WORLD_TOOL.made,
    family: HARNESS_FAMILY.world,
    tier: "read",
    parameters: () => objectSchema({ kind: text(MADE_KINDS) }),
    async run(args, env) {
      const call = await worldCall(env, false);
      if (refusedCall(call)) return call;
      const { view } = call;
      const draft = await draftOf(call);
      if (noDraft(draft)) return draft;
      const made = madeInPlay(view.ctx, draft.draft);
      const kind = textArg(args, "kind");
      if (kind !== null && !MADE_KINDS.includes(kind)) return badValue(view, WORLD_TOOL.made, "kind", kind, MADE_KINDS);
      const base = baseWorld(view.ctx.world);
      const world = chatChanges(view).map((c) => changeRow(view, base, draft.draft, c));
      if (made.things.length === 0 && made.places.length === 0 && world.length === 0) return view.answer({ things: [], places: [], world: [], note: view.text(WORLD_NOTE.nothingMade) });
      // Where each is, outermost first, by the names the game master reads.
      return view.answer({
        ...(kind === null || kind === "things" ? { things: made.things.map((t) => ({ id: t.id, name: t.name, where: t.where.map((s) => s.name).join(" › "), ...(t.inDraft ? { inDraft: true } : {}) })) } : {}),
        ...(kind === null || kind === "places" ? { places: made.places.map((p) => ({ id: p.id, name: p.name, in: p.path.map((s) => s.name).join(" › "), as: p.as, ...(p.inDraft ? { inDraft: true } : {}) })) } : {}),
        ...(kind === null || kind === "world" ? { world } : {}),
        next: view.text(WORLD_NOTE.madeNext),
      });
    },
  },
  {
    name: WORLD_TOOL.keep,
    family: HARNESS_FAMILY.world,
    tier: "write",
    parameters: () => objectSchema({ things: words(), places: words(), paths: words(), maps: words(), settings: { type: "boolean" } }),
    async run(args, env) {
      const call = await worldCall(env, true);
      if (refusedCall(call)) return call;
      const { view } = call;
      const draft = await draftOf(call);
      if (noDraft(draft)) return draft;
      const made = madeInPlay(view.ctx, draft.draft);
      // A name is read as the one thing or place made in play that bears it; anything else goes on as it was given, and Keep in the world says why it skips it.
      const idOf = (said: string, among: readonly { id: string; name: string }[]): string => {
        if (among.some((m) => m.id === said)) return said;
        const bearing = among.filter((m) => m.name.trim().toLowerCase() === said.toLowerCase());
        return bearing.length === 1 ? (bearing[0]?.id ?? said) : said;
      };
      const base = baseWorld(view.ctx.world);
      const changes = chatChanges(view);
      const things = (wordsArg(args, "things") ?? []).map((said) => idOf(said, made.things));
      const placesSaid = wordsArg(args, "places") ?? [];
      const pathsSaid = wordsArg(args, "paths") ?? [];
      const mapsSaid = wordsArg(args, "maps") ?? [];
      const settings = boolArg(args, "settings") === true;
      if (things.length === 0 && placesSaid.length === 0 && pathsSaid.length === 0 && mapsSaid.length === 0 && !settings) return view.refuse(WORLD_NOTE.keepNames);
      const skipped: { id: string; reason: string }[] = [];
      const chosen: DraftEdit[] = [];
      // A place this chat changed of the world's own is found by its id or its name; any other goes on to Keep in the world, as one made in play.
      const madePlaces: string[] = [];
      for (const said of placesSaid) {
        const c = changeNamed(changes, "places", said, (v) => (typeof v?.name === "string" ? v.name : null), base);
        if (c) chosen.push(c);
        else madePlaces.push(idOf(said, made.places));
      }
      for (const [collection, saids] of [["routes", pathsSaid], ["maps", mapsSaid]] as const) {
        for (const said of saids) {
          const c = changeNamed(changes, collection, said, (v) => (typeof v?.title === "string" ? v.title : null), base);
          if (c) chosen.push(c);
          else skipped.push({ id: said, reason: view.text(WORLD_NOTE.notChanged) });
        }
      }
      if (settings) {
        const c = changes.find((one) => "part" in one);
        if (c) chosen.push(c);
        else skipped.push({ id: "settings", reason: view.text(WORLD_NOTE.notChanged) });
      }
      const { ops, result } = keepInWorld(view.ctx, draft.draft, things, madePlaces);
      skipped.unshift(...result.skipped);
      // Each of this chat's changes is written into the draft as this chat has it: the item whole, or taken out.
      const kept: Record<"places" | "paths" | "maps", string[]> & { settings?: true } = { places: [], paths: [], maps: [] };
      const doc = draft.draft as unknown as JsonValue;
      const written = new Set<string>();
      for (const c of chosen) {
        const steps = "part" in c ? [c.part] : [c.collection, c.id];
        const path = pointerOf(steps);
        if (written.has(path)) continue;
        written.add(path);
        const held = getAt(doc, steps);
        const id = "part" in c ? "settings" : c.id;
        if ("value" in c ? jsonEqual(held, c.value) : held === undefined) {
          skipped.push({ id, reason: view.text(WORLD_NOTE.inDraftAlready) });
          continue;
        }
        ops.push("value" in c ? { op: "add", path, value: c.value } : { op: "remove", path });
        if ("part" in c) kept.settings = true;
        else kept[c.collection === "routes" ? "paths" : c.collection].push(c.id);
      }
      if (ops.length === 0) return view.refuse(WORLD_NOTE.keptNothing, { skipped: skipped.map((s) => `- ${s.id}: ${s.reason}`).join("\n") });
      const count = result.things.length + result.places.length + kept.places.length + kept.paths.length + kept.maps.length + (kept.settings ? 1 : 0);
      return writeDraft(call, { op: "patch", ops }, view.text(WORLD_NOTE.kept, { count: String(count) }), {
        before: draft,
        extra: { kept: { things: result.things, places: [...result.places, ...kept.places], ...(kept.paths.length > 0 ? { paths: kept.paths } : {}), ...(kept.maps.length > 0 ? { maps: kept.maps } : {}), ...(kept.settings ? { settings: true } : {}) }, ...(skipped.length > 0 ? { skipped } : {}), ...(result.notes.length > 0 ? { notes: result.notes } : {}) },
      });
    },
  },
];

/**
 * The one of this chat's changes to `collection` that `said` names: by its id, else by its name
 * (a place's) or title (a map's), as this chat has it or, for one taken out, as the revision it plays
 * has it, case and spaces aside. Null where none, or more than one, bears it.
 */
function changeNamed(changes: readonly DraftEdit[], collection: DraftCollection, said: string, nameOf: (v: Readonly<Record<string, unknown>> | undefined) => string | null, base: WorldDoc): (DraftEdit & { collection: DraftCollection; id: string }) | null {
  const among = changes.filter((c): c is DraftEdit & { collection: DraftCollection; id: string } => "collection" in c && c.collection === collection);
  const byId = among.find((c) => c.id === said);
  if (byId) return byId;
  const key = said.trim().replace(/\s+/g, " ").toLowerCase();
  const bearing = among.filter((c) => {
    const v = "value" in c ? c.value : (getAt(base as unknown as JsonValue, [c.collection, c.id]) as Readonly<Record<string, unknown>> | undefined);
    return nameOf(v)?.trim().replace(/\s+/g, " ").toLowerCase() === key;
  });
  return bearing.length === 1 ? (bearing[0] ?? null) : null;
}

/**
 * One of this chat's changes to its world as `world_made` lists it: what it is, by the names the
 * game master reads; whether it was made, changed or removed over the revision this chat plays
 * (`base`); and whether the world's draft has it so already.
 */
function changeRow(view: ToolReadView, base: WorldDoc, draft: WorldDoc, c: DraftEdit): JsonObject {
  const steps = "part" in c ? [c.part] : [c.collection, c.id];
  const held = getAt(base as unknown as JsonValue, steps);
  const value = "value" in c ? c.value : undefined;
  const change = value === undefined ? "removed" : held === undefined ? "made" : "changed";
  const inDraft = value === undefined ? getAt(draft as unknown as JsonValue, steps) === undefined : jsonEqual(getAt(draft as unknown as JsonValue, steps), value);
  const shown = (value ?? (isRecord(held) ? held : {})) as JsonObject;
  const place = (id: unknown): string => (typeof id === "string" ? (view.world.places[id]?.name ?? base.places[id]?.name ?? id) : "");
  const what: JsonObject =
    "part" in c
      ? { part: c.part }
      : c.collection === "routes"
        ? { path: c.id, from: place(shown.from), to: place(shown.to) }
        : c.collection === "maps"
          ? { map: c.id, ...(typeof shown.title === "string" ? { title: shown.title } : {}) }
          : { place: c.id, name: typeof shown.name === "string" ? shown.name : c.id };
  return { ...what, change, ...(inDraft ? { inDraft: true } : {}) };
}

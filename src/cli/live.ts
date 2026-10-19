// The tools that manage worlds on the user's Lumiverse through LumiRPEngine (DESIGN §23): read,
// search, create, import, edit the draft, commit, discard, restore, delete, export, and the chats
// that play them. The draft is the one Build edits, so an agent's edit shows in the user's Build
// and the user's edits reach the agent the same way; every write names the draft version it read,
// so neither overwrites the other unseen.

import type { JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { JsonPatchOp, MarkerPreview, ResultBodies, WorldChatInfo } from "../shared/protocol";
import type { WorldDoc, WorldIndex } from "../shared/world";
import type { Args } from "./args";
import { boolArg, intArg, neededText, textArg, textsArg, ToolError } from "./args";
import type { Connection } from "./connection";
import { LreError } from "./connection";
import { changesBetween, countsOf, fieldChanges } from "./diff";
import type { Change, FieldChange } from "./diff";
import { loadWorld, worldInput } from "./offline";
import { getAt, jsonEqual, parsePointer } from "../shared/json-patch";
import { BODY_LIMIT, clip, jsonText, readAt } from "./read";
import type { ToolResult } from "./report";
import { contentsOf, json, lintSummary, newHazards, schemaIssues } from "./report";
import { rank, searchDoc, searchWords } from "./search";
import type { ScoredHit } from "./search";

export type EditorBody = ResultBodies["lre.editor"];

/** Revisions kept in memory: each is a whole world, and a revision never changes. */
const REVISION_CACHE = 24;
const MAX_OFFSET = Number.MAX_SAFE_INTEGER;

/** A world as a tool reads it: its head, its draft or one revision. */
export interface Source {
  world: WorldDoc;
  index: WorldIndex;
  /** How the answer names it. */
  label: string;
}

/** The worlds on the signed-in Lumiverse, over one connection, with the revisions read so far. */
export class Live {
  private readonly revisions = new Map<string, WorldDoc>();

  constructor(readonly conn: Connection) {}

  async list(): Promise<WorldIndex[]> {
    return (await this.conn.request("lre.world", { op: "list" })).worlds ?? [];
  }

  async index(worldId: string): Promise<WorldIndex> {
    const worlds = await this.list();
    const found = worlds.find((w) => w.id === worldId);
    if (found) return found;
    throw new ToolError(worlds.length === 0 ? `There is no world ${worldId}: you have no worlds yet (lre_world_create makes one).` : `There is no world ${worldId}. Your worlds: ${clip(worlds.map((w) => `${w.id} (${w.name})`).join(", "), 3000)}.`);
  }

  /** One revision's document, fetched once per process. */
  async revision(worldId: string, revision: string): Promise<WorldDoc> {
    const key = `${worldId}\u0000${revision}`;
    const cached = this.revisions.get(key);
    if (cached) {
      this.revisions.delete(key);
      this.revisions.set(key, cached);
      return cached;
    }
    const body = await this.conn.request("lre.world", { op: "get", worldId, revision });
    if (!body.world) throw new ToolError(`LumiRPEngine sent no document for revision ${revision} of ${worldId}.`);
    this.revisions.set(key, body.world);
    for (const oldest of this.revisions.keys()) {
      if (this.revisions.size <= REVISION_CACHE) break;
      this.revisions.delete(oldest);
    }
    return body.world;
  }

  /** The draft as Build has it: the stored one, else a copy of the head (`stored: false`, version 0). */
  draft(worldId: string): Promise<EditorBody> {
    return this.conn.request("lre.editor", { op: "get", worldId, base: null });
  }

  async exportFile(worldId: string, revision?: string): Promise<JsonValue> {
    const body = await this.conn.request("lre.world", revision === undefined ? { op: "export", worldId } : { op: "export", worldId, revision });
    if (body.file === undefined) throw new ToolError(`LumiRPEngine sent no export file for ${worldId}.`);
    return body.file;
  }

  /** "head", "draft", or a revision id (a unique prefix of 6 or more characters will do). */
  async source(worldId: string, source: string): Promise<Source> {
    const index = await this.index(worldId);
    const world = `“${index.name}” (${worldId})`;
    if (source === "draft") {
      const draft = await this.draft(worldId);
      const label = draft.stored ? `the draft of ${world}, version ${draft.version}, begun from revision ${draft.base ?? "none"}` : `the draft of ${world}: none is stored, so this is its head, revision ${draft.base ?? index.head}`;
      return { world: draft.draft, index, label };
    }
    const revision = source === "head" ? index.head : resolveRevision(index, source);
    const label = revision === index.head ? `the head of ${world}, revision ${revision}` : `revision ${revision} of ${world}`;
    return { world: await this.revision(worldId, revision), index, label };
  }
}

/** A revision of the world by its id or a unique prefix of it. */
export function resolveRevision(index: WorldIndex, given: string): string {
  if (index.revisions.includes(given)) return given;
  const matches = given.length >= 6 ? index.revisions.filter((r) => r.startsWith(given)) : [];
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) return only;
  if (matches.length > 1) throw new ToolError(`${given} begins ${matches.length} revisions of “${index.name}”: give more of it.`);
  throw new ToolError(`“${index.name}” (${index.id}) has no revision ${given}. Give "head", "draft", or one of its revisions (oldest first): ${clip(index.revisions.join(", "), 3000)}.`);
}

const worldIdOf = (args: Args): string => neededText(args, "worldId", "the world's id (lre_worlds lists them)");

export async function worldsTool(live: Live): Promise<ToolResult> {
  const worlds = await live.list();
  const drafts = await Promise.all(
    worlds.map((w) =>
      live.draft(w.id).then(
        (d) => ({ stored: d.stored, version: d.version }),
        (error: unknown) => ({ unknown: error instanceof Error ? error.message : String(error) }),
      ),
    ),
  );
  return { text: json({ worlds: worlds.map((w, i) => ({ id: w.id, name: w.name, head: w.head, revisions: w.revisions.length, history: w.history?.length ?? 0, draft: drafts[i] })) }) };
}

export async function worldTool(live: Live, args: Args): Promise<ToolResult> {
  const source = await live.source(worldIdOf(args), textArg(args, "source") ?? "draft");
  const read = readAt(source.world, { what: source.label, pointer: textArg(args, "pointer") ?? "", offset: intArg(args, "offset", 0, MAX_OFFSET) });
  return read.ok ? { text: read.text } : { text: read.text, isError: true };
}

/** The item a search hit or a diff names: `/<collection>/<id>`, or the part itself when `id` is empty. */
function itemOf(doc: unknown, collection: string, id: string): unknown {
  const part = isRecord(doc) && hasOwn(doc, collection) ? doc[collection] : undefined;
  if (id === "") return part;
  return isRecord(part) && hasOwn(part, id) ? part[id] : undefined;
}

export async function searchTool(live: Live, args: Args): Promise<ToolResult> {
  const query = neededText(args, "query", "words to look for");
  const words = searchWords(query);
  const limit = intArg(args, "limit", 1, 100) ?? 20;
  const named = textsArg(args, "collections");
  const collections = named === undefined ? null : new Set(named);
  const worldId = textArg(args, "worldId");
  const worlds = worldId === undefined ? await live.list() : [await live.index(worldId)];
  const found = await Promise.all(
    worlds.map(async (w): Promise<{ hits: ScoredHit[]; draft: boolean }> => {
      const draft = await live.draft(w.id);
      // An unstored draft is a copy of the head: one search covers both.
      if (!draft.stored) return { hits: searchDoc(draft.draft, words, { worldId: w.id, source: "head", collections }), draft: false };
      const head = await live.revision(w.id, w.head);
      const inDraft = searchDoc(draft.draft, words, { worldId: w.id, source: "draft", collections });
      // The head adds only what the draft changed or dropped; an item both hold alike is the draft's hit.
      const inHead = searchDoc(head, words, { worldId: w.id, source: "head", collections, skip: (collection, id, item) => jsonEqual(item, itemOf(draft.draft, collection, id)) });
      return { hits: [...inDraft, ...inHead], draft: true };
    }),
  );
  const all = found.flatMap((f) => f.hits);
  return { text: json({ query, hits: rank(all, limit), total: all.length, searched: { worlds: worlds.length, drafts: found.filter((f) => f.draft).length } }) };
}

export async function createTool(live: Live, args: Args): Promise<ToolResult> {
  const name = neededText(args, "name", "the new world's name");
  const template = textArg(args, "template");
  let body: ResultBodies["lre.world"];
  try {
    body = await live.conn.request("lre.world", { op: "create", name, template: template ?? null });
  } catch (error) {
    if (!(error instanceof LreError && error.code === "not_found" && template !== undefined)) throw error;
    const offered = (await live.conn.request("lre.world", { op: "templates" })).templates ?? [];
    throw new ToolError(`There is no starter "${template}" on your Lumiverse. Its starters: ${offered.map((t) => `${t.id} (${t.name})`).join(", ") || "none"}.`);
  }
  const world = body.world;
  if (!world) throw new ToolError("LumiRPEngine created the world but sent no document back; lre_worlds lists it.");
  return { text: json({ worldId: world.id, name: world.name, revision: body.revision ?? null, template: template ?? null, contents: contentsOf(world), next: "Read it with lre_world, change it with lre_edit, then lre_commit with a note." }) };
}

export async function importTool(live: Live, args: Args, readFile: (path: string) => string): Promise<ToolResult> {
  const input = worldInput(args, readFile);
  if (input === null) throw new ToolError("Give the world file to import: path (a file), or world (inline).");
  // The shape is checked here, where the answer can say what is wrong; the host lints it again.
  const { result } = loadWorld(input.value);
  if (!result.ok) throw new ToolError(`Not imported: ${input.from} doesn't load as a world, so nothing was sent.\n${json(lintSummary(result.issues, 30))}`);
  const file = typeof input.value === "string" ? (JSON.parse(input.value) as JsonValue) : input.value;
  let body: ResultBodies["lre.world"];
  try {
    body = await live.conn.request("lre.world", { op: "import", file });
  } catch (error) {
    if (error instanceof LreError && error.code === "validation") throw new ToolError(`Not imported: LumiRPEngine found lint errors in it.\n${json(lintSummary(error.lint, 30))}`);
    throw error;
  }
  const world = body.world;
  if (!world) throw new ToolError("LumiRPEngine imported the world but sent no document back; lre_worlds lists it.");
  const review = body.lint ?? [];
  return { text: json({ worldId: world.id, name: world.name, revision: body.revision ?? null, contents: contentsOf(world), macroReview: review, ...(review.length > 0 ? { note: "Review each macro before playing the world: Lumiverse runs macros in lore and templates when it builds a prompt." } : {}) }) };
}

const PATCH_OPS: Record<JsonPatchOp["op"], true> = { add: true, remove: true, replace: true, move: true, copy: true, test: true };

/** The operations as sent, checked for shape so a malformed one is named before anything is sent. */
function patchOps(raw: unknown): JsonPatchOp[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new ToolError('Give ops: a list of JSON Patch operations, such as [{"op": "replace", "path": "/entities/mara/name", "value": "Mara Voss"}].');
  if (raw.length > 500) throw new ToolError(`That is ${raw.length} operations; send at most 500 at once.`);
  return raw.map((op, i): JsonPatchOp => {
    const where = `ops[${i}]`;
    if (!isRecord(op) || typeof op.op !== "string" || !hasOwn(PATCH_OPS, op.op)) throw new ToolError(`${where}: op is one of add, remove, replace, move, copy and test.`);
    if (typeof op.path !== "string") throw new ToolError(`${where}: path must be a JSON Pointer ("/entities/mara").`);
    const { path } = op;
    if (op.op === "remove") return { op: "remove", path };
    if (op.op === "move" || op.op === "copy") {
      if (typeof op.from !== "string") throw new ToolError(`${where}: ${op.op} needs from, a JSON Pointer.`);
      return { op: op.op, from: op.from, path };
    }
    if (op.value === undefined) throw new ToolError(`${where}: ${op.op} needs a value.`);
    return { op: op.op === "add" ? "add" : op.op === "replace" ? "replace" : "test", path, value: op.value as JsonValue };
  });
}

function stale(worldId: string, now: number, expected: number): ToolError {
  return new ToolError(`Nothing changed: the draft of ${worldId} is at version ${now}, not ${expected}. It was written since you read it (by the user in Build, or another agent). Read it again (lre_world or lre_draft) and redo the edit against version ${now}.`);
}

export type Serialize = <T>(key: string, run: () => Promise<T>) => Promise<T>;

export function editTool(live: Live, args: Args, serialize: Serialize): Promise<ToolResult> {
  const worldId = worldIdOf(args);
  const ops = patchOps(args.ops);
  const expected = intArg(args, "expectVersion", 0, MAX_OFFSET);
  return serialize(`world:${worldId}`, async () => {
    for (let attempt = 1; ; attempt++) {
      const before = await live.draft(worldId);
      if (expected !== undefined && before.version !== expected) throw stale(worldId, before.version, expected);
      let after: EditorBody;
      try {
        // The base and version read just now: a write in between (or a commit and a new draft) is refused, not overwritten.
        after = await live.conn.request("lre.editor", { op: "patch", worldId, base: before.base, version: before.version, ops });
      } catch (error) {
        if (!(error instanceof LreError)) throw error;
        // Without expectVersion the edit is meant for the draft as it is: read it again once and apply.
        if (error.code === "conflict" && expected === undefined && attempt === 1) continue;
        if (error.code === "conflict") throw stale(worldId, (await live.draft(worldId)).version, expected ?? before.version);
        if (error.code === "bad_request" || error.code === "validation") throw new ToolError(`Nothing changed: LumiRPEngine refused the patch. ${error.message}`);
        throw error;
      }
      const changes = changesBetween(before.draft, after.draft);
      return {
        text: json({
          worldId,
          version: after.version,
          base: after.base,
          changed: countsOf(changes),
          items: changes.slice(0, 40),
          moreItems: Math.max(0, changes.length - 40),
          lint: lintSummary(after.lint, 12),
          schema: lintSummary(schemaIssues(after.draft), 12),
          macroHazards: newHazards(before.draft, after.draft),
          ...(changes.length === 0 ? { note: "The patch applied, but the draft is the same as before." } : {}),
        }),
      };
    }
  });
}

export async function draftTool(live: Live, args: Args): Promise<ToolResult> {
  const worldId = worldIdOf(args);
  const [draft, index] = await Promise.all([live.draft(worldId), live.index(worldId)]);
  const lint = lintSummary(draft.lint, 12);
  if (!draft.stored) return { text: json({ worldId, name: index.name, stored: false, version: draft.version, base: draft.base, head: index.head, lint, note: "No draft is stored: the draft is the head. lre_edit starts one." }) };
  const changes = changesBetween(await live.revision(worldId, index.head), draft.draft);
  const headMoved = draft.base !== index.head;
  return {
    text: json({
      worldId,
      name: index.name,
      stored: true,
      version: draft.version,
      base: draft.base,
      head: index.head,
      headMoved,
      lint,
      changes: { counts: countsOf(changes), items: changes.slice(0, 60), more: Math.max(0, changes.length - 60) },
      ...(headMoved ? { note: "The head moved since this draft began, so LumiRPEngine will refuse to commit it. See the difference with lre_diff, then lre_discard and redo the changes on the new head." } : {}),
    }),
  };
}

export function commitTool(live: Live, args: Args, serialize: Serialize): Promise<ToolResult> {
  const worldId = worldIdOf(args);
  const note = textArg(args, "note")?.trim();
  if (note !== undefined && note.length > 200) throw new ToolError(`note is at most 200 characters; this one has ${note.length}.`);
  return serialize(`world:${worldId}`, async () => {
    const [draft, index] = await Promise.all([live.draft(worldId), live.index(worldId)]);
    if (!draft.stored) throw new ToolError(`There is no draft of “${index.name}” to commit: nothing has changed since its head. lre_edit writes one.`);
    let body: ResultBodies["lre.world"];
    try {
      body = await live.conn.request("lre.world", note ? { op: "commit", worldId, base: draft.base, note } : { op: "commit", worldId, base: draft.base });
    } catch (error) {
      if (error instanceof LreError && error.code === "validation") {
        const errors = (error.lint.length > 0 ? error.lint : draft.lint).filter((i) => i.severity === "error");
        throw new ToolError(`Not committed: the draft has ${errors.length} lint error${errors.length === 1 ? "" : "s"}, and LumiRPEngine commits none. Fix ${errors.length === 1 ? "it" : "them"} with lre_edit:\n${json(errors.slice(0, 30))}${errors.length > 30 ? `\n(${errors.length - 30} more)` : ""}`);
      }
      if (error instanceof LreError && error.code === "conflict") throw new ToolError(`Not committed: ${error.message}. The draft began from revision ${draft.base ?? "none"}, and the head is ${index.head}: the head moved since. See the difference with lre_diff, then lre_discard and redo the changes on the new head.`);
      throw error;
    }
    // Hazards against the head this commit replaced (revisions never change, so it can be read after).
    const previous = await live.revision(worldId, index.head).catch(() => null);
    const warnings = (body.lint ?? []).filter((i) => i.severity !== "error");
    return { text: json({ worldId, name: index.name, revision: body.revision ?? null, note: note ?? null, warnings: lintSummary(warnings, 12), macroHazards: newHazards(previous, draft.draft) }) };
  });
}

export function discardTool(live: Live, args: Args, serialize: Serialize): Promise<ToolResult> {
  const worldId = worldIdOf(args);
  return serialize(`world:${worldId}`, async () => {
    const [draft, index] = await Promise.all([live.draft(worldId), live.index(worldId)]);
    if (!draft.stored) return { text: json({ worldId, discarded: false, note: "No draft was stored; there was nothing to discard." }) };
    const dropped = changesBetween(await live.revision(worldId, index.head), draft.draft);
    try {
      const after = await live.conn.request("lre.editor", { op: "discard", worldId, base: null, version: draft.version });
      return { text: json({ worldId, discarded: true, version: after.version, dropped: countsOf(dropped) }) };
    } catch (error) {
      if (error instanceof LreError && error.code === "conflict") throw new ToolError(`Nothing discarded: the draft was written since it was read (version ${draft.version}). Look at it again with lre_draft.`);
      throw error;
    }
  });
}

export async function historyTool(live: Live, args: Args): Promise<ToolResult> {
  const index = await live.index(worldIdOf(args));
  const notes = index.history ?? [];
  const noted = new Set(notes.map((n) => n.revision));
  const unnoted = index.revisions.filter((r) => !noted.has(r));
  return {
    text: json({
      worldId: index.id,
      name: index.name,
      head: index.head,
      revisions: index.revisions.length,
      history: notes.map((n) => ({ revision: n.revision, at: new Date(n.at).toISOString(), source: n.source, ...(n.note ? { note: n.note } : {}), ...(n.revision === index.head ? { head: true } : {}) })),
      ...(unnoted.length > 0 ? { withoutNotes: unnoted, about: "These revisions became head before LumiRPEngine kept a history, so they have no notes." } : {}),
    }),
  };
}

export async function diffTool(live: Live, args: Args): Promise<ToolResult> {
  const worldId = worldIdOf(args);
  const [from, to] = await Promise.all([live.source(worldId, textArg(args, "from") ?? "head"), live.source(worldId, textArg(args, "to") ?? "draft")]);
  const changes = changesBetween(from.world, to.world);
  type Shown = Change & { fields?: FieldChange[]; moreFields?: number };
  const shown: Shown[] = [];
  let room = BODY_LIMIT - 2000;
  for (const change of changes) {
    const entry: Shown = { ...change };
    if (change.kind === "changed") {
      const tokens = parsePointer(change.key);
      // A world document is plain JSON; its interface just doesn't say so.
      const detail = fieldChanges(getAt(from.world as unknown as JsonValue, tokens), getAt(to.world as unknown as JsonValue, tokens), change.key, 12);
      entry.fields = detail.changes;
      if (detail.more > 0) entry.moreFields = detail.more;
    }
    room -= JSON.stringify(entry).length + 8;
    if (room < 0) break;
    shown.push(entry);
  }
  return { text: json({ worldId, from: from.label, to: to.label, counts: countsOf(changes), changes: shown, more: changes.length - shown.length }) };
}

export function restoreTool(live: Live, args: Args, serialize: Serialize): Promise<ToolResult> {
  const worldId = worldIdOf(args);
  const given = neededText(args, "revision", "the revision to restore (lre_history lists them)");
  return serialize(`world:${worldId}`, async () => {
    const index = await live.index(worldId);
    const revision = resolveRevision(index, given);
    const draft = await live.draft(worldId);
    let after: EditorBody;
    try {
      after = await live.conn.request("lre.editor", { op: "restore", worldId, base: null, version: draft.version, revision });
    } catch (error) {
      if (error instanceof LreError && error.code === "conflict") throw new ToolError(`Nothing restored: the draft was written while this ran (it was at version ${draft.version}). Look at it again with lre_draft.`);
      throw error;
    }
    return {
      text: json({
        worldId,
        restored: revision,
        version: after.version,
        replaced: draft.stored ? { version: draft.version } : null,
        lint: lintSummary(after.lint, 12),
        next: `The draft is now a copy of revision ${revision}. lre_commit (with a note) makes it the head; lre_discard drops it.`,
      }),
    };
  });
}

export function deleteTool(live: Live, args: Args, serialize: Serialize): Promise<ToolResult> {
  const worldId = worldIdOf(args);
  const confirm = textArg(args, "confirm");
  return serialize(`world:${worldId}`, async () => {
    const index = await live.index(worldId);
    if (confirm !== index.name) {
      const [chats, draft] = await Promise.all([live.conn.request("lre.world", { op: "chats", worldId }).then((b) => b.chats ?? []), live.draft(worldId)]);
      const parts = [`its ${index.revisions.length} revision${index.revisions.length === 1 ? "" : "s"}`, ...(draft.stored ? [`its stored draft (version ${draft.version})`] : []), ...((index.history?.length ?? 0) > 0 ? ["its history"] : [])];
      const playing = chats.length > 0 ? ` ${chats.length} chat${chats.length === 1 ? " plays" : "s play"} it (${clip(chats.map((c) => c.name).join(", "), 600)}) and would stop being world chats.` : " No chat plays it.";
      const why = confirm === undefined ? "confirm is missing" : `confirm ${JSON.stringify(confirm)} isn't the world's name`;
      throw new ToolError(`Not deleted: ${why}. Deleting “${index.name}” (${worldId}) removes ${parts.join(", ")}, for good.${playing} To delete it, call again with confirm set to its exact name: ${JSON.stringify(index.name)}.`);
    }
    const body = await live.conn.request("lre.world", { op: "delete", worldId });
    return { text: json({ deleted: worldId, name: index.name, worldsLeft: (body.worlds ?? []).length }) };
  });
}

export async function exportTool(live: Live, args: Args): Promise<ToolResult> {
  const worldId = worldIdOf(args);
  const index = await live.index(worldId);
  const given = textArg(args, "revision");
  const revision = given === undefined ? index.head : resolveRevision(index, given);
  const file = await live.exportFile(worldId, revision);
  const whole = jsonText(file, true).length <= BODY_LIMIT;
  const read = readAt(file, { what: `the export file of “${index.name}” (${worldId}), revision ${revision}`, offset: intArg(args, "offset", 0, MAX_OFFSET) ?? (whole ? undefined : 0), compact: true });
  if (!read.ok) return { text: read.text, isError: true };
  return { text: whole ? read.text : `${read.text}\n\nThe pages together, in order, are the file. To save it in one go: lumirpengine export ${worldId} --out <file>` };
}

export async function chatsTool(live: Live, args: Args): Promise<ToolResult> {
  const worldId = textArg(args, "worldId");
  const body = await live.conn.request("lre.world", worldId === undefined ? { op: "chats" } : { op: "chats", worldId });
  return { text: json({ chats: body.chats ?? [] }) };
}

export function attachTool(live: Live, args: Args, serialize: Serialize): Promise<ToolResult> {
  const worldId = worldIdOf(args);
  const chatId = neededText(args, "chatId", "the chat's id");
  return serialize(`chat:${chatId}`, async () => {
    const index = await live.index(worldId);
    try {
      const body = await live.conn.request("lre.world", { op: "attach", worldId, chatId });
      return { text: json({ chatId, worldId, name: index.name, revision: body.revision ?? index.head, note: "The chat plays the world from this revision; lre_upgrade moves it to a later one." }) };
    } catch (error) {
      if (error instanceof LreError && (error.code === "conflict" || error.code === "not_found")) throw new ToolError(`Not attached: ${error.message}`);
      throw error;
    }
  });
}

/** An Upgrade preview as the answer shows it: anything the player can't see yet stays hidden unless spoilers are asked for. */
function previewOf(preview: MarkerPreview | undefined, spoilers: boolean): { report: JsonValue; hidden: number } {
  let hidden = 0;
  const up = preview?.upgrade;
  const entities = (up?.entities ?? []).map((row): JsonValue => {
    if (row.secret === true && !spoilers) {
      hidden++;
      return { hidden: "A hidden change", status: row.status, changes: row.changes.length };
    }
    return {
      entity: row.entity,
      name: row.name,
      kind: row.kind,
      status: row.status,
      changes: row.changes.map((c): JsonValue => {
        if (c.secret === true && !spoilers) {
          hidden++;
          return { hidden: "A hidden change", why: c.why, pick: c.pick };
        }
        return { id: c.id, label: c.label, from: c.from, to: c.to, why: c.why, pick: c.pick, options: c.options };
      }),
    };
  });
  const tracks = (up?.tracks ?? []).map((t): string => {
    if (t.secret !== true || spoilers) return t.text;
    hidden++;
    return "A hidden change";
  });
  return { report: { lines: (preview?.lines ?? []).map((l) => l.text), entities, tracks }, hidden };
}

export async function upgradeTool(live: Live, args: Args, serialize: Serialize): Promise<ToolResult> {
  const chatId = neededText(args, "chatId", "the chat's id (lre_chats lists the chats that play a world)");
  const preview = boolArg(args, "preview");
  const spoilers = boolArg(args, "spoilers");
  const toArg = textArg(args, "to");
  const chats: WorldChatInfo[] = (await live.conn.request("lre.world", { op: "chats" })).chats ?? [];
  const chat = chats.find((c) => c.chatId === chatId);
  if (!chat) throw new ToolError(`No chat ${chatId} plays a world. lre_chats lists the chats that do.`);
  const index = await live.index(chat.worldId);
  const to = toArg === undefined ? index.head : resolveRevision(index, toArg);
  // A chat on the head can still lag behind it (an earlier Upgrade that moved it without the changes), so only the preview can say there is nothing to bring in.
  if (to === chat.revision && !preview) {
    const pending = (await live.conn.request("lre.marker", { chatId, kind: "migrate", to, preview: true })).preview?.upgrade;
    if (!pending || (pending.entities.length === 0 && pending.tracks.length === 0)) return { text: json({ chatId, worldId: chat.worldId, revision: to, note: "The chat already plays that revision, with all of its changes: there is nothing to upgrade." }) };
  }
  if (preview) {
    const body = await live.conn.request("lre.marker", { chatId, kind: "migrate", to, preview: true });
    const { report, hidden } = previewOf(body.preview, spoilers);
    return { text: json({ chatId, worldId: chat.worldId, from: chat.revision, to, preview: report, ...(hidden > 0 ? { hidden, about: `${hidden} change${hidden === 1 ? " is" : "s are"} about what the player hasn't found yet; spoilers: true shows ${hidden === 1 ? "it" : "them"}.` } : {}) }) };
  }
  return serialize(`chat:${chatId}`, async () => {
    // Default picks: an empty `merge` brings the definition changes in, taking what play never touched and keeping what it did.
    const body = await live.conn.request("lre.world", { op: "upgrade", chatId, to, merge: {} });
    return { text: json({ chatId, worldId: chat.worldId, from: chat.revision, revision: body.revision ?? to, picks: "the defaults: what play never touched comes from the new revision; what play changed stays as played" }) };
  });
}

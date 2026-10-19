// World storage and revisions (DESIGN §4.1, ARCHITECTURE §3.1).
//
//   userStorage/worlds/<worldId>/index.json      WorldIndex
//   userStorage/worlds/<worldId>/rev/<rev>.json  one immutable document per revision (rev = hashJson)
//   userStorage/worlds/<worldId>/draft.json      the editors' working copy: { base, doc, version }
//
// Writes go temp-then-move. Revisions read are cached in a bounded LRU; an open chat also pins the
// revisions its ledger references, so the ledger's synchronous `worlds(revision)` lookup never misses.
// Requests are handled concurrently, so every write of one world (its draft, a commit, an install,
// its index, its deletion) waits for the one before it (DESIGN §23): two writers that read the same
// draft would otherwise each write it back without the other's change.

import { hashJson } from "../shared/hash";
import type { RevisionId, UserId, WorldId } from "../shared/ids";
import { pathSafe } from "../shared/ids";
import type { ChatRun } from "../shared/ledger";
import type { JsonValue } from "../shared/json";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import { applyPatch, isPrototypeKey, jsonEqual, parsePointer, PatchError, readOp } from "../shared/json-patch";
import type { EditorRequest, JsonPatchOp, LintIssue, ResultBodies, WorldCollection, WorldPart } from "../shared/protocol";
import type { RevisionNote, RulesetDef, WorldDoc, WorldIndex } from "../shared/world";
import { DEFAULT_SPAWN_CAP, EXPORT_FORMAT, WORLD_FORMAT } from "../shared/world";
import { blankWorld, currencyOf, isWorldDoc, lintWorld, macrosIn, migrateWorld, shapeIssues, stamped } from "../engine/authoring";
import { compileMaps, mapSettingsOf } from "../shared/maps";
import type { Registry } from "../engine/registry-impl";
import type { HostPort } from "./host";
import { applyProfile, profileChoices, profileOf } from "../shared/profiles/index";

interface Draft {
  base: RevisionId | null;
  doc: WorldDoc;
  /** Writes since the draft began; 0 while none is stored. */
  version: number;
}

/** An editor operation's answer: the draft as it stands after it. */
export type EditorResult = ResultBodies["lre.editor"];

/** What made a revision the head, as the world's history keeps it. */
export type HeadSource = RevisionNote["source"];

const HEAD_SOURCES: Record<HeadSource, true> = { create: true, build: true, agent: true, import: true, studio: true };

/** The most operations one patch may carry. */
export const PATCH_OPS_CAP = 500;

/** The longest commit note the history keeps, in characters. */
export const NOTE_CAP = 200;

/**
 * What a patch may not change: the world's identity and format, the engine version that wrote it,
 * the pins (the store keeps the table pins itself) and the suppressed sources.
 */
const PATCH_PROTECTED = ["id", "format", "engineVersion", "pins", "suppressed"] as const;

export class WorldError extends Error {
  constructor(
    readonly code: "not_found" | "conflict" | "validation" | "bad_request",
    message: string,
    readonly lint: LintIssue[] = [],
  ) {
    super(message);
    this.name = "WorldError";
  }
}

/** A world's storage directory; ids that could escape it are refused. */
function worldDir(worldId: WorldId): string {
  if (!pathSafe(worldId)) throw new WorldError("bad_request", "invalid world id");
  return `worlds/${worldId}/`;
}

function revisionFile(worldId: WorldId, revision: RevisionId): string {
  if (!pathSafe(revision)) throw new WorldError("bad_request", "invalid revision");
  return `${worldDir(worldId)}rev/${revision}.json`;
}

/** Every world collection the editors write (a stored or requested name is checked against it). */
export const WORLD_COLLECTIONS: Record<WorldCollection, true> = {
  kinds: true,
  relations: true,
  entities: true,
  places: true,
  routes: true,
  grids: true,
  maps: true,
  rules: true,
  actions: true,
  checks: true,
  schedules: true,
  tracks: true,
  tables: true,
  sections: true,
  steps: true,
  packs: true,
  lore: true,
  classifications: true,
};

/** Loaded revisions kept across chats; an open chat pins the ones its ledger references, so eviction never breaks a fold. */
const REVISION_CACHE_CAP = 128;

export class WorldStore {
  /**
   * Loaded revisions by `user \0 world \0 revision` (a bare revision key would let one
   * user's request read another's cached world). Least recently used first; an entry is never replaced.
   */
  private readonly revisions = new Map<string, WorldDoc>();
  /** Told once a world's revisions change (a commit, an import, a deletion), so the Studio bridge publishes them (DESIGN §15). */
  onChange: ((worldId: WorldId, userId: UserId) => Promise<void>) | null = null;
  /** Each world's writes in turn, by `user \0 world`: the settling of the last one queued. */
  private readonly writes = new Map<string, Promise<void>>();

  constructor(
    private readonly host: HostPort,
    private readonly registry: Registry,
  ) {}

  private async readJson(path: string, userId: UserId): Promise<unknown> {
    const text = await this.host.storage.read(path, userId);
    return text === null ? null : (JSON.parse(text) as unknown);
  }

  private async writeJson(path: string, value: unknown, userId: UserId): Promise<void> {
    await this.host.storage.write(`${path}.tmp`, JSON.stringify(value), userId);
    await this.host.storage.move(`${path}.tmp`, path, userId);
  }

  /** Runs `work` once the world's earlier writes have settled, whatever became of them. */
  private async serial<T>(userId: UserId, worldId: WorldId, work: () => Promise<T>): Promise<T> {
    const key = `${userId}\u0000${worldId}`;
    const run = (this.writes.get(key) ?? Promise.resolve()).then(work);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.writes.set(key, settled);
    try {
      return await run;
    } finally {
      if (this.writes.get(key) === settled) this.writes.delete(key);
    }
  }

  private static key(userId: UserId, worldId: WorldId, revision: RevisionId): string {
    return `${userId}\u0000${worldId}\u0000${revision}`;
  }

  private remember(key: string, doc: WorldDoc): void {
    if (this.revisions.has(key)) return;
    this.revisions.set(key, doc);
    while (this.revisions.size > REVISION_CACHE_CAP) {
      const oldest = this.revisions.keys().next();
      if (oldest.done) break;
      this.revisions.delete(oldest.value);
    }
  }

  /** The user's cached revision of the world, if loaded. */
  cached(userId: UserId, worldId: WorldId, revision: RevisionId): WorldDoc | undefined {
    const key = WorldStore.key(userId, worldId, revision);
    const doc = this.revisions.get(key);
    if (doc) {
      this.revisions.delete(key);
      this.revisions.set(key, doc);
    }
    return doc;
  }

  async index(worldId: WorldId, userId: UserId): Promise<WorldIndex | null> {
    const raw = await this.readJson(`${worldDir(worldId)}index.json`, userId);
    if (!isRecord(raw) || typeof raw.head !== "string") return null;
    const history = Array.isArray(raw.history) ? raw.history.filter(isRevisionNote) : null;
    return {
      id: worldId,
      name: typeof raw.name === "string" ? raw.name : worldId,
      head: raw.head,
      loreBookId: typeof raw.loreBookId === "string" ? raw.loreBookId : null,
      revisions: Array.isArray(raw.revisions) ? raw.revisions.filter((r): r is string => typeof r === "string") : [raw.head],
      ...(history ? { history } : {}),
    };
  }

  async list(userId: UserId): Promise<WorldIndex[]> {
    const ids = new Set<string>();
    for (const path of await this.host.storage.list("worlds/", userId)) {
      const match = /^worlds\/([^/]+)\/index\.json$/.exec(path);
      if (match?.[1]) ids.add(match[1]);
    }
    const out: WorldIndex[] = [];
    for (const id of ids) {
      const index = await this.index(id, userId);
      if (index) out.push(index);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async revision(worldId: WorldId, revision: RevisionId, userId: UserId): Promise<WorldDoc> {
    const known = this.cached(userId, worldId, revision);
    if (known) return known;
    const raw = await this.readJson(revisionFile(worldId, revision), userId);
    if (!isWorldDoc(raw)) throw new WorldError("not_found", `revision ${revision} of ${worldId} not found`);
    const doc = migrateWorld(raw);
    this.remember(WorldStore.key(userId, worldId, revision), doc);
    return doc;
  }

  /** A revision the world's index lists (its head by default); any other is not found. */
  async get(worldId: WorldId, userId: UserId, revision?: RevisionId): Promise<{ world: WorldDoc; revision: RevisionId }> {
    const index = await this.index(worldId, userId);
    if (!index) throw new WorldError("not_found", `world ${worldId} not found`);
    const rev = revision ?? index.head;
    if (!index.revisions.includes(rev)) throw new WorldError("not_found", `revision ${rev} of ${worldId} not found`);
    return { world: await this.revision(worldId, rev, userId), revision: rev };
  }

  /** Whether `revision` is one of this world's revisions (an Upgrade target). */
  async hasRevision(worldId: WorldId, revision: RevisionId, userId: UserId): Promise<boolean> {
    return (await this.index(worldId, userId))?.revisions.includes(revision) ?? false;
  }

  /**
   * Writes a document as a new revision and moves the head to it. A head that changes goes into the
   * world's history with what made it head (DESIGN §23); committing the head as it is adds nothing.
   */
  private async commitDoc(doc: WorldDoc, userId: UserId, loreBookId: string | null, made: { source: HeadSource; note?: string }): Promise<RevisionId> {
    const issues = lintWorld(doc, this.registry);
    if (issues.some((i) => i.severity === "error")) throw new WorldError("validation", "the world has errors", issues);
    const written = stamped(doc);
    const rev = hashJson(written);
    await this.writeJson(revisionFile(doc.id, rev), written, userId);
    this.remember(WorldStore.key(userId, doc.id, rev), written);
    const index = await this.index(doc.id, userId);
    const revisions = index ? [...index.revisions.filter((r) => r !== rev), rev] : [rev];
    const entry: RevisionNote = { revision: rev, at: Date.now(), source: made.source, ...(made.note !== undefined ? { note: made.note } : {}) };
    const history = index?.head === rev ? index.history : [...(index?.history ?? []), entry];
    await this.writeJson(`${worldDir(doc.id)}index.json`, { id: doc.id, name: doc.name, head: rev, loreBookId: index?.loreBookId ?? loreBookId, revisions, ...(history ? { history } : {}) }, userId);
    await this.onChange?.(doc.id, userId);
    return rev;
  }

  /** A new world, from a template or blank; `source` is what its history says made it. */
  async create(name: string, template: WorldDoc | null, userId: UserId, source: "create" | "import" | "studio" = "create"): Promise<{ world: WorldDoc; revision: RevisionId }> {
    const id = `w_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const doc: WorldDoc = template ? migrateWorld({ ...structuredClone(template), id, name }) : blankWorld(id, name);
    const revision = await this.commitDoc(doc, userId, null, { source });
    return { world: doc, revision };
  }

  async setLoreBook(worldId: WorldId, bookId: string, userId: UserId): Promise<void> {
    await this.serial(userId, worldId, async () => {
      const index = await this.index(worldId, userId);
      if (!index) throw new WorldError("not_found", `world ${worldId} not found`);
      await this.writeJson(`${worldDir(worldId)}index.json`, { ...index, loreBookId: bookId }, userId);
    });
  }

  async remove(worldId: WorldId, userId: UserId): Promise<void> {
    await this.serial(userId, worldId, async () => {
      for (const path of await this.host.storage.list(worldDir(worldId), userId)) await this.host.storage.remove(path, userId);
      await this.onChange?.(worldId, userId);
    });
  }

  private async draft(worldId: WorldId, userId: UserId): Promise<Draft & { stored: boolean }> {
    const raw = await this.readJson(`${worldDir(worldId)}draft.json`, userId);
    // A draft stored before drafts counted their writes reads as one write in.
    if (isRecord(raw) && isWorldDoc(raw.doc)) return { base: typeof raw.base === "string" ? raw.base : null, doc: migrateWorld(raw.doc), version: typeof raw.version === "number" && Number.isSafeInteger(raw.version) && raw.version > 0 ? raw.version : 1, stored: true };
    const head = await this.get(worldId, userId);
    return { base: head.revision, doc: structuredClone(head.world), version: 0, stored: false };
  }

  /** The world as Build sees it: the stored draft, else the head. For previews; nothing is written. */
  async working(worldId: WorldId, userId: UserId): Promise<WorldDoc> {
    return (await this.draft(worldId, userId)).doc;
  }

  /**
   * One editor operation on the draft, in turn with the world's other writes. `base` must match the
   * draft's base, and `version`, when sent, its write count (else `conflict`); `get` ignores both,
   * `discard` the base. A place, grid or route a map made (`map`) is edited in its map, so a write
   * to one is refused; after a collection write or a patch the maps compile again, so the draft
   * always carries what its maps make, and each table the write changed is pinned at its revision.
   */
  async edit(request: EditorRequest, userId: UserId): Promise<EditorResult> {
    return this.serial(userId, request.worldId, async () => this.apply(request, await this.draft(request.worldId, userId), userId));
  }

  /**
   * An editor write worked out from the draft as it stands once the world's earlier writes have
   * landed, so what it reads there (a lore save's free id) still holds when it writes.
   */
  async editFrom(worldId: WorldId, userId: UserId, write: (draft: WorldDoc) => EditorRequest): Promise<EditorResult> {
    return this.serial(userId, worldId, async () => {
      const draft = await this.draft(worldId, userId);
      return this.apply({ ...write(draft.doc), worldId }, draft, userId);
    });
  }

  private async apply(request: EditorRequest, draft: Draft & { stored: boolean }, userId: UserId): Promise<EditorResult> {
    const file = `${worldDir(request.worldId)}draft.json`;
    if (request.op === "get") return { draft: draft.doc, lint: lintWorld(draft.doc, this.registry), base: draft.base, stored: draft.stored, version: draft.version };
    // An outside client names the write count it read (DESIGN §23); Build names none and writes as before.
    if (request.version !== undefined && request.version !== draft.version) throw new WorldError("conflict", `the draft changed since you read it (it is at version ${draft.version} now); reload and retry`);
    if (request.op === "discard") {
      await this.host.storage.remove(file, userId).catch(() => undefined);
      const head = await this.draft(request.worldId, userId);
      return { draft: head.doc, lint: lintWorld(head.doc, this.registry), base: head.base, stored: head.stored, version: head.version };
    }
    if (request.base !== null && request.base !== draft.base) throw new WorldError("conflict", "the world changed; reload and retry");
    let doc = draft.doc;
    let base = draft.base;
    let lint: LintIssue[] | null = null;
    if (request.op === "set") {
      setPart(doc, request.part, request.value);
    } else if (request.op === "profile") {
      // A ruleset profile (DESIGN §11) in one write, read against the packs' kinds as Build previewed it.
      const profile = profileOf(request.profile);
      if (!profile) throw new WorldError("bad_request", `unknown profile ${String(request.profile)}`);
      doc = applyProfile(doc, profile, Object.fromEntries(this.registry.kinds), profileChoices(request.choices));
    } else if (request.op === "patch") {
      const patched = this.patched(draft.doc, request.ops);
      // A patch that changes nothing (only tests, say) writes nothing.
      if (jsonEqual(patched.doc, draft.doc)) return { draft: draft.doc, lint: patched.lint, base: draft.base, stored: draft.stored, version: draft.version };
      doc = patched.doc;
      lint = patched.lint;
    } else if (request.op === "restore") {
      // A copy of the revision whose base stays the head: committing it makes that content head again.
      if (typeof request.revision !== "string") throw new WorldError("bad_request", "restore names one of the world's revisions");
      const head = await this.get(request.worldId, userId);
      doc = structuredClone((await this.get(request.worldId, userId, request.revision)).world);
      base = head.revision;
    } else if (request.op === "put" || request.op === "remove") {
      if (!hasOwn(WORLD_COLLECTIONS, request.collection)) throw new WorldError("bad_request", `unknown collection ${request.collection}`);
      if (!safeKey(request.id)) throw new WorldError("bad_request", "not a valid id");
      const collection = collectionOf(doc, request.collection);
      const current = hasOwn(collection, request.id) ? collection[request.id] : undefined;
      const owner = isRecord(current) && typeof current.map === "string" ? current.map : null;
      if (owner !== null) throw new WorldError("bad_request", `${request.collection} ${request.id} is drawn by the map ${owner}; edit it there`);
      if (request.op === "put" && request.collection !== "maps" && isRecord(request.value) && request.value.map !== undefined) throw new WorldError("bad_request", "only a map marks what it draws (map)");
      const tables = request.collection === "tables" ? { ...doc.tables } : null;
      if (request.op === "put") collection[request.id] = request.value;
      else delete collection[request.id];
      doc = compileMaps(doc);
      if (tables) repinTables(tables, doc);
    } else throw new WorldError("bad_request", "unknown editor operation");
    const version = draft.version + 1;
    await this.writeJson(file, { base, doc, version }, userId);
    return { draft: doc, lint: lint ?? lintWorld(doc, this.registry), base, stored: true, version };
  }

  /**
   * The draft with an RFC 6902 patch applied to a copy of it (DESIGN §23), all of it or none. It may
   * carry at most PATCH_OPS_CAP operations, name no prototype key, change nothing PATCH_PROTECTED
   * names and edit nothing a map draws (as a collection write may not), and it must leave a
   * well-formed world. Then, as after a collection write, the maps compile and the tables it
   * changed are pinned. A refusal names the operation; a failed `test` is a `conflict`.
   */
  private patched(before: WorldDoc, raw: unknown): { doc: WorldDoc; lint: LintIssue[] } {
    if (!Array.isArray(raw)) throw new WorldError("bad_request", "a patch is a list of operations");
    if (raw.length > PATCH_OPS_CAP) throw new WorldError("bad_request", `a patch has at most ${PATCH_OPS_CAP} operations; this one has ${raw.length}`);
    const ops: JsonPatchOp[] = [];
    let after: JsonValue;
    try {
      raw.forEach((item, index) => {
        const op = readOp(item, index);
        try {
          parsePointer(op.path);
          if (op.op === "move" || op.op === "copy") parsePointer(op.from);
        } catch (error) {
          throw new PatchError(index, error instanceof Error ? error.message : String(error), op);
        }
        const key = prototypeKeyOf(op);
        if (key !== null) throw new PatchError(index, `"${key}" can't be a key`, op);
        ops.push(op);
      });
      // A world document is plain JSON.
      after = applyPatch(before as unknown as JsonValue, ops);
    } catch (error) {
      if (!(error instanceof PatchError)) throw error;
      // Every pointer was read above, so a test that fails found the draft other than the client read it.
      throw new WorldError(ops[error.index]?.op === "test" ? "conflict" : "bad_request", error.message);
    }
    const refusal = (tokens: readonly string[], message: string): WorldError => {
      const index = ops.findIndex((op) => writesAt(op, tokens));
      const op = ops[index];
      return new WorldError("bad_request", op ? new PatchError(index, message, op).message : message);
    };
    if (!isRecord(after)) throw refusal([], "the patch must leave a world document");
    const was = before as unknown as Record<string, unknown>;
    for (const part of PATCH_PROTECTED) if (!jsonEqual(was[part], after[part])) throw refusal([part], `a patch can't change /${part}`);
    for (const name of Object.keys(WORLD_COLLECTIONS)) {
      const old = was[name];
      const now = after[name];
      const prior = isRecord(old) ? old : {};
      const next = isRecord(now) ? now : {};
      for (const id of new Set([...Object.keys(prior), ...Object.keys(next)])) {
        const from = hasOwn(prior, id) ? prior[id] : undefined;
        const to = hasOwn(next, id) ? next[id] : undefined;
        if (jsonEqual(from, to)) continue;
        if (isRecord(from) && typeof from.map === "string") throw refusal([name, id], `${name} ${id} is drawn by the map ${from.map}; edit it there`);
        if (name !== "maps" && isRecord(to) && to.map !== undefined) throw refusal([name, id], "only a map marks what it draws (map)");
      }
    }
    const shape = shapeIssues(after);
    if (shape.length > 0 || !isWorldDoc(after)) throw new WorldError("validation", "the patch leaves the world malformed", shape);
    const doc = migrateWorld(after);
    repinTables(before.tables, doc);
    return { doc, lint: lintWorld(doc, this.registry) };
  }

  /**
   * The draft as the world's next revision. `base`, when sent, must be the draft's, and a draft
   * begun on an earlier head is refused: committing it would put back what was made head since.
   * The history says who committed (`build`, or `agent` for an outside client) and keeps the note,
   * trimmed and cut to NOTE_CAP characters (DESIGN §23).
   */
  async commit(worldId: WorldId, base: RevisionId | null, userId: UserId, by: { source: "build" | "agent"; note?: string }): Promise<{ revision: RevisionId; lint: LintIssue[] }> {
    if (by.note !== undefined && typeof by.note !== "string") throw new WorldError("bad_request", "a commit note is text");
    // Cut by code point, so the cut never splits a character in two.
    const note = by.note === undefined ? "" : Array.from(by.note.trim()).slice(0, NOTE_CAP).join("");
    return this.serial(userId, worldId, async () => {
      const draft = await this.draft(worldId, userId);
      if (base !== null && base !== draft.base) throw new WorldError("conflict", "the world changed; reload and retry");
      if (draft.stored && draft.base !== (await this.index(worldId, userId))?.head) throw new WorldError("conflict", "the world changed since this draft began; reload it");
      const revision = await this.commitDoc(draft.doc, userId, null, { source: by.source, ...(note !== "" ? { note } : {}) });
      await this.host.storage.remove(`${worldDir(worldId)}draft.json`, userId).catch(() => undefined);
      return { revision, lint: lintWorld(draft.doc, this.registry) };
    });
  }

  /** Imports a world file as a new world; macros in its lore and templates come back as warnings for review. */
  async importFile(file: JsonValue, userId: UserId): Promise<{ world: WorldDoc; revision: RevisionId; lint: LintIssue[] }> {
    const doc = isRecord(file) && isWorldDoc(file.world) ? file.world : file;
    if (!isWorldDoc(doc)) throw new WorldError("bad_request", `not a ${WORLD_FORMAT} document`);
    const created = await this.create(doc.name, migrateWorld(doc), userId, "import");
    return { ...created, lint: macroReview(created.world) };
  }

  /**
   * A document from LumiRPEngine Studio as the next revision of one of the user's worlds (DESIGN
   * §15): it keeps the world's id, so its chats stay on their revisions until an Upgrade. Refused
   * while Build holds an unsaved draft of the world, which a later Commit would otherwise put back
   * over it; checked in turn with the world's writes, so no draft can begin in between.
   */
  async commitRevision(worldId: WorldId, doc: WorldDoc, userId: UserId): Promise<{ world: WorldDoc; revision: RevisionId; lint: LintIssue[] }> {
    return this.serial(userId, worldId, async () => {
      const index = await this.index(worldId, userId);
      if (!index) throw new WorldError("not_found", `world ${worldId} not found`);
      if (await this.hasDraft(worldId, userId)) throw new WorldError("conflict", `Build has unsaved changes to “${index.name}”: commit or discard them first`);
      const world = migrateWorld({ ...structuredClone(doc), id: worldId });
      const revision = await this.commitDoc(world, userId, null, { source: "studio" });
      return { world, revision, lint: macroReview(world) };
    });
  }

  /** Whether Build keeps an unsaved draft of the world. */
  async hasDraft(worldId: WorldId, userId: UserId): Promise<boolean> {
    return (await this.host.storage.read(`${worldDir(worldId)}draft.json`, userId)) !== null;
  }

  async exportFile(worldId: WorldId, userId: UserId, revision?: RevisionId): Promise<JsonValue> {
    const { world } = await this.get(worldId, userId, revision);
    return JSON.parse(JSON.stringify({ format: EXPORT_FORMAT, world })) as JsonValue;
  }

  lint(world: WorldDoc): LintIssue[] {
    return lintWorld(world, this.registry);
  }
}

/** The macros in a world from outside (a file, LumiRPEngine Studio), as warnings to review before playing it. */
export function macroReview(world: WorldDoc): LintIssue[] {
  return macrosIn(world).map((m) => ({ severity: "warning", path: m.path, code: "import_macro", message: `Review this macro before playing: ${m.macro}` }));
}

/** A collection of the document as a mutable JSON record (the editors write raw JSON values). */
function collectionOf(doc: WorldDoc, name: WorldCollection): Record<string, JsonValue> {
  const value: unknown = doc[name];
  if (!isRecord(value)) throw new WorldError("bad_request", `collection ${name} is not an object`);
  return value as Record<string, JsonValue>;
}

function isRevisionNote(v: unknown): v is RevisionNote {
  return isRecord(v) && typeof v.revision === "string" && typeof v.at === "number" && typeof v.source === "string" && hasOwn(HEAD_SOURCES, v.source) && (v.note === undefined || typeof v.note === "string");
}

/** A prototype key an operation names in a path or carries anywhere in its value, if any. */
function prototypeKeyOf(op: JsonPatchOp): string | null {
  // An escaped token (`~0`, `~1`) never spells one of these keys, so the raw tokens are compared.
  for (const pointer of op.op === "move" || op.op === "copy" ? [op.path, op.from] : [op.path]) for (const token of pointer.split("/")) if (isPrototypeKey(token)) return token;
  const stack: unknown[] = "value" in op ? [op.value] : [];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) for (const item of value) stack.push(item);
    else if (isRecord(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (isPrototypeKey(key)) return key;
        stack.push(item);
      }
    }
  }
  return null;
}

/** Whether an operation writes at the place `tokens` point to, inside it, or over it (a whole part, the whole document). */
function writesAt(op: JsonPatchOp, tokens: readonly string[]): boolean {
  if (op.op === "test") return false;
  const overlaps = (pointer: string): boolean => parsePointer(pointer).every((token, i) => i >= tokens.length || token === tokens[i]);
  return overlaps(op.path) || (op.op === "move" && overlaps(op.from));
}

/**
 * Gives each table an edit changed or added its content's revision and pins the world to it, and
 * drops the pins of the tables it removed (DESIGN §9.2: a revision pins the table revisions it
 * uses). The editors send a table with the revision it was read at, so the revision is worked out
 * here, never taken from them. A table or pin list that isn't an object is left for lint to report.
 */
function repinTables(before: Readonly<Record<string, unknown>>, doc: WorldDoc): void {
  const pins: unknown = isRecord(doc.pins) ? doc.pins.tables : undefined;
  if (!isRecord(pins)) return;
  for (const [id, table] of Object.entries(doc.tables)) {
    if (!isRecord(table) || (hasOwn(before, id) && jsonEqual(before[id], table))) continue;
    const revision = hashJson({ schema: table.schema, columns: table.columns, rows: table.rows });
    doc.tables[id] = { ...table, revision };
    pins[id] = revision;
  }
  for (const id of Object.keys(before)) if (!hasOwn(doc.tables, id)) delete pins[id];
}

function setPart(doc: WorldDoc, part: WorldPart, value: JsonValue): void {
  if (!isRecord(value)) throw new WorldError("bad_request", `part ${part} must be an object`);
  if (part === "meta") {
    if (typeof value.name === "string") doc.name = value.name;
    if (typeof value.pov === "string") doc.pov = value.pov;
    if (value.seedMode === "fresh" || value.seedMode === "same_roll") doc.seedMode = value.seedMode;
    if (typeof value.lenientPricing === "boolean") doc.lenientPricing = value.lenientPricing;
    if (isRecord(value.start) && typeof value.start.place === "string" && typeof value.start.at === "string") doc.start = { place: value.start.place, at: value.start.at };
    const currency = currencyOf(value.currency);
    if (currency) doc.currency = currency;
    // The spawn cap as the editor sends it (lint checks its range); the default is no cap set, so a world saved untouched stays as it was.
    if (typeof value.spawnCap === "number") {
      if (value.spawnCap === DEFAULT_SPAWN_CAP) delete doc.spawnCap;
      else doc.spawnCap = value.spawnCap;
    }
    // The world's own life states, as the editor sends them (lint checks each); none is no record, so a world saved untouched stays as it was.
    if (value.lifeStates !== undefined) {
      const states = isRecord(value.lifeStates) ? Object.fromEntries(Object.entries(value.lifeStates).filter(([id, s]) => safeKey(id) && isRecord(s))) : {};
      if (Object.keys(states).length === 0) delete doc.lifeStates;
      else doc.lifeStates = states as unknown as WorldDoc["lifeStates"];
    }
    // Map settings as the engine reads them; the defaults are no settings, so a world saved untouched stays as it was.
    if (value.mapSettings !== undefined) {
      const settings = mapSettingsOf({ mapSettings: value.mapSettings });
      if (JSON.stringify(settings) === JSON.stringify(mapSettingsOf({}))) delete doc.mapSettings;
      else doc.mapSettings = settings;
    }
    return;
  }
  if (part === "tiers") {
    // `{tiers, spawnTier?}`: the tiers whole, as the editor sends them (lint checks each band); no spawn tier is the default.
    if (!isRecord(value.tiers)) throw new WorldError("bad_request", "tiers must be an object");
    doc.tiers = Object.fromEntries(Object.entries(value.tiers).filter(([id]) => safeKey(id))) as unknown as WorldDoc["tiers"];
    if (typeof value.spawnTier === "string") doc.spawnTier = value.spawnTier;
    else delete doc.spawnTier;
    return;
  }
  // The ruleset is optional (DESIGN §11): an empty one is no ruleset, so the document stays as a world without one.
  if (part === "ruleset") {
    if (Object.keys(value).length === 0) delete doc.ruleset;
    else doc.ruleset = value as RulesetDef;
    return;
  }
  // The lookup table whole, as its editor sends it: keys that could reach a prototype are dropped,
  // and lists keep their strings (lint reports the rest).
  if (part === "loreIndex") {
    const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const terms = isRecord(value.terms) ? Object.fromEntries(Object.entries(value.terms).flatMap(([term, entries]) => (safeKey(term) ? [[term, ids(entries)]] : []))) : {};
    const topics = isRecord(value.topics) ? Object.fromEntries(Object.entries(value.topics).flatMap(([id, t]) => (safeKey(id) && isRecord(t) ? [[id, { label: typeof t.label === "string" ? t.label : id, entries: ids(t.entries) }]] : []))) : {};
    doc.loreIndex = { terms, topics };
    return;
  }
  // `calendar`, `realism` and `time` are whole singletons, written as the editors send them.
  Object.assign(doc, { [part]: value });
}

/** Attaching a chat writes its `ChatRun` (DESIGN §4.1): the world, its head revision and a run seed. */
export function newChatRun(worldId: WorldId, revision: RevisionId): ChatRun {
  return { v: 1, worldId, revision, runSeed: crypto.randomUUID(), startedAt: Date.now() };
}

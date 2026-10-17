// World storage and revisions (DESIGN §4.1, ARCHITECTURE §3.1).
//
//   userStorage/worlds/<worldId>/index.json      WorldIndex
//   userStorage/worlds/<worldId>/rev/<rev>.json  one immutable document per revision (rev = hashJson)
//   userStorage/worlds/<worldId>/draft.json      the editors' working copy: { base, doc }
//
// Writes go temp-then-move. Revisions read are cached in a bounded LRU; an open chat also pins the
// revisions its ledger references, so the ledger's synchronous `worlds(revision)` lookup never misses.

import { hashJson } from "../shared/hash";
import type { RevisionId, UserId, WorldId } from "../shared/ids";
import { pathSafe } from "../shared/ids";
import type { ChatRun } from "../shared/ledger";
import type { JsonValue } from "../shared/json";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import type { EditorRequest, LintIssue, WorldCollection, WorldPart } from "../shared/protocol";
import type { RulesetDef, WorldDoc, WorldIndex } from "../shared/world";
import { WORLD_FORMAT } from "../shared/world";
import { blankWorld, currencyOf, isWorldDoc, lintWorld, macrosIn, migrateWorld, stamped } from "../engine/authoring";
import type { Registry } from "../engine/registry-impl";
import type { HostPort } from "./host";

interface Draft {
  base: RevisionId | null;
  doc: WorldDoc;
}

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

const COLLECTIONS: Record<WorldCollection, true> = {
  kinds: true,
  relations: true,
  entities: true,
  places: true,
  routes: true,
  grids: true,
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
};

/** Loaded revisions kept across chats; an open chat pins the ones its ledger references, so eviction never breaks a fold. */
const REVISION_CACHE_CAP = 128;

export class WorldStore {
  /**
   * Loaded revisions by `user \0 world \0 revision` (a bare revision key would let one
   * user's request read another's cached world). Least recently used first; an entry is never replaced.
   */
  private readonly revisions = new Map<string, WorldDoc>();

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
    return {
      id: worldId,
      name: typeof raw.name === "string" ? raw.name : worldId,
      head: raw.head,
      loreBookId: typeof raw.loreBookId === "string" ? raw.loreBookId : null,
      revisions: Array.isArray(raw.revisions) ? raw.revisions.filter((r): r is string => typeof r === "string") : [raw.head],
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

  /** Writes a document as a new revision and moves the head to it. */
  private async commitDoc(doc: WorldDoc, userId: UserId, loreBookId: string | null): Promise<RevisionId> {
    const issues = lintWorld(doc, this.registry);
    if (issues.some((i) => i.severity === "error")) throw new WorldError("validation", "the world has errors", issues);
    const written = stamped(doc);
    const rev = hashJson(written);
    await this.writeJson(revisionFile(doc.id, rev), written, userId);
    this.remember(WorldStore.key(userId, doc.id, rev), written);
    const index = await this.index(doc.id, userId);
    const revisions = index ? [...index.revisions.filter((r) => r !== rev), rev] : [rev];
    await this.writeJson(`${worldDir(doc.id)}index.json`, { id: doc.id, name: doc.name, head: rev, loreBookId: index?.loreBookId ?? loreBookId, revisions }, userId);
    return rev;
  }

  async create(name: string, template: WorldDoc | null, userId: UserId): Promise<{ world: WorldDoc; revision: RevisionId }> {
    const id = `w_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const doc: WorldDoc = template ? migrateWorld({ ...structuredClone(template), id, name }) : blankWorld(id, name);
    const revision = await this.commitDoc(doc, userId, null);
    return { world: doc, revision };
  }

  async setLoreBook(worldId: WorldId, bookId: string, userId: UserId): Promise<void> {
    const index = await this.index(worldId, userId);
    if (!index) throw new WorldError("not_found", `world ${worldId} not found`);
    await this.writeJson(`${worldDir(worldId)}index.json`, { ...index, loreBookId: bookId }, userId);
  }

  async remove(worldId: WorldId, userId: UserId): Promise<void> {
    for (const path of await this.host.storage.list(worldDir(worldId), userId)) await this.host.storage.remove(path, userId);
  }

  private async draft(worldId: WorldId, userId: UserId): Promise<Draft & { stored: boolean }> {
    const raw = await this.readJson(`${worldDir(worldId)}draft.json`, userId);
    if (isRecord(raw) && isWorldDoc(raw.doc)) return { base: typeof raw.base === "string" ? raw.base : null, doc: migrateWorld(raw.doc), stored: true };
    const head = await this.get(worldId, userId);
    return { base: head.revision, doc: structuredClone(head.world), stored: false };
  }

  /** The world as Build sees it: the stored draft, else the head. For previews; nothing is written. */
  async working(worldId: WorldId, userId: UserId): Promise<WorldDoc> {
    return (await this.draft(worldId, userId)).doc;
  }

  /** One editor operation on the draft; `base` must match the draft's base (else `conflict`). `get` and `discard` ignore it. */
  async edit(request: EditorRequest, userId: UserId): Promise<{ draft: WorldDoc; lint: LintIssue[]; base: RevisionId | null; stored: boolean }> {
    if (request.op === "discard") await this.host.storage.remove(`${worldDir(request.worldId)}draft.json`, userId).catch(() => undefined);
    const draft = await this.draft(request.worldId, userId);
    if (request.op === "get" || request.op === "discard") return { draft: draft.doc, lint: lintWorld(draft.doc, this.registry), base: draft.base, stored: draft.stored };
    if (request.base !== null && request.base !== draft.base) throw new WorldError("conflict", "the world changed; reload and retry");
    const doc = draft.doc;
    if (request.op === "set") {
      setPart(doc, request.part, request.value);
    } else {
      if (!hasOwn(COLLECTIONS, request.collection)) throw new WorldError("bad_request", `unknown collection ${request.collection}`);
      if (!safeKey(request.id)) throw new WorldError("bad_request", "not a valid id");
      const collection = collectionOf(doc, request.collection);
      if (request.op === "put") collection[request.id] = request.value;
      else delete collection[request.id];
    }
    await this.writeJson(`${worldDir(request.worldId)}draft.json`, { base: draft.base, doc }, userId);
    return { draft: doc, lint: lintWorld(doc, this.registry), base: draft.base, stored: true };
  }

  async commit(worldId: WorldId, base: RevisionId | null, userId: UserId): Promise<{ revision: RevisionId; lint: LintIssue[] }> {
    const draft = await this.draft(worldId, userId);
    if (base !== null && base !== draft.base) throw new WorldError("conflict", "the world changed; reload and retry");
    const revision = await this.commitDoc(draft.doc, userId, null);
    await this.host.storage.remove(`${worldDir(worldId)}draft.json`, userId).catch(() => undefined);
    return { revision, lint: lintWorld(draft.doc, this.registry) };
  }

  /** Imports a world file; macros in its lore and templates come back as warnings for review. */
  async importFile(file: JsonValue, userId: UserId): Promise<{ world: WorldDoc; revision: RevisionId; lint: LintIssue[] }> {
    const doc = isRecord(file) && isWorldDoc(file.world) ? file.world : file;
    if (!isWorldDoc(doc)) throw new WorldError("bad_request", `not a ${WORLD_FORMAT} document`);
    const created = await this.create(doc.name, migrateWorld(doc), userId);
    const lint: LintIssue[] = macrosIn(created.world).map((m) => ({ severity: "warning", path: m.path, code: "import_macro", message: `Review this macro before playing: ${m.macro}` }));
    return { ...created, lint };
  }

  async exportFile(worldId: WorldId, userId: UserId, revision?: RevisionId): Promise<JsonValue> {
    const { world } = await this.get(worldId, userId, revision);
    return JSON.parse(JSON.stringify({ format: "lre-world-export-v1", world })) as JsonValue;
  }

  lint(world: WorldDoc): LintIssue[] {
    return lintWorld(world, this.registry);
  }
}

/** A collection of the document as a mutable JSON record (the editors write raw JSON values). */
function collectionOf(doc: WorldDoc, name: WorldCollection): Record<string, JsonValue> {
  const value: unknown = doc[name];
  if (!isRecord(value)) throw new WorldError("bad_request", `collection ${name} is not an object`);
  return value as Record<string, JsonValue>;
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
  // `calendar`, `realism` and `time` are whole singletons, written as the editors send them.
  Object.assign(doc, { [part]: value });
}

/** Attaching a chat writes its `ChatRun` (DESIGN §4.1): the world, its head revision and a run seed. */
export function newChatRun(worldId: WorldId, revision: RevisionId): ChatRun {
  return { v: 1, worldId, revision, runSeed: crypto.randomUUID(), startedAt: Date.now() };
}

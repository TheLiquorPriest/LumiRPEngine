// The world service (plan §4.5, §14; PlanChatUI-B1): every operation Build's editor asks of RPE about a world, as a function that
// takes the user and what it needs, so no logic lives in a route handler. His worlds are kept once, in the store's table (`UserStore.worlds`),
// behind today's world store (`worlds.ts`); a revision Build commits is the store's revision, and every change to a draft, from a page, a tool
// of an agent, a job's Apply, a chat's map kept in its world or an approved lore proposal, is one write that names the version it was read at, so
// the second of two writers on one version is told the draft moved on and nothing of its write is kept.
//
// The service never decides what is worth writing and never writes by itself: it answers the call it is given.

import type { Log } from "rp-harness/contract";
import type { WriteQueue } from "../app";
import { calendarOf } from "../engine/calendar";
import { lintWorld, previewSheet } from "../engine/authoring";
import { buildCharacter } from "../engine/character";
import type { Registry } from "../engine/registry-impl";
import { sheetRulesetProblem } from "../engine/ruleset";
import { formulaFunctions } from "../engine/scope";
import { tableUpdates } from "../engine/table-updates";
import { buildContext, findThingIds, personThings, thingPage, thingPicks, thingsList, thingTypes } from "../engine/thing-view";
import { STARTER_INFO, STARTER_TABLES, STARTER_WORLDS } from "../packs/index";
import type { RevisionId, UserId, WorldId } from "../shared/ids";
import { hasOwn, isRecord, type JsonValue } from "../shared/json";
import type { CharacterResult } from "../shared/character";
import { PROTOCOL_VERSION, type ResultBodies } from "../shared/protocol";
import type { EditorRequest } from "../shared/world";
import type { LintIssue } from "../shared/lint";
import type { TableUpdate } from "../shared/tables";
import type { TemplateInfo } from "../packs/starters/info";
import type { ThingsRead } from "../shared/thing-view";
import { changesBetween } from "../shared/world-diff";
import type { RevisionNote, RulesetDef, WorldDoc, WorldIndex } from "../shared/world";
import type { Store } from "../store";
import { storeBacking } from "./backing";
import { WORLD_LIMIT_DEFAULTS, type WorldLimits } from "./limits";
import { WorldChats, type WorldChatsDeps } from "./chats";
import { type Changes, changesOf } from "./changes";
import { type DraftNotice, type EditorResult, WorldError, WorldStore } from "./worlds";

/** What the world service stands on. */
export interface WorldServiceDeps {
  /** The store his worlds are kept in, and whose registry reads them. */
  store: Pick<Store, "user" | "env">;
  /** The application's one write queue: every write to the store's table goes through it. */
  writes: WriteQueue;
  log: Log;
  /** What a world's chats need beyond the store: the live hub, whether a turn runs, and a chat's name. Left out, the chats service answers that it has none. */
  chats?: Omit<WorldChatsDeps, "store" | "writes" | "worlds">;
  /** The limits `worlds.*` give, read at each write; today's values where none is given. */
  limits?: () => WorldLimits | Promise<WorldLimits>;
}

/** The draft's editor writes without the envelope today's messages carried: what a caller names of a write. */
export type DraftWrite = EditorRequest extends infer R ? (R extends unknown ? Omit<R, "lre" | "type" | "reqId" | "worldId" | "base" | "version"> : never) : never;

/** One revision of a world as its list gives it. */
export interface RevisionRow {
  revision: RevisionId;
  /** When it became head, in ms since 1970; none for a revision that became head before the world kept a history. */
  at?: number;
  /** What made it head. */
  source?: RevisionNote["source"];
  /** The note given with the commit. */
  note?: string;
  /** It is the world's head now. */
  head: boolean;
  /** The revision that was the head before it; null for the world's first. */
  before: RevisionId | null;
  /** How many things it changed against the revision before it; null for the world's first, and for one whose file is gone. */
  changed: number | null;
  /** The chats that play it now, by name. */
  chats: { chat: string; name: string }[];
}

/** A world opened at a revision: the document, which revision it is, how each became head, and what the packs give the editors. */
export interface WorldRead {
  world: WorldDoc;
  revision: RevisionId;
  history: RevisionNote[];
  packKinds: NonNullable<ResultBodies["lre.world"]["packKinds"]>;
  packRelations: NonNullable<ResultBodies["lre.world"]["packRelations"]>;
  functions: string[];
}

/** Why a draft can't be read as a chat would start it: which of its clock and its start does not read, so the page names it and leads to Problems. */
export class DraftUnreadable extends WorldError {
  constructor(
    readonly part: "calendar" | "start",
    lint: LintIssue[],
  ) {
    super("validation", `The draft's ${part === "calendar" ? "calendar" : "start"} does not read, so its things cannot be listed: Problems says why.`, lint);
    this.name = "DraftUnreadable";
  }
}

export class WorldService {
  /** Today's world store over the store's table: every write to a draft or a revision goes through it. */
  readonly worlds: WorldStore;
  readonly registry: Registry;

  private readonly chatDeps: WorldServiceDeps["chats"];
  private made: WorldChats | null = null;

  constructor(private readonly deps: WorldServiceDeps) {
    this.chatDeps = deps.chats;
    this.registry = deps.store.env.registry;
    this.worlds = new WorldStore(
      storeBacking(deps.store, deps.writes, (message, fields) => deps.log.warn(`[LumiRPEngine] ${message}`, fields)),
      this.registry,
      STARTER_TABLES,
      deps.limits ?? (() => WORLD_LIMIT_DEFAULTS),
    );
  }

  /** A world's chats, moving a chat on and attaching (`chats.ts`). */
  get chats(): WorldChats {
    if (this.chatDeps === undefined) throw new WorldError("bad_request", "This world service was made with no chats to look after: it cannot list or move them.");
    return (this.made ??= new WorldChats({ store: this.deps.store, writes: this.deps.writes, worlds: this.worlds, ...this.chatDeps }));
  }

  // ---------------------------------------------------------------- worlds and revisions

  /** His worlds, by name. */
  list(user: UserId): Promise<WorldIndex[]> {
    return this.worlds.list(user);
  }

  /** The starter worlds a new world can be made from. */
  templates(): TemplateInfo[] {
    return STARTER_INFO.filter((t) => hasOwn(STARTER_WORLDS, t.id));
  }

  /** A world at a revision (its head by default), with its history and what the packs give the editors. */
  async read(user: UserId, world: WorldId, revision?: RevisionId): Promise<WorldRead> {
    const got = await this.worlds.get(world, user, revision);
    return { ...got, history: await this.worlds.history(world, user), packKinds: Object.fromEntries(this.registry.kinds), packRelations: Object.fromEntries(this.registry.relations), functions: formulaFunctions(this.registry) };
  }

  /** A new world, from a starter (`template`) or blank. */
  async create(user: UserId, name: string, template: string | null): Promise<{ world: WorldDoc; revision: RevisionId }> {
    const make = template !== null && template !== "" && hasOwn(STARTER_WORLDS, template) ? STARTER_WORLDS[template] : undefined;
    if (template !== null && template !== "" && make === undefined) throw new WorldError("not_found", `unknown template ${template}`);
    return this.worlds.create(name, make ? make("", name) : null, user);
  }

  /** A world file brought in as a new world; macros in its lore and templates come back as warnings to review. */
  importFile(user: UserId, file: JsonValue): Promise<{ world: WorldDoc; revision: RevisionId; lint: LintIssue[] }> {
    return this.worlds.importFile(file, user);
  }

  exportFile(user: UserId, world: WorldId, revision?: RevisionId): Promise<JsonValue> {
    return this.worlds.exportFile(world, user, revision);
  }

  /**
   * A world gone, with its draft and its history and every revision no chat plays; his worlds as they stand after. A chat that plays it keeps its
   * record and the revisions it played (the deletion keeps them), and plays no world from now: a world can be attached to it again.
   */
  async remove(user: UserId, world: WorldId): Promise<WorldIndex[]> {
    const played = this.chatDeps === undefined ? [] : await this.chats.chatsOf(user, { world });
    await this.worlds.remove(world, user);
    if (this.chatDeps !== undefined) this.chats.released(played.map((c) => c.chat));
    return this.worlds.list(user);
  }

  /** The lint of a world at a revision (the head by default). */
  async lint(user: UserId, world: WorldId, revision?: RevisionId): Promise<LintIssue[]> {
    return this.worlds.lint((await this.worlds.get(world, user, revision)).world);
  }

  /** The draft as the world's next revision. `source` is who commits: Build, or an agent (the command line, the MCP server). */
  commit(user: UserId, world: WorldId, by: { base: RevisionId | null; note?: string; version?: number; source: "build" | "agent" }, noted?: DraftNotice): Promise<{ revision: RevisionId; lint: LintIssue[] }> {
    return this.worlds.commit(world, by.base, user, { source: by.source, ...(by.note !== undefined ? { note: by.note } : {}), ...(by.version !== undefined ? { version: by.version } : {}) }, noted);
  }

  /** The Sheet Designer's live preview: the draft with the unsaved ruleset, as a chat would start; nothing is saved. */
  async sheet(user: UserId, world: WorldId, ruleset: JsonValue, entity?: string): Promise<Pick<ResultBodies["lre.world"], "sheet">> {
    const problem = isRecord(ruleset) ? sheetRulesetProblem(ruleset) : null;
    if (problem) throw new WorldError("bad_request", problem);
    const draft = await this.worlds.working(world, user);
    const doc = { ...draft, ruleset: isRecord(ruleset) ? (ruleset as unknown as RulesetDef) : undefined };
    const shown = typeof entity === "string" && hasOwn(doc.entities, entity) ? entity : doc.pov;
    return { sheet: previewSheet(this.registry, doc, shown) };
  }

  /** The shipped data tables newer than the world's copies, the draft's or a revision's. */
  async updates(user: UserId, world: WorldId, revision?: RevisionId): Promise<TableUpdate[]> {
    const doc = revision !== undefined ? (await this.worlds.get(world, user, revision)).world : await this.worlds.working(world, user);
    return tableUpdates(doc, this.registry.tables, STARTER_TABLES);
  }

  // ---------------------------------------------------------------- a world's history

  /** The limits `worlds.*` give now. */
  async limits(): Promise<WorldLimits> {
    return (this.deps.limits ?? (() => WORLD_LIMIT_DEFAULTS))();
  }

  /**
   * A page of the world's revisions, newest first: each with when it became head and what made it, its note, how many things it
   * changed against the revision before it, and the chats that play it now. Each time a revision became head is a row of its own (a
   * revision put back as head comes again); the revisions that became head before a history was kept come last, with no time. A page
   * starts after `after`, the place of the last row of the page before it (a time and a revision, never a count), and gives `limit` rows.
   */
  async revisions(user: UserId, world: WorldId, page: { limit: number; after?: string }): Promise<{ items: RevisionRow[]; next: string | null }> {
    const [index, history] = await Promise.all([this.worlds.index(world, user), this.worlds.history(world, user)]);
    if (index === null) throw new WorldError("not_found", `world ${world} not found`);
    const noted = new Set(history.map((n) => n.revision));
    // Oldest first: what became head before a history was kept, then each time a revision became head.
    const entries: { revision: RevisionId; note?: RevisionNote }[] = [...index.revisions.filter((r) => !noted.has(r)).map((revision) => ({ revision })), ...history.map((note) => ({ revision: note.revision, note }))];
    const place = (e: { revision: RevisionId; note?: RevisionNote }): string => `${e.note?.at ?? 0}~${e.revision}`;
    const end = page.after === undefined ? entries.length : entries.findIndex((e) => place(e) === page.after);
    if (end < 0) throw new WorldError("bad_request", `${page.after ?? ""} is no place in the history of world ${world}`);
    const start = Math.max(0, end - page.limit);
    const read = async (at: number): Promise<WorldDoc | null> => {
      try {
        return (await this.worlds.get(world, user, entries[at]?.revision)).world;
      } catch (error) {
        // A revision whose file is gone is listed all the same, with nothing said of how much it changed.
        if (error instanceof WorldError && error.code === "not_found") return null;
        throw error;
      }
    };
    const chats = this.chatDeps === undefined ? [] : await this.chats.chatsOf(user, { world });
    const rows: RevisionRow[] = [];
    let before = start > 0 ? await read(start - 1) : null;
    for (let at = start; at < end; at++) {
      const entry = entries[at];
      if (entry === undefined) continue;
      const doc = await read(at);
      const same = at > 0 && entries[at - 1]?.revision === entry.revision;
      rows.push({
        revision: entry.revision,
        ...(entry.note === undefined ? {} : { at: entry.note.at, source: entry.note.source, ...(entry.note.note === undefined ? {} : { note: entry.note.note }) }),
        head: entry.revision === index.head,
        before: entries[at - 1]?.revision ?? null,
        changed: at === 0 || doc === null || before === null ? null : same ? 0 : changesBetween(before, doc).length,
        chats: chats.filter((c) => c.revision === entry.revision).map((c) => ({ chat: c.chat, name: c.name })),
      });
      before = doc;
    }
    const first = entries[start];
    return { items: rows.reverse(), next: start > 0 && first !== undefined ? place(first) : null };
  }

  /**
   * What changed from one version of the world to another, part by part: from `from` (the world's head by default) to `to` (the draft
   * by default; a draft none is stored for is the head, so nothing changed).
   */
  async changes(user: UserId, world: WorldId, from?: RevisionId, to?: RevisionId): Promise<{ from: RevisionId; to: RevisionId | null } & Changes> {
    const index = await this.worlds.index(world, user);
    if (index === null) throw new WorldError("not_found", `world ${world} not found`);
    const before = from ?? index.head;
    const [was, now, limits] = await Promise.all([this.worlds.get(world, user, before), to === undefined ? this.worlds.working(world, user) : this.worlds.get(world, user, to).then((got) => got.world), this.limits()]);
    return { from: before, to: to ?? null, ...changesOf(was.world, now, limits.changesListed) };
  }

  // ---------------------------------------------------------------- the draft

  /**
   * One write to a world's draft, or its read: get, discard, put and remove an item, set a part, profile choices, patch, restore a
   * revision into the draft, bring in shipped tables. A write that names the version it read (`by.version`) and finds the draft on
   * another is not written: `DraftMoved` carries the draft as it now stands. `noted` hears of the change once it is durable.
   */
  draft(user: UserId, world: WorldId, write: DraftWrite, by: { base?: RevisionId | null; version?: number } = {}, noted?: DraftNotice): Promise<EditorResult> {
    const request = { lre: PROTOCOL_VERSION, type: "lre.editor", reqId: "", worldId: world, base: by.base ?? null, ...(by.version !== undefined ? { version: by.version } : {}), ...write };
    return this.worlds.edit(request as EditorRequest, user, noted);
  }

  /** The draft as a chat would start from it, for Things and a character; refused naming the part of the draft that does not read. */
  private async context(user: UserId, world: WorldId) {
    const doc = await this.worlds.working(world, user);
    const ctx = buildContext(this.registry, doc);
    if (ctx !== null) return ctx;
    throw new DraftUnreadable(calendarReads(doc) ? "start" : "calendar", lintWorld(doc, this.registry).filter((i) => i.severity === "error"));
  }

  // ---------------------------------------------------------------- Things and a character in Build's scope

  /** Build's Things (ITEMS-SPEC §10.1): the world's draft as a chat would start from it. */
  async things(user: UserId, world: WorldId, read: ThingsRead): Promise<ResultBodies["lre.things"]> {
    const ctx = await this.context(user, world);
    if (read.op === "list") return { list: thingsList(ctx) };
    if (read.op === "find") {
      if (typeof read.words !== "string") throw new WorldError("bad_request", "say what to find");
      return { found: findThingIds(ctx, read.words) };
    }
    if (read.op === "types") return { types: thingTypes(ctx) };
    if (read.op !== "thing" && read.op !== "person") throw new WorldError("bad_request", "the op is list, thing, person, find or types");
    if (typeof read.entity !== "string") throw new WorldError("bad_request", "name a thing or a person");
    if (read.op === "thing") {
      const thing = thingPage(ctx, read.entity);
      if (!thing) throw new WorldError("not_found", "no such thing");
      return { thing, pick: thingPicks(ctx) };
    }
    const person = personThings(ctx, read.entity);
    if (!person) throw new WorldError("not_found", "no such person");
    return { person, pick: thingPicks(ctx) };
  }

  /** A character as its own model (DESIGN §7), from the world's draft. */
  async character(user: UserId, world: WorldId, entity: string): Promise<CharacterResult> {
    const found = buildCharacter(this.registry, await this.worlds.working(world, user), entity);
    if (!found) throw new WorldError("not_found", "no such character");
    return found;
  }
}

/** Whether the draft's clock reads. */
function calendarReads(doc: WorldDoc): boolean {
  try {
    calendarOf(doc);
    return true;
  } catch {
    return false;
  }
}

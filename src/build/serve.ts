// Build's messages, served by RPE (plan §14: Build mode is kept, its client re-pointed from the
// extension's messages to RPE). One message as today's page sends it is answered as today's
// dispatcher answers it (`backend/dispatch.ts`: `handle`, the `lre.world`, `lre.editor`,
// `lre.things` and `lre.character` cases, and `world`), with today's own code behind each: the world
// store over Build's table, and the pure reads of a world's draft. With the answer go the pushes the
// request caused, as today's dispatcher announces them after it (`lre.draft.changed`).
//
// Two things are RPE's own: each revision Build makes (create, import, commit) is kept in RPE's store,
// where a chat plays it, and Attach sets there which revision a chat plays. What today's dispatcher
// did to Lumiverse on the side (a World Info book synced on create, commit and import; JSON-hiding
// regex scripts on attach and delete; the chat's metadata on attach) is not done: RPE writes nothing
// of that kind (plan §4.2). The requests this build cannot serve are answered `unavailable`, in words
// from `.prompts/build-answers.md`.

import type { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Log } from "rp-harness/contract";
import type { WriteQueue } from "../app";
import { type DraftNotice, WorldError, WorldStore } from "../backend/worlds";
import { previewSheet, previewSkills } from "../engine/authoring";
import { buildCharacter } from "../engine/character";
import type { Registry } from "../engine/registry-impl";
import { sheetRulesetProblem } from "../engine/ruleset";
import { formulaFunctions } from "../engine/scope";
import { tableUpdates } from "../engine/table-updates";
import { buildContext, findThingIds, personThings, thingPage, thingPicks, thingsList, thingTypes } from "../engine/thing-view";
import { STARTER_INFO, STARTER_TABLES, STARTER_WORLDS } from "../packs/index";
import { type ChatId, pathSafe, type RevisionId, type WorldId } from "../shared/ids";
import { hasOwn, isRecord } from "../shared/json";
import { type DraftChanged, type ErrorCode, type ErrorMessage, type FrontendToBackend, type LintIssue, PROTOCOL_VERSION, type ResultBodies, type ResultMessage } from "../shared/protocol";
import type { RulesetDef } from "../shared/world";
import { readPart, type Store } from "../store";
import { BuildFiles, worldHost } from "./files";

/** The prompt part Build's own words are in, under the guidance folder's `.prompts/`. */
export const BUILD_ANSWERS = "build-answers";

/** What one message is answered with: today's `lre.result` or `lre.error`, and the pushes it caused. */
export interface BuildAnswer {
  result: ResultMessage | ErrorMessage;
  /** Each world whose working copy the request changed, once, as it stands after it. */
  pushes: DraftChanged[];
}

export interface BuildDeps {
  db: Database;
  writes: WriteQueue;
  /** RPE's store: where a committed revision is kept for chats to play, and its registry. */
  store: Store;
  log: Log;
  /** The guidance folder whose `.prompts/build-answers.md` words what Build does not do. */
  guidance: string;
}

/** A request refused as today's dispatcher refuses one (its `RequestError`): a code, and the words the page shows. */
class Refused extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Whether a message is one of today's requests, as today's dispatcher takes it (`isRequest`). */
export function isRequest(raw: unknown): raw is FrontendToBackend {
  return isRecord(raw) && raw.lre === PROTOCOL_VERSION && typeof raw.type === "string" && typeof raw.reqId === "string";
}

type Request<T extends FrontendToBackend["type"]> = Extract<FrontendToBackend, { type: T }>;

export class BuildService {
  /** Today's world store, over Build's table. */
  readonly worlds: WorldStore;
  private readonly registry: Registry;

  constructor(private readonly deps: BuildDeps) {
    this.registry = deps.store.env.registry;
    this.worlds = new WorldStore(worldHost(new BuildFiles(deps.db, deps.writes), deps.log), this.registry, STARTER_TABLES);
  }

  /** Answers one of today's requests for `user`, as today's dispatcher would. */
  async answer(r: FrontendToBackend, user: string): Promise<BuildAnswer> {
    const drafts = new Map<WorldId, DraftChanged>();
    const noted: DraftNotice = (worldId, draft) => {
      drafts.set(worldId, { lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId, version: draft.version, stored: draft.stored, base: draft.base });
    };
    const fail = (code: ErrorCode, message: string, lint?: LintIssue[]): ErrorMessage => ({ lre: PROTOCOL_VERSION, type: "lre.error", reqId: r.reqId, code, message, ...(lint ? { lint } : {}) });
    // Ids that name storage paths must be plain, as today (a `..` world id would reach other files).
    const unsafe = ["chatId", "worldId", "revision"].find((k) => isRecord(r) && r[k] !== undefined && r[k] !== null && !pathSafe(r[k]));
    if (unsafe !== undefined) return { result: fail("bad_request", `invalid ${unsafe}`), pushes: [] };
    let result: ResultMessage | ErrorMessage;
    try {
      result = await this.route(r, user, noted);
    } catch (error) {
      if (error instanceof Refused) result = fail(error.code, error.message);
      else if (error instanceof WorldError) result = fail(error.code, error.message, error.lint);
      else {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.log.error("A Build request failed inside RPE.", { request: r.type, error: message });
        result = fail("internal", message);
      }
    }
    // A request that failed after it changed a draft still says so, as today.
    return { result, pushes: [...drafts.values()] };
  }

  private async route(r: FrontendToBackend, user: string, noted: DraftNotice): Promise<ResultMessage> {
    const reply = <K extends keyof ResultBodies>(request: K, body: ResultBodies[K]): ResultMessage => ({ lre: PROTOCOL_VERSION, type: "lre.result", reqId: r.reqId, request, body }) as ResultMessage;
    switch (r.type) {
      case "lre.world":
        return reply("lre.world", await this.world(r, user, noted));
      case "lre.editor":
        return reply("lre.editor", await this.worlds.edit(r, user, noted));
      case "lre.things":
        return reply("lre.things", await this.things(r, user));
      case "lre.character":
        return reply("lre.character", await this.character(r, user));
      case "lre.job":
        throw await this.refused("unavailable", "job");
      case "lre.lore":
        throw await this.refused("unavailable", "lore");
      case "lre.secrecy":
        throw await this.refused("unavailable", "secrecy");
      default:
        throw await this.refused("bad_request", "not_build", { type: r.type, op: isRecord(r) ? r.op : undefined });
    }
  }

  private async world(r: Request<"lre.world">, user: string, noted: DraftNotice): Promise<ResultBodies["lre.world"]> {
    const store = this.worlds;
    // What the page sent, for an op this build does not know, where the type has none left.
    const op: unknown = r.op;
    switch (r.op) {
      case "list":
        return { worlds: await store.list(user) };
      case "get":
        return { ...(await store.get(r.worldId, user, r.revision)), history: await store.history(r.worldId, user), packKinds: Object.fromEntries(this.registry.kinds), packRelations: Object.fromEntries(this.registry.relations), functions: formulaFunctions(this.registry) };
      case "create": {
        const template = r.template && hasOwn(STARTER_WORLDS, r.template) ? STARTER_WORLDS[r.template] : undefined;
        if (r.template && !template) throw new Refused("not_found", `unknown template ${r.template}`);
        const created = await store.create(r.name, template ? template("", r.name) : null, user);
        await this.keep(created.world.id, created.revision, user);
        return { world: created.world, revision: created.revision };
      }
      case "delete":
        await store.remove(r.worldId, user);
        return { worlds: await store.list(user) };
      case "commit": {
        const committed = await store.commit(r.worldId, r.base, user, { source: "build", ...(r.note !== undefined ? { note: r.note } : {}), ...(r.version !== undefined ? { version: r.version } : {}) }, noted);
        await this.keep(r.worldId, committed.revision, user);
        return committed;
      }
      case "import": {
        const imported = await store.importFile(r.file, user);
        await this.keep(imported.world.id, imported.revision, user);
        return imported;
      }
      case "export":
        return { file: await store.exportFile(r.worldId, user, r.revision) };
      case "lint": {
        const { world } = await store.get(r.worldId, user, r.revision);
        return { lint: store.lint(world) };
      }
      case "attach":
        return { revision: await this.attach(r.worldId, r.chatId, user) };
      case "sheet": {
        // The Sheet Designer's live preview: the draft with the unsaved ruleset, as a chat would start.
        const problem = isRecord(r.ruleset) ? sheetRulesetProblem(r.ruleset) : null;
        if (problem) throw new Refused("bad_request", problem);
        const draft = await store.working(r.worldId, user);
        const world = { ...draft, ruleset: isRecord(r.ruleset) ? (r.ruleset as unknown as RulesetDef) : undefined };
        const entity = typeof r.entity === "string" && hasOwn(world.entities, r.entity) ? r.entity : world.pov;
        return { sheet: previewSheet(this.registry, world, entity), skills: previewSkills(this.registry, world) };
      }
      case "templates":
        return { templates: STARTER_INFO.filter((t) => hasOwn(STARTER_WORLDS, t.id)) };
      case "updates": {
        const world = r.revision !== undefined ? (await store.get(r.worldId, user, r.revision)).world : await store.working(r.worldId, user);
        return { updates: tableUpdates(world, this.registry.tables, STARTER_TABLES) };
      }
      case "chats":
        throw await this.refused("unavailable", "world_chats");
      case "upgrade":
        throw await this.refused("unavailable", "world_upgrade");
      default:
        throw await this.refused("bad_request", "not_build", { type: "lre.world", op });
    }
  }

  /** Build's Things (ITEMS-SPEC §10.1): the world's draft as a chat would start from it. */
  private async things(r: Request<"lre.things">, user: string): Promise<ResultBodies["lre.things"]> {
    if (r.scope === "gm" || r.scope === "play") throw await this.refused("unavailable", "scope", { type: r.type, scope: r.scope });
    if (r.scope !== "build" || typeof r.worldId !== "string") throw new Refused("bad_request", "name the world");
    const ctx = buildContext(this.registry, await this.worlds.working(r.worldId, user));
    if (!ctx) throw new Refused("unavailable", "the draft can't start a chat yet: its start or calendar doesn't read");
    if (r.op === "list") return { list: thingsList(ctx) };
    if (r.op === "find") {
      if (typeof r.words !== "string") throw new Refused("bad_request", "say what to find");
      return { found: findThingIds(ctx, r.words) };
    }
    if (r.op === "types") return { types: thingTypes(ctx) };
    if (r.op !== "thing" && r.op !== "person") throw new Refused("bad_request", "the op is list, thing, person, find or types");
    if (typeof r.entity !== "string") throw new Refused("bad_request", "name a thing or a person");
    if (r.op === "thing") {
      const thing = thingPage(ctx, r.entity);
      if (!thing) throw new Refused("not_found", "no such thing");
      return { thing, pick: thingPicks(ctx) };
    }
    const person = personThings(ctx, r.entity);
    if (!person) throw new Refused("not_found", "no such person");
    return { person, pick: thingPicks(ctx) };
  }

  /** A character as its own model (DESIGN §7), Build's: from the world's draft. */
  private async character(r: Request<"lre.character">, user: string): Promise<ResultBodies["lre.character"]> {
    if (r.op !== "get" || typeof r.entity !== "string") throw new Refused("bad_request", "name a character to get");
    if (r.scope === "gm") throw await this.refused("unavailable", "scope", { type: r.type, scope: r.scope });
    if (r.scope !== "build") throw new Refused("bad_request", "the scope is build or gm");
    if (typeof r.worldId !== "string") throw new Refused("bad_request", "name the world");
    const found = buildCharacter(this.registry, await this.worlds.working(r.worldId, user), r.entity);
    if (!found) throw new Refused("not_found", "no such character");
    return found;
  }

  /**
   * Keeps a revision Build made in RPE's store (plan §4.5), as the world's revision file holds it, so a
   * chat can play it. One the store keeps already stays as it is.
   */
  private async keep(worldId: WorldId, revision: RevisionId, user: string): Promise<void> {
    const { world } = await this.worlds.get(worldId, user, revision);
    await this.deps.writes.run(() => this.deps.store.user(user).putWorld(revision, world), "keeping a world revision for chats to play");
  }

  /**
   * Attach (plan §14): the chat plays the world's head revision, set in RPE's store, where a chat's
   * revision is read. A chat that plays no world yet takes it at once. One that plays a revision keeps
   * it, losing nothing: every turn played in it starts from that revision, so moving it would change
   * them all, and today's way to move a chat on (an Upgrade, held until its turn ends) is not in this
   * build. Unless that revision is this one, the answer says so in Build's words.
   */
  private async attach(worldId: WorldId, chatId: ChatId, user: string): Promise<RevisionId> {
    if (typeof chatId !== "string") throw new Refused("bad_request", "name the chat");
    const { world, revision } = await this.worlds.get(worldId, user);
    const s = this.deps.store.user(user);
    const playing = await this.deps.writes.run(() => {
      s.putWorld(revision, world);
      return s.attachWorld({ id: chatId, world: worldId, revision });
    }, "attaching a chat to a world");
    if (playing === revision) return revision;
    throw await this.refused("conflict", "attach_kept", { world: this.deps.store.env.worlds(playing)?.name ?? playing, revision: playing, asked: world.name, to: revision });
  }

  /** A refusal in the words its line of `.prompts/build-answers.md` gives, filled with `fields`; no words where the line is gone. */
  private async refused(code: ErrorCode, line: string, fields: Record<string, unknown> = {}): Promise<Refused> {
    const what = `.prompts/${BUILD_ANSWERS}.md`;
    const part = readPart(await readFile(join(this.deps.guidance, ".prompts", `${BUILD_ANSWERS}.md`), "utf8"), what);
    return new Refused(code, part.lines.get(line)?.render(part.header, fields) ?? "");
  }
}

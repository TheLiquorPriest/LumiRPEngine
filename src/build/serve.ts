// Build's messages, served by RPE (plan §14: Build mode is kept, its client re-pointed from the
// extension's messages to RPE). One message as today's page sends it is answered as today's
// dispatcher answers it (`backend/dispatch.ts`: `handle`, the `lre.world`, `lre.editor`,
// `lre.things` and `lre.character` cases), with the world service behind each (`src/worlds/service.ts`:
// his worlds kept once, in RPE's store). With the answer go the pushes the request caused, as today's
// dispatcher announces them after it (`lre.draft.changed`).
//
// This is the old road: the typed routes of the worlds (`worlds-routes.ts`) take what a call file sends
// them, and this answers what no call file takes yet, until the last package of Build deletes it. What
// today's dispatcher did to Lumiverse on the side (a World Info book synced on create, commit and
// import; JSON-hiding regex scripts on attach and delete; the chat's metadata on attach) is not done:
// RPE writes nothing of that kind (plan §4.2). The requests this build cannot serve are answered
// `unavailable`, in words from `.prompts/build-answers.md`.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Log } from "rp-harness/contract";
import type { WriteQueue } from "../app";
import { type ChatId, pathSafe, type RevisionId, type WorldId } from "../shared/ids";
import { isRecord } from "../shared/json";
import { type DraftChanged, type ErrorCode, type ErrorMessage, type FrontendToBackend, PROTOCOL_VERSION, type ResultBodies, type ResultMessage } from "../shared/protocol";
import type { LintIssue } from "../shared/lint";
import { readPart, type Store } from "../store";
import { type DraftNotice, WorldError } from "../worlds/worlds";
import type { WorldService } from "../worlds/service";

/** The prompt part Build's own words are in, under the guidance folder's `.prompts/`. */
export const BUILD_ANSWERS = "build-answers";

/** What one message is answered with: today's `lre.result` or `lre.error`, and the pushes it caused. */
export interface BuildAnswer {
  result: ResultMessage | ErrorMessage;
  /** Each world whose working copy the request changed, once, as it stands after it. */
  pushes: DraftChanged[];
}

export interface BuildDeps {
  /** His worlds: every operation on one is the world service's. */
  worlds: WorldService;
  writes: WriteQueue;
  /** RPE's store: where a chat's revision is read, and set when a chat attaches. */
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
  constructor(private readonly deps: BuildDeps) {}

  /** The world service this answers over. */
  get worlds(): WorldService {
    return this.deps.worlds;
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
        return reply("lre.editor", await this.worlds.worlds.edit(r, user, noted));
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
    const worlds = this.worlds;
    // What the page sent, for an op this build does not know, where the type has none left.
    const op: unknown = r.op;
    switch (r.op) {
      case "list":
        return { worlds: await worlds.list(user) };
      case "get":
        return await worlds.read(user, r.worldId, r.revision);
      case "create":
        return await worlds.create(user, r.name, r.template);
      case "delete":
        return { worlds: await worlds.remove(user, r.worldId) };
      case "commit":
        return await worlds.commit(user, r.worldId, { base: r.base, source: "build", ...(r.note !== undefined ? { note: r.note } : {}), ...(r.version !== undefined ? { version: r.version } : {}) }, noted);
      case "import":
        return await worlds.importFile(user, r.file);
      case "export":
        return { file: await worlds.exportFile(user, r.worldId, r.revision) };
      case "lint":
        return { lint: await worlds.lint(user, r.worldId, r.revision) };
      case "attach":
        return { revision: await this.attach(r.worldId, r.chatId, user) };
      case "sheet":
        return await worlds.sheet(user, r.worldId, r.ruleset, r.entity);
      case "templates":
        return { templates: worlds.templates() };
      case "updates":
        return { updates: await worlds.updates(user, r.worldId, r.revision) };
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
    return await this.worlds.things(user, r.worldId, r);
  }

  /** A character as its own model (DESIGN §7), Build's: from the world's draft. */
  private async character(r: Request<"lre.character">, user: string): Promise<ResultBodies["lre.character"]> {
    if (r.op !== "get" || typeof r.entity !== "string") throw new Refused("bad_request", "name a character to get");
    if (r.scope === "gm") throw await this.refused("unavailable", "scope", { type: r.type, scope: r.scope });
    if (r.scope !== "build") throw new Refused("bad_request", "the scope is build or gm");
    if (typeof r.worldId !== "string") throw new Refused("bad_request", "name the world");
    return await this.worlds.character(user, r.worldId, r.entity);
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
    const { world, revision } = await this.worlds.worlds.get(worldId, user);
    const s = this.deps.store.user(user);
    const playing = await this.deps.writes.run(() => s.attachWorld({ id: chatId, world: worldId, revision }), "attaching a chat to a world");
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

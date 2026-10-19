// A fake Lumiverse for the CLI's tests: the HTTP routes and the event socket an outside client uses
// (sign-in, the extension list, socket tickets, CONNECTED, SPINDLE_BACKEND_MSG frames), and behind
// them a small LumiRPEngine that keeps worlds, revisions and one versioned draft per world as the
// agent API (AGENT_API 1) describes. Everything it receives is recorded, so a test can say exactly
// what the client sent.

import { STARTER_INFO, STARTER_WORLDS } from "../../src/packs/index";
import type { JsonValue } from "../../src/shared/json";
import { hasOwn, isRecord } from "../../src/shared/json";
import type { LintIssue, MarkerPreview, WorldChatInfo } from "../../src/shared/protocol";
import type { RevisionNote, WorldDoc, WorldIndex } from "../../src/shared/world";
import type { Http, HttpRequest, OpenSocket, SocketEvents } from "../../src/cli/connection";
import { lint, newWorld, revisionOf } from "../../src/studio-api";
import { applyPatch, PatchError, readOp } from "../../src/shared/json-patch";
import { HostConnection } from "../../src/cli/connection";
import { Live } from "../../src/cli/live";
import type { ToolContext } from "../../src/cli/tools";
import { KeyedQueue } from "../../src/cli/tools";

type Payload = Record<string, unknown>;

class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly lint: LintIssue[] = [],
  ) {
    super(message);
  }
}

interface StoredWorld {
  index: WorldIndex;
  /** Kept beside the index, as the backend keeps `history.json`: `list` leaves it out, `get` carries it. */
  history: RevisionNote[];
  revisions: Map<string, WorldDoc>;
  draft: { base: string; doc: WorldDoc; version: number } | null;
  /** The working copy's version while no draft is stored: a discard or commit counts one, and a new draft starts above it. */
  lastVersion: number;
}

/** The engine side: worlds, revisions and drafts in memory, answering the agent API's requests. */
export class FakeLre {
  readonly worlds = new Map<string, StoredWorld>();
  chats: WorldChatInfo[] = [];
  /** Every request, as it arrived. */
  readonly received: Payload[] = [];
  /** What `lre.hello` answers as `agentApi`; undefined answers none, as an older build does. */
  agentApi: number | undefined = 1;
  preview: MarkerPreview = { lines: [] };
  /** Whether an applied Upgrade waits for the chat's turn to end. */
  upgradePending = false;
  private seq = 0;

  /** A world as `create` makes one, from a starter or blank. */
  seed(name: string, template?: string, source: RevisionNote["source"] = "create"): StoredWorld {
    const id = `w_${(++this.seq).toString().padStart(4, "0")}`;
    const make = template !== undefined && hasOwn(STARTER_WORLDS, template) ? STARTER_WORLDS[template] : undefined;
    const doc = make ? make(id, name) : newWorld(id, name);
    const stored: StoredWorld = { index: { id, name, head: "", loreBookId: null, revisions: [] }, history: [], revisions: new Map(), draft: null, lastVersion: 0 };
    this.worlds.set(id, stored);
    this.commitDoc(stored, doc, source);
    return stored;
  }

  private commitDoc(w: StoredWorld, doc: WorldDoc, source: RevisionNote["source"], note?: string): string {
    const issues = lint(doc);
    if (issues.some((i) => i.severity === "error")) throw new Refusal("validation", "the world has errors", issues);
    const rev = revisionOf(doc);
    w.revisions.set(rev, structuredClone(doc));
    w.index = { ...w.index, name: doc.name, head: rev, revisions: [...w.index.revisions.filter((r) => r !== rev), rev] };
    w.history.push({ revision: rev, at: Date.now(), source, ...(note ? { note } : {}) });
    return rev;
  }

  world(id: unknown): StoredWorld {
    const w = typeof id === "string" ? this.worlds.get(id) : undefined;
    if (!w) throw new Refusal("not_found", `world ${String(id)} not found`);
    return w;
  }

  private editorBody(w: StoredWorld): Payload {
    const doc = w.draft?.doc ?? w.revisions.get(w.index.head);
    if (!doc) throw new Refusal("internal", "no head");
    return { draft: structuredClone(doc), lint: lint(doc), base: w.draft?.base ?? w.index.head, stored: w.draft !== null, version: w.draft?.version ?? w.lastVersion };
  }

  private editor(r: Payload): Payload {
    const w = this.world(r.worldId);
    if (r.op === "get") return this.editorBody(w);
    if (typeof r.version === "number" && r.version !== (w.draft?.version ?? w.lastVersion)) throw new Refusal("conflict", "the draft changed; reload and retry");
    if (r.op === "discard") {
      // Dropping a draft counts one, so the working copy never repeats a version (and "no draft" is no fixed number).
      if (w.draft !== null) w.lastVersion = Math.max(w.lastVersion, w.draft.version) + 1;
      w.draft = null;
      return this.editorBody(w);
    }
    if (typeof r.base === "string" && r.base !== (w.draft?.base ?? w.index.head)) throw new Refusal("conflict", "the world changed; reload and retry");
    const current = w.draft?.doc ?? w.revisions.get(w.index.head);
    if (!current) throw new Refusal("internal", "no head");
    let doc: WorldDoc;
    if (r.op === "patch") {
      try {
        doc = applyPatch(current as unknown as JsonValue, (Array.isArray(r.ops) ? r.ops : []).map((op: unknown, i) => readOp(op, i))) as unknown as WorldDoc;
      } catch (error) {
        if (error instanceof PatchError) throw new Refusal("bad_request", error.message);
        throw error;
      }
    } else if (r.op === "restore") {
      const from = typeof r.revision === "string" ? w.revisions.get(r.revision) : undefined;
      if (!from) throw new Refusal("not_found", "unknown revision");
      doc = structuredClone(from);
    } else throw new Refusal("bad_request", `the fake doesn't do editor ${String(r.op)}`);
    w.draft = { base: w.draft?.base ?? w.index.head, doc, version: (w.draft?.version ?? w.lastVersion) + 1 };
    return this.editorBody(w);
  }

  private worldOp(r: Payload): Payload {
    switch (r.op) {
      case "list":
        return { worlds: [...this.worlds.values()].map((w) => structuredClone(w.index)) };
      case "get": {
        const w = this.world(r.worldId);
        const revision = typeof r.revision === "string" ? r.revision : w.index.head;
        const doc = w.revisions.get(revision);
        if (!doc) throw new Refusal("not_found", `revision ${revision} not found`);
        return { world: structuredClone(doc), revision, history: structuredClone(w.history), packKinds: {}, packRelations: {}, functions: [] };
      }
      case "create": {
        if (typeof r.template === "string" && !hasOwn(STARTER_WORLDS, r.template)) throw new Refusal("not_found", `unknown template ${r.template}`);
        const w = this.seed(String(r.name), typeof r.template === "string" ? r.template : undefined);
        return { world: structuredClone(w.revisions.get(w.index.head) ?? null), revision: w.index.head };
      }
      case "delete":
        this.world(r.worldId);
        this.worlds.delete(String(r.worldId));
        return { worlds: [...this.worlds.values()].map((w) => w.index) };
      case "commit": {
        const w = this.world(r.worldId);
        if (typeof r.version === "number" && r.version !== (w.draft?.version ?? w.lastVersion)) throw new Refusal("conflict", `the draft changed since you read it (it is at version ${w.draft?.version ?? w.lastVersion} now); review it and commit again`);
        if (!w.draft) throw new Refusal("bad_request", "no draft");
        if (r.base !== null && r.base !== w.draft.base) throw new Refusal("conflict", "the world changed; reload and retry");
        if (w.draft.base !== w.index.head) throw new Refusal("conflict", "the head moved since this draft began");
        const doc = w.draft.doc;
        const revision = this.commitDoc(w, doc, "agent", typeof r.note === "string" ? r.note : undefined);
        w.lastVersion = Math.max(w.lastVersion, w.draft.version) + 1;
        w.draft = null;
        return { revision, lint: lint(doc) };
      }
      case "import": {
        const file = isRecord(r.file) && isRecord(r.file.world) ? r.file.world : r.file;
        if (!isRecord(file) || file.format !== "lre-world-v1") throw new Refusal("bad_request", "not a lre-world-v1 document");
        const w = this.seed(String(file.name));
        const doc = { ...(file as unknown as WorldDoc), id: w.index.id };
        const revision = this.commitDoc(w, doc, "import");
        return { world: structuredClone(doc), revision, lint: [] };
      }
      case "export": {
        const w = this.world(r.worldId);
        const revision = typeof r.revision === "string" ? r.revision : w.index.head;
        return { file: { format: "lre-world-export-v1", world: structuredClone(w.revisions.get(revision) ?? null) } };
      }
      case "templates":
        return { templates: [...STARTER_INFO] };
      case "chats":
        return { chats: this.chats.filter((c) => (r.worldId === undefined || c.worldId === r.worldId) && (r.chatId === undefined || c.chatId === r.chatId)) };
      case "attach": {
        const w = this.world(r.worldId);
        if (this.chats.some((c) => c.chatId === r.chatId && c.worldId !== r.worldId)) throw new Refusal("conflict", "This chat already plays another world. Start a new chat for this one.");
        this.chats.push({ chatId: String(r.chatId), name: "Chat", worldId: w.index.id, revision: w.index.head, behind: false });
        return { revision: w.index.head };
      }
      case "upgrade":
        return { revision: r.to as JsonValue, pending: this.upgradePending };
    }
    throw new Refusal("bad_request", `the fake doesn't do world ${String(r.op)}`);
  }

  /** One request in, its result or error out, as the backend answers. */
  handle(r: Payload): Payload {
    this.received.push(structuredClone(r));
    const reply = (body: Payload): Payload => ({ lre: 1, type: "lre.result", reqId: r.reqId, request: r.type, body });
    try {
      if (r.type === "lre.hello") return reply(this.agentApi === undefined ? { accepted: true } : { accepted: true, agentApi: this.agentApi });
      if (r.type === "lre.world") return reply(this.worldOp(r));
      if (r.type === "lre.editor") return reply(this.editor(r));
      if (r.type === "lre.marker" && r.kind === "migrate" && r.preview === true) return reply({ pending: false, preview: structuredClone(this.preview) as unknown as JsonValue as Payload });
      throw new Refusal("bad_request", `the fake doesn't do ${String(r.type)}`);
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      return { lre: 1, type: "lre.error", reqId: r.reqId, code: error.code, message: error.message, ...(error.lint.length > 0 ? { lint: error.lint } : {}) };
    }
  }

  /** The requests of one type (and op), without their envelopes' reqIds. */
  sent(type: string, op?: string): Payload[] {
    return this.received.filter((r) => r.type === type && (op === undefined || r.op === op)).map(({ reqId: _reqId, lre: _lre, ...rest }) => rest);
  }
}

export interface FakeSocketRecord {
  url: URL;
  frames: Payload[];
  /** Frames that arrived before CONNECTED, which the host drops. */
  dropped: string[];
  open: boolean;
  events: SocketEvents;
}

export const USER = { username: "tom", password: "hunter2" };

/** The host: HTTP routes and the event socket, over a FakeLre. */
export class FakeLumiverse {
  readonly lre = new FakeLre();
  readonly requests: HttpRequest[] = [];
  readonly sockets: FakeSocketRecord[] = [];
  readonly tokens = new Set<string>();
  extension = { id: "ext-lre-1", identifier: "lumi_rp_engine", name: "LumiRPEngine", version: "0.0.1", enabled: true, status: "running" };
  /** Request types the extension never answers (a stopped or stuck backend). */
  readonly silent = new Set<string>();
  /** CONNECTED is held back while this is set. */
  holdConnected = false;
  private tickets = new Set<string>();
  private seq = 0;

  /** On this machine by default: plain http to another one needs the user's consent (`login --allow-http`). */
  constructor(readonly base = "http://localhost:7860") {}

  /** A session as sign-in would make one. */
  session(): string {
    const token = `tok_${++this.seq}_secret`;
    this.tokens.add(token);
    return token;
  }

  private bearer(req: HttpRequest): boolean {
    const auth = req.headers.Authorization ?? "";
    return auth.startsWith("Bearer ") && this.tokens.has(auth.slice(7));
  }

  readonly http: Http = async (req) => {
    this.requests.push(structuredClone(req));
    const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, header: (n: string) => headers[n.toLowerCase()] ?? null, text: JSON.stringify(body) });
    const path = req.url.slice(this.base.length);
    if (path === "/api/auth/sign-in/username" && req.method === "POST") {
      const body: unknown = JSON.parse(req.body ?? "{}");
      if (!isRecord(body) || body.username !== USER.username || body.password !== USER.password) return reply(401, { message: "Invalid username or password" });
      const token = this.session();
      return reply(200, { token, user: { username: USER.username } }, { "set-auth-token": token });
    }
    if (path === "/api/auth/sign-out" && req.method === "POST") {
      if (!this.bearer(req)) return reply(401, { error: "Unauthorized" });
      this.tokens.delete((req.headers.Authorization ?? "").slice(7));
      return reply(200, { success: true });
    }
    if (path === "/api/auth/get-session") return reply(200, this.bearer(req) ? { session: { expiresAt: "2026-10-25T18:00:00.000Z" }, user: { username: USER.username } } : null);
    if (!this.bearer(req)) return reply(401, { error: "Unauthorized", code: "SESSION_EXPIRED" });
    if (path === "/api/v1/spindle" && req.method === "GET") return reply(200, { extensions: [{ id: "ext-other", identifier: "other_ext", enabled: true, status: "running" }, this.extension], isPrivileged: true });
    if (path === "/api/v1/ws-ticket" && req.method === "POST") {
      const ticket = `ticket_${++this.seq}`;
      this.tickets.add(ticket);
      return reply(200, { ticket });
    }
    return reply(404, { error: "Not found" });
  };

  readonly openSocket: OpenSocket = (url, events) => {
    const record: FakeSocketRecord = { url: new URL(url), frames: [], dropped: [], open: false, events };
    this.sockets.push(record);
    const ticket = record.url.searchParams.get("ticket") ?? "";
    const greet = (): void => {
      if (!this.tickets.delete(ticket)) {
        events.message(JSON.stringify({ event: "AUTH_ERROR", payload: { message: "Invalid or expired ticket" } }));
        events.close(1008, "Invalid or expired ticket");
        return;
      }
      record.open = true;
      events.message(JSON.stringify({ event: "CONNECTED", payload: { message: "Connected to Lumiverse event bus" } }));
    };
    queueMicrotask(() => {
      if (!this.holdConnected) greet();
      else this.pendingGreetings.push(greet);
    });
    return {
      send: (text) => {
        if (!record.open) {
          record.dropped.push(text);
          return;
        }
        const frame: unknown = JSON.parse(text);
        if (!isRecord(frame)) return;
        record.frames.push(frame);
        if (frame.type === "ping") return queueMicrotask(() => events.message(JSON.stringify({ type: "pong" })));
        if (frame.type !== "SPINDLE_BACKEND_MSG" || frame.extensionId !== this.extension.id || this.extension.status !== "running" || !isRecord(frame.payload)) return;
        const payload = frame.payload;
        if (this.silent.has(String(payload.type))) return;
        const data = this.lre.handle(payload);
        queueMicrotask(() => {
          if (!record.open) return;
          // A push the client doesn't wait for comes first, as the host's interleave can put one.
          events.message(JSON.stringify({ event: "SPINDLE_FRONTEND_MSG", payload: { extensionId: this.extension.id, identifier: "lumi_rp_engine", data: { lre: 1, type: "lre.draft.changed", worldId: "w_x", version: 1, stored: true, base: null } } }));
          events.message(JSON.stringify({ event: "SPINDLE_FRONTEND_MSG", payload: { extensionId: this.extension.id, identifier: "lumi_rp_engine", data } }));
        });
      },
      close: () => {
        if (!record.open) return;
        record.open = false;
        queueMicrotask(() => events.close(1000, ""));
      },
    };
  };

  private readonly pendingGreetings: (() => void)[] = [];

  /** Lets held-back CONNECTED frames through. */
  release(): void {
    this.holdConnected = false;
    for (const greet of this.pendingGreetings.splice(0)) greet();
  }

  /** The server restarts: every socket closes and every ticket is lost. */
  restart(): void {
    this.tickets.clear();
    for (const s of this.sockets.filter((x) => x.open)) {
      s.open = false;
      s.events.close(1001, "server restart");
    }
  }

  /** Frames of LRE requests, in order, across every socket. */
  get frames(): Payload[] {
    return this.sockets.flatMap((s) => s.frames).filter((f) => f.type === "SPINDLE_BACKEND_MSG");
  }
}

/** A signed-in client of the fake: its connection, its worlds and the tools' context over them. */
export function client(fake: FakeLumiverse, options: { readOnly?: boolean; timeoutMs?: number; files?: Record<string, string> } = {}): { ctx: ToolContext; conn: HostConnection; token: string } {
  const token = fake.session();
  const conn = new HostConnection({ base: fake.base, credentials: () => ({ username: USER.username, token }), http: fake.http, openSocket: fake.openSocket, client: { name: "lumirpengine", version: "0.0.1" }, timeoutMs: options.timeoutMs ?? 3000 });
  const live = new Live(conn);
  const queue = new KeyedQueue();
  const files = options.files ?? {};
  const ctx: ToolContext = {
    readFile: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
      return text;
    },
    readOnly: options.readOnly ?? false,
    live: () => live,
    serialize: (key, work) => queue.run(key, work),
  };
  return { ctx, conn, token };
}

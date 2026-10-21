// Outside MCP servers (DESIGN §23): this build and where its agent kit is, what each server checks
// in with, and the notice after an update. A server's latest check-in (it is known by its name, its
// machine and the harness that runs it) is kept in the user's storage with when it was seen. Since
// the extension started, each of a server's processes (a session of its own) is kept apart as well,
// and a server stands as the one furthest behind of those heard from lately: one process that
// reloaded doesn't make another that lags "updated". The build the extension last started as is
// kept in extension storage, so starting as another one is an update: each user's next page hello
// gets a notice for the top of the drawer, shown until dismissed, and a toast once.

import type { AgentClientView, AgentState, AgentsView, FollowCode, KitReport } from "../shared/agents";
import { CORE_FILE, followCommand, KIT_API, KIT_FILE, pathOfFileUrl } from "../shared/agents";
import { hashParts } from "../shared/hash";
import type { UserId } from "../shared/ids";
import { hasOwn, isRecord } from "../shared/json";
import type { AgentsRequest, ResultBodies } from "../shared/protocol";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

export interface BuildInfo {
  /** The id `bun run build` gives every bundle of one build; "dev" when run from source. */
  id: string;
  /** Where this build's agent kit is; null when it has none (run from source, as the tests are). */
  kit: KitReport | null;
}

/**
 * This build, from what the build defined into it and this module's own URL. Bundled, that is
 * dist/backend.js, which Lumiverse's worker imports by its absolute path in the installed
 * extension (`<data>/extensions/<identifier>/repo/dist/`), with the kit and the core beside it.
 */
export function thisBuild(moduleUrl = import.meta.url): BuildInfo {
  const dir = moduleUrl.replace(/[^/]*$/, "");
  const path = pathOfFileUrl(`${dir}${KIT_FILE}`);
  const core = pathOfFileUrl(`${dir}${CORE_FILE}`);
  const sha256 = process.env.LRE_KIT_SHA256;
  return { id: process.env.LRE_BUILD_ID ?? "dev", kit: sha256 !== undefined && path !== null && core !== null ? { path, core, sha256, api: KIT_API } : null };
}

/** The build the extension last started as, in extension storage. */
const BUILD_FILE = "agents/build.json";
/** Each user's servers and the notice's state, in their storage. */
const USER_FILE = "agents.json";
/** Servers kept per user, the most recently seen: a check-in from anywhere adds one. */
const CLIENTS_KEPT = 32;
/** Open sessions remembered: one per server process. */
const SESSIONS_KEPT = 256;
/** How long a process counts toward its server's line after it last checked in or looked: two of its minute's looks. */
const LIVE_MS = 120_000;

/** A server's states, worst first: its line is its worst process's. One from before check-ins is a line of its own, never mixed with these. */
const RANK: Record<AgentState, number> = { old: 0, cannot: 1, behind: 2, updated: 3 };

/** The build the extension started as, and the one before it when that start was an update. */
interface StartedAs {
  build: string;
  previous: string | null;
  at: number;
}

interface StoredClient {
  name: string;
  version: string;
  host: string | null;
  harness: string | null;
  core: string | null;
  kit: string | null;
  follows: boolean;
  why: { code: FollowCode | "other"; text: string } | null;
  seen: number;
}

/** One server process, as its own session last told the extension since it started. */
interface Heard {
  /** The server it checked in as. */
  id: string;
  /** Its latest check-in. */
  client: StoredClient;
  /** When it last checked in or looked, in ms since the epoch. */
  seen: number;
}

interface UserAgents {
  v: 1;
  clients: Record<string, StoredClient>;
  /** The build whose update was toasted to this user, and the one whose notice they dismissed. */
  toasted: string | null;
  dismissed: string | null;
}

const FOLLOW_CODES: Record<FollowCode, true> = { pinned: true, runtime: true, unsupported: true, no_kit: true, kit_api: true, refused: true, unsafe: true, elsewhere: true, unreadable: true, mismatch: true, broken: true };

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What a client sent, fit for a log line and a page: no control characters, and bounded. */
function shown(text: string, max: number): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

/**
 * A hello's client (or a stored one) as kept: null for no client, and for a command-line run, which
 * doesn't check in. A client from before check-ins sends only its name and version, so its kit is null.
 */
function checkInOf(client: unknown, seen: number): StoredClient | null {
  if (!isRecord(client) || typeof client.name !== "string" || typeof client.version !== "string" || client.serves === "command") return null;
  const text = (value: unknown, max: number): string | null => (typeof value === "string" && shown(value, max) !== "" ? shown(value, max) : null);
  const follows = client.follows === true;
  const why = !follows && isRecord(client.why) && typeof client.why.text === "string" ? { code: typeof client.why.code === "string" && hasOwn(FOLLOW_CODES, client.why.code) ? (client.why.code as FollowCode) : ("other" as const), text: shown(client.why.text, 400) } : null;
  return { name: shown(client.name, 80), version: shown(client.version, 40), host: text(client.host, 80), harness: text(client.harness, 80), core: text(client.core, 40), kit: text(client.kit, 40), follows, why, seen };
}

/**
 * A server's id: its name, its machine and the harness that runs it, so Claude Code's and Codex's on
 * one machine are two, and a restarted one (or another process of the same harness) is the same. One
 * that names no harness keeps the id it had before harnesses were sent. One from before check-ins
 * (no kit) is kept apart from every server that follows, so neither overwrites the other's state.
 */
function idOf(client: StoredClient): string {
  if (client.kit === null) return hashParts("lre.agent.old", client.name).slice(0, 16);
  const machine = client.host ?? "";
  return (client.harness === null ? hashParts("lre.agent", client.name, machine) : hashParts("lre.agent", client.name, machine, client.harness)).slice(0, 16);
}

/** How a server stands against this build: its kit is this build's, it is from before check-ins, it can't follow, or it hasn't reloaded yet. */
function stateOf(client: StoredClient, build: string): AgentState {
  if (client.kit === build) return "updated";
  if (client.kit === null) return "old";
  return client.follows ? "behind" : "cannot";
}

/** Of a server's processes, the one furthest behind this build (the latest check-in of any level with it); null for none. */
function worstOf(heard: readonly Heard[], build: string): Heard | null {
  let worst: Heard | null = null;
  for (const h of heard) {
    const by = worst === null ? -1 : RANK[stateOf(h.client, build)] - RANK[stateOf(worst.client, build)];
    if (by < 0 || (by === 0 && worst !== null && h.client.seen > worst.client.seen)) worst = h;
  }
  return worst;
}

export class Agents {
  /** Each user's file, read once. */
  private readonly users = new Map<UserId, Promise<UserAgents>>();
  /** Each user's writes, one after another. */
  private readonly writes = new Map<UserId, Promise<void>>();
  /** Work not yet done (check-ins, notices), for `settle`. */
  private readonly working = new Set<Promise<void>>();
  /** Each open session's process, by `user \0 session`: the server it checked in as, what it said and when it was last heard. */
  private readonly sessions = new Map<string, Heard>();
  private started: Promise<StartedAs>;

  constructor(
    private readonly host: HostPort,
    readonly build: BuildInfo,
    private readonly now: () => number = Date.now,
  ) {
    this.started = Promise.resolve({ build: build.id, previous: null, at: 0 });
  }

  start(): void {
    this.started = this.compare();
    this.host.on("FRONTEND_SESSION_CLOSED", (e, userId) => {
      // A closed session's process is gone: it no longer counts toward its server's line, and Settings → MCP server says which servers are connected.
      if (userId === null || !this.sessions.delete(`${userId}\u0000${e.frontendSessionId}`)) return;
      this.track(this.tell(userId), "the MCP servers' view wasn't sent");
    });
  }

  /** Resolves once every check-in, notice and change so far is written and told. */
  async settle(): Promise<void> {
    await this.started;
    while (this.working.size > 0) await Promise.all([...this.working]);
    await Promise.all([...this.writes.values()]);
  }

  /** The build the extension last started as, and this one kept in its place: another one is an update. */
  private async compare(): Promise<StartedAs> {
    const fresh: StartedAs = { build: this.build.id, previous: null, at: this.now() };
    let text: string | null;
    try {
      text = await this.host.extensionStorage.read(BUILD_FILE);
    } catch (error) {
      // Unreadable is not "never ran": this start says nothing, and the file stays for the next one.
      this.host.log("warn", `[LumiRPEngine] the build the extension last ran as couldn't be read (${errorText(error)}); this start shows no update notice`);
      return fresh;
    }
    let last: StartedAs | null = null;
    try {
      const raw: unknown = JSON.parse(text ?? "null");
      if (isRecord(raw) && typeof raw.build === "string" && (typeof raw.previous === "string" || raw.previous === null) && typeof raw.at === "number") last = { build: raw.build, previous: raw.previous, at: raw.at };
    } catch {
      // A damaged file is the same as none: this start is the first.
    }
    // The same build again: its update's notice stays until each user dismisses it.
    if (last?.build === this.build.id) return last;
    const now: StartedAs = { ...fresh, previous: last?.build ?? null };
    try {
      await this.host.extensionStorage.write(BUILD_FILE, JSON.stringify(now));
    } catch (error) {
      this.host.log("warn", `[LumiRPEngine] the build the extension started as couldn't be kept (${errorText(error)}); the next start will see this update again`);
    }
    return now;
  }

  /**
   * An outside client's hello (DESIGN §23): this build and where its kit is, for the hello to
   * answer. An MCP server's check-in is kept, with the session it came on, and its id answered.
   */
  meet(userId: UserId, session: string | undefined, client: unknown): Pick<ResultBodies["lre.hello"], "build" | "kit" | "client"> {
    const answer = { build: this.build.id, kit: this.build.kit };
    const checkIn = checkInOf(client, this.now());
    if (checkIn === null) return answer;
    // Known by its name, machine and harness: a restarted server, or another process of it, is the same one.
    const id = idOf(checkIn);
    if (session !== undefined) {
      // Each process says hello on a session of its own: its state is kept apart from its server's others.
      const key = `${userId}\u0000${session}`;
      this.sessions.delete(key);
      this.sessions.set(key, { id, client: checkIn, seen: checkIn.seen });
      for (const oldest of this.sessions.keys()) {
        if (this.sessions.size <= SESSIONS_KEPT) break;
        this.sessions.delete(oldest);
      }
    }
    this.track(
      this.change(userId, (file) => {
        file.clients[id] = checkIn;
        file.clients = Object.fromEntries(Object.entries(file.clients).sort(([, a], [, b]) => b.seen - a.seen).slice(0, CLIENTS_KEPT));
      }),
      "an MCP server's check-in wasn't kept",
    );
    return { ...answer, client: id };
  }

  /** A page's hello: a waiting update notice is shown there, with a toast the first time. */
  page(userId: UserId, session: string | undefined): void {
    this.track(this.notice(userId, session), "the update notice wasn't shown");
  }

  private async notice(userId: UserId, session: string | undefined): Promise<void> {
    const started = await this.started;
    if (started.previous === null) return;
    const file = await this.file(userId);
    if (file.dismissed === started.build) return;
    this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.agents.changed", view: this.viewOf(userId, file, started) }, userId, session);
    if (file.toasted === started.build) return;
    // Marked before the write, so a second page saying hello meanwhile doesn't toast again.
    file.toasted = started.build;
    this.save(userId, file);
    this.host.toast(Object.keys(file.clients).length > 0 ? `Updated to build ${started.build}. The drawer says how each of your MCP servers took it.` : `Updated to build ${started.build}.`, userId);
  }

  async request(r: AgentsRequest, userId: UserId, session: string | undefined): Promise<ResultBodies["lre.agents"]> {
    if (r.op === "kit") {
      const heard = session === undefined ? undefined : this.sessions.get(`${userId}\u0000${session}`);
      if (heard !== undefined) {
        // A server's look is its process heard from. One that had gone quiet counts toward its line again, so its pages are told.
        const now = this.now();
        const quiet = now - heard.seen > LIVE_MS;
        heard.seen = now;
        if (quiet) this.track(this.tell(userId), "the MCP servers' view wasn't sent");
      }
      return { build: this.build.id, kit: this.build.kit, known: heard !== undefined };
    }
    if (r.op === "update") {
      // To every session of the user, not the ones on record: after a restart the extension hasn't heard from a server again until its next check.
      if (typeof r.client === "string") this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.kit.reload", client: r.client }, userId);
    } else if (r.op === "dismiss") {
      const { build } = await this.started;
      await this.change(userId, (file) => {
        file.dismissed = build;
      });
    } else if (r.op === "forget") {
      await this.change(userId, (file) => {
        if (typeof r.client === "string") delete file.clients[r.client];
      });
    }
    return { view: await this.view(userId) };
  }

  private async view(userId: UserId): Promise<AgentsView> {
    return this.viewOf(userId, await this.file(userId), await this.started);
  }

  private viewOf(userId: UserId, file: UserAgents, started: StartedAs): AgentsView {
    const prefix = `${userId}\u0000`;
    const now = this.now();
    const connected = new Set<string>();
    /** Each server's processes heard from in the last LIVE_MS: a quiet one may be hung or asleep, and no longer says how its server stands. */
    const live = new Map<string, Heard[]>();
    for (const [key, heard] of this.sessions) {
      if (!key.startsWith(prefix)) continue;
      connected.add(heard.id);
      if (now - heard.seen > LIVE_MS) continue;
      const same = live.get(heard.id);
      if (same) same.push(heard);
      else live.set(heard.id, [heard]);
    }
    const build = this.build.id;
    const kit = this.build.kit;
    return {
      build,
      notice: started.previous !== null && file.dismissed !== started.build ? { build: started.build, previous: started.previous, at: started.at } : null,
      setup: kit === null ? null : { core: kit.core, command: followCommand(kit.core) },
      clients: Object.entries(file.clients)
        .sort(([, a], [, b]) => b.seen - a.seen)
        .map(([id, stored]): AgentClientView => {
          const heard = live.get(id) ?? [];
          // None heard lately (after a restart, or all quiet): the last check-in says how it stands.
          const client = worstOf(heard, build)?.client ?? stored;
          return { id, ...client, seen: stored.seen, connected: connected.has(id), processes: heard.length, state: stateOf(client, build) };
        }),
    };
  }

  /** The servers' view, to every session of the user: Settings → MCP server and the notice update as servers check in. */
  private async tell(userId: UserId): Promise<void> {
    this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.agents.changed", view: await this.view(userId) }, userId);
  }

  private track(work: Promise<void>, failed: string): void {
    const tracked = work.catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] ${failed} (${errorText(error)})`));
    this.working.add(tracked);
    void tracked.finally(() => this.working.delete(tracked));
  }

  /** Changes the user's file, writes it after the writes before it, and tells their pages. */
  private async change(userId: UserId, edit: (file: UserAgents) => void): Promise<void> {
    const file = await this.file(userId);
    edit(file);
    this.save(userId, file);
    await this.tell(userId);
  }

  private save(userId: UserId, file: UserAgents): void {
    // The file as it is when its turn comes: a burst of changes writes the latest.
    const write = (this.writes.get(userId) ?? Promise.resolve()).then(() => this.host.storage.write(USER_FILE, JSON.stringify(file), userId)).catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] the MCP servers' file wasn't written (${errorText(error)})`, userId));
    this.writes.set(userId, write);
  }

  private file(userId: UserId): Promise<UserAgents> {
    const cached = this.users.get(userId);
    if (cached) return cached;
    const read = readStoredJson(this.host, USER_FILE, userId, "MCP servers", (raw) => isRecord(raw) && raw.v === 1 && isRecord(raw.clients)).then((raw): UserAgents => {
      const stored = isRecord(raw) ? raw : {};
      const clients: Record<string, StoredClient> = {};
      for (const entry of Object.values(isRecord(stored.clients) ? stored.clients : {})) {
        const client = isRecord(entry) && typeof entry.seen === "number" ? checkInOf(entry, entry.seen) : null;
        if (client === null) continue;
        // Keyed again as `meet` keys it, so an id kept under an earlier rule is this one's, and the latest of any two that meet wins.
        const id = idOf(client);
        if ((clients[id]?.seen ?? Number.NEGATIVE_INFINITY) < client.seen) clients[id] = client;
      }
      return { v: 1, clients, toasted: typeof stored.toasted === "string" ? stored.toasted : null, dismissed: typeof stored.dismissed === "string" ? stored.dismissed : null };
    });
    this.users.set(userId, read);
    // A read that failed is tried again next time, and never written over.
    void read.catch(() => this.users.delete(userId));
    return read;
  }
}

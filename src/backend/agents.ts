// Outside MCP servers (DESIGN §23): this build and where its agent kit is, what each server checks
// in with, and the notice after an update. A server's latest check-in (it is known by its name, its
// machine and the harness that runs it) is kept in the user's storage with when it was seen. Each of
// a server's processes (a session of its own) is kept apart as well, and a server stands as the one
// furthest behind of those heard from lately: one process that reloaded doesn't make another that
// lags "updated". The processes heard lately are kept in the user's storage too, so a restart (an
// update is one) still counts each until it says hello again, closes or goes quiet. The build the
// extension last started as is kept in extension storage, so starting as another one is an update:
// each user's next page hello gets a notice for the top of the drawer, shown until dismissed, and a
// toast once. A server Lumiverse runs itself keeps the tool list Lumiverse's client got when it
// connected: Reconnect in Lumiverse asks its processes holding an old list to exit, so Lumiverse
// connects them again, and waits for them back (G13).

import type { AgentClientView, AgentState, AgentsView, FollowCode, KitReport, LumiverseProfileView, ReconnectView } from "../shared/agents";
import { CORE_FILE, followCommands, KIT_API, KIT_FILE, LUMIVERSE_HARNESS, pathOfFileUrl } from "../shared/agents";
import { hashParts } from "../shared/hash";
import type { UserId } from "../shared/ids";
import { hasOwn, isRecord } from "../shared/json";
import type { Limit } from "../shared/minds";
import type { AgentsRequest, ResultBodies } from "../shared/protocol";
import { PROTOCOL_VERSION } from "../shared/protocol";
import { timerMs } from "../shared/timeouts";
import type { HostPort } from "./host";
import { holdsBuild, lreProfiles } from "./lumiverse-mcp";
import { readStoredJson } from "./stored-json";

export interface BuildInfo {
  /** The id `bun run build` gives every bundle of one build; "dev" when run from source. */
  id: string;
  /** Where this build's agent kit is; null when it has none (run from source, as the tests are). */
  kit: KitReport | null;
  /** The fingerprints of its kit's two tool lists (read-only and full), which `bun run build` defines; none when run from source. */
  tools: string[];
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
  const tools = [process.env.LRE_TOOLS_FULL, process.env.LRE_TOOLS_READ_ONLY].filter((f): f is string => f !== undefined);
  return { id: process.env.LRE_BUILD_ID ?? "dev", kit: sha256 !== undefined && path !== null && core !== null ? { path, core, sha256, api: KIT_API } : null, tools };
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
/** How often a Reconnect in Lumiverse asks Spindle again whether Lumiverse's client has this build's tools: it lists them just after the server checks in. */
const RECONNECT_POLL_MS = 1_000;

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
  /** The build whose tools its client last listed (null: not yet); absent from a core from before Reconnect in Lumiverse. */
  listed?: string | null;
}

/** Reconnect in Lumiverse under way for one server (DESIGN §23, G13). */
interface Reconnecting {
  /** The sessions of its processes asked to exit. */
  asked: Set<string>;
  /** Its sessions when they were asked: a process back from Lumiverse is a session not among them. */
  before: Set<string>;
  /** Lumiverse's profiles of it that held another build's tools then, checked through Spindle; null without `mcp_servers`, or with none found. */
  profiles: string[] | null;
  at: number;
  /** Settings → Timeouts → MCP server reconnect. */
  wait: Limit;
  late: boolean;
  timers: Timer[];
}

/** One server process, as its own session last told the extension (this run, or the one before a restart). */
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
  return { name: shown(client.name, 80), version: shown(client.version, 40), host: text(client.host, 80), harness: text(client.harness, 80), core: text(client.core, 40), kit: text(client.kit, 40), follows, why, seen, ...(hasOwn(client, "listed") ? { listed: text(client.listed, 40) } : {}) };
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

/** A process whose Lumiverse client holds another build's tools than it serves, and which exits when asked so Lumiverse connects it again. */
function isStale(client: StoredClient): boolean {
  return client.harness === LUMIVERSE_HARNESS && typeof client.listed === "string" && client.listed !== client.kit;
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
  /**
   * The processes heard lately before the extension (re)started, from the user's file, by the same
   * key: each still counts toward its server's line, but isn't connected or known, until its session
   * says hello again (and is heard in `sessions`), closes, or goes unheard for LIVE_MS.
   */
  private readonly restored = new Map<string, Heard>();
  /** Reconnect in Lumiverse under way, by `user \0 server`. */
  private readonly reconnecting = new Map<string, Reconnecting>();
  private started: Promise<StartedAs>;

  constructor(
    private readonly host: HostPort,
    readonly build: BuildInfo,
    /** The user's Settings → Timeouts → MCP server reconnect. */
    private readonly reconnectWait: (userId: UserId) => Promise<Limit>,
    private readonly now: () => number = Date.now,
  ) {
    this.started = Promise.resolve({ build: build.id, previous: null, at: 0 });
  }

  start(): void {
    this.started = this.compare();
    this.host.on("FRONTEND_SESSION_CLOSED", (e, userId) => {
      if (userId === null) return;
      // A closed session's process is gone: it no longer counts toward its server's line, and Settings → MCP server says which servers are connected.
      const key = `${userId}\u0000${e.frontendSessionId}`;
      const heard = this.sessions.get(key);
      this.sessions.delete(key);
      if (!this.restored.delete(key) && heard === undefined) return;
      this.track(
        this.change(userId, () => undefined),
        "the MCP servers' view wasn't sent",
      );
      // A process asked to exit has: Lumiverse connects it again.
      if (heard !== undefined && this.reconnecting.has(`${userId}\u0000${heard.id}`)) this.track(this.confirm(userId, heard.id), "Reconnect in Lumiverse wasn't checked");
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
      this.restored.delete(key);
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
    // A process back from Lumiverse checks in at once, and again once its client has listed its tools.
    if (this.reconnecting.has(`${userId}\u0000${id}`)) this.track(this.confirm(userId, id), "Reconnect in Lumiverse wasn't checked");
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
    const toast = file.toasted !== started.build;
    if (toast) {
      // Marked before the view is read (it may ask Spindle), so a second page saying hello meanwhile doesn't toast again.
      file.toasted = started.build;
      this.save(userId, file);
    }
    this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.agents.changed", view: await this.viewOf(userId, file, started) }, userId, session);
    if (toast) this.host.toast(Object.keys(file.clients).length > 0 ? `Updated to build ${started.build}. The drawer says how each of your MCP servers took it.` : `Updated to build ${started.build}.`, userId);
  }

  async request(r: AgentsRequest, userId: UserId, session: string | undefined): Promise<ResultBodies["lre.agents"]> {
    if (r.op === "kit") {
      const heard = session === undefined ? undefined : this.sessions.get(`${userId}\u0000${session}`);
      if (heard !== undefined) {
        // A server's look is its process heard from: kept, so a restart still counts it. One that had gone quiet counts toward its line again, so its pages are told.
        const now = this.now();
        const quiet = now - heard.seen > LIVE_MS;
        heard.seen = now;
        this.track(
          this.file(userId).then((file) => this.save(userId, file)),
          "an MCP server's look wasn't kept",
        );
        if (quiet) this.track(this.tell(userId), "the MCP servers' view wasn't sent");
      }
      return { build: this.build.id, kit: this.build.kit, known: heard !== undefined };
    }
    if (r.op === "update") {
      // To every session of the user, not the ones on record: after a restart the extension hasn't heard from a server again until its next check.
      if (typeof r.client === "string") this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.kit.reload", client: r.client }, userId);
    } else if (r.op === "reconnect") {
      if (typeof r.client === "string") await this.reconnect(userId, r.client);
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

  /**
   * Reconnect in Lumiverse (DESIGN §23, G13), on the user's press alone: Spindle can't reconnect a
   * profile, but Lumiverse's client connects a stdio server again about a second after it exits. So
   * the line's processes whose Lumiverse client holds another build's tools are asked, each on its
   * own session, to exit once their calls are answered (the core checks again, and only a
   * Lumiverse-run one does). Back is: with `mcp_servers`, each profile that held an old list holding
   * this build's, by Spindle; without it, each process gone and as many new ones having listed this
   * build's tools. Not back within the user's wait, the line says so.
   */
  private async reconnect(userId: UserId, id: string): Promise<void> {
    const prefix = `${userId}\u0000`;
    const asked = new Set<string>();
    const before = new Set<string>();
    for (const [key, heard] of this.sessions) {
      if (!key.startsWith(prefix) || heard.id !== id) continue;
      before.add(key.slice(prefix.length));
      if (isStale(heard.client)) asked.add(key.slice(prefix.length));
    }
    // None holds an old list now (it is back, or its processes went): the view says how it stands.
    if (asked.size === 0) return;
    let profiles: string[] | null = null;
    if (this.host.mcp.granted()) {
      try {
        profiles = (await lreProfiles(this.host.mcp, userId, this.build.tools)).filter((p) => !p.current).map((p) => p.id);
      } catch (error) {
        this.host.log("warn", `[LumiRPEngine] Lumiverse's MCP server profiles couldn't be read (${errorText(error)}); Reconnect in Lumiverse checks only the server's own processes`, userId);
      }
    }
    const key = `${prefix}${id}`;
    this.stop(key);
    const r: Reconnecting = { asked, before, profiles: profiles !== null && profiles.length > 0 ? profiles : null, at: this.now(), wait: await this.reconnectWait(userId), late: false, timers: [] };
    this.reconnecting.set(key, r);
    for (const session of asked) this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.kit.reconnect", client: id }, userId, session);
    const ms = timerMs(r.wait);
    if (ms !== null) r.timers.push(setTimeout(() => this.track(this.confirm(userId, id), "Reconnect in Lumiverse wasn't checked"), ms));
    // Lumiverse's list changes with no word to the extension: it is asked again until it is this build's.
    if (r.profiles !== null) r.timers.push(setInterval(() => this.track(this.confirm(userId, id), "Reconnect in Lumiverse wasn't checked"), RECONNECT_POLL_MS));
  }

  /** Whether a Reconnect in Lumiverse is back; once it is, the line no longer waits; past its wait, the line says it isn't. */
  private async confirm(userId: UserId, id: string): Promise<void> {
    const key = `${userId}\u0000${id}`;
    const r = this.reconnecting.get(key);
    if (r === undefined) return;
    const back = await this.isBack(userId, id, r);
    // Pressed again meanwhile: that one is checked on its own.
    if (this.reconnecting.get(key) !== r) return;
    if (back) {
      this.stop(key);
      await this.tell(userId);
    } else if (!r.late && this.overdue(r)) {
      r.late = true;
      for (const timer of r.timers) clearTimeout(timer);
      await this.tell(userId);
    }
  }

  private async isBack(userId: UserId, id: string, r: Reconnecting): Promise<boolean> {
    if (r.profiles !== null) {
      try {
        const statuses = await Promise.all(r.profiles.map((p) => this.host.mcp.status(p, userId)));
        return statuses.every((s) => s.connected && holdsBuild(s.tools, this.build.tools));
      } catch (error) {
        // A profile mid-reconnect, gone, or the permission taken back: not back yet, and the wait still runs.
        this.host.log("debug", `[LumiRPEngine] Reconnect in Lumiverse: Spindle couldn't say whether Lumiverse has this build's tools (${errorText(error)})`, userId);
        return false;
      }
    }
    const prefix = `${userId}\u0000`;
    let returned = 0;
    for (const [key, heard] of this.sessions) {
      if (!key.startsWith(prefix) || heard.id !== id) continue;
      const session = key.slice(prefix.length);
      if (r.asked.has(session)) return false;
      if (!r.before.has(session) && heard.client.listed === this.build.id && heard.client.kit === this.build.id) returned++;
    }
    return returned >= r.asked.size;
  }

  private overdue(r: Reconnecting): boolean {
    return r.late || (r.wait !== "none" && this.now() - r.at >= r.wait);
  }

  private stop(key: string): void {
    const r = this.reconnecting.get(key);
    if (r === undefined) return;
    for (const timer of r.timers) clearTimeout(timer);
    this.reconnecting.delete(key);
  }

  private async view(userId: UserId): Promise<AgentsView> {
    return this.viewOf(userId, await this.file(userId), await this.started);
  }

  private async viewOf(userId: UserId, file: UserAgents, started: StartedAs): Promise<AgentsView> {
    const prefix = `${userId}\u0000`;
    const now = this.now();
    const connected = new Set<string>();
    /** Each server's processes heard from in the last LIVE_MS: a quiet one may be hung or asleep, and no longer says how its server stands. */
    const live = new Map<string, Heard[]>();
    /** Each server's connected processes whose Lumiverse client holds an old list. */
    const stale = new Map<string, number>();
    for (const [key, heard] of this.sessions) {
      if (!key.startsWith(prefix)) continue;
      connected.add(heard.id);
      if (isStale(heard.client)) stale.set(heard.id, (stale.get(heard.id) ?? 0) + 1);
      if (now - heard.seen > LIVE_MS) continue;
      const same = live.get(heard.id);
      if (same) same.push(heard);
      else live.set(heard.id, [heard]);
    }
    // A process from before the restart counts as it was, while it is recent; it isn't known to be connected.
    for (const [key, heard] of this.restored) {
      if (!key.startsWith(prefix) || this.sessions.has(key) || now - heard.seen > LIVE_MS) continue;
      const same = live.get(heard.id);
      if (same) same.push(heard);
      else live.set(heard.id, [heard]);
    }
    const build = this.build.id;
    const kit = this.build.kit;
    const profiles = Object.values(file.clients).some((c) => c.harness === LUMIVERSE_HARNESS) ? await this.profilesOf(userId) : null;
    return {
      build,
      notice: started.previous !== null && file.dismissed !== started.build ? { build: started.build, previous: started.previous, at: started.at } : null,
      setup: kit === null ? null : { core: kit.core, commands: followCommands(kit.core) },
      clients: Object.entries(file.clients)
        .sort(([, a], [, b]) => b.seen - a.seen)
        .map(([id, stored]): AgentClientView => {
          const heard = live.get(id) ?? [];
          // None heard lately (after a restart, or all quiet): the last check-in says how it stands.
          const { listed: _listed, ...client } = worstOf(heard, build)?.client ?? stored;
          const r = this.reconnecting.get(`${prefix}${id}`);
          const reconnect: ReconnectView | null = r === undefined ? null : { state: this.overdue(r) ? "late" : "waiting", waitMs: r.wait === "none" ? null : r.wait, through: r.profiles !== null ? "lumiverse" : "server" };
          const lumiverse = client.harness === LUMIVERSE_HARNESS ? { stale: stale.get(id) ?? 0, unknown: heard.filter((h) => h.client.listed === undefined).length, profiles, reconnect } : null;
          return { id, ...client, seen: stored.seen, connected: connected.has(id), processes: heard.length, state: stateOf(client, build), lumiverse };
        }),
    };
  }

  /** Lumiverse's profiles that run lumirpengine, by name and whether each holds this build's tools; null without `mcp_servers`, or when Spindle can't say. */
  private async profilesOf(userId: UserId): Promise<LumiverseProfileView[] | null> {
    if (!this.host.mcp.granted()) return null;
    try {
      return (await lreProfiles(this.host.mcp, userId, this.build.tools)).map((p) => ({ name: p.name, current: p.current }));
    } catch (error) {
      this.host.log("warn", `[LumiRPEngine] Lumiverse's MCP server profiles couldn't be read (${errorText(error)}); the MCP servers' lines say only what the servers do`, userId);
      return null;
    }
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
    // The file as it is when its turn comes: a burst of changes writes the latest, with the processes heard lately.
    const write = (this.writes.get(userId) ?? Promise.resolve()).then(() => this.host.storage.write(USER_FILE, JSON.stringify({ ...file, processes: this.recent(userId) }), userId)).catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] the MCP servers' file wasn't written (${errorText(error)})`, userId));
    this.writes.set(userId, write);
  }

  /** The user's processes heard in the last LIVE_MS, by session: those from before the restart, then this run's over them. */
  private recent(userId: UserId): Record<string, Heard> {
    const prefix = `${userId}\u0000`;
    const now = this.now();
    const out = new Map<string, Heard>();
    for (const map of [this.restored, this.sessions]) {
      for (const [key, heard] of map) if (key.startsWith(prefix) && now - heard.seen <= LIVE_MS) out.set(key.slice(prefix.length), heard);
    }
    return Object.fromEntries(out);
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
      // The processes heard lately before this start: each counts until it says hello again, closes or goes quiet.
      const now = this.now();
      for (const [session, entry] of Object.entries(isRecord(stored.processes) ? stored.processes : {})) {
        if (!isRecord(entry) || typeof entry.seen !== "number" || now - entry.seen > LIVE_MS || !isRecord(entry.client) || typeof entry.client.seen !== "number") continue;
        const client = checkInOf(entry.client, entry.client.seen);
        const key = `${userId}\u0000${session}`;
        if (client === null || this.sessions.has(key) || this.restored.size >= SESSIONS_KEPT) continue;
        this.restored.set(key, { id: idOf(client), client, seen: entry.seen });
      }
      return { v: 1, clients, toasted: typeof stored.toasted === "string" ? stored.toasted : null, dismissed: typeof stored.dismissed === "string" ? stored.dismissed : null };
    });
    this.users.set(userId, read);
    // A read that failed is tried again next time, and never written over.
    void read.catch(() => this.users.delete(userId));
    return read;
  }
}

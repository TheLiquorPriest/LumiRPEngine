// The MCP server's session (DESIGN §23): its one connection to LumiRPEngine, the kit its tools come
// from, and following the extension's kit. It looks at what kit LumiRPEngine has on connecting (the
// hello's answer), before a call once the last look is 30 s old, every 60 s while connected, and
// when LumiRPEngine asks (Update now). After any change of what it runs it checks in again, so the
// extension's Settings → MCP server and its update notice say how this server stands.

import type { AgentCheckIn } from "../shared/agents";
import { isRecord } from "../shared/json";
import type { ResultBodies } from "../shared/protocol";
import { ENGINE_EXTENSION } from "../shared/studio-bridge";
import type { CliIO } from "./commands";
import { HostConnection } from "./connection";
import type { KitFiles, KitNews } from "./follow";
import { KitFollower } from "./follow";
import type { AgentKit, KitContext, McpOptions } from "./kit-api";
import type { LineServer, ToolHost } from "./mcp";
import { lineServer, McpServer } from "./mcp";
import { BUILD, CLI_NAME, CLI_VERSION } from "./version";

/** A look older than this is made again before a call. */
const STALE_MS = 30_000;
/** How often a connected server looks anyway. */
const EVERY_MS = 60_000;
/** How long a call waits on a look (or a reload) under way before it runs on the tools loaded now. */
const READY_WAIT_MS = 10_000;

export interface Clock {
  now(): number;
  /** Runs `tick` every `ms`, on a timer that doesn't keep the process up, until the returned stop is called. */
  every(ms: number, tick: () => void): () => void;
}

const REAL_CLOCK: Clock = {
  now: () => Date.now(),
  every(ms, tick) {
    const timer = setInterval(tick, ms).unref();
    return () => clearInterval(timer);
  },
};

export interface SessionOptions {
  /** The kit the core ships with: the tools until LumiRPEngine's own are loaded. */
  bundled: AgentKit;
  mcp: McpOptions;
  io: Pick<CliIO, "credentials" | "http" | "openSocket" | "readFile">;
  files: KitFiles;
  /** This machine's name, which the check-in gives. */
  host: string;
  /** Where the server says what it did: its stderr, which harnesses keep. */
  log(text: string): void;
  clock?: Clock;
}

/**
 * Runs work by key one after another, keys side by side. The session's own rather than a kit's
 * (tools.ts has the same for the command line): it outlives every kit it loads, so one world's
 * writes stay in order across a reload, and the core carries no tool code.
 */
class Queue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(work, work);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

export class McpSession implements ToolHost {
  readonly readOnly: boolean;
  readonly context: KitContext;
  /** Called once the loaded kit changed: the server tells its client the tool list did. */
  toolsChanged: () => void = () => undefined;
  private conn: HostConnection | null = null;
  private readonly follower: KitFollower;
  private readonly clock: Clock;
  /** This server's id to LumiRPEngine (its hello's answer): Update now names it. */
  private agent: string | null = null;
  /** LumiRPEngine said where its kit is, so there is something to look at. */
  private followable = false;
  /** The harness that runs this server, from its client's initialize; checked in with, so each harness's server is a line of its own. */
  private harness: string | null = null;
  private initializedOnce = false;
  private looked = Number.NEGATIVE_INFINITY;
  /** Following, one step at a time. */
  private work: Promise<void> = Promise.resolve();
  private starting: Promise<void> = Promise.resolve();
  private stopTimer: () => void = () => undefined;
  /** What the last check-in said: another is due when it changes. */
  private said: string;

  constructor(private readonly options: SessionOptions) {
    this.readOnly = options.mcp.readOnly;
    this.clock = options.clock ?? REAL_CLOCK;
    this.follower = new KitFollower(options.bundled, { pin: options.mcp.pin, identifier: ENGINE_EXTENSION, files: options.files, where: () => this.conn?.base ?? "your Lumiverse" });
    const queue = new Queue();
    this.context = { readFile: (path) => options.io.readFile(path), readOnly: this.readOnly, connection: () => this.connection(), serialize: (key, work) => queue.run(key, work) };
    this.said = this.stance();
  }

  kit(): AgentKit {
    return this.follower.kit;
  }

  /** What this server checks in with. */
  checkIn(): AgentCheckIn {
    const { follows, why } = this.follower.state;
    return { serves: "mcp", core: BUILD, kit: this.follower.kit.build, follows, why, host: this.options.host, harness: this.harness };
  }

  /** Looks every minute while connected. The connection opens at the client's initialize, so the first check-in names the harness. */
  start(): void {
    this.stopTimer = this.clock.every(EVERY_MS, () => {
      if (this.followable && this.conn?.isOpen()) void this.look();
    });
  }

  /** The client's initialize: who runs this server, then the connection now rather than at the first call that needs it, so the tools follow LumiRPEngine from the start. */
  initialized(harness: string | null): void {
    if (this.initializedOnce) return;
    this.initializedOnce = true;
    this.harness = harness;
    this.starting = (async () => {
      try {
        await this.connection().ensureOpen();
      } catch {
        // Not signed in, or Lumiverse unreachable: the first call that needs it says why, and connects then.
      }
    })();
  }

  /** Before a call: a look when the last is old, and whatever following is under way, waited for a while. */
  async ready(): Promise<void> {
    if (this.followable && this.conn?.isOpen() && this.clock.now() - this.looked > STALE_MS) void this.look();
    let timer: Timer | undefined;
    await Promise.race([this.work, new Promise<void>((resolve) => (timer = setTimeout(resolve, READY_WAIT_MS)))]);
    clearTimeout(timer);
  }

  /** Resolves once the start's connection and every step of following so far are done. */
  async idle(): Promise<void> {
    await this.starting;
    for (let step = this.work; ; step = this.work) {
      await step;
      if (step === this.work) return;
    }
  }

  close(): void {
    this.stopTimer();
    this.conn?.close();
  }

  private connection(): HostConnection {
    if (this.conn !== null) return this.conn;
    const base = this.options.mcp.base();
    const { io } = this.options;
    this.conn = new HostConnection({
      base,
      // Read again whenever the connection opens: a `login` while the server runs takes effect without a restart.
      credentials: () => io.credentials.get(base),
      http: io.http,
      openSocket: io.openSocket,
      client: { name: CLI_NAME, version: CLI_VERSION },
      checkIn: () => this.checkIn(),
      needs: () => this.follower.kit.versions.agentApi,
      onHello: (answer) => {
        if (typeof answer.client === "string") this.agent = answer.client;
        this.looked = this.clock.now();
        void this.after(() => this.take(answer));
      },
      onPush: (push) => {
        // Update now: LumiRPEngine asks this server, by the id its hello was given, to look at once.
        if (push.type === "lre.kit.reload" && this.agent !== null && push.client === this.agent) void this.look();
      },
      ...(this.options.mcp.timeoutMs !== undefined ? { timeoutMs: this.options.mcp.timeoutMs } : {}),
    });
    return this.conn;
  }

  private after(step: () => Promise<void>): Promise<void> {
    this.work = this.work.then(step).catch((error: unknown) => this.options.log(`lumirpengine: following LumiRPEngine's tools failed: ${error instanceof Error ? error.message : String(error)}`));
    return this.work;
  }

  /** Asks LumiRPEngine which kit it has now, and follows it. */
  private look(): Promise<void> {
    return this.after(async () => {
      const conn = this.conn;
      if (conn === null || !conn.isOpen()) return;
      this.looked = this.clock.now();
      let answer: ResultBodies["lre.agents"];
      try {
        answer = await conn.request("lre.agents", { op: "kit" });
      } catch {
        // The socket went, or LumiRPEngine is busy: the next hello or look says.
        return;
      }
      // LumiRPEngine restarted since this server's hello and doesn't know it: say hello again, and its answer brings the kit.
      if (answer.known === false) await conn.checkInAgain();
      else await this.take(answer);
    });
  }

  /** Follows what LumiRPEngine said, then tells the client, the log and LumiRPEngine what changed. */
  private async take(news: KitNews): Promise<void> {
    this.followable = !this.options.mcp.pin && "kit" in news && isRecord(news.kit);
    const was = this.follower.kit.build;
    const changed = await this.follower.follow(news);
    if (changed) {
      this.options.log(`lumirpengine: serving the tools of LumiRPEngine build ${this.follower.kit.build} (was build ${was})`);
      this.toolsChanged();
    }
    const stance = this.stance();
    if (stance === this.said) return;
    this.said = stance;
    const { why } = this.follower.state;
    if (why !== null) this.options.log(`lumirpengine: keeping the tools of build ${this.follower.kit.build}: ${why.text}`);
    // Its answer comes back through onHello, after this step.
    await this.conn?.checkInAgain();
  }

  /** What a check-in says, as a key: the kit loaded, and whether (and why not) it follows. */
  private stance(): string {
    const { follows, why } = this.follower.state;
    return `${this.follower.kit.build}\u0000${String(follows)}\u0000${why?.code ?? ""}`;
  }
}

/** The MCP server over a session, on lines: it tells its client when the session swaps the tools. */
export function serveMcp(session: McpSession, write: (line: string) => Promise<void> | void): LineServer {
  const line = lineServer(new McpServer(session), write);
  session.toolsChanged = () => line.notify("notifications/tools/list_changed");
  return line;
}

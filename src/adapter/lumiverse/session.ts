// RPE signed in to Lumiverse as its user (STANDALONE-PLAN §4.2, §4.4): the sign-in, the session kept,
// and HTTP to Lumiverse with it. Lumiverse's sessions are Better Auth's: `POST /api/auth/sign-in/
// username` answers with the session's token (`auth/index.ts:90`, `:114`), the `bearer` plugin takes
// it as `Authorization: Bearer` on any request (`auth/index.ts:143`), and a session lasts seven days
// from its last renewal, renewed by any use a day or more after the one before (`auth/index.ts:109-
// 112`). A dead session reads as `null` from `GET /api/auth/get-session` and as 401 `SESSION_EXPIRED`
// from any `/api/v1` route (`auth/middleware.ts:44-50`). The password is never kept: only the token.
//
// Every request goes without an Origin and without a Cookie, which Lumiverse's own checks let through
// for a bearer (`app.ts:208`; Better Auth checks origins only for requests that carry a cookie), and
// never follows a redirect, which would drop the bearer.

import type { Clock } from "rp-harness/contract";
import { isRecord } from "../../shared/json";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The sign-in RPE keeps in its secrets: the session's token and the account it is of. */
export interface StoredSignIn {
  username: string;
  token: string;
  /** The Lumiverse user id the token signs in as. */
  user: string;
  savedAt: number;
}

export type SessionState =
  | { state: "signed-out" }
  /** `signedInAt`: when this sign-in was made (`StoredSignIn.savedAt`), so a newer one can be told from a renewal. */
  | { state: "signed-in"; user: string; username: string; signedInAt: number; checkedAt: number | null }
  /** Lumiverse no longer takes the token; `why` says so in words the user can act on. */
  | { state: "lost"; username: string; why: string; at: number };

/** Why a call to Lumiverse failed, in words the user can act on. */
export class LumiverseError extends Error {
  constructor(
    readonly problem: "lost" | "signed-out" | "refused" | "locked" | "unreachable" | "protocol" | "owner",
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "LumiverseError";
  }
}

export interface SessionDeps {
  /** Lumiverse's address as the user opens it, without a trailing slash. */
  base: string;
  fetch: Fetch;
  /** The sign-in RPE's secrets held when it started; null when it holds none. */
  signIn: StoredSignIn | null;
  /** Keeps a new sign-in in RPE's secrets (null: forgets it). */
  save(signIn: StoredSignIn | null): Promise<void>;
  /** The Lumiverse user this RPE belongs to; null before the first sign-in names one. */
  owner(): string | null;
  clock: Pick<Clock, "now" | "setTimeout" | "clearTimeout">;
  log(message: string): void;
  /** How often the session is asked after while kept; `KEEP_EVERY_MS` when not said. */
  keepEveryMs?: number;
}

/** Fixed: the session is asked after twice a day, so it is renewed long before its seven days end. */
export const KEEP_EVERY_MS = 12 * 60 * 60 * 1000;

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The words a Lumiverse error answer carries, if any (`{error}` or `{message}`). */
function said(body: unknown): string {
  const words = isRecord(body) ? (body.error ?? body.message) : null;
  return typeof words === "string" && words !== "" ? `: ${words}` : "";
}

type Listener = (state: SessionState) => void;

export class LumiverseSession {
  private current: SessionState;
  private kept: StoredSignIn | null;
  private readonly listeners = new Set<Listener>();
  private timer: unknown = null;

  constructor(private readonly deps: SessionDeps) {
    this.kept = deps.signIn;
    this.current = this.kept === null ? { state: "signed-out" } : { state: "signed-in", user: this.kept.user, username: this.kept.username, signedInAt: this.kept.savedAt, checkedAt: null };
  }

  get base(): string {
    return this.deps.base;
  }

  state(): SessionState {
    return this.current;
  }

  /** Called with every change of state; returns the unsubscribe. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: SessionState): void {
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }

  /** The words for a session Lumiverse no longer takes. */
  private lostWords(): string {
    return `RPE's sign-in to Lumiverse at ${this.deps.base} has ended: it expired, or was signed out in Lumiverse. RPE cannot read your chats or hear your replies until it is signed in again (rpe up).`;
  }

  /** The session of `kept` ended: kept as lost and the token forgotten, so every call says so until a new sign-in (one made meanwhile stays). */
  private lost(kept: StoredSignIn): LumiverseError {
    const why = this.lostWords();
    if (this.kept === kept) {
      this.deps.log(why);
      this.kept = null;
      this.deps.save(null).catch((error: unknown) => this.deps.log(`RPE could not forget its ended sign-in: ${error instanceof Error ? error.message : String(error)}`));
      this.set({ state: "lost", username: kept.username, why, at: this.deps.clock.now() });
    }
    return new LumiverseError("lost", why, 401);
  }

  /** One request with nothing of the session on it; `token` adds the bearer. */
  private async exchange(method: string, path: string, token: string | null, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token !== null) headers.authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await this.deps.fetch(`${this.deps.base}${path}`, { method, headers, redirect: "manual", ...(body !== undefined ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new LumiverseError("unreachable", `Lumiverse at ${this.deps.base} cannot be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (res.status >= 300 && res.status < 400) throw new LumiverseError("unreachable", `Lumiverse at ${this.deps.base} answered with a redirect to ${res.headers.get("location") ?? "another address"}. Give RPE the address Lumiverse redirects to.`, res.status);
    if (res.status === 403) throw new LumiverseError("refused", `Lumiverse at ${this.deps.base} refused RPE (403): the address RPE uses is not one of its trusted hosts. Use the address you open Lumiverse at, or add it to Lumiverse's trusted hosts.`, 403);
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after"));
      throw new LumiverseError("locked", `Lumiverse is refusing requests from RPE's address${Number.isFinite(wait) && wait > 0 ? ` for about ${Math.ceil(wait / 60)} minutes` : " for a while"}${said(parse(await res.text()))}. It does this after repeated failed sign-ins.`, 429);
    }
    return res;
  }

  /**
   * Signs in with a username and password (never kept) and keeps the session's token. The account
   * must be the user this RPE belongs to, when it already belongs to one.
   */
  async signIn(username: string, password: string): Promise<StoredSignIn> {
    const res = await this.exchange("POST", "/api/auth/sign-in/username", null, { username, password });
    const text = await res.text();
    if (res.status === 401) throw new LumiverseError("refused", `Lumiverse refused that username or password${said(parse(text))}. After five failed sign-ins Lumiverse locks the address out for a while.`, 401);
    if (res.status < 200 || res.status >= 300) throw new LumiverseError("protocol", `Lumiverse answered the sign-in with ${res.status}${said(parse(text))}.`, res.status);
    const body = parse(text);
    // The body's token (`plugins/username`), else the `set-auth-token` header the bearer plugin adds.
    const token = isRecord(body) && typeof body.token === "string" && body.token !== "" ? body.token : res.headers.get("set-auth-token");
    const user = isRecord(body) && isRecord(body.user) && typeof body.user.id === "string" ? body.user.id : null;
    if (token === null || token === "" || user === null) throw new LumiverseError("protocol", `Lumiverse at ${this.deps.base} signed RPE in but sent back no session, so RPE cannot use it.`);
    const owner = this.deps.owner();
    if (owner !== null && owner !== user) throw new LumiverseError("owner", `That account is not the Lumiverse user this RPE belongs to. Sign in as the user RPE was set up for.`);
    const signIn: StoredSignIn = { username, token, user, savedAt: this.deps.clock.now() };
    await this.deps.save(signIn);
    this.kept = signIn;
    this.set({ state: "signed-in", user, username, signedInAt: signIn.savedAt, checkedAt: this.deps.clock.now() });
    return signIn;
  }

  /** Asks Lumiverse whether the session holds, which renews it; a dead session is kept as lost. */
  async check(): Promise<SessionState> {
    const kept = this.kept;
    if (kept === null) return this.current;
    const res = await this.exchange("GET", "/api/auth/get-session", kept.token);
    const body = res.status === 200 ? parse(await res.text()) : null;
    if (res.status === 401 || (res.status === 200 && (!isRecord(body) || !isRecord(body.user)))) throw this.lost(kept);
    if (res.status !== 200) throw new LumiverseError("unreachable", `Lumiverse at ${this.deps.base} answered ${res.status} when RPE asked about its session.`, res.status);
    this.set({ state: "signed-in", user: kept.user, username: kept.username, signedInAt: kept.savedAt, checkedAt: this.deps.clock.now() });
    return this.current;
  }

  /** Asks after the session every `keepEveryMs` until `stop`, so Lumiverse renews it while RPE runs. */
  keep(): void {
    this.stop();
    const every = this.deps.keepEveryMs ?? KEEP_EVERY_MS;
    const tick = (): void => {
      this.timer = this.deps.clock.setTimeout(tick, every);
      void this.check().catch(() => {
        // A lost session has said so; an outage is asked again at the next tick.
      });
    };
    this.timer = this.deps.clock.setTimeout(tick, every);
  }

  stop(): void {
    if (this.timer !== null) this.deps.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * One request to Lumiverse as RPE's user (`path` under its address). A 401 means the session ended:
   * it is kept as lost and the call throws in words that say so. Any other status is the caller's.
   */
  async request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const kept = this.kept;
    if (kept === null) throw this.current.state === "lost" ? new LumiverseError("lost", this.current.why, 401) : new LumiverseError("signed-out", `RPE is not signed in to Lumiverse at ${this.deps.base}. Sign it in (rpe up).`);
    const res = await this.exchange(method, path, kept.token, body, signal);
    if (res.status === 401) throw this.lost(kept);
    return res;
  }

  /** `request`, answered as JSON: 404 is null, any other status but 200 throws. */
  async json(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const res = await this.request(method, path, body, signal);
    if (res.status === 404) return null;
    const text = await res.text();
    if (res.status !== 200) throw new LumiverseError("protocol", `Lumiverse answered ${res.status} to ${method} ${path}${said(parse(text))}.`, res.status);
    const parsed = parse(text);
    if (parsed === null && text.trim() !== "null") throw new LumiverseError("protocol", `Lumiverse answered ${method} ${path} with something that is not JSON.`);
    return parsed;
  }
}

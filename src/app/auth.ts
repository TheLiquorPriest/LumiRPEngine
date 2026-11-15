// Who may call RPE (plan §4.4, §16). Three keys are given out, each random, shown once and kept only
// as its SHA-256: the provider key Lumiverse sends on RPE's connection, the light extension's
// registration, and the web UI's token. A new key of a kind retires the one before it. Page tokens
// are short-lived; they are minted through the extension for a page of the Lumiverse user this RPE
// belongs to and for no other user. Every key and token is kept under the user it was made for, and
// one opens RPE only while that user is still the one this RPE belongs to. Nothing here can switch on
// anything that runs a command: only the command line can (switches.ts).

import type { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import type { WriteQueue } from "./database";

export type KeyKind = "provider" | "extension" | "web";

/** Each kind's keys begin alike, so a user can tell which one they hold. */
export const KEY_PREFIXES: Readonly<Record<KeyKind, string>> = Object.freeze({ provider: "rpe_", extension: "rpx_", web: "rpw_" });
const PAGE_TOKEN_PREFIX = "rpp_";

/** A key as it is made: shown this once. */
export interface MadeKey {
  kind: KeyKind;
  key: string;
  last4: string;
  made: number;
}

/** A key in force, as it may be shown: never the key. */
export interface KeyFacts {
  kind: KeyKind;
  last4: string;
  made: number;
}

export interface PageToken {
  token: string;
  user: string;
  expires: number;
}

/** Who asked for a page token: the extension for a page, or the command line for its own call to the running server. */
export type TokenMaker = "extension" | "command line";

/** Why RPE does not open its database, or does anything that writes there, before the install has named its user (R-179). */
export const NO_OWNER = "RPE belongs to no Lumiverse user yet, so nothing was written: `rpe up` names the user it belongs to.";

export class AuthRefused extends Error {
  override name = "AuthRefused";

  constructor(
    readonly status: 403 | 503,
    message: string,
  ) {
    super(message);
  }
}

/** What is kept of a key or a token. */
export function secretHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** A new key of `kind`, not yet in force. */
export function newKeyText(kind: KeyKind): string {
  return `${KEY_PREFIXES[kind]}${randomBytes(32).toString("hex")}`;
}

/**
 * Puts a key of `kind` for `user` in force (a new one unless `key` is given, made by `newKeyText` for a key that had to be handed out first) and retires his one before it.
 * A key taken from today's connection (`takeKeyHash`, its last four unknown) stays: going back needs that connection as it is (plan §15.6).
 * Runs inside a transaction: the server's write queue's, or the command line's own.
 */
export function insertKey(db: Database, user: string, kind: KeyKind, now: number, key: string = newKeyText(kind)): MadeKey {
  db.run("UPDATE app_key SET retired = ? WHERE user = ? AND kind = ? AND retired IS NULL AND last4 <> ''", [now, user, kind]);
  db.run("INSERT INTO app_key (user, hash, kind, last4, made) VALUES (?, ?, ?, ?, ?)", [user, secretHash(key), kind, key.slice(-4), now]);
  return { kind, key, last4: key.slice(-4), made: now };
}

/**
 * Puts in force for `user`, beside his key of `kind` in force, a key RPE holds only as its SHA-256:
 * the key today's build gave its connection in Lumiverse, which RPE takes at the swap (plan §15.2) so
 * that connection goes on working as it is. Its last four characters were never known, which is how
 * it is told from RPE's own: a new key of the kind leaves it in force. Runs inside a transaction.
 */
export function takeKeyHash(db: Database, user: string, kind: KeyKind, hash: string, now: number): void {
  db.run("INSERT OR IGNORE INTO app_key (user, hash, kind, last4, made) VALUES (?, ?, ?, ?, ?)", [user, hash, kind, "", now]);
}

/**
 * Retires `user`'s key of `kind` taken from today's connection (`takeKeyHash`), which a new key leaves
 * in force: that connection in Lumiverse then needs a key of RPE's own. Says how many it retired. Runs
 * inside a transaction.
 */
export function retireTakenKeys(db: Database, user: string, kind: KeyKind, now: number): number {
  return db.run("UPDATE app_key SET retired = ? WHERE user = ? AND kind = ? AND retired IS NULL AND last4 = ''", [now, user, kind]).changes;
}

/** `user`'s key of each kind in force. */
export function currentKeys(db: Database, user: string): KeyFacts[] {
  return db.query<KeyFacts, [string]>("SELECT kind, last4, made FROM app_key WHERE user = ? AND retired IS NULL ORDER BY kind").all(user);
}

/** A page token for `user`, holding for `ttlMs`; tokens past their time are let go in the same write. Runs inside a transaction. */
export function insertPageToken(db: Database, user: string, by: TokenMaker, ttlMs: number, now: number): PageToken {
  const token = `${PAGE_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
  db.run("DELETE FROM page_token WHERE expires <= ?", [now]);
  db.run("INSERT INTO page_token (hash, user, made_by, made, expires) VALUES (?, ?, ?, ?, ?)", [secretHash(token), user, by, now, now + ttlMs]);
  return { token, user, expires: now + ttlMs };
}

/** The credential a request carries as `Authorization: Bearer …`; null when it carries none. */
export function bearerOf(request: Request): string | null {
  return /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
}

export interface AuthDeps {
  db: Database;
  writes: WriteQueue;
  /** The Lumiverse user this RPE belongs to: RPE opens for no one before the install names him. */
  owner: string;
  now: () => number;
  pageTokenMs: number;
  /** How long the web UI's key holds after it is made (`auth.webKeyDays`); null: it has no end. */
  webKeyMs: number | null;
}

/** When a key runs out: only the web UI's key does, `webKeyMs` after it was made; null where it has no end. */
export function keyEnds(kind: KeyKind, made: number, webKeyMs: number | null): number | null {
  return kind === "web" && webKeyMs !== null ? made + webKeyMs : null;
}

/** A page's credential as it holds now: the user it stands for, and when it runs out (null: no end). */
export interface PageHold {
  user: string;
  until: number | null;
}

/** The server's checks. Every check reads the database, so a key the command line makes or retires counts at once. */
export class Auth {
  constructor(private readonly deps: AuthDeps) {}

  get owner(): string {
    return this.deps.owner;
  }

  /** Whether `presented` is the key of `kind` in force, made for the user this RPE belongs to. */
  holds(kind: KeyKind, presented: string | null): boolean {
    if (presented === null || presented === "") return false;
    const row = this.deps.db.query<{ n: number }, [string, string, string]>("SELECT count(*) AS n FROM app_key WHERE user = ? AND hash = ? AND kind = ? AND retired IS NULL").get(this.deps.owner, secretHash(presented), kind);
    return (row?.n ?? 0) > 0;
  }

  /**
   * Makes a key of `kind`, retiring the one before it, for code in this process that hands it on at
   * once (the extension's registration, when RPE registers with it). No route makes keys: a page never
   * sees one. The key is in the result alone; only its hash is kept.
   */
  makeKey(kind: KeyKind): Promise<MadeKey> {
    return this.deps.writes.run((db) => insertKey(db, this.deps.owner, kind, this.deps.now()), `a new ${kind} key`);
  }

  /** A page token for `user`, refused unless `user` is the one this RPE belongs to. */
  async mintPageToken(user: string, by: TokenMaker): Promise<PageToken> {
    if (user !== this.deps.owner) throw new AuthRefused(403, "Page tokens are made only for the Lumiverse user this RPE belongs to.");
    return await this.deps.writes.run((db) => insertPageToken(db, user, by, this.deps.pageTokenMs, this.deps.now()), "a page token");
  }

  /**
   * The user a page's credential stands for: a page token made for that user and still in time, or
   * his web UI's key in force and in time. Null for anything else.
   */
  pageUser(presented: string | null): string | null {
    return this.pageHold(presented)?.user ?? null;
  }

  /** `pageUser`, with when the credential runs out: a socket opened with it closes then. */
  pageHold(presented: string | null): PageHold | null {
    const owner = this.deps.owner;
    if (presented === null || presented === "") return null;
    const now = this.deps.now();
    const hash = secretHash(presented);
    const token = this.deps.db.query<{ user: string; expires: number }, [string]>("SELECT user, expires FROM page_token WHERE hash = ?").get(hash);
    if (token !== null) return token.user === owner && token.expires > now ? { user: owner, until: token.expires } : null;
    const web = this.deps.db.query<{ made: number }, [string, string]>("SELECT made FROM app_key WHERE user = ? AND hash = ? AND kind = 'web' AND retired IS NULL").get(owner, hash);
    if (web === null) return null;
    const until = keyEnds("web", web.made, this.deps.webKeyMs);
    return until === null || until > now ? { user: owner, until } : null;
  }
}

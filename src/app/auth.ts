// Who may call RPE (plan §4.4, §16; Appendix B's `provider_key` and `page_token`). Three keys are
// given out, each random, shown once and kept only as its SHA-256: the provider key Lumiverse sends on
// RPE's connection, kept in `provider_key`; and the light extension's registration and the web UI's
// token, which are tokens like the page's, kept in `page_token` with who made them and when they end
// (the web token has no end unless `auth.webKeyDays` gives one). A new key of a kind takes the one
// before it away. Page tokens are short-lived; they are minted through the extension for a page of the
// Lumiverse user this RPE belongs to and for no other user. Every key and token is kept under the user
// it was made for, and one opens RPE only while that user is still the one this RPE belongs to.
// Nothing here can switch on anything that runs a command: only the command line can (switches.ts).

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
  /** When it runs out; null: it has no end. */
  ends: number | null;
}

/**
 * A key in force, as it may be shown: never the key. Only the provider key's last four characters are
 * kept (null for the others, and for the provider key taken from today's connection, whose were never
 * known: `taken`); the web token's end is when it was made and `auth.webKeyDays` said it would be.
 */
export interface KeyFacts {
  kind: KeyKind;
  last4: string | null;
  made: number;
  /** When the key runs out; null: it has no end. */
  ends: number | null;
  /** The provider key RPE took from today's connection at the swap. */
  taken: boolean;
}

export interface PageToken {
  token: string;
  user: string;
  expires: number;
}

/** Who made a token, as `page_token` keeps it: the extension for a page, the command line for the web token, RPE itself at its start for the extension's registration. */
export type TokenMaker = "extension" | "command line" | "rpe start";

/** The kinds of token `page_token` holds. */
export type TokenKind = "page" | "web" | "extension";

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

/** Who makes each key RPE gives out, as `page_token` says it. */
const MAKER: Readonly<Record<"web" | "extension", TokenMaker>> = { web: "command line", extension: "rpe start" };

/**
 * Puts a key of `kind` for `user` in force (a new one unless `key` is given, made by `newKeyText` for a key that had to be handed out first) and takes his one before it away: the provider key
 * into `provider_key`, the extension's and the web token into `page_token`, the web token with an end `webKeyMs` after it is made where there is one. Runs inside a transaction: the server's write queue's, or the command line's own.
 */
export function insertKey(db: Database, user: string, kind: KeyKind, now: number, key: string = newKeyText(kind), webKeyMs: number | null = null): MadeKey {
  const hash = secretHash(key);
  if (kind === "provider") {
    db.run("DELETE FROM provider_key WHERE user = ?", [user]);
    db.run("INSERT INTO provider_key (user, hash, last4, made, taken) VALUES (?, ?, ?, ?, 0)", [user, hash, key.slice(-4), now]);
    return { kind, key, last4: key.slice(-4), made: now, ends: null };
  }
  const ends = keyEnds(kind, now, webKeyMs);
  db.run("DELETE FROM page_token WHERE user = ? AND kind = ?", [user, kind]);
  db.run("INSERT INTO page_token (hash, user, kind, made_by, made, expires) VALUES (?, ?, ?, ?, ?, ?)", [hash, user, kind, MAKER[kind], now, ends]);
  return { kind, key, last4: key.slice(-4), made: now, ends };
}

/**
 * Puts in force for `user` the key today's build gave its connection in Lumiverse, which RPE takes at
 * the swap (plan §15.2) so that connection goes on working as it is, and which every connection that
 * reaches today's runtime holds (R-109). RPE holds it only as its SHA-256; its last four characters
 * were never known. It is the one key that opens the provider endpoint: RPE's own earlier key stops
 * with it. Runs inside a transaction.
 */
export function takeKeyHash(db: Database, user: string, hash: string, now: number): void {
  db.run("DELETE FROM provider_key WHERE user = ? AND taken = 0 AND hash <> ?", [user, hash]);
  db.run("INSERT OR IGNORE INTO provider_key (user, hash, last4, made, taken) VALUES (?, ?, '', ?, 1)", [user, hash, now]);
}

/** Whether `user`'s provider key is the one taken from today's connection at the swap. */
export function providerKeyTaken(db: Database, user: string): boolean {
  return db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM provider_key WHERE user = ? AND taken = 1").get(user)?.n !== 0;
}

/** `user`'s key of each kind in force: never a key's text. */
export function currentKeys(db: Database, user: string): KeyFacts[] {
  const provider = db.query<{ last4: string; made: number; taken: number }, [string]>("SELECT last4, made, taken FROM provider_key WHERE user = ? ORDER BY made, rowid").all(user);
  const tokens = db.query<{ kind: "web" | "extension"; made: number; expires: number | null }, [string]>("SELECT kind, made, expires FROM page_token WHERE user = ? AND kind IN ('web', 'extension') ORDER BY kind").all(user);
  return [
    ...provider.map((k): KeyFacts => ({ kind: "provider", last4: k.taken === 1 ? null : k.last4, made: k.made, ends: null, taken: k.taken === 1 })),
    ...tokens.map((k): KeyFacts => ({ kind: k.kind, last4: null, made: k.made, ends: k.expires, taken: false })),
  ].sort((a, b) => a.kind.localeCompare(b.kind));
}

/** A page token for `user`, holding for `ttlMs`; tokens past their time are let go in the same write. Runs inside a transaction. */
export function insertPageToken(db: Database, user: string, by: TokenMaker, ttlMs: number, now: number): PageToken {
  const token = `${PAGE_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
  db.run("DELETE FROM page_token WHERE kind = 'page' AND expires <= ?", [now]);
  db.run("INSERT INTO page_token (hash, user, kind, made_by, made, expires) VALUES (?, ?, 'page', ?, ?, ?)", [secretHash(token), user, by, now, now + ttlMs]);
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

  /** Whether `presented` is the key of `kind` in force and in time, made for the user this RPE belongs to. */
  holds(kind: KeyKind, presented: string | null): boolean {
    if (presented === null || presented === "") return false;
    const hash = secretHash(presented);
    if (kind === "provider") return (this.deps.db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM provider_key WHERE user = ? AND hash = ?").get(this.deps.owner, hash)?.n ?? 0) > 0;
    const row = this.deps.db.query<{ expires: number | null }, [string, string, string]>("SELECT expires FROM page_token WHERE user = ? AND hash = ? AND kind = ?").get(this.deps.owner, hash, kind);
    return row !== null && (row.expires === null || row.expires > this.deps.now());
  }

  /**
   * Makes a key of `kind`, retiring the one before it, for code in this process that hands it on at
   * once (the extension's registration, when RPE registers with it). No route makes keys: a page never
   * sees one. The key is in the result alone; only its hash is kept.
   */
  makeKey(kind: KeyKind): Promise<MadeKey> {
    return this.deps.writes.run((db) => insertKey(db, this.deps.owner, kind, this.deps.now(), undefined, this.deps.webKeyMs), `a new ${kind} key`);
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
    // A page token holds for its short life, the web token until its end where it has one; the extension's key is no page's.
    const token = this.deps.db.query<{ user: string; kind: TokenKind; expires: number | null }, [string]>("SELECT user, kind, expires FROM page_token WHERE hash = ?").get(hash);
    if (token === null || token.kind === "extension" || token.user !== owner) return null;
    return token.expires === null || token.expires > now ? { user: owner, until: token.expires } : null;
  }
}

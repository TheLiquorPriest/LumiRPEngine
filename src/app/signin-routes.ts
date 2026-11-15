// Signing in to RPE's web app (plan §4.4, §16; READINGS R-8, R-57): the printed token is traded for a
// session, or the user signs in with his Lumiverse account, which RPE checks against Lumiverse through
// the door and accepts only for the user it belongs to; and the proof a page asks for before it sends
// RPE a token, so that it can tell RPE from anything else that answers at an address. What a browser
// keeps is a session, which ends at its time unless an open page renews it; never the printed token and
// never a password, which RPE keeps nowhere.
//
// RPE keeps only the hash of each token, so the proof is keyed by that hash: the page sends the first
// characters of it and a nonce of its own, and RPE answers with the nonce's keyed hash, which only
// something that holds RPE's table of tokens can make. The wire (the path, the id's length, the nonce's
// form and the proof) is `src/shared/page-proof.ts`, which the page uses too.

import type { Database } from "bun:sqlite";
import { KEY_ID_LENGTH, NONCE_PATTERN, PROOF_PATH, proofOf } from "../shared/page-proof";
import { AccountRefused, type AccountSignedIn, type LumiverseAccounts } from "./accounts";
import type { App } from "./app";
import { type Auth, CLIENTS, type Client } from "./auth";
import { route, RouteError, shape } from "./routes";

/** Trades the printed token (or renews a session) for a session. */
export const SIGNIN_SESSION_PATH = "/api/v1/signin/session";
/** Signs in with a Lumiverse account. */
export const LUMIVERSE_SIGNIN_PATH = "/api/v1/signin/lumiverse";
/** Signs out: ends the session the call came with, and a Lumiverse session where one is given. */
export const SIGNOUT_PATH = "/api/v1/signin/end";

export interface SigninDeps {
  readonly db: Database;
  /** The Lumiverse user this RPE belongs to: only his page tokens are asked after, and only he signs in. */
  readonly owner: string;
  readonly now: () => number;
  readonly auth: Auth;
  /** What RPE asks of Lumiverse; null where it reaches none. */
  readonly accounts: LumiverseAccounts | null;
  /** How long a nonce is remembered, in milliseconds (`auth.nonceSeconds`). */
  readonly nonceMs: number;
  /** The wrong Lumiverse passwords RPE sends before it pauses, and how long it pauses, in milliseconds (`auth.signInTries`, `auth.signInPauseMinutes`). */
  readonly tries: number;
  readonly pauseMs: number;
}

/** The sign-in routes' deps over an app that is mounted. */
export function signinDeps(at: App, accounts: LumiverseAccounts | null): SigninDeps {
  const { nonceSeconds, signInTries, signInPauseMinutes } = at.config.auth;
  return { db: at.db, owner: at.auth.owner, now: at.now, auth: at.auth, accounts, nonceMs: nonceSeconds * 1000, tries: signInTries, pauseMs: signInPauseMinutes * 60_000 };
}

const KEY_ID = new RegExp(`^[0-9a-f]{${KEY_ID_LENGTH}}$`);
/** The most nonces remembered at once: a page asks for a handful, so one past this is an address being tried. */
const MOST_NONCES = 10_000;

const CLIENT = shape.oneOf(...CLIENTS);
const sessionReply = shape.named(
  "Session",
  "A session of RPE's web app: its token, which a browser keeps in place of the printed token, when it ends, and whose it is. After a sign-in by password for the command line or the MCP server, the Lumiverse session token too, for the client to keep as it keeps its own.",
  shape.object({
    session: shape.field(shape.text(), "The session's token: given as the bearer of every call, and traded again for a new one before it ends."),
    ends: shape.field(shape.number(), "When it ends, epoch milliseconds."),
    user: shape.field(shape.text(), "The Lumiverse user it is of."),
    lumiverse: shape.optional(shape.object({ token: shape.field(shape.text(), "Lumiverse's session token."), username: shape.field(shape.text(), "The Lumiverse username.") }), "Lumiverse's own session, handed back for a client that keeps one (the command line); never for the web shell."),
  }),
);

/** Lumiverse's refusal as the route answers it, in its own words. */
function refusal(error: unknown): RouteError {
  if (!(error instanceof AccountRefused)) return error instanceof RouteError ? error : new RouteError(502, `Lumiverse could not be asked: ${error instanceof Error ? error.message : String(error)}`);
  switch (error.problem) {
    case "wrong":
      return new RouteError(401, error.message);
    case "locked":
      return new RouteError(429, error.message);
    default:
      return new RouteError(502, error.message);
  }
}

/** Whether a call's credential is a session of one of the clients, or the printed token. */
function sessionOf(madeBy: string | null | undefined): Client | null {
  return CLIENTS.find((client) => client === madeBy) ?? null;
}

/**
 * The sign-in routes. The proof route is public, since the page has nothing RPE could check yet, and it
 * answers nothing but a keyed hash of what the page sent: only for a page token of this RPE's user that
 * is still in time (the drawer's, and a session, which is a page token), and a nonce only once within
 * `auth.nonceSeconds`. The trade takes the printed token or a session and gives a session; the Lumiverse
 * sign-in is public, as there is nothing to check before it, and holds a wrong password short of what
 * Lumiverse locks an address out at, so RPE's own address is never locked out.
 */
export function signinRoutes(deps: SigninDeps) {
  const nonces = new Map<string, number>();
  let wrong = 0;
  let pausedUntil = 0;

  /** Keeps wrong passwords from reaching Lumiverse's lockout: past `tries` of them RPE sends none until `pauseMs` has passed. */
  const mayTry = (): void => {
    const now = deps.now();
    if (now < pausedUntil) throw new RouteError(429, `RPE has had ${deps.tries} wrong Lumiverse passwords, and sends Lumiverse no more until ${Math.ceil((pausedUntil - now) / 60_000)} minute(s) have passed, so that Lumiverse does not lock RPE's address out for everyone. Sign in with the printed token meanwhile.`);
  };

  return [
    route({
      method: "GET",
      path: PROOF_PATH,
      access: "public",
      group: "service",
      does: "Proves to a page that this is the RPE that holds its page token, before the page sends it the token: a keyed hash of the page's nonce.",
      query: {
        id: shape.field(shape.text({ blank: false }), `The first ${KEY_ID_LENGTH} hexadecimal characters of the SHA-256 of the page's token.`),
        nonce: shape.field(shape.text({ blank: false }), "The page's own nonce: 16 to 64 hexadecimal characters."),
      },
      reply: shape.named("PageProof", "The proof of a page's nonce, keyed by the hash of its page token.", shape.object({ proof: shape.field(shape.text(), "HMAC-SHA-256 of the nonce, keyed by the token's hash, as lowercase hex.") })),
      handle: async ({ query }) => {
        if (!KEY_ID.test(query.id)) throw new RouteError(400, `id is the first ${KEY_ID_LENGTH} hexadecimal characters of the SHA-256 of the page's token.`);
        if (!NONCE_PATTERN.test(query.nonce)) throw new RouteError(400, "nonce is 16 to 64 hexadecimal characters.");
        const now = deps.now();
        for (const [key, at] of nonces) if (now - at >= deps.nonceMs) nonces.delete(key);
        const key = `${query.id}:${query.nonce}`;
        if (nonces.has(key)) throw new RouteError(409, "RPE has answered that nonce already: send a new one.");
        if (nonces.size >= MOST_NONCES) throw new RouteError(429, "RPE is being asked for too many proofs: try again in a moment.");
        const held = deps.db.query<{ hash: string }, [string, number, string]>(`SELECT hash FROM page_token WHERE user = ? AND kind = 'page' AND expires > ? AND substr(hash, 1, ${KEY_ID_LENGTH}) = ? ORDER BY made DESC LIMIT 1`).get(deps.owner, now, query.id);
        if (held === null) throw new RouteError(404, "RPE holds no page token by that id: ask for a new one.");
        nonces.set(key, now);
        return { proof: await proofOf(held.hash, query.nonce) };
      },
    }),
    route({
      method: "POST",
      path: SIGNIN_SESSION_PATH,
      access: "page",
      group: "service",
      does: "Trades the web app's printed token for a session, or a session that is still in time for a new one before it ends; the session says which client asked for it (the web shell where none is named).",
      body: shape.object({ client: shape.optional(CLIENT, "Which client signs in: the web shell, the command line or the MCP server.") }),
      reply: sessionReply,
      handle: async ({ body, auth }) => {
        const credential = auth.credential;
        const renewing = credential?.kind === "page" ? sessionOf(credential.madeBy) : null;
        if (credential?.kind !== "web" && renewing === null) throw new RouteError(403, "Only the web app's printed token, or a session, is traded for a session.");
        const made = await deps.auth.mintSession(body.client ?? renewing ?? "web shell");
        return { session: made.token, ends: made.expires, user: made.user };
      },
    }),
    route({
      method: "POST",
      path: LUMIVERSE_SIGNIN_PATH,
      access: "public",
      group: "service",
      does: "Signs in with a Lumiverse account: a username and password, or a Lumiverse session the caller holds. RPE checks it against Lumiverse and accepts it only for the user it belongs to; it keeps no password. The answer is a session.",
      body: shape.object({
        client: shape.optional(CLIENT, "Which client signs in: the web shell, the command line or the MCP server."),
        username: shape.optional(shape.text(), "The Lumiverse username."),
        password: shape.optional(shape.text(), "The Lumiverse password: sent to Lumiverse and kept nowhere."),
        session: shape.optional(shape.text(), "A Lumiverse session token the caller already holds (the command line's saved sign-in), in place of a password."),
      }),
      reply: sessionReply,
      handle: async ({ body }) => {
        const accounts = deps.accounts;
        if (accounts === null) throw new RouteError(503, "RPE reaches no Lumiverse from here, so it cannot check a Lumiverse sign-in: sign in with the printed token.");
        const client = body.client ?? "web shell";
        let signed: AccountSignedIn;
        const byPassword = body.session === undefined;
        if (body.session !== undefined) {
          signed = await accounts.check(body.session).catch((error: unknown) => {
            throw refusal(error);
          });
        } else {
          if (body.username === undefined || body.username.trim() === "" || body.password === undefined || body.password === "") throw new RouteError(400, "Give a Lumiverse username and password, or a Lumiverse session.");
          mayTry();
          try {
            signed = await accounts.signIn(body.username.trim(), body.password);
            wrong = 0;
          } catch (error) {
            if (error instanceof AccountRefused && error.problem === "wrong" && ++wrong >= deps.tries) {
              wrong = 0;
              pausedUntil = deps.now() + deps.pauseMs;
            }
            if (error instanceof AccountRefused && error.problem === "locked") pausedUntil = deps.now() + deps.pauseMs;
            throw refusal(error);
          }
        }
        // A sign-in as another user than the one this RPE belongs to is refused; the Lumiverse session it made is not kept.
        const keeps = byPassword && client !== "web shell";
        if (signed.user !== deps.owner || (byPassword && !keeps)) await accounts.signOut(signed.token).catch(() => undefined);
        if (signed.user !== deps.owner) throw new RouteError(403, "This RPE belongs to another Lumiverse user: only that user signs in to its web app.");
        const made = await deps.auth.mintSession(client);
        return { session: made.token, ends: made.expires, user: made.user, ...(keeps ? { lumiverse: { token: signed.token, username: signed.username } } : {}) };
      },
    }),
    route({
      method: "POST",
      path: SIGNOUT_PATH,
      access: "page",
      group: "service",
      does: "Signs out: ends the session the call came with, so it opens nothing more, and the Lumiverse session the caller names, through the door to Lumiverse.",
      body: shape.object({ lumiverse: shape.optional(shape.text(), "A Lumiverse session token to end in Lumiverse too.") }),
      reply: shape.nothing(),
      handle: async ({ body, auth }) => {
        const credential = auth.credential;
        if (credential?.kind === "page" && sessionOf(credential.madeBy) !== null) await deps.auth.endSession(credential.hash);
        if (body.lumiverse !== undefined && deps.accounts !== null) await deps.accounts.signOut(body.lumiverse).catch(() => undefined);
      },
    }),
  ] as const;
}

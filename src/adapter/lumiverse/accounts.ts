// Lumiverse's accounts as RPE's web app asks them (STANDALONE-PLAN §4.4: "signing in with your Lumiverse
// account, which RPE checks against Lumiverse and accepts only for its own user"): a sign-in, the check
// of a Lumiverse session token, and its end. Each is made as nobody in particular, with what the caller
// brings, through a session of its own that keeps nothing: the password is never kept, and whose account
// it is, is the caller's to judge. Lumiverse's sessions are Better Auth's (`session.ts`): a token is asked
// after at `GET /api/auth/get-session`, which answers null for one that has ended, and ended at `POST
// /api/auth/sign-out`, which answers alike for one already ended.

import type { Clock } from "rp-harness/contract";
import { AccountRefused, type AccountSignedIn, type LumiverseAccounts } from "../../app/accounts";
import { isRecord } from "../../shared/json";
import { LumiverseError, LumiverseSession, type Fetch, type StoredSignIn } from "./session";

export interface AccountsDeps {
  /** Lumiverse's address, read at each call; null where RPE is given none. */
  base(): string | null;
  fetch: Fetch;
  clock: Pick<Clock, "now" | "setTimeout" | "clearTimeout">;
}

const NO_LUMIVERSE = "RPE is not given Lumiverse's address, so it cannot ask Lumiverse about an account (rpe up).";
const ENDED = "Lumiverse no longer takes that session: sign in again.";

/** A failed call to Lumiverse, as the sign-in tells it. */
function refusal(error: unknown): unknown {
  if (!(error instanceof LumiverseError)) return error;
  if (error.problem === "lost") return new AccountRefused("wrong", ENDED);
  if (error.problem === "refused" && error.status === 401) return new AccountRefused("wrong", error.message);
  return new AccountRefused(error.problem === "locked" ? "locked" : error.problem === "unreachable" ? "unreachable" : "other", error.message);
}

export function lumiverseAccounts(deps: AccountsDeps): LumiverseAccounts {
  /** A session that keeps nothing and belongs to nobody, holding `signIn` where given. */
  const session = (signIn: StoredSignIn | null): LumiverseSession => {
    const base = deps.base();
    if (base === null) throw new AccountRefused("unreachable", NO_LUMIVERSE);
    return new LumiverseSession({ base: base.replace(/\/+$/, ""), fetch: deps.fetch, signIn, save: async () => {}, owner: () => null, clock: deps.clock, log: () => {} });
  };

  return {
    async signIn(username, password): Promise<AccountSignedIn> {
      try {
        const signed = await session(null).signIn(username, password);
        return { user: signed.user, username: signed.username, token: signed.token };
      } catch (error) {
        throw refusal(error);
      }
    },
    async check(token): Promise<AccountSignedIn> {
      let body: unknown;
      try {
        body = await session({ username: "", token, user: "", savedAt: deps.clock.now() }).json("GET", "/api/auth/get-session");
      } catch (error) {
        throw refusal(error);
      }
      const user = isRecord(body) && isRecord(body.user) ? body.user : null;
      if (user === null || typeof user.id !== "string") throw new AccountRefused("wrong", ENDED);
      // The username plugin's own field; the account's name where it has none.
      const username = typeof user.username === "string" ? user.username : typeof user.name === "string" ? user.name : "";
      return { user: user.id, username, token };
    },
    async signOut(token): Promise<void> {
      try {
        await session({ username: "", token, user: "", savedAt: deps.clock.now() }).request("POST", "/api/auth/sign-out");
      } catch (error) {
        if (error instanceof LumiverseError && error.problem === "lost") return;
        throw refusal(error);
      }
    },
  };
}

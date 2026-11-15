// What RPE asks of Lumiverse to sign a user in to its web app (plan §4.4: "signing in with your
// Lumiverse account, which RPE checks against Lumiverse and accepts only for its own user"). The app
// names no route of Lumiverse's: the door to Lumiverse (`src/adapter/lumiverse/`) fills this port, and the
// application's sign-in routes ask it.

/** Why Lumiverse did not take a sign-in. */
export type AccountProblem =
  /** It does not take that username and password, or that session. */
  | "wrong"
  /** It has locked RPE's address out after too many wrong passwords. */
  | "locked"
  /** It did not answer. */
  | "unreachable"
  /** Anything else it said. */
  | "other";

export class AccountRefused extends Error {
  override name = "AccountRefused";

  constructor(
    readonly problem: AccountProblem,
    message: string,
  ) {
    super(message);
  }
}

/** A sign-in Lumiverse took. */
export interface AccountSignedIn {
  /** The Lumiverse user's id. */
  user: string;
  username: string;
  /** The Lumiverse session token the sign-in gave. */
  token: string;
}

/** Lumiverse's accounts, as the door asks them; every call is made as no user in particular, with what the caller brings. */
export interface LumiverseAccounts {
  /** Signs in as `username` with `password`, which is not kept. Throws `AccountRefused`. */
  signIn(username: string, password: string): Promise<AccountSignedIn>;
  /** The user a Lumiverse session token is of, where Lumiverse still takes it. Throws `AccountRefused`. */
  check(token: string): Promise<AccountSignedIn>;
  /** Ends a Lumiverse session; it is no matter that it had ended already. */
  signOut(token: string): Promise<void>;
}

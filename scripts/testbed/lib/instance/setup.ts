// The set-up half of making the test instance from nothing (PlanScenarios-4 item 1): everything after
// the empty Lumiverse and its owner that the package's lead makes, done as that owner would do it,
// through Lumiverse's own routes as its pages call them and through today's runtime and command line.
// Each step finds what an earlier run made before it makes anything, logs every change by id (never a
// secret), and fails with plain words. The steps, in their order:
//
//   connection          the owner's Lumiverse connections: the allowed model, and one no RPE connection will match
//   users               the second invented user
//   install             today's pushed build, installed from its branch, granted, enabled and running for every user
//   cli                 today's command line signed in as each user
//   runtimes            today's runtime for each user, each a systemd user unit
//   runtime-connection  the owner's runtime: its loopback key, and a provider connection the harness plays on
//   runtime-settings    the owner's runtime's own settings: a tuning value, its memory limit, its update choice
//   runtime-folder      a runtime folder no config names
//
// Sign-ins: Lumiverse lets one address sign in 8 times in 5 minutes, loopback included, and every
// sign-in counts (src/app.ts:258-278 at a70f4ed2). A run from nothing signs in six times: the owner's
// REST client here, today's command line for each user (`cli`), and `lumiah up` for each runtime it
// sets up anew (`runtimes`, `runtime-folder`); the second user's REST client takes the sign-in the
// command line saved. A run over what an earlier one made uses the saved sign-ins while they hold.

import { isRecord } from "./json";
import { HttpError, Lumiverse } from "../lumiverse";
import type { RunLog } from "../record";
import type { InstanceEnv, Who } from "./env";
import { connection, install, users } from "./setup-lumiverse";
import { cli, runtimeConnection, runtimeFolder, runtimeSettings, runtimes, savedLogin } from "./setup-runtime";

export interface SetupCtx {
  env: InstanceEnv;
  log: RunLog;
  /**
   * A REST client signed in as `who`: one sign-in per user per process (Lumiverse locks an address
   * out after repeated sign-ins), its token kept in memory only, never written or printed. Where
   * today's command line holds a sign-in of that user's that still holds, it is used instead, and no
   * sign-in is made. A sign-in that fails is not made again in the same process.
   */
  session(who: Who): Promise<Lumiverse>;
}

export interface SetupStep {
  name: string;
  /** What the step makes, for the console. */
  makes: string;
  run(s: SetupCtx): Promise<void>;
}

/** Whom a session token signs in as, by Lumiverse's own read of the session (lower case, as Lumiverse keeps usernames: src/auth/index.ts:114-116); null for nobody. */
async function sessionUser(client: Lumiverse): Promise<string | null> {
  try {
    // 200 with null for a token that signs in nobody; a 401 says the same.
    const session = await client.call<{ user?: { username?: unknown } } | null>("GET", "/api/auth/get-session");
    const username = session?.user?.username;
    return typeof username === "string" ? username.toLowerCase() : null;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return null;
    throw error;
  }
}

/**
 * One sign-in, as Lumiverse's sign-in page makes it (`POST /api/auth/sign-in/username` with the
 * username and password: frontend/src/store/slices/auth.ts:29-33) and as today's command line takes
 * the session from it: the token in the answer, else its `set-auth-token` header (RPE main
 * src/cli/connection.ts:215-222). Sent with no Origin and no Cookie, as the command line sends it
 * (:187-191): Lumiverse checks an Origin only when there is one (src/app.ts:208).
 */
async function signIn(base: string, username: string, password: string): Promise<string> {
  const reply = await fetch(`${base}/api/auth/sign-in/username`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    redirect: "manual",
  });
  const text = await reply.text();
  if (reply.ok) {
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const token = isRecord(body) && typeof body.token === "string" && body.token !== "" ? body.token : reply.headers.get("set-auth-token");
    if (token === null || token === "") throw new Error(`Lumiverse signed ${username} in but sent back no session token`);
    return token;
  }
  if (reply.status === 401) throw new Error(`Lumiverse refused ${username}'s username or password. The set-up doesn't try again: every sign-in counts toward Lumiverse's limit (src/app.ts:258-262)`);
  if (reply.status === 429) throw new Error(`Lumiverse refuses sign-ins from this address for now${reply.headers.get("retry-after") ? ` (for ${reply.headers.get("retry-after")} s)` : ""}: it allows 8 in 5 minutes (src/app.ts:258-262)`);
  throw new HttpError(reply.status, text, "POST /api/auth/sign-in/username");
}

async function signedIn(env: InstanceEnv, who: Who): Promise<Lumiverse> {
  const account = env[who];
  const saved = savedLogin(env, who);
  if (saved !== null) {
    const client = new Lumiverse(env.hostUrl, saved.token);
    if ((await sessionUser(client)) === account.username.toLowerCase()) return client;
  }
  return new Lumiverse(env.hostUrl, await signIn(env.hostUrl, account.username, account.password));
}

export function setupContext(env: InstanceEnv, log: RunLog): SetupCtx {
  const sessions = new Map<Who, Promise<Lumiverse>>();
  return {
    env,
    log,
    session(who) {
      let held = sessions.get(who);
      if (held === undefined) {
        held = signedIn(env, who);
        sessions.set(who, held);
      }
      return held;
    },
  };
}

// The runtime-folder step comes last. Its runtime's `lumiah up` adds the loopback connection only
// for a user who has none (LumiAH `src/runtime/cli.ts:706-715`), and a later `up` does not move an
// existing connection's address: seen on the bed, where the owner's `up` after it said "Your
// connection is the loopback (…:7881/v1)" while the connection kept the folder runtime's port. So
// the owner's own runtime is set up first, and the check that the owner's loopback connection
// points at the owner's runtime, which answers (`loopbackAnswers`), runs again after the last step.
export const SETUP_STEPS: SetupStep[] = [connection, users, install, cli, runtimes, runtimeConnection, runtimeSettings, runtimeFolder];

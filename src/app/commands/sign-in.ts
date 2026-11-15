// RPE's sign-in to Lumiverse as the command line makes and keeps it.

import { LumiverseError, LumiverseSession, type StoredSignIn } from "../../adapter/lumiverse/session";
import { whoseRefusals } from "../../migrate/swap";
import { isRecord } from "../../shared/json";
import type { CliIO } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import { prepareDataFolder, updateConfigFile } from "../config";
import { SecretsFile } from "../secrets";

/** The part of the secrets file the adapter keeps its sign-in to Lumiverse in (src/adapter/lumiverse/mount.ts). */
export const SIGN_IN_PART = "lumiverse";

/**
 * A session with Lumiverse at `url` for the command line, from a kept sign-in or none; a sign-in
 * Lumiverse takes is kept in the secrets file once `guard` (where given) has not refused its user.
 */
export function commandLineSession(url: string, signIn: StoredSignIn | null, paths: DataPaths, config: AppConfig, io: CliIO, guard?: (user: string) => void): LumiverseSession {
  const secrets = new SecretsFile(paths.secrets);
  return new LumiverseSession({
    base: url,
    // Past this the address counts as one that does not answer.
    fetch: (address, init) => io.fetch(address, { ...init, signal: AbortSignal.timeout(config.commandLine.signInMs) }),
    signIn,
    // Called only once Lumiverse has taken the password, or has said a kept sign-in ended.
    async save(next) {
      if (next !== null) guard?.(next.user);
      await prepareDataFolder(paths);
      await secrets.write(SIGN_IN_PART, next === null ? null : { ...next });
    },
    // The server's own command line says whose RPE this is, so any account may sign in here.
    owner: () => null,
    // The handle is one this setTimeout gave.
    clock: { now: io.now, setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]) },
    log: io.err,
  });
}

/**
 * Whose RPE this is, asked of a sign-in once Lumiverse has taken the password and before the sign-in,
 * the config, a key or a connection is written, by the migration gate's own checks (`whoseRefusals`):
 * one RPE serves one Lumiverse user, so a sign-in as another user than the one it belongs to, or than
 * the one whose data a migration carried into it, is refused. An RPE nobody has signed in to and
 * nothing was carried into takes whoever signs in first.
 */
export function oneUser(paths: DataPaths, config: AppConfig): (user: string) => void {
  return (user) => {
    const refusals = whoseRefusals(paths.root, config.lumiverse.user, user);
    if (refusals.length > 0) throw new Error(`${refusals.join(" ")} Nothing was stopped or changed.`);
  };
}

/**
 * Signs in to Lumiverse at `url` as `username` with the password asked for. Only once Lumiverse has
 * taken it, and `guard` has not refused the user it signs in as, are the sign-in kept and the config
 * written (with `more` in its `lumiverse` block), so a refusal changes nothing. The user written is
 * the id Lumiverse answers for the username, which is what pages and Lumiverse's rows name.
 */
export async function signInTo(url: string, username: string, more: Record<string, string>, paths: DataPaths, config: AppConfig, io: CliIO, guard: (user: string) => void): Promise<LumiverseSession> {
  const password = await io.secret(`The Lumiverse password of ${username} (it is not shown, and not kept): `);
  if (password === null) throw new Error("Signing in needs the password.");
  const session = commandLineSession(url, null, paths, config, io, guard);
  const signedIn = await session.signIn(username, password);
  await updateConfigFile(paths, (raw) => {
    raw.lumiverse = { ...(isRecord(raw.lumiverse) ? raw.lumiverse : {}), url, user: signedIn.user, ...more };
  });
  io.out(`Signed in to Lumiverse at ${url} as ${signedIn.username}. This RPE belongs to that Lumiverse user (${signedIn.user}).`);
  return session;
}

/** The kept sign-in, when it is to `url` as `username` for the user this RPE belongs to and Lumiverse still takes it; null otherwise. */
export async function keptSession(url: string, username: string, paths: DataPaths, config: AppConfig, io: CliIO): Promise<LumiverseSession | null> {
  const kept = await new SecretsFile(paths.secrets).read(SIGN_IN_PART);
  const user = config.lumiverse.user;
  if (config.lumiverse.url !== url || user === null || !isRecord(kept) || kept.username !== username || kept.user !== user || typeof kept.token !== "string" || typeof kept.savedAt !== "number") return null;
  const session = commandLineSession(url, { username, user, token: kept.token, savedAt: kept.savedAt }, paths, config, io);
  try {
    await session.check();
  } catch (error) {
    // Ended: it has said so, and a new sign-in follows.
    if (error instanceof LumiverseError && error.problem === "lost") return null;
    throw error;
  }
  return session;
}

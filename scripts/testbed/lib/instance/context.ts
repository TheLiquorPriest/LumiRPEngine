// What the play steps are given, built for one user of the instance: the steps' own `Ctx`
// (`../context.ts`), except that today's command line runs with that user's config folder inside the
// runtime home (`./env.ts`), so its sign-in never lands in the account's own home, and the REST
// client and the page session use the session that sign-in saved. The instance's user gets a page
// session and a player, as the play steps need; the second user gets what the steps that play as it
// need: no player, since nothing of its plays a turn.

import { Cli, CliError } from "../cli";
import type { Ctx } from "../context";
import { cliPath, IDENTIFIER } from "../env";
import { Lumiverse } from "../lumiverse";
import { Player } from "../play";
import type { RunLog } from "../record";
import { EngineSocket } from "../socket";
import { cliConfigHome, credentialsFile, type InstanceEnv, type Who } from "./env";

/** Today's command line for one user, signed in under that user's config folder in the runtime home. */
export class UserCli extends Cli {
  constructor(
    private readonly ienv: InstanceEnv,
    readonly who: Who,
  ) {
    super(ienv);
  }

  /** The variables today's command line is run with for this user. */
  environment(): { [name: string]: string | undefined } {
    return { ...process.env, XDG_CONFIG_HOME: cliConfigHome(this.ienv, this.who), LUMIVERSE_URL: this.ienv.hostUrl };
  }

  override async run<T = unknown>(args: string[], options: { input?: string } = {}): Promise<T> {
    const proc = Bun.spawn([process.execPath, cliPath(this.ienv), ...args], {
      env: this.environment(),
      stdin: options.input !== undefined ? new TextEncoder().encode(options.input) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new CliError(args, code, `${out}\n${err}`.trim());
    try {
      return JSON.parse(out) as T;
    } catch {
      return out as T;
    }
  }
}

/** The session today's command line saved for one user at its `login` (the file is keyed by Lumiverse's address, RPE on `main`, `src/cli/credentials.ts:1-4`). */
export async function savedTokenOf(env: InstanceEnv, who: Who): Promise<string> {
  const path = credentialsFile(env, who);
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`no sign-in at ${path}: the set-up's cli step signs each user in`);
  const saved: unknown = JSON.parse(await file.text());
  const hosts = saved !== null && typeof saved === "object" && "hosts" in saved ? saved.hosts : undefined;
  const entry = hosts !== null && typeof hosts === "object" ? Object.entries(hosts).find(([base]) => base === env.hostUrl)?.[1] : undefined;
  const token: unknown = entry !== null && typeof entry === "object" && "token" in entry ? entry.token : undefined;
  if (typeof token !== "string" || token === "") throw new Error(`the ${who} user's command line has no sign-in for ${env.hostUrl}`);
  return token;
}

/** What a step that plays as the second user is given: the same parts as `Ctx` without the player, whose turns it never plays. */
export type UserCtx = Omit<Ctx, "player" | "connectionId" | "env"> & { env: InstanceEnv; who: Who };

async function engineOf(host: Lumiverse): Promise<string> {
  const extension = await host.extension(IDENTIFIER);
  if (extension.status !== "running") throw new Error(`the engine's extension is ${extension.status}, not running`);
  return extension.id;
}

/** The instance user's context: a page session that claims the replies the engine prepares, and the player on the run's connection. */
export async function ownerContext(env: InstanceEnv, log: RunLog): Promise<Ctx & { env: InstanceEnv }> {
  const host = new Lumiverse(env.hostUrl, await savedTokenOf(env, "owner"));
  const [userId, extensionId, connections] = await Promise.all([host.userId(), engineOf(host), host.connections()]);
  const connection = connections.find((c) => c.name === env.connectionName);
  if (connection === undefined) throw new Error(`the instance's user has no Lumiverse connection named "${env.connectionName}"`);
  const socket = await EngineSocket.open(host, extensionId, { page: true });
  return { env, host, socket, player: new Player(socket, host, log, connection.id), cli: new UserCli(env, "owner"), log, userId, extensionId, connectionId: connection.id };
}

/** The second user's context: a widget session (it never takes a page's place) and its own command line. */
export async function otherContext(env: InstanceEnv, log: RunLog): Promise<UserCtx> {
  const host = new Lumiverse(env.hostUrl, await savedTokenOf(env, "other"));
  const [userId, extensionId] = await Promise.all([host.userId(), engineOf(host)]);
  const socket = await EngineSocket.open(host, extensionId, { page: false });
  return { env, who: "other", host, socket, cli: new UserCli(env, "other"), log, userId, extensionId };
}

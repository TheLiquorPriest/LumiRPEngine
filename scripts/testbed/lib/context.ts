// What every step is given: the host, the engine's page session and its player, the engine's CLI,
// the run's memory and change log, and the ids every step needs.

import { Cli } from "./cli";
import { IDENTIFIER, readEnv, type TestbedEnv } from "./env";
import { Lumiverse, savedToken } from "./lumiverse";
import { Player } from "./play";
import { RunLog } from "./record";
import { EngineSocket } from "./socket";

export interface Ctx {
  env: TestbedEnv;
  host: Lumiverse;
  /** The engine's page session: Play's, GM's, Build's and Settings' requests, and the harness pages'. */
  socket: EngineSocket;
  player: Player;
  cli: Cli;
  log: RunLog;
  userId: string;
  extensionId: string;
  /** The Lumiverse connection the classic and agents engines run on (`LRE_CONNECTION_NAME`). */
  connectionId: string;
}

export interface Step {
  name: string;
  /** What the step makes, for the console. */
  makes: string;
  run(ctx: Ctx): Promise<void>;
}

export async function openContext(): Promise<Ctx> {
  const env = readEnv();
  const host = new Lumiverse(env.hostUrl, savedToken(env));
  const [userId, extension, connections] = await Promise.all([host.userId(), host.extension(IDENTIFIER), host.connections()]);
  if (extension.status !== "running") throw new Error(`the engine's extension is ${extension.status}, not running`);
  const connection = connections.find((c) => c.name === env.connectionName);
  if (connection === undefined) throw new Error(`no Lumiverse connection named "${env.connectionName}"`);
  const socket = await EngineSocket.open(host, extension.id, { page: true });
  const log = new RunLog(env.instanceDir);
  return { env, host, socket, player: new Player(socket, host, log, connection.id), cli: new Cli(env), log, userId, extensionId: extension.id, connectionId: connection.id };
}

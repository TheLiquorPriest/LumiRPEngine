// What this client is: its own version (the package's), the engine it bundles, the world format
// that engine reads and writes, and the agent API level it needs of LumiRPEngine on the host.

import pkg from "../../package.json";
import { AGENT_API } from "../shared/protocol";
import { ENGINE_VERSION, WORLD_FORMAT } from "../shared/world";

export const CLI_NAME = "lumirpengine";
export const CLI_VERSION: string = pkg.version;

export const VERSION_LINE = `${CLI_NAME} ${CLI_VERSION} (engine ${ENGINE_VERSION}, world format ${WORLD_FORMAT}, agent API ${AGENT_API})`;

/** The same, as data. */
export const VERSIONS = { cli: CLI_VERSION, engine: ENGINE_VERSION, worldFormat: WORLD_FORMAT, agentApi: AGENT_API } as const;

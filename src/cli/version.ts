// What this client is: its own version (the package's) and build, the engine it bundles, the world
// format that engine reads and writes, and the agent API level it needs of LumiRPEngine on the host.

import pkg from "../../package.json";
import { RUNTIMES } from "../shared/agents";
import { AGENT_API } from "../shared/protocol";
import { ENGINE_VERSION, WORLD_FORMAT } from "../shared/world";

export const CLI_NAME = "lumirpengine";
export const CLI_VERSION: string = pkg.version;
/** The build this bundle came from: `bun run build` defines it into every bundle (DESIGN §23); "dev" run from source. */
export const BUILD: string = process.env.LRE_BUILD_ID ?? "dev";

/**
 * Why this runtime can't follow LumiRPEngine's kit, or null when it can. The core imports the kit
 * as a data URL of a few megabytes, and Bun before 1.4 refuses one over about 2 KB, so there
 * following is off before it is tried, rather than fail with the whole URL in its error. Either
 * runtime that can is the fix: a newer Bun, as Lumiverse's own machine has, or Node.
 */
export function runtimeCannotFollow(bun: string | undefined): string | null {
  if (bun === undefined) return null;
  const [major = 0, minor = 0] = bun.split(".").map(Number);
  return major > 1 || (major === 1 && minor >= 4) ? null : `run it with ${RUNTIMES.map((r) => r.needs).join(", or ")} (Bun before 1.4 can't load the kit)`;
}

/** `--version`'s line, with why it can't follow under this runtime when it can't. */
export function versionLine(bun: string | undefined): string {
  const cannot = runtimeCannotFollow(bun);
  return `${CLI_NAME} ${CLI_VERSION} (build ${BUILD}, engine ${ENGINE_VERSION}, world format ${WORLD_FORMAT}, agent API ${AGENT_API})${cannot === null ? "" : `; under Bun ${bun ?? ""} it can't follow LumiRPEngine's tools: ${cannot}`}`;
}

export const VERSION_LINE = versionLine(process.versions.bun);

/** The same, as data. */
export const VERSIONS = { cli: CLI_VERSION, build: BUILD, engine: ENGINE_VERSION, worldFormat: WORLD_FORMAT, agentApi: AGENT_API } as const;

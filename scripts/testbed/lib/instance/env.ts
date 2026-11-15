// What making the test instance from nothing needs of the machine, beyond what the play steps need
// (`../env.ts`). Every value comes from the environment with no default, so nothing here names a
// host, a user, a path or a key; README.md beside this folder lists the variables.
//
// The instance keeps every file of today's runtime and today's command line inside one folder of
// its own, the runtime home, laid out as a home folder is: the runtime's config in
// `<home>/.config/lumiah/`, its folders in `<home>/.local/share/lumiah/` (LumiAH
// `src/runtime/config.ts:64-81` reads both from `XDG_CONFIG_HOME` and `XDG_DATA_HOME`), and the
// command line's sign-in in `<home>/.config/lumirpengine/credentials.json` (RPE on `main`,
// `src/cli/credentials.ts:27-32`). `golden.sh` copies `<home>/.config/lumiah` and
// `<home>/.local/share/lumiah` by those names. The command line keeps one sign-in per Lumiverse
// address, so the second user's sign-in has a config folder of its own under the same home.

import { join } from "node:path";
import { IDENTIFIER, readEnv, type TestbedEnv } from "../env";

export type Who = "owner" | "other";

export interface Account {
  username: string;
  password: string;
}

export interface RuntimeSpec {
  /** The name `lumiah up --name` is given: its config file's and its unit's name are made from it. */
  name: string;
  /** The loopback port it serves its endpoint on. */
  port: number;
}

export interface InstanceEnv extends TestbedEnv {
  /** Lumiverse's checkout, whose commit the run records. */
  coreDir: string;
  /** The instance's user: the Lumiverse owner the lead made, whose data RPE and the migration own. */
  owner: Account;
  /** The second invented user, made by the script, whose data the boundary checks keep out. */
  other: Account;
  /** The provider and model of the Lumiverse connection named `connectionName`, and its key. */
  provider: string;
  model: string;
  providerKey: string;
  /** Today's pushed build: the repository Lumiverse installs it from, and its branch. */
  buildUrl: string;
  buildBranch: string;
  /** The folder that holds every file of today's runtime and today's command line. */
  runtimeHome: string;
  /** Today's `--memory` cap for each runtime's unit, as systemd reads a size ("768M"). */
  runtimeMemory: string;
  runtimes: { [who in Who]: RuntimeSpec };
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`set ${name} (see scripts/testbed/README.md)`);
  return value.trim();
}

function port(name: string): number {
  const value = Number(required(name));
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`${name} is not a port`);
  return value;
}

function absolute(name: string): string {
  const value = required(name).replace(/\/+$/, "");
  if (!value.startsWith("/")) throw new Error(`${name} must be an absolute path`);
  return value;
}

export function readInstanceEnv(): InstanceEnv {
  return {
    ...readEnv(),
    coreDir: absolute("LRE_CORE_DIR"),
    owner: { username: required("LRE_OWNER_USERNAME"), password: required("LRE_OWNER_PASSWORD") },
    other: { username: required("LRE_OTHER_USERNAME"), password: required("LRE_OTHER_PASSWORD") },
    provider: required("LRE_CONNECTION_PROVIDER"),
    model: required("LRE_CONNECTION_MODEL"),
    providerKey: required("LRE_PROVIDER_KEY"),
    buildUrl: required("LRE_BUILD_URL"),
    buildBranch: required("LRE_BUILD_BRANCH"),
    runtimeHome: absolute("LRE_RUNTIME_HOME"),
    runtimeMemory: required("LRE_RUNTIME_MEMORY"),
    runtimes: {
      owner: { name: required("LRE_RUNTIME_NAME"), port: port("LRE_RUNTIME_PORT") },
      other: { name: required("LRE_OTHER_RUNTIME_NAME"), port: port("LRE_OTHER_RUNTIME_PORT") },
    },
  };
}

/** The variables today's runtime is run with, so its config and its folders stay in the runtime home. */
export function runtimeXdg(env: Pick<InstanceEnv, "runtimeHome">): { XDG_CONFIG_HOME: string; XDG_DATA_HOME: string } {
  return { XDG_CONFIG_HOME: join(env.runtimeHome, ".config"), XDG_DATA_HOME: join(env.runtimeHome, ".local", "share") };
}

/** `XDG_CONFIG_HOME` for one user's command line: the owner's is the runtime's own; the other user's is beside it. */
export function cliConfigHome(env: Pick<InstanceEnv, "runtimeHome">, who: Who): string {
  return who === "owner" ? runtimeXdg(env).XDG_CONFIG_HOME : join(env.runtimeHome, "other", ".config");
}

/** Where one user's command line keeps its sign-in. */
export function credentialsFile(env: Pick<InstanceEnv, "runtimeHome">, who: Who): string {
  return join(cliConfigHome(env, who), "lumirpengine", "credentials.json");
}

/** Today's build's installed copy in Lumiverse's data folder, and the two programs it ships. */
export const buildDir = (env: Pick<TestbedEnv, "dataDir">): string => join(env.dataDir, "extensions", IDENTIFIER, "repo");
export const lumiahPath = (env: Pick<TestbedEnv, "dataDir">): string => join(buildDir(env), "dist", "lumiah.js");

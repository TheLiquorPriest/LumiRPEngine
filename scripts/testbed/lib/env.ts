// What the test-instance scripts need of the machine they run on. Everything machine- or
// account-specific comes from the environment, with no defaults, so nothing here names a host, a
// user or a path (see the README beside this folder for the variables).

import { join } from "node:path";

/** The engine's extension identifier in Lumiverse, as its manifest names it. */
export const IDENTIFIER = "lumi_rp_engine";

export interface TestbedEnv {
  /** Lumiverse's base URL, as a browser opens it. */
  hostUrl: string;
  /** Lumiverse's data folder: the engine's own CLI and the user's storage are found under it. */
  dataDir: string;
  /** The scripts' own folder for their state, their change log and the CLI's sign-in. */
  instanceDir: string;
  /** The Lumiverse connection every model call of the classic and agents engines runs on, by its name. */
  connectionName: string;
  /** Chat id prefixes the scripts must never act on, read or play, whatever else they find. */
  neverTouch: string[];
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`set ${name} (see scripts/testbed/README.md)`);
  return value.trim();
}

export function readEnv(): TestbedEnv {
  return {
    hostUrl: required("LRE_HOST_URL").replace(/\/+$/, ""),
    dataDir: required("LRE_DATA_DIR").replace(/\/+$/, ""),
    instanceDir: required("LRE_INSTANCE_DIR").replace(/\/+$/, ""),
    connectionName: required("LRE_CONNECTION_NAME"),
    neverTouch: (process.env.LRE_NEVER_TOUCH ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter((id) => id !== ""),
  };
}

/** Where the extension's own `lumirpengine` command line is, in the installed copy. */
export const cliPath = (env: TestbedEnv): string => join(env.dataDir, "extensions", IDENTIFIER, "repo", "dist", "lumirpengine.js");

/** The CLI keeps its sign-in under `$XDG_CONFIG_HOME/lumirpengine/`; the scripts point it at their own folder. */
export const configHome = (env: TestbedEnv): string => join(env.instanceDir, "config");

/** The engine's storage for one user: Spindle's per-user extension folder. */
export const userStorage = (env: TestbedEnv, userId: string): string => join(env.dataDir, "users", userId, "extensions", IDENTIFIER);

/** Throws when an id falls under one of the prefixes the scripts must never touch. */
export function guard(env: TestbedEnv, id: string): string {
  const lower = id.toLowerCase();
  const hit = env.neverTouch.find((prefix) => lower.startsWith(prefix));
  if (hit !== undefined) throw new Error(`refusing to act on ${id.slice(0, 8)}…: it is on LRE_NEVER_TOUCH`);
  return id;
}

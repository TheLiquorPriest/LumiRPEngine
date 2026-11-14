// The turn lane's settings (plan §5.4 "Config", Appendix D.1), from the config files of the chat's
// levels (`RPE-global.yml` shipped and global, the chat's `RPE.yml`), the nearer level's value over the
// farther one's, mapping by mapping. Each is a setting with a default; the defaults are here and
// nowhere else. A value a setting does not take is logged with its file and passed over, and the
// default holds; it never stops a turn.
//
//   lead: lead                   the agent definition that leads a turn
//   carry: continuing            what a session carries between turns: continuing, records or nothing
//   limits:
//     previousRun: 20            seconds a turn waits for the run of the turn before it; then that run is stopped
//   chat:
//     hiddenReadable: false      agents may read the messages the player hid from the prompt
//   passConnection: <name>       the connection a request with no tag is passed on to (global level only;
//                                absent: the default connection)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Carry, FilesPort, JsonValue, Log, Scope } from "rp-harness/contract";
import { GLOBAL_CONFIG, SHIPPED_FOLDER } from "../tree";

export interface TurnSettings {
  lead: string;
  carry: Carry;
  /** How long a turn waits for the previous turn's run, in milliseconds. */
  previousRunMs: number;
  hiddenReadable: boolean;
}

/** The defaults, where no level sets a value. */
export const TURN_DEFAULTS: Readonly<TurnSettings> = Object.freeze({
  // The lead RPH ships (`guidance/.agents/lead.md`): RPE ships no definition of its own yet; plan §13.1's Author is named here once it does.
  lead: "lead",
  // Appendix D.1: continuing, until the session measurement says otherwise.
  carry: "continuing",
  // Appendix D.1: 20 s, then stop it.
  previousRunMs: 20_000,
  // Appendix D.1: as today's setting, which is off.
  hiddenReadable: false,
});

type Mapping = { [key: string]: JsonValue };

function isMapping(value: unknown): value is Mapping {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function merged(far: Mapping, near: Mapping): Mapping {
  const out: Mapping = { ...far };
  for (const [key, value] of Object.entries(near)) {
    const before = out[key];
    out[key] = isMapping(before) && isMapping(value) ? merged(before, value) : value;
  }
  return out;
}

/** The scope's config, every level's file read and merged, farthest first. */
async function configOf(files: FilesPort, scope: Scope, log: Log): Promise<{ config: Mapping; from: string }> {
  let config: Mapping = {};
  const paths: string[] = [];
  for (const layer of await files.layers(scope)) {
    if (layer.config === undefined) continue;
    const path = `${layer.mount}${layer.config}`;
    const read = await files.read(scope, path);
    if (read.status !== "read" || read.text.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = Bun.YAML.parse(read.text);
    } catch (error) {
      log.warn("A config file does not parse; the turn's settings in it are passed over.", { path, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!isMapping(parsed)) continue;
    config = merged(config, parsed);
    paths.push(path);
  }
  return { config, from: paths.join(", ") };
}

/** The turn's settings for a scope, as its levels' config files set them over the defaults. */
export async function turnSettings(files: FilesPort, scope: Scope, log: Log): Promise<TurnSettings> {
  const { config, from } = await configOf(files, scope, log);
  const passed = (key: string, value: JsonValue | undefined): void => log.warn("A setting has a value it does not take; its default holds.", { setting: key, value: value ?? null, files: from });
  const section = (key: string): Mapping => {
    const value = config[key];
    if (value === undefined) return {};
    if (isMapping(value)) return value;
    passed(key, value);
    return {};
  };
  const lead = config["lead"];
  const carry = config["carry"];
  const seconds = section("limits")["previousRun"];
  const hidden = section("chat")["hiddenReadable"];
  const valid = {
    lead: typeof lead === "string" && lead.trim() !== "",
    carry: carry === "continuing" || carry === "records" || carry === "nothing",
    seconds: typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0,
    hidden: typeof hidden === "boolean",
  };
  if (lead !== undefined && !valid.lead) passed("lead", lead);
  if (carry !== undefined && !valid.carry) passed("carry", carry);
  if (seconds !== undefined && !valid.seconds) passed("limits.previousRun", seconds);
  if (hidden !== undefined && !valid.hidden) passed("chat.hiddenReadable", hidden);
  return {
    lead: valid.lead ? (lead as string).trim() : TURN_DEFAULTS.lead,
    carry: valid.carry ? (carry as Carry) : TURN_DEFAULTS.carry,
    previousRunMs: valid.seconds ? (seconds as number) * 1000 : TURN_DEFAULTS.previousRunMs,
    hiddenReadable: valid.hidden ? (hidden as boolean) : TURN_DEFAULTS.hiddenReadable,
  };
}

/**
 * The connection a request with no tag is passed on to, as the global level's config names it (the
 * user's `RPE-global.yml` over the shipped one); null for the default connection. Read from the files
 * as it is asked for, since such requests come without a chat to read a tree for.
 */
export function passConnection(files: string, log: Log): string | null {
  let chosen: string | null = null;
  for (const path of [join(files, SHIPPED_FOLDER, GLOBAL_CONFIG), join(files, GLOBAL_CONFIG)]) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    try {
      const parsed: unknown = Bun.YAML.parse(text);
      if (isMapping(parsed) && typeof parsed["passConnection"] === "string" && parsed["passConnection"].trim() !== "") chosen = parsed["passConnection"].trim();
    } catch (error) {
      log.warn("A config file does not parse; the connection for requests with no tag is taken from the others.", { path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return chosen;
}

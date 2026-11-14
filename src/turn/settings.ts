// The turn lane's settings (plan §5.4 "Config", Appendix D.1), from the config files of the chat's
// levels (`RPE-global.yml` shipped and global, the chat's `RPE.yml`), the nearer level's value over the
// farther one's, mapping by mapping. Each is a setting with a default; the defaults are here and
// nowhere else. A value a setting does not take is logged with its file and passed over, and the
// default holds; it never stops a turn.
//
//   lead: author                 the agent definition that leads a turn
//   carry: continuing            what a session carries between turns: continuing, records or nothing
//   limits:
//     previousRun: 20            seconds a turn waits for the run of the turn before it; then that run is stopped
//   chat:
//     hiddenReadable: false      agents may read the messages the player hid from the prompt
//   history:
//     window: 40                 the latest this many of the chat's messages stay in the prompt; null keeps them all
//     step: null                 lets the window grow by this many before it is cut back to its size; null is off
//     hold: false                keeps a message the story record does not cover in the prompt: true or false,
//                                or { on: true, cap: 40 }, cap being the most messages it holds past the window
//   passConnection: <name>       the connection a request with no tag is passed on to (global level only;
//                                absent: the default connection)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Carry, FilesPort, JsonValue, Log, Scope } from "rp-harness/contract";
import { WINDOW_DEFAULTS, type WindowSettings } from "../story/window";
import { GLOBAL_CONFIG, SHIPPED_FOLDER } from "../tree";

export interface TurnSettings {
  lead: string;
  carry: Carry;
  /** How long a turn waits for the previous turn's run, in milliseconds. */
  previousRunMs: number;
  hiddenReadable: boolean;
  /** The history window (`src/story/window`). */
  window: WindowSettings;
}

/** The defaults, where no level sets a value. */
export const TURN_DEFAULTS: Readonly<TurnSettings> = Object.freeze({
  // Plan §13.1: the Author, as RPE ships it (`guidance/.agents/author.md`).
  lead: "author",
  // Appendix D.1: continuing, until the session measurement says otherwise.
  carry: "continuing",
  // Appendix D.1: 20 s, then stop it.
  previousRunMs: 20_000,
  // Appendix D.1: as today's setting, which is off.
  hiddenReadable: false,
  // Appendix D.1, as the window's own module keeps them.
  window: WINDOW_DEFAULTS,
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

/** A whole number of at least `least`. */
function whole(value: JsonValue | undefined, least: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= least;
}

/** The window's hold as a level sets it: on or off with the default cap, or a mapping of either; undefined for a value it does not take. */
function holdOf(value: JsonValue): WindowSettings["hold"] | undefined {
  if (typeof value === "boolean") return { on: value, cap: TURN_DEFAULTS.window.hold.cap };
  if (!isMapping(value)) return undefined;
  const on = value["on"] ?? TURN_DEFAULTS.window.hold.on;
  const cap = value["cap"] ?? TURN_DEFAULTS.window.hold.cap;
  return typeof on === "boolean" && whole(cap, 0) ? { on, cap } : undefined;
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
  const history = section("history");
  const size = history["window"];
  const step = history["step"];
  const hold = history["hold"] === undefined ? undefined : holdOf(history["hold"]);
  const valid = {
    lead: typeof lead === "string" && lead.trim() !== "",
    carry: carry === "continuing" || carry === "records" || carry === "nothing",
    seconds: typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0,
    hidden: typeof hidden === "boolean",
    size: size === null || whole(size, 1),
    step: step === null || whole(step, 1),
  };
  if (lead !== undefined && !valid.lead) passed("lead", lead);
  if (carry !== undefined && !valid.carry) passed("carry", carry);
  if (seconds !== undefined && !valid.seconds) passed("limits.previousRun", seconds);
  if (hidden !== undefined && !valid.hidden) passed("chat.hiddenReadable", hidden);
  if (size !== undefined && !valid.size) passed("history.window", size);
  if (step !== undefined && !valid.step) passed("history.step", step);
  if (history["hold"] !== undefined && hold === undefined) passed("history.hold", history["hold"]);
  return {
    lead: valid.lead ? (lead as string).trim() : TURN_DEFAULTS.lead,
    carry: valid.carry ? (carry as Carry) : TURN_DEFAULTS.carry,
    previousRunMs: valid.seconds ? (seconds as number) * 1000 : TURN_DEFAULTS.previousRunMs,
    hiddenReadable: valid.hidden ? (hidden as boolean) : TURN_DEFAULTS.hiddenReadable,
    window: {
      size: valid.size && size !== undefined ? (size as number | null) : TURN_DEFAULTS.window.size,
      step: valid.step && step !== undefined ? (step as number | null) : TURN_DEFAULTS.window.step,
      hold: hold ?? TURN_DEFAULTS.window.hold,
    },
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

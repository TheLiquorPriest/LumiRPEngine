// The turn lane's settings (plan §5.4 "Config", Appendix D.1), from the config files of the chat's
// levels (`RPE-global.yml` shipped and global, the chat's `RPE.yml`), the nearer level's value over the
// farther one's, mapping by mapping. Each is a setting with a default, declared in `TURN_SETTINGS`, which
// the reader takes every value through and the Settings page lists; the defaults are here and nowhere
// else. A value a setting does not take is logged with its file and passed over, and the default
// holds; it never stops a turn.
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
import { isMapping, type Mapping, mergedConfig, type SettingDef, settingIn } from "../app/setting-list";
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

const CARRIES: readonly Carry[] = ["continuing", "records", "nothing"];

/** Each setting as the files write it, by the name this file reads it under. */
const DEFS = {
  lead: { key: "lead", default: TURN_DEFAULTS.lead, takes: { type: "text" }, perConnection: false },
  carry: { key: "carry", default: TURN_DEFAULTS.carry, takes: { type: "oneOf", values: CARRIES }, perConnection: false },
  previousRun: { key: "limits.previousRun", default: TURN_DEFAULTS.previousRunMs / 1000, takes: { type: "number", least: 0 }, perConnection: false },
  hiddenReadable: { key: "chat.hiddenReadable", default: TURN_DEFAULTS.hiddenReadable, takes: { type: "yesNo" }, perConnection: false },
  window: { key: "history.window", default: TURN_DEFAULTS.window.size, takes: { type: "whole", least: 1 }, orNone: true, none: "every message kept", perConnection: false },
  step: { key: "history.step", default: TURN_DEFAULTS.window.step, takes: { type: "whole", least: 1 }, orNone: true, none: "off", perConnection: false },
  // `hold: true` is `hold: { on: true }`, its cap the default.
  holdOn: { key: "history.hold.on", default: TURN_DEFAULTS.window.hold.on, takes: { type: "yesNo" }, short: true, perConnection: false },
  holdCap: { key: "history.hold.cap", default: TURN_DEFAULTS.window.hold.cap, takes: { type: "whole", least: 0 }, perConnection: false },
  // Read with no chat (`passConnection` below), so from the global level alone.
  passConnection: { key: "passConnection", default: null, takes: { type: "text" }, orNone: true, none: "the default connection", levels: ["shipped", "global"], perConnection: false },
} as const satisfies Record<string, SettingDef>;

/** Every setting the turn lane reads, as a config file writes it. */
export const TURN_SETTINGS: readonly SettingDef[] = Object.values(DEFS);

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
    config = mergedConfig(config, parsed);
    paths.push(path);
  }
  return { config, from: paths.join(", ") };
}

/** The turn's settings for a scope, as its levels' config files set them over the defaults. */
export async function turnSettings(files: FilesPort, scope: Scope, log: Log): Promise<TurnSettings> {
  const { config, from } = await configOf(files, scope, log);
  const value = (def: SettingDef): JsonValue => {
    const read = settingIn(config, def);
    if (read.passed !== null) log.warn("A setting has a value it does not take; its default holds.", { setting: def.key, value: read.passed.value, files: from });
    return read.value;
  };
  // Each value is one its setting takes (`settingIn`), so it is of the type the setting's `takes` says.
  return {
    lead: value(DEFS.lead) as string,
    carry: value(DEFS.carry) as Carry,
    previousRunMs: (value(DEFS.previousRun) as number) * 1000,
    hiddenReadable: value(DEFS.hiddenReadable) as boolean,
    window: {
      size: value(DEFS.window) as number | null,
      step: value(DEFS.step) as number | null,
      hold: { on: value(DEFS.holdOn) as boolean, cap: value(DEFS.holdCap) as number },
    },
  };
}

/**
 * The connection a request with no tag is passed on to, as the global level's config names it (the
 * user's `RPE-global.yml` over the shipped one); null for the default connection. Read from the files
 * as it is asked for, since such requests come without a chat to read a tree for.
 */
export function passConnection(files: string, log: Log): string | null {
  let config: Mapping = {};
  for (const path of [join(files, SHIPPED_FOLDER, GLOBAL_CONFIG), join(files, GLOBAL_CONFIG)]) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    try {
      const parsed: unknown = Bun.YAML.parse(text);
      if (isMapping(parsed)) config = mergedConfig(config, parsed);
    } catch (error) {
      log.warn("A config file does not parse; the connection for requests with no tag is taken from the others.", { path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return settingIn(config, DEFS.passConnection).value as string | null;
}

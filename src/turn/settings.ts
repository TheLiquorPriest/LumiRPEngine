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
//
// With them, the settings of the areas the turn lane hands a chat's work to, each group declared by its
// area (`cast:`, `story:`, `worldState:`, `engine:`): read here for the chat, at every level. The areas
// the lane makes once for every chat (the store, the lore and its index, the story's facts) are given
// theirs from the global level alone (`globalConfig`), when RPE starts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Carry, FilesPort, JsonValue, Log, Scope } from "rp-harness/contract";
import { isMapping, type Mapping, mergedConfig, type NumberSettings, numbersIn, type SettingDef, settingIn } from "../app/setting-list";
import { CAST_DEFAULTS, CAST_SETTING_DEFS, type CastSettings } from "../cast";
import { IFACE_DEFAULTS, IFACE_SETTING_DEFS, type IfaceSettings } from "../iface";
import { WORLD_STATE_DEFAULTS, WORLD_STATE_SETTING_DEFS, type WorldStateSettings } from "../store";
import { STORY_DEFAULTS, STORY_SETTING_DEFS, STORY_SO_FAR_SETTING_DEFS, type StorySettings } from "../story";
import { STORY_SO_FAR_DEFAULTS, type StorySoFarSettings } from "../story/sofar";
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
  /** The cast's tools and views, for the chat. */
  cast: CastSettings;
  /** The story's tools, for the chat. */
  story: StorySettings;
  /** The story so far in the briefing. */
  storySoFar: StorySoFarSettings;
  /** The world state in the briefing. */
  worldState: WorldStateSettings;
  /** The engine's tools, for the chat. */
  engine: IfaceSettings;
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
  // Appendix D.1, as each area keeps its own.
  cast: CAST_DEFAULTS,
  story: STORY_DEFAULTS,
  storySoFar: STORY_SO_FAR_DEFAULTS,
  worldState: WORLD_STATE_DEFAULTS,
  engine: IFACE_DEFAULTS,
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

/** A config, merged from its files, with the files it was read from, for the log. */
export interface ConfigRead {
  config: Mapping;
  from: string;
}

/** The scope's config, every level's file read and merged, farthest first. */
async function configOf(files: FilesPort, scope: Scope, log: Log): Promise<ConfigRead> {
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

/** A value a setting does not take: logged with the files it was read from, and passed over, so its default holds. */
function passedOver(log: Log, from: string): (key: string, value: JsonValue) => void {
  return (key, value) => log.warn("A setting has a value it does not take; its default holds.", { setting: key, value, files: from });
}

/** Each of a group of number settings as a config sets it, each value a setting does not take logged and passed over. */
export function numbersOf<K extends string>(read: ConfigRead, group: NumberSettings<K>, log: Log): Record<K, number> {
  return numbersIn(read.config, group, passedOver(log, read.from));
}

/** The turn's settings for a scope, as its levels' config files set them over the defaults. */
export async function turnSettings(files: FilesPort, scope: Scope, log: Log): Promise<TurnSettings> {
  const read = await configOf(files, scope, log);
  const passed = passedOver(log, read.from);
  const value = (def: SettingDef): JsonValue => {
    const got = settingIn(read.config, def);
    if (got.passed !== null) passed(def.key, got.passed.value);
    return got.value;
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
    cast: numbersOf(read, CAST_SETTING_DEFS, log),
    story: numbersOf(read, STORY_SETTING_DEFS, log),
    storySoFar: numbersOf(read, STORY_SO_FAR_SETTING_DEFS, log),
    worldState: numbersOf(read, WORLD_STATE_SETTING_DEFS, log),
    engine: numbersOf(read, IFACE_SETTING_DEFS, log),
  };
}

/**
 * The global level's config: the user's `RPE-global.yml` over the shipped one, read from the files as it is asked for, since what
 * reads it is made for no chat (requests with no tag; the store, the lore and the story's facts, made when RPE starts).
 */
export function globalConfig(files: string, log: Log): ConfigRead {
  let config: Mapping = {};
  const paths: string[] = [];
  for (const path of [join(files, SHIPPED_FOLDER, GLOBAL_CONFIG), join(files, GLOBAL_CONFIG)]) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    try {
      const parsed: unknown = Bun.YAML.parse(text);
      if (isMapping(parsed)) {
        config = mergedConfig(config, parsed);
        paths.push(path);
      }
    } catch (error) {
      log.warn("A config file does not parse; the settings in it are passed over.", { path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { config, from: paths.join(", ") };
}

/** The connection a request with no tag is passed on to, as the global level's config names it; null for the default connection. */
export function passConnection(files: string, log: Log): string | null {
  return settingIn(globalConfig(files, log).config, DEFS.passConnection).value as string | null;
}

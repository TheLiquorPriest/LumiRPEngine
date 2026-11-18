// The turn lane's settings (plan §5.4 "Config", Appendix D.1), from the config files of the chat's
// levels (`RPE-global.yml` shipped and global, the chat's `RPE.yml`), the nearer level's value over the
// farther one's, mapping by mapping. Each is a setting with a default, declared in `TURN_SETTINGS`, which
// the reader takes every value through and the Settings page lists; the defaults are here and nowhere
// else. A value a setting does not take is logged with its file and passed over, and the default
// holds; it never stops a turn.
//
//   turn:
//     lead: null                 the agent definition that leads a turn, RPH's setting; the shipped RPE-global.yml names it
//                                (author), and nothing in code does: with no level naming one, no turn is played
//   carry: continuing            what a session carries between turns: continuing, records or nothing
//   limits:
//     previousRun: ~             seconds a turn waits for the run of the turn before it, then stops it; none: until it ends
//   chat:
//     hiddenReadable: false      agents may read the messages the player hid from the prompt
//   history:
//     window: 40                 the latest this many of the chat's messages stay in the prompt; null keeps them all
//     step: null                 lets the window grow by this many before it is cut back to its size; null is off
//     hold: false                keeps a message the story record does not cover in the prompt: true or false,
//                                or { on: true, cap: 40 }, cap being the most messages it holds past the window
//   since:
//     editedBudget: null         tokens the briefing's "Since the last turn" spends on replies edited after their
//                                turns, told in full, the newest first; the rest named in one line; null tells all
//     deletedBudget: 1000        tokens it spends quoting the first words of the replies of turns a delete took; the rest
//                                by message numbers in one line
//     deletedWords: 24           words of each such reply it quotes
//     notAppliedBudget: 1500     tokens it spends listing what no longer applies after a flip; past it, a count
//     jobBudget: 1500            tokens it spends listing, thing by thing, what each finished job changed; past it, a count
//   reply:
//     lastText: false            a turn that ends with no reply sends the Author's last plain text in place of the error line
//   passConnection: <name>       the connection a request with no tag is passed on to (global level only;
//                                absent: the default connection)
//
// With them, the settings of the areas the turn lane hands a chat's work to, each group declared by its
// area (`cast:`, `story:`, `worldState:`, `engine:`): read here for the chat, at every level. The areas
// the lane makes once for every chat (the store, the lore and its index, the story's facts) are given
// theirs from the levels every chat shares (`globalConfig`), when RPE starts. Every value is read
// through the one reader of the config levels (`src/app/config-read.ts`), which logs what it passes over.

import type { Carry, FilesPort, LanePermission, Log, Scope } from "rp-harness/contract";
import { type ConfigRead, diskTextsNow, portTexts, readConfig } from "../app/config-read";
import type { Setting } from "../app/setting-list";
import { CAST_DEFAULTS, CAST_SETTING_DEFS, type CastSettings } from "../cast";
import { IFACE_DEFAULTS, IFACE_SETTING_DEFS, type IfaceSettings } from "../iface";
import { MAP_DEFAULTS, MAP_SETTINGS, type MapConfig, mapConfigRead } from "../iface/map";
import { WORLD_STATE_DEFAULTS, WORLD_STATE_SETTING_DEFS, type WorldStateSettings } from "../store";
import { TAP_DEFAULTS, TAP_SETTINGS, type TapSettings, tapSettingsRead } from "../play/settings";
import { PLACES_DEFAULTS, PLACES_SETTING_DEFS, type PlacesSettings } from "../places";
import { QUESTS_DEFAULTS, QUESTS_SETTING_DEFS, type QuestsSettings } from "../quests/settings";
import { STORY_DEFAULTS, STORY_SETTING_DEFS, STORY_SO_FAR_SETTING_DEFS, type StorySettings } from "../story";
import { STORY_SO_FAR_DEFAULTS, type StorySoFarSettings } from "../story/sofar";
import { WINDOW_DEFAULTS, type WindowSettings } from "../story/window";
import { sharedLevels } from "../tree";
import { SETTINGS as RPH_SETTINGS } from "rp-harness/helpers";

/** RPH's room kept for the answer (`compaction.reserveTokens`), declared by RPH alone: the room the door's trim leaves a reply whose request names none. */
const RESERVE =
  RPH_SETTINGS.find((s) => s.key === "compaction.reserveTokens") ??
  (() => {
    throw new Error("rp-harness declares no compaction.reserveTokens setting.");
  })();

/** The agent definition that leads a turn (`turn.lead`), declared by RPH alone (its jobs read it too): RPE reads it for each turn. */
const LEAD =
  RPH_SETTINGS.find((s) => s.key === "turn.lead") ??
  (() => {
    throw new Error("rp-harness declares no turn.lead setting.");
  })();

/** RPH's ratio of characters to a token (`tokens.charsPerToken`), at which its model layer counts a prompt (`ModelsApi.count`): every budget a turn fills is counted at it. */
const CHARS_PER_TOKEN =
  RPH_SETTINGS.find((s) => s.key === "tokens.charsPerToken") ??
  (() => {
    throw new Error("rp-harness declares no tokens.charsPerToken setting.");
  })();

export interface TurnSettings {
  /** The agent definition that leads a turn, as the config names it; null where no level does, and no turn is played. */
  lead: string | null;
  carry: Carry;
  /** How long a turn waits for the previous turn's run, in milliseconds; null: until it ends. */
  previousRunMs: number | null;
  hiddenReadable: boolean;
  /** A turn that ends with no reply sends the Author's last plain text to Lumiverse in place of the error line (plan §10.7). */
  lastText: boolean;
  /** Tokens the replies edited after their turns may take in full in a briefing; null for no bound. */
  editedBudget: number | null;
  /** Tokens the briefing spends quoting the first words of the replies of turns a delete took. */
  deletedBudget: number;
  /** Words of each deleted turn's reply the briefing quotes. */
  deletedWords: number;
  /** Tokens the briefing spends listing what no longer applies after a flip. */
  notAppliedBudget: number;
  /** Tokens the briefing spends listing what each finished job changed, change by change. */
  jobBudget: number;
  /** The history window (`src/story/window`). */
  window: WindowSettings;
  /** The cast's tools and views, for the chat. */
  cast: CastSettings;
  /** The story's tools, for the chat. */
  story: StorySettings;
  /** What a place's answers and lines show, for the chat (`places.*`, registered by the story's area). */
  places: PlacesSettings;
  /** What the quests' answers and records page show, for the chat (`quests.*`). */
  quests: QuestsSettings;
  /** The story so far in the briefing. */
  storySoFar: StorySoFarSettings;
  /** The world state in the briefing. */
  worldState: WorldStateSettings;
  /** The engine's tools, for the chat. */
  engine: IfaceSettings;
  /** The map's settings, for the chat. */
  map: MapConfig;
  /** RPH's room kept for the answer, in tokens (`compaction.reserveTokens`). */
  reserve: number;
  /** RPH's characters to a token for the chat (`tokens.charsPerToken`), the model layer's count: every budget the turn fills is counted at it. */
  charsPerToken: number;
  /** The turns a chat's list gives when the page names no limit (`turns.page`), and the most one page may ask (`turns.pageMost`). */
  turnsPage: { size: number; most: number };
  /** The most characters a request's words may hold (`requests.textMost`); one past it is not kept. */
  requestsTextMost: number;
  /** The taps' bounds, for the chat (`src/play/settings.ts`). */
  taps: TapSettings;
  /** Whose messages are the chat's story (`story.from`), and, read with `replies`, whether his newest message is the turn's direction (`story.newest`): briefing facts (R-176). */
  storyFrom: StoryFrom;
  storyNewest: StoryNewest;
  /** The most characters of a gap check's hit in the state or the story record (`gap.snippet`). */
  gapSnippet: number;
  /** What a write to each lane does (`permissions.<lane>`), and a call of a tool outside RPE (`external`): the user's, per chat, read at every level. */
  permissions: Readonly<Record<"story" | "engine" | "external", LanePermission>>;
}

/** Whose messages are the story: as Lumiverse has it, everyone's, or the replies alone (R-176). */
export type StoryFrom = "lumiverse" | "everyone" | "replies";
/** With the replies as the story, his newest message: the turn's direction, or left out. */
export type StoryNewest = "directive" | "leave_out";
export const STORY_FROM: readonly StoryFrom[] = ["lumiverse", "everyone", "replies"];
export const STORY_NEWEST: readonly StoryNewest[] = ["directive", "leave_out"];
/** What a lane's writes may be set to, as the contract names them. */
export const LANE_PERMISSIONS: readonly LanePermission[] = ["auto", "confirm", "never"];

/** The defaults, where no level sets a value. */
export const TURN_DEFAULTS: Readonly<TurnSettings> = Object.freeze({
  // Plan §13.1, §17.2: who leads is the shipped config's line (`RPE-global.yml` `turn.lead: author`), never code's choice.
  lead: null,
  // Appendix D.1: continuing, until the session measurement says otherwise.
  carry: "continuing",
  // §2.1 point 4 (17 Nov): the next turn waits for the previous turn's run to end.
  previousRunMs: null,
  // Appendix D.1: as today's setting, which is off.
  hiddenReadable: false,
  // Appendix D.1: "When the Author ends with no reply: a plain error line in Lumiverse".
  lastText: false,
  // Plan §6.3 l.628: every edited reply is told with its old and new text whole, however many a carried chat brings to its first turn.
  // A bound is his to set, off as shipped.
  editedBudget: null,
  // PlanTurnKinds-3: the turns a delete took, quoted while they fit; what a flip stopped, listed while it fits.
  deletedBudget: 1000,
  deletedWords: 24,
  notAppliedBudget: 1500,
  // PlanTurnKinds-5: what each finished job changed, listed while it fits; the rest counted, and all of it on the Jobs page.
  jobBudget: 1500,
  // Appendix D.1, as the window's own module keeps them.
  window: WINDOW_DEFAULTS,
  // Appendix D.1, as each area keeps its own.
  cast: CAST_DEFAULTS,
  story: STORY_DEFAULTS,
  places: PLACES_DEFAULTS,
  quests: QUESTS_DEFAULTS,
  storySoFar: STORY_SO_FAR_DEFAULTS,
  worldState: WORLD_STATE_DEFAULTS,
  engine: IFACE_DEFAULTS,
  map: MAP_DEFAULTS,
  // RPH's own default.
  reserve: RESERVE.default as number,
  charsPerToken: CHARS_PER_TOKEN.default as number,
  // The first build's fixed page sizes, made settings.
  turnsPage: { size: 50, most: 500 },
  requestsTextMost: 2000,
  taps: TAP_DEFAULTS,
  // R-176: today's values, carried.
  storyFrom: "lumiverse",
  storyNewest: "directive",
  gapSnippet: 240,
  // Appendix D.1: "Write permission, each lane: Auto"; the external tier has its own, with the same three values.
  permissions: { story: "auto", engine: "auto", external: "auto" } satisfies TurnSettings["permissions"],
});

const CARRIES: readonly Carry[] = ["continuing", "records", "nothing"];

/** Each setting as the files write it, by the name this file reads it under. Each is in force from the next turn, but the connection for requests with no tag, read at each. */
const DEFS = {
  carry: {
    key: "carry",
    default: TURN_DEFAULTS.carry,
    takes: { type: "oneOf", values: CARRIES },
    perConnection: false,
    name: "Context carried in a session",
    about: "What a session carries between turns: continuing, records or nothing.",
    effect: "turn",
    row: "How context is carried in a session",
  },
  previousRun: {
    key: "limits.previousRun",
    default: null,
    takes: { type: "number", least: 0 },
    orNone: true,
    none: "until it ends",
    perConnection: false,
    name: "Wait for the previous run",
    about: "Seconds a turn waits for the run of the turn before it; then that run is stopped. None: it waits until that run ends.",
    effect: "turn",
    row: "Wait for the previous turn's run",
  },
  hiddenReadable: {
    key: "chat.hiddenReadable",
    default: TURN_DEFAULTS.hiddenReadable,
    takes: { type: "yesNo" },
    perConnection: false,
    name: "Hidden messages readable",
    about: "Agents may read the messages the player hid from the prompt.",
    effect: "turn",
    row: "Hidden messages readable by agents",
  },
  lastText: {
    key: "reply.lastText",
    default: TURN_DEFAULTS.lastText,
    takes: { type: "yesNo" },
    perConnection: false,
    name: "Last text as the reply",
    about: "A turn that ends with no reply sends the Author's last plain text in place of the error line.",
    effect: "turn",
    row: "When the Author ends with no reply",
  },
  editedBudget: {
    key: "since.editedBudget",
    default: TURN_DEFAULTS.editedBudget,
    takes: { type: "whole", least: 0 },
    orNone: true,
    none: "every one in full",
    perConnection: false,
    name: "Edited replies in the briefing",
    about: "Off as shipped, every edited reply is told with both its texts whole. Set, the tokens the briefing spends on replies edited after their turns, told in full, the newest first; the rest are named by message in one line, with no text.",
    effect: "turn",
  },
  deletedBudget: {
    key: "since.deletedBudget",
    default: TURN_DEFAULTS.deletedBudget,
    takes: { type: "whole", least: 0 },
    perConnection: false,
    name: "Deleted turns in the briefing",
    about: "The tokens the briefing spends naming the turns a delete took with the first words of each one's reply, the newest first; the rest are named by message number in one line.",
    effect: "turn",
  },
  deletedWords: {
    key: "since.deletedWords",
    default: TURN_DEFAULTS.deletedWords,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Words quoted of a deleted turn",
    about: "How many of the first words of each deleted turn's reply the briefing quotes to name it.",
    effect: "turn",
  },
  notAppliedBudget: {
    key: "since.notAppliedBudget",
    default: TURN_DEFAULTS.notAppliedBudget,
    takes: { type: "whole", least: 0 },
    perConnection: false,
    name: "What a flip stopped, in the briefing",
    about: "The tokens the briefing spends listing, change by change, what no longer applies after an earlier reply was flipped to another swipe; past them the rest are counted, and the world state lists them.",
    effect: "turn",
  },
  jobBudget: {
    key: "since.jobBudget",
    default: TURN_DEFAULTS.jobBudget,
    takes: { type: "whole", least: 0 },
    perConnection: false,
    name: "What a finished job changed, in the briefing",
    about: "The tokens the briefing spends on each finished job's changes, thing by thing, with why one did not take effect; past them the rest are counted, and the Jobs page lists them all.",
    effect: "turn",
  },
  window: {
    key: "history.window",
    default: TURN_DEFAULTS.window.size,
    takes: { type: "whole", least: 1 },
    orNone: true,
    none: "every message kept",
    perConnection: false,
    name: "History window",
    about: "The latest this many of the chat's messages stay in the prompt.",
    effect: "turn",
    row: "History window",
  },
  step: {
    key: "history.step",
    default: TURN_DEFAULTS.window.step,
    takes: { type: "whole", least: 1 },
    orNone: true,
    none: "off",
    perConnection: false,
    name: "Window step",
    about: "Lets the window grow by this many messages before it is cut back to its size.",
    effect: "turn",
    row: "The window's step",
  },
  // `hold: true` is `hold: { on: true }`, its cap the default.
  holdOn: {
    key: "history.hold.on",
    default: TURN_DEFAULTS.window.hold.on,
    takes: { type: "yesNo" },
    short: true,
    perConnection: false,
    name: "Hold uncovered messages",
    about: "Keeps a message the story record does not cover yet in the prompt.",
    effect: "turn",
    row: "Hold a message in the prompt until the record covers it",
  },
  holdCap: {
    key: "history.hold.cap",
    default: TURN_DEFAULTS.window.hold.cap,
    takes: { type: "whole", least: 0 },
    perConnection: false,
    name: "Hold's most",
    about: "The most messages the hold keeps past the window.",
    effect: "turn",
    row: "Hold a message in the prompt until the record covers it",
  },
  // Read with no chat (`passConnection` below), so from the global level alone.
  passConnection: {
    key: "passConnection",
    default: null,
    takes: { type: "text" },
    orNone: true,
    none: "the default connection",
    levels: ["shipped", "global"],
    perConnection: false,
    name: "Connection for requests with no tag",
    about: "The connection a request with no tag is passed on to.",
    effect: "use",
  },
  turnsPage: {
    key: "turns.page",
    default: 50,
    takes: { type: "whole", least: 1 },
    levels: ["shipped", "global"],
    perConnection: false,
    name: "Turns on a page",
    about: "The turns a chat's list on the Turn page gives when the page names no number.",
    effect: "use",
  },
  turnsPageMost: {
    key: "turns.pageMost",
    default: 500,
    takes: { type: "whole", least: 1 },
    levels: ["shipped", "global"],
    perConnection: false,
    name: "Most turns on a page",
    about: "The most turns one page of a chat's list may ask for.",
    effect: "use",
  },
  requestsTextMost: {
    key: "requests.textMost",
    default: TURN_DEFAULTS.requestsTextMost,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Longest request",
    about: "The most characters a request beside his words may hold (what was pressed and on what, or a composer control's choice and words); one past it is not kept, and the answer says so.",
    effect: "use",
  },
  storyFrom: {
    key: "story.from",
    default: TURN_DEFAULTS.storyFrom,
    takes: { type: "oneOf", values: STORY_FROM },
    perConnection: false,
    name: "Whose messages are the story",
    about: "Whose messages the chat's story is made of: as Lumiverse has it (lumiverse), everyone's, or the replies alone (replies). A briefing fact the guidance reads.",
    effect: "turn",
  },
  storyNewest: {
    key: "story.newest",
    default: TURN_DEFAULTS.storyNewest,
    takes: { type: "oneOf", values: STORY_NEWEST },
    perConnection: false,
    name: "His newest message",
    about: "With the story made of the replies: whether his newest message is the turn's direction (directive) or left out (leave_out). A briefing fact the guidance reads.",
    effect: "turn",
  },
  gapSnippet: {
    key: "gap.snippet",
    default: TURN_DEFAULTS.gapSnippet,
    takes: { type: "whole", least: 1 },
    perConnection: false,
    name: "Gap check hit length",
    about: "The most characters of a gap check's hit in the world state or the story record that the agent reads and the evidence keeps.",
    effect: "turn",
  },
  permissionStory: {
    key: "permissions.story",
    default: TURN_DEFAULTS.permissions.story,
    takes: { type: "oneOf", values: LANE_PERMISSIONS },
    perConnection: false,
    name: "Write permission, the story lane",
    about: "What the agents' writes to the story record do: go ahead (auto), wait for his word on the turn's card (confirm), or are left out (never).",
    effect: "turn",
  },
  permissionEngine: {
    key: "permissions.engine",
    default: TURN_DEFAULTS.permissions.engine,
    takes: { type: "oneOf", values: LANE_PERMISSIONS },
    perConnection: false,
    name: "Write permission, the engine lane",
    about: "What the agents' writes to the world's state do: go ahead (auto), wait for his word on the turn's card (confirm), or are left out (never).",
    effect: "turn",
  },
  permissionExternal: {
    key: "permissions.external",
    default: TURN_DEFAULTS.permissions.external,
    takes: { type: "oneOf", values: LANE_PERMISSIONS },
    perConnection: false,
    name: "Permission for tools that reach outside RPE",
    about: "What a call of a tool outside RPE (the web, a command, an MCP server) does: go ahead (auto), wait for his word (confirm), or is refused (never).",
    effect: "turn",
  },
} as const satisfies Record<string, Setting>;

/** Every setting the turn lane lists, as a config file writes it: its own, the map's and the taps'. `turn.lead` is RPH's, read here and listed once, by RPH. */
export const TURN_SETTINGS: readonly Setting[] = [...Object.values(DEFS), ...MAP_SETTINGS, ...TAP_SETTINGS];

/** The turn's settings for a scope, as its levels' config files set them over the defaults. */
export async function turnSettings(files: FilesPort, scope: Scope, log: Log): Promise<TurnSettings> {
  const read = readConfig(await portTexts(files, scope), log, [...TURN_SETTINGS, LEAD]);
  const previousRun = read.value(DEFS.previousRun) as number | null;
  // Each value is one its setting takes, so it is of the type the setting's `takes` says.
  return {
    lead: read.value(LEAD) as string | null,
    carry: read.value(DEFS.carry) as Carry,
    previousRunMs: previousRun === null ? null : previousRun * 1000,
    hiddenReadable: read.value(DEFS.hiddenReadable) as boolean,
    lastText: read.value(DEFS.lastText) as boolean,
    editedBudget: read.value(DEFS.editedBudget) as number | null,
    deletedBudget: read.value(DEFS.deletedBudget) as number,
    deletedWords: read.value(DEFS.deletedWords) as number,
    notAppliedBudget: read.value(DEFS.notAppliedBudget) as number,
    jobBudget: read.value(DEFS.jobBudget) as number,
    window: {
      size: read.value(DEFS.window) as number | null,
      step: read.value(DEFS.step) as number | null,
      hold: { on: read.value(DEFS.holdOn) as boolean, cap: read.value(DEFS.holdCap) as number },
    },
    cast: read.numbers(CAST_SETTING_DEFS),
    story: read.numbers(STORY_SETTING_DEFS),
    places: read.numbers(PLACES_SETTING_DEFS),
    quests: read.numbers(QUESTS_SETTING_DEFS),
    storySoFar: read.numbers(STORY_SO_FAR_SETTING_DEFS),
    worldState: read.numbers(WORLD_STATE_SETTING_DEFS),
    engine: read.numbers(IFACE_SETTING_DEFS),
    map: mapConfigRead(read),
    reserve: read.value(RESERVE) as number,
    charsPerToken: read.value(CHARS_PER_TOKEN) as number,
    turnsPage: { size: read.value(DEFS.turnsPage) as number, most: read.value(DEFS.turnsPageMost) as number },
    requestsTextMost: read.value(DEFS.requestsTextMost) as number,
    taps: tapSettingsRead(read),
    storyFrom: read.value(DEFS.storyFrom) as StoryFrom,
    storyNewest: read.value(DEFS.storyNewest) as StoryNewest,
    gapSnippet: read.value(DEFS.gapSnippet) as number,
    permissions: {
      story: read.value(DEFS.permissionStory) as LanePermission,
      engine: read.value(DEFS.permissionEngine) as LanePermission,
      external: read.value(DEFS.permissionExternal) as LanePermission,
    },
  };
}

/**
 * The levels every chat shares, the user's `RPE-global.yml` over the shipped one, read from the files as they are asked for, since what
 * reads them is made for no chat (requests with no tag; the store, the lore and the story's facts, made when RPE starts).
 */
export function globalConfig(files: string, log: Log): ConfigRead {
  return readConfig(diskTextsNow(sharedLevels(files)), log);
}

/** The connection a request with no tag is passed on to, as the global level's config names it; null for the default connection. */
export function passConnection(files: string, log: Log): string | null {
  return globalConfig(files, log).value(DEFS.passConnection) as string | null;
}

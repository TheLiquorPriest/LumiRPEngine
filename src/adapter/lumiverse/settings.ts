// The door's limits (plan §4.2-§4.4, Appendix D.1): every fixed value the door to Lumiverse uses is a setting, its default the value it
// had, under `lumiverse:` in `RPE-global.yml`. The door is made for no chat, so each is read from the global level alone; each is read
// at its use, so a change holds from the next use on (the question's largest body, a route's limit, from the next start). Times are in
// seconds and sizes in KiB, as a config file writes them; the reader hands the door milliseconds, characters and bytes. The defaults
// stay where each part keeps them; a bound is Lumiverse's own fact where it has one.
//
//   lumiverse:
//     session: { check: 43200 }          seconds between asking after RPE's session, which renews it (Lumiverse: seven days)
//     sockets:                           the event and relay sockets
//       ping: 30                         seconds between pings; Lumiverse closes a socket silent for 120
//       pong: 15                         seconds a ping waits for its pong before the socket is opened again
//       open: 20                         seconds an opening socket waits for Lumiverse's answer
//       retry: 1                         seconds before opening again, doubled after each failure
//       retryMax: 30                     the longest of those waits
//     database: { tries: 4, wait: 0.025 }  tries of a statement while Lumiverse holds its file locked; seconds before the second, doubled
//     reads: { rereads: 3, breakdownReplies: 10 }  a changing chat's rereads; newest replies asked for a stored breakdown
//     dryRun: { wait: 10 }               seconds a dry run is waited for before the reply goes on without its names
//     stream: { comment: 5 }             seconds a reply's stream may send nothing before a comment line keeps its connection
//     relay:
//       flush: 0.25                      seconds between a page's frames
//       frame: 256                       KiB of characters in one frame; a longer list goes in parts
//       lease: 60                        seconds a page's follow lasts unless the page asks again
//       hold: 1024                       KiB of characters a page may have waiting before its chats' events are held
//       retry: 30                        seconds before registering again with an extension that did not take it
//     question: { body: 8192 }           KiB the extension's question may carry
//     search: { hits: 20, snippet: 80 }  a chat search's hits when the query names none; a hit's snippet in characters

import type { JsonValue } from "rp-harness/contract";
import { type Mapping, type NumberSettings, numbersIn, type SettingDef } from "../../app/setting-list";
import { CHAT_SEARCH_DEFAULTS, type ChatSearchSettings } from "./chat";
import { RETRY_MS, TRIES } from "./db";
import { DRY_RUN_MS } from "./hint";
import { BREAKDOWN_TRIES, REREADS } from "./http-reads";
import { RELAY_DEFAULTS, type RelaySettings } from "./relay";
import { KEEP_EVERY_MS } from "./session";
import { SOCKET_DEFAULTS, type SocketSettings } from "./socket";
import { COMMENT_MS } from "./stream";

/** The door's limits, as its parts use them. */
export interface LumiverseSettings {
  sessionCheckMs: number;
  socket: SocketSettings;
  database: { tries: number; retryMs: number };
  reads: { rereads: number; breakdownReplies: number };
  dryRunMs: number;
  commentMs: number;
  relay: RelaySettings;
  questionBytes: number;
  search: ChatSearchSettings;
}

/** Fixed: a question carries the chat's whole path and the marked lore's text, past the app's 1 MiB for other bodies. */
export const QUESTION_BODY_BYTES = 8 * 1024 * 1024;

const KIB = 1024;
const S = 1000;
const GLOBAL = ["shipped", "global"] as const;

/** Lumiverse's session lasts seven days from its last renewal (`auth/index.ts:109-112`): it is asked after inside them. */
const SESSION_DAYS_S = 7 * 24 * 60 * 60;
/** Lumiverse closes a socket that has sent nothing for 120 seconds (`ws/bus.ts:17-18`). */
const SILENT_CLOSE_S = 120;
/**
 * Lumiverse drops a frame over 1 MiB as it counts bytes (`ws/handler.ts:17-18`, `:262-281`). A character of a frame's data takes at most
 * three of them inside the frame's JSON, and the frame's own fields fit in what is left.
 */
const FRAME_MOST_KIB = 340;
/** Lumiverse holds at most 8 MiB waiting for a socket (`ws/transport.ts:4`), counted in bytes, three at most to a character. */
const HOLD_MOST_KIB = Math.floor((8 * KIB) / 3);
/** Lumiverse gives at most 1000 rows a page (`types/pagination.ts:12-14`). */
const PAGE_ROWS = 1000;
/** Bun's server lets a connection sit idle ten seconds by default: a comment line goes out inside them. */
const IDLE_S = 10;

const setting = (key: string, value: number, takes: SettingDef["takes"] & { type: "whole" | "number" }) => ({ key: `lumiverse.${key}`, default: value, takes, levels: GLOBAL, perConnection: false }) as const;

/** Each of the door's settings, by the name its reader takes it under. */
export const LUMIVERSE_SETTING_DEFS = {
  sessionCheck: setting("session.check", KEEP_EVERY_MS / S, { type: "whole", least: 60, most: SESSION_DAYS_S - 1 }),
  ping: setting("sockets.ping", SOCKET_DEFAULTS.pingMs / S, { type: "number", least: 1, most: SILENT_CLOSE_S - 1 }),
  pong: setting("sockets.pong", SOCKET_DEFAULTS.pongMs / S, { type: "number", least: 1 }),
  open: setting("sockets.open", SOCKET_DEFAULTS.openMs / S, { type: "number", least: 1 }),
  retry: setting("sockets.retry", SOCKET_DEFAULTS.retryMs / S, { type: "number", least: 0.1 }),
  retryMax: setting("sockets.retryMax", SOCKET_DEFAULTS.retryMaxMs / S, { type: "number", least: 1 }),
  dbTries: setting("database.tries", TRIES, { type: "whole", least: 1 }),
  dbWait: setting("database.wait", RETRY_MS / S, { type: "number", least: 0.001 }),
  rereads: setting("reads.rereads", REREADS, { type: "whole", least: 1 }),
  breakdownReplies: setting("reads.breakdownReplies", BREAKDOWN_TRIES, { type: "whole", least: 1, most: PAGE_ROWS }),
  dryRun: setting("dryRun.wait", DRY_RUN_MS / S, { type: "number", least: 0.1 }),
  comment: setting("stream.comment", COMMENT_MS / S, { type: "number", least: 0.1, most: IDLE_S - 1 }),
  flush: setting("relay.flush", RELAY_DEFAULTS.flushMs / S, { type: "number", least: 0.01 }),
  frame: setting("relay.frame", RELAY_DEFAULTS.frameChars / KIB, { type: "whole", least: 1, most: FRAME_MOST_KIB }),
  lease: setting("relay.lease", RELAY_DEFAULTS.leaseMs / S, { type: "number", least: 1 }),
  hold: setting("relay.hold", RELAY_DEFAULTS.holdChars / KIB, { type: "whole", least: 1, most: HOLD_MOST_KIB }),
  relayRetry: setting("relay.retry", RELAY_DEFAULTS.retryMs / S, { type: "number", least: 1 }),
  questionBody: setting("question.body", QUESTION_BODY_BYTES / KIB, { type: "whole", least: 1 }),
  searchHits: setting("search.hits", CHAT_SEARCH_DEFAULTS.limit, { type: "whole", least: 1 }),
  searchSnippet: setting("search.snippet", CHAT_SEARCH_DEFAULTS.snippetChars, { type: "whole", least: 0 }),
} as const satisfies NumberSettings<string>;

/** Every setting the door reads, as a config file writes it: the Settings page's group "Lumiverse". */
export const LUMIVERSE_SETTINGS: readonly SettingDef[] = Object.values(LUMIVERSE_SETTING_DEFS);

/** The door's limits as the global level's config sets them over the defaults; `passed` hears of each value a setting does not take. */
export function lumiverseSettings(config: Mapping, passed?: (key: string, value: JsonValue, why: string) => void): LumiverseSettings {
  const v = numbersIn(config, LUMIVERSE_SETTING_DEFS, passed);
  return {
    sessionCheckMs: v.sessionCheck * S,
    socket: { pingMs: v.ping * S, pongMs: v.pong * S, openMs: v.open * S, retryMs: v.retry * S, retryMaxMs: v.retryMax * S },
    database: { tries: v.dbTries, retryMs: v.dbWait * S },
    reads: { rereads: v.rereads, breakdownReplies: v.breakdownReplies },
    dryRunMs: v.dryRun * S,
    commentMs: v.comment * S,
    relay: { flushMs: v.flush * S, frameChars: v.frame * KIB, leaseMs: v.lease * S, holdChars: v.hold * KIB, retryMs: v.relayRetry * S },
    questionBytes: v.questionBody * KIB,
    search: { limit: v.searchHits, snippetChars: v.searchSnippet },
  };
}

/** The door's limits where no level sets one. */
export const LUMIVERSE_DEFAULTS: Readonly<LumiverseSettings> = Object.freeze(lumiverseSettings({}));

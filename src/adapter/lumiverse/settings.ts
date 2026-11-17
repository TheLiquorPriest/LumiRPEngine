// The door's limits (plan §4.2-§4.4, Appendix D.1): every fixed value the door to Lumiverse uses is a setting, its default the value it
// had, under `lumiverse:` in `RPE-global.yml`. The door is made for no chat, so each is read from the global level alone; each is read
// at its use, so a change holds from the next use on (the question's largest body, a route's limit, from the next start). Times are in
// seconds and sizes in KiB, as a config file writes them; the reader hands the door milliseconds, characters and bytes. The defaults
// stay where each part keeps them. A bound that is Lumiverse's own fact is advice beside the value on the Settings page, not a cap
// (plan §2.1 point 5): a value past it is taken, and the line says what Lumiverse then does.
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
//     reads: { rereads: 3, breakdownReplies: 10, keep: 15, kept: 32 }  a changing chat's rereads; newest replies asked for a stored breakdown; seconds a read over HTTP is held; chats, books and presets held at once
//     dryRun: { wait: 10 }               seconds a dry run is waited for before the reply goes on without its names
//     stream: { comment: 5 }             seconds a reply's stream may send nothing before a comment line keeps its connection
//     reply: { hold: 540 }               seconds after a reply asked for whole arrives at which its turn stops with what it has
//     relay:
//       flush: 0.25                      seconds between a page's frames
//       frame: 256                       KiB of characters in one frame; a longer list goes in parts
//       lease: 60                        seconds a page's follow lasts unless the page asks again
//       hold: 1024                       KiB of characters a page may have waiting before its chats' events are held
//       retry: 30                        seconds before registering again with an extension that did not take it
//     question: { body: 8192 }           KiB the extension's question may carry
//     extension:                         the light extension's values, sent with RPE's registration and the page's start facts
//       questionWait: 3                  seconds the extension waits for RPE's answer, and RPE works it out in
//       logChars: 200                    characters of RPE's words the extension writes in its log
//       requestWait: 35                  seconds a page's request through the extension waits for its answer
//       followRenewal: 20                seconds between a page's renewals of a chat's follow
//     search: { hits: 20, snippet: 80 }  a chat search's hits when the query names none; a hit's snippet in characters
//     stores: { hits: 20 }               a search of Lumiverse's databanks and memory: its hits when the query names none
//     untagged: { whileAwaited: pass }   pass, or fail: a request with no tag while a reply RPE heard start awaits its tag

import { type ConfigRead, readConfig } from "../../app/config-read";
import type { Advice, Effect, NumberSettings, Setting, SettingTakes } from "../../app/setting-list";
import { CHAT_SEARCH_DEFAULTS, type ChatSearchSettings } from "./chat";
import { RETRY_MS, TRIES } from "./db";
import { DRY_RUN_MS } from "./hint";
import { BREAKDOWN_TRIES, REREADS } from "./http-reads";
import { HTTP_KEEP_MS, KEPT } from "./memo";
import { RELAY_DEFAULTS, type RelaySettings } from "./relay";
import { KEEP_EVERY_MS } from "./session";
import { SOCKET_DEFAULTS, type SocketSettings } from "./socket";
import { COMMENT_MS } from "./stream";
import { STORE_HITS } from "./stores";
import { WHOLE_HOLD_MS } from "./provider";
import { PAGE_ROAD_DEFAULTS } from "../../ext/page";

/** The door's limits, as its parts use them. */
export interface LumiverseSettings {
  sessionCheckMs: number;
  socket: SocketSettings;
  database: { tries: number; retryMs: number };
  reads: { rereads: number; breakdownReplies: number; keepMs: number; kept: number };
  dryRunMs: number;
  commentMs: number;
  wholeHoldMs: number;
  relay: RelaySettings;
  questionBytes: number;
  /** The light extension's values (group "Lumiverse ▸ extension"): sent with RPE's registration (`questionMs`, `logChars`) and the page's start facts (`requestMs`, `renewMs`). */
  extension: { questionMs: number; logChars: number; requestMs: number; renewMs: number };
  search: ChatSearchSettings;
  stores: { hits: number };
  untaggedWhileAwaited: "pass" | "fail";
}

/** Fixed: a question carries the chat's whole path and the marked lore's text, past the app's 1 MiB for other bodies. */
export const QUESTION_BODY_BYTES = 8 * 1024 * 1024;
/** Appendix D.1: the extension waits 3 seconds for RPE's answer. */
export const QUESTION_WAIT_MS = 3_000;
/** The characters of RPE's words the extension writes in its log. */
export const EXTENSION_LOG_CHARS = 200;

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
/** Lumiverse gives a World Info interceptor ten seconds before it goes on without it (`world-info-interceptor.ts:384-392`). */
const INTERCEPTOR_S = 10;
/** Lumiverse ends a generation with no text for ten minutes (`services/generation/active-generation-registry.ts:140-158`). */
const SILENT_GENERATION_S = 600;

const setting = (key: string, value: number, takes: SettingTakes & { type: "whole" | "number" }, name: string, about: string, effect: Effect = "use", advice: readonly Advice[] = []) =>
  ({ key: `lumiverse.${key}`, default: value, takes, levels: GLOBAL, perConnection: false, name, about, effect, ...(advice.length === 0 ? {} : { advice }) }) as const;

/** Each of the door's settings, by the name its reader takes it under. The question's wait has a row of Appendix D.1; each other is listed for the owner's approval (N-10). */
export const LUMIVERSE_SETTING_DEFS = {
  sessionCheck: setting("session.check", KEEP_EVERY_MS / S, { type: "whole", least: 1 }, "Session check", "Seconds between RPE asking Lumiverse after its sign-in, which renews it; Lumiverse ends a session seven days after its last renewal.", "use", [
    { below: 60, says: "RPE asks Lumiverse after its session more than once a minute." },
    { above: SESSION_DAYS_S - 1, says: "Lumiverse ends a session seven days after its last renewal: RPE's sign-in lapses before it is asked after." },
  ]),
  ping: setting("sockets.ping", SOCKET_DEFAULTS.pingMs / S, { type: "number", least: 1 }, "Socket ping", "Seconds between pings on the event and relay sockets; Lumiverse closes a socket silent for 120.", "use", [{ above: SILENT_CLOSE_S - 1, says: "Lumiverse closes a socket that has sent nothing for 120 seconds, so the sockets close between pings." }]),
  pong: setting("sockets.pong", SOCKET_DEFAULTS.pongMs / S, { type: "number", least: 1 }, "Socket pong wait", "Seconds a ping waits for its answer before the socket is opened again."),
  open: setting("sockets.open", SOCKET_DEFAULTS.openMs / S, { type: "number", least: 1 }, "Socket open wait", "Seconds an opening socket waits for Lumiverse to let it in."),
  retry: setting("sockets.retry", SOCKET_DEFAULTS.retryMs / S, { type: "number", least: 0.1 }, "Socket first retry", "Seconds before a closed socket is opened again, doubled after each failure."),
  retryMax: setting("sockets.retryMax", SOCKET_DEFAULTS.retryMaxMs / S, { type: "number", least: 1 }, "Socket longest retry", "The longest wait in seconds between tries to open a socket."),
  dbTries: setting("database.tries", TRIES, { type: "whole", least: 1 }, "Database tries", "Tries of a read while Lumiverse holds its database file locked."),
  dbWait: setting("database.wait", RETRY_MS / S, { type: "number", least: 0.001 }, "Database first wait", "Seconds before the second try of a locked read, doubled after each try."),
  rereads: setting("reads.rereads", REREADS, { type: "whole", least: 1 }, "Rereads of a changing chat", "Times a chat read over HTTP is read again when it changed while it was read."),
  breakdownReplies: setting("reads.breakdownReplies", BREAKDOWN_TRIES, { type: "whole", least: 1 }, "Replies asked for a breakdown", "The newest replies asked when looking for the prompt breakdown Lumiverse stored.", "use", [{ above: PAGE_ROWS, says: "Lumiverse gives at most 1000 rows a page: no more replies than that are asked." }]),
  readKeep: setting("reads.keep", HTTP_KEEP_MS / S, { type: "number", least: 0 }, "Seconds a read over HTTP is held", "Seconds what RPE read of Lumiverse's rows over HTTP is held before it is read again; an event Lumiverse sends for a change lets it go at once. Read from the database file, a read is held exactly as long as the rows are unchanged."),
  readKept: setting("reads.kept", KEPT, { type: "whole", least: 1 }, "Chats, books and presets held", "How many chats, books and presets have what RPE read of them held at once; the one left alone longest goes first."),
  dryRun: setting("dryRun.wait", DRY_RUN_MS / S, { type: "number", least: 0.1 }, "Dry run wait", "Seconds a dry run is waited for before the reply goes on without its blocks' names."),
  comment: setting("stream.comment", COMMENT_MS / S, { type: "number", least: 0.1 }, "Stream comment", "Seconds a reply's stream may send nothing before a comment line keeps its connection open.", "use", [{ above: IDLE_S - 1, says: "The server lets a connection sit idle ten seconds: a reply's stream that sends nothing that long is closed before its comment line." }]),
  flush: setting("relay.flush", RELAY_DEFAULTS.flushMs / S, { type: "number", least: 0.001 }, "Relay flush", "Seconds between the relay's frames to a page; a frame for every event floods Lumiverse's socket."),
  frame: setting("relay.frame", RELAY_DEFAULTS.frameChars / KIB, { type: "whole", least: 1 }, "Relay frame", "KiB of characters in one relay frame; a longer list goes in parts.", "use", [{ above: FRAME_MOST_KIB, says: "Lumiverse drops a frame over 1 MiB, and a frame this long can pass it: the page then misses those events." }]),
  lease: setting("relay.lease", RELAY_DEFAULTS.leaseMs / S, { type: "number", least: 1 }, "Relay lease", "Seconds a page's follow lasts unless the page asks again."),
  hold: setting("relay.hold", RELAY_DEFAULTS.holdChars / KIB, { type: "whole", least: 1 }, "Relay hold", "KiB of characters a page may have waiting before its chats' events are held.", "use", [{ above: HOLD_MOST_KIB, says: "Lumiverse holds at most 8 MiB waiting for a socket: past it, it drops what waits." }]),
  relayRetry: setting("relay.retry", RELAY_DEFAULTS.retryMs / S, { type: "number", least: 0.1 }, "Registration retry", "Seconds before RPE registers again with an extension that did not take its registration."),
  wholeHold: setting("reply.hold", WHOLE_HOLD_MS / S, { type: "number", least: 1 }, "Whole reply hold", "Seconds after a reply asked for whole arrives at which its turn stops with what it has; Lumiverse ends a generation that has had no text for ten minutes, and nothing reaches it while a whole reply is written.", "use", [{ above: SILENT_GENERATION_S - 1, says: "Lumiverse ends a generation with no text for ten minutes: a turn still writing then loses its reply whole." }]),
  questionBody: setting("question.body", QUESTION_BODY_BYTES / KIB, { type: "whole", least: 1 }, "Question size", "KiB the extension's question before a generation may carry.", "start"),
  questionWait: { ...setting("extension.questionWait", QUESTION_WAIT_MS / S, { type: "number", least: 0.1 }, "Question wait", "Seconds the extension waits for RPE's answer to its question before a generation, and RPE works it out in; a half not worked out in them is answered not known: the extension then keeps every marked secret out, and RPE makes the cut when the reply's request arrives.", "use", [{ above: INTERCEPTOR_S - 1, says: "Lumiverse gives the extension ten seconds before it goes on without its answer: the generation starts with every marked secret kept out." }]), row: "How long the extension waits for RPE's answer before a generation" },
  logChars: setting("extension.logChars", EXTENSION_LOG_CHARS, { type: "whole", least: 0 }, "Extension log words", "Characters of RPE's words the extension writes in Lumiverse's log when RPE refuses its question."),
  requestWait: setting("extension.requestWait", PAGE_ROAD_DEFAULTS.requestMs / S, { type: "number", least: 1 }, "Page request wait", "Seconds a page's request through the extension waits for its answer; Lumiverse's proxy gives up after its own 30."),
  followRenewal: setting("extension.followRenewal", PAGE_ROAD_DEFAULTS.renewMs / S, { type: "number", least: 1 }, "Page follow renewal", "Seconds between a page's renewals of its follow of a chat; keep it well inside the relay lease."),
  searchHits: setting("search.hits", CHAT_SEARCH_DEFAULTS.limit, { type: "whole", least: 1 }, "Chat search hits", "Hits a chat search gives when the query names no number."),
  searchSnippet: setting("search.snippet", CHAT_SEARCH_DEFAULTS.snippetChars, { type: "whole", least: 0 }, "Chat search snippet", "Characters of a chat search hit's snippet."),
  storeHits: setting("stores.hits", STORE_HITS, { type: "whole", least: 1 }, "Store search hits", "Hits a search of Lumiverse's databanks and memory gives when the query names no number."),
} as const satisfies NumberSettings<string>;

/**
 * `lumiverse.untagged.whileAwaited` (§4.2 l.246-258; READINGS N-18): a request with no tag on RPE's connection, while a generation RPE
 * heard start on its connection (or answered the question for) has neither sent its tagged request nor ended, is passed on (`pass`,
 * the plan's rule) or answered with the shipped file's error line (`fail`), which may fail an unrelated side request once.
 */
export const UNTAGGED_WHILE_AWAITED = {
  key: "lumiverse.untagged.whileAwaited",
  default: "pass",
  takes: { type: "oneOf", values: ["pass", "fail"] },
  levels: GLOBAL,
  perConnection: false,
  name: "Untagged request while a reply awaits its tag",
  about: "pass: a request with no tag is passed on, as every other is. fail: while a reply RPE heard start on its connection has neither sent its tagged request nor ended, a request with no tag on its connection is answered with an error line; it may fail a title or summary asked meanwhile.",
  effect: "use",
} as const satisfies Setting;

/** Every setting the door reads, as a config file writes it: the Settings page's group "Lumiverse". */
export const LUMIVERSE_SETTINGS: readonly Setting[] = [...Object.values(LUMIVERSE_SETTING_DEFS), UNTAGGED_WHILE_AWAITED];

/** The door's limits as a read of the levels every chat shares sets them over the defaults; a value a setting does not take is logged by the read. */
export function lumiverseSettings(read: ConfigRead): LumiverseSettings {
  const v = read.numbers(LUMIVERSE_SETTING_DEFS);
  return {
    sessionCheckMs: v.sessionCheck * S,
    socket: { pingMs: v.ping * S, pongMs: v.pong * S, openMs: v.open * S, retryMs: v.retry * S, retryMaxMs: v.retryMax * S },
    database: { tries: v.dbTries, retryMs: v.dbWait * S },
    reads: { rereads: v.rereads, breakdownReplies: v.breakdownReplies, keepMs: v.readKeep * S, kept: v.readKept },
    dryRunMs: v.dryRun * S,
    commentMs: v.comment * S,
    wholeHoldMs: v.wholeHold * S,
    relay: { flushMs: v.flush * S, frameChars: v.frame * KIB, leaseMs: v.lease * S, holdChars: v.hold * KIB, retryMs: v.relayRetry * S },
    questionBytes: v.questionBody * KIB,
    extension: { questionMs: v.questionWait * S, logChars: v.logChars, requestMs: v.requestWait * S, renewMs: v.followRenewal * S },
    search: { limit: v.searchHits, snippetChars: v.searchSnippet },
    stores: { hits: v.storeHits },
    untaggedWhileAwaited: read.value(UNTAGGED_WHILE_AWAITED) === "fail" ? "fail" : "pass",
  };
}

/** The door's limits where no level sets one. */
export const LUMIVERSE_DEFAULTS: Readonly<LumiverseSettings> = Object.freeze(lumiverseSettings(readConfig([], null)));

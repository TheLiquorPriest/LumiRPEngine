// Carried unchanged from LumiAH (MIT; notice in THIRD-PARTY-NOTICES.md), src/link/settings.ts at commit 6a38779a5e33fe563f0c8c617640343473617569.

// The transport's settings: every limit and timing of the link, the runtime and the extension
// backend, each with its default. They are one section (`transport`) of the user's settings, which
// the extension keeps in user storage beside the core's own section and the Settings page shows from
// the schema below; the runtime reads them over the link (`settings.get`) and keeps the ones it last
// read in its config, to start with before it has linked. Both ends import this file, so they agree
// on every name and default.
//
// The schema is JSON Schema written by hand, in the dialect the Settings page renders (the comment
// above `SettingsView` in src/shared/ui.ts): `title`, `description`, `type`, `properties`, `oneOf`
// of `const`, `minimum`, `maximum`, `x-unit`.

import type { JsonObject, JsonValue } from "./json";
import { hasOwn, isRecord } from "./json";

/** The key of this section in the user's settings. */
export const TRANSPORT_KEY = "transport";

const MI = 1024 * 1024;

/**
 * The ceilings that protect the worker every account shares (DESIGN §7). A setting that bounds what
 * the extension holds in memory is an account's own to lower, and to raise as far as its ceiling
 * here (the schema's maximum); the totals bound what all accounts hold together. None of these is a
 * setting: a bound an account could raise is no bound on that account, and a total any one account
 * could set would be one account deciding for the others. Each per-account ceiling is a small part
 * of its total, so one account at its ceiling leaves the others their room.
 */
export const CEILINGS = Object.freeze({
  /** Frames coming in parts (parts.ts): the largest frame joined, how long its first parts wait, and what one account may have under way; then every account's together. */
  joinMaxUnits: 64 * MI,
  partStaleMs: 5 * 60_000,
  joinFrames: 16,
  joinHeldUnits: 64 * MI,
  joinFramesTotal: 64,
  joinHeldUnitsTotal: 256 * MI,
  /** Streams to a runtime (streams.ts): how long a finished one waits for its acknowledgement, how many one account may have held, and every account's together. */
  streamKeepMs: 60 * 60_000,
  streams: 256,
  streamsTotal: 2_048,
  /** A tool's name as a refusal says it back: a name longer than any tool has is cut to this. */
  nameChars: 200,
  /** The jobs not yet over that the pages are told of (jobs.ts), for one account and for all. */
  jobsActive: 512,
  jobsActiveTotal: 8_192,
  /** The live view (live.ts): events kept of one run, runs under way for one account (one still running is never let go for room, so their number is bounded itself), chats whose latest run is kept, and every account's events and runs together. */
  liveEvents: 50_000,
  liveRunning: 64,
  liveChats: 256,
  liveEventsTotal: 2_000_000,
  liveRunsTotal: 4_096,
  /** The interceptor's bookkeeping (turns.ts): one account's turns, verdicts and waiting records, and every account's together. A generation whose account Lumiverse didn't name is nobody's until its prompt comes: those are bounded apart. */
  tagsHeld: 1_024,
  tagsKnown: 8_192,
  recordsWaiting: 512,
  turnsTotal: 8_192,
  verdictsTotal: 65_536,
  recordsTotal: 4_096,
  generationsUnowned: 1_024,
});

/** The runtime's limits and timings, in milliseconds unless named. */
export interface RuntimeTuning {
  /** A keep-alive comment after this much silence on a reply's stream to Lumiverse. */
  commentMs: number;
  /** A progress line restated into the thinking block after this long without a token. */
  progressMs: number;
  /** A stream from the extension with nothing in it this long is given up. */
  stallMs: number;
  /** How long the extension may stay out of reach under a stream or a turn before it ends; and each request of a reply, a job or a page waits as long for the link to come up. */
  lostMs: number;
  /** How often the runtime pings while it reads streams or answers turns, naming them. */
  probeMs: number;
  /** How often it pings while it does neither. */
  heartbeatMs: number;
  /** How long a request may go unanswered, with nothing heard meanwhile, before the extension counts as silent. */
  silentMs: number;
  /** After Lumiverse reports an error in the extension, how long silence makes it a crash. */
  crashMs: number;
  /** Each link request's wait for its answer. */
  requestMs: number;
  /** How often the event socket is pinged while open: Lumiverse closes one idle for two minutes. */
  socketPingMs: number;
  /** How long `GET /v1/models`, and the check of the key of a request with no turn tag, wait for the link to come up. */
  modelsWaitMs: number;
  /** The largest request body the runtime reads from Lumiverse. */
  maxBodyBytes: number;
  /** How long `up` waits for the turns under way to finish before it restarts a running runtime. */
  drainMs: number;
  /** How often it asks meanwhile. */
  drainPollMs: number;
  /** How many of the user's connections the runtime reads when it looks for the loopback's. */
  connectionsRead: number;
  /** The first wait before reconnecting to Lumiverse; each failure doubles it, up to `reconnectMaxMs`. */
  reconnectMs: number;
  reconnectMaxMs: number;
  /** How often the runtime asks Lumiverse about its session, which renews it. */
  sessionCheckMs: number;
  /** How long a stopping runtime waits for its last error chunks and cancels to go out. */
  stopGraceMs: number;
  /** How long trace events wait to be sent with the ones that follow them. */
  traceMs: number;
  /** The most trace events one request carries to the live view. */
  traceBatch: number;
  /** The most trace events held while they can't be sent; past it a turn's later events stay out of the live view. */
  traceHeld: number;
  /** How long a new turn waits for the chat's earlier one to stop before it is refused. */
  turnWaitMs: number;
  /** How long Lumiverse may take to answer when the runtime asks it to stop a reply (Stop in the live view) before the runtime ends the reply itself. */
  stopAskMs: number;
  /** The largest frame, in characters, the runtime puts together from parts. */
  joinMaxUnits: number;
  /** How long a frame's first parts wait for the rest. */
  partStaleMs: number;
  /** How long the runtime waits for this extension's storage to take what it saved, wherever something waits on it (a reply's record, a page that reads it, the runtime stopping). Past it that goes on without it: nothing is lost. */
  storeWaitMs: number;
  /** How long each request the runtime makes to Lumiverse over HTTP waits for its answer (finding the extension, the socket's ticket, the loopback connection, stopping a reply). */
  lumiverseMs: number;
  /** How long each request of the runtime's copy of chat and lore to Lumiverse waits for its answer; past it the read is given up and asked of this extension instead. */
  copyReadMs: number;
  /** The most characters of chats and world books the runtime's copy keeps in memory; a chat larger than that alone is read from this extension every time. 0 keeps none. */
  copyChars: number;
  /** How long testing one of the runtime's connections, or reading a server's list of its models, waits for the provider's answer. */
  providerMs: number;
  /** How long a model's answer, once begun, may go with nothing from its provider's server before the call is ended (and made again, as a dropped stream is); 0 for no limit. */
  answerSilentMs: number;
  /** How long a sign-in to a provider stays open for the user to finish it. */
  signInMs: number;
  /** How long a new build of the runtime is given to say its version before an update to it is refused as a build that can't start here. */
  buildStartMs: number;
}

/** What the transport does, as the user set it. */
export interface TransportSettings {
  /** The history cutoff (DESIGN §2): which of the chat's messages a tagged prompt keeps. */
  history: { keep: "all" | "last"; count: number };
  tags: {
    /** How long a turn's tag admits its request: past it its generation is surely over. */
    lifeMs: number;
    /** The most tags remembered at once, the oldest let go first. */
    held: number;
    /** How long the interceptor waits to learn whether a prompt is on the loopback when it doesn't know: past it, a chat not known to be answered here goes on untouched. */
    checkMs: number;
    /** How many connections and chats are remembered as answered here or not, the oldest let go first. */
    known: number;
  };
  streams: {
    /** How long a finished stream's chunks are kept for an acknowledgement that never came. */
    keepMs: number;
  };
  connections: {
    /** The connections, by id, that take one tool call per answer: a call on one asks its provider for no parallel tool calls. */
    oneToolAtATime: string[];
  };
  mcp: {
    /** How long one call of an MCP tool may take. */
    callMs: number;
  };
  jobs: {
    /** The user holds every job: those running wait at their agents' next round, and one that begins waits at its first. */
    paused: boolean;
  };
  pages: {
    /** How many notices of jobs (finished, failed, interrupted, waiting on the user) are kept until dismissed; past it the oldest go first. */
    noticesKept: number;
    /** How long a page's request waits for the runtime to do what it asked of it (a file written, a job started). */
    askMs: number;
    /** How much of a job's opening a notice keeps. */
    noticeChars: number;
    /** How long a page that reads what the runtime saved (Sessions, a transcript, a call's prompt) waits for the runtime to finish sending it to this extension's storage, before it shows what the storage holds and says so. */
    settleMs: number;
    /** How long a page's request waits on the proxy road alone (Lumiverse's proxy to the runtime's loopback server) before it is sent over the link as well; whichever road answers first is taken. At most `PROXY_HOP_MS`. */
    proxyMs: number;
  };
  link: {
    /** How long without a hello or a ping before a runtime shows as quiet. */
    quietMs: number;
    /** The runtimes one account may have registered at once. */
    relays: number;
    /** How long minting a key waits for the linked runtime to make the loopback connection. */
    connectionMs: number;
    /** The largest frame, in characters, the extension puts together from parts. */
    joinMaxUnits: number;
    /** How long a frame's first parts wait for the rest. */
    partStaleMs: number;
    /** The most frames the extension puts together at once for one account, over all its sessions (each runtime's, each page's). */
    joinFrames: number;
    /** The most characters it holds of them, for that account. */
    joinHeldUnits: number;
  };
  live: {
    /** The most events kept of a chat's live turn; past it the turn's later events stay out of the live view. */
    events: number;
    /** The most events one read of a live view or a stored transcript answers. */
    page: number;
    /** The most chats whose latest turn is kept for the live view. */
    chats: number;
    /** How long after its generation ended a turn that never said it ended counts as lost. */
    lostMs: number;
  };
  anchors: {
    /** How long a turn's record waits for Lumiverse to save the reply before it is let go. */
    waitMs: number;
    /** The most records waiting at once. */
    held: number;
  };
  sessions: {
    /** How much of a reply's opening the Sessions page shows to find it by. */
    previewChars: number;
    /** The most turns one page of the Sessions list holds. */
    page: number;
    /** The most chats whose message list is kept in memory between reads; 0 keeps none. */
    pathsKept: number;
    /** How long one such list is kept at most, in ms; 0 keeps none. */
    pathMs: number;
  };
  runtime: RuntimeTuning;
}

export const RUNTIME_DEFAULTS: Readonly<RuntimeTuning> = Object.freeze({
  commentMs: 5_000,
  progressMs: 60_000,
  stallMs: 30 * 60_000,
  lostMs: 120_000,
  probeMs: 15_000,
  heartbeatMs: 60_000,
  silentMs: 45_000,
  crashMs: 10_000,
  requestMs: 60_000,
  socketPingMs: 45_000,
  modelsWaitMs: 10_000,
  // Lumiverse's socket frame limit is 4 MiB; a body under it leaves room for its envelope.
  maxBodyBytes: 4 * 1024 * 1024 - 64 * 1024,
  drainMs: 5 * 60_000,
  drainPollMs: 2_000,
  connectionsRead: 200,
  reconnectMs: 1_000,
  reconnectMaxMs: 30_000,
  sessionCheckMs: 24 * 60 * 60_000,
  stopGraceMs: 500,
  traceMs: 100,
  traceBatch: 64,
  traceHeld: 20_000,
  turnWaitMs: 30_000,
  stopAskMs: 5_000,
  joinMaxUnits: 32 * 1024 * 1024,
  partStaleMs: 60_000,
  storeWaitMs: 60_000,
  lumiverseMs: 60_000,
  copyReadMs: 15_000,
  copyChars: 32_000_000,
  providerMs: 60_000,
  // A model thinking between the pieces it shows, and a busy server, stay well inside five minutes; their pings and keep-alives count as something.
  answerSilentMs: 5 * 60_000,
  // About as long as a provider's sign-in page keeps a code good, after which finishing it could only fail.
  signInMs: 10 * 60_000,
  buildStartMs: 30_000,
});

export const TRANSPORT_DEFAULTS: Readonly<TransportSettings> = Object.freeze({
  history: Object.freeze({ keep: "last" as const, count: 40 }),
  // The interceptor is never a required one and the manifest asks Lumiverse for five minutes, so no wait here fails a reply. The check stays short all the same: it is made before LumiAH knows a prompt is its own, so a reply of a chat that isn't answered here waits it out too, and gets nothing for the wait.
  tags: Object.freeze({ lifeMs: 2 * 60 * 60_000, held: 256, checkMs: 3_000, known: 1024 }),
  streams: Object.freeze({ keepMs: 10 * 60_000 }),
  connections: Object.freeze({ oneToolAtATime: Object.freeze([]) as unknown as string[] }),
  // 30 seconds is Lumiverse's own default for a call it is given no time for.
  mcp: Object.freeze({ callMs: 30_000 }),
  jobs: Object.freeze({ paused: false }),
  pages: Object.freeze({ noticesKept: 200, askMs: 30_000, noticeChars: 400, settleMs: 5_000, proxyMs: 10_000 }),
  // A runtime sends a large frame's parts one after another, so one account seldom has two frames under way: eight, and twice the largest frame, leave room without letting an account fill the extension's memory.
  link: Object.freeze({ quietMs: 120_000, relays: 8, connectionMs: 15_000, joinMaxUnits: 32 * 1024 * 1024, partStaleMs: 60_000, joinFrames: 8, joinHeldUnits: 64 * 1024 * 1024 }),
  live: Object.freeze({ events: 20_000, page: 500, chats: 32, lostMs: 30_000 }),
  anchors: Object.freeze({ waitMs: 10 * 60_000, held: 64 }),
  // A chat's list is read again when Lumiverse says it changed, and its last message is checked at every read: five minutes is a backstop for a change in the middle that nobody told of.
  sessions: Object.freeze({ previewChars: 120, page: 50, pathsKept: 16, pathMs: 5 * 60_000 }),
  runtime: RUNTIME_DEFAULTS,
});

const ms = (title: string, description: string, minimum: number, maximum: number): JsonObject => ({ type: "integer", title, description, minimum, maximum, "x-unit": "ms" });
const whole = (title: string, description: string, minimum: number, maximum: number, unit?: string): JsonObject => ({ type: "integer", title, description, minimum, maximum, ...(unit !== undefined ? { "x-unit": unit } : {}) });

const DAY_MS = 24 * 60 * 60_000;

/**
 * Settings an earlier build had and this one took away, by path within the section: built-in mode's
 * own group (it runs on LumiAH's `main` branch, not here), and what a model call's stream had over
 * the link (its text held back, a gap asked for again, acknowledgements in batches), which went with
 * the model calls to the runtime's own connections. A value a user kept there names nothing now, and
 * the settings' store passes over it quietly rather than refuse every later change for it.
 */
export const TRANSPORT_RETIRED: readonly (readonly string[])[] = [["builtin"], ["streams", "coalesceMs"], ["runtime", "resendMs"], ["runtime", "resendTries"], ["runtime", "ackEvery"]];

/** The section's schema, each setting in the order the Settings page shows it. */
export const TRANSPORT_SCHEMA: JsonObject = {
  type: "object",
  title: "Transport",
  description: "How LumiAH carries a reply between this extension and your runtime beside Lumiverse, over its link. The defaults suit a runtime on the same machine as Lumiverse.",
  additionalProperties: false,
  properties: {
    history: {
      type: "object",
      title: "History cutoff",
      description: "Which of the chat's messages stay in the prompt Lumiverse sends for a reply LumiAH answers. The main agent reads the rest of the chat with its tools when a reply needs it.",
      additionalProperties: false,
      properties: {
        keep: {
          title: "Keep",
          oneOf: [
            { const: "last", title: "The latest messages", description: "Only the latest messages stay; how many is set below." },
            { const: "all", title: "Every message", description: "Nothing is left out: the prompt is as large as Lumiverse makes it." },
          ],
        },
        count: whole("Latest messages kept", "How many of the chat's latest messages stay in the prompt when only the latest are kept.", 1, 10_000, "messages"),
      },
    },
    tags: {
      type: "object",
      title: "Turn tags",
      description: "The single-use tag the prompt interceptor puts on each generation LumiAH answers.",
      additionalProperties: false,
      properties: {
        lifeMs: ms("A tag's life", "How long after a generation starts its tag still admits its request.", 60_000, DAY_MS),
        held: whole("Tags remembered", "The most tags remembered at once; the oldest is let go first.", 8, CEILINGS.tagsHeld),
        // Lumiverse would wait five minutes, and fails no reply over an interceptor that isn't required. The most is still seconds: this wait is spent by replies LumiAH may have no part in, with nothing shown for it.
        checkMs: ms("Loopback check", "How long a reply waits while it is checked whether its connection is the loopback, when that isn't known yet. Past it, a chat not known to be answered here goes on untouched.", 100, 9_000),
        known: whole("Connections remembered", "How many connections and chats are remembered as answered here or not; the oldest is let go first.", 16, CEILINGS.tagsKnown),
      },
    },
    streams: {
      type: "object",
      title: "Streams",
      description: "How the outcome of a tool run in this extension, or of a tool call held for your word, travels from this extension to the runtime.",
      additionalProperties: false,
      properties: {
        keepMs: ms("Unacknowledged chunks kept", "How long a finished stream's chunks are kept for an acknowledgement that never came.", 10_000, CEILINGS.streamKeepMs),
      },
    },
    connections: {
      type: "object",
      title: "Connections",
      description: "The agents run on the runtime's own connections (Runtime → Connections): an agent with none of its own, or whose connection is gone, runs on the runtime's default. What LumiAH must know of a connection that its provider doesn't say.",
      additionalProperties: false,
      properties: {
        oneToolAtATime: {
          type: "array",
          title: "One tool call per answer",
          description: "Connections whose model must call one tool at a time: a call on one asks its provider for no parallel tool calls. Add a connection here when its model's answers with several tool calls at once come back broken.",
          uniqueItems: true,
          items: { type: "string", format: "connection", maxLength: 256 },
        },
      },
    },
    mcp: {
      type: "object",
      title: "MCP servers",
      description: "The tools of the MCP servers you set up in Lumiverse, which LumiAH's agents may be given. Each tool is named mcp:<server>:<tool>, and every call goes through Lumiverse. A server, or one tool of it, is switched off on the Agents page.",
      additionalProperties: false,
      properties: {
        // Lumiverse holds a call's time between 1 and 120 seconds, whatever it is asked for.
        callMs: ms("Call time", "How long one call of an MCP tool may take before it is given up.", 1_000, 120_000),
      },
    },
    jobs: {
      type: "object",
      title: "Jobs",
      description: "The switch that holds every job. Whether jobs run at all, how many at once and what each may spend are with the core's settings, under Jobs.",
      additionalProperties: false,
      properties: {
        paused: { type: "boolean", title: "Hold all jobs", description: "While on, every running job waits at its agents' next round, and a job that begins waits at its first. Switch it off and they go on." },
      },
    },
    pages: {
      type: "object",
      title: "Pages",
      description: "What LumiAH's pages keep, and how long they wait for the runtime.",
      additionalProperties: false,
      properties: {
        noticesKept: whole("Notices kept", "How many notices of jobs (finished, failed, interrupted, waiting on you) are kept until you dismiss them. Past it the oldest go first.", 10, 2_000),
        askMs: ms("Runtime wait", "How long a page waits for the runtime to do what it asked of it (write a file, start a job, read a list) before it says the runtime didn't answer.", 1_000, 600_000),
        noticeChars: whole("Notice length", "How much of a job's opening a notice keeps. The job's page shows it whole.", 40, 4_000, "characters"),
        settleMs: ms("Wait for the runtime's saves", "How long a page that reads what your runtime saved (Sessions, a turn's transcript, a call's prompt) waits for the runtime to finish sending it to this extension's storage. Past it the page shows what the storage holds, and says so.", 500, 60_000),
        // Lumiverse's proxy waits 30 seconds for a hop, whatever it is asked: no longer here either.
        proxyMs: ms("Proxy road wait", "How long a page's request waits on the faster road (Lumiverse's own proxy to your runtime, used once you grant the permission cors_proxy) before it is sent over the link as well. Whichever answers first is taken, and the runtime does the work once. At most 30 seconds: Lumiverse's proxy waits no longer.", 1_000, 30_000),
      },
    },
    link: {
      type: "object",
      title: "Link",
      description: "The extension's end of the link to your runtimes.",
      additionalProperties: false,
      properties: {
        quietMs: ms("Quiet after", "How long without a word from a runtime before the Runtime page shows it as quiet.", 10_000, DAY_MS),
        relays: whole("Runtimes per account", "The runtimes one account may have registered at once.", 1, 64, "runtimes"),
        connectionMs: ms("Wait for the connection", "How long minting a key waits for your linked runtime to make the loopback connection.", 1_000, 5 * 60_000),
        joinMaxUnits: whole("Largest frame the extension joins", "The largest frame the extension puts together from parts: a stored transcript or a model call's prompt may be this long.", MI, CEILINGS.joinMaxUnits, "characters"),
        partStaleMs: ms("Parts the extension keeps", "How long the first parts of a frame the extension puts together wait for the rest.", 1_000, CEILINGS.partStaleMs),
        joinFrames: whole("Frames joined at once", "The most frames sent in parts that the extension puts together at once for one account. A runtime sends a large frame's parts one after another, so only frames left unfinished add up: a frame begun past this is refused.", 1, CEILINGS.joinFrames, "frames"),
        joinHeldUnits: whole("Characters held while joining", "The most characters the extension holds, for one account, of frames still coming in parts. A frame that would pass it is refused. Keep it at least as large as Largest frame the extension joins.", MI, CEILINGS.joinHeldUnits, "characters"),
      },
    },
    live: {
      type: "object",
      title: "Live view",
      description: "What the extension keeps of each chat's current turn for the Live page.",
      additionalProperties: false,
      properties: {
        events: whole("Events kept per turn", "The most events kept of a chat's live turn; past it the reply's later events stay out of the Live page (its stored transcript is whole all the same).", 100, CEILINGS.liveEvents, "events"),
        page: whole("Events per read", "The most events one read of a live view or a stored transcript answers.", 10, 10_000, "events"),
        chats: whole("Chats kept", "The most chats whose latest turn is kept for the Live page.", 1, CEILINGS.liveChats, "chats"),
        lostMs: ms("Lost after", "How long after its generation ended a turn that never said it ended counts as lost.", 1_000, 60 * 60_000),
      },
    },
    anchors: {
      type: "object",
      title: "Anchors",
      description: "The record each turn leaves on its reply's message.",
      additionalProperties: false,
      properties: {
        waitMs: ms("Wait for the reply", "How long a turn's record waits for Lumiverse to save the reply before it is let go.", 10_000, DAY_MS),
        held: whole("Records waiting", "The most records waiting for their replies at once.", 1, CEILINGS.recordsWaiting, "records"),
      },
    },
    sessions: {
      type: "object",
      title: "Sessions page",
      additionalProperties: false,
      properties: {
        previewChars: whole("Reply preview", "How much of a reply's opening the Sessions page shows to find it by.", 0, 2_000, "characters"),
        page: whole("Turns per page", "The most turns one page of the Sessions list holds.", 1, 500, "turns"),
        pathsKept: whole("Chats kept in memory", "The most chats whose list of messages (without their text) is kept in memory until the chat changes, so a reply reads its chat once. 0 keeps none: every read asks Lumiverse again.", 0, 1024, "chats"),
        pathMs: ms("Keep a chat's list for", "How long such a list is kept at most, even while Lumiverse says nothing of the chat changing. After that the chat is read again. 0 keeps none: every read asks Lumiverse again.", 0, DAY_MS),
      },
    },
    runtime: {
      type: "object",
      title: "Runtime",
      description: "The runtime's own limits and timings. It reads them when it links and whenever you change them; until it has linked it uses the ones it last read.",
      additionalProperties: false,
      properties: {
        commentMs: ms("Keep-alive comment", "A comment goes out on a reply's stream after this much silence, so nothing between the runtime and Lumiverse closes it.", 1_000, 60_000),
        progressMs: ms("Progress line", "A progress line is restated in the thinking block after this long without a token, so Lumiverse sees the reply alive.", 5_000, 10 * 60_000),
        stallMs: ms("Stream stalled after", "A tool's run in this extension with nothing from it for this long is given up. A tool call held for your word waits as long as it takes.", 10_000, DAY_MS),
        lostMs: ms("Extension lost after", "How long this extension may stay out of the runtime's reach during a reply before the reply ends.", 5_000, 60 * 60_000),
        probeMs: ms("Ping while working", "How often the runtime pings while it answers a reply.", 1_000, 5 * 60_000),
        heartbeatMs: ms("Ping while idle", "How often the runtime pings while it answers none.", 5_000, 60 * 60_000),
        silentMs: ms("Silent after", "How long a request may go unanswered, with nothing heard meanwhile, before this extension counts as silent.", 5_000, 60 * 60_000),
        crashMs: ms("Crashed after", "After Lumiverse reports an error in this extension, how long silence makes it a crash.", 1_000, 5 * 60_000),
        requestMs: ms("Request wait", "How long each request to this extension waits for its answer.", 5_000, 60 * 60_000),
        socketPingMs: ms("Socket ping", "How often the runtime pings Lumiverse's event socket. Lumiverse closes one idle for two minutes.", 5_000, 110_000),
        modelsWaitMs: ms("Model list wait", "How long the connection's model list, and the key check of a request with no turn tag, wait for the link to come up.", 1_000, 5 * 60_000),
        maxBodyBytes: whole("Largest request", "The largest request the runtime reads from Lumiverse. A larger one is refused: lower the connection's context size, or the history cutoff.", 64 * 1024, 64 * 1024 * 1024, "bytes"),
        drainMs: ms("Wait before restart", "How long setting the runtime up again waits for replies under way before it restarts it.", 0, 60 * 60_000),
        drainPollMs: ms("Restart poll", "How often it asks meanwhile.", 500, 60_000),
        connectionsRead: whole("Connections read", "How many of your connections the runtime reads when it looks for the loopback's.", 10, 200, "connections"),
        reconnectMs: ms("First reconnect wait", "The first wait before the runtime reconnects to Lumiverse; each failure doubles it.", 100, 60_000),
        reconnectMaxMs: ms("Longest reconnect wait", "The longest wait between two tries to reconnect.", 1_000, 60 * 60_000),
        sessionCheckMs: ms("Session check", "How often the runtime asks Lumiverse about its session, which renews it.", 60_000, 7 * DAY_MS),
        stopGraceMs: ms("Stop grace", "How long a stopping runtime waits for its last words to go out.", 0, 30_000),
        traceMs: ms("Trace held back", "How long the runtime holds trace events to send them together.", 0, 5_000),
        traceBatch: whole("Trace events per request", "The most trace events one request carries to the Live page.", 1, 4096, "events"),
        traceHeld: whole("Trace events held", "The most trace events held while they can't be sent; past it a reply's later events stay out of the Live page (its stored transcript is whole all the same).", 100, 1_000_000, "events"),
        turnWaitMs: ms("Wait for the earlier reply", "How long a new reply waits for the chat's earlier one to stop before it is refused.", 1_000, 10 * 60_000),
        stopAskMs: ms("Wait for Lumiverse's Stop", "How long Lumiverse may take to answer when the runtime asks it to stop a reply you stopped in the Live page, before the runtime ends the reply itself.", 500, 60_000),
        joinMaxUnits: whole("Largest frame the runtime joins", "The largest frame the runtime puts together from parts.", 1024 * 1024, 256 * 1024 * 1024, "characters"),
        partStaleMs: ms("Parts the runtime keeps", "How long the first parts of a frame the runtime puts together wait for the rest.", 1_000, 60 * 60_000),
        storeWaitMs: ms("Storage wait", "How long the runtime waits for this extension's storage to take what it saved, wherever something waits on it: a reply's record, a page that reads it, the runtime stopping. Past it that goes on without it. Nothing is lost: it stays on the runtime's disk and goes to the storage as soon as it can.", 1_000, 60 * 60_000),
        lumiverseMs: ms("Lumiverse wait", "How long each request the runtime makes to Lumiverse over HTTP waits for its answer: finding this extension, opening its link, putting the key in the loopback connection, asking Lumiverse to stop a reply. Past it the request fails, and says so.", 1_000, 10 * 60_000),
        copyReadMs: ms("Chat data wait", "How long each request the runtime makes to Lumiverse for its own copy of your chats and world books waits for its answer: a page of a chat's messages or of a book's entries, a check of a chat before an agent reads it. Past it that read is given up, and the agent's read is asked of this extension instead.", 1_000, 10 * 60_000),
        copyChars: whole("Chat data kept", "The most characters of your chats and world books the runtime keeps in memory, so an agent reads them without asking this extension. What was used least recently goes first; a chat larger than this alone is read from this extension every time. 0 keeps none.", 0, 1_000_000_000, "characters"),
        providerMs: ms("Provider wait", "How long testing one of the runtime's connections (Runtime → Connections), or reading a server's list of its models for a model picker, waits for the provider to answer. Past it the page says the provider didn't answer.", 1_000, 10 * 60_000),
        answerSilentMs: ms("Silent answer ends after", "How long a model's answer, once it has begun, may go with nothing at all from its provider's server before the call is ended and made again, as a dropped stream is. Before its answer begins a model may still be reading a long prompt or thinking unseen: that is never cut short. 0: no limit.", 0, DAY_MS),
        signInMs: ms("Sign-in stays open", "How long a sign-in to Anthropic or OpenAI (Runtime → Connections) stays open for you to sign in and paste back what the provider gave you. Past it the sign-in ends and says so: start it again. A provider keeps what it gives you good for about ten minutes, so a longer wait seldom helps.", 60_000, 60 * 60_000),
        buildStartMs: ms("New build's start check", "How long a new build of the runtime is given to start and say its version before the runtime updates to it. Past it the build is taken as one that can't start here, and the runtime stays on the build it runs. A slow or busy machine may need longer.", 5_000, 10 * 60_000),
      },
    },
  },
};

/** A value the section refuses: where it is, from the section's root, and why. */
export interface SettingProblem {
  path: (string | number)[];
  message: string;
}

/** Checks a value against a node of the schema above: the keywords this section uses, no more. */
function check(schema: JsonObject, value: unknown, path: (string | number)[], problems: SettingProblem[]): void {
  const title = typeof schema.title === "string" ? schema.title : String(path.at(-1) ?? "This setting");
  if (Array.isArray(schema.oneOf)) {
    const choices = schema.oneOf.flatMap((c) => (isRecord(c) && c.const !== undefined ? [c.const] : []));
    if (!choices.some((c) => c === value)) problems.push({ path, message: `${title} must be one of: ${choices.map(String).join(", ")}.` });
    return;
  }
  if (schema.type === "object") {
    if (!isRecord(value)) {
      problems.push({ path, message: `${title} must be a group of settings.` });
      return;
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const key of Object.keys(value)) if (!hasOwn(properties, key)) problems.push({ path: [...path, key], message: `There is no setting ${[...path, key].join(".")}.` });
    for (const [key, child] of Object.entries(properties)) if (hasOwn(value, key) && isRecord(child)) check(child as JsonObject, value[key], [...path, key], problems);
    return;
  }
  if (schema.type === "array") {
    // The one kind of list this section has: text items, each once.
    const max = isRecord(schema.items) && typeof schema.items.maxLength === "number" ? schema.items.maxLength : Number.MAX_SAFE_INTEGER;
    if (!Array.isArray(value)) problems.push({ path, message: `${title} must be a list.` });
    else
      value.forEach((item: unknown, i) => {
        if (typeof item !== "string" || item === "" || item.length > max) problems.push({ path: [...path, i], message: `${title} lists text, each at most ${max} characters.` });
        else if (value.indexOf(item) !== i) problems.push({ path: [...path, i], message: `${title} lists "${item}" twice.` });
      });
    return;
  }
  if (schema.type === "integer") {
    const unit = typeof schema["x-unit"] === "string" ? ` ${schema["x-unit"]}` : "";
    const min = typeof schema.minimum === "number" ? schema.minimum : Number.MIN_SAFE_INTEGER;
    const max = typeof schema.maximum === "number" ? schema.maximum : Number.MAX_SAFE_INTEGER;
    if (typeof value !== "number" || !Number.isSafeInteger(value)) problems.push({ path, message: `${title} must be a whole number.` });
    else if (value < min || value > max) problems.push({ path, message: `${title} must be from ${min} to ${max}${unit}.` });
  }
}

/** What the section refuses of `values` (the section as stored: any part may be absent, and its default then stands); none when it takes them all. */
export function checkTransport(values: unknown): SettingProblem[] {
  const problems: SettingProblem[] = [];
  if (values !== undefined) check(TRANSPORT_SCHEMA, values, [], problems);
  return problems;
}

function merged(defaults: JsonValue, own: unknown): JsonValue {
  if (!isRecord(defaults)) return own === undefined ? defaults : (own as JsonValue);
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(defaults)) out[key] = merged(value, isRecord(own) && hasOwn(own, key) ? own[key] : undefined);
  return out;
}

/** The section's defaults as plain JSON. */
export function transportDefaults(): JsonObject {
  return JSON.parse(JSON.stringify(TRANSPORT_DEFAULTS)) as JsonObject;
}

/**
 * The section whole: the user's own values over the defaults. A value the schema refuses (a stored
 * one from another build, a hand-edited config) is left out, so its default stands; a list with an
 * item refused is left out whole.
 */
export function transportOf(values: unknown): TransportSettings {
  const SEP = "\u0000";
  const refused = checkTransport(values).map((p) => p.path.join(SEP));
  const strip = (value: unknown, path: string[]): unknown => {
    const at = path.join(SEP);
    if (refused.includes(at)) return undefined;
    if (Array.isArray(value)) return refused.some((r) => r.startsWith(`${at}${SEP}`)) ? undefined : value;
    if (!isRecord(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const kept = strip(child, [...path, key]);
      if (kept !== undefined) out[key] = kept;
    }
    return out;
  };
  return merged(transportDefaults(), strip(values, [])) as unknown as TransportSettings;
}

/** The runtime's part of the section, from the settings' values whole (`{ core, transport }`). */
export function runtimeTuningOf(values: unknown): RuntimeTuning {
  return transportOf(isRecord(values) ? values[TRANSPORT_KEY] : undefined).runtime;
}

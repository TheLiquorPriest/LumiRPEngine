// What becomes of every setting today's build keeps (STANDALONE-PLAN §15.2 "Your settings", R-35): the one
// table. Each key of the engine's `settings.json`, of LumiAH's `harness/settings.json` and of a runtime's
// own config has one fate: carried into the RPE setting of the same meaning (a time LumiAH keeps in
// milliseconds is RPE's seconds), carried but for RPE counting it otherwise (`unlike`: not carried, with
// why), archived as steering only an old engine (kept in the backup, named in the report), or named as
// having no counterpart. A key the table does not name is named as having no counterpart too, so that
// no setting goes unsaid. Every cap of today's in calls, tokens, time, depth and count goes to the key
// of RPH or the app that holds it with today's meaning.

/** What becomes of one setting. */
export type Fate =
  /** Carried into the setting of the same meaning; `seconds`: today's is in milliseconds, RPE's in seconds. */
  | { to: string; seconds?: true; books?: true }
  /** RPE has a like setting that counts something else, so no value of today's means the same there. */
  | { unlike: string; to: string }
  /** Steered only an engine that is gone: kept in the backup and named. */
  | { archived: string }
  /** RPE has no setting of that meaning: named. */
  | { none: string };

const gone = (what: string): Fate => ({ archived: `steers only ${what}, which RPE does not have` });

const WRITER = gone("LumiAH's writer agent");
const LOOP = gone("LumiAH's agent loop");
const RECALL = gone("LumiAH's recall tools");
const JOBS = gone("how LumiAH's jobs were run");
const MODEL = { none: "the model and effort an agent of today's runs on are carried as model choices, and its limits and tools into the header of an agent definition of his own; RPE's own agents are set up in their files" } as const;

/** LumiAH's settings by path (`core.*` is its harness section); the paths of a group not named here are looked up by prefix (`LUMIAH_GROUPS`). */
const LUMIAH: Readonly<Record<string, Fate>> = {
  "core.reply.progress": { unlike: "today's, off, showed no progress line; RPE's least still shows the one that keeps a silent turn alive", to: "progress.show" },
  "core.reply.progressChars": { none: "RPE's progress line is not cut at a length of its own" },
  "core.story.hidden": { to: "chat.hiddenReadable" },
  "core.story.from": { to: "story.from" },
  "core.story.newest": { to: "story.newest" },
  "story.minds.playerMind": { to: "cast.playerMind" },
  "core.turn.tokensIn": { to: "limits.turn.tokensIn" },
  "core.turn.tokensOut": { to: "limits.turn.tokensOut" },
  "core.turn.toolTurns": { to: "limits.turn.toolRounds" },
  "core.turn.wallMs": { to: "limits.turn.time", seconds: true },
  "core.loop.repeats": { to: "limits.repeats" },
  "core.loop.clipChars": { to: "results.clip" },
  "core.loop.charsPerToken": { to: "tokens.charsPerToken" },
  "core.loop.retries": { to: "calls.retries" },
  "core.loop.retryWaitMs": { to: "calls.retryWait", seconds: true },
  "core.loop.answerFloor": { to: "limits.answerFloor" },
  "core.cache.retention": { to: "calls.cacheRetention" },
  "core.cache.key": { none: "RPE asks a provider to cache by the call, with no key of the user's" },
  "core.connections.atOnce": { to: "throttles.atOnce" },
  "core.connections.throttles": { none: "a throttle is carried to the connection of RPE's that the connection it names is (the same id, or the same provider, model and address); one set on a connection RPE holds none for has no connection to go to" },
  "core.connections.toolRefusalMinutes": { to: "calls.toolRefusalMinutes" },
  "core.prices": { none: "RPE keeps no money figures, so none of the user's prices" },
  "core.session.keepTurns": { to: "compaction.keepTurns" },
  "core.delegation.depth": { to: "limits.turn.depth" },
  "core.delegation.atOnce": { to: "limits.turn.agentsAtOnce" },
  "core.delegation.perRun": { to: "limits.turn.agents" },
  "core.jobs.atOnce": { to: "jobs.atOnce" },
  "core.jobs.perRun": { to: "jobs.perRun" },
  "core.jobs.budget.tokensIn": { to: "jobs.run.tokensIn" },
  "core.jobs.budget.tokensOut": { to: "jobs.run.tokensOut" },
  "core.jobs.budget.toolTurns": { unlike: "today's counted the answers that called tools; RPE's counts every model call", to: "jobs.run.calls" },
  "core.jobs.budget.wallMs": { to: "jobs.run.time", seconds: true },
  "core.jobs.tokensPerDay": { to: "jobs.tokensPerDay" },
  "core.spend.tokensPerDay": { to: "limits.day.tokens" },
  "core.spend.costPerDay": { none: "RPE keeps no money figures, so it caps no cost a day; its value stays in the archived settings file" },
  "core.spend.cachedWeight": { to: "limits.cachedWeight" },
  "core.trace.deltaMs": { none: "RPE's trace is written to the turn's folder, not sent in batches" },
  "transport.connections.oneToolAtATime": { none: "carried by the connections: each connection of RPH says it takes one tool call per answer (serialTools)" },
};

/** The groups of LumiAH's settings, by prefix, whose members share a fate: the longest prefix that matches a path is the group. */
const LUMIAH_GROUPS: readonly (readonly [prefix: string, fate: Fate])[] = [
  ["core.reply.", WRITER],
  ["core.agents.", MODEL],
  ["core.loop.", LOOP],
  ["core.session.", gone("LumiAH's own summarising of a session, which RPE's compaction replaces with settings of its own")],
  ["core.tools.", gone("the sizes of LumiAH's tool answers; RPE's tools have settings of their own")],
  ["core.keep.", gone("how long LumiAH's own stores kept what nothing needed; RPE keeps its notes and runs by its own retention")],
  ["core.workspace.", gone("the limits of LumiAH's chat area, which RPE's notes replace with settings of their own")],
  ["core.guidance.", gone("LumiAH's guidance files")],
  ["core.skills.", gone("LumiAH's skills list")],
  ["core.delegation.", gone("how LumiAH handed work to sub-agents")],
  ["core.jobs.", JOBS],
  ["core.approval.", { none: "RPE asks for no approval of tools; what you approved is carried as history" }],
  ["core.extension.", gone("the link between LumiAH's runtime and its extension")],
  ["core.recall.", RECALL],
  ["transport.", gone("LumiAH's link between its runtime and Lumiverse")],
];

/** What becomes of one of LumiAH's settings, by its dotted path: its own entry, else its group's, else no counterpart. */
export function lumiahFate(path: string): Fate {
  const own = LUMIAH[path];
  if (own !== undefined) return own;
  let group: Fate | undefined;
  let longest = 0;
  for (const [prefix, fate] of LUMIAH_GROUPS) {
    if (path.startsWith(prefix) && prefix.length > longest) {
      group = fate;
      longest = prefix.length;
    }
  }
  return group ?? { none: "RPE has no setting of that meaning" };
}

const CLASSIC = gone("the classic pipeline or the agents engine");
const RULES = { none: "RPE's agents decide how a check or a change is read; the world's own rules stay in its document" } as const;

/** The keys of the engine's `settings.json` (`UserSettings`), each by its top-level name. */
const ENGINE: Readonly<Record<string, Fate>> = {
  defaults: { archived: "marks which shipped defaults the file was last read against" },
  helper: CLASSIC,
  modelUse: CLASSIC,
  gates: CLASSIC,
  agents: CLASSIC,
  retention: gone("the old engines' stores"),
  diagnostics: gone("the old engines' diagnostics"),
  timeouts: CLASSIC,
  jobs: gone("the old engines' Build jobs"),
  swipeDefault: CLASSIC,
  swipeAsk: CLASSIC,
  swipeTexts: CLASSIC,
  hideJsonBlocks: gone("the old engines' JSON block in a reply"),
  realism: RULES,
  time: RULES,
  overrideWorldDefaults: RULES,
  adjudication: RULES,
  overrideWorldAdjudication: RULES,
  inferred: RULES,
  extraction: RULES,
  thingReads: RULES,
  statePrices: { none: "RPE's agents are given the prices the world holds" },
  offstage: RULES,
  gm: gone("the old game master page"),
  perf: gone("the old engines' performance choices"),
  story: { none: "RPE has no setting of that meaning; each chat's own choices are carried with the chat" },
  storyPreset: gone("the old engines' story presets"),
  narration: CLASSIC,
  findings: gone("the old engines' findings list"),
  minds: { none: "RPE has no setting of that meaning besides those named of it; each chat's own choices are carried with the chat" },
  loreIndex: { none: "RPE has no setting of that meaning besides the entry that heads the index" },
  prompts: { none: "his edited texts are attached under imported/, switched off" },
  tidy: { to: "things.tidyRunMost" },
};

/** What becomes of a key of the engine's `settings.json`. */
export function engineFate(key: string): Fate {
  return ENGINE[key] ?? { none: "RPE has no setting of that meaning" };
}

/** The leaves of the engine's `settings.json` that have a setting of the same meaning, by their dotted paths. A group named here keeps its own fate (`ENGINE`) for the rest of its leaves. */
const ENGINE_LEAVES: Readonly<Record<string, Fate>> = {
  "minds.knowledge.enabled": { to: "secrets.tracked" },
  "minds.knowledge.threshold": { to: "secrets.threshold" },
  "narrator.knowledge": { to: "secrets.narrator.knowledge" },
  "narrator.secrets": { to: "secrets.narrator.secrets" },
  loreBooks: { to: "lore.books", books: true },
  "loreIndex.own.entryId": { to: "lore.index.entry" },
};

/** The leaves under the engine's key `key` that have a setting of the same meaning, as [dotted path, fate]. */
export function engineLeaves(key: string): [string, Fate][] {
  return Object.entries(ENGINE_LEAVES).filter(([path]) => path === key || path.startsWith(`${key}.`));
}

/** A runtime's `tuning` fields (`RuntimeTuning`, `H/link/settings.ts`), each by its name. */
const LINK = gone("LumiAH's link between its runtime and Lumiverse, a retired part");
const TUNING: Readonly<Record<string, Fate>> = {
  buildStartMs: { to: "update.versionWait", seconds: true },
  drainPollMs: { to: "update.lookEvery", seconds: true },
  drainMs: { to: "service.drainWait", seconds: true },
  maxBodyBytes: { to: "server.providerBodyBytes" },
  stopGraceMs: { none: "RPE's stop does not wait for work in flight: a turn cut short is marked interrupted" },
  progressMs: { to: "progress.silence", seconds: true },
  commentMs: { to: "lumiverse.stream.comment", seconds: true },
  reconnectMs: { to: "lumiverse.sockets.retry", seconds: true },
  reconnectMaxMs: { to: "lumiverse.sockets.retryMax", seconds: true },
  socketPingMs: { to: "lumiverse.sockets.ping", seconds: true },
  sessionCheckMs: { to: "lumiverse.session.check", seconds: true },
  lumiverseMs: { none: "RPE reads Lumiverse's database file where it can, and its waits for Lumiverse are the lumiverse.* settings" },
  stopAskMs: { none: "RPE ends a reply by its own route, with no wait for Lumiverse to stop it" },
  turnWaitMs: { to: "limits.previousRun", seconds: true },
  providerMs: { to: "calls.providerWait", seconds: true },
  answerSilentMs: { to: "calls.silentAfter", seconds: true },
  signInMs: { to: "calls.signInOpen", seconds: true },
  connectionsRead: { none: "it capped today's read of his connections at one page of 200; RPE reads every page" },
  traceMs: { none: "RPE's trace is written to the turn's folder, not sent in batches" },
  traceBatch: { none: "RPE's trace is written to the turn's folder, not sent in batches" },
  traceHeld: { none: "RPE's trace is written to the turn's folder, not sent in batches" },
  stallMs: LINK,
  lostMs: LINK,
  probeMs: LINK,
  heartbeatMs: LINK,
  silentMs: LINK,
  crashMs: LINK,
  requestMs: LINK,
  modelsWaitMs: LINK,
  joinMaxUnits: LINK,
  partStaleMs: LINK,
  storeWaitMs: LINK,
  copyReadMs: gone("the runtime's copy of chats and lore, a retired part"),
  copyChars: gone("the runtime's copy of chats and lore, a retired part"),
};

/** What becomes of one of a runtime's `tuning` fields. */
export function tuningFate(field: string): Fate {
  return TUNING[field] ?? { none: "RPE has no setting of that meaning" };
}

/** The runtime's memory limit, which RPE's service holds to. */
export const MEMORY_KEY = "service.memory";

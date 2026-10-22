#!/usr/bin/env node

// src/cli/main.ts
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

// src/shared/agents.ts
var KIT_API = 1;
var KIT_FILE = "agent-kit.js";
var NPM_INSTALL = "npm i -g github:TheLiquorPriest/LumiRPEngine";
var LUMIVERSE_HARNESS = "lumiverse";
function kitPathProblem(path, identifier) {
  const slashed = path.replaceAll("\\", "/");
  if (!(slashed.startsWith("/") || /^[A-Za-z]:\//.test(slashed)))
    return "isn't an absolute path";
  const segments = (slashed.startsWith("//") ? slashed.slice(2) : slashed).split("/").slice(1);
  if (segments.some((s) => s === "" || s === "." || s === ".."))
    return "isn't a plain path (it has an empty, . or .. part)";
  if (!slashed.endsWith(`/extensions/${identifier}/repo/dist/${KIT_FILE}`))
    return `isn't where Lumiverse installs an extension's kit (…/extensions/${identifier}/repo/dist/${KIT_FILE})`;
  return null;
}
function shellWord(text) {
  if (/^[\w./:\\@%+=,-]+$/.test(text))
    return text;
  if (!/["$`]/.test(text))
    return `"${text}"`;
  return `'${text.replaceAll("'", "'\\''")}'`;
}
var RUNTIMES = [
  { runtime: "bun", needs: "Bun 1.4 or newer" },
  { runtime: "node", needs: "Node 22 or newer" }
];
function followCommands(core) {
  return RUNTIMES.map(({ runtime, needs }) => ({ runtime, needs, command: `${runtime} ${shellWord(core)} mcp` }));
}

// src/shared/json.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOwn(o, key) {
  return Object.prototype.hasOwnProperty.call(o, key);
}
var UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// src/cli/credentials.ts
function credentialsPath(env, platform, home) {
  if (platform === "win32")
    return `${env.APPDATA || `${home}\\AppData\\Roaming`}\\lumirpengine\\credentials.json`;
  const xdg = env.XDG_CONFIG_HOME;
  return `${xdg !== undefined && xdg.startsWith("/") ? xdg : `${home}/.config`}/lumirpengine/credentials.json`;
}
function inClear(base) {
  const url = new URL(base);
  if (url.protocol !== "http:")
    return false;
  const host = url.hostname;
  return !(host === "localhost" || host.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(host) || host === "[::1]");
}
var FORMAT = 1;

class CredentialStore {
  files;
  path;
  constructor(files, path) {
    this.files = files;
    this.path = path;
  }
  load() {
    const text = this.files.read(this.path);
    if (text === null)
      return {};
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`${this.path} isn't readable JSON. Delete it and sign in again (lumirpengine login).`);
    }
    const hosts = isRecord(raw) && isRecord(raw.hosts) ? raw.hosts : {};
    const out = {};
    for (const [base, entry] of Object.entries(hosts)) {
      if (!/^https?:\/\/[^/]/.test(base))
        continue;
      if (isRecord(entry) && typeof entry.username === "string" && typeof entry.token === "string")
        out[base] = { username: entry.username, token: entry.token, savedAt: typeof entry.savedAt === "number" ? entry.savedAt : 0, ...entry.allowHttp === true ? { allowHttp: true } : {} };
    }
    return out;
  }
  save(hosts) {
    this.files.write(this.path, `${JSON.stringify({ lumirpengine: FORMAT, hosts }, null, 2)}
`);
  }
  get(base) {
    const hosts = this.load();
    return hasOwn(hosts, base) ? hosts[base] ?? null : null;
  }
  bases() {
    return Object.keys(this.load()).sort();
  }
  put(base, login) {
    this.save({ ...this.load(), [base]: login });
  }
  remove(base) {
    const hosts = this.load();
    if (!hasOwn(hosts, base))
      return false;
    delete hosts[base];
    this.save(hosts);
    return true;
  }
}

// src/cli/kit-api.ts
function kitOf(module) {
  const kit = isRecord(module) ? module.kit : undefined;
  if (!isRecord(kit))
    return "it exports no kit";
  if (kit.api !== KIT_API)
    return `it is kit API ${String(kit.api)}, and this lumirpengine reads kit API ${KIT_API}`;
  const versions = kit.versions;
  if (typeof kit.build !== "string" || !isRecord(versions) || typeof versions.agentApi !== "number" || typeof kit.tools !== "function" || typeof kit.has !== "function" || typeof kit.call !== "function")
    return "it isn't a whole kit";
  return kit;
}
function bundledKitOf(module) {
  const kit = kitOf(module);
  if (typeof kit === "string")
    return kit;
  return "run" in kit && typeof kit.run === "function" ? kit : "it runs no command line";
}

// src/shared/world.ts
var WORLD_FORMAT = "lre-world-v1";
var ENGINE_VERSION = "0.1.0";

// src/shared/studio-bridge.ts
var ENGINE_EXTENSION = "lumi_rp_engine";
var STUDIO_EXTENSION = "lumi_rp_engine_studio";
var STUDIO_INBOUND = ["file", `rpc:${STUDIO_EXTENSION}.offer`];
var encoder = new TextEncoder;

// src/shared/protocol.ts
var PROTOCOL_VERSION = 1;
var AGENT_API = 2;

// src/shared/minds.ts
var DEFAULT_FIDELITY_WEIGHTS = Object.freeze({
  here: 45,
  nearby: 20,
  mentioned: 40,
  regard: 10,
  knows: 10,
  owner: 15,
  track: 8,
  roles: { antagonist: 20 },
  rule: 5,
  pending: 15,
  band: { principal: 15, supporting: 5, background: 0 },
  recent: 10
});
var DEFAULT_FIDELITY_THRESHOLDS = Object.freeze({ live: 60, near: 35, far: 15 });
var DEFAULT_MINDS_MEMORY = Object.freeze({
  witness: { show: 8 },
  recall: { recent: 4, relevant: 4, tokens: 4000 },
  notes: { show: 8, keep: 24 },
  commitments: { show: 8 },
  salience: { halfLifeDays: 7, floor: 0.5 },
  consolidate: { enabled: true, periodDays: 1 }
});
var DEFAULT_WORLD_MINDS = Object.freeze({
  secrecy: "brief",
  weights: DEFAULT_FIDELITY_WEIGHTS,
  thresholds: DEFAULT_FIDELITY_THRESHOLDS,
  always: null,
  never: null,
  memory: DEFAULT_MINDS_MEMORY
});
var MINDS_RANGES = {
  weight: [-100, 200],
  threshold: [0, 1000],
  show: [0, 64],
  keep: [1, 64],
  recallTokens: [0, Number.MAX_SAFE_INTEGER],
  halfLifeDays: [0.1, 3650],
  floor: [0, 5],
  periodDays: [0.1, 365]
};
var DEFAULT_MIND_READS = Object.freeze({
  pinned: { on: true, tokens: "none" },
  activated: { on: true, tokens: 1600 },
  reply: { on: true, tokens: "none" },
  message: { on: true, tokens: "none" },
  history: { on: false, messages: 8, tokens: 3000 },
  summary: { on: false, tokens: "none" },
  memory: { on: false, tokens: "none" },
  thoughts: { on: false, tokens: "none" },
  recall: { on: false },
  routine: { on: true, tokens: 400 },
  life: { on: false, tokens: "none" }
});
var MINDS_PRESETS = Object.freeze({
  lean: { enabled: false, liveLimit: 3, nearRefresh: { scene: true, mention: true, turns: 6, minutes: 120 }, farRefreshMinutes: 1440, refreshLimit: 1, memoryLevels: [], tokens: 1200, skip: { maxBeats: 4, maxMindsPerBeat: 2 } },
  standard: { enabled: true, liveLimit: 3, nearRefresh: { scene: true, mention: true, turns: 6, minutes: 120 }, farRefreshMinutes: 1440, refreshLimit: 2, memoryLevels: ["live"], tokens: 2400, skip: { maxBeats: 6, maxMindsPerBeat: 3 } },
  full: { enabled: true, liveLimit: "none", nearRefresh: { scene: true, mention: true, turns: 4, minutes: 60 }, farRefreshMinutes: 720, refreshLimit: "none", memoryLevels: ["live", "near"], tokens: 4000, skip: { maxBeats: "none", maxMindsPerBeat: "none" } }
});
function defaultMindsSettings(preset = "standard") {
  return { ...structuredClone(MINDS_PRESETS[preset]), reads: structuredClone(DEFAULT_MIND_READS), memory: {}, prompts: {} };
}
var MINDS_DEFAULTS = Object.freeze(defaultMindsSettings());
var MIND_PROMPT_DEFAULTS = Object.freeze({
  mind: [
    "You are the private mind of {{character}} in the roleplay world {{world}}. Think as {{character}}, from only what {{character}} knows: the context below is everything they perceive and remember. Other people's private thoughts are closed to you; ignore any narration of them in the recalled turns.",
    "Decide how {{character}} reads this moment and what they intend. Everyone else decides for themselves: never script their actions or replies, and never plan around what they will do. Intend broadly, so the intent holds whatever they do. Write no narration and no dialogue."
  ].join(`
`),
  memory: "You keep the memory of {{character}} in the roleplay world {{world}}. Below is what {{character}} knows, then the turn that just happened, as it was written. Only what was written happened, and only what {{character}} could see or hear of it counts; ignore narration of other people's private thoughts.",
  skip: [
    "The player character in the roleplay world {{world}} is skipping ahead in time. Below are the skip's span, the moments the engine already found in it, and what the people involved intend.",
    "Propose further moments inside the span where something worth stopping for may happen: someone acting on a plan that involves the player character, a deadline, an occasion. Only moments the context supports; never invent people or places."
  ].join(`
`),
  consolidate: "You keep the long-term memory of {{character}} in the roleplay world {{world}}. Fold the older notes below into their summary: keep what still matters to them, let the rest go, and keep everything the summary already holds that is still true."
});
var MIND_ANSWER_FORMATS = Object.freeze({
  mind: [
    'Answer with JSON only: {"monologue": "...", "depiction": "...", "intent": "...", "reactions": ["..."], "mood": "...", "interrupt": {"reason": "..."}}',
    "- monologue: their private reasoning in the first person, at most six sentences.",
    "- depiction: how they come across right now, as behaviour anyone present could see (posture, tone, what they do). Never a secret, an unspoken reason or a thought.",
    "- intent: what they mean to do next, in one sentence.",
    '- reactions: up to three short conditional reactions ("if pressed about the cellar, changes the subject").',
    "- mood: one or two words.",
    "- interrupt: only when the moment is a beat inside a time skip and what they'd do now would interrupt the player character's skipped time (seeking them out, calling them). Leave it out otherwise."
  ].join(`
`),
  memory: [
    'Answer with JSON only: {"notes": [{"text": "...", "salience": 3}], "commitments": [{"kind": "promise|debt|grudge|favour|plan|other", "with": ["a name"], "text": "...", "due": "YYYY-MM-DD HH:MM"}], "resolved": [{"id": "...", "status": "kept|broken|released"}], "plans": [], "told": [{"to": ["a name"], "what": "..."}], "summary": "..."}',
    "- notes: at most three things they will remember, in their own perspective; salience 1 (passing) to 5 (unforgettable).",
    "- commitments: promises, debts, grudges, favours and plans with someone that this turn made; due only when a time was set.",
    "- resolved: their open commitments (listed with ids) that this turn kept, broke or released.",
    '- plans: only what this turn states they will do later: said aloud, agreed with someone, or scheduled in the story as written; never a guess at what they might do. Each {"what": "...", "kind": "errand|meet|visit|work|rest|leisure|pay|lend|other", "when": {"from": "YYYY-MM-DD HH:MM", "to": "YYYY-MM-DD HH:MM"}, "where": "a place", "with": ["a name"], "priority": 3, "amount": 20}, with local times; priority 1 (whenever it fits) to 5 (it must happen); kind pay or lend, with amount, when they mean to hand someone money, and no amount otherwise.',
    "- told: what they told whom in this turn, in a few words each.",
    "- summary: their one-paragraph summary rewritten, only when this turn changed who they are or what they're about; leave it out otherwise.",
    "Use empty lists for anything the turn didn't give."
  ].join(`
`),
  skip: 'Answer with JSON only: {"beats": [{"at": "YYYY-MM-DD HH:MM", "reason": "..."}]}, at most five, in time order; an empty list when there are none.',
  consolidate: 'Answer with JSON only: {"summary": "..."}: at most 900 characters of plain prose, in their own perspective.'
});

// src/shared/timeouts.ts
var MIN = 60000;
var TIMEOUTS = {
  engineRunMs: {
    label: "Engine run",
    group: "turn",
    limits: "Everything the engine does before the reply is generated: reading your action, people's choices, judging your approach, puzzle answers, the minds, the plan, the brief and the outline.",
    fires: "The engine run stops: no reply is generated, and the chat says which step ran out, with a Retry.",
    defaultMs: 5 * MIN,
    minMs: 1000,
    none: "the run takes as long as it needs"
  },
  preLookupMs: {
    label: "Lore lookups before the reply",
    group: "turn",
    limits: "How long after the engine run starts a helper may still ask for lore; a lookup also starts only while a third of the run's time is left.",
    fires: "Helpers answer with the lore they already have.",
    defaultMs: 2 * MIN,
    minMs: 0,
    zero: "no lookups",
    none: "lookups may start until the run's last third"
  },
  postReplyMs: {
    label: "Reading the reply",
    group: "turn",
    limits: "Everything the engine asks a model after the reply: what changed, the contradiction check, people elsewhere, suggested choices, memory.",
    fires: "The reads still waiting are skipped; the reply stands, and Re-read tries again.",
    defaultMs: 5 * MIN,
    minMs: 0,
    zero: "no model calls after the reply",
    none: "the reads take as long as they need"
  },
  postLookupMs: {
    label: "Lore lookups after the reply",
    group: "turn",
    limits: "How long after the reply's reading starts a helper may still ask for lore; a lookup also starts only while a third of the reading's time is left.",
    fires: "Helpers answer with the lore they already have.",
    defaultMs: 2 * MIN,
    minMs: 0,
    zero: "no lookups",
    none: "lookups may start until the reading's last third"
  },
  guardMs: {
    label: "Generation guard",
    group: "turn",
    limits: "Lumiverse's wait for the engine's check, as a generation starts, that the engine's lore entries are fresh. The check itself is instant; this matters only while the engine is busy.",
    fires: "Lumiverse stops the generation, so nothing goes out with stale entries.",
    defaultMs: 2 * MIN,
    minMs: 1000,
    none: "as long as Lumiverse waits",
    host: "contextHandler"
  },
  skipPlanMs: {
    label: "Time skip plan",
    group: "turn",
    limits: "The one call, as a time skip starts, that plans how the people whose skip is planned by the model spend it.",
    fires: "Nobody is planned: they stay where they are, the GM gets a note, and the skip still runs.",
    defaultMs: 2 * MIN,
    minMs: 1000,
    none: "the call takes as long as the engine run allows"
  },
  requestMs: {
    label: "Engine requests",
    group: "app",
    limits: "How long this tab waits for the engine to answer a request: a view, an edit, a setting.",
    fires: "The tab says the engine didn't answer; the engine may still finish the request.",
    defaultMs: 5 * MIN,
    minMs: 1000,
    none: "the tab waits as long as it takes"
  },
  caveatsMs: {
    label: "Preset check",
    group: "app",
    limits: "How long Settings → Caveats waits for its test prompt of the chat before saying the check is still running.",
    fires: "Caveats says the check is still running; it finishes in the background for the next look.",
    defaultMs: MIN,
    minMs: 0,
    zero: "always answer at once",
    none: "wait for the check (Engine requests still bounds the tab's wait)"
  },
  mcpReconnectMs: {
    label: "MCP server reconnect",
    group: "work",
    limits: "How long Reconnect in Lumiverse waits for a server Lumiverse runs to come back with this build's tools, after it is asked to exit.",
    fires: "The server's line says it isn't back, with how to disconnect and connect it in Lumiverse's Settings → MCP Servers.",
    defaultMs: MIN,
    minMs: 1000,
    none: "the line waits until the server is back"
  },
  mindsRunMs: {
    label: "Minds run on demand",
    group: "work",
    limits: "A minds run started from GM → Minds, from start to end.",
    fires: "The run stops; the minds it finished are kept.",
    defaultMs: 10 * MIN,
    minMs: 1000,
    none: "the run goes on until it ends or you cancel it"
  },
  jobCallMs: {
    label: "Import and Refine calls",
    group: "work",
    limits: "Each model call of an Import, a Refine, a lore index, a map description or a routine proposal in Build.",
    fires: "That call counts as failed; the job goes on with what the other calls proposed.",
    defaultMs: 10 * MIN,
    minMs: 1000,
    none: "a call takes as long as it needs (Cancel still stops the job)"
  },
  tokenCountMs: {
    label: "Token counts",
    group: "work",
    limits: "How long Lumiverse's tokenizer may take to count a section before the engine's estimate stands in for it.",
    fires: "The section is priced by the engine's estimate, which stays above the real count.",
    defaultMs: 30000,
    minMs: 0,
    zero: "always the estimate",
    none: "wait for every count"
  },
  laneStartupMs: {
    label: "Background lane start-up",
    group: "work",
    limits: "How long Playtest and Check world's background process may take to start.",
    fires: "Lumiverse stops the process and the job fails.",
    defaultMs: MIN,
    minMs: 1000,
    none: "as long as Lumiverse waits",
    host: "processStartup"
  },
  laneHeartbeatMs: {
    label: "Background lane heartbeat",
    group: "work",
    limits: "The longest gap between the background process's heartbeats; it beats after each simulated day or turn.",
    fires: "Lumiverse terminates the process and the job fails.",
    defaultMs: MIN,
    minMs: 1000,
    none: "Lumiverse checks no heartbeat",
    host: "processHeartbeat"
  }
};
function formatMs(ms) {
  if (!Number.isFinite(ms))
    return "no limit";
  if (ms < 1000)
    return `${Math.round(ms)} ms`;
  if (ms < MIN)
    return `${Number((ms / 1000).toFixed(1))} s`;
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor(totalSeconds % 3600 / 60);
  const s = totalSeconds % 60;
  return [h > 0 ? `${h} h` : "", m > 0 ? `${m} min` : "", s > 0 && h === 0 ? `${s} s` : ""].filter((p) => p !== "").join(" ");
}

// src/cli/connection.ts
var LIVE_ERROR = Symbol.for("lumirpengine.LiveError");
var LRE_ERROR = Symbol.for("lumirpengine.LreError");

class LiveError extends Error {
  problem;
  static [Symbol.hasInstance](value) {
    return typeof value === "object" && value !== null && value[LIVE_ERROR] === true;
  }
  constructor(problem, message) {
    super(message);
    this.problem = problem;
    this.name = "LiveError";
    Object.defineProperty(this, LIVE_ERROR, { value: true });
  }
}

class LreError extends Error {
  code;
  lint;
  static [Symbol.hasInstance](value) {
    return typeof value === "object" && value !== null && value[LRE_ERROR] === true;
  }
  constructor(code, message, lint) {
    super(message);
    this.code = code;
    this.lint = lint;
    this.name = "LreError";
    Object.defineProperty(this, LRE_ERROR, { value: true });
  }
}
var FRAME_LIMIT = 4 * 1024 * 1024;
var TIMEOUT_MS = 300000;
var RAISE = "Raise --timeout (or LRE_TIMEOUT) in seconds, or set it to none.";
var PING_MS = 45000;
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function said(text) {
  const body = parse(text);
  const words = isRecord(body) ? body.message ?? body.error : null;
  return typeof words === "string" && words !== "" ? `: ${words}` : "";
}
var loginAgain = (base) => `Your Lumiverse session for ${base} is no longer valid (it expired, or was signed out). Sign in again: lumirpengine login --url ${base}`;
var forbidden = (base) => `Lumiverse at ${base} refused this client (403 Forbidden): the address isn't one of its trusted hosts. Use the URL you open Lumiverse at in your browser, or add the host to Lumiverse's trusted hosts (Operator panel) or TRUSTED_ORIGINS. See docs/MCP.md, "Troubleshooting".`;
function waitOf(reply) {
  const minutes = Math.ceil(Number(reply.header("retry-after")) / 60);
  return Number.isFinite(minutes) && minutes > 0 ? `for about ${minutes} minute${minutes === 1 ? "" : "s"}` : "for a while";
}
var lockedOut = (reply) => `Lumiverse is refusing every request from this address ${waitOf(reply)}${said(reply.text)}: it locks an address out after repeated failed sign-ins, and that includes your browser on this machine. Wait it out; signing in again before then only makes the next lockout longer.`;
function refused(base, reply, asked) {
  if (reply.status === 401)
    return new LiveError("login", loginAgain(base));
  if (reply.status === 403)
    return new LiveError("forbidden", forbidden(base));
  if (reply.status === 429)
    return new LiveError("locked", lockedOut(reply));
  if (reply.status === 404)
    return new LiveError("unreachable", `There is no Lumiverse at ${base} (404 when it ${asked}). Check the URL: it's the address you open Lumiverse at.`);
  return new LiveError("unreachable", `Lumiverse at ${base} answered ${reply.status} when it ${asked}${said(reply.text)}. Behind a proxy, that can mean Lumiverse itself is down.`);
}
async function exchange(http, base, method, path, token, body) {
  const headers = { Accept: "application/json" };
  if (body !== undefined)
    headers["Content-Type"] = "application/json";
  if (token !== null)
    headers.Authorization = `Bearer ${token}`;
  let reply;
  try {
    reply = await http({ method, url: `${base}${path}`, headers, ...body !== undefined ? { body } : {} });
  } catch (error) {
    throw new LiveError("unreachable", `Can't reach Lumiverse at ${base}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (reply.status >= 300 && reply.status < 400) {
    let target = null;
    try {
      target = new URL(reply.header("location") ?? "", `${base}${path}`);
    } catch {}
    const instead = target === null ? "<that address>" : target.pathname.endsWith(path) ? `${target.origin}${target.pathname.slice(0, -path.length)}` : target.href;
    if (target !== null && target.protocol === "https:" && base.startsWith("http:"))
      throw new LiveError("insecure", `Lumiverse at ${base} answers on https: use lumirpengine login --url ${instead}, so the password and the session token never cross the network in clear.`);
    throw new LiveError("unreachable", `Lumiverse at ${base} answered with a redirect to ${target?.href ?? "another address"}. Use the address it redirects to (lumirpengine login --url ${instead}).`);
  }
  return reply;
}
async function sessionOf(http, base, token) {
  const reply = await exchange(http, base, "GET", "/api/auth/get-session", token);
  if (reply.status === 401)
    return { valid: false, expiresAt: null };
  if (reply.status < 200 || reply.status >= 300)
    throw refused(base, reply, "was asked about the session");
  const body = parse(reply.text);
  const session = isRecord(body) && isRecord(body.session) ? body.session : null;
  if (session === null)
    return { valid: false, expiresAt: null };
  return { valid: true, expiresAt: typeof session.expiresAt === "string" ? session.expiresAt : null };
}
function frontendSession() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

class HostConnection {
  options;
  socket = null;
  opened = null;
  opening = null;
  lastExtension = null;
  pending = new Map;
  seq = 0;
  prefix = "";
  ping = null;
  openedToken = null;
  greeting = null;
  timeoutMs;
  pingMs;
  constructor(options) {
    this.options = options;
    this.timeoutMs = options.timeoutMs === undefined ? TIMEOUT_MS : options.timeoutMs;
    this.pingMs = options.pingMs ?? PING_MS;
  }
  get base() {
    return this.options.base;
  }
  async request(type, fields) {
    const opened = await this.ensure();
    if (opened.agentApi === null || opened.agentApi < this.needs())
      throw new LiveError("too_old", this.tooOld(opened.agentApi));
    return await this.send(type, fields);
  }
  async describe() {
    const { base, http } = this.options;
    const out = { base, username: this.options.credentials()?.username ?? null, session: { valid: null, expiresAt: null }, extension: null, agentApi: null, problem: null, checkIn: this.options.checkIn?.() ?? null };
    try {
      out.session = await sessionOf(http, base, this.signedIn().token);
      if (out.session.valid === false) {
        out.problem = loginAgain(base);
        return out;
      }
      const opened = await this.ensure();
      out.extension = opened.extension;
      out.agentApi = opened.agentApi;
      if (opened.agentApi === null || opened.agentApi < this.needs())
        out.problem = this.tooOld(opened.agentApi);
    } catch (error) {
      out.problem = error instanceof Error ? error.message : String(error);
      out.extension = this.lastExtension;
    }
    return out;
  }
  async ensureOpen() {
    await this.ensure();
  }
  isOpen() {
    return this.opened !== null && this.socket !== null;
  }
  async checkInAgain() {
    if (this.isOpen())
      await this.greet();
  }
  close() {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.closed(1000, "closed by the client");
  }
  needs() {
    return this.options.needs?.() ?? AGENT_API;
  }
  tooOld(agentApi) {
    const speaks = agentApi === null ? "doesn't speak the agent API" : `speaks agent API ${agentApi}`;
    return `LumiRPEngine on ${this.options.base} is too old for lumirpengine ${this.options.client.version}: it ${speaks}, and this client needs ${this.needs()}. Update LumiRPEngine on your Lumiverse (Extensions → LumiRPEngine → Update), then try again.`;
  }
  signedIn() {
    const { base } = this.options;
    const saved = this.options.credentials();
    if (saved === null)
      throw new LiveError("login", `Not signed in to ${base}. Run: lumirpengine login --url ${base}`);
    if (inClear(base) && saved.allowHttp !== true)
      throw new LiveError("insecure", `${base} is plain http to another machine, and this sign-in wasn't made with --allow-http, so its session token won't be sent there in clear. Use https, or sign in again with: lumirpengine login --url ${base} --allow-http`);
    return saved;
  }
  ensure() {
    if (this.opened !== null && this.socket !== null) {
      const saved = this.options.credentials();
      if (saved !== null && saved.token === this.openedToken)
        return Promise.resolve(this.opened);
      this.close();
    }
    this.opening ??= this.open().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }
  async findExtension(token) {
    const { base, http } = this.options;
    this.lastExtension = null;
    const reply = await exchange(http, base, "GET", "/api/v1/spindle", token);
    if (reply.status !== 200)
      throw refused(base, reply, "was asked for its extensions");
    const body = parse(reply.text);
    const found = isRecord(body) && Array.isArray(body.extensions) ? body.extensions.find((e) => isRecord(e) && e.identifier === ENGINE_EXTENSION) : undefined;
    if (!found || typeof found.id !== "string")
      throw new LiveError("not_installed", `LumiRPEngine isn't installed on ${base}, or your account can't use it. Install it in Lumiverse's Extensions tab from https://github.com/TheLiquorPriest/LumiRPEngine.`);
    const extension = { id: found.id, version: typeof found.version === "string" ? found.version : null, enabled: found.enabled === true, status: typeof found.status === "string" ? found.status : "unknown" };
    this.lastExtension = extension;
    if (extension.status !== "running")
      throw new LiveError("not_running", `LumiRPEngine is installed on ${base} but not running (${extension.enabled ? extension.status : "disabled"}). Enable it in Lumiverse's Extensions tab.`);
    return extension;
  }
  async ticket(token) {
    const { base, http } = this.options;
    const reply = await exchange(http, base, "POST", "/api/v1/ws-ticket", token, "{}");
    if (reply.status !== 200)
      throw refused(base, reply, "was asked for a socket ticket");
    const body = parse(reply.text);
    if (!isRecord(body) || typeof body.ticket !== "string")
      throw new LiveError("protocol", `Lumiverse at ${base} gave no socket ticket${said(reply.text)}.`);
    return body.ticket;
  }
  async open() {
    const { token } = this.signedIn();
    this.openedToken = token;
    const extension = await this.findExtension(token);
    for (let attempt = 1;; attempt++) {
      try {
        await this.connect(await this.ticket(token));
        break;
      } catch (error) {
        if (!(error instanceof LiveError && error.problem === "protocol" && attempt === 1))
          throw error;
      }
    }
    this.opened = { extension, agentApi: null };
    try {
      await this.greet();
    } catch (error) {
      this.close();
      if (error instanceof LiveError && error.problem === "timeout")
        throw new LiveError("timeout", `LumiRPEngine on ${this.options.base} didn't answer within ${formatMs(this.timeoutMs ?? 0)}. Check that it's running (lumirpengine status), and restart it in Lumiverse's Extensions tab if it is. ${RAISE}`);
      throw error;
    }
    return this.opened;
  }
  async greet() {
    const opened = this.opened;
    const checkIn = this.options.checkIn?.() ?? null;
    const hello = await this.send("lre.hello", { chatId: null, client: { ...this.options.client, ...checkIn } });
    const agentApi = isRecord(hello) ? hello.agentApi : undefined;
    if (opened !== null && this.opened === opened)
      this.opened = { extension: opened.extension, agentApi: typeof agentApi === "number" ? agentApi : null };
    if (isRecord(hello))
      this.options.onHello?.(hello, checkIn);
  }
  connect(ticket) {
    const session = frontendSession();
    this.prefix = `${session.slice(0, 8)}-`;
    const url = new URL(this.options.base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/ws`;
    url.search = new URLSearchParams({ ticket, frontend_session: session, frontend_runtime: "widget" }).toString();
    const { promise, resolve, reject } = Promise.withResolvers();
    const settle = (error) => {
      clearTimeout(timer);
      this.greeting = null;
      if (error === null)
        return resolve();
      if (this.socket === socket)
        this.socket = null;
      socket.close();
      reject(error);
    };
    const limit = this.timeoutMs;
    const timer = limit === null ? undefined : setTimeout(() => settle(new LiveError("timeout", `Lumiverse at ${this.options.base} opened no event socket within ${formatMs(limit)}. Behind a proxy, the proxy must pass WebSocket upgrades on /api/ws. ${RAISE}`)), limit);
    this.greeting = { resolve: () => settle(null), reject: settle };
    const socket = this.options.openSocket(url.toString(), {
      message: (text) => this.received(socket, text),
      close: (code, reason) => {
        if (this.socket !== socket)
          return;
        this.socket = null;
        const why = code === 1006 ? "it never opened (1006): behind a proxy, the proxy must pass WebSocket upgrades on /api/ws" : `Lumiverse closed it before it was ready (${code}${reason ? ` ${reason}` : ""})`;
        this.greeting?.reject(new LiveError(code === 1008 ? "protocol" : "closed", `The event socket at ${this.options.base}/api/ws failed: ${why}.`));
        this.closed(code, reason);
      }
    });
    this.socket = socket;
    return promise;
  }
  received(socket, text) {
    if (socket !== this.socket)
      return;
    const msg = parse(text);
    if (!isRecord(msg))
      return;
    if (msg.event === "CONNECTED") {
      this.ping ??= setInterval(() => this.socket?.send(JSON.stringify({ type: "ping" })), this.pingMs).unref();
      this.greeting?.resolve();
      return;
    }
    if (msg.event === "AUTH_ERROR") {
      this.greeting?.reject(new LiveError("protocol", "Lumiverse refused the event socket's ticket."));
      return;
    }
    if (msg.event !== "SPINDLE_FRONTEND_MSG" || !isRecord(msg.payload) || msg.payload.extensionId !== this.opened?.extension.id)
      return;
    const data = msg.payload.data;
    if (!isRecord(data) || data.lre !== PROTOCOL_VERSION)
      return;
    if (typeof data.reqId !== "string") {
      this.options.onPush?.(data);
      return;
    }
    const waiting = this.pending.get(data.reqId);
    if (!waiting || data.type !== "lre.result" && data.type !== "lre.error")
      return;
    this.pending.delete(data.reqId);
    clearTimeout(waiting.timer);
    if (data.type === "lre.result")
      waiting.resolve(data.body);
    else
      waiting.reject(new LreError(typeof data.code === "string" ? data.code : "internal", typeof data.message === "string" ? data.message : "LumiRPEngine refused the request", Array.isArray(data.lint) ? data.lint : []));
  }
  send(type, fields) {
    const socket = this.socket;
    const opened = this.opened;
    if (socket === null || opened === null)
      return Promise.reject(new LiveError("closed", "The connection to Lumiverse closed. Try again."));
    const reqId = `${this.prefix}${++this.seq}`;
    const frame = JSON.stringify({ type: "SPINDLE_BACKEND_MSG", extensionId: opened.extension.id, payload: { lre: PROTOCOL_VERSION, type, reqId, ...fields } });
    const bytes = frame.length * 3 > FRAME_LIMIT ? new TextEncoder().encode(frame).length : 0;
    if (bytes > FRAME_LIMIT)
      return Promise.reject(new LiveError("too_large", `That ${type} request is ${(bytes / 1048576).toFixed(1)} MiB, and Lumiverse drops anything over 4 MiB without a word. Send less at once.`));
    const { promise, resolve, reject } = Promise.withResolvers();
    const limit = this.timeoutMs;
    const timer = limit === null ? undefined : setTimeout(() => {
      this.pending.delete(reqId);
      reject(new LiveError("timeout", `LumiRPEngine didn't answer ${type} within ${formatMs(limit)}. A change may still have been made: check before repeating it. ${RAISE}`));
    }, limit);
    this.pending.set(reqId, { resolve, reject, timer });
    socket.send(frame);
    return promise;
  }
  closed(code, reason) {
    clearInterval(this.ping ?? undefined);
    this.ping = null;
    this.opened = null;
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const w of waiting) {
      clearTimeout(w.timer);
      w.reject(new LiveError("closed", `The connection to Lumiverse closed (${code}${reason ? ` ${reason}` : ""}) before LumiRPEngine answered. A change may or may not have been made: check before repeating it.`));
    }
  }
}

// src/cli/follow.ts
var SHA256 = /^[0-9a-f]{64}$/;
function reportOf(value) {
  if (!isRecord(value) || typeof value.path !== "string" || typeof value.sha256 !== "string" || typeof value.api !== "number" || typeof value.core !== "string")
    return null;
  return { path: value.path, sha256: value.sha256.toLowerCase(), api: value.api, core: value.core };
}
async function sha256Of(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}
var SHARED_WRITE = 18;
function ownersOnly(entry, uid) {
  return (entry.uid === uid || entry.uid === 0) && (entry.mode & SHARED_WRITE) === 0;
}
function kitDirs(real) {
  const dirs = [];
  for (let at = real, i = 0;i < 4; i++) {
    at = at.slice(0, Math.max(at.lastIndexOf("/"), at.lastIndexOf("\\")));
    dirs.unshift(at);
  }
  return dirs;
}

class KitFollower {
  options;
  kit;
  state;
  looked = null;
  constructor(bundled, options) {
    this.options = options;
    this.kit = bundled;
    this.state = options.pin ? { follows: false, why: { code: "pinned", text: "--pin (or LRE_PIN_KIT) keeps the tools this lumirpengine was installed with: run it without to follow LumiRPEngine's" } } : options.cannotLoad !== null ? { follows: false, why: { code: "runtime", text: options.cannotLoad } } : { follows: true, why: null };
  }
  get able() {
    return !this.options.pin && this.options.cannotLoad === null;
  }
  async follow(news) {
    if (!this.able)
      return false;
    const where = this.options.where();
    if (!("kit" in news) || typeof news.build !== "string")
      return this.cannot("unsupported", `LumiRPEngine on ${where} doesn't say where its tools are: update it in Lumiverse's Extensions tab`);
    if (news.kit === null)
      return this.cannot("no_kit", `LumiRPEngine on ${where} runs without an agent kit (it was built without one), so there is nothing to follow`);
    const report = reportOf(news.kit);
    if (report === null || !SHA256.test(report.sha256))
      return this.cannot("refused", `LumiRPEngine on ${where} described its tools in a way this lumirpengine doesn't read`);
    if (report.api !== KIT_API) {
      const own = followCommands(report.core).map((c) => c.command).join(", or ");
      return this.cannot("kit_api", report.api > KIT_API ? `LumiRPEngine's tools need a newer lumirpengine (kit API ${report.api}; this one reads ${KIT_API}): install it again (${NPM_INSTALL}) or run the extension's own copy (${own})` : `LumiRPEngine's tools are older than this lumirpengine reads (kit API ${report.api}; it reads ${KIT_API}): update LumiRPEngine in Lumiverse's Extensions tab, or run the extension's own copy (${own})`);
    }
    const problem = kitPathProblem(report.path, this.options.identifier);
    if (problem !== null)
      return this.cannot("refused", `LumiRPEngine named ${report.path} as its tools, which ${problem}, so it wasn't loaded`);
    const key = `${report.path}\x00${report.sha256}`;
    if (this.looked === null || this.looked.key !== key || "code" in this.looked.verdict)
      this.looked = { key, verdict: await this.look(report, news.build) };
    const { verdict } = this.looked;
    if ("code" in verdict)
      return this.cannot(verdict.code, verdict.text);
    this.state = { follows: true, why: null };
    if (verdict.kit === null || verdict.kit === this.kit)
      return false;
    this.kit = verdict.kit;
    return true;
  }
  async look(report, build) {
    const { files, identifier } = this.options;
    let bytes;
    try {
      const real = await files.realpath(report.path);
      const problem = kitPathProblem(real, identifier);
      if (problem !== null)
        return { code: "refused", text: `LumiRPEngine named ${report.path} as its tools, whose real path ${real} ${problem}, so it wasn't loaded` };
      const { uid } = files;
      if (uid !== null) {
        for (const dir of kitDirs(real))
          if (!ownersOnly(await files.stat(dir), uid))
            return { code: "unsafe", text: `${dir} can be changed by other users` };
      }
      const file = await files.read(real);
      if (uid !== null && !ownersOnly(file, uid))
        return { code: "unsafe", text: `${real} can be changed by other users` };
      bytes = file.bytes;
    } catch (error) {
      const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
      if (code === "ENOENT" || code === "ENOTDIR")
        return { code: "elsewhere", text: `LumiRPEngine's tools aren't on this machine (${report.path}): this lumirpengine runs on another machine than Lumiverse, so update it there (${NPM_INSTALL})` };
      return { code: "unreadable", text: `LumiRPEngine's tools at ${report.path} can't be read here (${error instanceof Error ? error.message : String(error)}): run lumirpengine as a user who can read Lumiverse's extensions folder` };
    }
    if (await sha256Of(bytes) !== report.sha256)
      return { code: "mismatch", text: `The kit at ${report.path} isn't the one the running LumiRPEngine was built with (its sha256 differs): its files changed since it started, so restart it in Lumiverse's Extensions tab` };
    if (build === this.kit.build)
      return { kit: null };
    let module;
    try {
      module = await import(`data:text/javascript;base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")}`);
    } catch (error) {
      return { code: "broken", text: `LumiRPEngine's tools at ${report.path} didn't load (${error instanceof Error ? error.message : String(error)})` };
    }
    const kit = kitOf(module);
    if (typeof kit === "string")
      return { code: kit.startsWith("it is kit API") ? "kit_api" : "broken", text: `LumiRPEngine's tools at ${report.path} can't be used: ${kit}` };
    if (kit.build !== build)
      return { code: "broken", text: `The kit at ${report.path} says it is build ${kit.build}, and LumiRPEngine says it is build ${build}` };
    return { kit };
  }
  cannot(code, text) {
    this.state = { follows: false, why: { code, text } };
    return false;
  }
}
// package.json
var package_default = {
  name: "lumi-rp-engine",
  version: "0.0.1",
  private: true,
  type: "module",
  bin: {
    lumirpengine: "dist/lumirpengine.js"
  },
  engines: {
    bun: ">=1.4",
    node: ">=22"
  },
  exports: {
    "./studio": "./src/studio-api.ts",
    "./studio-bridge": "./src/shared/studio-bridge.ts",
    "./schemas/lre-world-v1.schema.json": "./schemas/lre-world-v1.schema.json",
    "./schemas/lre-map-v1.schema.json": "./src/shared/lre-map-v1.schema.json"
  },
  scripts: {
    build: "bun scripts/build.ts",
    typecheck: "tsc --noEmit -p . && tsc --noEmit -p dev/preview",
    tables: "bun scripts/tables/build.ts",
    templates: "bun scripts/templates/build.ts",
    reference: "bun scripts/reference/build.ts",
    test: "bun scripts/test/run.ts",
    check: "bun scripts/test/run.ts --check",
    "test:all": "bun scripts/test/run.ts --all",
    "test:release": "bun scripts/test/run.ts --release",
    "test:properties": "bun scripts/test/run.ts --properties",
    "test:timings": "bun scripts/test/run.ts --timings"
  },
  devDependencies: {
    "bun-types": "^1.4.2",
    "lumiverse-spindle-types": "0.6.49",
    typescript: "7.0.2"
  },
  dependencies: {
    preact: "^11.0.1"
  }
};

// src/cli/version.ts
var CLI_NAME = "lumirpengine";
var CLI_VERSION = package_default.version;
var BUILD = "970122a3";
function runtimeCannotFollow(bun) {
  if (bun === undefined)
    return null;
  const [major = 0, minor = 0] = bun.split(".").map(Number);
  return major > 1 || major === 1 && minor >= 4 ? null : `run it with ${RUNTIMES.map((r) => r.needs).join(", or ")} (Bun before 1.4 can't load the kit)`;
}
function versionLine(bun) {
  const cannot = runtimeCannotFollow(bun);
  return `${CLI_NAME} ${CLI_VERSION} (build ${BUILD}, engine ${ENGINE_VERSION}, world format ${WORLD_FORMAT}, agent API ${AGENT_API})${cannot === null ? "" : `; under Bun ${bun ?? ""} it can't follow LumiRPEngine's tools: ${cannot}`}`;
}
var VERSION_LINE = versionLine(process.versions.bun);

// src/cli/mcp.ts
var PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
var WORKFLOW = `Tools for LumiRPEngine (LRE) worlds on the user's Lumiverse: the persistent world simulations their roleplay chats play. Read lre_guide before anything else: the world model, how to work on a world, and the mistakes that are easy to make; look kinds, fields, effects and formulas up with lre_docs. The draft is the user's Build draft: if one is stored before you start, ask them before you touch it. Commit or discard every draft you start; never leave one lying around. These tools follow the LumiRPEngine installed on the user's Lumiverse: when it updates, the tool list changes, and lre_guide says what is new.`;
function instructions(readOnly) {
  return readOnly ? `${WORKFLOW}

This server is read-only: it offers no tool that changes worlds or chats.` : WORKFLOW;
}
var fail = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

class McpServer {
  host;
  constructor(host) {
    this.host = host;
  }
  async handle(message) {
    if (!Array.isArray(message))
      return this.one(message);
    if (message.length === 0)
      return fail(null, -32600, "Invalid Request: an empty batch");
    const replies = (await Promise.all(message.map((m) => this.one(m)))).filter((r) => r !== null);
    return replies.length > 0 ? replies : null;
  }
  async one(message) {
    if (!isRecord(message))
      return fail(null, -32600, "Invalid Request: not a JSON-RPC message");
    const hasId = hasOwn(message, "id");
    const raw = message.id;
    const id = typeof raw === "string" || typeof raw === "number" ? raw : null;
    if (hasId && raw !== null && id === null)
      return fail(null, -32600, "Invalid Request: id must be a string or a number");
    if (typeof message.method !== "string")
      return hasId && (hasOwn(message, "result") || hasOwn(message, "error")) ? null : fail(id, -32600, "Invalid Request: no method");
    if (message.jsonrpc !== "2.0")
      return hasId ? fail(id, -32600, 'Invalid Request: jsonrpc must be "2.0"') : null;
    if (!hasId)
      return null;
    if (raw === null)
      return fail(null, -32600, "Invalid Request: an MCP request's id is a string or a number, never null");
    const params = isRecord(message.params) ? message.params : {};
    const reply = (result) => ({ jsonrpc: "2.0", id, result });
    try {
      switch (message.method) {
        case "initialize": {
          const protocolVersion = PROTOCOL_VERSIONS.find((v) => v === params.protocolVersion) ?? PROTOCOL_VERSIONS[0];
          this.host.initialized?.(isRecord(params.clientInfo) && typeof params.clientInfo.name === "string" ? params.clientInfo.name : null);
          return reply({ protocolVersion, capabilities: { tools: { listChanged: true } }, serverInfo: { name: CLI_NAME, version: CLI_VERSION }, instructions: instructions(this.host.readOnly) });
        }
        case "ping":
          return reply({});
        case "tools/list": {
          const kit = this.host.kit();
          const tools = kit.tools(this.host.readOnly).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations }));
          this.host.listed?.(kit.build);
          return reply({ tools });
        }
        case "tools/call": {
          if (typeof params.name !== "string")
            return fail(id, -32602, "Invalid params: tools/call needs the tool's name");
          await this.host.ready();
          const kit = this.host.kit();
          if (!kit.has(params.name))
            return fail(id, -32602, `Unknown tool: ${params.name}`);
          const result = await kit.call(params.name, params.arguments, this.host.context);
          return reply({ content: [{ type: "text", text: result.text }], ...result.isError ? { isError: true } : {} });
        }
      }
      return fail(id, -32601, `Method not found: ${message.method}`);
    } catch (error) {
      return fail(id, -32603, `Internal error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
function lineServer(server, write) {
  let buffer = "";
  let output = Promise.resolve();
  let initialized = false;
  const working = new Set;
  const send = (message) => {
    output = output.then(() => write(JSON.stringify(message))).catch(() => {
      return;
    });
    return output;
  };
  const take = (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send(fail(null, -32700, "Parse error"));
      return;
    }
    const job = server.handle(message).then((reply) => {
      if (reply === null)
        return;
      const sent = send(reply);
      if (isRecord(message) && message.method === "initialize")
        initialized = true;
      return sent;
    });
    working.add(job);
    job.finally(() => working.delete(job));
  };
  return {
    feed(chunk) {
      buffer += chunk;
      for (let nl = buffer.indexOf(`
`);nl >= 0; nl = buffer.indexOf(`
`)) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line !== "")
          take(line);
      }
    },
    async drain() {
      while (working.size > 0)
        await Promise.all([...working]);
      await output;
    },
    notify(method) {
      if (initialized)
        send({ jsonrpc: "2.0", method });
    }
  };
}

// src/cli/serve.ts
var STALE_MS = 30000;
var EVERY_MS = 60000;
var READY_WAIT_MS = 1e4;
var REAL_CLOCK = {
  now: () => Date.now(),
  every(ms, tick) {
    const timer = setInterval(tick, ms).unref();
    return () => clearInterval(timer);
  }
};

class Queue {
  tails = new Map;
  run(key, work) {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(work, work);
    const tail = result.then(() => {
      return;
    }, () => {
      return;
    });
    this.tails.set(key, tail);
    tail.then(() => {
      if (this.tails.get(key) === tail)
        this.tails.delete(key);
    });
    return result;
  }
}

class McpSession {
  options;
  readOnly;
  context;
  toolsChanged = () => {
    return;
  };
  leave = () => {
    return;
  };
  conn = null;
  follower;
  clock;
  agent = null;
  followable = false;
  harness = null;
  initializedOnce = false;
  listedBuild = null;
  leaving = false;
  looked = Number.NEGATIVE_INFINITY;
  work = Promise.resolve();
  starting = Promise.resolve();
  stopTimer = () => {
    return;
  };
  said;
  constructor(options) {
    this.options = options;
    this.readOnly = options.mcp.readOnly;
    this.clock = options.clock ?? REAL_CLOCK;
    this.follower = new KitFollower(options.bundled, { pin: options.mcp.pin, cannotLoad: options.cannotLoad ?? null, identifier: ENGINE_EXTENSION, files: options.files, where: () => this.conn?.base ?? "your Lumiverse" });
    const queue = new Queue;
    this.context = { readFile: (path) => options.io.readFile(path), readOnly: this.readOnly, connection: () => this.connection(), serialize: (key, work) => queue.run(key, work) };
    this.said = stanceOf(this.checkIn());
  }
  kit() {
    return this.follower.kit;
  }
  checkIn() {
    const { follows, why } = this.follower.state;
    return { serves: "mcp", core: BUILD, kit: this.follower.kit.build, follows, why, host: this.options.host, harness: this.harness, listed: this.listedBuild };
  }
  start() {
    this.stopTimer = this.clock.every(EVERY_MS, () => {
      if (this.followable && this.conn?.isOpen())
        this.look();
    });
  }
  initialized(harness) {
    if (this.initializedOnce)
      return;
    this.initializedOnce = true;
    this.harness = harness;
    this.starting = (async () => {
      try {
        await this.connection().ensureOpen();
      } catch {}
    })();
  }
  listed(build) {
    if (this.listedBuild === build)
      return;
    this.listedBuild = build;
    this.after(() => this.tell());
  }
  async ready() {
    if (this.followable && this.conn?.isOpen() && this.clock.now() - this.looked > STALE_MS)
      this.look();
    let timer;
    await Promise.race([this.work, new Promise((resolve) => timer = setTimeout(resolve, READY_WAIT_MS))]);
    clearTimeout(timer);
  }
  async idle() {
    await this.starting;
    for (let step = this.work;; step = this.work) {
      await step;
      if (step === this.work)
        return;
    }
  }
  close() {
    this.stopTimer();
    this.conn?.close();
  }
  connection() {
    if (this.conn !== null)
      return this.conn;
    const base = this.options.mcp.base();
    const { io } = this.options;
    this.conn = new HostConnection({
      base,
      credentials: () => io.credentials.get(base),
      http: io.http,
      openSocket: io.openSocket,
      client: { name: CLI_NAME, version: CLI_VERSION },
      checkIn: () => this.checkIn(),
      needs: () => this.follower.kit.versions.agentApi,
      onHello: (answer, sent) => {
        if (typeof answer.client === "string")
          this.agent = answer.client;
        if (sent !== null)
          this.said = stanceOf(sent);
        this.looked = this.clock.now();
        this.after(() => this.take(answer));
      },
      onPush: (push) => {
        if (this.agent === null || !("client" in push) || push.client !== this.agent)
          return;
        if (push.type === "lre.kit.reload")
          this.look();
        else if (push.type === "lre.kit.reconnect")
          this.reconnect();
      },
      ...this.options.mcp.timeoutMs !== undefined ? { timeoutMs: this.options.mcp.timeoutMs } : {}
    });
    return this.conn;
  }
  reconnect() {
    const serving = this.follower.kit.build;
    if (this.leaving || this.harness !== LUMIVERSE_HARNESS || this.listedBuild === null || this.listedBuild === serving)
      return;
    this.leaving = true;
    this.options.log(`lumirpengine: exiting, as LumiRPEngine's Reconnect in Lumiverse asked, once the calls in flight are answered: Lumiverse's MCP client holds build ${this.listedBuild}'s tools until it connects again, and on connecting it lists build ${serving}'s`);
    this.leave();
  }
  after(step) {
    this.work = this.work.then(step).catch((error) => this.options.log(`lumirpengine: following LumiRPEngine's tools failed: ${error instanceof Error ? error.message : String(error)}`));
    return this.work;
  }
  look() {
    return this.after(async () => {
      const conn = this.conn;
      if (conn === null || !conn.isOpen())
        return;
      this.looked = this.clock.now();
      let answer;
      try {
        answer = await conn.request("lre.agents", { op: "kit" });
      } catch {
        return;
      }
      if (answer.known === false)
        await conn.checkInAgain();
      else
        await this.take(answer);
    });
  }
  async take(news) {
    this.followable = this.follower.able && "kit" in news && isRecord(news.kit);
    const was = this.follower.kit.build;
    const before = this.follower.state.why?.code ?? null;
    const changed = await this.follower.follow(news);
    if (changed) {
      this.options.log(`lumirpengine: serving the tools of LumiRPEngine build ${this.follower.kit.build} (was build ${was})`);
      this.toolsChanged();
    }
    const { why } = this.follower.state;
    if (why !== null && why.code !== before)
      this.options.log(`lumirpengine: keeping the tools of build ${this.follower.kit.build}: ${why.text}`);
    await this.tell();
  }
  async tell() {
    if (stanceOf(this.checkIn()) !== this.said)
      await this.conn?.checkInAgain();
  }
}
function stanceOf(c) {
  return `${c.kit}\x00${String(c.follows)}\x00${c.why?.code ?? ""}\x00${c.listed ?? ""}`;
}
function serveMcp(session, write, exit = () => {
  return;
}) {
  const line = lineServer(new McpServer(session), write);
  session.toolsChanged = () => line.notify("notifications/tools/list_changed");
  session.leave = () => void line.drain().then(() => {
    session.close();
    exit();
  });
  return line;
}

// src/cli/main.ts
var nodeMajor = Number((process.versions.node ?? "0").split(".")[0]);
if (process.versions.bun === undefined && nodeMajor < 22) {
  process.stderr.write(`lumirpengine needs Bun 1.4 or newer, or Node 22 or newer (this is Node ${process.versions.node}, without the built-in WebSocket and fetch it uses).
`);
  process.exit(1);
}
var files = {
  read(path) {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    }
  },
  write(path, text) {
    mkdirSync(dirname(path), { recursive: true, mode: 448 });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, text, { mode: 384 });
    chmodSync(temp, 384);
    renameSync(temp, path);
  }
};
var http = async (request) => {
  const response = await fetch(request.url, { method: request.method, headers: request.headers, ...request.body !== undefined ? { body: request.body } : {}, redirect: "manual" });
  const text = await response.text();
  return { status: response.status, header: (name) => response.headers.get(name), text };
};
var openSocket = (url, events) => {
  const ws = new WebSocket(url);
  ws.addEventListener("message", (event) => events.message(typeof event.data === "string" ? event.data : String(event.data)));
  ws.addEventListener("close", (event) => events.close(event.code, event.reason));
  ws.addEventListener("error", () => {
    return;
  });
  return { send: (text) => ws.send(text), close: () => ws.close() };
};
function ask(question, hidden) {
  const input = process.stdin;
  if (!input.isTTY)
    return Promise.resolve(null);
  const { promise, resolve } = Promise.withResolvers();
  if (!hidden) {
    const rl = createInterface({ input, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on("SIGINT", () => {
      rl.close();
      resolve(null);
    });
    return promise;
  }
  process.stderr.write(question);
  const typed = [];
  const done = (value) => {
    input.setRawMode(false);
    input.pause();
    input.off("data", key);
    process.stderr.write(`
`);
    resolve(value);
  };
  const key = (chunk) => {
    for (const ch of chunk) {
      if (ch === "\r" || ch === `
`)
        return done(typed.join(""));
      if (ch === "\x03")
        return done(null);
      if (ch === "\x04")
        return done(typed.length > 0 ? typed.join("") : null);
      if (ch === "" || ch === "\b")
        typed.pop();
      else
        typed.push(ch);
    }
  };
  input.setEncoding("utf8");
  input.setRawMode(true);
  input.resume();
  input.on("data", key);
  return promise;
}
var io = {
  out: (text) => process.stdout.write(text.endsWith(`
`) ? text : `${text}
`),
  err: (text) => process.stderr.write(text.endsWith(`
`) ? text : `${text}
`),
  readFile: (path) => readFileSync(path, "utf8"),
  writeFile: (path, text) => writeFileSync(path, text),
  env: process.env,
  stdoutIsTTY: Boolean(process.stdout.isTTY),
  ask,
  credentials: new CredentialStore(files, credentialsPath(process.env, process.platform, homedir())),
  http,
  openSocket
};
var kitFiles = {
  realpath: (path) => realpath(path),
  async stat(path) {
    const entry = await lstat(path);
    return { uid: entry.uid, mode: entry.mode };
  },
  async read(path) {
    const handle = await open(path, "r");
    try {
      const entry = await handle.stat();
      return { uid: entry.uid, mode: entry.mode, bytes: await handle.readFile() };
    } finally {
      await handle.close();
    }
  },
  uid: process.platform === "win32" ? null : process.getuid?.() ?? null
};
var kit = bundledKitOf(await import(new URL(KIT_FILE, import.meta.url).href));
if (typeof kit === "string") {
  process.stderr.write(`lumirpengine's agent kit (${KIT_FILE}, beside ${import.meta.url}) can't run: ${kit}. Install lumirpengine again.
`);
  process.exit(1);
}
var result = await kit.run(process.argv.slice(2), io);
if ("mcp" in result) {
  const session = new McpSession({ bundled: kit, mcp: result.mcp, io, files: kitFiles, host: hostname(), log: (text) => process.stderr.write(`${text}
`), cannotLoad: runtimeCannotFollow(process.versions.bun) });
  const server = serveMcp(session, (line) => {
    const { promise, resolve } = Promise.withResolvers();
    process.stdout.write(`${line}
`, () => resolve());
    return promise;
  }, () => process.exit(0));
  session.start();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => server.feed(chunk));
  process.stdin.on("end", () => {
    server.drain().then(() => session.close());
  });
} else {
  process.exitCode = result.code;
}

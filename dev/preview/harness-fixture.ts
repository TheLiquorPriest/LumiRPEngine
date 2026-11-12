// A chat the harness plays, for the preview (`?engine=harness`): its chips as the engine makes them
// there, the review card of a turn whose changes ask first (the world's document among them), and
// LumiAH's backend as far as the drawer's Harness tab needs one (`HarnessPreview`): a runtime linked
// on this machine, its invented connections (one copied from Lumiverse under its own id, one signed
// in to an account, a local server with no key; none at all with `&connections=none`), its service
// settings and update, its store's state, a timing log, and LumiAH's own settings with their real
// schema (the Timeouts page among them). The lines are worded as the engine and LumiAH word them, so
// the pages are judged on what a player would read.

import { defaultSettings, SETTINGS_SCHEMA, TEXT_DEFS } from "lumi-ah/core";
import { TRANSPORT_KEY, TRANSPORT_SCHEMA, transportDefaults } from "lumi-ah/link";
import { type ChatView, type ConnectionInput, type ConnectionsView, isRecord, type JsonObject, type JsonValue, type LumiverseConnection, type ModelChoice, type ProviderOffer, type RuntimeConnection, type ServiceView, type SettingsView, type SignInProvider, type StoreStateView, type TimingsPage, type UiState, URL_SLOT } from "lumi-ah/shared";
import { renderPrompt } from "../../src/backend/prompts";
import { HARNESS_TEXT } from "../../src/shared/harness-texts";
import type { ReviewCardView } from "../../src/shared/protocol";
import type { Chip } from "../../src/shared/state-view";

/** Why the harness can't be chosen (`?harness=blocked`), as the engine says it of a permission LumiAH lacks (backend/harness/mount.ts, `ready`). */
export const HARNESS_BLOCKED = 'The permission "interceptor" isn\'t granted: LumiRPEngine needs it to see a reply\'s prompt before it is sent. Grant it in Lumiverse (Extensions → LumiRPEngine → Permissions).';

/** The chips only the other engines make: a read of the reply, its gate and its learning, and a swipe's choice. */
const NOT_HARNESS: Partial<Record<Chip["kind"], true>> = { retry: true, swipe_option: true, reread: true, retry_read: true, not_action: true, intent_gate: true, mode_change: true, confirm: true, timelapse_offer: true };

/** The reply whose changes ask first, and its swipe. */
const REVIEW_AT = { messageId: "m4", swipeId: 0 };

/**
 * Why no turn was played for the flagged reply (`?unplayed=`), each as the engine says it: the
 * harness's own texts as shipped (Settings → Prompts → Harness engine), and the ledger's words for a
 * reply stopped in Lumiverse or one the engine lost to a restart (backend/ledger-io.ts).
 */
export const UNPLAYED_WHY = {
  failed: renderPrompt(HARNESS_TEXT.unplayedFailed, {}, { reason: ": the connection answered 429 (too many requests)" }),
  norun: renderPrompt(HARNESS_TEXT.unplayedNoRun, {}, {}),
  stopped: "the reply was stopped",
  restarted: "the engine restarted while this reply was being written",
} as const;

/** A reply's flag that no turn was played for it, as the engine words it (`derivedChips`): on the chat's last reply (`head`) with Regenerate, on an earlier one with nothing to press. */
export function unplayedChip(messageId: string, why: string, head: boolean): Chip {
  const next = head ? " Regenerate to play the turn, or go on: the author of the next harness turn is told, and records what still matters." : "";
  return { id: `unplayed:${messageId}:0`, kind: "degraded", messageId, label: "No turn was played", detail: `This reply was written without the harness's agents: ${why}. Nothing was rolled for it, no time passed, and nothing it tells was recorded.${next}`, actions: head ? [{ id: "regenerate", label: "Regenerate" }] : [], expires: "never" };
}

/** The last reply's flag that it says something against what its turn decided, as the engine words it (`derivedChips`): what the world keeps, then a line for each departure the chronicler noted. */
export function departedChip(messageId: string, lines: readonly string[]): Chip {
  const first = "Where this reply differs from what its turn decided, the world keeps the turn's version, and the author of the next turn is told. Regenerate to play the turn again, or say in your next message how it should go.";
  return { id: `departed:${messageId}:0`, kind: "degraded", messageId, label: "The reply doesn't match the world", detail: [first, ...lines].join("\n"), actions: [{ id: "regenerate", label: "Regenerate" }], expires: "never" };
}

/** The last reply's review chip as the engine stores it (`Review.save`): labelled by the changes still open, with nothing to press once none is. */
export function reviewChip(review: readonly ReviewCardView[]): Chip {
  const open = review.find((card) => card.messageId === REVIEW_AT.messageId && card.swipeId === REVIEW_AT.swipeId)?.items.filter((item) => item.status === "open") ?? [];
  return { id: `review:${REVIEW_AT.messageId}:${String(REVIEW_AT.swipeId)}`, kind: "review", ...REVIEW_AT, label: open.length === 1 ? "1 change to review" : `${String(open.length)} changes to review`, detail: open.flatMap((item) => item.lines).join("\n"), actions: open.length > 0 ? [{ id: "apply", label: "Apply all", style: "primary" }, { id: "reject", label: "No" }] : [], expires: "next_send" };
}

/** The preview chat's chips on the harness: none of a read's, the first reply flagged as unplayed, and the last one's departure flag and review chip. */
export function harnessChips(chips: readonly Chip[], why: string, review: readonly ReviewCardView[]): Chip[] {
  return [unplayedChip("m1", why, false), ...chips.filter((chip) => NOT_HARNESS[chip.kind] !== true), departedChip(REVIEW_AT.messageId, ["The reply has Dev pay for you with a twenty; the world has Dev with no cash on him."]), reviewChip(review)];
}

/** That turn's card: what the author asked of the world's document (`world_commit`, `world_upgrade`, `world_restore`), a person it would add, and a change the turn's own tools staged. */
export function harnessReview(): ReviewCardView[] {
  return [
    {
      turn: `${REVIEW_AT.messageId}:${String(REVIEW_AT.swipeId)}`,
      ...REVIEW_AT,
      placement: "chips",
      items: [
        { key: "d41c9a07", source: "agent", role: "director", changeType: "world_document", lines: ["Commit the world's draft as the world's next revision (Mara's bakery opens on Harbor Street): every new chat of this world starts from it."], status: "open" },
        { key: "7be2f310", source: "agent", role: "director", changeType: "world_document", lines: ["Bring this chat to the head of its world, as it is when this is made (an Upgrade)."], status: "open" },
        { key: "a09d55c2", source: "agent", role: "curator", changeType: "world_document", lines: ["Make the world's draft a copy of revision a1b2c3d4: what the draft holds now is replaced."], status: "open" },
        { key: "3f6a81be", source: "agent", role: "director", changeType: "gm_spawn", lines: ["Add Joss, a courier, at Rosie's Diner."], status: "open" },
        { key: "c2507e94", source: "read", role: "read", changeType: "time_advance", lines: ["20 minutes pass."], status: "open" },
      ],
    },
  ];
}

/** The cards after an answer: the picked changes (all, with none named) applied, or every waiting one turned down. */
export function answerReview(cards: readonly ReviewCardView[], turn: string, answer: { apply: readonly string[] | null } | "reject"): ReviewCardView[] {
  return cards.map((card) =>
    card.turn !== turn
      ? card
      : { ...card, items: card.items.map((item) => (item.status !== "open" ? item : answer === "reject" ? { ...item, status: "rejected" as const } : answer.apply === null || answer.apply.includes(item.key) ? { ...item, status: "applied" as const } : item)) },
  );
}

// ---------------------------------------------------------------- LumiAH's backend, for the Harness tab

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The runtime the preview's chat plays in: linked, on the machine Lumiverse runs on. */
const RUNTIME = { id: "rt-home", name: "home-pc" } as const;

/** Where the preview says LumiRPEngine's copy of the runtime sits: the extension's folder, written as a reader would see it. */
const RUNTIME_FILE = "~/lumiverse/extensions/lumi_rp_engine/dist/lumiah.js";

/** The providers a runtime offers (some of them), as it lists them. */
const PROVIDERS: ProviderOffer[] = [
  { id: "anthropic", name: "Anthropic", auth: ["key", "signin"], apis: ["anthropic-messages"], needsBaseUrl: false },
  { id: "openai", name: "OpenAI", auth: ["key", "signin"], apis: ["openai-responses"], needsBaseUrl: false },
  { id: "deepseek", name: "DeepSeek", auth: ["key"], apis: ["openai-completions"], needsBaseUrl: false },
  { id: "openrouter", name: "OpenRouter", auth: ["key"], apis: ["openai-completions"], needsBaseUrl: false },
  { id: "openai-compatible", name: "OpenAI-compatible", auth: ["key", "none"], apis: ["openai-completions", "openai-responses"], needsBaseUrl: true },
];

/** Each provider's models, as the runtime lists them; a compatible server's are those it serves. */
const MODELS: Readonly<Record<string, ModelChoice[]>> = {
  anthropic: [
    { id: "claude-opus-4-1", name: "Claude Opus 4.1" },
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  openai: [
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 mini" },
  ],
  deepseek: [
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  ],
  openrouter: [{ id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
  "openai-compatible": [{ id: "llama-local", name: "llama-local" }],
};

/**
 * The runtime's connections, invented: Deepseek, copied from Lumiverse under its own id (so the
 * story's choices made on it before keep working) with its key typed again; Claude, signed in to
 * an account; and a server on the same machine that asks for no key. Lumiverse's Deepseek Pro was
 * never copied, so a choice that names it shows as not one of the runtime's.
 */
function inventedConnections(): RuntimeConnection[] {
  return [
    { id: "conn-ds", name: "Deepseek", provider: "deepseek", auth: "key", model: "deepseek-v4-flash", default: true, key: { set: true, last4: "7f3a" } },
    { id: "rc-claude", name: "Claude", provider: "anthropic", auth: "signin", model: "claude-sonnet-4-5", effort: "medium", default: false, key: null, signedIn: true },
    { id: "rc-local", name: "Local llama", provider: "openai-compatible", auth: "none", baseUrl: "http://127.0.0.1:8080/v1", api: "openai-completions", model: "llama-local", default: false, key: null },
  ];
}

/** Lumiverse's own connections, as Copy from Lumiverse lists them (never a key): the loopback among them, as Lumiverse has it; the page leaves it out. The same ones the preview's host lists. */
const LUMIVERSE: LumiverseConnection[] = [
  { id: "conn-loop", name: "LumiRPEngine", provider: "custom", baseUrl: "http://127.0.0.1:7861/v1", model: "lumirpengine" },
  { id: "conn-ds", name: "Deepseek", provider: "deepseek", baseUrl: null, model: "deepseek-v4-flash" },
  { id: "conn-ds-pro", name: "Deepseek Pro", provider: "deepseek", baseUrl: null, model: "deepseek-v4-pro" },
];

/** A refusal as LumiAH's backend sends one, in its words. */
class Refused extends Error {
  constructor(
    readonly code: "unavailable" | "invalid" | "not_found",
    message: string,
  ) {
    super(message);
  }
}

/** A value set at `path` in `values`, the objects on the way made where missing. */
function put(values: JsonObject, path: readonly string[], value: JsonValue): void {
  let at = values;
  for (const key of path.slice(0, -1)) {
    const next = at[key];
    if (!isRecord(next)) at[key] = {};
    at = at[key] as JsonObject;
  }
  const last = path.at(-1);
  if (last !== undefined) at[last] = value;
}

/** A timing log of one end, invented but shaped as LumiAH keeps it: per op, the spread of its times, and the slowest rows. */
function timingsOf(now: number, ops: readonly { op: string; count: number; p50: number; p95: number; max: number; got: number }[]): TimingsPage["extension"] {
  return {
    since: now - 18 * MINUTE,
    rows: ops.reduce((n, o) => n + o.count, 0),
    capacity: 2_000,
    ops: ops.map((o) => ({ op: o.op, road: "link", count: o.count, notOk: 0, ms: { p50: o.p50, p95: o.p95, max: o.max }, waitMs: { p50: Math.round(o.p50 * 0.6), p95: Math.round(o.p95 * 0.8), max: Math.round(o.max * 0.85) }, workMs: { p50: Math.round(o.p50 * 0.4), p95: Math.round(o.p95 * 0.2), max: Math.round(o.max * 0.15) }, sent: 420, got: o.got })),
    slowest: ops.map((o, i) => ({ at: now - (i + 2) * MINUTE, op: o.op, road: "link" as const, sent: 420, got: o.got, ms: o.max, workMs: Math.round(o.max * 0.15), outcome: "ok" as const })).sort((a, b) => b.ms - a.ms),
  };
}

/**
 * LumiAH's backend for the Harness tab, as far as its pages read it here: the hello, the chat, a
 * live view with no turn yet, the runtime's connections (kept here as the runtime keeps them, so
 * adding, editing, testing, making the default and removing show as they would), Lumiverse's own
 * for Copy from Lumiverse, the runtime's service and update, its store, the timing log, and the
 * settings (saved here, so the Timeouts page's controls work). A sign-in, a key and the rest are
 * refused in words that say the preview has no runtime behind them.
 */
export class HarnessPreview {
  private connections: RuntimeConnection[];
  private default: string | null;
  private made = 0;
  /** The settings the user changed, by their place. */
  private own = new Map<string, { path: string[]; value: JsonValue }>();
  private service: ServiceView;

  constructor(
    private readonly chatId: string,
    options: { connections: "set" | "none" } = { connections: "set" },
  ) {
    this.connections = options.connections === "none" ? [] : inventedConnections();
    this.default = this.connections.find((c) => c.default)?.id ?? null;
    this.service = { build: "preview", memory: "1G", memoryNote: null, autoUpdate: true, runs: "systemd", unit: "lumiah-home-pc.service", source: RUNTIME_FILE, installed: "~/.local/share/lumiah/lumiah.js", waiting: null, busy: false, restartNeeded: false, updating: false, problem: null, line: null, handedOver: false, waitingCopy: null, underWay: { replies: 0, requests: 0, jobs: 0, sides: 0 } };
  }

  /** The answer to one of LumiAH's pages' requests, or undefined for a message that isn't one. */
  answer(payload: unknown): unknown {
    if (!isRecord(payload) || !("lah" in payload) || typeof payload.type !== "string" || typeof payload.reqId !== "string") return undefined;
    const { type, reqId } = payload;
    // A request's own fields sit beside its type and reqId, as LumiAH's pages send one (`{ lah, type, reqId, ...body }`), crossed as JSON.
    const body = payload as JsonObject;
    try {
      return { lah: 1, type: "lah.result", reqId, request: type, body: this.result(type, body) };
    } catch (error) {
      const refused = error instanceof Refused ? error : new Refused("unavailable", "The preview has no harness behind these pages, so this one has nothing to show.");
      return { lah: 1, type: "lah.error", reqId, code: refused.code, message: refused.message };
    }
  }

  private result(type: string, body: JsonObject): unknown {
    switch (type) {
      case "lah.hello":
        return this.state();
      case "lah.chat.get":
        return { chat: this.chat() };
      case "lah.live.open":
        return { live: null, next: null };
      case "lah.live.close":
        return { closed: true };
      case "lah.connections.list":
        return this.view();
      case "lah.connections.models": {
        const id = typeof body.connectionId === "string" ? body.connectionId : body.connectionId === null ? this.default : null;
        const provider = typeof body.provider === "string" ? body.provider : (this.connections.find((c) => c.id === id)?.provider ?? null);
        return { models: provider === null ? [] : (MODELS[provider] ?? []) };
      }
      case "lah.connections.lumiverse":
        return { connections: LUMIVERSE };
      case "lah.connections.save":
        return this.save(body);
      case "lah.connections.default": {
        const id = typeof body.id === "string" ? body.id : null;
        if (id !== null && !this.connections.some((c) => c.id === id)) throw new Refused("not_found", "The runtime has no connection of that id.");
        this.default = id;
        return this.view();
      }
      case "lah.connections.remove": {
        this.connections = this.connections.filter((c) => c.id !== body.id);
        if (this.default === body.id) this.default = null;
        return this.view();
      }
      case "lah.connections.test": {
        const c = this.connections.find((x) => x.id === body.id);
        if (c === undefined) throw new Refused("not_found", "The runtime has no connection of that id.");
        return { test: c.auth === "key" && c.key?.set !== true ? { ok: false, ms: 0, error: "It has no key yet: add one, then test it again." } : { ok: true, ms: 640, model: c.model ?? "the provider's own" } };
      }
      case "lah.signin.state": {
        const provider = body.provider === "openai" ? "openai" : "anthropic";
        const signedIn = this.connections.some((c) => c.auth === "signin" && c.provider === provider && c.signedIn === true);
        return { provider: provider satisfies SignInProvider, signedIn, until: signedIn ? Date.now() + 8 * HOUR : null, flow: null, ended: null };
      }
      case "lah.signin.start":
      case "lah.signin.finish":
      case "lah.signin.cancel":
      case "lah.signin.out":
        throw new Refused("unavailable", "The preview has no runtime to sign in from: a sign-in goes from your runtime to the provider.");
      case "lah.runtime.service.get":
        return { service: this.service };
      case "lah.runtime.service.set":
        if (typeof body.memory === "string") this.service = { ...this.service, memory: body.memory };
        if (typeof body.autoUpdate === "boolean") this.service = { ...this.service, autoUpdate: body.autoUpdate };
        return { service: this.service, restart: typeof body.memory === "string" ? "restarting" : "none" };
      case "lah.runtime.update.apply":
        throw new Refused("unavailable", "The preview's runtime already runs this build: there is nothing to update.");
      case "lah.runtime.store":
        return { state: this.store() };
      case "lah.timings.get":
        return this.timings();
      case "lah.settings.set":
        return { settings: this.settingsSet(body) };
      default:
        throw new Refused("unavailable", "The preview has no harness behind these pages, so this one has nothing to show.");
    }
  }

  /** What LumiAH's pages hold after a first hello: this chat on the harness in the linked runtime, the key minted and the loopback connection made, nothing played yet. */
  private state(): UiState {
    const now = Date.now();
    return {
      rev: 1,
      runtime: {
        build: "preview",
        link: 2,
        model: "lumirpengine",
        relays: [{ id: RUNTIME.id, name: RUNTIME.name, build: "preview", host: "home-pc", url: "http://127.0.0.1:7861/v1", registeredAt: now - 3 * DAY, seenAt: now - 20_000, link: "linked", problem: null, update: false, turns: 0, unit: this.service.unit, session: { valid: true, endsAt: new Date(now + 20 * DAY).toISOString() }, scheduler: "unavailable", lines: { update: null, login: null } }],
        start: { service: `bun ${RUNTIME_FILE} up --url ${URL_SLOT} --extension lumi_rp_engine --systemd`, foreground: `bun ${RUNTIME_FILE} up --url ${URL_SLOT} --extension lumi_rp_engine`, missing: [] },
        issues: [],
        ready: true,
        selfUpdate: true,
        switchedBy: "LumiRPEngine",
        road: {
          granted: false,
          offer: 'Granting LumiRPEngine the permission "cors_proxy" (Extensions → LumiRPEngine → Permissions; only an owner or an admin can) lets its pages, and the tools of an extension that builds it in, reach a runtime on this machine through Lumiverse\'s own proxy, so a request doesn\'t wait behind a reply\'s or a job\'s traffic on the link. Without it everything still works over the link.',
          relays: { [RUNTIME.id]: { road: "link", why: 'LumiRPEngine doesn\'t hold the permission "cors_proxy".', at: null } },
        },
      },
      setup: { steps: [{ id: "permissions", done: true }, { id: "chat", done: true }, { id: "reply", done: true }] },
      key: { set: true, print: "c41f·09ab", at: now - 3 * DAY },
      chats: [this.chat()],
      running: [],
      connections: [
        { id: "conn-loop", name: "LumiRPEngine", provider: "custom", model: "lumirpengine", loopback: true },
        { id: "conn-ds", name: "Deepseek", provider: "deepseek", model: "deepseek-v4-flash", loopback: false },
        { id: "conn-ds-pro", name: "Deepseek Pro", provider: "deepseek", model: "deepseek-v4-pro", loopback: false },
      ],
      settings: this.settings(),
      texts: { defs: [...TEXT_DEFS], own: {} },
      approvals: [],
      jobs: { active: [], off: false, paused: false, changed: 0 },
      notices: [],
      defs: 0,
      permissions: [],
    };
  }

  /** The preview's chat as LumiAH has it: switched on, pinned to the loopback connection, played in the linked runtime. */
  private chat(): ChatView {
    return { chatId: this.chatId, name: "Maple · Maple Falls", on: true, since: Date.now() - HOUR, connection: { id: "conn-loop", name: "LumiRPEngine", loopback: true }, runtime: RUNTIME };
  }

  /** The runtime's connections as a list answers them. */
  private view(): ConnectionsView {
    return { connections: this.connections.map((c) => ({ ...c, default: c.id === this.default })), default: this.default, providers: PROVIDERS, relay: RUNTIME };
  }

  /** A connection saved as the runtime saves one: a new one under the id given (Copy from Lumiverse keeps Lumiverse's), else a new id; of a key only that one is set and its last four characters. The first one made is the default. */
  private save(body: JsonObject): { saved: RuntimeConnection; view: ConnectionsView } {
    const input = body.connection as unknown as ConnectionInput;
    const key = typeof body.key === "string" && body.key !== "" ? body.key : null;
    const before = input.id !== undefined ? this.connections.find((c) => c.id === input.id) : undefined;
    if (input.id !== undefined && before === undefined && body.create !== true) throw new Refused("not_found", "The runtime has no connection of that id.");
    const id = input.id ?? `rc-${(this.made += 1)}`;
    const saved: RuntimeConnection = {
      id,
      name: input.name,
      provider: input.provider,
      auth: input.auth,
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.api ? { api: input.api } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      default: false,
      key: input.auth === "key" ? (key !== null ? { set: true, last4: key.length >= 12 ? key.slice(-4) : null } : (before?.key ?? { set: false, last4: null })) : null,
      ...(input.auth === "signin" ? { signedIn: false } : {}),
    };
    this.connections = before !== undefined ? this.connections.map((c) => (c.id === id ? saved : c)) : [...this.connections, saved];
    this.default ??= id;
    return { saved: { ...saved, default: this.default === id }, view: this.view() };
  }

  /** The runtime's working store, as its section shows it: holding the mirror, nothing waiting. */
  private store(): StoreStateView {
    return { open: true, mode: "held", holder: RUNTIME.name, lost: null, waiting: 0, behindSince: null, lastError: null, lastSent: Date.now() - 5_000, bytes: 3_482_112, counting: false, takeover: null, refused: [] };
  }

  /** The timing log: the asks this extension sent the runtime, and the requests the runtime's link sent this extension, as a preparation leaves them. */
  private timings(): TimingsPage {
    const now = Date.now();
    return {
      extension: timingsOf(now, [
        { op: "workspace.read", count: 128, p50: 34, p95: 190, max: 610, got: 22_400 },
        { op: "workspace.write", count: 41, p50: 52, p95: 240, max: 720, got: 160 },
        { op: "jobs.list", count: 36, p50: 28, p95: 95, max: 180, got: 9_800 },
      ]),
      runtimes: [{ id: RUNTIME.id, name: RUNTIME.name, timings: timingsOf(now, [{ op: "tool.call", count: 96, p50: 210, p95: 1_900, max: 4_200, got: 3_100 }, { op: "turn.commit", count: 4, p50: 380, p95: 900, max: 900, got: 120 }]), problem: null }],
    };
  }

  /** LumiAH's settings as its backend holds them: the core's and the transport's sections, with their real schemas and defaults, under what the user changed. */
  private settings(): SettingsView {
    const defaults: JsonObject = { core: JSON.parse(JSON.stringify(defaultSettings())) as JsonObject, [TRANSPORT_KEY]: transportDefaults() };
    const values = structuredClone(defaults);
    for (const { path, value } of [...this.own.values()].sort((a, b) => a.path.length - b.path.length)) put(values, path, value);
    return { values, defaults, schema: { type: "object", additionalProperties: false, properties: { core: SETTINGS_SCHEMA, [TRANSPORT_KEY]: TRANSPORT_SCHEMA } } };
  }

  /** A change of the settings: each value set at its place, each place reset back to its default. */
  private settingsSet(body: JsonObject): SettingsView {
    const reset = Array.isArray(body.reset) ? body.reset.filter((p): p is string[] => Array.isArray(p) && p.every((k) => typeof k === "string")) : [];
    for (const path of reset) for (const key of [...this.own.keys()]) if (key === path.join("\n") || key.startsWith(`${path.join("\n")}\n`)) this.own.delete(key);
    for (const entry of Array.isArray(body.set) ? body.set : []) {
      if (!isRecord(entry) || !Array.isArray(entry.path) || entry.value === undefined) continue;
      const path = entry.path.filter((k): k is string => typeof k === "string");
      this.own.set(path.join("\n"), { path, value: entry.value as JsonValue });
    }
    return this.settings();
  }
}

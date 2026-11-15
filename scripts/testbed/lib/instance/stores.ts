// Item 3's stores that the play steps (`steps/*.ts`) leave empty, each made by play on today's
// build in the instance user's storage, the way a player and the pages make them: the page's own
// request for each thing, the CLI where the page has none, Lumiverse's own REST calls for what is
// Lumiverse's. Every part runs once (`ctx.log.once`, or a recorded `stores:*` key where a part may
// have nothing to act on yet), logs each change, and makes no model call except through ordinary
// play: turns on the run's own connection (`LRE_CONNECTION_NAME`), the chats' agents in today's runtime.
//
// "Today" is RPE's `main` (3b318f02) with LumiAH 6a38779a and Lumiverse a70f4ed2; every file:line
// below is on those (LumiAH paths start `LumiAH`, Lumiverse's `Lumiverse`, the rest are RPE's).
// Where each step runs in the order is `STORE_STEP_AFTER`: all after the play steps' last (`harness`).
//
// The chats these steps make are their own (`stores:chat:<key>`), never the play steps' chats, so
// no store those steps left (a staged tap waiting, a review card left open, a pause) is touched.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Ctx, Step } from "../context";
import { guard, IDENTIFIER, userStorage } from "../env";
import type { Json } from "../record";
import { say } from "../record";
import { cardOf, PLAYER } from "../../steps/chats";
import { worldIdOf } from "../../steps/world";
import { ledgerOf } from "./rows";

/** How long a turn's engine run, a reply, a job or an extension restart is waited for (as `lib/play.ts` waits a turn). */
const WAIT_MS = 30 * 60_000;
const POLL_MS = 4_000;

type Engine = "classic" | "agents" | "harness";

/** An id the set-up steps recorded (`connection:main`, `user:other`, …): a string, or a record holding one as `id`. */
export function recordedId(ctx: Ctx, key: string): string {
  const value = ctx.log.get<Json>(key);
  const id = typeof value === "string" ? value : value !== null && typeof value === "object" && !Array.isArray(value) && typeof value.id === "string" ? value.id : undefined;
  if (id === undefined || id === "") throw new Error(`${key} isn't recorded: the set-up steps run first`);
  return id;
}

/**
 * A world chat of these steps', remembered as `stores:chat:<key>`: an invented chat on the test card,
 * the test world attached (the CLI's `attach`, which sets a new world chat to the harness, as
 * `steps/chats.ts` says) and then its engine through GM → This chat → Engine (`lre.chat.knowledge
 * {engine}`, `src/backend/dispatch.ts:844-868`), as the chats step makes its three.
 */
async function storesChat(ctx: Ctx, key: string, name: string, engine: Engine): Promise<string> {
  const stateKey = `stores:chat:${key}`;
  const known = ctx.log.get<string>(stateKey);
  if (known !== undefined) {
    await ctx.host.chat(guard(ctx.env, known));
    return known;
  }
  const cardId = await cardOf(ctx);
  const worldId = await worldIdOf(ctx, false);
  const chat = await ctx.host.createChat(cardId, name);
  ctx.log.set(stateKey, guard(ctx.env, chat.id));
  ctx.log.log({ step: "stores", action: "created", kind: "chat", id: chat.id, name, detail: { cardId } });
  await ctx.cli.run(["attach", worldId, chat.id]);
  ctx.log.log({ step: "stores", action: "changed", kind: "chat run (world attached)", id: chat.id, detail: { worldId } });
  const asked = await ctx.socket.lre<{ engine?: string }>("lre.chat.knowledge", { chatId: chat.id, engines: true });
  if ((asked.engine ?? "classic") !== engine) {
    const set = await ctx.socket.lre<{ engine?: string }>("lre.chat.knowledge", { chatId: chat.id, engine: engine === "classic" ? null : engine });
    ctx.log.log({ step: "stores", action: "changed", kind: "chat engine (chat metadata prefs.engine)", id: chat.id, detail: { engine: set.engine ?? "classic" } });
  }
  return chat.id;
}

function chatId(ctx: Ctx, key: string): string {
  const id = ctx.log.get<string>(`stores:chat:${key}`);
  if (id === undefined) throw new Error(`stores:chat:${key} isn't made yet`);
  return guard(ctx.env, id);
}

interface View {
  status: string;
  pending: unknown[];
  chips: { id: string; kind: string }[];
  hud: { fixes?: { time?: { value?: string } } } | null;
}

/** A chat's state view and activity line (`lre.state.get`, `src/backend/dispatch.ts:738-744`): a read only. */
async function viewOf(ctx: Ctx, id: string): Promise<{ view: View; activity: { state: string; label: string } | null }> {
  return ctx.socket.lre<{ view: View; activity: { state: string; label: string } | null }>("lre.state.get", { chatId: id });
}

/** Settings, as `lre.settings.get` answers them (`src/backend/dispatch.ts:786-808`): only what these steps set. */
interface Settings {
  modelUse: { steps: { [purpose: string]: { enabled?: boolean; route?: { connectionId?: string | null } } | undefined } };
  narrator: { knowledge: string; secrets: string };
  tidy: { findings: number };
  minds: { knowledge: { enabled: boolean; threshold: number } };
  agents: { persist: { on: boolean }; compaction: { atTokens: number; keepTurns: number } };
}

/** Settings → its pages' patch, through the CLI's `settings-set` as `steps/settings.ts` sends it, then Settings read back. */
async function patchSettings(ctx: Ctx, patch: { [key: string]: Json }): Promise<Settings> {
  await ctx.cli.run(["settings-set", "--patch", JSON.stringify(patch)]);
  return (await ctx.socket.lre<{ settings: Settings }>("lre.settings.get")).settings;
}

// ---------------------------------------------------------------------------------------------
// Settings at the user's level, and model choices naming Lumiverse connections.

/** The user's own choices, each away from today's default so the carry has something to carry. */
export const USER_SETTINGS = {
  // The narrator's view of secrets (Settings → Narrator): today's default is scene and marked (`src/shared/settings.ts:489`).
  narrator: { knowledge: "pov", secrets: "omit" },
  // How many Tidy up findings one run shows: 50 by default, 1 to 500 (`src/shared/settings.ts:703-705`).
  tidy: { findings: 20 },
  // Knowledge tracking on, with its threshold: on and 0.7 by default (`src/shared/minds.ts:434-437,469`).
  minds: { knowledge: { enabled: true, threshold: 0.6 } },
} as const;

/**
 * Settings changed at the user's level (Settings → Narrator, GM → Things → Tidy up, Settings → Minds →
 * Knowledge). After `harness`: the narrator's view and the knowledge threshold change how a later
 * turn is told and recorded, and the play steps must play as before.
 */
export const storesUserSettings: Step = {
  name: "stores-user-settings",
  makes: "the user's own narrator view of secrets, Tidy up's findings and the knowledge threshold (settings.json)",
  async run(ctx) {
    await ctx.log.once("stores:user-settings", async () => {
      const after = await patchSettings(ctx, USER_SETTINGS as unknown as { [key: string]: Json });
      const took = after.narrator.knowledge === USER_SETTINGS.narrator.knowledge && after.narrator.secrets === USER_SETTINGS.narrator.secrets && after.tidy.findings === USER_SETTINGS.tidy.findings && after.minds.knowledge.enabled && after.minds.knowledge.threshold === USER_SETTINGS.minds.knowledge.threshold;
      if (!took) throw new Error(`the user's settings didn't take: ${JSON.stringify({ narrator: after.narrator, tidy: after.tidy, knowledge: after.minds.knowledge })}`);
      ctx.log.log({ step: "stores", action: "changed", kind: "settings (settings.json)", id: "narrator", detail: after.narrator });
      ctx.log.log({ step: "stores", action: "changed", kind: "settings (settings.json)", id: "tidy.findings", detail: after.tidy.findings });
      ctx.log.log({ step: "stores", action: "changed", kind: "settings (settings.json)", id: "minds.knowledge", detail: after.minds.knowledge });
    });
  },
};

/**
 * Two model choices that name a Lumiverse connection, in settings no step's play reaches, so the one
 * RPE will have no match for is never called. Build jobs' model is the Brief step's route
 * (`src/backend/jobs.ts:488`), and no step starts a Build job that calls a model (the world step's
 * Check world needs none, `steps/world.ts:74`); Brief is off unless saved on (`src/shared/settings.ts:
 * 154-159`; the Standard preset has no Brief step, `src/backend/settings-store.ts:91-102`). The time
 * skip's step is off in the Standard preset and runs only on a timelapse (`settings-store.ts:99`),
 * which no step plays. A saved route replaces the preset's whole (`settings-store.ts:414-421`).
 */
export const storesModels: Step = {
  name: "stores-models",
  makes: "model choices naming connection:main (Build jobs' model) and connection:unmatched (the time skip's)",
  async run(ctx) {
    await ctx.log.once("stores:models", async () => {
      const main = recordedId(ctx, "connection:main");
      const unmatched = recordedId(ctx, "connection:unmatched");
      const after = await patchSettings(ctx, {
        modelUse: {
          steps: {
            brief: { enabled: false, signals: [], route: { provider: "helper", connectionId: main } },
            skip: { enabled: false, signals: ["timelapse"], route: { provider: "helper", connectionId: unmatched, effort: "off" } },
          },
        },
      });
      const brief = after.modelUse.steps.brief;
      const skip = after.modelUse.steps.skip;
      if (brief?.route?.connectionId !== main || brief.enabled !== false) throw new Error(`Build jobs' model didn't take: ${JSON.stringify(brief ?? null)}`);
      if (skip?.route?.connectionId !== unmatched || skip.enabled !== false) throw new Error(`the time skip's model didn't take: ${JSON.stringify(skip ?? null)}`);
      ctx.log.log({ step: "stores", action: "changed", kind: "model choice naming a Lumiverse connection (settings.json)", id: "modelUse.steps.brief.route", detail: { connection: "connection:main" } });
      ctx.log.log({ step: "stores", action: "changed", kind: "model choice naming a Lumiverse connection (settings.json)", id: "modelUse.steps.skip.route", detail: { connection: "connection:unmatched" } });
    });
  },
};

// ---------------------------------------------------------------------------------------------
// The agents engine: a chat's own choices, its map display, its kept scene and a pending rollback.

const KEPT = "kept";
const KEPT_NAME = "Port Alder test · agents, kept";
/** This chat's own choices (GM → This chat → Knowledge and Things): each a part `lre.chat.knowledge` keeps in its metadata. */
export const KEPT_CHOICES = { knowledge: true, narrator: { knowledge: "pov", secrets: "marked" }, tidy: false } as const;
/** How its map shows (GM's map, `lre.map`): the world's own is knowledge (`steps/world-parts.ts`). */
export const KEPT_MAP = "fog";
/** The agents engine's settings that make a compaction and a kept scene on this chat's turns: Smart persistence on (off by default, `src/shared/agent-settings.ts:418-419`), and a compaction past the first token keeping no turn whole (32,000 and 3 by default, `:425`; at least 1 and 0, `:563-565`). */
export const KEPT_AGENTS = { agents: { persist: { on: true }, compaction: { atTokens: 1, keepTurns: 0 } } } as const;
const KEPT_TURNS = [
  "Before work I walk down to the marina and ask Dale whether the Harbor Watch logbook needs signing tonight.",
  "I sign the logbook, thank Dale and walk up Harbor Street towards Alder Automotive.",
  "On the way I stop at the Bluebird and buy a coffee to take to the shop.",
];

/**
 * One agents-engine chat of its own, after the agents step (its turns play under the compaction and
 * Smart persistence settings this sets, which the agents chat's turns must not). Its own choices
 * (`src/backend/dispatch.ts:844-868`, kept in chat metadata `prefs`) and its map display
 * (`dispatch.ts:837-842` → `runs/<chat>/prefs.json`, `src/backend/chat-prefs.ts:66-82`) are set
 * before its turns. Its turns keep Smart persistence's last scene (`src/backend/agents/persist.ts:
 * 208-218` → `runs/<chat>/scene.json`, `chat-prefs.ts:43-51`) and compact the main agent's session;
 * then GM → Workspace's Roll back asks for the latest compaction's rollback (`lre.workspace
 * rollback`, `src/shared/protocol.ts:1098`; `src/backend/agents/compaction.ts:275-276`), which stays
 * pending in chat metadata `agents.rollback` (`src/backend/chat-agent-meta.ts:36-48`) until the next
 * agent turn: none follows.
 */
export const storesKept: Step = {
  name: "stores-kept",
  makes: "an agents chat with its own knowledge, narrator and tidy choices, its map display, a kept scene and a pending compaction rollback",
  async run(ctx) {
    await ctx.log.once("stores:kept:chat", async () => {
      const id = await storesChat(ctx, KEPT, KEPT_NAME, "agents");
      const set = await ctx.socket.lre<{ knowledge: boolean | null; narrator: Json; tidy?: boolean }>("lre.chat.knowledge", { chatId: id, ...KEPT_CHOICES });
      if (set.knowledge !== true || set.tidy !== false) throw new Error(`the chat's own choices didn't take: ${JSON.stringify(set)}`);
      ctx.log.log({ step: "stores", action: "changed", kind: "chat's own choices (chat metadata prefs)", id, detail: { knowledge: set.knowledge, narrator: set.narrator, tidy: set.tidy ?? null } });
      const shown = await ctx.socket.lre<{ display?: string }>("lre.map", { chatId: id, display: KEPT_MAP });
      if (shown.display !== KEPT_MAP) throw new Error(`the map display didn't take: ${JSON.stringify(shown)}`);
      ctx.log.log({ step: "stores", action: "changed", kind: "map display (runs/<chat>/prefs.json)", id, detail: { display: KEPT_MAP } });
    });
    await ctx.log.once("stores:kept:settings", async () => {
      const after = await patchSettings(ctx, KEPT_AGENTS as unknown as { [key: string]: Json });
      const want = KEPT_AGENTS.agents.compaction;
      if (!after.agents.persist.on || after.agents.compaction.atTokens !== want.atTokens || after.agents.compaction.keepTurns !== want.keepTurns) throw new Error(`the agents engine's settings didn't take: ${JSON.stringify(after.agents)}`);
      ctx.log.log({ step: "stores", action: "changed", kind: "settings (settings.json)", id: "agents.persist.on", detail: true });
      ctx.log.log({ step: "stores", action: "changed", kind: "settings (settings.json)", id: "agents.compaction", detail: want });
    });
    const id = chatId(ctx, KEPT);
    const rollback = async (): Promise<string> => (await ctx.socket.lre<{ session?: { rollback: string } }>("lre.workspace", { chatId: id, op: "session" })).session?.rollback ?? "none";
    await ctx.log.once("stores:kept:turns", async () => {
      await ctx.player.show(id);
      for (const text of KEPT_TURNS) {
        if ((await rollback()) !== "none") break;
        await ctx.player.turn(id, PLAYER, text);
      }
      const now = await rollback();
      if (now === "none") throw new Error(`no compaction to roll back after ${KEPT_TURNS.length} turns`);
      if (!existsSync(join(userStorage(ctx.env, ctx.userId), "runs", id, "scene.json"))) throw new Error("the agents engine kept no scene for the chat (runs/<chat>/scene.json)");
      ctx.log.log({ step: "stores", action: "created", kind: "kept scene (runs/<chat>/scene.json)", id, detail: { rollback: now } });
    });
    await ctx.log.once("stores:kept:rollback", async () => {
      if ((await rollback()) !== "pending") await ctx.socket.lre("lre.workspace", { chatId: id, op: "rollback" });
      const now = await rollback();
      if (now !== "pending") throw new Error(`the rollback isn't pending (${now})`);
      ctx.log.log({ step: "stores", action: "created", kind: "pending compaction rollback (chat metadata agents.rollback)", id });
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Held writes left open in a journal.

const HELD = "held";
const HELD_NAME = "Port Alder test · classic, held";
const HELD_TURN = "I knock on the marina office door and ask Dale whether tonight's round still needs a volunteer.";
/** The rest label of a turn the engine prepared that no page shows the chat to start (`src/shared/diagnostics.ts:324`; `src/backend/ledger-io.ts:2068-2069`). */
const READY_REOPEN = "Ready; reopen the chat to continue";

/**
 * A ✎ fix held open in a journal. `steps/pause.ts`'s `pause:held` holds none: a write to a paused chat
 * is refused at once and kept nowhere (`src/engine/ledger/journal.ts:1572`). A write is held while a
 * window is open (`journal.ts:1573-1576`); a turn the engine prepared opens its pre-reply window
 * (`journal.ts:621-627`) and holds the writes made meanwhile (`src/backend/ledger-io.ts:2188,2206`),
 * and it waits, at no age limit (`ledger-io.ts:1058-1061`), for a page showing the chat to start its
 * reply (`ledger-io.ts:2053-2071`). So: a classic chat of its own, a turn sent over REST as Lumiverse's
 * page sends it while this page shows another chat, and once the engine rests on "reopen the chat",
 * the clock's ✎ (`lre.fix {time}`, `dispatch.ts:549-556`). Nothing opens the chat again (only a hello
 * or `lre.page` naming it would start the reply, `ledger-io.ts:1328-1335`), so the write stays held,
 * persisted with the journal (`ledger-io.ts:2597`, `:2639-2644`). The engine's turn is ordinary play:
 * its steps call the run's own connection.
 */
export const storesHeld: Step = {
  name: "stores-held",
  makes: "a classic chat whose prepared turn waits for a page, with a ✎ fix held open in its journal",
  async run(ctx) {
    await ctx.log.once("stores:held:chat", async () => {
      await storesChat(ctx, HELD, HELD_NAME, "classic");
    });
    const id = chatId(ctx, HELD);
    await ctx.log.once("stores:held:prepared", async () => {
      const user = await ctx.host.send(id, PLAYER, HELD_TURN);
      ctx.log.log({ step: "stores", action: "created", kind: "message", id: user.id, detail: { chatId: id, user: true } });
      await ctx.host.generate(id, "normal", ctx.connectionId);
      const began = Date.now();
      for (;;) {
        if (Date.now() - began > WAIT_MS) throw new Error("the engine never rested on its prepared turn");
        await Bun.sleep(POLL_MS);
        const { activity } = await viewOf(ctx, id);
        if (activity?.state === "failed") throw new Error(`the engine's run failed: ${activity.label}`);
        if (activity?.state === "running" && activity.label === READY_REOPEN) break;
      }
      ctx.log.log({ step: "stores", action: "played", kind: "turn prepared, its reply never started (pre-reply window)", id, detail: { message: user.id } });
    });
    await ctx.log.once("stores:held:write", async () => {
      const clock = (await viewOf(ctx, id)).view.hud?.fixes?.time?.value;
      if (clock === undefined) throw new Error("the chat's HUD offers no clock to fix");
      const at = new Date(`${clock.replace(" ", "T")}:00Z`);
      at.setUTCMinutes(at.getUTCMinutes() + 10);
      const time = at.toISOString().slice(0, 16).replace("T", " ");
      const answer = await ctx.socket.lre<{ pending?: boolean }>("lre.fix", { chatId: id, time });
      if (answer.pending !== true) throw new Error(`the ✎ fix wasn't held: ${JSON.stringify(answer)}`);
      const held = (await viewOf(ctx, id)).view.pending.length;
      if (held === 0) throw new Error("the journal holds no write");
      ctx.log.set("stores:held", { chat: `stores:chat:${HELD}`, time });
      ctx.log.log({ step: "stores", action: "created", kind: "held write left open (journal held)", id, detail: { time, held } });
    });
  },
};

// ---------------------------------------------------------------------------------------------
// The harness engine: learned/, upkeep, approvals, a chat's own places, a reply with no turn played.

const CUT = "cut";
const CUT_NAME = "Port Alder test · harness, cut short";
/** A file of the chat's learned area, as Harness → Workspace writes one (`learned/` in agents' paths, LumiAH `core/workspace.ts:180`). */
export const LEARNED_FILE = { path: "harbor-watch.md", text: "The Harbor Watch walks its round at eight in the evening and signs the logbook in the marina office." };

/**
 * A harness chat of its own, opened as a page opens it (`lre.hello`, which sets a chat the harness
 * plays to its runtime, `src/backend/dispatch.ts:405-406`); then the harness pages' own writes:
 * Harness → Workspace's write to the chat's learned area (`lah.ws.write`, LumiAH
 * `src/shared/ui.ts:1535,1789`, `extension/backend/ui.ts:553-556` → `docs/chats/<c>/learned.json`,
 * `core/workspace.ts:313-330`), and Harness → Upkeep opened, whose first read writes `upkeep.json`
 * (`lah.upkeep.get`, LumiAH `core/upkeep.ts:296-300,419-428`).
 */
export const storesHarnessPages: Step = {
  name: "stores-harness-pages",
  makes: "a harness chat of its own, a file in its learned/ area, and the upkeep record (Harness → Workspace, Harness → Upkeep)",
  async run(ctx) {
    await ctx.log.once("stores:cut:chat", async () => {
      await storesChat(ctx, CUT, CUT_NAME, "harness");
    });
    const id = chatId(ctx, CUT);
    await ctx.log.once("stores:learned", async () => {
      await ctx.player.show(id);
      const area = await ctx.socket.lah<{ files?: { path: string }[] }>("lah.ws.list", { chatId: id, area: "learned" });
      if (!(area.files ?? []).some((f) => f.path.endsWith(LEARNED_FILE.path))) {
        const written = await ctx.socket.lah<{ file: { path: string; hash: string } }>("lah.ws.write", { chatId: id, area: "learned", path: LEARNED_FILE.path, text: LEARNED_FILE.text, base: null });
        ctx.log.log({ step: "stores", action: "created", kind: "harness learned/ file (docs/chats/<chat>/learned.json)", id: written.file.path, detail: { chatId: id } });
      }
    });
    await ctx.log.once("stores:upkeep", async () => {
      const upkeep = await ctx.socket.lah<{ total?: Json }>("lah.upkeep.get", {});
      ctx.log.log({ step: "stores", action: "created", kind: "harness upkeep record (docs/upkeep.json)", id: "upkeep.json", detail: { total: upkeep.total ?? null } });
    });
  },
};

/**
 * The chat's own working draft of its world is written only by the author's world tools in a turn
 * (`world_place`, `world_path`, `world_map`…: `src/backend/agents/tools/harness-tools/world-kit.ts:279`,
 * gated to the game master's tier, `src/backend/agents/tools/harness.ts:112`, which the author holds,
 * `src/backend/harness/definitions/index.ts:225-227`); no page request writes `engine.world`
 * (`src/engine/world-draft.ts:34`; no other writer on main). The player asks for it in the turn's words.
 */
const PLACES_TURN = "I walk out to Pier 3, where the township has just put up a net loft. (Out of character: please add the net loft to this chat's own world with your world tools: the place itself, a path to it from the marina, and a small map of the pier.)";
const CUT_TURN = "I walk along the breakwater to watch the evening boats come in, and wave to Dale on the fuel dock.";

/** How many `engine.world` events the chat's records hold, in their events and their post entries (Lumiverse's own read of the messages). */
async function draftEvents(ctx: Ctx, id: string): Promise<number> {
  let n = 0;
  for (const m of await ctx.host.messages(id)) {
    const ledger = ledgerOf((m.extra as { spindle_metadata?: { [key: string]: unknown } } | undefined)?.spindle_metadata);
    for (const rec of Object.values(ledger?.swipes ?? {})) n += [...(rec.events ?? []), ...(rec.post ?? []).flatMap((p) => p.events ?? [])].filter((e) => e.type === "engine.world").length;
  }
  return n;
}

/** A harness tier whose tool calls wait for the player's word while a turn of this step runs: LumiAH's write tier (LumiAH `src/shared/ui.ts:1562,1803`; tiers default to allow, `core/settings.ts:417`). */
const APPROVAL_TIER = "write";

/**
 * Answers each approval a run of chat `id` waits on with "this chat", as Harness → Tools' approval
 * card does (`lah.approval.answer`, LumiAH `src/shared/ui.ts:1477,1769`), reading the waiting ones
 * where the page reads them (`lah.hello`'s approvals, LumiAH `approvals.ts:54-74`). Only "chat"
 * leaves a record (`core/approval.ts:123-127` → `docs/chats/<c>/approvals.json`). Stop resolves to
 * the tools approved.
 */
function approveForChat(ctx: Ctx, id: string): () => Promise<string[]> {
  const tools = new Set<string>();
  let on = true;
  const loop = (async () => {
    while (on) {
      const state = await ctx.socket.lah<{ approvals?: { id: string; chatId: string; tool: string }[] }>("lah.hello", {});
      for (const ask of (state.approvals ?? []).filter((a) => a.chatId === id)) {
        const answer = await ctx.socket.lah<{ answered: boolean }>("lah.approval.answer", { id: ask.id, answer: { decision: "chat" } });
        if (!answer.answered) continue;
        tools.add(ask.tool);
        ctx.log.log({ step: "stores", action: "changed", kind: "harness approval answered for this chat (docs/chats/<chat>/approvals.json)", id: ask.tool, detail: { chatId: id } });
      }
      await Bun.sleep(2000);
    }
  })();
  return async () => {
    on = false;
    await loop;
    return [...tools];
  };
}

/** Waits until the chat's jobs (the author's after its reply) are no longer queued or running, as `steps/harness.ts` waits. */
async function settleJobs(ctx: Ctx, id: string): Promise<void> {
  for (const began = Date.now(); Date.now() - began < WAIT_MS; await Bun.sleep(10_000)) {
    const page = await ctx.socket.lah<{ jobs: { state: string }[] }>("lah.jobs.list", { chatId: id, cursor: null, limit: 40 });
    if (!page.jobs.some((j) => j.state === "queued" || j.state === "running")) return;
  }
  say("  jobs still run; going on without them");
}

/**
 * A whole harness turn on the chat: its write-tier tool calls wait for the player's word (Harness →
 * Tools, `lah.tier.approval`, LumiAH `defs.ts:219-235`), each answered "this chat", and the tier is
 * set back to allow once the turn and its jobs are over; the turn's words ask the author for the
 * chat's own place, path and map. Each store is kept only once made: a later run plays the turn again.
 */
export const storesOwnPlaces: Step = {
  name: "stores-own-places",
  makes: "harness approvals kept for a chat, and places, paths or maps of the chat's own (engine.world events)",
  async run(ctx) {
    if (ctx.log.get<Json>("stores:own-places") !== undefined && ctx.log.get<Json>("stores:approvals") !== undefined) return;
    const id = chatId(ctx, CUT);
    await ctx.player.show(id);
    await ctx.socket.lah("lah.tier.approval", { tier: APPROVAL_TIER, approval: "ask" });
    ctx.log.log({ step: "stores", action: "changed", kind: "harness tier approval (harness/settings.json)", id: APPROVAL_TIER, detail: "ask" });
    const stop = approveForChat(ctx, id);
    try {
      await ctx.player.turn(id, PLAYER, PLACES_TURN);
      await settleJobs(ctx, id);
    } finally {
      await stop();
      await ctx.socket.lah("lah.tier.approval", { tier: APPROVAL_TIER, approval: "allow" });
      ctx.log.log({ step: "stores", action: "changed", kind: "harness tier approval (harness/settings.json)", id: APPROVAL_TIER, detail: "allow" });
    }
    const kept = (await ctx.socket.lah<{ kept: { tool: string }[] }>("lah.approvals.kept", { chatId: id })).kept;
    if (kept.length > 0) ctx.log.set("stores:approvals", { chat: `stores:chat:${CUT}`, tools: kept.map((k) => k.tool).sort() });
    else say("  no write-tier call of the turn waited for an answer: a later run plays the turn again");
    const made = await draftEvents(ctx, id);
    if (made > 0) {
      ctx.log.set("stores:own-places", { chat: `stores:chat:${CUT}` });
      ctx.log.log({ step: "stores", action: "created", kind: "chat's own places, paths or maps (engine.world events)", id, detail: { events: made } });
    } else say("  the author made no place, path or map of the chat's own this turn: a later run plays the turn again");
  },
};

/**
 * A reply that stands with no turn played. Today's build records why on the reply's record
 * (`Rec.harness.unplayed`, `src/shared/ledger.ts:444-449`) only on a reply that holds text
 * (`src/engine/ledger/journal.ts:1528-1531`). The one reason play makes: the engine restarted while
 * the reply was written (`src/backend/ledger-io.ts:712`): a harness turn's reply streaming when the
 * extension is restarted from Lumiverse's own extension page (`POST /api/v1/spindle/:id/restart`,
 * Lumiverse `src/routes/spindle.routes.ts:422-447`). The new backend holds no turn for the
 * generation; at its end (`ledger-io.ts:914`, `:1660-1666`) or at the chat's next opening
 * (`ledger-io.ts:2284-2306`) the reply is marked, and the chat says so (`unplayed:<message>:<swipe>`,
 * `src/backend/view.ts:782-786` on main). It runs last of all: a restart drops what the backend holds
 * in memory (prepared turns, review gates, running jobs).
 */
export const storesCutShort: Step = {
  name: "stores-cut-short",
  makes: "a harness reply written while the extension restarted, standing with no turn played",
  async run(ctx) {
    if (ctx.log.get<Json>("stores:unplayed") !== undefined) return;
    const id = chatId(ctx, CUT);
    await ctx.player.show(id);
    ctx.socket.focus(id);
    const from = ctx.socket.events.length;
    const heard = (event: string): boolean => ctx.socket.events.slice(from).some((e) => e.event === event && e.payload.chatId === id);
    const user = await ctx.host.send(id, PLAYER, CUT_TURN);
    ctx.log.log({ step: "stores", action: "created", kind: "message", id: user.id, detail: { chatId: id, user: true } });
    await ctx.host.generate(id, "normal", ctx.connectionId);
    const began = Date.now();
    // Lumiverse's own event of a token of the reply's stream (Lumiverse `src/ws/events.ts:36`): the reply is being written.
    while (!heard("STREAM_TOKEN_RECEIVED")) {
      if (heard("GENERATION_ENDED") || heard("GENERATION_STOPPED")) throw new Error("the reply ended before any of it streamed");
      if (Date.now() - began > WAIT_MS) throw new Error("no reply streamed");
      await Bun.sleep(200);
    }
    await ctx.host.call("POST", `/api/v1/spindle/${ctx.extensionId}/restart`, {});
    ctx.log.log({ step: "stores", action: "changed", kind: "extension restarted while a reply streamed", id: ctx.extensionId, detail: { chatId: id } });
    while ((await ctx.host.extension(IDENTIFIER)).status !== "running") {
      if (Date.now() - began > WAIT_MS) throw new Error("the extension didn't come back");
      await Bun.sleep(1000);
    }
    while (!heard("GENERATION_ENDED") && !heard("GENERATION_STOPPED")) {
      if (Date.now() - began > WAIT_MS) throw new Error("the reply never ended");
      await Bun.sleep(1000);
    }
    // The page opens the chat again, as a page does after a restart: restart recovery closes what the old backend left open.
    await ctx.socket.lre("lre.hello", { chatId: id, viewing: true });
    let mark: { id: string } | undefined;
    for (const until = Date.now() + 120_000; mark === undefined && Date.now() < until; await Bun.sleep(2000)) mark = (await viewOf(ctx, id)).view.chips.find((c) => c.id.startsWith("unplayed:"));
    if (mark === undefined) throw new Error("the reply holds no mark that no turn was played");
    const [, messageId, swipe] = mark.id.split(":");
    ctx.log.set("stores:unplayed", { chat: `stores:chat:${CUT}`, message: messageId ?? "", swipe: Number(swipe) });
    ctx.log.log({ step: "stores", action: "created", kind: "reply standing with no turn played (Rec.harness.unplayed)", id: messageId ?? mark.id, detail: { chatId: id } });
  },
};

// ---------------------------------------------------------------------------------------------
// What the GM told Tidy up to leave alone.

/** The chats played by then, in order: the first with a finding gives the one left. */
const TIDY_CHATS = ["chat:classic", "chat:agents", "chat:harness", "chat:branch", `stores:chat:${KEPT}`, `stores:chat:${CUT}`];

/**
 * GM → Things → Tidy up's Leave it on one finding (`lre.things {scope: "gm", op: "leave"}`,
 * `src/backend/dispatch.ts:273-276` → `runs/<chat>/prefs.json` `tidyLeft`, `chat-prefs.ts:89-97`),
 * read from that chat's own findings first (`op: "tidy"`, `src/shared/thing-gm.ts:86-106`), as the
 * page offers only a finding it shows. A world with no impossible hold in any chat has none to leave:
 * the step says so and a later run looks again.
 */
export const storesTidyLeft: Step = {
  name: "stores-tidy-left",
  makes: "a Tidy up finding left as it is (runs/<chat>/prefs.json tidyLeft)",
  async run(ctx) {
    if (ctx.log.get<Json>("stores:tidy-left") !== undefined) return;
    for (const key of TIDY_CHATS) {
      const known = ctx.log.get<string>(key);
      if (known === undefined) continue;
      const id = guard(ctx.env, known);
      const run = await ctx.socket.lre<{ tidy?: { findings: { key: string; kind: string }[] } }>("lre.things", { scope: "gm", chatId: id, op: "tidy" });
      const finding = run.tidy?.findings[0];
      if (finding === undefined) continue;
      const after = await ctx.socket.lre<{ tidy?: { left: number } }>("lre.things", { scope: "gm", chatId: id, op: "leave", key: finding.key, left: true });
      ctx.log.set("stores:tidy-left", { chat: key, kind: finding.kind });
      ctx.log.log({ step: "stores", action: "changed", kind: "Tidy up finding left (runs/<chat>/prefs.json tidyLeft)", id, detail: { finding: finding.key, left: after.tidy?.left ?? null } });
      return;
    }
    say("  no played chat has a Tidy up finding to leave: a later run looks again");
  },
};

/** Each store step and the step it runs after: all after `harness`, the play steps' last; the restart last of all. */
export const STORE_STEP_AFTER: Readonly<Record<string, string>> = {
  "stores-user-settings": "harness",
  "stores-models": "stores-user-settings",
  "stores-kept": "stores-models",
  "stores-held": "stores-kept",
  "stores-harness-pages": "stores-held",
  "stores-own-places": "stores-harness-pages",
  "stores-tidy-left": "stores-own-places",
  "stores-cut-short": "stores-tidy-left",
};

/** In the order they run. */
export const STORE_STEPS: Step[] = [storesUserSettings, storesModels, storesKept, storesHeld, storesHarnessPages, storesOwnPlaces, storesTidyLeft, storesCutShort];

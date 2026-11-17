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
import { HttpError, type Message } from "../lumiverse";
import type { Json } from "../record";
import { say } from "../record";
import type { HostEvent } from "../socket";
import { cardOf, PLAYER } from "../../steps/chats";
import { worldIdOf } from "../../steps/world";
import { isRecord } from "./json";
import { ledgerOf, type StoredLedger } from "./rows";

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
  minds: { knowledge: { enabled: boolean; threshold: number } };
  agents: { pipeline: { mode: string }; main: { stages: { [stage: string]: string } }; persist: { on: boolean }; compaction: { atTokens: number; keepTurns: number } };
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
  // Knowledge tracking on, with its threshold: on and 0.7 by default (`src/shared/minds.ts:434-437,469`).
  minds: { knowledge: { enabled: true, threshold: 0.6 } },
} as const;

/**
 * Settings changed at the user's level (Settings → Narrator, Settings → Minds → Knowledge). The
 * tidy-up is not among them: `settings-set` knows no user setting `tidy` (seen on the bed: "there is
 * no setting tidy"); its switch and what it leaves alone are a chat's (`stores-kept`,
 * `stores-tidy-left`). After `harness`: the narrator's view and the knowledge threshold change how a
 * later turn is told and recorded, and the play steps must play as before.
 */
export const storesUserSettings: Step = {
  name: "stores-user-settings",
  makes: "the user's own narrator view of secrets and the knowledge threshold (settings.json)",
  async run(ctx) {
    await ctx.log.once("stores:user-settings", async () => {
      const after = await patchSettings(ctx, USER_SETTINGS as unknown as { [key: string]: Json });
      const took = after.narrator.knowledge === USER_SETTINGS.narrator.knowledge && after.narrator.secrets === USER_SETTINGS.narrator.secrets && after.minds.knowledge.enabled && after.minds.knowledge.threshold === USER_SETTINGS.minds.knowledge.threshold;
      if (!took) throw new Error(`the user's settings didn't take: ${JSON.stringify({ narrator: after.narrator, knowledge: after.minds.knowledge })}`);
      ctx.log.log({ step: "stores", action: "changed", kind: "settings (settings.json)", id: "narrator", detail: after.narrator });
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
 * skip's step is off in the Standard preset and runs only on a timelapse (`settings-store.ts:100`),
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
/**
 * The agents engine's settings that make a compaction and a kept scene on this chat's turns, each one
 * a user of today's build sets in Settings → Agents (R-201 (a)). The session a compaction folds is the
 * main agent's, and the main agent runs in a turn only when the pipeline is "Main agent decides" (on
 * `main`, `src/backend/agents/orchestrator.ts:277-283`); on the fixed pipeline, today's default
 * (`src/shared/agent-settings.ts:411`), it works the final review alone with no session
 * (`main-agent.ts:629-634`, `orchestrator.ts:629`): the bed's first run of this step played three
 * turns with no compaction. On "Main agent decides" with every stage its own (the default,
 * `src/shared/agent-pipeline.ts:24-26`), the allowed model ended stage 5 without committing it and
 * the turn failed (`main-agent.ts:127,432-435`; the bed's `make-a8`). So no stage is the main
 * agent's here, the smallest set: each runs on its own (`agent-pipeline.ts:14-15`), and the main
 * agent's one send is the final review (on by default, `agent-settings.ts:417`), which reads the
 * session prepared, and compacted, before it (`main-agent.ts:463`), keeps its send in that session
 * (`:480-481`), and fails no turn when it doesn't commit (its own `onFail`, `send` by default). With
 * them: Smart persistence on (off by default, `agent-settings.ts:418-419`), and a compaction past the
 * first token keeping no turn whole (32,000 and 3 by default, `:425`; at least 1 and 0, `:563-565`).
 */
export const KEPT_AGENTS = {
  agents: {
    pipeline: { mode: "main" },
    main: { stages: { intent: "auto", prepare: "auto", beats: "auto", read: "auto", memory: "auto" } },
    persist: { on: true },
    compaction: { atTokens: 1, keepTurns: 0 },
  },
} as const;
/** R-201 (b): how many times the player presses a failed kept turn's Retry (the engine-failed flag's Regenerate) before play is given up on. */
export const KEPT_REGENERATES = 3;
const KEPT_TURNS = [
  "Before work I walk down to the marina and ask Dale whether the Harbor Watch logbook needs signing tonight.",
  "I sign the logbook, thank Dale and walk up Harbor Street towards Alder Automotive.",
  "On the way I stop at the Bluebird and buy a coffee to take to the shop.",
];

/** How the player's turn says the engine failed it (`lib/play.ts:99`): the failure its user sees on the turn's flag. */
const ENGINE_FAILED = /the engine says/;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One kept turn, played; when the engine fails it, the player presses the failed turn's flag's Retry,
 * which starts Regenerate as the flag says (`Player.retry`, `lib/play.ts:141-156`), as its user does,
 * up to `KEPT_REGENERATES` presses (R-201 (b)). Each press is in the instance's log; a failure of
 * anything but the engine's is not pressed on.
 */
async function keptTurn(ctx: Ctx, id: string, text: string): Promise<void> {
  let failed: string;
  try {
    await ctx.player.turn(id, PLAYER, text);
    return;
  } catch (error) {
    failed = errorText(error);
    if (!ENGINE_FAILED.test(failed)) throw error;
  }
  for (let press = 1; press <= KEPT_REGENERATES; press++) {
    ctx.log.log({ step: "stores", action: "played", kind: "Retry pressed on a failed turn (R-201 (b))", id, detail: { press, failed } });
    say(`  the turn failed (${failed}): Retry, press ${press} of ${KEPT_REGENERATES}`);
    try {
      await ctx.player.retry(id);
      return;
    } catch (error) {
      failed = errorText(error);
      if (!ENGINE_FAILED.test(failed)) throw error;
    }
  }
  throw new Error(`the kept turn failed after ${KEPT_REGENERATES} presses of Retry: ${failed}`);
}

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
    await ctx.log.once("stores:kept:stages", async () => {
      const after = await patchSettings(ctx, KEPT_AGENTS as unknown as { [key: string]: Json });
      const want = KEPT_AGENTS.agents.compaction;
      const stages = Object.entries(KEPT_AGENTS.agents.main.stages).every(([stage, mode]) => after.agents.main.stages[stage] === mode);
      if (after.agents.pipeline.mode !== KEPT_AGENTS.agents.pipeline.mode || !stages || !after.agents.persist.on || after.agents.compaction.atTokens !== want.atTokens || after.agents.compaction.keepTurns !== want.keepTurns) throw new Error(`the agents engine's settings didn't take: ${JSON.stringify(after.agents)}`);
      ctx.log.log({ step: "stores", action: "changed", kind: "settings (settings.json)", id: "agents.pipeline.mode", detail: after.agents.pipeline.mode });
      ctx.log.log({ step: "stores", action: "changed", kind: "settings (settings.json)", id: "agents.main.stages", detail: after.agents.main.stages });
      ctx.log.log({ step: "stores", action: "changed", kind: "settings (settings.json)", id: "agents.persist.on", detail: true });
      ctx.log.log({ step: "stores", action: "changed", kind: "settings (settings.json)", id: "agents.compaction", detail: want });
    });
    const id = chatId(ctx, KEPT);
    const rollback = async (): Promise<string> => (await ctx.socket.lre<{ session?: { rollback: string } }>("lre.workspace", { chatId: id, op: "session" })).session?.rollback ?? "none";
    await ctx.log.once("stores:kept:turns", async () => {
      await ctx.player.show(id);
      for (const text of KEPT_TURNS) {
        if ((await rollback()) !== "none") break;
        await keptTurn(ctx, id, text);
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
    const ledger = messageLedger(m);
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

// ---------------------------------------------------------------------------------------------
// Replies whose turn the play cut short: stopped from Lumiverse, the runtime stopped under it, the
// extension restarted under it. Each is a harness chat of its own, after every other harness turn.

/**
 * Whether a token of the reply's own text reached this page since `since`: Lumiverse's stream event
 * (`src/ws/events.ts:36`), whose `type` is "reasoning" for a token of the thinking block, where
 * LumiAH's progress lines go, and absent for the reply's text (`src/services/generate.service.ts:
 * 3341-3350,3373-3380`). Only a reply that holds text can carry today's mark of no turn played
 * (`src/engine/ledger/journal.ts:1528-1531` on RPE's main).
 */
function textStreamed(ctx: Ctx, id: string, since: number): boolean {
  return ctx.socket.events.some((e) => e.at >= since && e.event === "STREAM_TOKEN_RECEIVED" && e.payload.chatId === id && e.payload.type === undefined && typeof e.payload.token === "string" && e.payload.token !== "");
}

/** The chat's generation's end heard since `since`: Lumiverse's `GENERATION_ENDED` or `GENERATION_STOPPED`. */
function endOf(ctx: Ctx, id: string, since: number): HostEvent | undefined {
  return ctx.socket.events.find((e) => e.at >= since && (e.event === "GENERATION_ENDED" || e.event === "GENERATION_STOPPED") && e.payload.chatId === id);
}

/** The player's message and Send, as the page sends them, then a wait for the reply's own text to stream; when it began. */
async function streamingTurn(ctx: Ctx, id: string, text: string): Promise<number> {
  await ctx.player.show(id);
  // Stream tokens go only to a socket that said which chat it shows (`lib/socket.ts`, `focus`).
  ctx.socket.focus(id);
  const since = Date.now();
  const user = await ctx.host.send(id, PLAYER, text);
  ctx.log.log({ step: "stores", action: "created", kind: "message", id: user.id, detail: { chatId: id, user: true } });
  await ctx.host.generate(id, "normal", ctx.connectionId);
  while (!textStreamed(ctx, id, since)) {
    if (endOf(ctx, id, since) !== undefined) throw new Error("the reply ended before any of its text streamed: a later run plays the turn again");
    if (Date.now() - since > WAIT_MS) throw new Error("no text of the reply streamed");
    await Bun.sleep(100);
  }
  return since;
}

async function endedSince(ctx: Ctx, id: string, since: number): Promise<HostEvent> {
  for (;;) {
    const end = endOf(ctx, id, since);
    if (end !== undefined) return end;
    if (Date.now() - since > WAIT_MS) throw new Error("the reply never ended");
    await Bun.sleep(500);
  }
}

/** A message's engine ledger, from its metadata bag (`spindle_metadata`). */
function messageLedger(m: Message): StoredLedger | null {
  const bag = m.extra?.spindle_metadata;
  return ledgerOf(isRecord(bag) ? bag : undefined);
}

/** The reply a turn left (the chat's last message of the model's) and its record on the shown swipe, through Lumiverse's own read of the messages. */
async function lastReply(ctx: Ctx, id: string): Promise<{ id: string; swipe: number; status: string | null; turns: number; unplayed: string | null }> {
  const reply = (await ctx.host.messages(id)).filter((m) => !m.is_user).at(-1);
  if (reply === undefined) throw new Error("the chat holds no reply");
  const rec = messageLedger(reply)?.swipes[String(reply.swipe_id)];
  return { id: reply.id, swipe: reply.swipe_id, status: rec?.status ?? null, turns: (rec?.harness?.turns ?? []).length, unplayed: rec?.harness?.unplayed ?? null };
}

const STOPPED = "stopped";
const STOPPED_NAME = "Port Alder test · harness, stopped";
const STOPPED_TURN = "I walk out along the fuel dock and ask Dale what the weather looks like for tomorrow's boats.";

/**
 * A harness reply stopped from Lumiverse once some of its text streamed (Lumiverse's own stop,
 * `POST /api/v1/generate/stop`, `src/routes/generate.routes.ts:45-65`, which saves the text so far,
 * `src/services/generate.service.ts:3565-3640,4502-4535`). Today's build keeps such a reply as a
 * stopped turn, not as one with no turn played: with text in the stop, the turn commits as stopped
 * (RPE `src/backend/ledger-io.ts:1566-1580`), LumiAH's own record of it standing, since its run was
 * stopped with something released (`src/backend/harness/extension.ts:1162`). The step keeps what
 * today's build made of it (`stores:stopped`); the reason "stopped" of a reply with no turn played
 * is planted (`planted-harness.ts`).
 */
export const storesStopped: Step = {
  name: "stores-stopped",
  makes: "a harness reply stopped from Lumiverse once its text streamed (today's build keeps it as a stopped turn)",
  async run(ctx) {
    await ctx.log.once("stores:stopped:chat", async () => {
      await storesChat(ctx, STOPPED, STOPPED_NAME, "harness");
    });
    if (ctx.log.get<Json>("stores:stopped") !== undefined) return;
    const id = chatId(ctx, STOPPED);
    const since = await streamingTurn(ctx, id, STOPPED_TURN);
    await ctx.host.call("POST", "/api/v1/generate/stop", { chat_id: id });
    ctx.log.log({ step: "stores", action: "changed", kind: "reply stopped from Lumiverse once its text streamed", id, detail: { chatId: id } });
    await endedSince(ctx, id, since);
    await ctx.player.quiet(id);
    await settleJobs(ctx, id);
    const reply = await lastReply(ctx, id);
    const record = reply.unplayed !== null ? "unplayed" : reply.status === "stopped" && reply.turns > 0 ? "stopped turn" : reply.status === null ? "none" : "turn";
    ctx.log.set("stores:stopped", { chat: `stores:chat:${STOPPED}`, message: reply.id, swipe: reply.swipe, record });
    ctx.log.log({ step: "stores", action: "created", kind: `reply stopped from Lumiverse: ${record}`, id: reply.id, detail: { chatId: id, status: reply.status } });
  },
};

/** Where the system keeps its own programs: systemctl is taken from there and never through PATH, as today's runtime takes it (LumiAH `src/runtime/update/programs.ts:1-4`). */
const SYSTEM_FOLDERS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
/**
 * A systemctl call's limit. A runtime asked to stop while a reply of its own runs is not always gone
 * at once: its unit's own wait is systemd's 90 s (`TimeoutStopSec`), after which systemd ends it, seen
 * on the bed at the step `stores-gen-failed`, where a limit of one minute ended the call and the run.
 */
const SYSTEMCTL_MS = 150_000;
/** How long the owner's runtime is given to link again after it starts: it reconnects with waits doubling up to thirty seconds (LumiAH `src/link/settings.ts:236-237`). */
const LINK_MS = 3 * 60_000;

/** `systemctl --user` on a unit the instance's set-up made, reaching the account's own service manager by XDG_RUNTIME_DIR, else `/run/user/<uid>` (LumiAH `src/runtime/update/service.ts:54-58`). */
async function systemctl(args: string[]): Promise<void> {
  const program = SYSTEM_FOLDERS.map((folder) => join(folder, "systemctl")).find((path) => existsSync(path));
  if (program === undefined) throw new Error(`systemctl isn't in ${SYSTEM_FOLDERS.join(", ")}`);
  const uid = process.getuid?.();
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? (uid !== undefined ? `/run/user/${uid}` : undefined);
  const proc = Bun.spawn([program, "--user", ...args], { env: { ...process.env, ...(runtimeDir !== undefined ? { XDG_RUNTIME_DIR: runtimeDir } : {}) }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  // Only the process this step started is ever ended.
  const timer = setTimeout(() => proc.kill(), SYSTEMCTL_MS);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(`systemctl --user ${args.join(" ")} failed (${code}): ${`${err}\n${out}`.trim().slice(0, 400)}`);
}

/** The owner's runtime as the set-up recorded it (`runtime:owner`: its name and the unit `lumiah up --systemd` made). */
export function ownerRuntime(ctx: Pick<Ctx, "log">): { name: string; unit: string } {
  const value = ctx.log.get<Json>("runtime:owner");
  const runtime = value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (typeof runtime.name !== "string" || typeof runtime.unit !== "string" || runtime.unit === "") throw new Error("runtime:owner isn't recorded with its unit: the set-up's runtimes step runs first");
  return { name: runtime.name, unit: runtime.unit };
}

/** Waits until the harness's Runtime page shows the owner's runtime linked (`lah.hello`'s `runtime.relays`, LumiAH `src/shared/ui.ts:268-307,725-747`); a request the backend can't answer yet is asked again. */
export async function waitLinked(ctx: Ctx): Promise<void> {
  const { name } = ownerRuntime(ctx);
  for (const began = Date.now(); ; await Bun.sleep(POLL_MS)) {
    const hello = await ctx.socket.lah<{ runtime: { relays: { name: string; link: string }[] } }>("lah.hello", {}).catch(() => null);
    if (hello?.runtime.relays.some((r) => r.name === name && r.link === "linked") === true) return;
    if (Date.now() - began > LINK_MS) throw new Error(`the runtime ${name} isn't linked ${LINK_MS / 1000} s after it started`);
  }
}

const FAILED = "failed";
const FAILED_NAME = "Port Alder test · harness, generation failed";
const FAILED_TURN = "I help Dale haul the fuel dock's spare fenders into the shed before the wind picks up.";

/**
 * A harness reply whose generation failed: the owner's runtime unit stopped once some of the reply's
 * text streamed, and started again after. On stop, today's runtime ends every request under way with
 * an error chunk ("The runtime is restarting…", LumiAH `src/runtime/cli.ts:830,892-896`,
 * `src/runtime/runtime.ts:484-489`, `src/runtime/relay.ts:133-140`, `src/runtime/sse.ts:173-178`);
 * Lumiverse takes it as the provider's error (`src/llm/provider-sse.ts:11-20`), saves the text so far
 * and ends the generation with that error, with no retry (`src/services/generate.service.ts:3766,
 * 4536-4580`); RPE marks the reply "the reply's generation failed: …", the generation's error coming
 * before anything of the run (`src/backend/ledger-io.ts:1554,1609,1639-1647`). Only the instance's
 * own unit is stopped and started; no provider is touched.
 */
export const storesGenFailed: Step = {
  name: "stores-gen-failed",
  makes: "a harness reply whose generation failed when the owner's runtime unit stopped under it (started again after)",
  async run(ctx) {
    await ctx.log.once("stores:failed:chat", async () => {
      await storesChat(ctx, FAILED, FAILED_NAME, "harness");
    });
    if (ctx.log.get<Json>("stores:gen-failed") !== undefined) return;
    const id = chatId(ctx, FAILED);
    const { unit } = ownerRuntime(ctx);
    const since = await streamingTurn(ctx, id, FAILED_TURN);
    let end: HostEvent;
    try {
      await systemctl(["stop", unit]);
      ctx.log.log({ step: "stores", action: "changed", kind: "owner's runtime unit stopped while a reply streamed", id: unit, detail: { chatId: id } });
      end = await endedSince(ctx, id, since);
    } finally {
      await systemctl(["start", unit]);
      ctx.log.log({ step: "stores", action: "changed", kind: "owner's runtime unit started again", id: unit });
    }
    if (end.event !== "GENERATION_ENDED" || typeof end.payload.error !== "string") throw new Error("the reply ended before the runtime stopped: no error reached it, so a later run plays the turn again");
    await waitLinked(ctx);
    let mark: { id: string } | undefined;
    for (const until = Date.now() + 120_000; mark === undefined && Date.now() < until; await Bun.sleep(2000)) mark = (await viewOf(ctx, id)).view.chips.find((c) => c.id.startsWith("unplayed:"));
    if (mark === undefined) throw new Error("the reply whose generation failed holds no mark that no turn was played");
    const [, messageId, swipe] = mark.id.split(":");
    ctx.log.set("stores:gen-failed", { chat: `stores:chat:${FAILED}`, message: messageId ?? "", swipe: Number(swipe) });
    ctx.log.log({ step: "stores", action: "created", kind: "reply standing with no turn played: its generation failed (Rec.harness.unplayed)", id: messageId ?? mark.id, detail: { chatId: id } });
  },
};

/**
 * A reply that stands with no turn played because the engine restarted while it was written
 * (`src/backend/ledger-io.ts:712`): the extension restarted from Lumiverse's own extension page
 * (`POST /api/v1/spindle/:id/restart`, Lumiverse `src/routes/spindle.routes.ts:422-447`) once some of
 * a harness reply's text streamed. The new backend holds no turn for the generation; at its end
 * (`ledger-io.ts:914,1660-1666`) or at the chat's next opening (`ledger-io.ts:2284-2306`) the reply,
 * which holds text (`src/engine/ledger/journal.ts:1528-1546`), is marked, and the chat says so
 * (`unplayed:<message>:<swipe>`, `src/backend/view.ts:782-786` on main). It runs after every other
 * harness turn: a restart drops what the backend holds in memory (prepared turns, review gates, jobs).
 */
export const storesCutShort: Step = {
  name: "stores-cut-short",
  makes: "a harness reply written while the extension restarted, standing with no turn played",
  async run(ctx) {
    if (ctx.log.get<Json>("stores:unplayed") !== undefined) return;
    const id = chatId(ctx, CUT);
    const since = await streamingTurn(ctx, id, CUT_TURN);
    await ctx.host.call("POST", `/api/v1/spindle/${ctx.extensionId}/restart`, {});
    ctx.log.log({ step: "stores", action: "changed", kind: "extension restarted while a reply streamed", id: ctx.extensionId, detail: { chatId: id } });
    while ((await ctx.host.extension(IDENTIFIER)).status !== "running") {
      if (Date.now() - since > WAIT_MS) throw new Error("the extension didn't come back");
      await Bun.sleep(1000);
    }
    await endedSince(ctx, id, since);
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

// ---------------------------------------------------------------------------------------------
// Preset blocks: an invented preset made active through Lumiverse's own routes, given today's
// RPEngine blocks, and the active preset put back.

/** The setting Lumiverse keeps the active preset under (`src/services/presets.service.ts:212`; `src/services/preset-profiles.service.ts:461-473`). */
const ACTIVE_PRESET = "activeLoomPresetId";

/**
 * The invented preset, as Lumiverse's own Loom builder sends a new one (`provider: "loom"`,
 * frontend `src/lib/loom/service.ts:550-579`; `POST /api/v1/presets` needs a name and a provider,
 * `src/routes/presets.routes.ts:95-100`): one block of the user's own, in the stored shape RPE
 * writes its blocks in (RPE `src/backend/spindle-host.ts:928-932` on main), holding the reference
 * to the engine's narrator outlet that today's build routes a section to (`src/backend/preset-binding.ts:37`).
 */
export const PRESET = {
  name: "Port Alder test preset",
  provider: "loom",
  parameters: {},
  prompts: {},
  metadata: { description: "An invented preset for the migration's test instance." },
  prompt_order: [
    {
      id: "5c1e9a40-3b7d-4f2a-9e6c-0d8b7a6f5e41",
      name: "Port Alder narration",
      content: "Tell Port Alder plainly and warmly, a few short paragraphs at a time.\n\n{{outlet::lre_narrator}}",
      role: "system",
      enabled: true,
      position: "pre_history",
      depth: 0,
      marker: null,
      isLocked: false,
      color: null,
      injectionTrigger: [],
      group: null,
      categoryMode: null,
    },
  ],
};

/**
 * The RPEngine blocks in a preset, by play: the invented preset made (`POST /api/v1/presets`) and
 * made the active one (`PUT /api/v1/settings/activeLoomPresetId`, `src/routes/settings.routes.ts:
 * 61-71`), then Settings → Preset's Add RPEngine blocks (`lre.preset {op: "add"}`, RPE
 * `src/backend/dispatch.ts:882-887`, `src/backend/runtime.ts:4195-4209`), which adds the guidance
 * blocks the active preset lacks, switched off, under an "RPEngine" category (`src/backend/
 * preset-binding.ts:25-31,195-208`). Then the active preset as it was before is put back: the earlier
 * one by the same route, or none by deleting the setting (`src/routes/settings.routes.ts:73-79`).
 * Last of all play: the active preset decides what the classic chat generates with.
 */
export const storesPreset: Step = {
  name: "stores-preset",
  makes: "an invented preset given today's RPEngine blocks (Settings → Preset), the earlier active preset put back",
  async run(ctx) {
    await ctx.log.once("stores:preset", async () => {
      // The active preset before this step, kept before anything changes: a run stopped midway leaves the invented one active, and its rerun puts back this one.
      const kept = ctx.log.get<Json>("stores:preset:previous");
      let previous: string | null = typeof kept === "string" ? kept : null;
      if (kept === undefined) {
        try {
          const setting = await ctx.host.call<{ value?: unknown }>("GET", `/api/v1/settings/${ACTIVE_PRESET}`);
          previous = typeof setting.value === "string" && setting.value !== "" ? setting.value : null;
        } catch (error) {
          if (!(error instanceof HttpError && error.status === 404)) throw error;
        }
        ctx.log.set("stores:preset:previous", previous);
      }
      const listed = await ctx.host.call<unknown>("GET", "/api/v1/presets?limit=200");
      const page: unknown[] = Array.isArray(listed) ? listed : isRecord(listed) && Array.isArray(listed.data) ? listed.data : [];
      const known = page.find((p) => isRecord(p) && p.name === PRESET.name && typeof p.id === "string");
      let presetId = isRecord(known) && typeof known.id === "string" ? known.id : undefined;
      if (presetId === undefined) {
        presetId = (await ctx.host.call<{ id: string }>("POST", "/api/v1/presets", PRESET)).id;
        ctx.log.log({ step: "stores", action: "created", kind: "preset (Lumiverse)", id: presetId, name: PRESET.name });
      }
      await ctx.host.call("PUT", `/api/v1/settings/${ACTIVE_PRESET}`, { value: presetId });
      ctx.log.log({ step: "stores", action: "changed", kind: "active preset (Lumiverse setting activeLoomPresetId)", id: presetId });
      try {
        const { card } = await ctx.socket.lre<{ card: { preset: { id: string } | null; blocks: { target: string; state: string }[] } }>("lre.preset", { op: "add" });
        if (card.preset?.id !== presetId) throw new Error(`Settings → Preset added the blocks to ${card.preset?.id ?? "no preset"}, not the invented one`);
        const missing = card.blocks.filter((b) => b.state === "missing").map((b) => b.target);
        if (missing.length > 0) throw new Error(`the preset still lacks the blocks of ${missing.join(", ")}`);
        ctx.log.log({ step: "stores", action: "changed", kind: "RPEngine blocks added to the active preset (lre.preset add)", id: presetId, detail: { blocks: card.blocks.length } });
      } finally {
        if (previous !== null) await ctx.host.call("PUT", `/api/v1/settings/${ACTIVE_PRESET}`, { value: previous });
        else await ctx.host.call("DELETE", `/api/v1/settings/${ACTIVE_PRESET}`);
        ctx.log.log({ step: "stores", action: "changed", kind: "active preset put back (Lumiverse setting activeLoomPresetId)", id: previous ?? "none" });
      }
      ctx.log.set("stores:preset", { id: presetId, previous });
    });
  },
};

/** Each store step and the step it runs after: all after `harness`, the play steps' last; the turns cut short after every other harness turn, the extension's restart after the runtime's, the preset last of all play. */
export const STORE_STEP_AFTER: Readonly<Record<string, string>> = {
  "stores-user-settings": "harness",
  "stores-models": "stores-user-settings",
  "stores-kept": "stores-models",
  "stores-held": "stores-kept",
  "stores-harness-pages": "stores-held",
  "stores-own-places": "stores-harness-pages",
  "stores-tidy-left": "stores-own-places",
  "stores-stopped": "stores-tidy-left",
  "stores-gen-failed": "stores-stopped",
  "stores-cut-short": "stores-gen-failed",
  "stores-preset": "stores-cut-short",
};

/** In the order they run. */
export const STORE_STEPS: Step[] = [storesUserSettings, storesModels, storesKept, storesHeld, storesHarnessPages, storesOwnPlaces, storesTidyLeft, storesStopped, storesGenFailed, storesCutShort, storesPreset];

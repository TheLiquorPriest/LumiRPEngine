// What the harness cast's tests share: a Port Alder chat with five people of the tests' own beside
// the player character, a harness turn as a tool reaches one (`HarnessTurn`) that only keeps what
// was staged, committed and granted, and a call of a tool through `runHarnessTool`, as the bridge
// makes one. The turn is a stand-in for the bridge's: the tools under test are real, and so is the
// engine that checks what they stage.
//
// No test here scripts a model: the fake host's helper throws, so a tool that reached one of the
// engine's own model calls would fail its test (`noModelCalls`).

import { expect } from "bun:test";
import { runHarnessTool } from "../../src/backend/agents/tools/harness";
import type { HarnessFile, HarnessFiles } from "../../src/backend/agents/tools/harness-ports";
import type { HarnessChange, HarnessCommit, HarnessTurn } from "../../src/backend/agents/tools/harness-turn";
import type { ToolEnv } from "../../src/backend/agents/tools/registry";
import { type AgentOp, type OpRefusal, outsideWriter, type ToolWriter } from "../../src/backend/agents/tools/writer";
import type { StoryPort } from "../../src/backend/story/record";
import type { RoleTier } from "../../src/shared/agent-roles";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent, RecStory } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";
import type { WorldState } from "../../src/engine/state";
import { type StoryPart, walkStory, withStory } from "../../src/engine/story/record";
import { Working } from "../../src/engine/working";
import { stateOf } from "../support/mind-chat";
import type { Rig } from "../support/rig";
import { alderChat, HOME, toolEnv } from "../support/tools";
import { mount, playOn } from "./harness-driver";

/** The tests' own people, by id. Mara, Joss and Ilse are where the player character wakes; Okoro is in the world but nowhere. Brann is no one yet: a test has them walk on. */
export const MARA = "mara";
export const JOSS = "joss";
export const ILSE = "ilse";
export const OKORO = "okoro";

const person = (id: string, name: string, here: boolean): JsonObject => ({ id, kind: "character", name, tier: "background", fields: here ? { place: HOME } : {}, relations: [] });

/** A check anyone may take at any time: a d20 against 11, which pays or costs the one who takes it, and takes five minutes. */
export const DARE: JsonObject = {
  id: "dare",
  label: "Take the dare",
  params: {},
  requires: [],
  check: { id: "dare", dice: "d20", dc: "11" },
  outcomes: { success: [{ type: "add", args: { entity: "self", field: "cash", delta: 500 } }], failure: [{ type: "add", args: { entity: "self", field: "cash", delta: -500 } }] },
  duration: "5",
};

/** One no one can take: its requirement never holds. */
export const LOCKED: JsonObject = { ...DARE, id: "locked_dare", label: "Take the locked dare", requires: ["1 > 2"], check: { id: "locked_dare", dice: "d20", dc: "11" } };

/** Fails any model call made of `rig`'s engine from here on: on the harness every model call is an agent's, in LumiAH's runtime. For a test that builds its own chat; `castChat` has it already. */
export function guardModel(rig: Rig): Rig {
  rig.host.quietReply = () => {
    throw new Error("a harness tool reached one of the engine's own model calls");
  };
  return rig;
}

/** A Port Alder chat with the tests' people and checks, character minds on, and a helper that fails any model call made of it. */
export async function castChat(): Promise<{ rig: Rig; chatId: string }> {
  const made = await alderChat({ minds: true, put: { entities: { [MARA]: person(MARA, "Mara", true), [JOSS]: person(JOSS, "Joss", true), [ILSE]: person(ILSE, "Ilse", true), [OKORO]: person(OKORO, "Okoro", false) }, actions: { dare: DARE, locked_dare: LOCKED } } });
  guardModel(made.rig);
  return made;
}

/** No model call was made of the engine since the chat was made: every model call on the harness is an agent's, in LumiAH's runtime. */
export function noModelCalls(rig: Rig): void {
  expect(rig.host.quietCalls).toEqual([]);
}

/** A harness turn that keeps what its tools did with it. */
export interface CastTurn extends HarnessTurn {
  changes: HarnessChange[];
  committed: (string | null)[];
  granted: [string, RoleTier][];
}

/** What a test sets of its turn: any of the turn's own members, and what staging answers (`mode`, or a refusal for every change). */
export type TurnSetup = Partial<Omit<HarnessTurn, "grant" | "stage" | "commit" | "landed">> & { mode?: "auto" | "confirm"; refuse?: OpRefusal; landed?: LedgerEvent[] };

/**
 * The author's turn on `chatId`, open and before its reply, unless `setup` says otherwise: staging
 * keeps each change once by its key and answers Auto, a commit lists what was staged as landed, and a
 * grant holds for every name but `nobody`.
 */
export async function castTurn(rig: Rig, chatId: string, setup: TurnSetup = {}): Promise<CastTurn> {
  const { mode, refuse, landed, ...over } = setup;
  const { state } = await stateOf(rig, chatId);
  const first = (await rig.host.chats.messages(chatId, rig.host.userId))[0];
  const turn: CastTurn = {
    main: true,
    directed: false,
    knowing: false,
    settings: await rig.rt.settings.get(rig.host.userId),
    host: rig.host,
    seed: "turn-seed",
    runSeed: "run-seed",
    start: state,
    said: { messageId: first?.id ?? null, user: "I put the kettle on and ask who is in today.", before: "Morning." },
    reply: null,
    ...over,
    changes: [],
    committed: [],
    granted: [],
    landed: () => landed ?? [],
    staged: () => turn.changes.flatMap((c) => c.events),
    grant(to, tier) {
      if (to === "nobody") return false;
      turn.granted.push([to, tier]);
      return true;
    },
    async stage(change) {
      if (refuse) return refuse;
      if (!turn.changes.some((c) => c.key === change.key)) turn.changes.push(change);
      return { mode: mode ?? "auto" };
    },
    async commit(note): Promise<HarnessCommit> {
      turn.committed.push(note);
      return { landed: turn.changes.map((c) => c.lines), review: [], refused: [] };
    },
  };
  return turn;
}

/** The env the bridge would build for a call of an agent of the definition `role` in `turn`, reading the chat's head as the game master does; `as`, the instance it was started as (the person a character's agent is). */
export function castEnv(rig: Rig, chatId: string, turn: HarnessTurn | null, role: string = HARNESS_AGENT.author, writer: ToolEnv["writer"] = null, as?: string): ToolEnv {
  return { ...toolEnv(rig, chatId, "gm", writer), marks: true, agent: { role, id: `agent_${role}`, ...(as !== undefined ? { as } : {}) }, ...(turn ? { turn } : {}) };
}

/** A story record kept in memory as a run reaches it (`HarnessTurn.story`): `held` stands on the path, and each write goes on top of it (`written`). `staged`: a turn's own run (true), or a run after the reply, preparing or reliving (false). */
export function memoryStory(held: RecStory = {}, staged = true): StoryPort & { written: StoryPart } {
  const port: StoryPort & { written: StoryPart } = {
    turn: "turn-seed",
    staged,
    written: withStory({}, {}),
    async read() {
      return { path: walkStory([{ messageId: "m-held", swipeId: 0, seq: 1, story: withStory({}, held) }], port.written), own: port.written, basis: null, onPath: () => true };
    },
    async write(change) {
      port.written = withStory(port.written, change);
      return { kept: true };
    },
  };
  return port;
}

/** One call of a tool, as the bridge makes it. */
export function call(env: ToolEnv, name: string, args: JsonObject = {}): Promise<{ text: string; error?: boolean }> {
  return runHarnessTool(env, name, args);
}

/** A call's answer read back from its JSON; a refusal fails the test with its text. */
export async function answer(env: ToolEnv, name: string, args: JsonObject = {}): Promise<Record<string, unknown>> {
  const out = await call(env, name, args);
  if (out.error) throw new Error(`${name} refused: ${out.text}`);
  return JSON.parse(out.text) as Record<string, unknown>;
}

/** A call's refusal, as the model reads it; an answer fails the test. */
export async function refusal(env: ToolEnv, name: string, args: JsonObject = {}): Promise<string> {
  const out = await call(env, name, args);
  if (!out.error) throw new Error(`${name} answered: ${out.text}`);
  return out.text;
}

/** The chat's head with `events` applied in order, each as the engine's reducers take it: a staged change is only real if every event of it holds. */
export async function applied(rig: Rig, chatId: string, events: readonly LedgerEvent[]): Promise<{ state: WorldState; world: WorldDoc; before: WorldState }> {
  const { state, world } = await stateOf(rig, chatId);
  const w = new Working(rig.rt.registry, world, state);
  for (const event of events) expect({ event: event.type, rejection: w.apply(event) }).toEqual({ event: event.type, rejection: null });
  return { state: w.state, world, before: state };
}

/**
 * The engine's writer with a stage that lands: an operation that passes its check is written to the
 * chat's head at once, as a commit would write it, so what a write tool says it changed is read back
 * from the world. A file is only kept in `staged`: the harness writes one to its workspace instead.
 */
export function landingWriter(rig: Rig, chatId: string, staged: AgentOp[] = []): ToolWriter {
  const real = outsideWriter(rig.rt, { ...toolEnv(rig, chatId, "gm"), connectionId: null });
  return {
    dryRun: (op) => real.dryRun(op),
    apply: (ops, label) => real.apply(ops, label),
    stage: async (op) => {
      const out = await real.dryRun(op);
      if ("refused" in out) return out;
      staged.push(op);
      if (op.kind !== "ws_write") await real.apply([op], "a test's change");
      return out;
    },
  };
}

/** A workspace in memory, as the harness's port gives one (`HarnessFiles`): each write a new version, a write on a stale version refused with the current one. */
export function memoryFiles(): HarnessFiles & { files: Map<string, HarnessFile> } {
  const files = new Map<string, HarnessFile>();
  let n = 0;
  return {
    files,
    list: async (folder) => [...files.values()].filter((f) => f.path.startsWith(folder)).map((f) => ({ path: f.path, size: f.text.length, version: f.version })),
    read: async (path) => files.get(path) ?? null,
    write: async (path, text, base) => {
      const now = files.get(path)?.version ?? null;
      if (base !== now) return { refused: { code: "stale", reason: "the file changed since it was read", version: now } };
      const version = `v${++n}`;
      files.set(path, { path, text, version });
      return { version };
    },
  };
}

/** The author's env on a fresh cast chat, its turn open, writing through `landingWriter`: what most tests of a write tool start from. */
export async function authorEnv(): Promise<{ rig: Rig; chatId: string; env: ToolEnv; turn: CastTurn; staged: AgentOp[] }> {
  const { rig, chatId } = await castChat();
  const staged: AgentOp[] = [];
  const turn = await castTurn(rig, chatId);
  return { rig, chatId, staged, turn, env: castEnv(rig, chatId, turn, HARNESS_AGENT.author, landingWriter(rig, chatId, staged)) };
}

/**
 * A cast chat that plays on the harness engine, for a test that plays a whole turn through the
 * bridge's own turn (`harness-driver.ts`: `beginTurn`, `run.answer(AUTHOR, …)`, `run.finish`) rather
 * than the stand-in: what a tool stages is then committed, carded and recorded as a real turn's is.
 */
export async function turnChat(): Promise<{ rig: Rig; chatId: string }> {
  const made = await castChat();
  mount(made.rig);
  await playOn(made.rig, made.chatId, "harness");
  return made;
}

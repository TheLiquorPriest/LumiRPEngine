// Smart persistence (N3 lane B7, 2e; Settings → Agents → Pipeline): the scene basis a turn is kept
// by, signal by signal; when the last turn's scene holds and why it doesn't; the pipeline map's
// never-skip list and each role's run choices; the turn's plan GM → Live shows; and on an agent chat,
// two quiet turns: the second asks no mind and no scene role again, records their copies marked kept
// and tells the narrator they are unchanged, while the never-skipped roles still run; a Re-run asks
// again; and with persistence off every call is today's.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { type PersistAsk, sceneBasis, ScenePersistence } from "../../src/backend/agents/persist";
import { calendarOf, dayPartAt } from "../../src/engine/calendar";
import { outputsOf } from "../../src/engine/outputs";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { holderOf, isThing } from "../../src/engine/things";
import { axesOf, regardBand } from "../../src/packs/relationships/core/index";
import { BASIS_SIGNALS, type BasisSignal, basisChanged, defaultStages, NEVER_SKIPPED, type PlanInput, type PlanRow, roleRunOf, roleRuns, type SceneBasis, turnPlan } from "../../src/shared/agent-pipeline";
import { ROLE_IDS, type RoleId } from "../../src/shared/agent-roles";
import { agentSettingsOf } from "../../src/shared/agent-settings";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { Rec } from "../../src/shared/ledger";
import { MINDS_EVENTS } from "../../src/shared/minds";
import type { WorldDoc } from "../../src/shared/world";
import { alderChat, DANNY, MARCUS, PRIYA, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

const MIND = /You are the private mind of (.+?) in the roleplay world/;
const SCENE_MARK = "You are the scene agent of LumiRPEngine";
const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const MEMORY_MARK = "You keep the memory of";
const NOTE = "SCENE-NOTE: the counter is quiet this morning.";
const UNCHANGED = "Unchanged since the last turn.";

// ---------------------------------------------------------------- the scene basis

/** Port Alder with Danny and Priya beside the player character: its state and world, and the engine's registry. */
async function scene(): Promise<{ rig: Rig; state: WorldState; world: WorldDoc }> {
  const rig = new Rig({ shipped: true, minds: true });
  const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
  return { rig, ...(await stateOf(rig, chatId)) };
}

/** `state` with `change` made to a copy of it. */
function changed(state: WorldState, change: (s: WorldState) => void): WorldState {
  const s = structuredClone(state);
  change(s);
  return s;
}

/** Moves `who` to `place`, as a move leaves them: there, held by nothing. */
function moveTo(s: WorldState, who: string, place: string): void {
  const e = s.entities[who];
  if (!e) throw new Error(`no ${who}`);
  e.fields = { ...e.fields, place };
  e.relations = e.relations.filter((r) => r.type !== "in");
}

describe("the scene basis, signal by signal", () => {
  test("each signal changes alone when only its part of the scene does; the marks are the chain's", async () => {
    const { rig, state, world } = await scene();
    const reg = rig.rt.registry;
    const base = sceneBasis(reg, world, state, 3);
    const here = placeOfEntity(state, world.pov);
    if (!here) throw new Error("the POV is nowhere");
    expect(Object.keys(base)).toEqual([...BASIS_SIGNALS]);
    // The same scene reads the same basis.
    expect(basisChanged(base, sceneBasis(reg, world, structuredClone(state), 3))).toEqual([]);
    const only = (s: WorldState, w: WorldDoc = world, marks = 3): BasisSignal[] => basisChanged(base, sceneBasis(reg, w, s, marks));
    // A GM fix or a marker since.
    expect(only(state, world, 4)).toEqual(["marks"]);
    // The world's revision.
    expect(only(changed(state, (s) => (s.revision = `${s.revision}-next`)))).toEqual(["revision"]);
    // The live lore: an entry added, or one the turn reads changed.
    expect(only(state, { ...world, lore: { ...world.lore, harbor_rumor: { id: "harbor_rumor", title: "A rumor", content: "The ferry is late again.", keys: ["ferry"], links: [] } } })).toEqual(["lore"]);
    // The time of day: the first hour on that is in another part of the day.
    const cal = calendarOf(world);
    let later = state.clock;
    while (dayPartAt(cal, later).id === dayPartAt(cal, state.clock).id) later += 60;
    expect(only(changed(state, (s) => (s.clock = later)))).toEqual(["dayPart"]);
    // The things here: one more lying where the player character is.
    const ctx = reg.context(world, state);
    const thing = Object.keys(state.entities).find((id) => isThing(ctx, id));
    const like = thing ? state.entities[thing] : undefined;
    if (!like) throw new Error("Port Alder has no things");
    expect(only(changed(state, (s) => (s.entities.test_mug = { ...structuredClone(like), name: "A chipped mug", fields: { place: here }, relations: [] })))).toEqual(["things"]);
    // A thing on someone present changes: still the things.
    const carried = Object.keys(state.entities).find((id) => isThing(ctx, id) && [world.pov, DANNY, PRIYA].includes(holderOf(state, id) ?? ""));
    if (carried) {
      const renamed = changed(state, (s) => {
        const it = s.entities[carried];
        if (it) it.name = "Something else";
      });
      expect(only(renamed)).toEqual(["things"]);
    }
    // How they regard each other: Danny comes to think the world of Priya.
    const warm = changed(state, (s) => {
      const danny = s.entities[DANNY];
      if (!danny) throw new Error("no Danny");
      const fields: JsonObject = { ...Object.fromEntries(axesOf(ctx).map((a) => [a.id, a.max])), t: s.clock };
      danny.relations = [...danny.relations.filter((r) => !(r.type === "regard" && r.to === PRIYA)), { type: "regard", to: PRIYA, fields }];
    });
    expect(regardBand(reg.context(world, warm), DANNY, PRIYA)).not.toBe(regardBand(ctx, DANNY, PRIYA));
    expect(only(warm)).toEqual(["regard"]);
    // Who is here: Marcus walks in; the place stays.
    const arrived = only(changed(state, (s) => moveTo(s, MARCUS, here)));
    expect(arrived).toContain("present");
    expect(arrived).not.toContain("place");
    // The place: everyone goes elsewhere together, where others may be, and other things.
    const elsewhere = Object.keys(world.places).find((p) => p !== here);
    if (!elsewhere) throw new Error("Port Alder has one place");
    const moved = only(changed(state, (s) => [world.pov, DANNY, PRIYA].forEach((who) => moveTo(s, who, elsewhere))));
    expect(moved).toContain("place");
    expect(moved).not.toContain("dayPart");
  });
});

// ---------------------------------------------------------------- when the last scene holds

const BASIS: SceneBasis = { place: "shop", present: "danny@shop,priya@shop", dayPart: "morning", revision: "r1", lore: "lore-1", things: "things-1", regard: "danny>priya:neutral", marks: "2" };
const REPLY = { messageId: "m2", swipeId: 0 };
const ON = { on: true, turns: 2, minutes: 30 };

/** A turn asking whether the last scene holds: a new turn after `REPLY`, on `BASIS` at `clock`, with persistence `ON` unless said. */
const ask = (over: Partial<PersistAsk> = {}): PersistAsk => ({ settings: ON, kind: "normal", after: REPLY, basis: BASIS, clock: 100, ...over });

describe("when the last turn's scene holds", () => {
  test("only on a new turn after the reply whose scene is known, with persistence on; each why in words", () => {
    const p = new ScenePersistence();
    expect(p.hold("chat", ask({ settings: { ...ON, on: false } }))).toEqual({ holds: false, why: "Smart persistence is off." });
    expect(p.hold("chat", ask())).toEqual({ holds: false, why: "The last turn's scene isn't known: its roles ran on another reply, or before a restart." });
    p.begin("gen1", "chat", BASIS, 100);
    p.closed("gen1", REPLY, 2);
    expect(p.hold("chat", ask())).toEqual({ holds: true });
    // Never on a Re-run, a swipe, a Continue, an impersonation or a Re-narrate.
    expect(p.hold("chat", ask({ kind: "regenerate" }))).toEqual({ holds: false, why: "A Re-run asks every role again." });
    expect(p.hold("chat", ask({ kind: "swipe" }))).toEqual({ holds: false, why: "A swipe asks every role again." });
    expect(p.hold("chat", ask({ kind: "continue" }))).toEqual({ holds: false, why: "A Continue plays no turn." });
    expect(p.hold("chat", ask({ kind: "impersonate" }))).toEqual({ holds: false, why: "An impersonation plays no turn." });
    expect(p.hold("chat", ask({ kind: "renarrate" }))).toEqual({ holds: false, why: "A Re-narrate tells its turn's own plan." });
    // After another reply (a swipe of it, a Branch), or in another chat, the scene isn't known.
    expect(p.hold("chat", ask({ after: { ...REPLY, swipeId: 1 } })).holds).toBe(false);
    expect(p.hold("other", ask()).holds).toBe(false);
    // A scene that changed says what did, in its words.
    expect(p.hold("chat", ask({ basis: { ...BASIS, dayPart: "noon", things: "things-2" } }))).toEqual({ holds: false, why: "The scene changed: the time of day, the things here." });
    // A mark or GM fix since the turn closed changes the scene: the marks it closed with are the chain's then.
    expect(p.hold("chat", ask({ basis: { ...BASIS, marks: "3" } }))).toEqual({ holds: false, why: "The scene changed: a GM fix or marker since." });
    // Past the world minutes since its roles last ran afresh.
    expect(p.hold("chat", ask({ clock: 131 }))).toEqual({ holds: false, why: "31 world minutes passed since its roles last ran, more than Smart persistence keeps." });
    expect(p.hold("chat", ask({ clock: 130 }))).toEqual({ holds: true });
    // Forgotten, nothing holds.
    p.forget("chat");
    expect(p.hold("chat", ask()).holds).toBe(false);
  });

  test("a turn that kept counts on from the last; past the turns in a row the next asks afresh, and a fresh turn starts the count over", () => {
    const p = new ScenePersistence();
    const turn = (gen: string, messageId: string, clock: number, kept: boolean): void => {
      p.begin(gen, "chat", BASIS, clock);
      if (kept) p.keptIn(gen);
      p.closed(gen, { messageId, swipeId: 0 }, 2);
    };
    turn("g1", "m1", 100, false);
    turn("g2", "m2", 105, true);
    turn("g3", "m3", 110, true);
    expect(p.hold("chat", ask({ after: { messageId: "m3", swipeId: 0 }, clock: 115 }))).toEqual({ holds: false, why: "It was kept 2 turns in a row, the most Smart persistence keeps." });
    // The minutes count from when its roles last ran afresh, not from the last kept turn.
    turn("g4", "m4", 112, true);
    expect(p.hold("chat", ask({ settings: { ...ON, turns: 9 }, after: { messageId: "m4", swipeId: 0 }, clock: 131 }))).toEqual({ holds: false, why: "31 world minutes passed since its roles last ran, more than Smart persistence keeps." });
    // A fresh turn: the count and the minutes start over.
    turn("g5", "m5", 140, false);
    expect(p.kept("g5")).toBe(false);
    expect(p.hold("chat", ask({ after: { messageId: "m5", swipeId: 0 }, clock: 150 }))).toEqual({ holds: true });
    // A turn another generation took goes with it.
    p.begin("g6", "chat", BASIS, 150);
    p.keptIn("g6");
    p.adopted("g6", "g7");
    expect([p.kept("g6"), p.kept("g7")]).toEqual([false, true]);
  });
});

// ---------------------------------------------------------------- the pipeline map

describe("the pipeline map", () => {
  test("never skipped: the intent, knowledge, read, Curator, memory, skip and world steps are never kept and never off, whatever is stored", () => {
    expect(NEVER_SKIPPED).toEqual(["intent", "knowledge", "read", "curator", "memory", "skip", "world"]);
    for (const role of NEVER_SKIPPED) {
      expect(roleRuns(role)).toEqual(["smart"]);
      for (const stored of ["off", "always", "smart", "never", 3]) expect(roleRunOf(role, stored, "smart")).toBe("smart");
    }
    // Minds and the scene may be kept or switched off; the director only switched off.
    expect([roleRuns("scene"), roleRuns("minds"), roleRuns("director")]).toEqual([["smart", "always", "off"], ["smart", "always", "off"], ["smart", "off"]]);
    expect([roleRunOf("minds", "always", "smart"), roleRunOf("director", "always", "smart"), roleRunOf("director", "off", "smart"), roleRunOf("scene", "sometimes", "off")]).toEqual(["always", "smart", "off", "off"]);
    // As the settings store reads them: an off read, a kept Curator, read as every role's run.
    const read = agentSettingsOf({ roles: { read: { run: "off" }, curator: { run: "always" }, scene: { run: "off" }, minds: { run: "always" } } });
    expect(Object.fromEntries(ROLE_IDS.map((r) => [r, read.roles[r].run]))).toEqual({ ...Object.fromEntries(ROLE_IDS.map((r) => [r, "smart"])), scene: "off", minds: "always" });
  });
});

// ---------------------------------------------------------------- the turn's plan

/** A plan's input at the defaults, on the fixed pipeline, with persistence off. */
function planInput(over: Partial<PlanInput> = {}): PlanInput {
  const runs = Object.fromEntries(ROLE_IDS.map((r) => [r, "smart"])) as PlanInput["runs"];
  return { main: false, stages: defaultStages(), runs, curator: true, persist: { holds: false, why: "Smart persistence is off." }, kept: { minds: 0, due: 2, scene: false }, asked: {}, ...over };
}

const statusOf = (rows: readonly PlanRow[]): Record<string, string> => Object.fromEntries(rows.map((r) => [r.role, r.status]));
const whyOf = (rows: readonly PlanRow[], role: RoleId): string => rows.find((r) => r.role === role)?.why ?? "";

describe("the turn's plan", () => {
  test("on the fixed pipeline every role runs when the turn asks; one switched off, the Curator off and one the turn asks nothing of say so", () => {
    const all = turnPlan(planInput());
    expect(all.map((r) => r.role)).toEqual([...ROLE_IDS]);
    expect(Object.values(statusOf(all))).toEqual(ROLE_IDS.map(() => "runs"));
    expect(whyOf(all, "read")).toBe("The fixed pipeline runs it when the turn asks.");
    // The roles persistence may keep say why it doesn't.
    expect(whyOf(all, "minds")).toBe("The fixed pipeline runs it when the turn asks. It isn't kept: smart persistence is off.");
    const some = turnPlan(planInput({ runs: { ...planInput().runs, director: "off", minds: "always" }, curator: false, asked: { knowledge: "The chat doesn't track knowledge: GM → This chat.", skip: "The turn plays no timelapse." } }));
    expect(statusOf(some)).toMatchObject({ director: "off", curator: "off", knowledge: "none", skip: "none", minds: "runs" });
    expect(whyOf(some, "director")).toBe("Switched off on its page: Settings → Agents → Roles, When it runs.");
    expect(whyOf(some, "curator")).toBe("Off in Settings → Agents → Pipeline: the read does its work.");
    expect(whyOf(some, "knowledge")).toBe("The chat doesn't track knowledge: GM → This chat.");
    // Every time, never kept: no word of persistence.
    expect(whyOf(some, "minds")).toBe("The fixed pipeline runs it when the turn asks.");
  });

  test("kept: the scene's lore and notes, every mind due, or some of them; the never-skipped roles run all the same", () => {
    const held = { holds: true } as const;
    const kept = turnPlan(planInput({ persist: held, kept: { minds: 2, due: 2, scene: true } }));
    expect(statusOf(kept)).toEqual({ ...Object.fromEntries(ROLE_IDS.map((r) => [r, "runs"])), scene: "kept", minds: "kept" });
    expect(whyOf(kept, "minds")).toBe("All 2 minds due are kept unchanged since the last turn (Smart persistence).");
    expect(whyOf(kept, "scene")).toBe("Its lore and notes are kept: the scene is unchanged since the last turn (Smart persistence).");
    for (const role of NEVER_SKIPPED) expect(statusOf(kept)[role]).toBe("runs");
    const one = turnPlan(planInput({ persist: held, kept: { minds: 1, due: 2, scene: false } }));
    expect([statusOf(one).minds, whyOf(one, "minds")]).toEqual(["runs", "1 mind is kept unchanged since the last turn (Smart persistence). The fixed pipeline runs it when the turn asks."]);
  });

  test("with a main agent deciding: the stages it decides, and a role whose every stage runs on its own is auto", () => {
    const main = turnPlan(planInput({ main: true }));
    expect(whyOf(main, "director")).toBe("The main agent decides it in stage 3, stage 5, stage 7.");
    const prepare = turnPlan(planInput({ main: true, stages: { ...defaultStages(), prepare: "auto" }, persist: { holds: true } }));
    expect(statusOf(prepare)).toMatchObject({ scene: "auto", minds: "auto", skip: "auto", intent: "runs", director: "runs", read: "runs" });
    expect(whyOf(prepare, "scene")).toBe("Its stage runs on its own, as the fixed pipeline runs it: Settings → Agents → Main agent → Stages.");
    expect(whyOf(prepare, "intent")).toBe("The main agent decides it in stage 1, stage 3; stage 3 runs on its own.");
  });
});

// ---------------------------------------------------------------- two quiet turns

/** Every role prompt-only but the scene, which is an agent: classic's own mind calls, and the scene role's agent call. */
const ROLES = Object.fromEntries(ROLE_IDS.map((role) => [role, { promptOnly: role !== "scene" }]));

/** Minds answer plainly, the scene role writes NOTE, the read proposes nothing; every other step says nothing. */
function models(rig: Rig): void {
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    const mind = MIND.exec(system)?.[1];
    if (mind) return JSON.stringify({ monologue: `THOUGHT-MARK of ${mind}.`, depiction: `${mind} looks up`, intent: "Wait and see.", reactions: [], mood: "calm" });
    if (system.includes(SCENE_MARK)) return JSON.stringify({ lore: [], notes: [NOTE] });
    if (system.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (system.includes(MEMORY_MARK)) return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [], told: [] });
    if (system.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [] });
    return "{}";
  };
}

/** Port Alder on agents with Danny and Priya beside the player character, minds on; persistence `on`, a world hour of it. */
async function quietChat(rig: Rig, on: boolean): Promise<string> {
  const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: ROLES, persist: { on, minutes: 60 }, finalReview: { on: false } } } }));
  expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
  models(rig);
  return chatId;
}

/** What a turn asked of the models, by kind: each mind by name, the scene role, the read and the memory. */
function asked(calls: readonly QuietRequest[]): { minds: string[]; scene: number; read: number; memory: number } {
  const systems = calls.map((c) => c.messages[0]?.content ?? "");
  return { minds: systems.flatMap((s) => MIND.exec(s)?.[1] ?? []).sort(), scene: systems.filter((s) => s.includes(SCENE_MARK)).length, read: systems.filter((s) => s.includes(EXTRACT_MARK)).length, memory: systems.filter((s) => s.includes(MEMORY_MARK)).length };
}

async function headRecord(rig: Rig, chatId: string): Promise<Rec> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
  if (!rec) throw new Error("no record");
  return rec;
}

/** Plays a turn (`text` sent, else a Re-run of the head reply) with `reply`: what it asked, its narrator's Minds and Scene, its record and its plan. */
async function turn(rig: Rig, chatId: string, text: string | null, reply: string) {
  if (text !== null) {
    rig.host.sendUser(chatId, text);
    await rig.host.settle();
  }
  const from = rig.host.quietCalls.length;
  const g = await rig.host.start(chatId, { type: text === null ? "regenerate" : "normal" });
  expect(g.halted).toBeUndefined();
  const minds = rig.host.section("Minds");
  const sceneSection = rig.host.section("Scene");
  await rig.host.finish(g, reply);
  const plan = rig.rt.live.view(chatId, rig.host.userId)?.entries.find((e) => e.kind === "plan");
  return { asked: asked(rig.host.quietCalls.slice(from)), minds, scene: sceneSection, rec: await headRecord(rig, chatId), plan: plan?.kind === "plan" ? plan.rows : [] };
}

/** The reasons the record's minds were recorded with, by who. */
const mindReasons = (rec: Rec): Record<string, unknown> => Object.fromEntries(rec.events.flatMap((e) => (e.type === MINDS_EVENTS.mind && "data" in e && isRecord(e.data) ? [[e.data.entity, e.data.reason]] : [])));

describe("two quiet turns", () => {
  test("the second asks no mind and no scene role: their copies are recorded marked kept, the narrator is told so, and the read and the memory run as ever; a Re-run asks again", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await quietChat(rig, true);
    const first = await turn(rig, chatId, "I look around the shop.", "The shop is quiet.");
    expect(first.asked).toMatchObject({ minds: ["Danny Okafor", "Priya Nair"], scene: 1 });
    expect(mindReasons(first.rec)).toEqual({ [DANNY]: "live", [PRIYA]: "live" });
    expect(outputsOf(first.rec.events.slice(0, first.rec.pre))?.scene).toEqual({ lore: [], notes: [NOTE], kept: false });
    expect(first.minds).not.toContain(UNCHANGED);
    // Nothing in the scene changed: the second turn keeps both minds and the scene's notes.
    const second = await turn(rig, chatId, "I wait by the counter.", "Nothing much happens.");
    expect(second.asked).toMatchObject({ minds: [], scene: 0 });
    expect(second.asked.read).toBeGreaterThan(0);
    expect(second.asked.memory).toBeGreaterThan(0);
    expect(mindReasons(second.rec)).toEqual({ [DANNY]: "kept", [PRIYA]: "kept" });
    expect(outputsOf(second.rec.events.slice(0, second.rec.pre))?.scene).toEqual({ lore: [], notes: [NOTE], kept: true });
    // Each kept mind's line, and the Scene's notes, end saying so.
    expect(second.minds).toContain(`THOUGHT-MARK of Danny Okafor.`);
    expect(second.minds.split("\n").filter((l) => l.includes("THOUGHT-MARK")).every((l) => l.endsWith(UNCHANGED))).toBe(true);
    expect(second.scene).toContain(NOTE);
    expect(second.scene).toContain(UNCHANGED);
    // GM → Live's plan says what was kept, and that every never-skipped role ran.
    expect(statusOf(second.plan)).toMatchObject({ minds: "kept", scene: "kept", read: "runs", curator: "runs", memory: "runs", intent: "runs" });
    expect(statusOf(first.plan).minds).toBe("runs");
    expect(whyOf(first.plan, "minds")).toContain("It isn't kept: the last turn's scene isn't known");
    // A Re-run of it asks every role again.
    const again = await turn(rig, chatId, null, "Still nothing.");
    expect(again.asked).toMatchObject({ minds: ["Danny Okafor", "Priya Nair"], scene: 1 });
    expect(mindReasons(again.rec)).toEqual({ [DANNY]: "live", [PRIYA]: "live" });
    expect(whyOf(again.plan, "minds")).toContain("a Re-run asks every role again");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a mind the player names is asked again while the other stays kept", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await quietChat(rig, true);
    await turn(rig, chatId, "I look around the shop.", "The shop is quiet.");
    const second = await turn(rig, chatId, "I nod to Danny.", "Nothing much happens.");
    expect(second.asked.minds).toEqual(["Danny Okafor"]);
    expect(mindReasons(second.rec)).toEqual({ [DANNY]: "live", [PRIYA]: "kept" });
    expect(statusOf(second.plan).minds).toBe("runs");
    expect(whyOf(second.plan, "minds")).toStartWith("1 mind is kept unchanged since the last turn");
  });

  test("with persistence off, the second turn's calls are today's", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await quietChat(rig, false);
    await turn(rig, chatId, "I look around the shop.", "The shop is quiet.");
    const second = await turn(rig, chatId, "I wait by the counter.", "Nothing much happens.");
    expect(second.asked).toMatchObject({ minds: ["Danny Okafor", "Priya Nair"], scene: 1 });
    expect(mindReasons(second.rec)).toEqual({ [DANNY]: "live", [PRIYA]: "live" });
    expect(outputsOf(second.rec.events.slice(0, second.rec.pre))?.scene.kept).toBe(false);
    expect(second.minds).not.toContain(UNCHANGED);
    expect(whyOf(second.plan, "minds")).toContain("It isn't kept: smart persistence is off.");
  });

  test("a role set to run every time is never kept; one switched off makes no call and the turn goes on", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await quietChat(rig, true);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { minds: { run: "always" }, scene: { run: "off" } } } } }));
    const first = await turn(rig, chatId, "I look around the shop.", "The shop is quiet.");
    expect(first.asked).toMatchObject({ minds: ["Danny Okafor", "Priya Nair"], scene: 0 });
    expect(outputsOf(first.rec.events.slice(0, first.rec.pre))?.scene).toEqual({ lore: [], notes: [], kept: false });
    const second = await turn(rig, chatId, "I wait by the counter.", "Nothing much happens.");
    expect(second.asked).toMatchObject({ minds: ["Danny Okafor", "Priya Nair"], scene: 0 });
    expect(statusOf(second.plan)).toMatchObject({ minds: "runs", scene: "off" });
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

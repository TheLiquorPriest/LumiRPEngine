// What an agent turn's roles are held to (DESIGN §4.6, §9.2), on Port Alder with scripted models: the
// director's brief and outline are checked against the turn it was given, as it started and as it
// ends, and a line that has someone here whom both have elsewhere, gone whom both have here, holding
// a thing they have at neither, or a thing lying where it lies at neither, is flagged and told with
// its run, never silently, and kept for the narrator, while the turn's own give, put-down and
// leaving are told as they happen; the read is given the engine's clock as the Scene tells it, when
// the message came and now, and a time of day it measures from when the message came lands the clock
// where the reply says; and every text that tells a model the turn's time tells the Scene's: the
// helpers' facts, the director's clock and the Scene's elapsed time, from when to when.

import { describe, expect, test } from "bun:test";
import { proseClashes } from "../../src/backend/agents/roles/prose-check";
import type { QuietRequest } from "../../src/backend/host";
import { factLines, sceneClock } from "../../src/backend/turn-steps";
import { clockMinutes } from "../../src/backend/view";
import { calendarOf, formatClock, formatTimeOfDay, parseHHMM } from "../../src/engine/calendar";
import { together } from "../../src/engine/presence";
import { placeOfEntity } from "../../src/engine/scope";
import { holderOf } from "../../src/packs/gear/core/model";
import { ROLE_LABEL } from "../../src/shared/agent-roles";
import type { JsonObject } from "../../src/shared/json";
import type { Rec } from "../../src/shared/ledger";
import { PROMPTS } from "../../src/shared/prompts";
import { alderChat, DANNY, MARCUS, PRIYA, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

/** The brief and the outline on, with calls enough before the reply for both, and no person's choice asked. */
const PROSE: JsonObject = { modelUse: { steps: { brief: { enabled: true, signals: ["always"] }, outline: { enabled: true, signals: ["always"] }, "npc.choose": { enabled: false } }, budgets: { pre: { calls: 8 } } } };

/** A call as the scripted models saw it: the role whose agent made it, and everything it was sent. */
interface Seen {
  role: string | null;
  all: string;
}

/** Scripted models: each role's agent answers as `roles` says for it, else in its contract with nothing. */
function scripted(rig: Rig, roles: Readonly<Record<string, (all: string) => string>> = {}): Seen[] {
  const seen: Seen[] = [];
  rig.host.quietReply = (req: QuietRequest) => {
    const role = /You are the (\w+) agent of LumiRPEngine/.exec(req.messages[0]?.content ?? "")?.[1] ?? null;
    const all = req.messages.map((m) => m.content).join("\n");
    seen.push({ role, all });
    const own = role === null ? undefined : roles[role];
    if (own) return own(all);
    if (role === "scene") return JSON.stringify({ lore: [], notes: [] });
    if (role === "intent") return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (role === "read") return JSON.stringify({ proposals: [], where: null });
    return "{}";
  };
  return seen;
}

/** Port Alder on agents, the roles agent-backed (§15's default), with Danny and Priya beside the player character; `patch` joins the settings. */
async function agentsChat(rig: Rig, patch: JsonObject = {}): Promise<string> {
  const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
  rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { steps: { "npc.choose": { enabled: false } } } } }));
  if (Object.keys(patch).length > 0) rig.body(await rig.send({ type: "lre.settings.set", patch }));
  expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
  return chatId;
}

async function lastRecord(rig: Rig, chatId: string): Promise<Rec> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
  if (!rec) throw new Error("no record");
  return rec;
}

/** Plays `text` with `reply`: what the narrator was told, and its Scene section. */
async function played(rig: Rig, chatId: string, text: string, reply: string): Promise<{ told: string; scene: string }> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  expect(g.halted).toBeUndefined();
  const told = rig.host.assembled.map((e) => e.content).join("\n");
  const scene = rig.host.section("Scene");
  await rig.host.finish(g, reply);
  return { told, scene };
}

describe("the director's lines, held to the turn it was given", () => {
  test("flags someone here whom the state has elsewhere, someone gone whom it has here, a thing in hands that don't hold it and a thing lying where it isn't; leaves alone what is told as remote, arriving or leaving, a thing the world doesn't have, and what holds", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    const { world, state } = await stateOf(rig, chatId);
    // A turn that ends as it started.
    const clash = proseClashes(rig.rt.registry, world, state, state);
    // Marcus Delgado is at home on Birch Lane; Danny and Priya are with Jordan, Priya holding the festival clipboard and Jordan the pocketknife.
    expect(clash("Marcus Delgado leans on the counter beside Jordan.")).toBe("here");
    expect(clash("Marcus nods at Jordan.")).toBe("here");
    expect(clash("Jordan texts Marcus Delgado about the fleet contract.")).toBeNull();
    expect(clash("Danny remembers Marcus says the shop opens late.")).toBeNull();
    expect(clash("Marcus Delgado waits at 12 Birch Lane.")).toBeNull();
    // Told as arriving, or as leaving: the scene changing, which the state may not hold yet.
    expect(clash("Marcus nods as Jordan walks in.")).toBeNull();
    expect(clash("Marcus nods as Jordan heads out the door.")).toBeNull();
    expect(clash("Marcus says goodbye to Jordan.")).toBeNull();
    expect(clash("Danny Okafor wipes his hands and nods at Jordan.")).toBeNull();
    expect(clash("Priya Nair has already left.")).toBe("gone");
    expect(clash("Priya isn't here this morning.")).toBe("gone");
    expect(clash("Danny has gone quiet.")).toBeNull();
    expect(clash("Priya hands Jordan the festival clipboard.")).toBeNull();
    expect(clash("Danny hands Jordan the festival clipboard.")).toBe("holds");
    expect(clash("Danny hands Jordan his clipboard.")).toBeNull();
    expect(clash("Danny draws the pocketknife.")).toBe("holds");
    expect(clash("Jordan draws the pocketknife.")).toBeNull();
    expect(clash("Danny draws the revolver.")).toBeNull();
    expect(clash("The festival clipboard sits on the counter.")).toBe("lies");
    expect(clash("A mug sits on the counter.")).toBeNull();
  });

  test("holds each line to the turn as it started and as it ends: the turn's own hand-over, put-down and leaving stand, and a line that fits neither is still flagged", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    const start = await stateOf(rig, chatId);
    const named = (needle: string): string => {
      const id = Object.keys(start.state.entities).find((k) => (start.state.entities[k]?.name ?? "").toLowerCase() === needle);
      if (!id) throw new Error(`no ${needle}`);
      return id;
    };
    const clipboard = named("festival clipboard");
    const knife = named("pocketknife");
    // The turn's own actions, as its planned state holds them: Priya hands Jordan the clipboard, and Jordan drops the pocketknife where he stands.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "put", entity: clipboard, into: "pov" }, { op: "put", entity: knife, into: null }] }));
    const given = await stateOf(rig, chatId);
    expect([holderOf(start.state, clipboard), holderOf(given.state, clipboard), holderOf(start.state, knife), holderOf(given.state, knife)]).toEqual([PRIYA, "pov", "pov", null]);
    expect(placeOfEntity(given.state, knife)).toBe(placeOfEntity(given.state, "pov"));
    const turn = proseClashes(rig.rt.registry, given.world, start.state, given.state);
    // What the turn's own actions are told as: who had a thing as it started hands it over or puts it down, and who has it as it ends holds it.
    for (const line of [
      "Priya hands Jordan the festival clipboard.",
      "Priya passes Jordan the festival clipboard.",
      "Priya holds the festival clipboard.",
      "Jordan holds the festival clipboard.",
      "Jordan drops the pocketknife.",
      "Jordan sets down the pocketknife.",
      "Jordan puts down the pocketknife.",
      "Jordan lays down the pocketknife.",
      "The pocketknife lies on the floor.",
    ])
      expect(turn(line)).toBeNull();
    // The state as it ends alone had each of the hand-over and put-down lines contradict it.
    const ended = proseClashes(rig.rt.registry, given.world, given.state, given.state);
    for (const line of ["Priya hands Jordan the festival clipboard.", "Jordan drops the pocketknife.", "Jordan sets down the pocketknife."]) expect(ended(line)).toBe("holds");
    // Still flagged: what fits neither moment.
    expect(turn("Danny hands Jordan the festival clipboard.")).toBe("holds");
    expect(turn("Danny draws the pocketknife.")).toBe("holds");
    expect(turn("Marcus Delgado leans on the counter beside Jordan.")).toBe("here");
    expect(turn("Priya Nair has already left.")).toBe("gone");
    expect(turn("The festival clipboard sits on the counter.")).toBe("lies");

    // A turn in which Jordan leaves for the Rusty Anchor: whoever he leaves was with him as it started.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "pov", to: "rusty_anchor" }] }));
    const left = await stateOf(rig, chatId);
    expect(together(left.world, placeOfEntity(left.state, "pov"), placeOfEntity(left.state, DANNY))).toBe(false);
    const leaving = proseClashes(rig.rt.registry, left.world, given.state, left.state);
    for (const line of ["Danny nods as Jordan heads for the door.", "Danny says goodbye to Jordan.", "Danny nods at Jordan.", "Priya smiles at Jordan."]) expect(leaving(line)).toBeNull();
    expect(proseClashes(rig.rt.registry, left.world, left.state, left.state)("Danny nods at Jordan.")).toBe("here");
    // Marcus is with him at neither moment.
    for (const s of [given.state, left.state]) expect(together(left.world, placeOfEntity(s, "pov"), placeOfEntity(s, MARCUS))).toBe(false);
    expect(leaving("Marcus Delgado leans on the counter beside Jordan.")).toBe("here");
    expect(leaving("Marcus nods at Jordan.")).toBe("here");
  });

  test("a line that contradicts it is flagged and told with the run, in Diagnostics and the host log, and still reaches the narrator with the rest", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, PROSE);
    const here = "Marcus Delgado leans on the counter beside Jordan.";
    const hands = "Danny hands Jordan the festival clipboard.";
    const seen = scripted(rig, { director: () => JSON.stringify({ brief: "BRIEF-OK The harbor is grey this morning. Marcus Delgado sits at the counter beside Jordan.", beats: ["OUTLINE-OK Jordan looks out at the harbor.", here, hands] }) });
    const { told } = await played(rig, chatId, "I look out at the harbor.", "The harbor is calm.");
    expect(seen.some((s) => s.role === "director")).toBe(true);
    expect(told).toContain("OUTLINE-OK Jordan looks out at the harbor.");
    expect(told).toContain("BRIEF-OK The harbor is grey this morning.");
    for (const line of [here, hands, "Marcus Delgado sits at the counter"]) expect(told).toContain(line);
    const said = `2 flagged, still in the reply's prompt (it has someone here whom the engine has elsewhere: "Marcus Delgado sits at the counter beside Jordan."; "${here}"); 1 flagged, still in the reply's prompt (it has someone hold or hand over a thing the engine says they don't have: "${hands}")`;
    const records = await rig.rt.diag.records(chatId, rig.host.userId);
    expect(records.some((r) => r.step === ROLE_LABEL.director && r.level === "warn" && (r.reason ?? "").includes(said))).toBe(true);
    expect(rig.host.logs.some((l) => l.includes(`the ${ROLE_LABEL.director} role's run: What the engine didn't take: ${said}`))).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("an agent turn's own give reaches the narrator as the director tells it, unflagged; a hand that never had the thing is still flagged", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, PROSE);
    const { state } = await stateOf(rig, chatId);
    const knife = Object.keys(state.entities).find((k) => (state.entities[k]?.name ?? "").toLowerCase() === "pocketknife");
    if (!knife) throw new Error("no pocketknife");
    const give = "Jordan hands Danny the pocketknife.";
    const never = "Priya draws the pocketknife.";
    scripted(rig, {
      intent: () => JSON.stringify({ action: "give", params: { item: knife, to: DANNY }, confidence: 0.95 }),
      director: () => JSON.stringify({ brief: "BRIEF-OK Jordan offers Danny the knife.", beats: ["OUTLINE-OK Jordan turns to Danny.", give, never] }),
    });
    const { told } = await played(rig, chatId, "I hand Danny my pocketknife.", "Danny takes the knife.");
    // The engine played the give: the knife is Danny's as the turn ends.
    expect(holderOf((await stateOf(rig, chatId)).state, knife)).toBe(DANNY);
    expect(told).toContain("OUTLINE-OK Jordan turns to Danny.");
    expect(told).toContain(give);
    expect(told).toContain(never);
    const records = await rig.rt.diag.records(chatId, rig.host.userId);
    const director = records.filter((r) => r.step === ROLE_LABEL.director && (r.reason ?? "").includes("flagged"));
    expect(director.map((r) => r.reason ?? "").join("\n")).toContain(`1 flagged, still in the reply's prompt (it has someone hold or hand over a thing the engine says they don't have: "${never}")`);
    expect(director.some((r) => (r.reason ?? "").includes(give))).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("an agent turn in which the player character leaves tells whom they leave behind; someone with them neither as it started nor as it ended is still flagged", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, PROSE);
    const before = await stateOf(rig, chatId);
    const farewell = "Danny nods as Jordan heads for the door.";
    const nod = "Priya smiles at Jordan.";
    const away = "Marcus Delgado leans on the counter beside Jordan.";
    scripted(rig, {
      intent: () => JSON.stringify({ action: "go", params: { to: "rusty_anchor" }, confidence: 0.95 }),
      director: () => JSON.stringify({ brief: "BRIEF-OK Jordan leaves for the Rusty Anchor.", beats: ["OUTLINE-OK Jordan grabs a jacket.", farewell, nod, away] }),
    });
    const { told } = await played(rig, chatId, "I head over to the Rusty Anchor.", "You walk down to the Rusty Anchor.");
    const after = await stateOf(rig, chatId);
    // The engine played the move: Jordan is at the Rusty Anchor as the turn ends, Danny and Priya where he left them, and Marcus with him at neither end.
    expect(placeOfEntity(after.state, "pov")).toBe("rusty_anchor");
    for (const who of [DANNY, PRIYA]) expect(together(after.world, placeOfEntity(after.state, "pov"), placeOfEntity(after.state, who))).toBe(false);
    for (const s of [before.state, after.state]) expect(together(after.world, placeOfEntity(s, "pov"), placeOfEntity(s, MARCUS))).toBe(false);
    for (const line of ["OUTLINE-OK Jordan grabs a jacket.", farewell, nod, away]) expect(told).toContain(line);
    const said = `1 flagged, still in the reply's prompt (it has someone here whom the engine has elsewhere: "${away}")`;
    const records = await rig.rt.diag.records(chatId, rig.host.userId);
    expect(records.some((r) => r.step === ROLE_LABEL.director && r.level === "warn" && (r.reason ?? "").includes(said))).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("is told the engine's clock as the Scene tells it once the turn's actions are done, and from when to when they took", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig, PROSE);
    const before = (await stateOf(rig, chatId)).state.clock;
    const seen = scripted(rig, { director: () => JSON.stringify({ brief: "BRIEF-OK The harbor is grey.", beats: ["OUTLINE-OK Jordan looks out at the harbor."] }) });
    const { scene } = await played(rig, chatId, "I look out at the harbor.", "The harbor is calm.");
    const { world } = await stateOf(rig, chatId);
    const cal = calendarOf(world);
    const took = clockMinutes((await lastRecord(rig, chatId)).events);
    expect(took).toBeGreaterThan(0);
    const span = `This turn took ${took} min, from ${formatTimeOfDay(parseHHMM("06:15"))} to ${formatTimeOfDay(parseHHMM("06:15") + took)}.`;
    expect(formatClock(cal, before)).toBe("Mon 14 Sep 2026, 6:15 AM");
    const director = seen.find((s) => s.role === "director")?.all ?? "";
    expect(director).toContain(`The engine's clock reads ${formatClock(cal, before + took)} once this turn's actions are done. ${span}`);
    // The narrator's Scene tells the same span, under its time line.
    expect(scene).toContain(`Time: ${formatClock(cal, before + took)}`);
    expect(scene).toContain(span);
  });
});

describe("the read's clock", () => {
  test("is the Scene's, when the message came and now; a time of day the read measures from when the message came lands the clock where the reply says, past the minutes the turn's own actions took", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await agentsChat(rig);
    const { world, state } = await stateOf(rig, chatId);
    const cal = calendarOf(world);
    const before = state.clock;
    // Breakfast takes the half hour a meal does: from 6:15 to 6:45. The reply says it is seven when it ends.
    const meal = 30;
    const seven = before + parseHHMM("07:00") - parseHHMM("06:15");
    const seen = scripted(rig, {
      intent: () => JSON.stringify({ action: "eat", params: {}, confidence: 0.9 }),
      // A read that knows when the message came measures the reply's "seven" from it; one that doesn't measures from the clock its tools read now, the meal already on it.
      read: (all) => JSON.stringify({ proposals: [{ type: "time_advance", minutes: all.includes(`The engine's clock: ${formatClock(cal, before)} when the player's message came`) ? seven - before : seven - (before + meal) }], where: null }),
    });
    const { scene } = await played(rig, chatId, "I eat breakfast.", "You finish breakfast as the church bell rings seven.");
    const read = seen.find((s) => s.role === "read")?.all ?? "";
    expect(read).toContain(`The engine's clock: ${formatClock(cal, before)} when the player's message came; this turn's own actions took ${meal} min, to ${formatClock(cal, before + meal)}, which the engine has already applied.`);
    expect(scene).toContain(`This turn took ${meal} min, from 6:15 AM to 6:45 AM.`);
    expect(formatClock(cal, (await stateOf(rig, chatId)).state.clock)).toBe(formatClock(cal, seven));
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the time a turn's texts tell", () => {
  test("the helpers' facts lead with the time the Scene tells, the player character's local time where time zones show", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alderChat(rig, async () => {}, [DANNY]);
    // Chicago keeps its own time zone, an hour behind Port Alder's.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "pov", to: "chicago_il" }] }));
    const { world, state } = await stateOf(rig, chatId);
    const facts = factLines(rig.rt.registry, world, state, []);
    const shown = /^Time: (.+) \(/.exec(facts.find((l) => l.startsWith("Time: ")) ?? "")?.[1] ?? "no time line";
    expect(shown).not.toBe(formatClock(calendarOf(world), state.clock));
    expect(facts[0]).toEndWith(`it is ${shown}.`);
  });

  test("a timelapse's Time passed line tells the Scene's clock: it ends at the Scene's time, the player character's local time where time zones show", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alderChat(rig, async () => {}, [DANNY]);
    // Chicago keeps its own time zone, an hour behind Port Alder's.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: "pov", to: "chicago_il" }] }));
    const before = (await stateOf(rig, chatId)).state.clock;
    rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes("You map a player's typed input") ? JSON.stringify({ action: "timelapse", params: { span: "over the next hour" }, confidence: 0.9 }) : "{}");
    await rig.turn(chatId, "OOC: skip ahead an hour.", "An hour goes by.");
    const { world, state } = await stateOf(rig, chatId);
    const cal = calendarOf(world);
    const ctx = rig.rt.registry.context(world, state);
    expect(state.clock - before).toBe(60);
    const passed = rig.host.section("Outcome").split("\n").find((l) => l.startsWith("- Time passed: ")) ?? "no Time passed line";
    expect(passed).toContain(`Time passed: 1 hour, from ${sceneClock(ctx, before)} to ${sceneClock(ctx, state.clock)}`);
    expect(rig.host.section("Scene")).toContain(`Time: ${sceneClock(ctx, state.clock)}`);
    // Port Alder's own clock is not the one the Scene tells here.
    expect(passed).not.toContain(formatClock(cal, state.clock));
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the shipped texts", () => {
  test("the intent reads a message for the action it is for, with one example, and its answer says so; the read is told how a thing the world doesn't have yet is made", () => {
    const text = (id: string): string => PROMPTS.find((d) => d.id === id)?.text ?? "";
    const task = text("role.intent.interpret.task");
    expect(task).toContain("Read the input for what it is for: the one action that drives this turn");
    expect(task).toContain('"I get up from the couch, stretch, and sit down next to Danny to ask how his shift went" is the talk with Danny');
    expect(text("role.intent.interpret.answer")).toContain('"action" is the action the input is for');
    expect(text("role.read.extract.task")).toContain("is made only by a give from someone other than the player character");
    expect(text("role.read.extract.types")).toContain("for a thing the world doesn't have yet that someone other than the player character hands over, the reply's words for it, which makes it");
  });
});

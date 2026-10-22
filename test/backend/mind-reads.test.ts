// What a mind reads (DESIGN §24.5) on the fake host. The lore pinned for a character, within the cap
// the user set, reaches their mind whole in every minds path (the round before the reply, Run minds
// now, a time skip's beat), and nothing cuts what the memory step must read. By default a mind reads
// the story as it stands (the lore pinned for them, the lore the turn activates, how the latest reply
// ended and what the player says) and never the planner's day, a plan or a commitment, nor anything
// of another mind, whatever it reads of its own.

import { describe, expect, test } from "bun:test";
import { defaultSettings } from "../../src/backend/settings-store";
import type { JsonObject } from "../../src/shared/json";
import type { MindsRunView } from "../../src/shared/minds";
import { calendarOf, clockAt, dateAt } from "../../src/engine/calendar";
import { readCharacter } from "../../src/packs/minds/core/state";
import { FakeHost } from "../support/fake-host";
import { alderChat, ASK, DANNY, fakeModels, lastFor, MARCUS, PRIYA, stateOf, storyChat, type Put, type Seen } from "../support/mind-chat";
import { Rig } from "../support/rig";

/** A long pinned entry, about 2,100 tokens, with marks at both ends so a cut shows. */
const bigPin = (k: number): JsonObject => ({ id: `big_${k}`, title: `Ledger page ${k}`, content: `PIN-${k}-START ${"ledger ".repeat(950).trim()} PIN-${k}-END`, keys: [], links: [] });

/** Three long entries pinned to `who`: more than a mind's context once held besides them. */
async function pinBig(rig: Rig, put: Put, worldId: string, who: string): Promise<void> {
  for (const k of [1, 2, 3]) await put("lore", `big_${k}`, bigPin(k));
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: { [who]: [1, 2, 3].map((k) => ({ lore: `big_${k}` })) }, places: {} } }));
}

function allPinsWhole(context: string): void {
  for (const k of [1, 2, 3]) expect(context).toContain(`- Ledger page ${k}: ${bigPin(k).content}`);
}

/** The pinned lore minds read up to `tokens`, as Settings → Minds → What a mind reads sets it. */
const pinnedUpTo = (tokens: number): JsonObject => ({ minds: { reads: { pinned: { tokens } } } });

describe("the lore pinned for a mind: the user's cap is its only limit", () => {
  test("before the reply: an older settings file, its Character minds card's lore set high under Custom or left at Standard's, gives every pinned entry to the mind whole", async () => {
    // The user's settings from before minds had what they read: their own card at 90,000 tokens, or Standard's at 1,600.
    for (const [preset, tokens] of [["custom", 90_000], ["standard", 1600]] as const) {
      const host = new FakeHost();
      const fresh = defaultSettings();
      const minds = JSON.parse(JSON.stringify(fresh.minds)) as JsonObject;
      delete minds.reads;
      const steps = { ...fresh.modelUse.steps, mind: { enabled: true, signals: ["always"], route: { provider: "helper", connectionId: null, model: null }, lore: { policy: "prefetch", tokens } } };
      host.files.set(`${host.userId}/settings.json`, JSON.stringify({ ...fresh, modelUse: { ...fresh.modelUse, preset, steps }, minds }));
      const rig = new Rig({ shipped: true, minds: true, host });
      const seen = fakeModels(rig);
      const chatId = await alderChat(rig, (put, worldId) => pinBig(rig, put, worldId, DANNY));
      await rig.turn(chatId, "Hello, Danny.", "He looks up from the bench.");
      allPinsWhole(lastFor(seen.minds, "Danny Okafor"));
      // The lore trace says what the mind was given: every pin whole, nothing cut or left out.
      const trace = rig.rt.inspectorRecords(chatId)?.at(-1)?.minds?.find((t) => t.who === "Danny Okafor" && t.purpose === "mind");
      expect({ preset, pinned: trace?.pinned?.map((p) => [p.title, p.cut]), notes: trace?.notes }).toEqual({ preset, pinned: [1, 2, 3].map((k) => [`Ledger page ${k}`, false]), notes: undefined });
    }
  });

  test("Run minds now: within a high cap every pinned entry reaches the mind whole, and the run's report shows none cut", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    const chatId = await alderChat(rig, (put, worldId) => pinBig(rig, put, worldId, DANNY));
    rig.body(await rig.send({ type: "lre.settings.set", patch: pinnedUpTo(100_000) }));
    await rig.turn(chatId, "Hello, Danny.", "He looks up from the bench.");
    const started = rig.body(await rig.send({ type: "lre.minds", op: "run", chatId, who: [DANNY] })).run as MindsRunView;
    const done = await rig.host.sentWhere((m) => m.type === "lre.minds.update" && m.run.runId === started.runId && m.run.status !== "running");
    if (done.type !== "lre.minds.update") throw new Error("not a minds run update");
    expect(done.run.status).toBe("done");
    allPinsWhole(lastFor(seen.minds, "Danny Okafor"));
    expect(done.run.entries[0]?.pinned?.map((p) => [p.title, p.cut, p.left === true])).toEqual([1, 2, 3].map((k) => [`Ledger page ${k}`, false, false]));
  });

  test("a time skip's beat: the mind that thinks there reads every pinned entry whole within a high cap", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    const chatId = await alderChat(rig, (put, worldId) => pinBig(rig, put, worldId, MARCUS), [MARCUS]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: pinnedUpTo(100_000) }));
    await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
    // Marcus means to meet the player character tomorrow evening: a beat of a three-day skip.
    const { state, world } = await stateOf(rig, chatId);
    const cal = calendarOf(world);
    const meet = clockAt(cal, dateAt(cal, state.clock).dayIndex + 1, 19 * 60);
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "mind_pin", entity: MARCUS, level: "live" }, { op: "mind_memory", entity: MARCUS, part: "plan", id: null, value: { what: "Talk to Jordan about the books", kind: "meet", when: { from: meet, to: meet + 60 }, with: ["pov"], priority: 4 } }] }));
    rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes: 3 * 1440 }, overrides: { invitation: "note" } }, source: "palette", now: true }));
    await rig.host.finish(await rig.host.start(chatId, { type: "normal" }), "Days pass.");
    const atBeat = seen.minds.filter((c) => c.name === "Marcus Delgado" && /## Now\nIt is .*Time skips ahead/.test(c.context));
    expect(atBeat.length).toBeGreaterThan(0);
    for (const c of atBeat) allPinsWhole(c.context);
  });

  test("a time skip's beat: the mind that thinks there reads what is pinned to them, to every mind and to the beats step, in that order; a turn's mind reads no beats pins", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    const chatId = await alderChat(
      rig,
      async (put, worldId) => {
        await put("lore", "marcus_pin", { id: "marcus_pin", title: "Marcus's books", content: "MARCUS-PIN: the shop's books are two months behind.", keys: [], links: [] });
        await put("lore", "every_mind", { id: "every_mind", title: "Town talk", content: "EVERY-MIND-PIN: the harbor festival is Saturday.", keys: [], links: [] });
        await put("lore", "beats_pin", { id: "beats_pin", title: "Skip notes", content: "BEATS-PIN: the week runs slow after the storm.", keys: [], links: [] });
        rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: { [MARCUS]: [{ lore: "marcus_pin" }] }, places: {}, steps: { mind: [{ lore: "every_mind" }], skip: [{ lore: "beats_pin" }] } } }));
      },
      [MARCUS],
    );
    await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
    const onTurn = lastFor(seen.minds, "Marcus Delgado");
    expect(onTurn).toContain("EVERY-MIND-PIN");
    expect(onTurn).not.toContain("BEATS-PIN");
    // Marcus means to meet the player character tomorrow evening: a beat of a three-day skip.
    const { state, world } = await stateOf(rig, chatId);
    const cal = calendarOf(world);
    const meet = clockAt(cal, dateAt(cal, state.clock).dayIndex + 1, 19 * 60);
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "mind_pin", entity: MARCUS, level: "live" }, { op: "mind_memory", entity: MARCUS, part: "plan", id: null, value: { what: "Talk to Jordan about the books", kind: "meet", when: { from: meet, to: meet + 60 }, with: ["pov"], priority: 4 } }] }));
    rig.body(await rig.send({ type: "lre.action", chatId, action: "timelapse", params: { target: { type: "duration", minutes: 3 * 1440 }, overrides: { invitation: "note" } }, source: "palette", now: true }));
    await rig.host.finish(await rig.host.start(chatId, { type: "normal" }), "Days pass.");
    const atBeat = seen.minds.filter((c) => c.name === "Marcus Delgado" && /## Now\nIt is .*Time skips ahead/.test(c.context));
    expect(atBeat.length).toBeGreaterThan(0);
    for (const c of atBeat) {
      const at = ["MARCUS-PIN", "EVERY-MIND-PIN", "BEATS-PIN"].map((mark) => c.context.indexOf(mark));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    }
  });

  test("under a lower cap the entry it runs out on is cut at a word and the rest left out, and the trace says so and why", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    const chatId = await alderChat(rig, (put, worldId) => pinBig(rig, put, worldId, DANNY));
    rig.body(await rig.send({ type: "lre.settings.set", patch: pinnedUpTo(3000) }));
    await rig.turn(chatId, "Hello, Danny.", "He looks up from the bench.");
    const danny = lastFor(seen.minds, "Danny Okafor");
    expect(danny).toContain(String(bigPin(1).content));
    expect(danny).toContain("PIN-2-START");
    expect(danny).not.toContain("PIN-2-END");
    expect(danny).not.toContain("PIN-3-START");
    const trace = rig.rt.inspectorRecords(chatId)?.at(-1)?.minds?.find((t) => t.who === "Danny Okafor" && t.purpose === "mind");
    expect(trace?.pinned?.map((p) => [p.title, p.cut])).toEqual([
      ["Ledger page 1", false],
      ["Ledger page 2", true],
    ]);
    expect((trace?.pinned ?? []).reduce((sum, p) => sum + p.tokens, 0)).toBeLessThanOrEqual(3000);
    expect(trace?.notes).toEqual(["Pinned lore didn't all fit: 1 cut to fit, 1 left out, over the 3000 tokens a mind reads of it; raise that in Settings → Minds → What a mind reads."]);
  });

  test("the memory step reads every open commitment by its id and every plan, however many: nothing cuts them for room", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const seen = fakeModels(rig);
    const chatId = await alderChat(rig, async () => undefined);
    const { state } = await stateOf(rig, chatId);
    const commitments: JsonObject[] = [];
    const plans: JsonObject[] = [];
    for (let k = 0; k < 48; k++) commitments.push({ op: "mind_memory", entity: DANNY, part: "commitment", id: null, value: { kind: "promise", with: [PRIYA], text: `COMMIT-${k} ${"to help Priya with the festival stalls and the vendor list ".repeat(4).trim()}` } });
    for (let k = 0; k < 24; k++) plans.push({ op: "mind_memory", entity: DANNY, part: "plan", id: null, value: { what: `PLAN-${k} ${"take the township truck out to the yard ".repeat(3).trim()}`, kind: "errand", when: { from: state.clock + 1440 + k * 60, to: state.clock + 1500 + k * 60 }, with: [], priority: 3 } });
    for (const ops of [commitments, plans]) rig.body(await rig.send({ type: "lre.edit", chatId, ops }));
    await rig.turn(chatId, "Hello.", "They look up.");
    const memory = lastFor(seen.memories, "Danny Okafor");
    const c = readCharacter((await stateOf(rig, chatId)).state, DANNY);
    expect(c.commitments.filter((x) => x.status === "open").length).toBe(48);
    for (const x of c.commitments) expect(memory).toContain(`- [${x.id}] promise with Priya Nair: ${x.text}`);
    for (let k = 0; k < 24; k++) expect(memory).toContain(`- PLAN-${k} `);
  });
});

/** Danny's context on the story's second turn, asked after the first turn's memories. */
const secondTurn = (seen: Seen): string => lastFor(seen.minds, "Danny Okafor");

describe("a mind reads the story as it stands, and nothing of another mind", () => {
  test("by default: the lore pinned for them, the lore the turn names, how the latest reply ended and what the player says; never the planner's day, a plan, a commitment or any of their memory", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const { chatId, seen } = await storyChat(rig);
    const danny = secondTurn(seen);
    for (const mark of ["PIN-MARK", "ACTIVE-MARK", "The story so far ended: FIRST-REPLY-MARK: Danny nods; Priya waves a clipboard.", `Now Jordan Ellis says or does: ${ASK}`, "- Traits: funny, competitive, loyal"]) expect(danny).toContain(mark);
    // Activation, not a guess at relevance: an entry about Danny, or one sharing the player's words, isn't the turn's lore.
    for (const mark of ["LINK-MARK", "WORDS-MARK"]) expect(danny).not.toContain(mark);
    // Their own memory and life, which the planner and the memory step fill, stay out unless switched on.
    for (const mark of ["Today ", "Time out", "Plan (", "PLAN-MARK", "Commitment (", "COMMIT-MARK", "NOTE-MARK", "SUMMARY-MARK", "THOUGHT-MARK", "## Your last thoughts", "## Turns you were there for", "You have $"]) expect(danny).not.toContain(mark);
    // Nothing of another mind: what Priya's memory says she told him isn't his.
    expect(danny).not.toContain("TOLD-MARK");
    // Secrecy: a secret the turn names that isn't his stays out; his own is in who he is.
    expect(danny).not.toContain("SECRET-MARK");
    expect(danny).toContain("- Your secret, Danny's debt: HELD-MARK: Danny owes the lighthouse keeper money.");
    // The state still holds what the planner and the memories made, for the GM and the planner.
    const c = readCharacter((await stateOf(rig, chatId)).state, DANNY);
    expect(c.witness.some((w) => w.how === "told" && w.what.startsWith("TOLD-MARK"))).toBe(true);
    expect(c.plans.some((p) => p.what.startsWith("PLAN-MARK"))).toBe(true);
    // The lore trace lists what the mind was given that the player may know of, and no secret.
    const records = rig.rt.inspectorRecords(chatId) ?? [];
    const trace = records.at(-1)?.minds?.find((t) => t.who === "Danny Okafor" && t.purpose === "mind");
    expect(trace?.pinned?.map((p) => p.title)).toEqual(["Danny's spare key"]);
    const activated = trace?.activated?.map((p) => p.title) ?? [];
    expect(activated).toContain("The lighthouse");
    for (const title of ["The workbench", "Old stones"]) expect(activated).not.toContain(title);
    expect(JSON.stringify(records)).not.toMatch(/The wreck|SECRET-MARK|Danny's debt|HELD-MARK/);
  });

  test("with every source of their own switched on, what another character's memory says they were told still reaches neither their mind nor their memory", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const all = Object.fromEntries(["pinned", "activated", "reply", "message", "summary", "memory", "thoughts", "recall", "life"].map((s) => [s, { on: true }]));
    const { seen } = await storyChat(rig, all);
    const danny = secondTurn(seen);
    for (const mark of ["NOTE-MARK", "COMMIT-MARK", "PLAN-MARK", "SUMMARY-MARK", "## Your last thoughts", "## Turns you were there for", "Today "]) expect(danny).toContain(mark);
    expect(danny).not.toContain("TOLD-MARK");
    const memory = lastFor(seen.memories, "Danny Okafor");
    expect(memory).toContain("NOTE-MARK");
    expect(memory).not.toContain("TOLD-MARK");
  });
});

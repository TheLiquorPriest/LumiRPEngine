// What a turn waits for (DESIGN §5.1, §24.1, §24.4, §5.3): character minds think while `interpret`
// reads the player's message, and a read that makes them pointless (a timelapse) or a preview gate's
// Cancel stops them; a gate's Play takes the minds its held run started. Consolidation runs beside
// the memories, and asks again after a memory that rewrote the summary; it runs only while something
// reads what it folds, and minds only while something reads them. Memory, consolidation and the time
// skip's steps don't reason unless the user sets an effort on their cards.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { stepUpdatePatch } from "../../src/frontend/settings/steps";
import { editRequest } from "../../src/frontend/requests";
import { placeOfEntity } from "../../src/engine/scope";
import { noteOp, refreshOp } from "../../src/packs/minds/ui/ops";
import { readCharacter } from "../../src/packs/minds/core/state";
import type { JsonObject } from "../../src/shared/json";
import type { EditOp } from "../../src/shared/protocol";
import { SETTINGS_DEFAULTS_REV, type UserSettings } from "../../src/shared/settings";
import { Rig } from "../support/rig";

const MIND = /You are the private mind of (.+?) in the roleplay world/;
const MEMORY = /You keep the memory of (.+?) in the roleplay world/;
const CONSOLIDATE = /You keep the long-term memory of (.+?) in the roleplay world/;
const INTERPRET = "You map a player's typed input";
const NONE = JSON.stringify({ action: null, params: {}, confidence: 0.9, reason: "no action" });
const NO_MEMORY = JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [], told: [] });

const named = (re: RegExp, req: QuietRequest): string | undefined => re.exec(req.messages[0]?.content ?? "")?.[1];
const asked = (re: RegExp, calls: readonly QuietRequest[]): string[] => calls.flatMap((c) => named(re, c) ?? []).sort();

function mindAnswer(who: string): string {
  return JSON.stringify({ monologue: `${who} thinks.`, depiction: `${who} leans on the counter`, intent: `${who} means to talk`, reactions: [], plans: [], mood: "calm" });
}

/** A scripted call that never answers on its own: the engine has to stop it. */
const never = (): Promise<string> => Promise.withResolvers<string>().promise;

/**
 * Yields the event loop, at most `turns` times, until `done`: a step the engine starts at once has
 * started within a few turns, so a bound in turns (not time) tells "started" from "waits for this".
 */
async function until(done: () => boolean, turns = 500): Promise<void> {
  for (let i = 0; i < turns && !done(); i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

async function edit(rig: Rig, chatId: string, op: EditOp | null): Promise<void> {
  if (!op) throw new Error("the form refused it");
  rig.body(await rig.send(editRequest(chatId, [op]) as unknown as Record<string, unknown>));
}

/** A Port Alder chat where Danny and Priya are with the POV, the only Live minds, after `settings` patches. */
async function alderChat(rig: Rig, settings: JsonObject[] = []): Promise<string> {
  const people = ["danny_okafor", "priya_nair"];
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: people } } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  for (const patch of [{ minds: { refreshLimit: 0 } }, ...settings]) rig.body(await rig.send({ type: "lre.settings.set", patch }));
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const here = state ? placeOfEntity(state, "pov") : null;
  if (!here) throw new Error("the POV is nowhere");
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: people.map((entity) => ({ op: "move", entity, to: here })) }));
  return chatId;
}

async function characterOf(rig: Rig, chatId: string, id: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return readCharacter(state, id);
}

/** Two notes each for Danny and Priya, one past the one they keep: a consolidation is due for both. */
const FOLDING: JsonObject = { minds: { memory: { notes: { keep: 1 }, consolidate: { enabled: true, periodDays: 1 } } } };
async function seedNotes(rig: Rig, chatId: string): Promise<void> {
  for (const who of ["danny_okafor", "priya_nair"]) for (const text of ["Saw the van come in.", "Heard about the bid."]) await edit(rig, chatId, noteOp(who, null, { text, salience: "3" }));
}

describe("minds beside the read", () => {
  test("minds think while interpret reads the player's message", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig);
    let whileReading: string[] = [];
    rig.host.quietReply = async (req) => {
      if ((req.messages[0]?.content ?? "").includes(INTERPRET)) {
        await until(() => asked(MIND, rig.host.quietCalls).length === 2);
        whileReading = asked(MIND, rig.host.quietCalls);
        return NONE;
      }
      const mind = named(MIND, req);
      return mind ? mindAnswer(mind) : NO_MEMORY;
    };
    rig.host.sendUser(chatId, "Morning, both of you.");
    await rig.host.settle();
    const reply = await rig.host.start(chatId, { type: "normal" });
    expect(reply.halted).toBeUndefined();
    expect(whileReading).toEqual(["Danny Okafor", "Priya Nair"]);
    expect(rig.host.section("Minds")).toContain("Danny Okafor leans on the counter");
    expect(rig.host.section("Minds")).toContain("Priya Nair leans on the counter");
  });

  test("a message read as a timelapse stops the minds started for it, which fail nothing, and the reply goes ahead", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig);
    let read = false;
    rig.host.quietReply = async (req) => {
      if ((req.messages[0]?.content ?? "").includes(INTERPRET)) {
        await until(() => asked(MIND, rig.host.quietCalls).length === 2);
        read = true;
        return JSON.stringify({ action: "timelapse", params: { span: "an hour" }, confidence: 0.9 });
      }
      const mind = named(MIND, req);
      // Minds asked before the read never answer on their own; the skip's minds afterwards do.
      if (mind) return read ? mindAnswer(mind) : never();
      return NO_MEMORY;
    };
    rig.host.sendUser(chatId, "OOC: an hour passes.");
    await rig.host.settle();
    const reply = await rig.host.start(chatId, { type: "normal" });
    expect(reply.halted).toBeUndefined();
    expect(rig.host.quietStopped).toEqual(["the message plays a timelapse, whose minds think at its beats", "the message plays a timelapse, whose minds think at its beats"]);
    const calls = (await rig.rt.diag.records(chatId, rig.host.userId)).flatMap((r) => r.calls ?? []);
    expect(calls.filter((c) => c.error?.startsWith("not needed: the message plays a timelapse")).map((c) => c.spared)).toEqual([true, true]);
    await rig.host.finish(reply, "An hour passes in the shop.");
    expect((await rig.rt.diag.records(chatId, rig.host.userId)).some((r) => r.kind === "turn" && r.status === "failed")).toBe(false);
  });

  test("the intent gate's Play takes the minds its held run started, and asks none again", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig, [{ gates: { intent: true } }]);
    rig.host.quietReply = (req) => {
      if ((req.messages[0]?.content ?? "").includes(INTERPRET)) return JSON.stringify({ action: "chat_with", params: { target: "danny_okafor" }, confidence: 0.9 });
      const mind = named(MIND, req);
      return mind ? mindAnswer(mind) : NO_MEMORY;
    };
    rig.host.sendUser(chatId, "I ask Danny how the weekend went.");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBe("cancelled");
    expect(asked(MIND, rig.host.quietCalls)).toEqual(["Danny Okafor", "Priya Nair"]);
    const gate = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "intent_gate");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: gate?.id, choice: "play" }));
    const before = rig.host.quietCalls.length;
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    expect(asked(MIND, rig.host.quietCalls.slice(before))).toEqual([]);
    expect(rig.host.section("Minds")).toContain("Danny Okafor leans on the counter");
    expect(rig.host.section("Minds")).toContain("Priya Nair leans on the counter");
  });

  test("Cancel on the intent gate stops the minds its held run started", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig, [{ gates: { intent: true } }]);
    rig.host.quietReply = (req) => {
      if ((req.messages[0]?.content ?? "").includes(INTERPRET)) return JSON.stringify({ action: "chat_with", params: { target: "danny_okafor" }, confidence: 0.9 });
      return named(MIND, req) ? never() : NO_MEMORY;
    };
    rig.host.sendUser(chatId, "I ask Danny how the weekend went.");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBe("cancelled");
    expect(asked(MIND, rig.host.quietCalls)).toEqual(["Danny Okafor", "Priya Nair"]);
    expect(rig.host.quietStopped).toEqual([]);
    const gate = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "intent_gate");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: gate?.id, choice: "cancel" }));
    expect(rig.host.quietStopped).toEqual(["you cancelled the turn", "you cancelled the turn"]);
  });

  test("minds aren't asked while nothing reads them, and a GM's request for a fresh mind still is", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig);
    rig.host.quietReply = (req) => {
      const mind = named(MIND, req);
      return mind ? mindAnswer(mind) : (req.messages[0]?.content ?? "").includes(INTERPRET) ? NONE : NO_MEMORY;
    };
    // The chat's feed switches the Minds section off, and no mind reads its last thoughts (the default).
    await edit(rig, chatId, { op: "feed", section: "minds", to: { enabled: false } });
    await rig.turn(chatId, "Morning, both of you.", "They nod.");
    expect(asked(MIND, rig.host.quietCalls)).toEqual([]);
    // Due all the same: the round keeps the level each was due at, as a mind recorded then would.
    expect((await characterOf(rig, chatId, "danny_okafor")).passed?.level).toBe("live");
    await edit(rig, chatId, refreshOp("danny_okafor"));
    await rig.turn(chatId, "So, any news?", "Danny shrugs.");
    expect(asked(MIND, rig.host.quietCalls)).toEqual(["Danny Okafor"]);
  });
});

describe("consolidation", () => {
  test("runs beside the memories, and is asked again after a memory that rewrote the summary, folding into that", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig, [FOLDING]);
    await seedNotes(rig, chatId);
    let whileRemembering: string[] = [];
    const folds: Record<string, number> = {};
    rig.host.quietReply = async (req) => {
      const system = req.messages[0]?.content ?? "";
      if (system.includes(INTERPRET)) return NONE;
      const mind = named(MIND, req);
      if (mind) return mindAnswer(mind);
      const remembering = named(MEMORY, req);
      if (remembering) {
        await until(() => asked(CONSOLIDATE, rig.host.quietCalls).length >= 2);
        whileRemembering = asked(CONSOLIDATE, rig.host.quietCalls);
        return JSON.stringify({ notes: [{ text: `${remembering} said good morning.`, salience: 3 }], commitments: [], resolved: [], plans: [], told: [], ...(remembering === "Danny Okafor" ? { summary: "Danny runs the shop now." } : {}) });
      }
      const folding = named(CONSOLIDATE, req);
      if (folding) {
        folds[folding] = (folds[folding] ?? 0) + 1;
        return JSON.stringify({ summary: `${folding}, fold ${folds[folding]}: ${(req.messages[1]?.content ?? "").includes("Danny runs the shop now.") ? "after the rewrite" : "as it was"}` });
      }
      return "{}";
    };
    await rig.turn(chatId, "Morning, both of you.", "They nod.");
    expect(whileRemembering).toEqual(["Danny Okafor", "Priya Nair"]);
    expect((await characterOf(rig, chatId, "danny_okafor")).summary).toBe("Danny Okafor, fold 2: after the rewrite");
    expect((await characterOf(rig, chatId, "priya_nair")).summary).toBe("Priya Nair, fold 1: as it was");
    expect((await characterOf(rig, chatId, "danny_okafor")).notes.map((n) => n.text)).not.toContain("Saw the van come in.");
  });

  test("doesn't run while nothing reads what it folds: no memory call, and no mind reading summaries or notes", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig, [FOLDING, { minds: { memoryLevels: [] } }]);
    await seedNotes(rig, chatId);
    rig.host.quietReply = (req) => {
      const mind = named(MIND, req);
      if (mind) return mindAnswer(mind);
      if (named(CONSOLIDATE, req)) return JSON.stringify({ summary: "Folded." });
      return (req.messages[0]?.content ?? "").includes(INTERPRET) ? NONE : NO_MEMORY;
    };
    await rig.turn(chatId, "Morning, both of you.", "They nod.");
    expect(asked(CONSOLIDATE, rig.host.quietCalls)).toEqual([]);
    // A mind that reads its summary is a reader: the next turn folds.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { reads: { summary: { on: true } } } } }));
    await rig.turn(chatId, "So, any news?", "Danny shrugs.");
    expect(asked(CONSOLIDATE, rig.host.quietCalls)).toEqual(["Danny Okafor", "Priya Nair"]);
  });
});

describe("thinking budgets", () => {
  const effortsOf = (rig: Rig): Record<string, string | undefined> => {
    const out: Record<string, string | undefined> = {};
    for (const c of rig.host.quietCalls) {
      const kind = named(MIND, c) ? "mind" : named(MEMORY, c) ? "memory" : named(CONSOLIDATE, c) ? "consolidate" : (c.messages[0]?.content ?? "").includes(INTERPRET) ? "interpret" : null;
      if (kind) out[kind] = c.effort;
    }
    return out;
  };
  const answers = (req: QuietRequest): string => {
    const mind = named(MIND, req);
    if (mind) return mindAnswer(mind);
    if (named(CONSOLIDATE, req)) return JSON.stringify({ summary: "Folded." });
    return (req.messages[0]?.content ?? "").includes(INTERPRET) ? NONE : NO_MEMORY;
  };

  test("memory and consolidation don't reason unless their cards say so; the turn's other steps take the helper model's", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig, [FOLDING]);
    await seedNotes(rig, chatId);
    rig.host.quietReply = answers;
    await rig.turn(chatId, "Morning, both of you.", "They nod.");
    expect(effortsOf(rig)).toEqual({ interpret: "inherit", mind: "inherit", memory: "off", consolidate: "off" });
    const settings = rig.body(await rig.send({ type: "lre.settings.get" })).settings as UserSettings;
    expect([settings.modelUse.steps.memory?.route?.effort, settings.modelUse.steps.consolidate?.route?.effort, settings.modelUse.steps.skip?.route?.effort]).toEqual(["off", "off", "off"]);
    // The card's "Use helper default" is kept: the memory follows the helper model again.
    const memory = settings.modelUse.steps.memory;
    if (!memory?.route) throw new Error("no memory card");
    rig.body(await rig.send({ type: "lre.settings.set", patch: stepUpdatePatch("memory", { ...memory, route: { ...memory.route, effort: undefined } }) }));
    rig.host.quietCalls.length = 0;
    await rig.turn(chatId, "So, any news?", "Danny shrugs.");
    expect(effortsOf(rig).memory).toBe("inherit");
    expect(((rig.body(await rig.send({ type: "lre.settings.get" })).settings as UserSettings).modelUse.steps.memory?.route?.effort)).toBeUndefined();
  });

  test("settings saved before steps stopped reasoning are lifted, unless the user chose an effort", async () => {
    const helper = (effort: string): JsonObject => ({ connectionId: null, model: null, effort, maxTokens: 8192, params: {} });
    const steps = (memoryEffort?: string): JsonObject => ({
      memory: { enabled: true, signals: ["reply"], route: { provider: "helper", connectionId: null, model: null, ...(memoryEffort ? { effort: memoryEffort } : {}) } },
      consolidate: { enabled: true, signals: ["reply"], route: { provider: "helper", connectionId: null, model: null } },
    });
    const read = async (file: JsonObject): Promise<UserSettings> => {
      const rig = new Rig({ shipped: true, minds: true });
      rig.host.files.set(`${rig.host.userId}/settings.json`, JSON.stringify({ v: 1, defaults: 2, ...file }));
      return rig.rt.settings.get(rig.host.userId);
    };
    const lifted = await read({ helper: helper("inherit"), modelUse: { preset: "standard", steps: steps() } });
    expect([lifted.defaults, lifted.modelUse.steps.memory?.route?.effort, lifted.modelUse.steps.consolidate?.route?.effort]).toEqual([SETTINGS_DEFAULTS_REV, "off", "off"]);
    const chosenStep = await read({ helper: helper("inherit"), modelUse: { preset: "custom", steps: steps("low") } });
    expect([chosenStep.modelUse.steps.memory?.route?.effort, chosenStep.modelUse.steps.consolidate?.route?.effort]).toEqual(["low", "off"]);
    const chosenHelper = await read({ helper: helper("high"), modelUse: { preset: "standard", steps: steps() } });
    expect([chosenHelper.modelUse.steps.memory?.route?.effort, chosenHelper.modelUse.steps.consolidate?.route?.effort]).toEqual([undefined, undefined]);
  });
});

// Model calls per turn by preset (DESIGN §5.3) on one typed turn that fires every signal: typed
// input, open ties for an agent with the POV and one elsewhere, a reply. Also: routes reach
// the host, prose steps never see a secret (secrecy batching rule), a suggestion too long for a chip
// is dropped, never cut, and a brief is checked whole for a secret before it's cut.

import { describe, expect, test } from "bun:test";
import type { Answers } from "../../src/engine/decide";
import type { DecideRequest, QuietRequest } from "../../src/backend/host";
import type { JsonObject } from "../../src/shared/json";
import { BRIEF_CHARS } from "../../src/backend/turn-steps";
import { Rig } from "../support/rig";

const TRUTH = "the ferryman sank the old boat";

function quiet(req: QuietRequest): string {
  const system = req.messages[0]?.content ?? "";
  if (system.includes("You map a player's typed input")) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
  if (system.includes("propose concrete state changes")) return JSON.stringify({ proposals: [] });
  if (system.includes("You brief a roleplay narrator")) return JSON.stringify({ text: "Sam waits at home for the ferry." });
  if (system.includes("You outline a roleplay narrator")) return JSON.stringify({ beats: ["The horn sounds.", "Sam looks up."] });
  if (system.includes("Suggest three short")) return JSON.stringify({ choices: ["I board the ferry", "I go home"] });
  return "{}";
}

function decide(req: DecideRequest): Answers {
  const out: Answers = {};
  for (const [key, q] of Object.entries(req.questions)) {
    if (q.type === "noul") out[key] = { type: "noul", noul: 0.9 };
    else if (q.type === "choice") {
      const first = Object.keys(q.criteria)[0] ?? "none";
      out[key] = { type: "choice", choice: first, probabilities: { [first]: 1 }, confidence: 1 };
    }
  }
  return out;
}

const ALL_ON: JsonObject = Object.fromEntries(["interpret", "npc.choose", "puzzle.answer", "brief", "outline", "extract", "choices"].map((p) => [p, { enabled: true, signals: ["always"] }]));

/** The brief answers `brief` and the outline `beats`; every other step as `quiet`. */
const prose =
  (brief: string, beats: string[]) =>
  (req: QuietRequest): string => {
    const system = req.messages[0]?.content ?? "";
    if (system.includes("You brief a roleplay narrator")) return JSON.stringify({ text: brief });
    if (system.includes("You outline a roleplay narrator")) return JSON.stringify({ beats });
    return quiet(req);
  };

async function turnCalls(preset: "lean" | "standard" | "full" | "custom", steps?: JsonObject, reply: (req: QuietRequest) => string = quiet): Promise<{ rig: Rig; chatId: string; counts: Record<string, number>; total: number }> {
  const rig = new Rig();
  if (preset === "custom") {
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "custom", steps: steps ?? ALL_ON } } }));
  } else rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset } } }));
  // Character minds have calls of their own, apart from the phase budgets (DESIGN §24.6): these count the steps.
  rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { enabled: false } } }));
  const worldId = await rig.newWorld("Calls");
  const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId })) as { draft: { entities: Record<string, JsonObject & { fields: JsonObject }> } };
  const dev = draft.entities.dev;
  if (!dev) throw new Error("no dev");
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "dev", value: { ...dev, fields: { ...dev.fields, place: "home", tie: true } } }));
  const sam = draft.entities.sam;
  if (!sam) throw new Error("no sam");
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "sam", value: { ...sam, fields: { ...sam.fields, place: "home" } } }));
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: "wait", value: { id: "wait", label: "Wait", params: {}, requires: [], outcomes: { default: [] }, duration: "10", lexicon: ["wait"] } }));
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "kim", value: { id: "kim", kind: "person", name: "Kim", tier: "background", fields: { tie: true }, relations: [], agent: true } }));
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "tracks", id: "wreck", value: { id: "wreck", kind: "secret", label: "The wreck", start: "hidden", visibility: "secret", stages: { hidden: { label: "Hidden", next: [], truth: TRUTH } } } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning, Sam.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.host.quietReply = reply;
  rig.host.decideReply = decide;
  const start = rig.rt.meter.log.length;
  await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
  const counts: Record<string, number> = {};
  const calls = rig.rt.meter.log.slice(start);
  for (const c of calls) counts[c.purpose] = (counts[c.purpose] ?? 0) + 1;
  expect(rig.rt.ledger.errors).toEqual([]);
  return { rig, chatId, counts, total: calls.length };
}

describe("model calls per preset (DESIGN §5.3)", () => {
  test("Lean: interpret and extract", async () => {
    const { counts, total } = await turnCalls("lean");
    expect(counts).toEqual({ interpret: 1, extract: 1 });
    expect(total).toBe(2);
  });

  test("Standard: interpret, npc.choose with the POV and off-screen, extract", async () => {
    const { counts, total } = await turnCalls("standard");
    expect(counts).toEqual({ interpret: 1, "npc.choose": 2, extract: 1 });
    expect(total).toBe(4);
  });

  test("Full: adds brief and the prose outline, and no step checks the reply against the engine's facts (narrator + 6)", async () => {
    const { rig, counts, total } = await turnCalls("full");
    expect(counts).toEqual({ interpret: 1, "npc.choose": 2, brief: 1, outline: 1, extract: 1 });
    expect(total).toBe(6);
    // The brief and prose outline reach the narrator through the Outline slot.
    const outline = rig.host.section("Outline");
    expect(outline).toContain("Brief: Sam waits at home for the ferry.");
    expect(outline).toContain("The horn sounds.");
  });

  test("Custom with every step on: every step Settings lists that can fire runs (choices too)", async () => {
    const { rig, chatId, counts, total } = await turnCalls("custom");
    expect(counts).toEqual({ interpret: 1, "npc.choose": 2, brief: 1, outline: 1, extract: 1, choices: 1 });
    expect(total).toBe(7);
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
    expect(chips.filter((c) => c.kind === "choice").map((c) => c.label)).toEqual(["I board the ferry", "I go home"]);
  });

  test("a suggestion too long for a chip is dropped, not cut, so no part of a secret it carries reaches a chip", async () => {
    // The secret runs across the 120th character: a cut there would keep only its start.
    const long = `I ask the old harbor master down at the pier, as calmly as I can manage, about the night they say ${TRUTH} out past the breakwater`;
    expect(long.indexOf(TRUTH)).toBeLessThan(120);
    expect(long.indexOf(TRUTH) + TRUTH.length).toBeGreaterThan(120);
    const { rig, chatId } = await turnCalls("custom", undefined, (req) => (req.messages[0]?.content.includes("Suggest three short") ? JSON.stringify({ choices: [long, "I go home"] }) : quiet(req)));
    const labels = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "choice").map((c) => c.label);
    for (const label of labels) expect(label).not.toContain("ferryman");
    expect(labels).toEqual(["I go home"]);
  });

  test("a brief is checked whole before it's cut: a secret across the cut withholds it, and a long clean one still runs, cut", async () => {
    const unit = "Sam stands at the window of the little house, watching the gulls wheel over the harbor. ";
    const lead = "Down at the far end of the pier people still whisper that ";
    // The secret runs across the brief's cut: a cut there would keep only its start.
    const pad = unit.repeat(Math.ceil(BRIEF_CHARS / unit.length)).slice(0, BRIEF_CHARS - lead.length - Math.floor(TRUTH.length / 2));
    const leaky = `${pad}${lead}${TRUTH}, though nobody will say it aloud.`;
    expect(leaky.indexOf(TRUTH)).toBeLessThan(BRIEF_CHARS);
    expect(leaky.indexOf(TRUTH) + TRUTH.length).toBeGreaterThan(BRIEF_CHARS);
    const clean = `${unit.repeat(Math.ceil(BRIEF_CHARS / unit.length) + 1)}The ferry is late again, and the queue at the ramp grows longer by the minute.`;
    expect(clean.indexOf("by the minute")).toBeGreaterThan(BRIEF_CHARS);
    const outlineFor = async (brief: string): Promise<string> => {
      const { rig } = await turnCalls("full", undefined, (req) => (req.messages[0]?.content.includes("You brief a roleplay narrator") ? JSON.stringify({ text: brief }) : quiet(req)));
      return rig.host.section("Outline");
    };
    const withheld = await outlineFor(leaky);
    expect(withheld).not.toContain("Brief:");
    expect(withheld).not.toContain("ferryman");
    const kept = await outlineFor(clean);
    expect(kept).toContain(`Brief: ${unit.trim()}`);
    expect(kept).not.toContain("by the minute");
  });

  test("a step's route (connection and model) reaches the host; prose prompts never carry a secret", async () => {
    const steps: JsonObject = { ...ALL_ON, brief: { enabled: true, signals: ["always"], route: { provider: "helper", connectionId: "conn-brief", model: "model-brief" } } };
    const { rig } = await turnCalls("custom", steps);
    const brief = rig.host.quietCalls.find((r) => r.messages[0]?.content.includes("You brief a roleplay narrator"));
    expect(brief?.connectionId).toBe("conn-brief");
    expect(brief?.model).toBe("model-brief");
    const prose = rig.host.quietCalls.filter((r) => /You brief|You outline|Suggest three short/.test(r.messages[0]?.content ?? ""));
    expect(prose.length).toBe(3);
    for (const r of prose) expect(JSON.stringify(r.messages).toLowerCase()).not.toContain(TRUTH);
  });

  test("budgets cap the calls a phase makes", async () => {
    const rig = new Rig();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "custom", budgets: { pre: { calls: 1 }, post: { calls: 1 } } } } }));
    // Character minds have calls of their own, apart from the phase budgets (DESIGN §24.6).
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { enabled: false } } }));
    const chatId = await rig.worldChat();
    rig.host.quietReply = quiet;
    rig.host.decideReply = decide;
    const start = rig.rt.meter.log.length;
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    const purposes = rig.rt.meter.log.slice(start).map((c) => c.purpose);
    expect(purposes.filter((p) => p === "interpret" || p === "brief" || p === "outline" || p === "puzzle.answer").length).toBe(1);
    expect(purposes.filter((p) => p === "extract" || p === "choices").length).toBe(1);
  });
});

describe("the prose steps and someone the POV can't see", () => {
  const VEX: JsonObject = { id: "vex", kind: "person", name: "Vex Morrow", tier: "background", fields: {}, relations: [], visibility: "secret" };
  /** A secret lore entry filed under an everyday word, "ticket". */
  const PASSAGE: JsonObject = { id: "passage", title: "The smuggler's passage", content: "A berth below the car deck is let out to those who pay in cash.", keys: ["ticket"], links: [], secret: true, gate: "false", audience: [] };
  const WITH_VEX: [string, JsonObject][] = [["entities", VEX], ["lore", PASSAGE]];

  /** A "Calls" chat with every step on, after `patches`, in a world with `puts` (Vex Morrow and the passage entry unless given); the helper answers by `reply`. */
  async function withVex(reply: (req: QuietRequest) => string, patches: JsonObject[] = [], puts: [string, JsonObject][] = WITH_VEX): Promise<{ rig: Rig; chatId: string }> {
    const rig = new Rig();
    for (const patch of [{ modelUse: { preset: "full" } }, { modelUse: { preset: "custom", steps: ALL_ON } }, { minds: { enabled: false } }, ...patches]) rig.body(await rig.send({ type: "lre.settings.set", patch }));
    const worldId = await rig.newWorld("Calls");
    for (const [collection, value] of puts) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id: String(value.id), value }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.host.quietReply = reply;
    rig.host.decideReply = decide;
    return { rig, chatId };
  }

  /** The narrator's Outline after `typed`, and the outline gate's lines for it, in a world with `puts`. */
  async function outlined(reply: (req: QuietRequest) => string, typed: string, puts: [string, JsonObject][]): Promise<{ outline: string; gate: string }> {
    const played = await withVex(reply, [], puts);
    await played.rig.turn(played.chatId, typed, "The ferry horn sounds.");
    const gated = await withVex(reply, [{ gates: { outline: true } }], puts);
    gated.rig.host.sendUser(gated.chatId, typed);
    await gated.rig.host.settle();
    expect((await gated.rig.host.start(gated.chatId, { type: "normal" })).halted).toBe("cancelled");
    const gate = (await gated.rig.rt.view(gated.chatId, gated.rig.host.userId)).chips.find((c) => c.kind === "outline_gate");
    return { outline: played.rig.host.section("Outline"), gate: gate?.detail ?? "" };
  }

  const NAMING = prose("Sam waits at the ferry for Vex Morrow.", ["Vex Morrow steps off the ferry.", "The horn sounds."]);

  test("a brief or an outline line naming them that neither the player nor the step's inputs said is withheld whole, on the gate too", async () => {
    const { outline, gate } = await outlined(NAMING, "I walk to the ferry and wait.", WITH_VEX);
    for (const told of [outline, gate]) {
      expect(told).toContain("The horn sounds.");
      expect(told).not.toContain("Brief:");
      expect(told).not.toMatch(/Vex|Morrow/);
    }
  });

  test("a line saying a name the player typed reads the same with or without someone hidden by it: 'I wait for Vex'", async () => {
    const reply = prose("Sam waits at the ferry for Vex.", ["Vex steps off the ferry.", "The horn sounds."]);
    const none = await outlined(reply, "I wait for Vex.", []);
    expect(none.outline).toContain("Brief: Sam waits at the ferry for Vex.");
    expect(none.gate).toContain("Vex steps off the ferry.");
    expect(await outlined(reply, "I wait for Vex.", WITH_VEX)).toEqual(none);
  });

  test("a name the step's inputs say belongs to whoever they name: Dev in the room, beside a hidden Dev Rourke", async () => {
    const home = (id: string, name: string, cash: number): [string, JsonObject] => ["entities", { id, kind: "person", name, tier: "principal", fields: { cash, place: "home" }, relations: [], ...(id === "dev" ? { agent: true } : {}) }];
    const room = [home("sam", "Sam", 100), home("dev", "Dev", 50)];
    const reply = prose("Dev waves Sam over to the window.", ["Dev pours the coffee.", "The horn sounds."]);
    const none = await outlined(reply, "I wave back.", room);
    expect(none.outline).toContain("Brief: Dev waves Sam over to the window.");
    expect(none.gate).toContain("Dev pours the coffee.");
    const rourke: [string, JsonObject] = ["entities", { id: "dev_rourke", kind: "person", name: "Dev Rourke", tier: "background", fields: {}, relations: [], visibility: "secret" }];
    expect(await outlined(reply, "I wave back.", [...room, rourke])).toEqual(none);
  });

  test("a suggestion naming them is dropped, unless the player saw them named in their message or the reply", async () => {
    const offered = async (reply: string): Promise<string[]> => {
      const { rig, chatId } = await withVex((req) => (req.messages[0]?.content.includes("Suggest three short") ? JSON.stringify({ choices: ["I ask Vex Morrow about the ferry", "I go home"] }) : quiet(req)));
      await rig.turn(chatId, "I walk to the ferry and wait.", reply);
      return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "choice").map((c) => c.label);
    };
    expect(await offered("The ferry horn sounds.")).toEqual(["I go home"]);
    expect(await offered("The ferry horn sounds, and Vex Morrow steps off the gangway.")).toEqual(["I ask Vex Morrow about the ferry", "I go home"]);
  });

  test("an everyday word a secret entry is filed under doesn't withhold a line: the prose steps never read secret lore", async () => {
    const { rig, chatId } = await withVex((req) => {
      const system = req.messages[0]?.content ?? "";
      if (system.includes("You outline a roleplay narrator")) return JSON.stringify({ beats: ["Sam buys a ticket at the window."] });
      if (system.includes("Suggest three short")) return JSON.stringify({ choices: ["I buy a ticket", "I go home"] });
      return quiet(req);
    });
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(rig.host.section("Outline")).toContain("Sam buys a ticket at the window.");
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "choice").map((c) => c.label)).toEqual(["I buy a ticket", "I go home"]);
  });
});

describe("Port Alder's brief and outline keep their everyday words", () => {
  test("whispers, a breath and a coffee drunk earlier name nothing hidden: a secret track's stages, and a thing used up", async () => {
    const rig = new Rig({ shipped: true });
    for (const patch of [{ modelUse: { preset: "full" } }, { modelUse: { preset: "custom", steps: ALL_ON } }, { minds: { enabled: false } }]) rig.body(await rig.send({ type: "lre.settings.set", patch }));
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    // The coffee Jordan said they had, made real and drunk: used up, as a claimed drink is once used.
    const coffee = { id: "claimed_coffee", kind: "item", name: "Coffee", tier: "background", fields: { place: "harbor_street_114", claimed: true, consumable: true, gone: true }, relations: [] };
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: coffee.id, value: coffee }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const brief = "Jordan whispers a curse at the cold coffee, takes a breath and heads out.";
    const beats = ["Jordan finishes the coffee.", "Jordan takes a breath before the drive."];
    rig.host.quietReply = prose(brief, beats);
    rig.host.decideReply = decide;
    await rig.turn(chatId, "I finish my coffee and head out.", "Jordan rinses the mug.");
    const outline = rig.host.section("Outline");
    expect(outline).toContain(`Brief: ${brief}`);
    for (const beat of beats) expect(outline).toContain(beat);
  });
});

describe("interpret money params", () => {
  test("an amount the player states lands in minor units ($200 once moved $2.00)", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Money");
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: "tip_out", value: { id: "tip_out", label: "Tip", params: { amount: { type: "money" } }, requires: [], outcomes: { default: [{ type: "add", args: { entity: "sam", field: "cash", delta: "=0 - amount" } }] }, duration: "1", lexicon: ["tip"] } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes("You map a player's typed input") ? JSON.stringify({ action: "tip_out", params: { amount: 2 }, confidence: 1 }) : "{}");
    const before = Number(await rig.cashOf(chatId));
    await rig.turn(chatId, "I tip the waiter $2.", "He nods.");
    expect(Number(await rig.cashOf(chatId))).toBe(before - 200);
  });
});

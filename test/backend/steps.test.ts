// Model calls per turn by preset (DESIGN §5.3) on one typed turn that fires every signal: the
// classifier, open ties for an agent with the POV and one elsewhere, a reply. Also: routes reach
// the host, and prose steps never see a secret (secrecy batching rule).

import { describe, expect, test } from "bun:test";
import type { Answers } from "../../src/engine/decide";
import type { DecideRequest, QuietRequest } from "../../src/backend/host";
import type { JsonObject } from "../../src/shared/json";
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

const ALL_ON: JsonObject = Object.fromEntries(["interpret", "npc.choose", "contradiction", "puzzle.answer", "brief", "outline", "extract", "choices"].map((p) => [p, { enabled: true, signals: ["always"] }]));

async function turnCalls(preset: "lean" | "standard" | "full" | "custom", steps?: JsonObject): Promise<{ rig: Rig; chatId: string; counts: Record<string, number>; total: number }> {
  const rig = new Rig();
  if (preset === "custom") {
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "custom", steps: steps ?? ALL_ON } } }));
  } else rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset } } }));
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
  rig.host.quietReply = quiet;
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

  test("Full: adds brief, the prose outline and contradiction (narrator + 7)", async () => {
    const { rig, counts, total } = await turnCalls("full");
    expect(counts).toEqual({ interpret: 1, "npc.choose": 2, brief: 1, outline: 1, extract: 1, contradiction: 1 });
    expect(total).toBe(7);
    // The brief and prose outline reach the narrator through the Outline slot.
    const outline = rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outline]"))?.content ?? "";
    expect(outline).toContain("Brief: Sam waits at home for the ferry.");
    expect(outline).toContain("The horn sounds.");
  });

  test("Custom with every step on: every step Settings lists that can fire runs (choices too)", async () => {
    const { rig, chatId, counts, total } = await turnCalls("custom");
    expect(counts).toEqual({ interpret: 1, "npc.choose": 2, brief: 1, outline: 1, extract: 1, contradiction: 1, choices: 1 });
    expect(total).toBe(8);
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
    expect(chips.filter((c) => c.kind === "choice").map((c) => c.label)).toEqual(["I board the ferry", "I go home"]);
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
    const chatId = await rig.worldChat();
    rig.host.quietReply = quiet;
    rig.host.decideReply = decide;
    const start = rig.rt.meter.log.length;
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    const purposes = rig.rt.meter.log.slice(start).map((c) => c.purpose);
    expect(purposes.filter((p) => p === "interpret" || p === "brief" || p === "outline" || p === "puzzle.answer").length).toBe(1);
    expect(purposes.filter((p) => p === "extract" || p === "contradiction" || p === "choices").length).toBe(1);
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

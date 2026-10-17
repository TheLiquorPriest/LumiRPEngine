// RPEngine's helpers read the world's lore (DESIGN §5.4): the prefetch puts what a step's own inputs
// find into its prompt, or into a decision's state, at no extra call and within the step's lore
// tokens; a step that writes for the player never reads a secret, even one its audience names.
// Lookups: the model calls the lore tools, or asks in the need form on a connection seen refusing
// tools; each round is one call on the phase's lookup budget and shows in the call meter; when
// the budget is spent a step answers with its prefetch; Lean makes none.

import { describe, expect, test } from "bun:test";
import type { Answers } from "../../src/engine/decide";
import type { DecideRequest, QuietRequest, QuietToolCall } from "../../src/backend/host";
import { TOOL_SUPPORT_PATH } from "../../src/backend/lore-steps";
import { sectionTokens } from "../../src/backend/book";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const SECRET = "The ferryman scuttled the old boat for the insurance money";

const LORE: Record<string, JsonObject> = {
  ferry: { id: "ferry", title: "The ferry", content: "The ferry crosses to Gull Island twice a day; the last boat leaves at six.", keys: ["ferry"], links: [] },
  dev_past: { id: "dev_past", title: "Dev's past", content: "Dev ran the harbor café before the storm.", keys: [], links: ["dev"] },
  wreck: { id: "wreck", title: "The wreck", content: `${SECRET}.`, keys: ["ferry", "wreck"], links: ["dev"], secret: true, gate: "self.cash > 100000", audience: ["interpret", "npc.choose", "brief"] },
};

const PROMPTS: Record<string, string> = {
  interpret: "You map a player's typed input",
  extract: "propose concrete state changes",
  brief: "You brief a roleplay narrator",
  outline: "You outline a roleplay narrator",
  choices: "Suggest three short",
  contradiction: "Answer each question about the state",
};

function quiet(req: QuietRequest): string {
  const system = req.messages[0]?.content ?? "";
  if (system.includes(PROMPTS.interpret ?? "")) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
  if (system.includes(PROMPTS.extract ?? "")) return JSON.stringify({ proposals: [] });
  if (system.includes(PROMPTS.brief ?? "")) return JSON.stringify({ text: "Sam waits at home for the ferry." });
  if (system.includes(PROMPTS.outline ?? "")) return JSON.stringify({ beats: ["The horn sounds."] });
  if (system.includes(PROMPTS.choices ?? "")) return JSON.stringify({ choices: ["I board the ferry"] });
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

/** A world chat whose world has `lore`, with an open tie for Dev (with Sam) and for Kim (elsewhere). */
export async function loreChat(settings: JsonObject[], lore: Record<string, JsonObject> = LORE): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig();
  for (const patch of settings) rig.body(await rig.send({ type: "lre.settings.set", patch }));
  const worldId = await rig.newWorld("Harbor");
  const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId })) as { draft: { entities: Record<string, JsonObject & { fields: JsonObject }> } };
  const put = async (collection: string, id: string, value: JsonObject): Promise<void> => {
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id, value }));
  };
  const dev = draft.entities.dev;
  const sam = draft.entities.sam;
  if (!dev || !sam) throw new Error("no dev or sam");
  await put("entities", "dev", { ...dev, fields: { ...dev.fields, place: "home", tie: true } });
  await put("entities", "sam", { ...sam, fields: { ...sam.fields, place: "home" } });
  await put("entities", "kim", { id: "kim", kind: "person", name: "Kim", tier: "background", fields: { tie: true }, relations: [], agent: true });
  await put("actions", "wait", { id: "wait", label: "Wait", params: {}, requires: [], outcomes: { default: [] }, duration: "10", lexicon: ["wait"] });
  for (const [id, value] of Object.entries(lore)) await put("lore", id, value);
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning, Sam.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.host.quietReply = quiet;
  rig.host.decideReply = decide;
  return { rig, chatId };
}

const systemOf = (rig: Rig, step: string): string => rig.host.quietCalls.find((r) => r.messages[0]?.content.includes(PROMPTS[step] ?? "\u0000"))?.messages[0]?.content ?? "";
/** The snippets of a prompt's lore block. */
const loreLines = (prompt: string): string[] => (prompt.split("World lore (reference notes; they may be incomplete):\n")[1] ?? "").split("\n").filter((l) => l.startsWith("- [")).map((l) => l.replace(/^- \[[^\]]+\] /, ""));

describe("the prefetch", () => {
  test("puts what each step's inputs find into its prompt or its decision's state, at no extra call", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "full" } }]);
    const start = rig.rt.meter.log.length;
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(rig.rt.ledger.errors).toEqual([]);
    const counts: Record<string, number> = {};
    for (const c of rig.rt.meter.log.slice(start)) if (c.lookup !== true) counts[c.purpose] = (counts[c.purpose] ?? 0) + 1;
    // The calls Full makes on this turn without lore (DESIGN §5.3); lookups are counted apart.
    expect(counts).toEqual({ interpret: 1, "npc.choose": 2, brief: 1, outline: 1, extract: 1, contradiction: 1 });
    expect(systemOf(rig, "interpret")).toContain("The ferry: The ferry crosses to Gull Island");
    expect(systemOf(rig, "extract")).toContain("The ferry: The ferry crosses to Gull Island");
    expect(systemOf(rig, "brief")).toContain("The ferry: The ferry crosses to Gull Island");
    // npc.choose on the Decision connection reads its lore in the state: Dev's own entry.
    const npc = rig.host.decideCalls.find((r) => JSON.stringify(r.state).includes("Dev"));
    expect(JSON.stringify(npc?.state)).toContain("Dev's past: Dev ran the harbor café before the storm.");
  });

  test("a secret reaches the decision steps in its audience, never a step that writes for the player", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "full" } }]);
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(systemOf(rig, "interpret")).toContain(SECRET);
    expect(JSON.stringify(rig.host.decideCalls.map((r) => r.state))).toContain(SECRET);
    // Brief is in its audience but writes prose; extract and contradiction aren't in it.
    for (const step of ["brief", "outline", "extract", "contradiction"]) {
      expect(systemOf(rig, step)).not.toBe("");
      expect(systemOf(rig, step)).not.toContain(SECRET);
    }
  });

  test("the lore block stays within the step's lore tokens", async () => {
    const long = Array.from({ length: 300 }, (_, i) => `The ferry log ${i} notes calm water.`).join(" ");
    const lore = { ...LORE, log: { id: "log", title: "Ferry log", content: long, keys: ["ferry"], links: [] } };
    for (const tokens of [90, 150]) {
      const { rig, chatId } = await loreChat([{ modelUse: { preset: "full" } }, { modelUse: { preset: "custom", steps: { interpret: { enabled: true, signals: ["always"], lore: { policy: "prefetch", tokens } } } } }], lore);
      await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
      const lines = loreLines(systemOf(rig, "interpret"));
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.reduce((s, l) => s + sectionTokens(l), 0)).toBeLessThanOrEqual(tokens);
      expect(lines.some((l) => l.endsWith("…"))).toBe(true);
    }
  });

  test("a step whose lore is off gets none, and a world without lore changes no prompt", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "full" } }, { modelUse: { preset: "custom", steps: { interpret: { enabled: true, signals: ["always"], lore: { policy: "none", tokens: 400 } } } } }]);
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(systemOf(rig, "interpret")).not.toContain("World lore");
    expect(systemOf(rig, "extract")).toContain("World lore");
    const bare = await loreChat([{ modelUse: { preset: "full" } }], {});
    await bare.rig.turn(bare.chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    for (const r of bare.rig.host.quietCalls) expect(r.messages[0]?.content).not.toContain("World lore");
    for (const r of bare.rig.host.decideCalls) expect(JSON.stringify(r.state)).not.toContain('"lore"');
  });
});

/** Lore no prefetch on this turn finds: only a lookup reads it. */
const TIMETABLE: JsonObject = { id: "timetable", title: "Timetable", content: "Boats leave at 7, 12 and 18.", keys: ["timetable"], links: [] };
const asked = (req: QuietRequest): boolean => req.messages.some((m) => m.content.startsWith("Lore you asked for:"));
const isStep = (req: QuietRequest, step: string): boolean => req.messages[0]?.content.includes(PROMPTS[step] ?? "\u0000") === true;

describe("lookups", () => {
  test("a tool-call lookup: the model calls lore_search, the engine answers in a follow-up message, and the meter counts the round", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "standard" } }], { ...LORE, timetable: TIMETABLE });
    const search: QuietToolCall = { name: "lore_search", args: { query: "timetable" }, callId: "c1" };
    rig.host.quietReply = (req) => (isStep(req, "interpret") && req.tools && !asked(req) ? { content: "", toolCalls: [search] } : quiet(req));
    const start = rig.rt.meter.log.length;
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    const interprets = rig.host.quietCalls.filter((r) => isStep(r, "interpret"));
    expect(interprets.length).toBe(2);
    const [first, second] = interprets;
    expect(first?.tools?.map((t) => t.name)).toEqual(["lore_search", "lore_get", "lore_list"]);
    expect(first?.json).toBe(false);
    expect(second?.messages.at(-2)).toEqual({ role: "assistant", content: 'lore_search {"query":"timetable"}' });
    expect(second?.messages.at(-1)?.content).toContain("[timetable] Timetable: Boats leave at 7, 12 and 18.");
    // The phase's one lookup is spent: the model must answer now.
    expect(second?.tools).toBeUndefined();
    const calls = rig.rt.meter.log.slice(start).filter((c) => c.purpose === "interpret");
    expect(calls.map((c) => c.lookup === true)).toEqual([false, true]);
    await rig.rt.meter.ready(rig.host.userId);
    expect(rig.rt.meter.view(rig.host.userId).turn.lookups).toBe(1);
  });

  test("after a connection refuses the tools, its lookups use the need form, kept across a restart", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "standard" } }], { ...LORE, timetable: TIMETABLE });
    const model = (req: QuietRequest): string => {
      if (req.tools) throw new Error("Provider error (400): this model does not support tools");
      if (isStep(req, "interpret") && req.messages[0]?.content.includes('{"need"') && !asked(req)) return JSON.stringify({ need: ["timetable"] });
      return quiet(req);
    };
    rig.host.quietReply = model;
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    const interprets = rig.host.quietCalls.filter((r) => isStep(r, "interpret"));
    // Refused with tools, asked again in the need form, then answered with what it asked for.
    expect(interprets.map((r) => r.tools !== undefined)).toEqual([true, false, false]);
    expect(interprets[2]?.messages.at(-1)?.content).toContain("Timetable: Boats leave at 7, 12 and 18.");
    expect(JSON.parse((await rig.host.storage.read(TOOL_SUPPORT_PATH, rig.host.userId)) ?? "{}").refused.active.reason).toContain("does not support tools");
    const before = rig.host.quietCalls.length;
    await rig.turn(chatId, "I wait at the ferry.", "The ferry horn sounds again.");
    const next = rig.host.quietCalls.slice(before).filter((r) => isStep(r, "interpret"));
    expect(next.every((r) => r.tools === undefined)).toBe(true);
    expect(next[0]?.messages[0]?.content).toContain('{"need"');
    // A restart reads the record from storage.
    const restarted = new Rig({ host: rig.host });
    restarted.host.quietReply = model;
    const kept = rig.host.quietCalls.length;
    await restarted.turn(chatId, "I wait some more by the ferry.", "Gulls cry.");
    const after = rig.host.quietCalls.slice(kept).filter((r) => isStep(r, "interpret"));
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((r) => r.tools !== undefined)).toEqual([]);
  });

  test("when the phase's lookup budget is spent, a step gets no lookup and answers with its prefetch", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "full" } }, { modelUse: { preset: "custom", steps: { brief: { enabled: true, signals: ["always"], lore: { policy: "prefetch+lookup", tokens: 400 } } }, budgets: { pre: { lookup: { calls: 1, ms: 60_000 } } } } }], { ...LORE, timetable: TIMETABLE });
    const search: QuietToolCall = { name: "lore_search", args: { query: "timetable" }, callId: "c1" };
    rig.host.quietReply = (req) => (req.tools && !asked(req) ? { content: "", toolCalls: [search] } : quiet(req));
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(rig.host.quietCalls.filter((r) => isStep(r, "interpret")).length).toBe(2);
    const briefs = rig.host.quietCalls.filter((r) => isStep(r, "brief"));
    expect(briefs.length).toBe(1);
    expect(briefs[0]?.tools).toBeUndefined();
    expect(briefs[0]?.messages[0]?.content).toContain("The ferry: The ferry crosses to Gull Island");
    expect(briefs[0]?.messages[0]?.content).not.toContain("lore tools");
  });

  test("Lean makes no lookups: the same calls as without lore, and no step is offered tools or the need form", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "lean" } }], { ...LORE, timetable: TIMETABLE });
    const search: QuietToolCall = { name: "lore_search", args: { query: "timetable" }, callId: "c1" };
    rig.host.quietReply = (req) => (req.tools ? { content: "", toolCalls: [search] } : req.messages[0]?.content.includes('{"need"') ? JSON.stringify({ need: ["timetable"] }) : quiet(req));
    const start = rig.rt.meter.log.length;
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    const counts: Record<string, number> = {};
    for (const c of rig.rt.meter.log.slice(start)) counts[c.purpose] = (counts[c.purpose] ?? 0) + 1;
    expect(counts).toEqual({ interpret: 1, extract: 1 });
    for (const r of rig.host.quietCalls) {
      expect(r.tools).toBeUndefined();
      expect(r.messages[0]?.content).not.toContain('{"need"');
    }
    expect(systemOf(rig, "interpret")).toContain("World lore");
  });
});

describe("the decision pre-pass", () => {
  const prepassOf = (req: QuietRequest): boolean => req.messages[0]?.content.startsWith("You get a decision ready") === true;

  test("npc.choose on the Decision connection asks the helper what lore it needs, on the lookup budget, and reads the hits with its prefetch", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "standard" } }, { modelUse: { preset: "custom", budgets: { pre: { lookup: { calls: 2, ms: 30_000 } } } } }], { ...LORE, timetable: TIMETABLE });
    const search: QuietToolCall = { name: "lore_search", args: { query: "timetable" }, callId: "c1" };
    rig.host.quietReply = (req) => (prepassOf(req) ? { content: "", toolCalls: [search] } : quiet(req));
    const start = rig.rt.meter.log.length;
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    const prepass = rig.host.quietCalls.filter(prepassOf);
    // Dev's choice before the plan; Kim's after the reply finds the post phase's one lookup held by extract.
    expect(prepass.length).toBe(1);
    expect(prepass[0]?.tools?.map((t) => t.name)).toEqual(["lore_search", "lore_get", "lore_list"]);
    expect(prepass[0]?.connectionId).toBeNull();
    const dev = rig.host.decideCalls.find((r) => JSON.stringify(r.state).includes('"agent":"Dev"'));
    expect(JSON.stringify(dev?.state)).toContain("Timetable: Boats leave at 7, 12 and 18.");
    expect(JSON.stringify(dev?.state)).toContain("Dev's past: Dev ran the harbor café before the storm.");
    const npc = rig.rt.meter.log.slice(start).filter((c) => c.purpose === "npc.choose");
    expect(npc.map((c) => [c.via, c.lookup === true])).toEqual([
      ["helper", true],
      ["decision", false],
      ["decision", false],
    ]);
  });

  test("in the need form, and with no lookup left the decision reads its prefetch only", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "standard" } }, { modelUse: { preset: "custom", steps: { "npc.choose": { enabled: true, signals: ["tie_zone"], route: { provider: "decision", connectionId: null, model: null }, lore: { policy: "prefetch+lookup", tokens: 400, transport: "need" } } }, budgets: { pre: { lookup: { calls: 2, ms: 30_000 } } } } }], { ...LORE, timetable: TIMETABLE });
    rig.host.quietReply = (req) => (prepassOf(req) ? JSON.stringify({ need: ["timetable"] }) : quiet(req));
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    const [prepass] = rig.host.quietCalls.filter(prepassOf);
    expect(prepass?.tools).toBeUndefined();
    expect(prepass?.messages[0]?.content).toContain('{"need"');
    expect(JSON.stringify(rig.host.decideCalls.find((r) => JSON.stringify(r.state).includes('"agent":"Dev"'))?.state)).toContain("Timetable: Boats leave at 7, 12 and 18.");
    // Standard's one lookup before the reply: interpret holds it first, by priority.
    const lean = await loreChat([{ modelUse: { preset: "standard" } }], { ...LORE, timetable: TIMETABLE });
    lean.rig.host.quietReply = (req) => (prepassOf(req) ? JSON.stringify({ need: ["timetable"] }) : quiet(req));
    await lean.rig.turn(lean.chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(lean.rig.host.quietCalls.filter(prepassOf)).toEqual([]);
    const state = JSON.stringify(lean.rig.host.decideCalls.find((r) => JSON.stringify(r.state).includes('"agent":"Dev"'))?.state);
    expect(state).toContain("Dev's past");
    expect(state).not.toContain("Timetable");
  });
});

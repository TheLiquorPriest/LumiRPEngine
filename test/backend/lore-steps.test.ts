// RPEngine's helpers read the world's lore (DESIGN §5.4): the prefetch puts what a step's own inputs
// find into its prompt, or into a decision's state, at no extra call and within the step's lore
// tokens; a step that writes for the player never reads a secret, even one its audience names.
// Lookups: the model calls the lore tools, or asks in the need form on a connection seen refusing
// tools; each round is one call on the phase's lookup budget and shows in the call meter; when
// the budget is spent a step answers with its prefetch; Lean makes none.

import { describe, expect, test } from "bun:test";
import type { Answers } from "../../src/engine/decide";
import { Working } from "../../src/engine/working";
import type { DecideRequest, QuietRequest, QuietToolCall } from "../../src/backend/host";
import { LookupBudget, StepLore, TOOL_SUPPORT_PATH } from "../../src/backend/lore-steps";
import { sectionTokens } from "../../src/backend/book";
import { runDir } from "../../src/shared/ids";
import type { JsonObject } from "../../src/shared/json";
import type { LoreStepTrace } from "../../src/shared/state-view";
import type { StepPurpose, WorldDoc } from "../../src/shared/world";
import { baseWorld, registryOf, startState } from "../packs/support";
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
async function loreChat(settings: JsonObject[], lore: Record<string, JsonObject> = LORE, actions: Record<string, JsonObject> = {}, places: Record<string, JsonObject> = {}): Promise<{ rig: Rig; chatId: string }> {
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
  for (const [id, value] of Object.entries(actions)) await put("actions", id, value);
  for (const [id, value] of Object.entries(places)) await put("places", id, value);
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
    // Both of Standard's lookups before the reply are spent (this one, and npc.choose's pre-pass beside it): the model must answer now.
    expect(second?.tools).toBeUndefined();
    const calls = rig.rt.meter.log.slice(start).filter((c) => c.purpose === "interpret");
    expect(calls.map((c) => c.lookup === true)).toEqual([false, true]);
    await rig.rt.meter.ready(rig.host.userId);
    expect(rig.rt.meter.view(rig.host.userId).turn.lookups).toBe(2);
    expect(rig.rt.meter.log.slice(start).filter((c) => c.lookup === true).map((c) => c.purpose).sort()).toEqual(["interpret", "npc.choose"]);
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
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "standard" } }], { ...LORE, timetable: TIMETABLE });
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
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "standard" } }, { modelUse: { preset: "custom", steps: { "npc.choose": { enabled: true, signals: ["tie_zone"], route: { provider: "decision", connectionId: null, model: null }, lore: { policy: "prefetch+lookup", tokens: 400, transport: "need" } } } } }], { ...LORE, timetable: TIMETABLE });
    rig.host.quietReply = (req) => (prepassOf(req) ? JSON.stringify({ need: ["timetable"] }) : quiet(req));
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    const [prepass] = rig.host.quietCalls.filter(prepassOf);
    expect(prepass?.tools).toBeUndefined();
    expect(prepass?.messages[0]?.content).toContain('{"need"');
    expect(JSON.stringify(rig.host.decideCalls.find((r) => JSON.stringify(r.state).includes('"agent":"Dev"'))?.state)).toContain("Timetable: Boats leave at 7, 12 and 18.");
    // One lookup before the reply: interpret holds it first, by priority.
    const single = await loreChat([{ modelUse: { preset: "standard" } }, { modelUse: { preset: "custom", budgets: { pre: { lookup: { calls: 1, ms: 15_000 } } } } }], { ...LORE, timetable: TIMETABLE });
    single.rig.host.quietReply = (req) => (prepassOf(req) ? JSON.stringify({ need: ["timetable"] }) : quiet(req));
    await single.rig.turn(single.chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect(single.rig.host.quietCalls.filter(prepassOf)).toEqual([]);
    const state = JSON.stringify(single.rig.host.decideCalls.find((r) => JSON.stringify(r.state).includes('"agent":"Dev"'))?.state);
    expect(state).toContain("Dev's past");
    expect(state).not.toContain("Timetable");
  });
});

describe("secret lore stays off what the player sees", () => {
  const SAY: JsonObject = { id: "say", label: "Say something", params: { words: { type: "text" } }, requires: [], outcomes: { default: [] }, duration: "1", lexicon: ["say"] };

  test("an interpret answer carrying a secret's text plays as roleplay, unless the player typed it", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "standard" } }], LORE, { say: SAY });
    rig.host.quietReply = (req) => (isStep(req, "interpret") ? JSON.stringify({ action: "say", params: { words: `Psst: ${SECRET.toLowerCase()}!` }, confidence: 1 }) : quiet(req));
    await rig.turn(chatId, "I say something about the ferry.", "Dev blinks.");
    const logs = (): string[] => rig.host.userLogs.get(rig.host.userId) ?? [];
    expect(logs().some((l) => l.includes("interpret: say carried an unrevealed secret; played as roleplay"))).toBe(true);
    const before = logs().length;
    await rig.turn(chatId, `I say "${SECRET}" to see what happens.`, "Dev blinks again.");
    expect(logs().slice(before).some((l) => l.includes("carried an unrevealed secret"))).toBe(false);
  });

  test("a proposal carrying a secret lore phrase never becomes a chip", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "standard" } }]);
    rig.host.quietReply = (req) => (isStep(req, "extract") ? JSON.stringify({ proposals: [{ type: "condition", who: "sam", condition: `haunted: ${SECRET}` }] }) : quiet(req));
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    expect((rig.host.userLogs.get(rig.host.userId) ?? []).some((l) => l.includes("dropped 1 proposal(s) carrying an unrevealed secret"))).toBe(true);
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
    expect(JSON.stringify(chips).toLowerCase()).not.toContain(SECRET.toLowerCase());
  });
});

describe("the inspector's lore traces", () => {
  const contextOf = async (rig: Rig, chatId: string): Promise<string> => JSON.stringify((await rig.rt.view(chatId, rig.host.userId)).panels["core.context"]);
  const storedOf = async (rig: Rig, chatId: string): Promise<string> => (await rig.host.storage.read(`${runDir(chatId)}inspector.json`, rig.host.userId)) ?? "";
  const lookupsOf = (context: string, step: string): { kind: string; text: string; matched: number }[] => {
    const view = JSON.parse(context) as { generations: { lore?: { step: string; queries: { kind: string; text: string; matched: number }[] }[] }[] };
    return view.generations.flatMap((g) => g.lore ?? []).filter((t) => t.step === step).flatMap((t) => t.queries.filter((q) => q.kind !== "prefetch"));
  };

  test("each step's searches, entries with their token cost, lookups and transport reach Context, survive a restart, and never name or count a secret", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "standard" } }], { ...LORE, timetable: TIMETABLE });
    const search: QuietToolCall = { name: "lore_search", args: { query: "timetable" }, callId: "c1" };
    rig.host.quietReply = (req) => ((isStep(req, "interpret") || isStep(req, "extract")) && req.tools && !asked(req) ? { content: "", toolCalls: [search] } : quiet(req));
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    await rig.rt.inspector.settle();
    const context = await contextOf(rig, chatId);
    expect(context).toContain('"step":"interpret","phase":"pre","policy":"prefetch+lookup","transport":"tools"');
    // extract can't read the secret: its lookup shows; interpret can, so its lookup shows only what it was and found.
    expect(lookupsOf(context, "extract")).toEqual([{ kind: "search", text: "timetable", matched: 1 }]);
    expect(lookupsOf(context, "interpret")).toEqual([{ kind: "search", text: "", matched: 1 }]);
    expect(context).toMatch(/"title":"Timetable","tokens":\d+,"cut":false\}/);
    // interpret read the secret (its audience), whose key "ferry" the prefetch matched: the trace
    // neither lists nor counts it, so nothing says a secret was there.
    expect(context).toContain('{"kind":"prefetch","text":"I walk to the ferry and wait.","matched":2}');
    expect(context).not.toContain("secret");
    expect(context).not.toContain("The wreck");
    expect(context.toLowerCase()).not.toContain(SECRET.toLowerCase());
    expect(await contextOf(new Rig({ host: rig.host }), chatId)).toBe(context);
  });

  test("a step that may read a secret shows its model's lookups as their kind and count only, in Context and in the stored history", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "standard" } }], { ...LORE, timetable: TIMETABLE });
    const calls: QuietToolCall[] = [
      { name: "lore_get", args: { id: "wreck" }, callId: "c1" },
      { name: "lore_search", args: { query: "The wreck" }, callId: "c2" },
      { name: "lore_list", args: { topic: "Wrecks" }, callId: "c3" },
    ];
    rig.host.quietReply = (req) => (isStep(req, "interpret") && req.tools && !asked(req) ? { content: "", toolCalls: calls } : quiet(req));
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    await rig.rt.inspector.settle();
    const context = await contextOf(rig, chatId);
    expect(lookupsOf(context, "interpret").map((q) => [q.kind, q.text])).toEqual([
      ["get", ""],
      ["search", ""],
      ["list", ""],
    ]);
    // The secret it read is neither listed nor counted.
    expect(lookupsOf(context, "interpret")[0]?.matched).toBe(0);
    expect(context).not.toContain("secret");
    for (const shown of [context, await storedOf(rig, chatId)]) {
      expect(shown).not.toContain("wreck");
      expect(shown).not.toContain("Wrecks");
    }
  });

  test("any other step's lookup naming a secret entry or a place the POV can't see is withheld; words said this turn are not", async () => {
    const boathouse: JsonObject = { id: "boathouse", name: "The boathouse", fields: {}, visibility: "secret" };
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "standard" } }], { ...LORE, timetable: TIMETABLE }, {}, { boathouse });
    const calls: QuietToolCall[] = [
      { name: "lore_search", args: { query: "the wreck" }, callId: "c1" },
      { name: "lore_search", args: { query: "the boathouse" }, callId: "c2" },
      { name: "lore_search", args: { query: "ferry timetable" }, callId: "c3" },
    ];
    rig.host.quietReply = (req) => (isStep(req, "extract") && req.tools && !asked(req) ? { content: "", toolCalls: calls } : quiet(req));
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    await rig.rt.inspector.settle();
    const context = await contextOf(rig, chatId);
    // "ferry" is a key of the secret entry, but the player said it.
    expect(lookupsOf(context, "extract").map((q) => q.text)).toEqual(["(withheld: it carries a secret)", "(withheld: it carries a secret)", "ferry timetable"]);
    for (const shown of [context, await storedOf(rig, chatId)]) {
      expect(shown.toLowerCase()).not.toContain("wreck");
      expect(shown.toLowerCase()).not.toContain("boathouse");
    }
  });

  /** The `npc.choose` traces in a Context view or a stored history. */
  const npcTraces = (json: string): LoreStepTrace[] => {
    const parsed = JSON.parse(json) as { generations?: { lore?: LoreStepTrace[] }[]; records?: { lore?: LoreStepTrace[] }[] };
    return [...(parsed.generations ?? []), ...(parsed.records ?? [])].flatMap((g) => g.lore ?? []).filter((t) => t.step === "npc.choose");
  };

  test("an NPC's choice shows in the trace as whose choice it is, with nothing it found counted or listed, and not at all for someone the POV can't know", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "full" } }]);
    await rig.turn(chatId, "I walk to the ferry and wait.", "The ferry horn sounds.");
    await rig.rt.inspector.settle();
    const context = await contextOf(rig, chatId);
    const stored = await storedOf(rig, chatId);
    // Dev is here with Sam; Kim is elsewhere, and Sam has never met them: Kim's choice has no row.
    expect(npcTraces(context).flatMap((t) => t.queries.filter((q) => q.kind === "prefetch").map((q) => q.text))).toEqual(["Dev's choice"]);
    // How many entries Dev's options found, and how big they are, would say what Dev plans.
    for (const traces of [npcTraces(context), npcTraces(stored)]) {
      expect(traces.length).toBeGreaterThan(0);
      for (const t of traces) expect([t.private, t.entries, t.queries.filter((q) => q.matched !== undefined)]).toEqual([true, [], []]);
    }
    for (const shown of [context, stored]) {
      expect(shown).not.toContain("work, rest");
      expect(shown).not.toContain("Kim");
    }
    // The decision itself still weighs the options, and reads the lore they found.
    expect(JSON.stringify(rig.host.decideCalls.map((r) => r.state))).toContain('"work","rest"');
    expect(JSON.stringify(rig.host.decideCalls.map((r) => r.state))).toContain("Dev ran the harbor café");
  });

  test("an NPC's choice kept by an earlier build reads back as one kept now: no counts, no entries", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "standard" } }]);
    const trace = (prefetch: string) => ({ step: "npc.choose", phase: "pre", policy: "prefetch+lookup", transport: "tools", queries: [{ kind: "prefetch", text: prefetch, matched: 2 }, { kind: "get", text: "wreck", matched: 1 }], entries: [{ title: "Dev's past", tokens: 12, cut: false }], lookups: 1, notes: [] });
    // One kept before lookups were withheld (`v: 1`) has no text to show; one kept since shows whose choice it was.
    for (const [v, prefetch, shown] of [[1, "Dev: work, rest", ""], [2, "Dev's choice", "Dev's choice"]] as const) {
      const record = { id: "g1", at: 1, activation: "confirmed", sections: [], budget: { sections: 600, used: 0 }, forced: [], lore: [trace(prefetch)] };
      await rig.host.storage.write(`${runDir(chatId)}inspector.json`, JSON.stringify({ v, records: [record], delivery: {} }), rig.host.userId);
      const context = await contextOf(new Rig({ host: rig.host }), chatId);
      const traces = npcTraces(context);
      expect(traces.map((t) => [t.private, t.entries, t.queries])).toEqual([[true, [], [{ kind: "prefetch", text: shown }, { kind: "get", text: "" }]]]);
      for (const hidden of ["Dev's past", "work, rest", "wreck"]) expect(context).not.toContain(hidden);
    }
  });

  test("an NPC's choice counts and lists nothing its private options found, its lookups' included, while the step itself reads it", () => {
    const reg = registryOf();
    const world = baseWorld();
    world.lore.ledger = { id: "ledger", title: "The mill's ledger", content: "The mill keeps its accounts in a green ledger in the office safe.", keys: ["ledger"], links: [], topics: ["Mill"] };
    world.lore.cafe = { id: "cafe", title: "The cafe", content: "Opens at six every morning.", keys: ["cafe"], links: [], topics: ["Mill"] };
    const w = new Working(reg, world, startState(world));
    const reader = { reg, world: w.world, state: w.state, tokens: (t: string) => Math.ceil(t.length / 3.2) };
    const run = (privateInputs: boolean): StepLore => {
      const lore = new StepLore("npc.choose", { policy: "prefetch+lookup", tokens: 400 }, reader, "pre", { text: [], names: [] }, { privateInputs });
      // As the runtime builds it: the agent's name and option ids, shown as whose choice it is.
      lore.prefetch({ text: "Dev: agenda steal ledger, rest", links: [], shown: "Dev's choice" });
      lore.answer([{ kind: "search", text: "cafe" }, { kind: "list", text: "Mill" }]);
      return lore;
    };
    const open = run(false);
    expect(open.trace.entries.map((e) => e.title)).toEqual(["The mill's ledger", "The cafe"]);
    const kept = run(true);
    expect(kept.lines().join("\n")).toContain("green ledger");
    expect(kept.trace).toMatchObject({ private: true, entries: [] });
    expect(kept.trace.queries).toEqual([{ kind: "prefetch", text: "Dev's choice" }, { kind: "search", text: "" }, { kind: "list", text: "" }]);
  });

  test("a history that lists a secret entry isn't shown: its counts include the secret", async () => {
    const { rig, chatId } = await loreChat([{ modelUse: { preset: "standard" } }]);
    const trace = (secret: boolean) => ({ step: "interpret", phase: "pre", policy: "prefetch", transport: "none", queries: [{ kind: "prefetch", text: "the ferry", matched: 2 }], entries: [{ title: secret ? "A secret entry" : "The ferry", tokens: 12, cut: false, secret }], lookups: 0, notes: [] });
    const record = { id: "g1", at: 1, activation: "confirmed", sections: [], budget: { sections: 600, used: 0 }, forced: [], lore: [trace(true), trace(false)] };
    await rig.host.storage.write(`${runDir(chatId)}inspector.json`, JSON.stringify({ v: 2, records: [record], delivery: {} }), rig.host.userId);
    const context = await contextOf(new Rig({ host: rig.host }), chatId);
    expect(context).not.toContain("A secret entry");
    expect(context).toContain('"entries":[{"title":"The ferry","tokens":12,"cut":false}]');
  });
});

describe("lookup instructions and answers", () => {
  const reg = registryOf();
  /** A step's lore on `world`'s start, with a round of lookups to offer. */
  const stepLore = (world: WorldDoc, purpose: StepPurpose, tokens = 400): StepLore => {
    const w = new Working(reg, world, startState(world));
    const lookups = { budget: new LookupBudget(2, 60_000, 60_000, new AbortController().signal), transport: "tools" as const, refused: () => undefined };
    return new StepLore(purpose, { policy: "prefetch+lookup", tokens }, { reg, world: w.world, state: w.state, tokens: (t: string) => Math.ceil(t.length / 3.2) }, "post", { text: [], names: [] }, { lookups });
  };

  test("the instructions name only the topics the step can read an entry under", () => {
    const world = baseWorld();
    world.lore.cafe = { id: "cafe", title: "The cafe", content: "Opens at six every morning.", keys: ["cafe"], links: [], topics: ["Harbor life"] };
    world.lore.wreck = { id: "wreck", title: "The wreck", content: "The ferryman scuttled the old boat for the insurance money.", keys: [], links: [], topics: ["The ferryman's fraud"], secret: true, gate: "false", audience: ["interpret"] };
    world.loreIndex.topics = { harbor_life: { label: "Harbor life", entries: ["cafe"] }, the_ferryman_s_fraud: { label: "The ferryman's fraud", entries: ["wreck"] } };
    const extract = stepLore(world, "extract").instructions("tools");
    expect(extract).toContain("Topics: Harbor life.");
    expect(extract).not.toContain("ferryman");
    // interpret is in the secret's audience, so it can read an entry under that topic.
    expect(stepLore(world, "interpret").instructions("need")).toContain("Topics: Harbor life, The ferryman's fraud.");
  });

  /** A world with `count` entries filed under the topic "Harbor" by naming it. */
  const harbor = (count: number): WorldDoc => {
    const world = baseWorld();
    for (let i = 0; i < count; i++) world.lore[`note_${i}`] = { id: `note_${i}`, title: `Harbor note number ${i} about the old docks and tides`, content: "x", keys: [], links: [], topics: ["Harbor"] };
    return world;
  };
  const estimate = (t: string): number => Math.ceil(t.length / 3.2);

  test("a lore_list answer names entries within the round's lore tokens, and at most a dozen", () => {
    const tight = stepLore(harbor(400), "interpret", 50);
    const answer = tight.answer([
      { kind: "list", text: "Harbor" },
      { kind: "list", text: "Harbor" },
      { kind: "list", text: "Harbor" },
    ]);
    const named = [...answer.matchAll(/\[note_\d+\] Harbor note number \d+ about the old docks and tides/g)].map((m) => m[0]);
    expect(named.length).toBeGreaterThan(0);
    expect(named.reduce((s, line) => s + estimate(line), 0)).toBeLessThanOrEqual(50);
    expect(estimate(answer)).toBeLessThan(200);
    // Each list still reports what it found.
    expect(tight.trace.queries.map((q) => q.matched)).toEqual([400, 400, 400]);
    const roomy = stepLore(harbor(400), "interpret", 100_000).answer([{ kind: "list", text: "Harbor" }]);
    expect([...roomy.matchAll(/\[note_\d+\]/g)]).toHaveLength(12);
    expect(roomy).toContain("(and 388 more");
  });

  test("a call to a tool that isn't a lore tool is refused, never run as a search", () => {
    const lore = stepLore(harbor(3), "interpret");
    const asks = lore.asked({ content: "", finishReason: "tool_calls", tokens: 0, toolCalls: [{ name: "delete_lore", args: { query: "Harbor" }, callId: "c1" }, { name: "lore_search", args: { query: "Harbor" }, callId: "c2" }] }, "tools");
    expect(asks?.map((a) => a.kind)).toEqual(["refused", "search"]);
    const answer = lore.answer(asks ?? []);
    expect(answer).toContain("delete_lore: not a lore tool");
    expect(lore.trace.queries).toEqual([{ kind: "search", text: "Harbor", matched: 3 }]);
    expect(lore.trace.notes.some((n) => n.includes("isn't a lore tool"))).toBe(true);
  });

  test("the model's ask is replayed as only the calls the round answered", () => {
    const lore = stepLore(harbor(3), "interpret");
    const reply = { content: "", finishReason: "tool_calls", tokens: 0, toolCalls: ["first", "second", "third", "fourth", "fifth"].map((query, i) => ({ name: "lore_search", args: { query }, callId: `c${i}` })) };
    expect(lore.asked(reply, "tools")?.map((a) => a.text)).toEqual(["first", "second", "third"]);
    expect(lore.echo(reply, "tools").split("\n")).toEqual(['lore_search {"query":"first"}', 'lore_search {"query":"second"}', 'lore_search {"query":"third"}']);
  });
});

// The fixed pipeline's agent-backed roles (INC2-SPEC C9, lane T2), with scripted models: each role's
// agent answers in its task's contract and the turn reads its answer as classic's type, by classic's
// own validators, so the same answers record the same events as classic; a bad answer does as the
// role's `onFail` says; a decision that turns on what its chooser heard runs the knowledge step for
// them first and reads their holdings; an edited role text reaches its calls; and Test refuses an
// edit that breaks a role's contract.

import { describe, expect, test } from "bun:test";
import { decideRun } from "../../src/backend/agents/roles/director";
import { testRoleText } from "../../src/backend/agents/roles/test";
import { AgentTurn } from "../../src/backend/agents/runtime";
import type { ToolReader } from "../../src/backend/agents/tools/read-view";
import type { ToolWriter } from "../../src/backend/agents/tools/writer";
import type { ChooseTask, RoleResult, TurnAgentCtx } from "../../src/backend/agents/turn-ctx";
import type { QuietRequest } from "../../src/backend/host";
import { renderPrompt } from "../../src/backend/prompts";
import type { TieOdds } from "../../src/backend/turn-steps";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent, Rec } from "../../src/shared/ledger";
import { FAILED_TEXT } from "../../src/shared/agent-failures";
import { ROLE_LABEL } from "../../src/shared/agent-roles";
import { PROMPTS } from "../../src/shared/prompts";
import { alderChat, DANNY, PRIYA, stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";

/** A call as the scripted model saw it: whether a role's agent made it, and which. */
interface Seen {
  role: string | null;
  head: string;
  task: string;
  classic: "interpret" | "extract" | null;
}

/** Scripted models: each role's agent answers as `agents` says for it (else in its contract, empty); each classic call as `classic` says. */
function scripted(rig: Rig, agents: Record<string, string> = {}, classic: { extract?: JsonObject[] } = {}): Seen[] {
  const seen: Seen[] = [];
  rig.host.quietReply = (req: QuietRequest) => {
    const head = req.messages[0]?.content ?? "";
    const task = req.messages.slice(1).map((m) => m.content).join("\n");
    const role = /You are the (\w+) agent of LumiRPEngine/.exec(head)?.[1] ?? null;
    const all = `${head}\n${task}`;
    const kind = role === null ? (head.includes(INTERPRET_MARK) ? "interpret" : head.includes(EXTRACT_MARK) ? "extract" : null) : null;
    seen.push({ role, head, task, classic: kind });
    if (role !== null && agents[role] !== undefined) return agents[role];
    if (role === "scene") return JSON.stringify({ lore: [], notes: [] });
    if (all.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (all.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: classic.extract ?? [] });
    return "{}";
  };
  return seen;
}

async function lastRecord(rig: Rig, chatId: string): Promise<Rec> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
  if (!rec) throw new Error("no record");
  return rec;
}

/** A record's events without the agent turn's output events, each message id by its place in its chat. */
async function comparable(rig: Rig, chatId: string, rec: Rec): Promise<unknown> {
  const at = new Map((await rig.host.chats.messages(chatId, rig.host.userId)).map((m, i) => [m.id, `#${i}`]));
  const events = rec.events.filter((e: LedgerEvent) => !e.type.startsWith("engine.out."));
  return JSON.parse(JSON.stringify(events, (_key, value: unknown) => (typeof value === "string" && at.has(value) ? at.get(value) : value)));
}

/** A Port Alder chat on the same roll, and its Branch at the greeting on agents, its roles agent-backed (§15's default). */
async function pair(rig: Rig): Promise<{ classic: string; agents: string }> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "meta", value: { seedMode: "same_roll" } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const classic = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId: classic }));
  const greeting = (await rig.host.chats.messages(classic, rig.host.userId))[0];
  if (!greeting) throw new Error("no greeting");
  const agents = rig.host.branch(classic, greeting.id);
  rig.body(await rig.send({ type: "lre.chat.knowledge", chatId: agents, engine: "agents" }));
  return { classic, agents };
}

/** Plays `text` as the next turn with `reply`: its record, or how the engine halted it, and the chips on the chat. */
async function played(rig: Rig, chatId: string, text: string, reply: string): Promise<{ rec: Rec | null; halted: string | undefined; failed: string[] }> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  if (!g.halted) await rig.host.finish(g, reply);
  const failed = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "engine_failed").map((c) => c.detail ?? c.label);
  return { rec: g.halted ? null : await lastRecord(rig, chatId), halted: g.halted, failed };
}

describe("an agent-backed role", () => {
  test("answers as its classic type: the same answers record the same events as classic", async () => {
    const rig = new Rig({ shipped: true });
    const { classic, agents } = await pair(rig);
    const later = [{ type: "time_advance", minutes: 45 }];
    const seen = scripted(rig, { read: JSON.stringify({ proposals: later, where: null }) }, { extract: later });
    const a = await played(rig, classic, "I wait by the window.", "Three quarters of an hour later, the rain stops.");
    const b = await played(rig, agents, "I wait by the window.", "Three quarters of an hour later, the rain stops.");
    if (!a.rec || !b.rec) throw new Error(`a turn halted: ${a.halted ?? b.halted ?? ""} ${[...a.failed, ...b.failed].join("; ")}`);
    expect(await comparable(rig, agents, b.rec)).toEqual(await comparable(rig, classic, a.rec));
    // Its intent and read were their agents', with no classic call of their own.
    const agentTurn = seen.slice(seen.findIndex((s) => s.role !== null));
    expect(agentTurn.some((s) => s.role === "intent")).toBe(true);
    expect(agentTurn.some((s) => s.role === "read" && s.task.includes(EXTRACT_MARK))).toBe(true);
    expect(agentTurn.some((s) => s.classic !== null)).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("whose answer isn't one fails in its registry text on the Main agent page, the user's own where edited (L4)", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts: { [FAILED_TEXT.noJson]: "EDITED-FAILED: the answer had no JSON" } } } }));
    // The intent stops the turn by default: the engine-failed card says why, in the role's words.
    scripted(rig, { intent: "not an answer" });
    const stopped = await played(rig, agents, "I sit.", "You sit.");
    expect(stopped.failed).toEqual([`${ROLE_LABEL.intent}: EDITED-FAILED: the answer had no JSON`]);
  });

  test("whose answer isn't one falls back as its onFail says: classic's call, nothing, or the turn stopped", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    // prompt_only: the role's classic call answers.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { intent: { onFail: "prompt_only" } } } } }));
    let seen = scripted(rig, { intent: "not an answer" });
    const fallback = await played(rig, agents, "I stretch.", "You stretch.");
    expect(fallback).toMatchObject({ halted: undefined, failed: [] });
    expect(seen.some((s) => s.role === "intent")).toBe(true);
    expect(seen.some((s) => s.classic === "interpret")).toBe(true);
    // skip: the turn goes on without the read.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { read: { onFail: "skip" } } } } }));
    seen = scripted(rig, { read: "{\"nothing\": true}" });
    await played(rig, agents, "I yawn.", "An hour later, you yawn.");
    expect(seen.some((s) => s.role === "read")).toBe(true);
    expect(seen.some((s) => s.classic === "extract")).toBe(false);
    // stop: the turn stops, its failure the engine-failed card's.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { roles: { intent: { onFail: "stop" } } } } }));
    seen = scripted(rig, { intent: "not an answer" });
    const stopped = await played(rig, agents, "I sit.", "You sit.");
    expect(seen.some((s) => s.classic === "interpret")).toBe(false);
    expect(stopped.failed.length).toBeGreaterThan(0);
  });

  test("is told its texts as the user edited them", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts: { "role.intent.system": "EDITED-SYSTEM-MARK: you read the player's words in {{world}}. {{knowledge}}" } } } }));
    const seen = scripted(rig);
    await played(rig, agents, "I stretch.", "You stretch.");
    expect(seen.some((s) => s.head.includes("EDITED-SYSTEM-MARK: you read the player's words in Alder."))).toBe(true);
  });

  test("calls with the caching set for its role: its key heads its prompt, and no other role's", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { caching: { roles: { intent: { on: true, nonce: "k-intent-77" } } } } } }));
    const seen = scripted(rig);
    await played(rig, agents, "I stretch.", "You stretch.");
    const intent = seen.filter((s) => s.role === "intent");
    expect(intent.length).toBeGreaterThan(0);
    expect(intent.every((s) => s.head.split("\n\n")[0]?.includes("k-intent-77"))).toBe(true);
    const others = seen.filter((s) => s.role !== null && s.role !== "intent");
    expect(others.length).toBeGreaterThan(0);
    expect(others.some((s) => s.head.includes("k-intent-77"))).toBe(false);
  });
});

describe("a role's pinned files", () => {
  test("come after its instructions: those .pins.json lists for it, read with its knowledge, each whole within the manifest's budget for it, else as its headings", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    const write = async (path: string, text: string, readers?: "pov" | "everyone"): Promise<void> => void rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId: agents, path, text, ...(readers ? { readers } : {}) }));
    await write("notes/harbour.md", "HARBOUR-NOTE: Marcus opens the bait shop at six.", "everyone");
    await write("notes/tides.md", `# Tides\n${"The tide turns twice a day at the north pier. ".repeat(60)}\n# Ferries\nTIDES-BODY`, "everyone");
    // The GM's own note, which no role's knowledge but the GM's reads.
    await write("notes/plans.md", "GM-ONLY-NOTE: Danny skims the till.");
    await write(".pins.json", JSON.stringify({ read: { files: ["notes/harbour.md", "notes/tides.md", "notes/plans.md"], tokens: 120 } }), "everyone");
    const seen = scripted(rig);
    await played(rig, agents, "I walk down to the pier.", "The pier is quiet.");
    const read = seen.filter((s) => s.role === "read");
    expect(read.length).toBeGreaterThan(0);
    for (const s of read) {
      expect(s.head).toContain("[notes/harbour.md]\nHARBOUR-NOTE: Marcus opens the bait shop at six.");
      expect(s.head).toContain("[notes/tides.md: its headings]\n# Tides\n# Ferries");
      expect(s.head).not.toContain("TIDES-BODY");
      expect(s.head).not.toContain("GM-ONLY-NOTE");
      expect(s.head).toContain("at most 120 tokens");
    }
    // The manifest lists none for the intent, and no file is pinned in GM → Workspace.
    const intent = seen.filter((s) => s.role === "intent");
    expect(intent.length).toBeGreaterThan(0);
    expect(intent.some((s) => s.head.includes("HARBOUR-NOTE"))).toBe(false);
  });

  test("pinned in GM → Workspace, go with every role reading with knowledge that reaches them, within Settings → Agents → Main agent's pins budget; a mind gets none", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const { agents } = await pair(rig);
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId: agents, path: "notes/pier.md", text: "PIER-NOTE: the ferry leaves at noon.", readers: "pov" }));
    rig.body(await rig.send({ type: "lre.workspace", op: "pin", chatId: agents, path: "notes/pier.md", pinned: true }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { main: { pinsTokens: 400 } } } }));
    const seen = scripted(rig);
    await played(rig, agents, "I check the ferry times.", "The board says noon.");
    for (const role of ["intent", "read"]) {
      const calls = seen.filter((s) => s.role === role);
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((s) => s.head.includes("PIER-NOTE: the ferry leaves at noon.") && s.head.includes("at most 400 tokens"))).toBe(true);
    }
    // A role reading with a character's own knowledge works from its task alone.
    expect(seen.some((s) => (s.role === "minds" || s.role === "memory") && s.head.includes("PIER-NOTE"))).toBe(false);
  });
});

describe("knowledge before the plan", () => {
  const claim = "The harbor master moved the ferry to the north pier.";

  /** A decision on which pier Danny walks to, once he heard `claim` said, with the user's settings patched by `patch` first: what the turn was handed to record, whom it asked in order, and the odds. */
  async function decided(patch?: JsonObject): Promise<{ learned: LedgerEvent[]; order: string[]; odds: RoleResult<TieOdds | null> }> {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    if (patch) rig.body(await rig.send({ type: "lre.settings.set", patch }));
    const order: string[] = [];
    rig.host.quietReply = (req: QuietRequest) => {
      const head = req.messages[0]?.content ?? "";
      const role = /You are the (\w+) agent of LumiRPEngine/.exec(head)?.[1] ?? "classic";
      order.push(role);
      const task = req.messages.slice(1).map((m) => m.content).join("\n");
      if (role === "knowledge") return JSON.stringify({ facts: [{ ref: "n1", claim, matters: "Danny walks to the pier it names", about: [], truth: "true" }], learned: [{ who: ["Danny Okafor"], fact: "n1", how: "witnessed" }], inferred: [], doubted: [] });
      if (role === "director") return JSON.stringify({ t0: { probabilities: task.includes(claim) ? { north: 0.9, south: 0.1 } : { north: 0.1, south: 0.9 } } });
      return "{}";
    };
    const { state, world } = await stateOf(rig, chatId);
    const messages = await rig.host.chats.messages(chatId, rig.host.userId);
    // The greeting stands for the message the choosers heard.
    const said = messages.at(-1);
    if (!said) throw new Error("no message");
    const settings = await rig.rt.settings.get(rig.host.userId);
    const learned: LedgerEvent[] = [];
    const task: ChooseTask = {
      phase: "pre",
      ties: [{ key: "ferry", agent: DANNY, options: ["north", "south"] }],
      world,
      state,
      describe: () => ({ choice: "which pier to walk to for the ferry" }),
      template: null,
      knowing: true,
      heard: { messageId: said.id, text: claim, connection: null, learned: (events) => void learned.push(...events) },
      classic: async () => null,
    };
    // A person's choice and the knowledge step read what their task holds: no tool reads or writes.
    const none = { reader: {} as ToolReader, writer: {} as ToolWriter };
    const ctx: TurnAgentCtx = {
      turn: new AgentTurn(settings.agents.turn),
      signal: new AbortController().signal,
      userId: rig.host.userId,
      chatId,
      generationId: "gen-knowledge-first",
      ...none,
      role: "director",
      agentId: "director",
      settings: settings.agents.roles.director,
      brief: null,
      readAs: () => none,
    };
    return { learned, order, odds: await decideRun(rig.rt, task, ctx) };
  }

  test("a decision that turns on what its chooser heard runs the knowledge step for them first, and reads what they now hold", async () => {
    const { learned, order, odds } = await decided();
    expect(learned.length).toBeGreaterThan(0);
    expect(order.indexOf("knowledge")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("knowledge")).toBeLessThan(order.indexOf("director"));
    expect(odds.ok && odds.out?.ferry).toEqual({ north: 0.9, south: 0.1 });
  });

  test("keeps what they learned as the read does: under the user's learn mode Never, the turn records none of it, and the decision reads what they held before (M4)", async () => {
    const { learned, order, odds } = await decided({ extraction: { learn: { mode: "never" } } });
    expect(order).toContain("knowledge");
    expect(learned).toEqual([]);
    expect(odds.ok && odds.out?.ferry).toEqual({ north: 0.1, south: 0.9 });
  });
});

describe("Test for a role's text on Settings → Agents → Prompts (lre.prompts test)", () => {
  test("runs the role once on the chat: the shipped answer passes, an edit that breaks its contract fails in words, a text with a problem makes no call, and only a role's text is tested", async () => {
    const rig = new Rig({ shipped: true });
    const { agents } = await pair(rig);
    // The scripted model answers in the form the text under test asks for.
    rig.host.quietReply = (req: QuietRequest) => (req.messages.map((m) => m.content).join("\n").includes('{"changes"') ? JSON.stringify({ changes: [] }) : JSON.stringify({ proposals: [] }));
    const def = PROMPTS.find((d) => d.id === "role.read.extract.answer");
    if (!def) throw new Error("no text");
    const tested = async (id: string, text: string): Promise<{ ok: boolean; problems: string[]; left: string[]; calls: number }> => {
      const before = rig.host.quietCalls.length;
      const body = rig.body(await rig.send({ type: "lre.prompts", op: "test", chatId: agents, id, text })) as { test: { ok: boolean; problems: string[]; left: string[] } };
      return { ...body.test, calls: rig.host.quietCalls.length - before };
    };
    const shipped = await tested(def.id, def.text);
    expect(shipped).toMatchObject({ ok: true, problems: [], calls: 1 });
    // A chat with only its greeting has no player's message and no turn's record: Test says what it left out.
    expect(shipped.left.some((l) => l.startsWith("the player's message: "))).toBe(true);
    expect(shipped.left.some((l) => l.startsWith("the turn's record: "))).toBe(true);
    const broken = await tested(def.id, 'Output JSON only: {"changes": [...]}.');
    expect(broken.ok).toBe(false);
    expect(broken.calls).toBe(1);
    expect(broken.problems.length).toBeGreaterThan(0);
    expect(broken.problems.every((p) => p.startsWith("the answer breaks its contract: "))).toBe(true);
    // The role's system prompt runs its first task, the read's extract, with its own answer text.
    const system = PROMPTS.find((d) => d.id === "role.read.system");
    if (!system) throw new Error("no text");
    expect(await tested(system.id, system.text)).toMatchObject({ ok: true, problems: [], calls: 1 });
    // A placeholder the text doesn't have is a problem, and no call is made, so nothing is left out.
    const flagged = await tested(def.id, `${def.text} {{nope}}`);
    expect([flagged.ok, flagged.calls, flagged.problems.length > 0, flagged.left]).toEqual([false, 0, true, []]);
    // The main agent's texts aren't a role's.
    expect((await rig.send({ type: "lre.prompts", op: "test", chatId: agents, id: "main.system", text: "Anything." })).type).toBe("lre.error");
  });

  test("builds the task from the chat's latest exchange as the turn does: the intent's, the read's and the memory's one call carry the player's message, the reply and the turn's state; an edit that breaks the contract fails; a task only a turn under way has runs on the role's texts, saying so", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
    const calls: { role: string | null; task: string }[] = [];
    rig.host.quietReply = (req: QuietRequest) => {
      const role = /You are the (\w+) agent of LumiRPEngine/.exec(req.messages[0]?.content ?? "")?.[1] ?? null;
      const task = req.messages.slice(1).map((m) => m.content).join("\n");
      calls.push({ role, task });
      if (task.includes('{"changes"')) return JSON.stringify({ changes: [] });
      if (role === "intent") return task.includes('"rating"') ? JSON.stringify({ rating: 1, reason: "Plain enough." }) : JSON.stringify({ action: null, params: {}, confidence: 0.9 });
      if (role === "read") return JSON.stringify({ proposals: [], where: null });
      if (role === "scene") return JSON.stringify({ lore: [], notes: [] });
      if (role === "minds") return JSON.stringify({ monologue: "A quiet morning.", intent: "Wait and see." });
      if (role === "memory") return JSON.stringify({ notes: [] });
      return "{}";
    };
    const said = "TEST-MESSAGE-MARK: I wave to Danny across the room.";
    const reply = "TEST-REPLY-MARK: Danny lifts a hand; Priya keeps writing.";
    const turn = await played(rig, chatId, said, reply);
    if (!turn.rec) throw new Error(`the turn halted: ${turn.halted ?? ""} ${turn.failed.join("; ")}`);
    const tested = async (id: string, text?: string): Promise<{ ok: boolean; problems: string[]; left: string[]; sent: { role: string | null; task: string }[] }> => {
      const def = PROMPTS.find((d) => d.id === id);
      if (!def) throw new Error(`no text ${id}`);
      const before = calls.length;
      const body = rig.body(await rig.send({ type: "lre.prompts", op: "test", chatId, id, text: text ?? def.text })) as { test: { ok: boolean; problems: string[]; left: string[] } };
      return { ...body.test, sent: calls.slice(before) };
    };
    // The intent's read of the player's message: the turn's own task, on the state the turn planned from.
    const intent = await tested("role.intent.interpret.answer");
    expect(intent).toMatchObject({ ok: true, problems: [], left: [] });
    expect(intent.sent.map((c) => c.role)).toEqual(["intent"]);
    expect(intent.sent[0]?.task).toContain(said);
    expect(intent.sent[0]?.task).toBe(calls.find((c) => c.role === "intent")?.task ?? "the turn made no intent call");
    // The read: the reply, the player's message and the state the reply was written in, as the turn's read had them.
    const read = await tested("role.read.extract.answer");
    expect(read).toMatchObject({ ok: true, problems: [], left: [] });
    expect(read.sent.map((c) => c.role)).toEqual(["read"]);
    expect(read.sent[0]?.task).toContain(reply);
    expect(read.sent[0]?.task).toContain(said);
    expect(read.sent[0]?.task).toContain("Danny Okafor");
    expect(read.sent[0]?.task).toBe(calls.find((c) => c.role === "read")?.task ?? "the turn made no read call");
    // The memory: the first one the reply's post phase asks, of someone who heard the exchange.
    const memory = await tested("role.memory.memory.answer");
    expect(memory).toMatchObject({ ok: true, problems: [], left: [] });
    expect(memory.sent.map((c) => c.role)).toEqual(["memory"]);
    expect(memory.sent[0]?.task).toContain(reply);
    expect(memory.sent[0]?.task).toContain(said);
    expect(memory.sent[0]?.task).toMatch(/Danny Okafor|Priya Nair/);
    // An edit that breaks the memory's contract fails, in words, on its one call.
    const broken = await tested("role.memory.memory.answer", 'Output JSON only: {"changes": []}.');
    expect(broken.ok).toBe(false);
    expect(broken.sent.length).toBe(1);
    expect(broken.problems.length).toBeGreaterThan(0);
    expect(broken.problems.every((p) => p.startsWith("the answer breaks its contract: "))).toBe(true);
    // An edit that breaks the intent's contract fails too.
    const misread = await tested("role.intent.interpret.answer", 'Output JSON only: {"changes": []}.');
    expect([misread.ok, misread.sent.length]).toEqual([false, 1]);
    // The judge's task is only a turn under way's: it runs on the intent role's texts, and says what it left out.
    const judge = await tested("role.intent.judge.answer");
    expect(judge).toMatchObject({ ok: true, problems: [] });
    expect(judge.sent.length).toBe(1);
    expect(judge.left.length).toBe(2);
    expect(judge.left[0]?.startsWith("the approach and the check it is rated for: ")).toBe(true);
    expect(judge.left[1]?.startsWith("the rest of its task: ")).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("Test for a role's text", () => {
  test("refuses an edit that breaks its task's contract, and passes the shipped text", async () => {
    const rig = new Rig({ shipped: true });
    const settings = await rig.rt.settings.get(rig.host.userId);
    const def = PROMPTS.find((d) => d.id === "role.read.extract.answer");
    if (!def) throw new Error("no text");
    // The model answers in the form the answer text names.
    const run = async (texts: Readonly<Record<string, string>>): Promise<{ text: string }> => ({ text: renderPrompt(def.id, texts, {}).includes('"changes"') ? JSON.stringify({ changes: [] }) : JSON.stringify({ proposals: [] }) });
    const shipped = await testRoleText(def, def.text, { maxChars: settings.prompts.maxChars, texts: settings.prompts.texts, run });
    expect(shipped.problems).toEqual([]);
    expect(shipped.contract?.problems).toEqual([]);
    const broken = await testRoleText(def, 'Output JSON only: {"changes":[...]}.', { maxChars: settings.prompts.maxChars, texts: settings.prompts.texts, run });
    expect(broken.contract?.problems.length).toBeGreaterThan(0);
  });
});

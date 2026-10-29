// The main agent (INC2-SPEC C14, lane T3): with Settings → Agents → Pipeline set to a main agent, an
// agents chat's turn is worked by one agent over the chat's session. The engine opens the turn's
// stages in C14's order and refuses a role out of its stage; the main agent runs the roles it wants,
// revises a run within its role's revision cap and commits each stage. Its failure stops the turn
// with the engine-failed card's Retry, never a fallback to classic. Its session is the chain's: a
// swipe and a Branch resume it where they stand, it compacts past its tokens, and GM → Workspace
// rolls a compaction back on the next turn's record. Classic to agents starts a fresh session from a
// digest of the chat so far; agents to classic and back resumes it, the digest covering the classic
// turns. The models are scripted: each role runs prompt-only, as classic's own calls.

import { describe, expect, test } from "bun:test";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { classicRoles } from "../../src/backend/agents/roles/classic";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import type { JsonObject } from "../../src/shared/json";
import type { Rec } from "../../src/shared/ledger";
import type { SessionView } from "../../src/shared/protocol";
import type { QuietScript } from "../support/fake-host";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
/** The compaction call's instructions, as shipped. */
const COMPACTION_MARK = "You keep a main agent's session short";
/** How a summary leads the main agent's history, as shipped. */
const SUMMARY_LEAD = "Your session before this point, summarized:";

/** Every role prompt-only: each runs as its classic step's own call, which the tests script. */
const PROMPT_ONLY = Object.fromEntries(ROLE_IDS.map((id) => [id, { promptOnly: true }]));

const call = (name: string, args: JsonObject, callId: string): QuietToolCall => ({ name, args, callId });

/** A main agent's call: it is offered run_role; no role's call is. */
const isMain = (req: QuietRequest): boolean => (req.tools ?? []).some((t) => t.name === "run_role");

/** What the tools gave back to the call that sends their results. */
const resultsOf = (req: QuietRequest): string[] => (req.messages.at(-1)?.parts ?? []).flatMap((p) => (p.type === "tool_result" ? [p.content] : []));

/** The stage message a main agent's call answers: its latest one. */
const stageOf = (req: QuietRequest): string => req.messages.findLast((m) => m.role === "user" && m.content.includes("Stage "))?.content ?? "";

/** The stage's number, from its message. */
const stageNumber = (req: QuietRequest): number => Number(/Stage (\d) of 8/.exec(stageOf(req).slice(stageOf(req).lastIndexOf("Stage ")))?.[1] ?? 0);

/** Everything a call was sent, as one text. */
const sentOf = (req: QuietRequest): string => req.messages.map((m) => m.content).join("\n\n");

/**
 * The scripted models: the main agent runs every role its stage asks for, each with a task naming
 * `tag`, and commits in the same answer, unless `script` answers the call first; the compaction call
 * answers `summary`; the roles' classic calls read no action and propose nothing. The main agent's
 * calls, in order.
 */
function models(rig: Rig, opts: { tag?: () => string; summary?: string; script?: (req: QuietRequest, n: number) => QuietScript | undefined } = {}): QuietRequest[] {
  const asked: QuietRequest[] = [];
  rig.host.quietReply = (req) => {
    if (isMain(req)) {
      asked.push(req);
      const n = asked.length - 1;
      const own = opts.script?.(req, n);
      if (own !== undefined) return own;
      const roles = [...new Set([...stageOf(req).matchAll(/^- (\w+):/gm)].map((m) => m[1] ?? ""))];
      const tag = opts.tag?.() ?? "task";
      return { content: "", toolCalls: [...roles.map((role) => call("run_role", { role, task: `${tag} for ${role}` }, `c${n}_${role}`)), call("commit", {}, `c${n}_commit`)] };
    }
    if (sentOf(req).includes(COMPACTION_MARK)) return opts.summary ?? "The summary.";
    const prompt = req.messages[0]?.content ?? "";
    if (prompt.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [] });
    return "{}";
  };
  return asked;
}

/** A Port Alder chat on agents, its turns run by a main agent, every role prompt-only; `patch` joins the settings. */
async function mainChat(rig: Rig, patch: JsonObject = {}): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { mode: "main" }, roles: PROMPT_ONLY } } }));
  if (Object.keys(patch).length > 0) rig.body(await rig.send({ type: "lre.settings.set", patch }));
  expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
  return chatId;
}

/** The head reply's active record. */
async function lastRecord(rig: Rig, chatId: string): Promise<Rec> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const head = rig.host.head(chatId);
  const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
  if (!rec) throw new Error("no record");
  return rec;
}

/** Plays `text` as the next turn with `reply`: the turn's record. */
async function played(rig: Rig, chatId: string, text: string, reply: string): Promise<Rec> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  expect(g.halted).toBeUndefined();
  await rig.host.finish(g, reply);
  return lastRecord(rig, chatId);
}

async function sessionOf(rig: Rig, chatId: string, op: "session" | "rollback" = "session"): Promise<SessionView> {
  return rig.body(await rig.send({ type: "lre.workspace", chatId, op })).session as SessionView;
}

describe("the main agent's turn", () => {
  test("the engine opens C14's stages in order and refuses a role out of its stage, or past it", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig);
    const asked = models(rig, {
      script: (req, n) => {
        // In the intent's stage the read, which works after the reply, is asked for first.
        if (n === 0) return { content: "", toolCalls: [call("run_role", { role: "read", task: "Read the reply now." }, "early")] };
        // After the reply, the intent's stage is over.
        if (stageNumber(req) === 7 && resultsOf(req).length === 0) return { content: "", toolCalls: [call("run_role", { role: "intent", task: "Read the message again." }, "late")] };
        return undefined;
      },
    });
    const rec = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(stageNumber(asked[0] as QuietRequest)).toBe(1);
    expect(resultsOf(asked[1] as QuietRequest).join("\n")).toContain("Out of order: the read role works at stage 7");
    const late = asked.findIndex((req) => resultsOf(req).some((r) => r.includes("intent role's stage is over")));
    expect(late).toBeGreaterThan(0);
    // Every stage it worked came in C14's order, the intent first, the memory last.
    const stages = asked.map(stageNumber);
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
    expect(new Set(stages)).toEqual(new Set([1, 3, 5, 7, 8]));
    // The refused calls ran nothing: one read of the message, one of the reply.
    expect(rig.host.quietCalls.filter((c) => (c.messages[0]?.content ?? "").includes(INTERPRET_MARK))).toHaveLength(1);
    expect(rig.host.quietCalls.filter((c) => (c.messages[0]?.content ?? "").includes(EXTRACT_MARK))).toHaveLength(1);
    // The turn task opened its first stage: a fresh session's digest of the chat so far, then the player's message.
    expect(sentOf(asked[0] as QuietRequest)).toContain("You take this chat up now");
    expect(sentOf(asked[0] as QuietRequest)).toContain("I look out over the harbor.");
    expect(typeof rec.session?.segment).toBe("string");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a run is revised within its role's revision cap, its revision told the role, and the run past the cap refused", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig, { agents: { roles: { intent: { budget: { revisions: 1 } } } } });
    const briefs: (string | null)[] = [];
    const roles = classicRoles();
    rig.rt.orchestrator.roles = {
      ...roles,
      intent: {
        ...roles.intent,
        interpret: (task, ctx) => {
          briefs.push(ctx.brief?.for("pov") ?? null);
          return roles.intent.interpret(task, ctx);
        },
      },
    };
    const agentOf = (req: QuietRequest): string => /^(\S+): the intent role/m.exec(resultsOf(req).join("\n"))?.[1] ?? "";
    const asked = models(rig, {
      script: (req, n) => {
        if (n === 0) return { content: "", toolCalls: [call("run_role", { role: "intent", task: "Read the harbor look." }, "first")] };
        if (n === 1) return { content: "", toolCalls: [call("revise", { agentId: agentOf(req), message: "Is a look an action?" }, "again")] };
        if (n === 2) return { content: "", toolCalls: [call("revise", { agentId: agentOf(req), message: "Once more." }, "past")] };
        if (n === 3) return { content: "", toolCalls: [call("commit", {}, "done")] };
        return undefined;
      },
    });
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(resultsOf(asked[2] as QuietRequest).join("\n")).toContain("the intent role answered");
    expect(resultsOf(asked[3] as QuietRequest).join("\n")).toContain("has had the 1 revision its role allows");
    // Two runs, the first with the task, the revision with the task and its message; the refused one ran nothing.
    expect(briefs).toHaveLength(2);
    expect(briefs[0]).toContain("Read the harbor look.");
    expect(briefs[1]).toContain("Read the harbor look.");
    expect(briefs[1]).toContain("Is a look an action?");
    expect(rig.host.quietCalls.filter((c) => (c.messages[0]?.content ?? "").includes(INTERPRET_MARK))).toHaveLength(2);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a main agent that fails", () => {
  test("stops the turn with the engine-failed card's Retry, never playing it on classic; the Retry plays it", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig);
    models(rig, {
      script: () => {
        throw new Error("connection reset");
      },
    });
    rig.host.sendUser(chatId, "I look out over the harbor.");
    await rig.host.settle();
    const stopped = await rig.host.start(chatId, { type: "normal" });
    expect(stopped.halted).toBeDefined();
    const flag = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "engine_failed");
    expect(flag?.detail).toContain("Main agent");
    expect(flag?.actions.some((a) => a.label === "Retry")).toBe(true);
    // No classic step stood in for it.
    expect(rig.host.quietCalls.some((c) => (c.messages[0]?.content ?? "").includes(INTERPRET_MARK))).toBe(false);
    // Retry runs the turn again, on its main agent.
    const asked = models(rig);
    const g = await rig.host.start(chatId, { type: "regenerate" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "Gulls wheel over the water.");
    expect(asked.length).toBeGreaterThan(0);
    expect(typeof (await lastRecord(rig, chatId)).session?.segment).toBe("string");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("after the reply, stops the read as a cancelled one stops, which leaves Retry read; Retry read reads it on the roles, with no main agent's stage", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig);
    models(rig, {
      script: (req) => {
        if (stageNumber(req) === 7) throw new Error("connection reset");
        return undefined;
      },
    });
    rig.host.sendUser(chatId, "I look out over the harbor.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "Gulls wheel over the water.");
    const stopped = await lastRecord(rig, chatId);
    expect([stopped.status, stopped.events.length === stopped.pre]).toEqual(["stopped", true]);
    const retry = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "retry_read");
    if (!retry) throw new Error("no Retry read");
    // A Retry read is the read alone: its roles run each by its own settings (prompt-only here, so classic's calls), and no main agent works it.
    const asked = models(rig);
    const from = rig.host.quietCalls.length;
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: retry.id, choice: "retry_read" }));
    expect((await lastRecord(rig, chatId)).status).toBe("ok");
    expect(asked.length).toBe(0);
    expect(rig.host.quietCalls.slice(from).some((c) => (c.messages[0]?.content ?? "").includes(EXTRACT_MARK))).toBe(true);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "retry_read")).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the main session", () => {
  test("compacts past its tokens, keeping its latest turns whole; a rollback from GM → Workspace lands on the next turn's record", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig, { agents: { compaction: { atTokens: 1, keepTurns: 1 } } });
    let turn = "first";
    const asked = models(rig, { tag: () => `task-${turn}`, summary: "SUMMARY of the harbor turns." });
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect((await sessionOf(rig, chatId)).rollback).toBe("none");
    turn = "second";
    // One turn in the session is no more than the one kept whole: nothing to compact yet.
    const second = await played(rig, chatId, "I walk to the pier.", "The boards creak.");
    expect(second.session?.summary).toBeUndefined();
    turn = "third";
    const from = asked.length;
    const third = await played(rig, chatId, "I sit on a bench.", "The bench is warm.");
    // The first turn is summarized by one call with the compaction instructions; the second stays whole.
    expect(rig.host.quietCalls.filter((c) => sentOf(c).includes(COMPACTION_MARK))).toHaveLength(1);
    expect(typeof third.session?.summary).toBe("string");
    expect(typeof third.session?.archived).toBe("string");
    const compacted = sentOf(asked[from] as QuietRequest);
    expect(compacted).toContain(SUMMARY_LEAD);
    expect(compacted).toContain("SUMMARY of the harbor turns.");
    expect(compacted).not.toContain("task-first");
    expect(compacted).toContain("task-second");
    expect(await sessionOf(rig, chatId)).toMatchObject({ summary: "SUMMARY of the harbor turns.", turns: 2, rollback: "available" });
    // GM → Workspace asks for the rollback: nothing changes until the next turn, whose record carries it.
    expect((await sessionOf(rig, chatId, "rollback")).rollback).toBe("pending");
    expect((await lastRecord(rig, chatId)).session?.summary).toBe(third.session?.summary);
    turn = "fourth";
    const back = asked.length;
    const fourth = await played(rig, chatId, "I stand up.", "You stand.");
    const restored = sentOf(asked[back] as QuietRequest);
    expect(restored).toContain("task-first");
    expect(restored).not.toContain(SUMMARY_LEAD);
    // No new compaction on the turn that rolled one back.
    expect(rig.host.quietCalls.filter((c) => sentOf(c).includes(COMPACTION_MARK))).toHaveLength(1);
    expect(typeof fourth.session?.summary).toBe("string");
    expect(fourth.session?.summary).not.toBe(third.session?.summary);
    // The restored span is no compaction: it offers no rollback, so pressing it can't re-apply the one undone.
    expect(await sessionOf(rig, chatId)).toMatchObject({ summary: null, turns: 4, rollback: "none" });
    expect((await rig.send({ type: "lre.workspace", chatId, op: "rollback" })).type).toBe("lre.error");
    // The earlier record is as it was.
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const messages = await rig.host.chats.messages(chatId, rig.host.userId);
    const thirdReply = messages.filter((m) => !m.isUser).at(-2);
    expect(thirdReply ? core?.journal.messages[thirdReply.id]?.ledger.swipes[String(thirdReply.swipeId)]?.session : undefined).toEqual(third.session);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the summarize tool compacts the session when the main agent asks, once a turn", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig, { agents: { compaction: { keepTurns: 1 } } });
    const asked = models(rig, { summary: "SUMMARY by request." });
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    await played(rig, chatId, "I walk to the pier.", "The boards creak.");
    const from = asked.length;
    models(rig, {
      summary: "SUMMARY by request.",
      script: (req, n) => {
        if (n === 0) return { content: "", toolCalls: [call("summarize", {}, "s1"), call("summarize", {}, "s2")] };
        return undefined;
      },
    });
    const third = await played(rig, chatId, "I sit on a bench.", "The bench is warm.");
    expect(from).toBeGreaterThan(0);
    const answered = rig.host.quietCalls.filter(isMain).find((req) => resultsOf(req).some((r) => r.includes("Your session is summarized")));
    expect(answered && resultsOf(answered).join("\n")).toContain("summarized this turn already");
    expect(typeof third.session?.summary).toBe("string");
    expect(await sessionOf(rig, chatId)).toMatchObject({ summary: "SUMMARY by request.", rollback: "available" });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("resumes along the chain: a swipe reads the session at its parent, and a Branch the session where it was made", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig);
    let turn = "one";
    const asked = models(rig, { tag: () => `task-${turn}` });
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    const first = rig.host.head(chatId);
    if (!first) throw new Error("no reply");
    turn = "two";
    await played(rig, chatId, "I walk to the pier.", "The boards creak.");
    // A swipe of the second turn (a Re-run): its main agent reads the first turn, never the swipe it replaces.
    turn = "two-again";
    const swiped = asked.length;
    const g = await rig.host.start(chatId, { type: "swipe" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "The boards creak again.");
    const swipe = sentOf(asked[swiped] as QuietRequest);
    expect(swipe).toContain("task-one");
    expect(swipe).not.toContain("task-two ");
    // The next turn reads the swipe that stands.
    turn = "three";
    const next = asked.length;
    await played(rig, chatId, "I sit down.", "You sit.");
    expect(sentOf(asked[next] as QuietRequest)).toContain("task-two-again");
    expect(sentOf(asked[next] as QuietRequest)).not.toContain("task-two for");
    // A Branch at the first reply resumes the session as it stood there, on agents still.
    const branch = rig.host.branch(chatId, first.id);
    turn = "branch";
    const branched = asked.length;
    await played(rig, branch, "I look at the boats.", "The boats bob.");
    const there = sentOf(asked[branched] as QuietRequest);
    expect(there).toContain("task-one");
    expect(there).not.toContain("task-two");
    expect(there).not.toContain("task-three");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the Engine switch and the main session", () => {
  test("classic to agents starts a fresh session from a digest of the chat so far; agents to classic and back resumes it, the digest covering the classic turn", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig);
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: null }));
    let turn = "one";
    const asked = models(rig, { tag: () => `task-${turn}` });
    // Two classic turns: no session, and no main agent.
    const classic = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    await played(rig, chatId, "I walk to the pier.", "The boards creak.");
    expect(classic.session).toBeUndefined();
    expect(asked).toHaveLength(0);
    // Switched to agents: the main agent takes the chat up with a digest of it so far, and no session.
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
    turn = "agents";
    await played(rig, chatId, "I sit on a bench.", "The bench is warm.");
    const fresh = asked[0] as QuietRequest;
    expect(sentOf(fresh)).toContain("You take this chat up now");
    expect(sentOf(fresh)).toContain("I look out over the harbor.");
    expect(sentOf(fresh)).toContain("The boards creak.");
    expect(fresh.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
    // Back to classic for a turn, then agents again: the session resumes from the chain, and the digest says what happened since.
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: null }));
    const between = await played(rig, chatId, "I watch a ferry leave.", "The ferry sounds its horn.");
    expect(between.session).toBeUndefined();
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
    turn = "back";
    const back = asked.length;
    await played(rig, chatId, "I stand up.", "You stand.");
    // Its history holds its own turn; its turn task (the message it is sent now) says what happened since.
    expect(sentOf(asked[back] as QuietRequest)).toContain("task-agents");
    const task = asked[back]?.messages.at(-1)?.content ?? "";
    expect(task).toContain("What happened in this chat since your last turn");
    expect(task).toContain("I watch a ferry leave.");
    expect(task).not.toContain("You take this chat up now");
    expect(task).not.toContain("I walk to the pier.");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

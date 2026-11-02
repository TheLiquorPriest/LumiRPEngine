// The main agent (INC2-SPEC C14, lane T3): with Settings → Agents → Pipeline set to a main agent, an
// agents chat's turn is worked by one agent over the chat's session. The engine opens the turn's
// stages in C14's order and refuses a role out of its stage; the main agent runs the roles it wants,
// revises a run within its role's revision cap and commits each stage. Its failure stops the turn
// with the engine-failed card's Retry, never a fallback to classic. Its session is the chain's: a
// swipe and a Branch resume it where they stand, it compacts past its tokens, and GM → Workspace
// rolls a compaction back on the next turn's record. Classic to agents starts a fresh session from a
// digest of the chat so far; agents to classic and back resumes it, the digest covering the classic
// turns. The models are scripted: each role runs prompt-only, as classic's own calls, but where a
// test runs the roles as agents (what a run gave the engine): there each role's agent answers.

import { describe, expect, test } from "bun:test";
import { listWorkspace } from "../../src/backend/agents/tools/workspace";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { classicRoles } from "../../src/backend/agents/roles/classic";
import { defaultRoleSettings, ROLE_IDS, ROLE_LABEL } from "../../src/shared/agent-roles";
import type { JsonObject } from "../../src/shared/json";
import type { Rec } from "../../src/shared/ledger";
import type { ReviewCardView, SessionView } from "../../src/shared/protocol";
import { factsOf, knowersOf } from "../../src/packs/minds/core/knowledge";
import { readSlice } from "../../src/packs/minds/core/state";
import type { QuietScript } from "../support/fake-host";
import { alderChat, DANNY, PRIYA, stateOf } from "../support/mind-chat";
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
  // The turn's tokens unbounded: its roles, its stages and its final review never run out of the turn's budget mid-test.
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { mode: "main" }, roles: PROMPT_ONLY, turn: { tokensIn: "none", tokensOut: "none" } } } }));
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
          briefs.push(ctx.brief);
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

describe("the main agent's system files", () => {
  test("AGENTS.md and roles/main.md follow its system prompt in every call, the global workspace's before the chat's; a role's own file and a system file listed in .pins.json are no part of its turn task", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await mainChat(rig);
    const write = async (path: string, text: string): Promise<void> => void rig.body(await rig.send({ type: "lre.workspace", chatId, op: "write", path, text }));
    await write("~/AGENTS.md", "GLOBAL-AGENTS-MARK: write plainly.");
    await write("~/roles/main.md", "GLOBAL-MAIN-MARK: run the scene role first.");
    await write("AGENTS.md", "CHAT-AGENTS-MARK: this chat is a quiet one.");
    await write("roles/main.md", "CHAT-MAIN-MARK: keep the turn short.");
    await write("roles/read.md", "READ-MARK: name who acts.");
    await write(".pins.json", JSON.stringify({ main: { files: ["AGENTS.md", "roles/main.md"] } }));
    const asked = models(rig);
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(asked.length).toBeGreaterThan(1);
    const order = ["GLOBAL-AGENTS-MARK", "GLOBAL-MAIN-MARK", "CHAT-AGENTS-MARK", "CHAT-MAIN-MARK"];
    for (const req of asked) {
      const system = req.messages[0]?.content ?? "";
      expect(req.messages[0]?.role).toBe("system");
      const at = order.map((mark) => system.indexOf(mark));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(system).not.toContain("READ-MARK");
      // Once, in the system prompt: the pins manifest's listing of them adds nothing to the turn task.
      for (const mark of order) expect(sentOf(req).split(mark).length).toBe(2);
    }
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

describe("a GM note on the reply a Regenerate remakes", () => {
  test("written in GM → Workspace on the shown head swipe, it follows a Regenerate of that reply, in the fixed pipeline and the main one", async () => {
    for (const [mode, trim] of [["fixed", false], ["main", false], ["fixed", true], ["main", true]] as const) {
      const rig = new Rig({ shipped: true });
      const chatId = await mainChat(rig, { agents: { pipeline: { mode } } });
      models(rig);
      await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
      const head = rig.host.head(chatId);
      if (!head) throw new Error("no reply");
      const path = "notes/harbor.md";
      const text = "The harbor master owes Danny a favour.";
      rig.body(await rig.send({ type: "lre.workspace", chatId, op: "write", path, text }));
      const notes = async (): Promise<string[]> => (await listWorkspace(rig.rt, { userId: rig.host.userId, chatId })).filter((f) => f.transcript !== true).map((f) => f.path);
      expect(await notes()).toEqual([path]);
      if (trim) expect(rig.rt.ledger.trim(() => false)).toContain(chatId);
      const g = await rig.host.start(chatId, { type: "regenerate" });
      expect(g.halted).toBeUndefined();
      await rig.host.finish(g, "Gulls wheel lower over the water.");
      expect(rig.host.message(chatId, head.id).swipes.length).toBe(2);
      expect(rig.host.message(chatId, head.id).swipeId).toBe(1);
      expect([mode, trim, await notes()]).toEqual([mode, trim, [path]]);
      expect(rig.rt.ledger.errors).toEqual([]);
    }
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

describe("what a run gave the engine", () => {
  const QUIT = "Danny is taking the marina job at the end of the month";
  const NOTE = "notes/scene.md";
  const NOTE_TEXT = "SCENE-NOTE: the harbor is quiet this morning.";

  /** Port Alder with Danny and Priya beside the player character, minds on, played on agents by a main agent; the roles agent-backed, as §15 ships them; `patch` joins the settings. */
  async function rolesChat(rig: Rig, patch: JsonObject = {}): Promise<string> {
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { mode: "main" }, turn: { tokensIn: "none", tokensOut: "none" } } } }));
    if (Object.keys(patch).length > 0) rig.body(await rig.send({ type: "lre.settings.set", patch }));
    expect(rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" })).engine).toBe("agents");
    return chatId;
  }

  /** A role agent's answer in its contract, with nothing in it. */
  function quietRole(role: string, req: QuietRequest): QuietScript {
    const all = sentOf(req);
    if (role === "scene") return JSON.stringify({ lore: [], notes: [] });
    if (role === "knowledge") return JSON.stringify({ facts: [], learned: [], inferred: [], doubted: [] });
    if (role === "minds") return JSON.stringify({ monologue: "Nothing yet.", depiction: "looks up", intent: "Wait.", reactions: [], mood: "calm" });
    if (role === "memory") return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [] });
    if (all.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (all.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [], where: null });
    return "{}";
  }

  /**
   * The turn's agents as scripted: the main agent runs every role its stage asks for and commits once
   * the results are in, unless `main` answers its call first; each role's agent answers as `roles`
   * says, else in its contract with nothing. The main agent's calls, in order.
   */
  function agentModels(rig: Rig, roles: Readonly<Record<string, (req: QuietRequest) => QuietScript>> = {}, main?: (req: QuietRequest, n: number) => QuietScript | Promise<QuietScript> | undefined): QuietRequest[] {
    const asked: QuietRequest[] = [];
    rig.host.quietReply = (req) => {
      if (isMain(req)) {
        asked.push(req);
        const n = asked.length - 1;
        const own = main?.(req, n);
        if (own !== undefined) return own;
        if (resultsOf(req).length > 0) return { content: "", toolCalls: [call("commit", {}, `c${n}_commit`)] };
        const open = [...new Set([...stageOf(req).matchAll(/^- (\w+):/gm)].map((m) => m[1] ?? ""))];
        return { content: "", toolCalls: open.map((role) => call("run_role", { role, task: `Do the ${role} work.` }, `c${n}_${role}`)) };
      }
      const role = /You are the (\w+) agent of LumiRPEngine/.exec(req.messages[0]?.content ?? "")?.[1];
      if (role === undefined) return "{}";
      return roles[role]?.(req) ?? quietRole(role, req);
    };
    return asked;
  }

  /** What run_role and revise answered the main agent about `role`'s runs, in order. */
  const ranOf = (asked: readonly QuietRequest[], role: string): string[] => asked.flatMap(resultsOf).filter((r) => r.includes(`: the ${role} role `));

  test("a turn's knowledge role, one call per person, records what each learned, and its run tells the main agent the facts and learnings it recorded, never 0 events", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await rolesChat(rig, { minds: { knowledge: { batch: "character" } } });
    const asked = agentModels(rig, { knowledge: () => JSON.stringify({ facts: [{ ref: "n1", claim: QUIT, matters: "Marcus loses his mechanic", about: ["Danny Okafor"], truth: "true" }], learned: [{ fact: "n1", how: "witnessed" }], inferred: [], doubted: [] }) });
    await played(rig, chatId, "Morning, Danny.", "Danny says he's taking the marina job at the end of the month.");
    const slice = readSlice((await stateOf(rig, chatId)).state);
    const quit = Object.values(factsOf(slice)).find((f) => f.claim === QUIT)?.id ?? "";
    expect(knowersOf(slice, quit)).toEqual(expect.arrayContaining([DANNY, PRIYA, "pov"]));
    const [ran = ""] = ranOf(asked, "knowledge");
    expect(ran).toContain('"facts":1');
    expect(ran).toContain('"yours":1');
    expect(ran).not.toContain('"events"');
    expect(ran).not.toContain("What the engine didn't take");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a knowledge answer the step refuses says why, by kind: to the main agent, in Diagnostics and in the host log", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await rolesChat(rig);
    // A new fact that doesn't say why it matters is refused, and so is the learning of it.
    const asked = agentModels(rig, { knowledge: () => JSON.stringify({ facts: [{ ref: "n1", claim: QUIT, about: ["Danny Okafor"], truth: "true" }], learned: [{ fact: "n1", how: "witnessed" }], inferred: [], doubted: [] }) });
    await played(rig, chatId, "Morning, Danny.", "Danny says he's taking the marina job at the end of the month.");
    const [ran = ""] = ranOf(asked, "knowledge");
    expect(ran).toContain('"facts":0');
    expect(ran).toContain("What the engine didn't take: 1 refused (no matters: a new fact says why it matters and to whom); 1 refused (a learning of no fact");
    const records = await rig.rt.diag.records(chatId, rig.host.userId);
    expect(records.some((r) => r.step === ROLE_LABEL.knowledge && r.level === "warn" && (r.reason ?? "").includes("1 refused (no matters"))).toBe(true);
    expect(rig.host.logs.some((l) => l.includes(`the ${ROLE_LABEL.knowledge} role's run: What the engine didn't take: 1 refused (no matters`))).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a scene's workspace_write is staged: its tool says it lands with the turn, its run says it staged one, the main agent's workspace_list and workspace_read see it before the stage commits, and it lands", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await rolesChat(rig);
    const told: string[] = [];
    const asked = agentModels(
      rig,
      {
        scene: (req) => {
          if (resultsOf(req).length === 0) return { content: "", toolCalls: [call("workspace_write", { path: NOTE, text: NOTE_TEXT }, "w1")] };
          told.push(...resultsOf(req));
          return JSON.stringify({ lore: [], notes: [] });
        },
      },
      // In stage 3, once its runs are in, the main agent reads the workspace before it commits.
      (req, n) => (stageNumber(req) === 3 && resultsOf(req).some((r) => r.includes("the scene role answered")) ? { content: "", toolCalls: [call("workspace_list", {}, `l${n}`), call("workspace_read", { path: NOTE }, `r${n}`)] } : undefined),
    );
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(told.join("\n")).toContain('"staged"');
    expect(told.join("\n")).toContain("Staged for this turn: it lands when the turn commits.");
    expect(ranOf(asked, "scene").join("\n")).toContain("Its changes: 1 staged, landing when the turn commits.");
    const looked = asked.flatMap(resultsOf).filter((r) => r.includes(NOTE));
    expect(looked.some((r) => r.includes('"files"'))).toBe(true);
    expect(looked.some((r) => r.includes(NOTE_TEXT))).toBe(true);
    const files = await listWorkspace(rig.rt, { userId: rig.host.userId, chatId });
    expect(files.find((f) => f.path === NOTE)).toMatchObject({ provenance: { role: "scene" } });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a write under Confirm tells its agent it waits for the GM's Apply on the review card, its run says it is held for the card, and the card lists it", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await rolesChat(rig, { extraction: { workspace: { mode: "confirm" } } });
    const told: string[] = [];
    const asked = agentModels(rig, {
      scene: (req) => {
        if (resultsOf(req).length === 0) return { content: "", toolCalls: [call("workspace_write", { path: NOTE, text: NOTE_TEXT }, "w1")] };
        told.push(...resultsOf(req));
        return JSON.stringify({ lore: [], notes: [] });
      },
    });
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(told.join("\n")).toContain("waiting for the GM's Apply on the review card");
    expect(ranOf(asked, "scene").join("\n")).toContain("1 held for the review card, waiting for the GM's Apply");
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as ReviewCardView[];
    expect(cards.flatMap((c) => c.items).map((i) => i.changeType)).toEqual(["workspace"]);
    expect((await listWorkspace(rig.rt, { userId: rig.host.userId, chatId })).some((f) => f.path === NOTE)).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a revision replaces its run as it starts: what the run staged goes first, the revision reads the turn without it, and only the revision's write lands", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await rolesChat(rig);
    const FIRST = "notes/first.md";
    const SECOND = "notes/second.md";
    const listed: string[] = [];
    const asked = agentModels(
      rig,
      {
        scene: (req) => {
          const got = resultsOf(req);
          const revised = sentOf(req).includes("REVISE-MARK");
          if (!revised) return got.length === 0 ? { content: "", toolCalls: [call("workspace_write", { path: FIRST, text: "The first note." }, "w1")] } : JSON.stringify({ lore: [], notes: [] });
          // The revision lists the workspace first, then writes its own note.
          if (got.length === 0) return { content: "", toolCalls: [call("workspace_list", {}, "l1")] };
          if (got.some((r) => r.includes('"files"'))) {
            listed.push(...got);
            return { content: "", toolCalls: [call("workspace_write", { path: SECOND, text: "The second note." }, "w2")] };
          }
          return JSON.stringify({ lore: [], notes: [] });
        },
      },
      (req, n) => {
        if (stageNumber(req) !== 3) return undefined;
        const agent = /^(\S+): the scene role answered/m.exec(resultsOf(req).join("\n"))?.[1];
        // The scene's first run is in: the main agent revises it once, then commits.
        return agent && !asked.some((q) => sentOf(q).includes("REVISE-MARK")) ? { content: "", toolCalls: [call("revise", { agentId: agent, message: "REVISE-MARK: keep your note elsewhere." }, `v${n}`)] } : undefined;
      },
    );
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    expect(listed.join("\n")).not.toContain(FIRST);
    expect(ranOf(asked, "scene").at(-1)).toContain("Its changes: 1 staged, landing when the turn commits.");
    const paths = (await listWorkspace(rig.rt, { userId: rig.host.userId, chatId })).map((f) => f.path);
    expect(paths).toContain(SECOND);
    expect(paths).not.toContain(FIRST);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a request runs once at a time: a second run_role or revise of it in the same answer is told its run is under way, so only the run that stands lands what it staged", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await rolesChat(rig);
    const RUNNING = "The scene role is already running in this stage, started by another of your calls";
    // Each scene run writes a note of its own, numbered as the run starts, then answers.
    let runs = 0;
    let prepared = 0;
    const asked = agentModels(
      rig,
      { scene: (req) => (resultsOf(req).length === 0 ? { content: "", toolCalls: [call("workspace_write", { path: `notes/run-${++runs}.md`, text: `Scene run ${runs}.` }, "w1")] } : JSON.stringify({ lore: [], notes: [] })) },
      (req, n) => {
        if (stageNumber(req) !== 3) return undefined;
        prepared++;
        // Its first answer runs the scene twice, beside the stage's other roles; its next revises the scene's run twice; then it commits.
        if (prepared === 1) {
          const open = [...new Set([...stageOf(req).matchAll(/^- (\w+):/gm)].map((m) => m[1] ?? ""))].filter((role) => role !== "scene");
          return { content: "", toolCalls: [call("run_role", { role: "scene", task: "Set the scene." }, "s1"), call("run_role", { role: "scene", task: "Set the scene again." }, "s2"), ...open.map((role) => call("run_role", { role, task: `Do the ${role} work.` }, `c${n}_${role}`))] };
        }
        const agent = /^(\S+): the scene role answered/m.exec(resultsOf(req).join("\n"))?.[1] ?? "";
        return prepared === 2 ? { content: "", toolCalls: [call("revise", { agentId: agent, message: "Keep it shorter." }, "v1"), call("revise", { agentId: agent, message: "Shorter still." }, "v2")] } : undefined;
      },
    );
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    // Of each pair of calls, one ran the scene and the other was told its run was under way.
    for (const req of asked.filter((q) => stageNumber(q) === 3).slice(1, 3)) {
      const got = resultsOf(req);
      expect([got.filter((r) => r.includes(": the scene role answered")).length, got.filter((r) => r.includes(RUNNING)).length]).toEqual([1, 1]);
    }
    expect(runs).toBe(2);
    // Only the revision's note lands: the first run's went as the revision started, and no other run staged beside either.
    const notes = (await listWorkspace(rig.rt, { userId: rig.host.userId, chatId })).map((f) => f.path).filter((p) => p.startsWith("notes/run-"));
    expect(notes).toEqual(["notes/run-2.md"]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a request whose phase's time runs out after its run answered lands nothing the run staged: the turn goes on without it, and GM → Live says why its write was dropped", async () => {
    const LATE = "notes/late.md";
    const rig = new Rig({ shipped: true, minds: true });
    // The read may write the workspace, and the reads after the reply have a second.
    const chatId = await rolesChat(rig, { agents: { roles: { read: { families: [...defaultRoleSettings().read.families, "workspace"] } } }, timeouts: { postReplyMs: 1000 } });
    const asked = agentModels(
      rig,
      { read: (req) => (resultsOf(req).length === 0 ? { content: "", toolCalls: [call("workspace_write", { path: LATE, text: "Written by a read whose request ran out of time." }, "w1")] } : JSON.stringify({ proposals: [], where: null })) },
      // Once stage 7's runs are in, the main agent thinks past the reads' time, never committing.
      (req) => (stageNumber(req) === 7 && resultsOf(req).length > 0 ? new Promise<QuietScript>(() => undefined) : undefined),
    );
    const rec = await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    await rig.host.settle();
    expect(rec.status).toBe("ok");
    // The read answered, its note staged, before the time ran out.
    expect(ranOf(asked, "read")[0]).toContain("Its changes: 1 staged, landing when the turn commits.");
    expect((await listWorkspace(rig.rt, { userId: rig.host.userId, chatId })).some((f) => f.path === LATE)).toBe(false);
    const writes = (rig.rt.live.view(chatId, rig.host.userId)?.entries ?? []).flatMap((e) => (e.kind === "write" && e.role === "read" ? [[e.outcome, e.why ?? null]] : []));
    expect(writes).toEqual([["staged", null], ["dropped", "unused"]]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a read answer the engine reads less of says why, and an empty one says so", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await rolesChat(rig);
    const asked = agentModels(rig, { read: () => JSON.stringify({ proposals: [{ type: "mood", entity: "pov", value: "glad" }, { type: "time_advance", minutes: 0 }], where: null }) });
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    const [ran = ""] = ranOf(asked, "read");
    expect(ran).toContain('"proposals":[]');
    expect(ran).toContain("What the engine didn't take: 1 not read (mood: not a change type the read takes now); 1 not read (narrated time the turn had already passed).");
    const empty = agentModels(rig);
    await played(rig, chatId, "I sit.", "You sit.");
    expect(ranOf(empty, "read")[0]).toContain("What the engine didn't take: its answer proposed no change.");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a read's change to a thing the world doesn't have says so, naming it and how a thing is made", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await rolesChat(rig);
    const asked = agentModels(rig, { read: () => JSON.stringify({ proposals: [{ type: "take", entity: "pov", item: "brass key" }], where: null }) });
    await played(rig, chatId, "I pick up the brass key from the counter.", "You pocket the brass key.");
    const [ran = ""] = ranOf(asked, "read");
    expect(ran).toContain("What the engine didn't take: 1 name a thing the world doesn't have (brass key): each changes nothing but a Not tracked note; only a give by someone other than the player character, the thing in the reply's words, or a purchase makes one.");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a director's line that contradicts the state it was given is flagged and told with its run, quoted, and stays in its answer", async () => {
    const here = "Marcus Delgado leans on the counter beside Jordan.";
    const PROSE: JsonObject = { modelUse: { steps: { brief: { enabled: true, signals: ["always"] }, outline: { enabled: true, signals: ["always"] }, "npc.choose": { enabled: false } }, budgets: { pre: { calls: 8 } } } };
    const director = (): QuietScript => JSON.stringify({ brief: "BRIEF-OK The harbor is grey this morning.", beats: ["OUTLINE-OK Jordan looks out at the harbor.", here] });
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await rolesChat(rig, PROSE);
    const asked = agentModels(rig, { director });
    await played(rig, chatId, "I look out at the harbor.", "The harbor is calm.");
    const [ran = ""] = ranOf(asked, "director");
    expect(ran).toContain(`"outline":["OUTLINE-OK Jordan looks out at the harbor.","${here}"]`);
    expect(ran).toContain(`What the engine didn't take: 1 flagged, still in the reply's prompt (it has someone here whom the engine has elsewhere: "${here}").`);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a GM note written in GM → Workspace on the shown head swipe follows a Regenerate whose main agent revises its roles' runs before and after the plan", async () => {
    const PROSE: JsonObject = { modelUse: { steps: { brief: { enabled: true, signals: ["always"] }, outline: { enabled: true, signals: ["always"] } }, budgets: { pre: { calls: 8 } } } };
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await rolesChat(rig, PROSE);
    agentModels(rig);
    await played(rig, chatId, "I look out at the harbor.", "The harbor is calm.");
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    const path = "notes/gm.md";
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path, text: "GM-NOTE: Danny owes Priya." }));
    const notes = async (): Promise<string[]> => (await listWorkspace(rig.rt, { userId: rig.host.userId, chatId })).filter((f) => f.transcript !== true).map((f) => f.path);
    expect(await notes()).toEqual([path]);
    // Each stage's first answers in, the main agent revises one of its runs once, then commits.
    const revised = new Set<number>();
    const asked = agentModels(rig, { director: () => JSON.stringify({ brief: "The harbor is grey.", beats: ["Jordan looks out at the harbor."] }) }, (req, n) => {
      const agent = /^(\S+): the \w+ role answered/m.exec(resultsOf(req).join("\n"))?.[1];
      if (!agent || revised.has(stageNumber(req))) return undefined;
      revised.add(stageNumber(req));
      return { content: "", toolCalls: [call("revise", { agentId: agent, message: "Once more, shorter." }, `v${n}`)] };
    });
    const g = await rig.host.start(chatId, { type: "regenerate" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "The harbor is calm and grey.");
    expect(rig.host.message(chatId, head.id).swipes.length).toBe(2);
    expect(asked.flatMap(resultsOf).filter((r) => /: the (scene|director) role answered/.test(r)).length).toBeGreaterThan(0);
    expect(revised.size).toBeGreaterThan(1);
    expect(await notes()).toEqual([path]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

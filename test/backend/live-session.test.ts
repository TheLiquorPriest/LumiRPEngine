// GM → Live, GM → Workspace's whole session, and the turns' transcripts (DESIGN §4.6). The session
// view shows the main session whole, and the main agent is sent all of its own messages. A page
// watching GM → Live hears each agent's work in
// order (the main agent's stages, each role run with its agent's messages, reasoning, tool calls and
// results, its writes and what came of them, and how the turn ended), and a page opened mid-turn
// catches up first. Each turn's transcript is listed under transcripts/, read-only, following the
// chat's path, and every agent reads it, whatever knowledge it reads the world with. Models are scripted;
// every role runs prompt-only but the scene's, whose agent writes a note before it answers.

import { describe, expect, test } from "bun:test";
import { outsideReader } from "../../src/backend/agents/tools/read-view";
import { listWorkspace, readWorkspaceFile, WORKSPACE_TOOLS } from "../../src/backend/agents/tools/workspace";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import type { JsonObject } from "../../src/shared/json";
import { followLive, type LiveChange, type LiveEntry, type LiveView } from "../../src/shared/live";
import type { SessionView, WorkspaceFileView } from "../../src/shared/protocol";
import type { QuietScript } from "../support/fake-host";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const PROMPT_ONLY = Object.fromEntries(ROLE_IDS.map((id) => [id, { promptOnly: true }]));
const NOTE = "notes/harbor.md";
const call = (name: string, args: JsonObject, callId: string): QuietToolCall => ({ name, args, callId });
const isMain = (req: QuietRequest): boolean => (req.tools ?? []).some((t) => t.name === "run_role");
const isScene = (req: QuietRequest): boolean => (req.messages[0]?.content ?? "").includes("You are the scene agent of LumiRPEngine");
const resultsOf = (req: QuietRequest): string[] => (req.messages.at(-1)?.parts ?? []).flatMap((p) => (p.type === "tool_result" ? [p.content] : []));
const stageOf = (req: QuietRequest): string => req.messages.findLast((m) => m.role === "user" && m.content.includes("Stage "))?.content ?? "";
const sentOf = (req: QuietRequest): string => req.messages.map((m) => m.content).join("\n\n");

/**
 * The scripted models: the main agent runs every role its stage asks for and commits in the same
 * answer, saying `says` with its reasoning; the scene's agent writes the note, then answers (`scene`
 * may answer its first call instead); the prompt-only roles' classic calls read nothing. The main
 * agent's calls, in order.
 */
function models(rig: Rig, opts: { says?: () => string; scene?: (req: QuietRequest) => Promise<QuietScript> | undefined } = {}): QuietRequest[] {
  const asked: QuietRequest[] = [];
  rig.host.quietReply = (req) => {
    if (isMain(req)) {
      asked.push(req);
      const n = asked.length - 1;
      const roles = [...new Set([...stageOf(req).matchAll(/^- (\w+):/gm)].map((m) => m[1] ?? ""))];
      return { content: opts.says?.() ?? "", reasoning: `REASONING for stage call ${n}`, toolCalls: [...roles.map((role) => call("run_role", { role, task: `Work the ${role}.` }, `c${n}_${role}`)), call("commit", {}, `c${n}_commit`)] };
    }
    if (isScene(req)) {
      if (resultsOf(req).length > 0) return JSON.stringify({ lore: [], notes: [] });
      return opts.scene?.(req) ?? { content: "", toolCalls: [call("workspace_write", { path: NOTE, text: "The ferry is late." }, "w1")] };
    }
    return (req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ action: null, params: {}, confidence: 0.9 }) : "{}";
  };
  return asked;
}

/**
 * A Port Alder chat on agents, its turns run by a main agent; every role prompt-only but the scene's,
 * whose run stages the note through the turn's writer before its agent works (its agent's own
 * workspace_write, the same operation, answers what the run staged).
 */
async function liveChat(rig: Rig): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { pipeline: { mode: "main" }, roles: { ...PROMPT_ONLY, scene: { promptOnly: false } } } } }));
  rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
  const roles = rig.rt.orchestrator.roles;
  rig.rt.orchestrator.roles = {
    ...roles,
    scene: async (task, ctx) => {
      await ctx.writer.apply([{ kind: "ws_write", path: NOTE, text: "The ferry is late." }], "The scene's note");
      return roles.scene(task, ctx);
    },
  };
  return chatId;
}

async function played(rig: Rig, chatId: string, text: string, reply: string): Promise<void> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  expect(g.halted).toBeUndefined();
  await rig.host.finish(g, reply);
}

async function sessionOf(rig: Rig, chatId: string): Promise<SessionView> {
  return rig.body(await rig.send({ type: "lre.workspace", chatId, op: "session" })).session as SessionView;
}

/** Every live update sent for the chat, from message `from` on, with the session it went to. */
function updates(rig: Rig, chatId: string, from = 0): { change: LiveChange; session: string | undefined }[] {
  return rig.host.sent.flatMap((m, i) => (i >= from && m.type === "lre.live.update" && m.chatId === chatId ? [{ change: m as unknown as LiveChange, session: rig.host.sentTo[i]?.session }] : []));
}

/** The live view a page holding `held` has after hearing every update sent to it. */
function heard(rig: Rig, chatId: string, session: string, held: LiveView | null = null, from = 0): LiveView {
  let view: LiveView | null = held;
  for (const u of updates(rig, chatId, from)) {
    if (u.session !== session) continue;
    const next = followLive(view, u.change);
    if (next === "resync") throw new Error("the page couldn't follow the run");
    view = next;
  }
  if (!view) throw new Error("the page heard no run");
  return view;
}

const kinds = (entries: readonly LiveEntry[], agent: string): string[] => entries.filter((e) => "agent" in e && e.agent === agent && e.kind !== "agent").map((e) => e.kind);

describe("GM → Workspace's main session", () => {
  test("shows the session whole, and the main agent is sent every message of it", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await liveChat(rig);
    let says = "NOTE-GM: the stranger in the alley runs the smuggling.";
    const asked = models(rig, { says: () => says });
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    says = "";
    const session = await sessionOf(rig, chatId);
    const messages = session.segments.flatMap((s) => s.messages);
    expect(messages.find((m) => m.text.includes("NOTE-GM"))).toMatchObject({ role: "assistant", main: true });
    expect(messages.some((m) => m.text.includes("I look out over the harbor."))).toBe(true);
    expect(session.turns).toBe(1);
    expect(session.segments[0]?.turn).toBe(2);
    expect(session.reads.turns).toBe(1);
    expect(session.tokens).toBeGreaterThan(0);
    // The main agent's next turn is sent it.
    const next = asked.length;
    await played(rig, chatId, "I walk to the pier.", "The boards creak.");
    expect(sentOf(asked[next] as QuietRequest)).toContain("NOTE-GM");
    const after = await sessionOf(rig, chatId);
    expect(after.turns).toBe(2);
    expect(after.reads.turns).toBe(2);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("shows a summary, which the main agent reads", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await liveChat(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { compaction: { atTokens: 1, keepTurns: 1 } } } }));
    models(rig);
    rig.host.quietReply = ((inner) => (req: QuietRequest) => (sentOf(req).includes("You keep a main agent's session short") ? "SUMMARY-GM of the harbor." : (inner?.(req) ?? "{}")))(rig.host.quietReply);
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    await played(rig, chatId, "I walk to the pier.", "The boards creak.");
    await played(rig, chatId, "I sit on a bench.", "The bench is warm.");
    const session = await sessionOf(rig, chatId);
    expect(session.summary).toBe("SUMMARY-GM of the harbor.");
    expect(session.rollback).toBe("available");
  });
});

describe("GM → Live", () => {
  test("a watching page hears each agent's work in order: the main agent's stages, each role run with its agent's messages, tool calls and results, its writes and what came of them, and how the turn ended", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await liveChat(rig);
    models(rig, { says: () => "Running the stage's roles." });
    // Before any turn, nothing to show.
    expect(rig.body(await rig.send({ type: "lre.live", op: "get", chatId }, "page-1")).live).toBeNull();
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    // Only the watching page heard it.
    expect(updates(rig, chatId).every((u) => u.session === "page-1")).toBe(true);
    const view = heard(rig, chatId, "page-1");
    expect(view).toMatchObject({ kind: "turn", pipeline: "main", text: "I look out over the harbor." });
    expect(view.ended?.state).toBe("done");
    expect(view.entries.map((e) => e.seq)).toEqual(view.entries.map((_, i) => i + 1));
    const at = (e: LiveEntry | undefined): number => {
      if (!e) throw new Error("no such entry");
      return e.seq;
    };
    // The main agent's first stage: its start, the turn task it was sent, its answer with its reasoning and calls, their results.
    const main = view.entries.find((e) => e.kind === "agent" && e.role === "main");
    if (main?.kind !== "agent") throw new Error("no main agent");
    expect(main.stage).toContain("1");
    expect(kinds(view.entries, main.agent).slice(0, 2)).toEqual(["message", "answer"]);
    const mainAnswer = view.entries.find((e) => e.kind === "answer" && e.agent === main.agent);
    expect(mainAnswer?.kind === "answer" && mainAnswer.reasoning).toBe("REASONING for stage call 0");
    expect(mainAnswer?.kind === "answer" && mainAnswer.text).toBe("Running the stage's roles.");
    expect(mainAnswer?.kind === "answer" && mainAnswer.calls.map((c) => c.name)).toContain("commit");
    // The scene's run: its agent sent its task, called workspace_write with its arguments, had its result, then answered.
    const run = view.entries.find((e) => e.kind === "run" && e.role === "scene");
    if (run?.kind !== "run") throw new Error("no scene run");
    expect(run.via).toBe("agent");
    const scene = view.entries.find((e) => e.kind === "agent" && e.run === run.run);
    if (scene?.kind !== "agent") throw new Error("no scene agent");
    expect(scene.role).toBe("scene");
    expect(scene.system).toContain("You are the scene agent of LumiRPEngine");
    expect(kinds(view.entries, scene.agent)).toEqual(["message", "answer", "result", "answer", "idle"]);
    const write = view.entries.find((e) => e.kind === "answer" && e.agent === scene.agent && e.calls.length > 0);
    expect(write?.kind === "answer" && write.calls).toEqual([{ id: "w1", name: "workspace_write", args: { path: NOTE, text: "The ferry is late." } }]);
    // Its tool's answer, as its model was sent it: the same note its run staged already answers what was staged, landing when the turn commits.
    const result = view.entries.find((e) => e.kind === "result" && e.agent === scene.agent);
    expect(result).toMatchObject({ name: "workspace_write", call: "w1" });
    expect(result?.kind === "result" && JSON.parse(result.text)).toMatchObject({ staged: { changeType: "workspace", mode: "auto", lands: expect.stringContaining("lands when the turn commits") } });
    const ran = view.entries.find((e) => e.kind === "ran" && e.run === run.run);
    expect(ran).toMatchObject({ ok: true, via: "agent" });
    expect(at(run)).toBeLessThan(at(scene));
    expect(at(result)).toBeLessThan(at(ran));
    // The main agent's run_role for the scene came back after the run ended.
    const sceneCall = view.entries.find((e) => e.kind === "answer" && e.calls.some((c) => c.name === "run_role" && c.args.role === "scene"));
    if (sceneCall?.kind !== "answer") throw new Error("no run_role for the scene");
    const callId = sceneCall.calls.find((c) => c.args.role === "scene")?.id;
    const back = view.entries.find((e) => e.kind === "result" && e.call === callId);
    expect(at(back)).toBeGreaterThan(at(ran));
    // The note was staged by the scene's run, then came to its outcome at the commit.
    const writes = view.entries.filter((e) => e.kind === "write" && e.run === run.run);
    expect(writes[0]).toMatchObject({ outcome: "staged", role: "scene", phase: "pre" });
    expect(writes[0]).toMatchObject({ changeType: expect.any(String), lines: ["A note the story's agents keep changes."] });
    expect(["landed", "held"]).toContain(writes.at(-1)?.kind === "write" ? (writes.at(-1) as Extract<LiveEntry, { kind: "write" }>).outcome : "");
    // The turn's phases between.
    expect(view.entries.filter((e) => e.kind === "phase").map((e) => (e.kind === "phase" ? e.phase : ""))).toEqual(["plan", "post"]);
    // The player's activity line said none of it.
    const lines = JSON.stringify(rig.host.sent.filter((m) => m.type === "lre.activity"));
    expect(lines).not.toContain("workspace_write");
    expect(lines).not.toContain(NOTE);
    expect(lines).not.toContain("REASONING");
    // After the turn, a page opening Live sees that turn's record.
    expect(rig.body(await rig.send({ type: "lre.live", op: "get", chatId }, "page-9")).live).toEqual(view);
    // A page that left hears no more.
    rig.body(await rig.send({ type: "lre.live", op: "leave", chatId }, "page-1"));
    const from = rig.host.sent.length;
    await played(rig, chatId, "I walk to the pier.", "The boards creak.");
    expect(updates(rig, chatId, from).filter((u) => u.session === "page-1")).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a page opened mid-turn catches up on what has happened so far, then hears the rest where its view left off", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await liveChat(rig);
    const { promise: hold, resolve: release } = Promise.withResolvers<void>();
    const { promise: reached, resolve: reach } = Promise.withResolvers<void>();
    models(rig, {
      scene: async () => {
        reach();
        await hold;
        return { content: "", toolCalls: [call("workspace_write", { path: NOTE, text: "The ferry is late." }, "w1")] };
      },
    });
    rig.host.sendUser(chatId, "I look out over the harbor.");
    await rig.host.settle();
    const going = rig.host.start(chatId, { type: "normal" });
    await reached;
    const from = rig.host.sent.length;
    // Asked straight through the dispatcher: the rig's own send waits for the host to settle, which the turn under way holds.
    await rig.dispatch.handle({ lre: 1, reqId: "live-mid", type: "lre.live", op: "get", chatId } as never, rig.host.userId, "page-2");
    const answer = rig.host.sent.find((m) => m.type === "lre.result" && m.reqId === "live-mid");
    if (!answer) throw new Error("no reply to lre.live mid-turn");
    const mid = rig.body(answer).live as LiveView;
    expect(mid.ended).toBeNull();
    const scene = mid.entries.find((e) => e.kind === "agent" && e.role === "scene");
    if (scene?.kind !== "agent") throw new Error("the scene agent hasn't started");
    // What happened so far: the main agent's first stages, and the scene agent sent its task, not yet answered.
    expect(mid.entries.some((e) => e.kind === "answer" && e.calls.some((c) => c.name === "commit"))).toBe(true);
    expect(kinds(mid.entries, scene.agent)).toEqual(["message"]);
    release();
    const g = await going;
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "Gulls wheel over the water.");
    const view = heard(rig, chatId, "page-2", mid, from);
    expect(view.ended?.state).toBe("done");
    expect(view.entries.map((e) => e.seq)).toEqual(view.entries.map((_, i) => i + 1));
    expect(kinds(view.entries, scene.agent)).toEqual(["message", "answer", "result", "answer", "idle"]);
  });

  test("a cancelled turn ends cancelled, its staged note dropped", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await liveChat(rig);
    const { promise: reached, resolve: reach } = Promise.withResolvers<void>();
    models(rig);
    // The scene writes its note, then waits on its next call: Cancel stops the turn there.
    const inner = rig.host.quietReply;
    rig.host.quietReply = (req) => {
      if (!isScene(req) || resultsOf(req).length === 0) return inner?.(req) ?? "{}";
      reach();
      return new Promise<QuietScript>(() => undefined);
    };
    rig.body(await rig.send({ type: "lre.live", op: "get", chatId }, "page-3"));
    rig.host.sendUser(chatId, "I look out over the harbor.");
    await rig.host.settle();
    const going = rig.host.start(chatId, { type: "normal" });
    await reached;
    expect(rig.body(await rig.send({ type: "lre.cancel", chatId })).cancelled).toBe(true);
    await going;
    const view = heard(rig, chatId, "page-3");
    expect(view.ended?.state).toBe("cancelled");
    const writes = view.entries.filter((e) => e.kind === "write");
    expect(writes.map((e) => (e.kind === "write" ? e.outcome : ""))).toEqual(["staged", "dropped"]);
  });
});

describe("the turns' transcripts", () => {
  test("each turn's is listed under transcripts/, read-only; every agent lists and reads it, whatever knowledge it reads with; it follows the chat's path", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await liveChat(rig);
    models(rig);
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    const files = rig.body(await rig.send({ type: "lre.workspace", chatId, op: "list" })).files as WorkspaceFileView[];
    const listed = files.filter((f) => f.path.startsWith("transcripts/"));
    expect(listed.map((f) => f.path)).toEqual(["transcripts/reply-0002.md"]);
    const file = listed[0] as WorkspaceFileView;
    expect(file).toMatchObject({ pinned: false, learned: false, transcript: true, provenance: { turn: 2 } });
    const text = rig.body(await rig.send({ type: "lre.workspace", chatId, op: "read", path: file.path })).text as string;
    expect(file.size).toBe(text.length);
    for (const part of ["I look out over the harbor.", "Main agent", "Scene and lore", "workspace_write", NOTE, "REASONING for stage call 0", "Ended: done"]) expect(text).toContain(part);
    // Read-only: no write, pin, move or delete.
    for (const op of [{ op: "write", path: file.path, text: "Mine now." }, { op: "pin", path: file.path, pinned: true }, { op: "delete", path: file.path }, { op: "move", from: file.path, to: "notes/kept.md" }, { op: "write", path: "transcripts/mine.md", text: "Mine." }]) {
      expect((await rig.send({ type: "lre.workspace", chatId, ...op })).type).toBe("lre.error");
    }
    // Every agent reads it: the workspace lists it and reads it whole, and so do an agent's tools, whatever view they read with.
    expect((await listWorkspace(rig.rt, { userId: rig.host.userId, chatId })).some((f) => f.path === file.path)).toBe(true);
    expect(await readWorkspaceFile(rig.rt, { userId: rig.host.userId, chatId }, file.path)).toBe(text);
    const tool = (name: string) => {
      const def = WORKSPACE_TOOLS.find((t) => t.name === name);
      if (!def) throw new Error(`no ${name}`);
      return def;
    };
    for (const knowledge of ["everyone", "gm"] as const) {
      const base = { userId: rig.host.userId, chatId, knowledge };
      const env = { ...base, reader: outsideReader(rig.rt, base), writer: null, agent: { role: "scene", id: "agent_scene" }, signal: new AbortController().signal };
      const listedBy = JSON.parse((await tool("workspace_list").run({ under: "transcripts/" }, env)).text) as { files: { path: string }[] };
      expect(listedBy.files.map((f) => f.path)).toEqual([file.path]);
      expect(JSON.parse((await tool("workspace_read").run({ path: file.path }, env)).text)).toEqual({ path: file.path, text });
    }
    // A swipe of that reply has a transcript of its own, in the same place on the chain.
    const g = await rig.host.start(chatId, { type: "swipe" });
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "The gulls are loud.");
    const swiped = (rig.body(await rig.send({ type: "lre.workspace", chatId, op: "list" })).files as WorkspaceFileView[]).filter((f) => f.path.startsWith("transcripts/"));
    expect(swiped.map((f) => f.path)).toEqual(["transcripts/reply-0002.md"]);
    expect(swiped[0]?.hash).not.toBe(file.hash);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a transcript is never a pin, even listed in .pins.json for the main agent", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await liveChat(rig);
    const asked = models(rig);
    await played(rig, chatId, "I look out over the harbor.", "Gulls wheel over the water.");
    rig.body(await rig.send({ type: "lre.workspace", chatId, op: "write", path: ".pins.json", text: JSON.stringify({ main: { files: ["transcripts/reply-0002.md"] } }) }));
    const next = asked.length;
    await played(rig, chatId, "I walk to the pier.", "The boards creak.");
    expect(sentOf(asked[next] as QuietRequest)).not.toContain("# Agent turn");
  });
});

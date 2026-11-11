// GM → Assistant on a chat the harness plays (HARNESS-SLICE3; DESIGN §4.5): the same page and the
// same protocol, with LumiAH answering. A scripted `HarnessCore` stands where LumiAH's is mounted
// (a chat's side sessions listed, started, sent to and removed, and a turn stopped), and a side
// turn is played by the test as LumiAH plays one: it begins, its agent calls the engine's tools
// through the tools port, and it ends. The engine's own helper model throws if reached, and
// `noModelCalls` checks it never was: on a harness chat every model call is an agent's.
//
// The last test mounts LumiAH's real backend instead (`support/lumiah-bed.ts`), its agent's model
// scripted: what that agent is offered and what LumiAH itself says of a side turn is only seen there.

import { afterEach, describe, expect, test } from "bun:test";
import type { HarnessCore } from "../../src/backend/harness/extension";
import type { AgentRef, AgentUsage, RemoteToolCall, TurnStatus } from "../../src/backend/harness/shapes";
import { renderPrompt } from "../../src/backend/prompts";
import { placeOfEntity } from "../../src/engine/scope";
import { STOP_TEXT } from "../../src/shared/agent-failures";
import { STEP_LABEL } from "../../src/shared/diagnostics";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { AssistantView, BackendToFrontend } from "../../src/shared/protocol";
import { type Bed, cast, heard, lumiahBed, offers, results, toolCall } from "../support/lumiah-bed";
import { Rig } from "../support/rig";
import { HOME } from "../support/tools";
import { harnessChat, mount, noModelCalls, OKORO, PEOPLE, playOn, stateOf } from "./harness-driver";

/** The GM → Assistant page's session: the thread's pushes go to the pages that asked about it. */
const PAGE = "gm-assistant-page";

/** What a side turn spent, as LumiAH says it when the turn ends. */
const USAGE: AgentUsage = { calls: 2, toolTurns: 1, in: 1200, cachedIn: 200, out: 80, reasoningOut: 0, estimated: false, ms: 5 };

/** The words a Cancel stops a turn with: the same a cancelled answer of the engine's own agent gives. */
const CANCELLED = renderPrompt(STOP_TEXT.cancelled, {}, {});

/** A refusal as LumiAH's core gives one: its own words, and its code. */
const refusal = (code: string, message: string): Error => Object.assign(new Error(message), { code });

const BUSY = "The agent is still working on what you said before. Wait for it to answer, or stop it.";

interface Row {
  id: string;
  chatId: string;
  agent: string;
  title: string;
  createdAt: number;
  lastAt: number;
  turns: number;
}

/** LumiAH's side sessions as the engine reaches them (`HarnessCore`), scripted: what was asked of it, the sessions it has, and the turns under way. */
class Sides implements HarnessCore {
  readonly asked: { op: string; args: JsonObject; where: unknown }[] = [];
  readonly rows: Row[] = [];
  /** The turns under way, each with its session. */
  readonly live = new Map<string, string>();
  /** Every turn `side.send` began, oldest first. */
  readonly begun: string[] = [];
  readonly stopped: { run: string; why: string }[] = [];
  /** The op refused next, once. */
  refuse: { op: string; error: Error } | null = null;
  /** While set: `side.send` begins its turn at once, as LumiAH does, and answers only when this does. */
  hold: { until: Promise<void>; began(): void } | null = null;
  private n = 0;

  async ask(_userId: string, op: string, args: JsonObject, where?: unknown): Promise<JsonValue> {
    this.asked.push({ op, args, where });
    if (this.refuse?.op === op) {
      const { error } = this.refuse;
      this.refuse = null;
      throw error;
    }
    switch (op) {
      case "sides.list":
        return { sides: this.rows.filter((row) => row.chatId === args.chatId).map((row) => ({ ...row })) };
      case "sides.start": {
        const row: Row = { id: `side_${++this.n}`, chatId: String(args.chatId), agent: String(args.agent), title: "", createdAt: this.n, lastAt: this.n, turns: 0 };
        this.rows.push(row);
        return { side: { ...row } };
      }
      case "side.send": {
        const session = String(args.session);
        if ([...this.live.values()].includes(session)) throw refusal("unavailable", BUSY);
        const turn = `side-turn-${++this.n}`;
        this.live.set(turn, session);
        this.begun.push(turn);
        if (this.hold) {
          const { until, began } = this.hold;
          this.hold = null;
          began();
          await until;
        }
        return { turn };
      }
      case "sides.remove": {
        const at = this.rows.findIndex((row) => row.id === args.id);
        if (at < 0) throw refusal("not_found", "That side session is gone.");
        if ([...this.live.values()].includes(String(args.id))) throw refusal("conflict", "That side session is answering: stop it first, then remove it.");
        this.rows.splice(at, 1);
        return { removed: true };
      }
      default:
        throw refusal("bad_request", `the test's LumiAH has no ${op}`);
    }
  }

  stop(_userId: string, run: string, why: string): boolean {
    if (!this.live.has(run)) return false;
    this.stopped.push({ run, why });
    return true;
  }

  running(): string[] {
    return [...this.live.keys()];
  }

  /** What was asked of one op, in order. */
  of(op: string): JsonObject[] {
    return this.asked.filter((ask) => ask.op === op).map((ask) => ask.args);
  }

  /** The turn the latest message began. */
  get turn(): string {
    const turn = this.begun.at(-1);
    if (turn === undefined) throw new Error("no message began a turn");
    return turn;
  }
}

/** An agent of a side turn, as LumiAH names it in a call: its handle, its definition, and where it stands in the run. */
interface Caller {
  agentId: string;
  role: string;
  main: boolean;
  above: AgentRef[];
}

/** The session's own agent: the assistant's definition, the run's main agent. */
const OWN: Caller = { agentId: "side-main", role: HARNESS_AGENT.assistant, main: true, above: [] };

/** A harness chat with LumiAH's side sessions scripted, and `patch` made to the settings first. */
async function assistantChat(patch: JsonObject = {}): Promise<{ rig: Rig; chatId: string; core: Sides }> {
  const { rig, chatId } = await harnessChat();
  if (Object.keys(patch).length > 0) rig.body(await rig.send({ type: "lre.settings.set", patch }));
  const core = new Sides();
  rig.rt.harness.core = core;
  return { rig, chatId, core };
}

const say = (rig: Rig, chatId: string, text: string): Promise<BackendToFrontend> => rig.send({ type: "lre.assistant", op: "send", chatId, text }, PAGE);

const viewOf = (rig: Rig, reply: BackendToFrontend): AssistantView => rig.body(reply) as unknown as AssistantView;

async function thread(rig: Rig, chatId: string): Promise<AssistantView> {
  return viewOf(rig, await rig.send({ type: "lre.assistant", op: "get", chatId }, PAGE));
}

/** A side turn begins, as LumiAH tells the engine before anything of it is sent to a model. */
async function begins(rig: Rig, chatId: string, turn: string): Promise<void> {
  await rig.rt.harness.extension.runBegan?.({ userId: rig.host.userId, chatId, turn, kind: "side", story: { hidden: "leave_out", from: "everyone", newest: "directive" } });
}

let calls = 0;

/** One tool call of a side turn's agent, as LumiAH's backend sends it: the session's own unless another is named. */
function call(rig: Rig, chatId: string, turn: string, name: string, args: JsonObject, who: Caller = OWN): Promise<{ text: string; error?: boolean }> {
  const sent: RemoteToolCall = { name, args, turn, chatId, callId: `side-call-${++calls}`, kind: "side", ...who };
  return rig.rt.harness.tools.call(sent, new AbortController().signal, rig.host.userId);
}

/** A side turn ends, as LumiAH says it, and the thread takes what follows. */
async function ends(rig: Rig, core: Sides, chatId: string, turn: string, status: TurnStatus, over: { reply?: string; reason?: string } = {}): Promise<void> {
  core.live.delete(turn);
  await rig.rt.harness.extension.runEnded?.({ userId: rig.host.userId, chatId, turn, kind: "side", status, ...(over.reason !== undefined ? { reason: over.reason } : {}), reply: over.reply ?? "", record: null, usage: USAGE });
  await rig.dispatch.assistant.settle();
  await rig.host.settle();
}

const whereIsOkoro = async (rig: Rig, chatId: string): Promise<string | null> => placeOfEntity(await stateOf(rig, chatId), OKORO);

const MOVE = { entity: "Okoro", to: HOME };

describe("GM → Assistant on a chat the harness plays", () => {
  test("a message starts one side session with the assistant's agent and a turn in it; LumiAH's answer is the thread's, and the engine calls no model", async () => {
    const { rig, chatId, core } = await assistantChat();
    const sent = viewOf(rig, await say(rig, chatId, "Is Okoro coming by today?"));
    // One session, about this chat, with the assistant's definition; then the message, said in it. Each is asked where the chat runs.
    expect(core.of("sides.start")).toEqual([{ chatId, agent: HARNESS_AGENT.assistant }]);
    const session = core.rows[0]?.id ?? "";
    expect(core.of("side.send")).toEqual([{ session, text: "Is Okoro coming by today?" }]);
    expect(core.asked.map((ask) => ask.where)).toEqual(core.asked.map(() => ({ chat: chatId })));
    // The thread has the message, and the answer under way as the page shows one.
    expect(sent.thread.map((m) => [m.role, m.text])).toEqual([["user", "Is Okoro coming by today?"]]);
    expect(sent.running).toMatchObject({ agentId: core.turn, label: STEP_LABEL.assistant, tokens: { in: 0, out: 0 } });
    expect(rig.rt.diag.activityOf(chatId)).toEqual({ chatId, turn: null, state: "running", label: STEP_LABEL.assistant ?? "", since: expect.any(Number) });
    // The session's id is kept where the thread lives.
    expect((await rig.rt.chatAgents.get(chatId, rig.host.userId)).assistant.side).toBe(session);
    // One answer at a time.
    expect(await say(rig, chatId, "And Brann?")).toMatchObject({ type: "lre.error", code: "conflict" });
    expect(core.of("side.send")).toHaveLength(1);

    await begins(rig, chatId, core.turn);
    await ends(rig, core, chatId, core.turn, "done", { reply: "Okoro said he would come by at noon." });
    const view = await thread(rig, chatId);
    expect(view.running).toBeNull();
    expect(view.thread.at(-1)).toMatchObject({ role: "assistant", text: "Okoro said he would come by at noon.", status: "answered", usage: { in: 1200, out: 80, cached: 200 } });
    expect(view.thread.at(-1)?.reason).toBeUndefined();
    expect(view.proposals).toEqual([]);
    expect(rig.rt.diag.activityOf(chatId)).toBeNull();
    // The page that asked was pushed the answer.
    expect(rig.host.sent.some((m) => m.type === "lre.assistant.update" && m.chatId === chatId && m.view.running === null && m.view.thread.at(-1)?.text === "Okoro said he would come by at noon.")).toBe(true);
    noModelCalls(rig);
  });

  test("a GM change its agent calls lands nothing and is the answer's proposal, with each call in the answer's trace; Apply lands it with its Undo", async () => {
    const { rig, chatId, core } = await assistantChat();
    rig.body(await say(rig, chatId, "Bring Okoro to the house."));
    const turn = core.turn;
    await begins(rig, chatId, turn);
    // It reads with the game master's view; a change the world can't take is refused to it, and one it can is only checked.
    expect((await call(rig, chatId, turn, "people_where", { person: "Okoro" })).error).toBeUndefined();
    const nowhere = await call(rig, chatId, turn, "gm_move", { entity: "Okoro", to: "a place the world has none of" });
    expect(nowhere.error).toBe(true);
    const checked = await call(rig, chatId, turn, "gm_move", MOVE);
    expect(checked.error).toBeUndefined();
    expect(JSON.parse(checked.text)).toMatchObject({ proposed: { changeType: "gm_edit", mode: "auto" } });
    expect(await whereIsOkoro(rig, chatId)).toBeNull();

    await ends(rig, core, chatId, turn, "done", { reply: "I propose bringing Okoro to the house." });
    const view = await thread(rig, chatId);
    const answer = view.thread.at(-1);
    const [proposal] = view.proposals;
    if (!proposal || !answer) throw new Error("nothing proposed");
    expect(proposal).toMatchObject({ status: "open", messageId: answer.id, ops: [{ changeType: "gm_edit", mode: "auto" }] });
    expect(proposal.ops[0]?.lines.join("\n")).toContain("Okoro");
    expect(JSON.stringify(proposal)).not.toContain('"op"');
    expect(await whereIsOkoro(rig, chatId)).toBeNull();
    // What it looked up, as the page folds it under the answer: each call of the engine's tools in the order it was answered, a refused one with what it was told.
    expect(answer.trace).toEqual([
      { tool: "people_where", summary: 'person: "Okoro"', ms: expect.any(Number) },
      { tool: "gm_move", summary: 'entity: "Okoro", to: "a place the world has none of"', error: nowhere.text, ms: expect.any(Number) },
      { tool: "gm_move", summary: `entity: "Okoro", to: "${HOME}"`, ms: expect.any(Number) },
    ]);

    const applied = viewOf(rig, await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: proposal.id }, PAGE)).proposals[0];
    expect(applied).toMatchObject({ status: "applied", ops: [{ key: proposal.ops[0]?.key, applied: true }] });
    expect(await whereIsOkoro(rig, chatId)).toBe(HOME);
    // Its chip is the chat's GM edit chip, whose Undo takes the change back.
    const chip = applied?.chipId ?? "";
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.id === chip)).toBe(true);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip, choice: "undo" }));
    expect(await whereIsOkoro(rig, chatId)).toBeNull();
    expect((await thread(rig, chatId)).proposals[0]).toMatchObject({ status: "applied", undone: true });

    // No turns one down, as on any chat.
    rig.body(await say(rig, chatId, "Bring him over after all."));
    await begins(rig, chatId, core.turn);
    await call(rig, chatId, core.turn, "gm_move", MOVE);
    await ends(rig, core, chatId, core.turn, "done", { reply: "Ready when you are." });
    const again = (await thread(rig, chatId)).proposals[1];
    expect(viewOf(rig, await rig.send({ type: "lre.assistant", op: "reject", chatId, proposalId: again?.id }, PAGE)).proposals[1]?.status).toBe("rejected");
    expect(await whereIsOkoro(rig, chatId)).toBeNull();
    noModelCalls(rig);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("with Apply at once the proposal applies when LumiAH's answer is in; a turn that failed leaves its changes for you to look at", async () => {
    const { rig, chatId, core } = await assistantChat({ agents: { assistant: { apply: "at_once" } } });
    rig.body(await say(rig, chatId, "Bring Okoro to the house."));
    await begins(rig, chatId, core.turn);
    await call(rig, chatId, core.turn, "gm_move", MOVE);
    // LumiAH's own reason is the answer's.
    await ends(rig, core, chatId, core.turn, "failed", { reason: "The connection refused the call." });
    const failed = await thread(rig, chatId);
    expect(failed.thread.at(-1)).toMatchObject({ role: "assistant", text: "", status: "failed", reason: "The connection refused the call." });
    expect(failed.proposals[0]?.status).toBe("open");
    expect(await whereIsOkoro(rig, chatId)).toBeNull();

    rig.body(await say(rig, chatId, "Try again."));
    await begins(rig, chatId, core.turn);
    await call(rig, chatId, core.turn, "gm_move", MOVE);
    await ends(rig, core, chatId, core.turn, "done", { reply: "Okoro is at the house." });
    const [, atOnce] = (await thread(rig, chatId)).proposals;
    expect(atOnce).toMatchObject({ status: "applied", ops: [{ applied: true }] });
    expect(atOnce?.chipId).toStartWith("fix:");
    expect(await whereIsOkoro(rig, chatId)).toBe(HOME);
    noModelCalls(rig);
  });

  test("Cancel stops the turn, and a cancelled answer proposes nothing", async () => {
    const { rig, chatId, core } = await assistantChat();
    rig.body(await say(rig, chatId, "Bring Okoro to the house."));
    const turn = core.turn;
    await begins(rig, chatId, turn);
    await call(rig, chatId, turn, "gm_move", MOVE);
    // LumiAH is told to stop it, in the words a cancelled answer gives; the thread waits for LumiAH to say it ended.
    expect(viewOf(rig, await rig.send({ type: "lre.assistant", op: "cancel", chatId }, PAGE)).running).not.toBeNull();
    expect(core.stopped).toEqual([{ run: turn, why: CANCELLED }]);
    await ends(rig, core, chatId, turn, "stopped", { reason: CANCELLED });
    const view = await thread(rig, chatId);
    expect(view.running).toBeNull();
    expect(view.thread.at(-1)).toMatchObject({ role: "assistant", text: "", status: "cancelled", reason: CANCELLED });
    expect(view.proposals).toEqual([]);
    expect(rig.rt.diag.activityOf(chatId)).toBeNull();

    // A turn LumiAH can't stop from here (it runs in the user's runtime, or was lost) is over for the thread all the same, and what its agent still calls only reads.
    rig.body(await say(rig, chatId, "And Brann?"));
    const lost = core.turn;
    await begins(rig, chatId, lost);
    core.live.delete(lost);
    rig.body(await rig.send({ type: "lre.assistant", op: "cancel", chatId }, PAGE));
    await rig.dispatch.assistant.settle();
    await rig.host.settle();
    const after = await thread(rig, chatId);
    expect(after.running).toBeNull();
    expect(after.thread.at(-1)).toMatchObject({ role: "assistant", status: "cancelled", reason: CANCELLED });
    expect((await call(rig, chatId, lost, "gm_move", MOVE)).error).toBe(true);
    expect((await call(rig, chatId, lost, "people_where", { person: "Okoro" })).error).toBeUndefined();
    await ends(rig, core, chatId, lost, "done", { reply: "Brann is out." });
    expect((await thread(rig, chatId)).thread).toHaveLength(4);
    expect(await whereIsOkoro(rig, chatId)).toBeNull();
    noModelCalls(rig);
  });

  test("a second message reuses the session, and so does one after a restart; Clear removes it with the thread, and the next message starts another", async () => {
    const { rig: before, chatId, core } = await assistantChat();
    before.body(await say(before, chatId, "Is Okoro coming by today?"));
    await ends(before, core, chatId, core.turn, "done", { reply: "At noon." });
    before.body(await say(before, chatId, "And Brann?"));
    const first = core.rows[0]?.id ?? "";
    expect(core.of("sides.start")).toHaveLength(1);
    expect(core.of("side.send").map((sent) => sent.session)).toEqual([first, first]);
    // While it answers, the conversation can't be cleared, and LumiAH is asked to remove nothing.
    expect(await before.send({ type: "lre.assistant", op: "clear", chatId }, PAGE)).toMatchObject({ type: "lre.error", code: "conflict" });
    expect(core.of("sides.remove")).toEqual([]);
    await ends(before, core, chatId, core.turn, "done", { reply: "Brann is out until dusk." });
    expect((await thread(before, chatId)).thread.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);

    // The backend restarts: the thread names the session, and LumiAH still has it.
    const rig = before.restart();
    mount(rig);
    rig.rt.harness.core = core;
    rig.body(await say(rig, chatId, "Is Joss in?"));
    expect(core.of("sides.start")).toHaveLength(1);
    expect(core.of("side.send").at(-1)).toEqual({ session: first, text: "Is Joss in?" });
    await ends(rig, core, chatId, core.turn, "done", { reply: "Joss is in the kitchen." });
    expect((await thread(rig, chatId)).thread.map((m) => m.text)).toEqual(["Is Okoro coming by today?", "At noon.", "And Brann?", "Brann is out until dusk.", "Is Joss in?", "Joss is in the kitchen."]);

    expect(viewOf(rig, await rig.send({ type: "lre.assistant", op: "clear", chatId }, PAGE))).toEqual({ thread: [], running: null, proposals: [] });
    expect(core.of("sides.remove")).toEqual([{ id: first }]);
    expect(core.rows).toEqual([]);
    expect((await rig.rt.chatAgents.get(chatId, rig.host.userId)).assistant).toEqual({ messages: [], proposals: {} });

    rig.body(await say(rig, chatId, "Who is at the house?"));
    expect(core.of("sides.start")).toHaveLength(2);
    const second = core.rows[0]?.id ?? "";
    expect(second).not.toBe(first);
    expect(core.of("side.send").at(-1)).toEqual({ session: second, text: "Who is at the house?" });
    await ends(rig, core, chatId, core.turn, "done", { reply: "Mara, Joss and Ilse." });
    noModelCalls(rig);
  });

  test("a session LumiAH no longer has for this chat is started again, and another chat's is never removed", async () => {
    const { rig, chatId, core } = await assistantChat();
    const user = rig.host.userId;
    rig.body(await say(rig, chatId, "Is Okoro coming by today?"));
    await ends(rig, core, chatId, core.turn, "done", { reply: "At noon." });
    // Removed on LumiAH's own page: the next message starts one, and the thread names that.
    core.rows.length = 0;
    rig.body(await say(rig, chatId, "And Brann?"));
    expect(core.of("sides.start")).toHaveLength(2);
    expect((await rig.rt.chatAgents.get(chatId, user)).assistant.side).toBe(core.rows[0]?.id ?? "none");
    await ends(rig, core, chatId, core.turn, "done", { reply: "Out until dusk." });

    // A Branch copies the thread with the session it names, which stays about the chat it came from.
    const origin = "the-chat-it-was-branched-from";
    core.rows.length = 0;
    core.rows.push({ id: "side_origin", chatId: origin, agent: HARNESS_AGENT.assistant, title: "", createdAt: 1, lastAt: 1, turns: 2 });
    await rig.rt.chatAgents.setAssistant(chatId, user, (now) => ({ ...now, side: "side_origin" }));
    rig.body(await say(rig, chatId, "Who is at the house?"));
    expect(core.of("side.send").at(-1)?.session).not.toBe("side_origin");
    expect(core.rows.map((row) => row.chatId)).toEqual([origin, chatId]);
    await ends(rig, core, chatId, core.turn, "done", { reply: "Mara, Joss and Ilse." });
    await rig.rt.chatAgents.setAssistant(chatId, user, (now) => ({ ...now, side: "side_origin" }));
    rig.body(await rig.send({ type: "lre.assistant", op: "clear", chatId }, PAGE));
    expect(core.of("sides.remove")).toEqual([]);
    expect(core.rows.map((row) => row.id)).toContain("side_origin");
    noModelCalls(rig);
  });

  test("where LumiAH can't be asked, or refuses, the message is refused with what to do: nothing is added to the thread and nothing answers for it", async () => {
    const { rig, chatId } = await harnessChat();
    const empty: AssistantView = { thread: [], running: null, proposals: [] };
    // No LumiAH mounted.
    const none = await say(rig, chatId, "Is Okoro coming by today?");
    expect(none).toMatchObject({ type: "lre.error", code: "unavailable" });
    const told = none.type === "lre.error" ? none.message : "";
    expect(told).toContain("harness");
    expect(told).toContain("Extensions → LumiRPEngine");
    expect(told).toContain("GM → This chat → Engine");
    expect(await thread(rig, chatId)).toEqual(empty);

    // LumiAH there, and refusing: its own words, which say what to do.
    const core = new Sides();
    rig.rt.harness.core = core;
    const off = `There is no agent "${HARNESS_AGENT.assistant}" to talk to: it may have been removed or switched off.`;
    core.refuse = { op: "sides.start", error: refusal("not_found", off) };
    const refused = await say(rig, chatId, "Is Okoro coming by today?");
    expect(refused).toMatchObject({ type: "lre.error", code: "unavailable" });
    expect(refused.type === "lre.error" ? refused.message : "").toContain(off);
    expect(await thread(rig, chatId)).toEqual(empty);

    // It takes no message while the session still works on one said elsewhere. The session it started is kept all the same, and used by the next.
    core.refuse = { op: "side.send", error: refusal("unavailable", BUSY) };
    const busy = await say(rig, chatId, "Is Okoro coming by today?");
    expect(busy).toMatchObject({ type: "lre.error", code: "unavailable" });
    expect(busy.type === "lre.error" ? busy.message : "").toContain(BUSY);
    expect(await thread(rig, chatId)).toEqual(empty);
    expect(rig.rt.diag.activityOf(chatId)).toBeNull();
    rig.body(await say(rig, chatId, "Is Okoro coming by today?"));
    expect(core.rows).toHaveLength(1);
    expect(core.of("side.send").at(-1)).toEqual({ session: core.rows[0]?.id ?? "", text: "Is Okoro coming by today?" });
    await ends(rig, core, chatId, core.turn, "done", { reply: "At noon." });
    expect((await thread(rig, chatId)).thread.map((m) => m.role)).toEqual(["user", "assistant"]);
    noModelCalls(rig);
  });

  test("a call, or the turn's end, that comes before LumiAH has answered the send waits for it", async () => {
    const { rig, chatId, core } = await assistantChat();
    // The turn begins and its agent calls a tool while the answer to `side.send`, which names the turn, is still on its way.
    const answer = Promise.withResolvers<void>();
    const began = Promise.withResolvers<void>();
    core.hold = { until: answer.promise, began: () => began.resolve() };
    const sending = say(rig, chatId, "Bring Okoro to the house.");
    await began.promise;
    await begins(rig, chatId, core.turn);
    let served = false;
    const calling = call(rig, chatId, core.turn, "gm_move", MOVE).finally(() => {
      served = true;
    });
    await rig.host.settle();
    expect(served).toBe(false);
    answer.resolve();
    rig.body(await sending);
    expect(JSON.parse((await calling).text)).toMatchObject({ proposed: { changeType: "gm_edit" } });
    await ends(rig, core, chatId, core.turn, "done", { reply: "I propose bringing Okoro to the house." });
    expect((await thread(rig, chatId)).proposals).toHaveLength(1);

    // A turn that is over before its send was answered is still the thread's answer.
    const later = Promise.withResolvers<void>();
    const again = Promise.withResolvers<void>();
    core.hold = { until: later.promise, began: () => again.resolve() };
    const second = say(rig, chatId, "And Brann?");
    await again.promise;
    const quick = core.turn;
    core.live.delete(quick);
    await rig.rt.harness.extension.runEnded?.({ userId: rig.host.userId, chatId, turn: quick, kind: "side", status: "failed", reason: "The connection refused the call.", reply: "", record: null, usage: USAGE });
    later.resolve();
    rig.body(await second);
    await rig.dispatch.assistant.settle();
    await rig.host.settle();
    const view = await thread(rig, chatId);
    expect(view.running).toBeNull();
    expect(view.thread.slice(-2)).toMatchObject([
      { role: "user", text: "And Brann?" },
      { role: "assistant", status: "failed", reason: "The connection refused the call." },
    ]);
    noModelCalls(rig);
  });

  test("only the session's own agent proposes: an agent it starts, and any other side session about the chat, only read", async () => {
    const { rig, chatId, core } = await assistantChat();
    rig.body(await say(rig, chatId, "Bring Okoro to the house."));
    const turn = core.turn;
    await begins(rig, chatId, turn);
    const helper: Caller = { agentId: "side-helper", role: HARNESS_AGENT.gm, main: false, above: [{ agentId: OWN.agentId, role: OWN.role }] };
    expect((await call(rig, chatId, turn, "gm_move", MOVE, helper)).error).toBe(true);
    expect((await call(rig, chatId, turn, "people_where", { person: "Okoro" }, helper)).error).toBeUndefined();
    // A conversation with the author, started on LumiAH's own page while the assistant answers.
    const other = "a-turn-of-another-session";
    await begins(rig, chatId, other);
    const author: Caller = { agentId: "main", role: HARNESS_AGENT.author, main: true, above: [] };
    expect((await call(rig, chatId, other, "gm_move", MOVE, author)).error).toBe(true);
    expect((await call(rig, chatId, other, "people_where", { person: "Okoro" }, author)).error).toBeUndefined();
    await rig.rt.harness.extension.runEnded?.({ userId: rig.host.userId, chatId, turn: other, kind: "side", status: "done", reply: "Nothing to add.", record: null, usage: USAGE });
    // Its end is none of the assistant's: the answer is still under way.
    expect((await thread(rig, chatId)).running).not.toBeNull();
    await ends(rig, core, chatId, turn, "done", { reply: "I looked, and changed nothing." });
    const view = await thread(rig, chatId);
    expect(view.thread.at(-1)).toMatchObject({ role: "assistant", text: "I looked, and changed nothing.", status: "answered" });
    // Nor is anything they called the answer's to show: its own agent called nothing.
    expect(view.thread.at(-1)?.trace).toBeUndefined();
    expect(view.proposals).toEqual([]);
    noModelCalls(rig);
  });
});

describe("GM → Assistant on a chat another engine plays", () => {
  for (const engine of ["classic", "agents"] as const) {
    test(`a ${engine} chat's message is answered by the engine's own agent, and LumiAH is asked nothing`, async () => {
      const { rig, chatId, core } = await assistantChat();
      await playOn(rig, chatId, engine);
      rig.host.quietReply = () => "Okoro isn't at the house.";
      rig.body(await say(rig, chatId, "Is Okoro at the house?"));
      await rig.dispatch.assistant.settle();
      await rig.host.settle();
      const view = await thread(rig, chatId);
      expect(view.running).toBeNull();
      expect(view.thread.map((m) => [m.role, m.text])).toEqual([
        ["user", "Is Okoro at the house?"],
        ["assistant", "Okoro isn't at the house."],
      ]);
      expect(view.thread.at(-1)?.status).toBe("answered");
      expect(rig.host.quietCalls.length).toBeGreaterThan(0);
      expect(core.asked).toEqual([]);
      expect((await rig.rt.chatAgents.get(chatId, rig.host.userId)).assistant.side).toBeUndefined();
    });
  }
});

describe("GM → Assistant with LumiAH's own backend mounted in the engine", () => {
  let open: Bed | null = null;
  afterEach(() => {
    open?.close();
    open = null;
  });

  test("the assistant's agent answers in a side session of LumiAH's: it is offered the engine's change tools, its change is the answer's proposal, and Apply lands it", async () => {
    const rig = new Rig({ shipped: true });
    const bed = (open = lumiahBed(rig));
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    for (const [id, value] of Object.entries(PEOPLE)) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id, value }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.host.quietReply = () => {
      throw new Error("the harness path reached one of the engine's own model calls");
    };
    // The one agent of the turn: it checks a change, then answers with what its tool gave back.
    const play = cast({ name: "assistant", is: () => true, lines: [{ toolCalls: [toolCall("gm_move", MOVE)] }, "I propose bringing Okoro to the house."] });
    bed.script = play.script;

    const sent = viewOf(rig, await say(rig, chatId, "Bring Okoro to the house."));
    expect(sent.running).toMatchObject({ label: STEP_LABEL.assistant });
    await bed.until(async () => (await thread(rig, chatId)).running === null, "the assistant's answer");
    await rig.dispatch.assistant.settle();

    // LumiAH has one side session about the chat, with the assistant's definition, and the thread names it.
    const { sessions } = await bed.page<{ sessions: { id: string; agent: string }[] }>("lah.side.list", { chatId });
    expect(sessions.map((s) => s.agent)).toEqual([HARNESS_AGENT.assistant]);
    expect((await rig.rt.chatAgents.get(chatId, rig.host.userId)).assistant.side).toBe(sessions[0]?.id ?? "none");
    // Its agent was told what the user said, and offered the engine's change tools with its reads; no turn's tools, and nothing of a writer's.
    const [first, second] = play.calls("assistant");
    if (!first || !second) throw new Error("the assistant's agent made fewer calls than its part has lines");
    expect(heard(first)).toContain("Bring Okoro to the house.");
    for (const tool of ["gm_move", "people_where", "item_make"]) expect(offers(tool)(first)).toBe(true);
    for (const tool of ["write_reply", "commit", "time_pass", "lore_save"]) expect(offers(tool)(first)).toBe(false);
    // Its change was checked and nothing else: the tool said what it would do, and the world stands as it was.
    expect(JSON.parse(results(second)[0] ?? "{}")).toMatchObject({ proposed: { changeType: "gm_edit", mode: "auto" } });
    expect(await whereIsOkoro(rig, chatId)).toBeNull();

    const view = await thread(rig, chatId);
    expect(view.thread.map((m) => [m.role, m.text])).toEqual([
      ["user", "Bring Okoro to the house."],
      ["assistant", "I propose bringing Okoro to the house."],
    ]);
    expect(view.thread.at(-1)).toMatchObject({ status: "answered", trace: [{ tool: "gm_move", summary: `entity: "Okoro", to: "${HOME}"` }] });
    const [proposal] = view.proposals;
    expect(proposal).toMatchObject({ status: "open", ops: [{ changeType: "gm_edit", mode: "auto" }] });
    const applied = viewOf(rig, await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: proposal?.id }, PAGE)).proposals[0];
    expect(applied).toMatchObject({ status: "applied", ops: [{ applied: true }] });
    expect(applied?.chipId).toStartWith("fix:");
    expect(await whereIsOkoro(rig, chatId)).toBe(HOME);

    // Clear takes the session out of LumiAH with the thread.
    rig.body(await rig.send({ type: "lre.assistant", op: "clear", chatId }, PAGE));
    expect((await bed.page<{ sessions: unknown[] }>("lah.side.list", { chatId })).sessions).toEqual([]);
    noModelCalls(rig);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

// GM → Assistant, the backend (INC1-SPEC R6a; AGENT-LOOP-PLAN §11, Increment 1's acceptance), on a
// Port Alder chat with a scripted model: the three questions answered from the tools; the shop's
// debt under the player character's knowledge and under everyone's; a change proposed, previewed,
// applied with its Undo chip and undone; a change made while a turn runs held until the turn closes,
// the turn kept; the loop detector, a budget and Cancel stopping an answer; an edited system prompt
// sent, and its reset; the thread's history within History tokens; and a Branch keeping the thread,
// whose blobs the sweep keeps. Starter-world names only.

import { describe, expect, test } from "bun:test";
import { historyOf } from "../../src/backend/agents/assistant";
import { SCRATCH_READ } from "../../src/backend/agents/runtime";
import { listWorkspace, readWorkspaceFile } from "../../src/backend/agents/tools/workspace";
import { tokensOf } from "../../src/backend/book";
import type { QuietRequest, QuietToolCall } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { renderPrompt } from "../../src/backend/prompts";
import { fixChip } from "../../src/backend/view";
import { agentSettingsOf, assistantBudget, defaultAgentSettings } from "../../src/shared/agent-settings";
import { type DiagAgentOutcome, type DiagRecord, STEP_LABEL } from "../../src/shared/diagnostics";
import { hasOwn, type JsonObject } from "../../src/shared/json";
import { LEDGER_NAMESPACE, type LedgerEvent } from "../../src/shared/ledger";
import { factId, type KnowledgeFact, MINDS_EVENTS, type MindsGmView } from "../../src/shared/minds";
import { GM_TEXT, promptDef } from "../../src/shared/prompts";
import { type AssistantView, type BackendToFrontend, WRITE_REFUSED } from "../../src/shared/protocol";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import { nounFor } from "../../src/shared/words";
import type { QuietScript } from "../support/fake-host";
import { Rig } from "../support/rig";

/** Words no world text has, so a leak shows. */
const MARK = "DEBT-MARK";
const CLAIM = `${MARK}: the shop is $112,000 in debt on its lease and its loan`;
/** The shop's debt as the knowledge model holds it: the secret's truth, about Marcus. */
const DEBT: KnowledgeFact = { id: factId({ kind: "track", track: "s_shop_trouble", stage: "truth" }), kind: "track", claim: CLAIM, about: ["marcus_delgado"], truth: "true" };
const MARCUS = "Marcus Delgado";
const DANNY = "danny_okafor";
const PRIYA = "priya_nair";

/** A Port Alder chat on every shipped pack, with `patch` made to the settings first. */
async function alder(patch: JsonObject = {}): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  if (Object.keys(patch).length > 0) rig.body(await rig.send({ type: "lre.settings.set", patch }));
  return { rig, chatId };
}

/** Marcus keeps the shop's debt from everyone (the knowledge model's events, as a turn that learned it would record them). */
async function seedDebt(rig: Rig, chatId: string): Promise<void> {
  const now = (rig.body(await rig.send({ type: "lre.gm", chatId })).minds as MindsGmView).now;
  const events: LedgerEvent[] = [
    { type: MINDS_EVENTS.fact, data: { fact: DEBT as unknown as JsonObject } },
    { type: MINDS_EVENTS.learn, data: { who: ["marcus_delgado"], fact: DEBT.id, how: "authored", by: null, evidence: [], belief: "true", confidence: 1, keptFrom: "everyone", at: now, msg: null } },
  ];
  await rig.rt.ledger.write(chatId, rig.host.userId, { kind: "post", id: "seed-debt", target: "head", entry: { kind: "fix", events } });
}

/** Where someone is at the chat's head: the place's id and name. */
async function whereIs(rig: Rig, chatId: string, who: string): Promise<{ id: string; name: string }> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const render = core?.renderState(toChain(await rig.host.chats.messages(chatId, rig.host.userId)));
  const place = render?.state.entities[who]?.fields.place;
  if (!render || typeof place !== "string") throw new Error(`${who} is nowhere`);
  return { id: place, name: render.world.places[place]?.name ?? place };
}

const call = (name: string, args: JsonObject, callId = `call_${name}`): QuietToolCall => ({ name, args, callId });

/** Whether a quiet call is the assistant's: an agent with tools is offered scratch_read; no engine step is. */
const isAssistant = (req: QuietRequest): boolean => (req.tools ?? []).some((t) => t.name === SCRATCH_READ);

/** The scripted assistant: its calls, numbered from 0 across the test, answer `script`; the engine's own calls answer nothing. Its requests, in order. */
function model(rig: Rig, script: (req: QuietRequest, n: number) => QuietScript | Promise<QuietScript>): QuietRequest[] {
  const asked: QuietRequest[] = [];
  rig.host.quietReply = (req) => {
    if (!isAssistant(req)) return "{}";
    asked.push(req);
    return script(req, asked.length - 1);
  };
  return asked;
}

/** What the tools gave back to the call that sends their results. */
const resultsOf = (req: QuietRequest): string[] => (req.messages.at(-1)?.parts ?? []).flatMap((p) => (p.type === "tool_result" ? [p.content] : []));

/** A model that calls `name` with `args` first, and then answers with what the tool gave back. */
const fromTool =
  (name: string, args: JsonObject) =>
  (req: QuietRequest): QuietScript =>
    resultsOf(req).length === 0 ? { content: "", toolCalls: [call(name, args)] } : `From ${name}: ${resultsOf(req).join("\n")}`;

/** The GM → Assistant page's session: the thread's pushes go to the pages that asked about it, and to no other. */
const PAGE = "gm-assistant-page";

async function thread(rig: Rig, chatId: string): Promise<AssistantView> {
  return rig.body(await rig.send({ type: "lre.assistant", op: "get", chatId }, PAGE)) as unknown as AssistantView;
}

/** Sends `text` to the assistant from the page and waits for its answer: the thread after it. */
async function ask(rig: Rig, chatId: string, text: string): Promise<AssistantView> {
  rig.body(await rig.send({ type: "lre.assistant", op: "send", chatId, text }, PAGE));
  await rig.dispatch.assistant.settle();
  await rig.host.settle();
  return thread(rig, chatId);
}

async function agentRecords(rig: Rig, chatId: string): Promise<DiagRecord[]> {
  return ((rig.body(await rig.send({ type: "lre.diag", chatId, op: "get" })).records ?? []) as DiagRecord[]).filter((r) => r.kind === "agent");
}

/** Every activity line pushed for the chat while an agent worked outside a turn carries the assistant's label and nothing else. */
function labelOnly(rig: Rig, chatId: string): void {
  const lines = rig.host.sent.flatMap((m) => (m.type === "lre.activity" && m.chatId === chatId && m.activity?.turn === null ? [m.activity] : []));
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) expect(line).toEqual({ chatId, turn: null, state: "running", label: STEP_LABEL.assistant ?? "", since: expect.any(Number) });
}

describe("GM → Assistant answers from the tools", () => {
  test("who knows about the shop's debt, where Danny is and what Jordan carries", async () => {
    const { rig, chatId } = await alder();
    await seedDebt(rig, chatId);
    const danny = await whereIs(rig, chatId, DANNY);

    model(rig, fromTool("knowledge_who_knows", { about: "shop debt" }));
    const debt = (await ask(rig, chatId, "Who knows about the shop's debt?")).thread.at(-1);
    expect(debt).toMatchObject({ role: "assistant", status: "answered", trace: [{ tool: "knowledge_who_knows", summary: 'about: "shop debt"' }] });
    expect(debt?.text).toContain(secretMarkText(CLAIM, [MARCUS], "everyone", SECRET_MARK_WORDING));

    model(rig, fromTool("people_where", { person: "Danny" }));
    const where = (await ask(rig, chatId, "Where is Danny?")).thread.at(-1);
    expect(where).toMatchObject({ status: "answered", trace: [{ tool: "people_where", summary: 'person: "Danny"' }] });
    expect(where?.text).toContain(danny.name);

    model(rig, fromTool("items_inventory", { person: "Jordan" }));
    const carry = (await ask(rig, chatId, "What does Jordan carry?")).thread.at(-1);
    expect(carry).toMatchObject({ status: "answered", trace: [{ tool: "items_inventory", summary: 'person: "Jordan"' }] });
    for (const thing of ["Wallet", "Phone", "Keys"]) expect(carry?.text).toContain(thing);

    // Each call is a Diagnostics agent record of its own: the tool call, then the answer, three times over.
    const records = await agentRecords(rig, chatId);
    expect(records.map((r) => [r.step, r.turn, r.agent?.outcome, r.agent?.tools ?? []])).toEqual([
      ["assistant", null, "ok", ["knowledge_who_knows"]],
      ["assistant", null, "ok", []],
      ["assistant", null, "ok", ["people_where"]],
      ["assistant", null, "ok", []],
      ["assistant", null, "ok", ["items_inventory"]],
      ["assistant", null, "ok", []],
    ]);
    // A record's text is what that call was sent and answered, read behind Diagnostics' curtain.
    const text = rig.body(await rig.send({ type: "lre.diag", chatId, op: "text", hash: records[2]?.agent?.text ?? "" })).text;
    expect(text).toContain("Where is Danny?");
    expect(text).toContain("people_where");

    // The thread is six messages, oldest first; nothing is proposed; the drawer's line said only the assistant's label.
    const view = await thread(rig, chatId);
    expect(view.thread.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"]);
    expect([view.running, view.proposals]).toEqual([null, []]);
    labelOnly(rig, chatId);
    // What the page is pushed for Play never carries the secret; the thread's updates (GM data) do.
    for (const m of rig.host.sent) if (m.type === "lre.state.snapshot" || m.type === "lre.state.delta" || m.type === "lre.activity") expect(JSON.stringify(m)).not.toContain(MARK);
    expect(rig.host.sent.some((m) => m.type === "lre.assistant.update" && m.chatId === chatId && JSON.stringify(m.view).includes(MARK))).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("on the player character's knowledge the debt isn't revealed; on everyone's it shows as Marcus's, kept from everyone", async () => {
    for (const knowledge of ["pov", "everyone"] as const) {
      const { rig, chatId } = await alder({ agents: { assistant: { knowledge } } });
      await seedDebt(rig, chatId);
      const asked = model(rig, fromTool("knowledge_who_knows", { about: "shop debt" }));
      const answer = (await ask(rig, chatId, "Who knows about the shop's debt?")).thread.at(-1)?.text ?? "";
      const told = asked[1] ? resultsOf(asked[1]).join("\n") : "";
      if (knowledge === "pov") {
        for (const seen of [answer, told]) expect(seen).not.toContain(MARK);
      } else {
        expect(told).toContain(secretMarkText(CLAIM, [MARCUS], "everyone", SECRET_MARK_WORDING));
        expect(answer).toContain(secretMarkText(CLAIM, [MARCUS], "everyone", SECRET_MARK_WORDING));
      }
      // The system prompt says whose knowledge it reads with.
      const pov = "Jordan Ellis";
      expect(asked[0]?.messages[0]?.content).toContain(renderPrompt(GM_TEXT.knowledge[knowledge], {}, { world: "Port Alder", pov }));
    }
  });
});

describe("its changes", () => {
  test("a proposed change shows its preview, writes nothing, applies with an Undo chip, and Undo restores the state", async () => {
    const { rig, chatId } = await alder();
    const before = await whereIs(rig, chatId, DANNY);
    model(rig, (req) => (resultsOf(req).length === 0 ? { content: "", toolCalls: [call("gm_move", { entity: "Danny Okafor", to: "Bluebird Coffee" })] } : "I propose moving Danny Okafor to Bluebird Coffee."));
    const view = await ask(rig, chatId, "Move Danny to Bluebird Coffee.");
    const answer = view.thread.at(-1);
    const [proposal] = view.proposals;
    if (!proposal || !answer) throw new Error("nothing proposed");
    // Open, from that answer, with its change in plain words: Apply sends nothing else.
    expect(proposal).toMatchObject({ status: "open", messageId: answer.id, ops: [{ changeType: "gm_edit", mode: "auto" }] });
    expect(proposal.ops[0]?.lines.join("\n")).toContain("Bluebird Coffee");
    expect(JSON.stringify(proposal)).not.toContain('"op"');
    expect(await whereIs(rig, chatId, DANNY)).toEqual(before);

    const applied = (rig.body(await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: proposal.id })) as unknown as AssistantView).proposals[0];
    expect(applied).toMatchObject({ status: "applied", ops: [{ key: proposal.ops[0]?.key, applied: true }] });
    expect(applied?.pending).toBeUndefined();
    expect((await whereIs(rig, chatId, DANNY)).id).toBe("bluebird_coffee");
    // Its chip is the chat's GM edit chip, whose Undo takes the change back.
    const chip = applied?.chipId ?? "";
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.id === chip)).toBe(true);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip, choice: "undo" }));
    expect(await whereIs(rig, chatId, DANNY)).toEqual(before);
    // A proposal applies once.
    expect((await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: proposal.id })).type).toBe("lre.error");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a pick applies only the changes picked, No turns a proposal down, and at once applies as soon as it has answered", async () => {
    const { rig, chatId } = await alder();
    const danny = await whereIs(rig, chatId, DANNY);
    const priya = await whereIs(rig, chatId, PRIYA);
    const moves = [call("gm_move", { entity: "Danny Okafor", to: "Bluebird Coffee" }, "c1"), call("gm_move", { entity: "Priya Nair", to: "Alder Market" }, "c2")];
    model(rig, (req) => (resultsOf(req).length === 0 ? { content: "", toolCalls: moves } : "Both moves are ready."));
    const [both] = (await ask(rig, chatId, "Send Danny to the coffee shop and Priya to the market.")).proposals;
    expect(both?.ops).toHaveLength(2);
    const first = both?.ops[0]?.key ?? "";
    const picked = (rig.body(await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: both?.id, keys: [first] })) as unknown as AssistantView).proposals[0];
    expect(picked?.ops.map((o) => o.applied === true)).toEqual([true, false]);
    expect([(await whereIs(rig, chatId, DANNY)).id, await whereIs(rig, chatId, PRIYA)]).toEqual(["bluebird_coffee", priya]);
    // A pick of a change it doesn't hold is refused.
    expect((await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: both?.id, keys: ["nope"] })).type).toBe("lre.error");

    model(rig, (req) => (resultsOf(req).length === 0 ? { content: "", toolCalls: [call("gm_move", { entity: "Priya Nair", to: "Alder Market" })] } : "Ready."));
    const [, again] = (await ask(rig, chatId, "Move Priya to the market.")).proposals;
    const rejected = (rig.body(await rig.send({ type: "lre.assistant", op: "reject", chatId, proposalId: again?.id })) as unknown as AssistantView).proposals[1];
    expect(rejected?.status).toBe("rejected");
    expect(await whereIs(rig, chatId, PRIYA)).toEqual(priya);

    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { assistant: { apply: "at_once" } } } }));
    model(rig, (req) => (resultsOf(req).length === 0 ? { content: "", toolCalls: [call("gm_move", { entity: "Danny Okafor", to: danny.name })] } : "Done."));
    const [, , atOnce] = (await ask(rig, chatId, "Send Danny back.")).proposals;
    expect(atOnce).toMatchObject({ status: "applied", ops: [{ applied: true }] });
    expect(atOnce?.chipId).toStartWith("fix:");
    expect(await whereIs(rig, chatId, DANNY)).toEqual(danny);
  });

  test("a change it makes while a turn runs is held, lands once the turn is in, and the turn isn't discarded", async () => {
    const { rig, chatId } = await alder({ agents: { assistant: { apply: "at_once" } } });
    await rig.turn(chatId, "I look around.", "The street is quiet.");
    const before = await whereIs(rig, chatId, DANNY);
    rig.host.sendUser(chatId, "I wave.");
    await rig.host.settle();
    const sends: Promise<BackendToFrontend>[] = [];
    rig.host.quietReply = (req) => {
      if (isAssistant(req)) return resultsOf(req).length === 0 ? { content: "", toolCalls: [call("gm_move", { entity: "Danny Okafor", to: "Bluebird Coffee" })] } : "Moving Danny Okafor to Bluebird Coffee.";
      // The GM asks while the engine works on the turn, before its reply.
      if (sends.length === 0) sends.push(rig.send({ type: "lre.assistant", op: "send", chatId, text: "Move Danny to Bluebird Coffee." }));
      return "{}";
    };
    const g = await rig.host.start(chatId, { type: "normal" });
    const [sent] = sends;
    if (!sent) throw new Error("the engine asked no model while it ran");
    rig.body(await sent);
    await rig.dispatch.assistant.settle();
    await rig.host.settle();
    // Applied at once, it waits for the turn: no chip yet, nothing changed, and the reply goes on.
    const held = (await thread(rig, chatId)).proposals[0];
    expect(held).toMatchObject({ status: "applied", pending: true, ops: [{ applied: true }] });
    expect(held?.chipId).toBeUndefined();
    expect(g.halted).toBeUndefined();
    expect(await whereIs(rig, chatId, DANNY)).toEqual(before);
    await rig.host.finish(g, "Someone waves back.");
    expect((await whereIs(rig, chatId, DANNY)).id).toBe("bluebird_coffee");
    // The turn played: its record is the reply's, and the GM edit landed on it after the turn's events.
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const head = rig.host.head(chatId);
    const rec = head ? core?.journal.messages[head.id]?.ledger.swipes[String(head.swipeId)] : undefined;
    expect(rec?.status).toBe("ok");
    expect(rec?.post.find((p) => p.kind === "fix" && p.gm === true)?.seq).toBeGreaterThan(rec?.seq ?? Number.POSITIVE_INFINITY);
    expect([core?.journal.held, core?.journal.prereply]).toEqual([[], undefined]);
    // Once it lands, the proposal names its write's Undo chip, and the thread is pushed with it.
    await rig.dispatch.assistant.settle();
    const entry = rec?.post.find((p) => p.kind === "fix" && p.gm === true);
    const chip = head && entry ? fixChip(head.id, head.swipeId, entry.seq) : "";
    const landed = (await thread(rig, chatId)).proposals[0];
    expect(landed).toMatchObject({ status: "applied", chipId: chip });
    expect(landed?.pending).toBeUndefined();
    expect(rig.host.sent.some((m) => m.type === "lre.assistant.update" && m.chatId === chatId && m.view.proposals[0]?.chipId === chip)).toBe(true);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.id === chip)).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("Apply counts each change it applied toward what the assistant learns, No each one it turned down, and an Undo takes an Apply back", async () => {
    const { rig, chatId } = await alder();
    const user = rig.host.userId;
    // What the assistant's role has learned of GM edits, per connection; the extract step's learning holds none of it.
    const learned = async () => {
      const learning = await rig.rt.settings.learningOf(user);
      expect(Object.values(learning.connections).some((byType) => hasOwn(byType, "gm_edit"))).toBe(false);
      return Object.values(learning.roles?.assistant ?? {}).map((byType) => byType.gm_edit);
    };
    const move = (to: string) => model(rig, (req) => (resultsOf(req).length === 0 ? { content: "", toolCalls: [call("gm_move", { entity: "Danny Okafor", to })] } : "Ready."));
    move("Bluebird Coffee");
    const [first] = (await ask(rig, chatId, "Move Danny to Bluebird Coffee.")).proposals;
    rig.body(await rig.send({ type: "lre.assistant", op: "reject", chatId, proposalId: first?.id }));
    expect(await learned()).toEqual([{ accepted: 0, rejected: 1, recent: "r" }]);
    move("Alder Market");
    const [, second] = (await ask(rig, chatId, "Move Danny to the market.")).proposals;
    const applied = (rig.body(await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: second?.id })) as unknown as AssistantView).proposals[1];
    expect(await learned()).toEqual([{ accepted: 1, rejected: 1, recent: "ra" }]);
    // Its Undo, pressed in the chat: the card says it was undone, and the Apply counts as turned down instead.
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: applied?.chipId ?? "", choice: "undo" }));
    expect(await learned()).toEqual([{ accepted: 0, rejected: 2, recent: "rr" }]);
    expect((await thread(rig, chatId)).proposals[1]).toMatchObject({ status: "applied", undone: true });
  });

  test("the Undo of a proposal that also wrote a learned note takes back only its chip's changes, and only they count as undone", async () => {
    const { rig, chatId } = await alder();
    const user = rig.host.userId;
    const path = "learned/danny.md";
    model(rig, (req) => (resultsOf(req).length === 0 ? { content: "", toolCalls: [call("gm_move", { entity: "Danny Okafor", to: "Bluebird Coffee" }, "c1"), call("workspace_write", { path, text: "Danny keeps odd hours." }, "c2")] } : "Ready."));
    const [proposal] = (await ask(rig, chatId, "Move Danny to Bluebird Coffee, and note his hours.")).proposals;
    expect(proposal?.ops.map((o) => o.changeType)).toEqual(["gm_edit", "workspace"]);
    const applied = (rig.body(await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: proposal?.id })) as unknown as AssistantView).proposals[0];
    // What the assistant's role has learned, per connection: GM edits accepted and turned down, then notes.
    const counts = async () => Object.values((await rig.rt.settings.learningOf(user)).roles?.assistant ?? {}).map((byType) => [byType.gm_edit?.accepted, byType.gm_edit?.rejected, byType.workspace?.accepted, byType.workspace?.rejected]);
    expect(await counts()).toEqual([[1, 0, 1, 0]]);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: applied?.chipId ?? "", choice: "undo" }));
    const after = (await thread(rig, chatId)).proposals[0];
    expect(after).toMatchObject({ status: "applied", undone: true });
    expect(after?.ops.map((o) => [o.changeType, o.applied, o.undone])).toEqual([
      ["gm_edit", true, true],
      ["workspace", true, undefined],
    ]);
    expect(await counts()).toEqual([[0, 1, 1, 0]]);
    // The note stays: no Undo reaches the learned area.
    expect((await listWorkspace(rig.rt, { userId: user, chatId, knowledge: "gm" })).map((f) => f.path)).toContain(path);
  });

  test("a change held for a turn that the turn's close refuses waits for Apply or No again, each change saying why, and counts nothing", async () => {
    const { rig, chatId } = await alder({ agents: { assistant: { apply: "at_once" } } });
    const path = "notes/danny.md";
    // Shared with everyone's knowledge, which the assistant reads with: a note of the GM's is the GM's alone until it is.
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path, text: "Danny fixes boats.", readers: "everyone" }));
    await rig.turn(chatId, "I look around.", "The street is quiet.");
    rig.host.sendUser(chatId, "I wave.");
    await rig.host.settle();
    const sends: Promise<void>[] = [];
    rig.host.quietReply = (req) => {
      if (isAssistant(req)) return resultsOf(req).length === 0 ? { content: "", toolCalls: [call("workspace_pin", { path, pinned: true })] } : "Pinned.";
      // While the engine works on the turn, the GM deletes the note, then asks for it pinned: both wait for the turn, the delete first.
      if (sends.length === 0)
        sends.push(
          (async () => {
            rig.body(await rig.send({ type: "lre.workspace", op: "delete", chatId, path }));
            rig.body(await rig.send({ type: "lre.assistant", op: "send", chatId, text: "Pin the note on Danny." }));
          })(),
        );
      return "{}";
    };
    const g = await rig.host.start(chatId, { type: "normal" });
    await Promise.all(sends);
    await rig.dispatch.assistant.settle();
    await rig.host.settle();
    expect((await thread(rig, chatId)).proposals[0]).toMatchObject({ status: "applied", pending: true, ops: [{ applied: true }] });
    await rig.host.finish(g, "Someone waves back.");
    await rig.dispatch.assistant.settle();
    const [proposal] = (await thread(rig, chatId)).proposals;
    expect(proposal).toMatchObject({ status: "open", ops: [{ refused: { code: "write_refused" } }] });
    expect([proposal?.pending, proposal?.chipId, proposal?.ops[0]?.applied]).toEqual([undefined, undefined, undefined]);
    expect(proposal?.ops[0]?.refused?.reason).toContain(path);
    expect(rig.host.sent.some((m) => m.type === "lre.assistant.update" && m.chatId === chatId && m.view.proposals[0]?.status === "open" && m.view.proposals[0]?.ops[0]?.refused?.code === "write_refused")).toBe(true);
    // Nothing of it landed, so nothing counts toward what the assistant learns.
    expect((await rig.rt.settings.learningOf(rig.host.userId)).roles?.assistant).toBeUndefined();
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a held change the turn's close refuses beside a learned note: only that change says why, the note stays applied, what landed counts, and the refused change applies again once", async () => {
    const { rig, chatId } = await alder({ agents: { assistant: { apply: "at_once" } } });
    const path = "notes/danny.md";
    const learned = "learned/danny.md";
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path, text: "Danny fixes boats.", readers: "everyone" }));
    await rig.turn(chatId, "I look around.", "The street is quiet.");
    rig.host.sendUser(chatId, "I wave.");
    await rig.host.settle();
    const sends: Promise<void>[] = [];
    rig.host.quietReply = (req) => {
      if (isAssistant(req)) return resultsOf(req).length === 0 ? { content: "", toolCalls: [call("workspace_pin", { path, pinned: true }, "c1"), call("workspace_write", { path: learned, text: "Danny fixes boats at the marina." }, "c2")] } : "Pinned, and noted.";
      // While the engine works on the turn, the GM deletes the note, then the assistant pins it and notes what it learned: the pin waits for the turn, the learned note lands at once.
      if (sends.length === 0)
        sends.push(
          (async () => {
            rig.body(await rig.send({ type: "lre.workspace", op: "delete", chatId, path }));
            rig.body(await rig.send({ type: "lre.assistant", op: "send", chatId, text: "Pin the note on Danny, and keep what you learned." }));
          })(),
        );
      return "{}";
    };
    const g = await rig.host.start(chatId, { type: "normal" });
    await Promise.all(sends);
    await rig.dispatch.assistant.settle();
    await rig.host.settle();
    expect((await thread(rig, chatId)).proposals[0]).toMatchObject({ status: "applied", pending: true, ops: [{ applied: true }, { applied: true }] });
    await rig.host.finish(g, "Someone waves back.");
    await rig.dispatch.assistant.settle();
    const [proposal] = (await thread(rig, chatId)).proposals;
    // The pin's write was refused: it alone says why. The note landed at Apply, so it, and the proposal, stand applied.
    expect([proposal?.status, proposal?.pending, proposal?.chipId]).toEqual(["applied", undefined, undefined]);
    expect(proposal?.ops.map((o) => [o.applied, o.refused?.code])).toEqual([
      [undefined, "write_refused"],
      [true, undefined],
    ]);
    expect((await listWorkspace(rig.rt, { userId: rig.host.userId, chatId, knowledge: "gm" })).map((f) => f.path)).toEqual([learned]);
    // What landed counts toward what the assistant learns, as accepted; the refused change, neither way.
    const counts = async () => Object.values((await rig.rt.settings.learningOf(rig.host.userId)).roles?.assistant ?? {}).map((byType) => [byType.workspace?.accepted, byType.workspace?.rejected]);
    expect(await counts()).toEqual([[1, 0]]);
    // The note on Danny is back, and the GM rewrote the learned note meanwhile: Apply again sends only the refused pin, which lands with its Undo.
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path, text: "Danny fixes boats.", readers: "everyone" }));
    const rewritten = "Danny fixes boats at the marina, and keeps odd hours.";
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: learned, text: rewritten }));
    const again = (rig.body(await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: proposal?.id })) as unknown as AssistantView).proposals[0];
    expect(again?.ops.map((o) => [o.applied, o.refused?.code])).toEqual([
      [true, undefined],
      [true, undefined],
    ]);
    expect(again?.chipId).toBeDefined();
    expect((await listWorkspace(rig.rt, { userId: rig.host.userId, chatId, knowledge: "gm" })).find((f) => f.path === path)?.pinned).toBe(true);
    // The learned note wasn't written a second time: the GM's text stands.
    expect(await readWorkspaceFile(rig.rt, { userId: rig.host.userId, chatId, knowledge: "gm" }, learned)).toBe(rewritten);
    // Once is all: nothing is left to apply, and each change counted once.
    expect(await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: proposal?.id })).toMatchObject({ type: "lre.error", code: "bad_request" });
    expect(await counts()).toEqual([[2, 0]]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("with your character's knowledge, a change whose write a turn refused between its check and its write applies again, its reason the note every refusal gives", async () => {
    const { rig, chatId } = await alder({ agents: { assistant: { knowledge: "pov" } } });
    const path = "notes/harbor.md";
    const learned = "learned/harbor.md";
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path, text: "The harbor wakes early.", readers: "pov" }));
    model(rig, (req) => (resultsOf(req).length === 0 ? { content: "", toolCalls: [call("workspace_pin", { path, pinned: true }, "c1"), call("workspace_write", { path: learned, text: "The harbor wakes before six." }, "c2")] } : "Pinned, and noted."));
    const [proposal] = (await ask(rig, chatId, "Pin the harbor note, and keep what you learned.")).proposals;
    expect(proposal?.status).toBe("open");
    // A turn lands between the writer's check and its write: the ledger refuses the edit, in words that are the GM's.
    const write = rig.rt.ledger.write.bind(rig.rt.ledger);
    let landed = false;
    rig.rt.ledger.write = async (id, user, w) => {
      if (landed || w.kind !== "post" || w.entry.agent?.role !== "assistant") return write(id, user, w);
      landed = true;
      return { applied: false, pending: false, reason: "GM-REASON: the turn moved the harbor note" };
    };
    const refused = (rig.body(await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: proposal?.id })) as unknown as AssistantView).proposals[0];
    // The learned note landed, so the proposal stands applied; the pin says only what any refusal says to your character, under the code Apply again sends.
    expect(refused?.status).toBe("applied");
    expect(refused?.ops.map((o) => [o.applied, o.refused])).toEqual([
      [undefined, { code: WRITE_REFUSED, reason: renderPrompt(WRITE_NOTE.povRefused, {}, { pov: "Jordan Ellis" }) }],
      [true, undefined],
    ]);
    expect(JSON.stringify(rig.host.sent)).not.toContain("GM-REASON");
    const again = (rig.body(await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: proposal?.id })) as unknown as AssistantView).proposals[0];
    expect(again?.ops.map((o) => [o.applied, o.refused?.code])).toEqual([
      [true, undefined],
      [true, undefined],
    ]);
    expect((await listWorkspace(rig.rt, { userId: rig.host.userId, chatId, knowledge: "gm" })).find((f) => f.path === path)?.pinned).toBe(true);
  });

  test("notes the assistant's Apply and GM → Workspace wrote on an earlier swipe of the head reply follow a Re-run and a Re-narrate made from it, each with its Undo there, and are gone on the swipe made before them", async () => {
    const { rig, chatId } = await alder();
    const user = rig.host.userId;
    await rig.turn(chatId, "I look around.", "The street is quiet.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    // A second swipe, made before the notes; then back on the first, where they are written.
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "The street is quiet still.");
    const shown = async (swipe: number): Promise<void> => {
      rig.host.navigate(chatId, reply.id, swipe);
      await rig.host.settle();
    };
    await shown(0);
    const proposed = "notes/acceptance.md";
    const own = "notes/marina.md";
    model(rig, (req) => (resultsOf(req).length === 0 ? { content: "", toolCalls: [call("workspace_write", { path: proposed, text: "Marcus opens the shop at seven." })] } : "Noted."));
    const [proposal] = (await ask(rig, chatId, "Note when Marcus opens the shop.")).proposals;
    rig.body(await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: proposal?.id }));
    rig.body(await rig.send({ type: "lre.workspace", op: "write", chatId, path: own, text: "Keep an eye on the marina." }));
    const paths = async (): Promise<string[]> => (await listWorkspace(rig.rt, { userId: user, chatId, knowledge: "gm" })).map((f) => f.path);
    const both = [proposed, own].sort();
    expect(await paths()).toEqual(both);
    await shown(1);
    expect(await paths()).toEqual([]);
    for (const mode of ["rerun", "renarrate"] as const) {
      // Regenerated while the first swipe shows: the new swipe goes last, and is made from the first.
      await shown(0);
      rig.rt.setSwipeChoice(chatId, mode);
      await rig.host.finish(await rig.host.start(chatId, { type: "regenerate" }), `The street wakes (${mode}).`);
      const message = rig.host.message(chatId, reply.id);
      const made = message.swipeId;
      expect(made).toBe(message.swipes.length - 1);
      const swipes = (await rig.rt.ledger.core(chatId, user))?.journal.messages[reply.id]?.ledger.swipes;
      expect(swipes?.[String(made)]?.seed === swipes?.["0"]?.seed).toBe(mode === "renarrate");
      expect(await paths()).toEqual(both);
      // Each note keeps its entry, its seq, and so its Undo, on the new swipe; an Undo there takes back that note alone.
      const carried = swipes?.[String(made)]?.post.filter((e) => e.agent !== undefined) ?? [];
      expect(carried.map((e) => e.seq)).toEqual(swipes?.["0"]?.post.filter((e) => e.agent !== undefined).map((e) => e.seq) ?? []);
      const theirs = carried.find((e) => e.agent?.role === "assistant");
      rig.body(await rig.send({ type: "lre.chip", chatId, chip: fixChip(reply.id, made, theirs?.seq ?? -1), choice: "undo" }));
      expect(await paths()).toEqual([own]);
    }
    // The swipe they were written on keeps both, the one made before them neither.
    await shown(0);
    expect(await paths()).toEqual(both);
    await shown(1);
    expect(await paths()).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a note proposed under the GM's knowledge and applied after the assistant moved to your character's is still the GM's alone", async () => {
    const { rig, chatId } = await alder({ agents: { assistant: { knowledge: "gm" } } });
    const path = "notes/marcus.md";
    model(rig, (req) => (resultsOf(req).length === 0 ? { content: "", toolCalls: [call("workspace_write", { path, text: `GM only: ${CLAIM}` })] } : "Proposed a note."));
    const [proposal] = (await ask(rig, chatId, "Note what Marcus hides.")).proposals;
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { assistant: { knowledge: "pov" } } } }));
    const applied = rig.body(await rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: proposal?.id }, PAGE)) as unknown as AssistantView;
    expect(applied.proposals[0]?.status).toBe("applied");
    await rig.host.settle();
    const env = (knowledge: "pov" | "everyone" | "gm") => ({ userId: rig.host.userId, chatId, knowledge });
    expect((await listWorkspace(rig.rt, env("gm"))).map((f) => [f.path, f.readers])).toEqual([[path, "gm"]]);
    for (const knowledge of ["pov", "everyone"] as const) {
      expect(await listWorkspace(rig.rt, env(knowledge))).toEqual([]);
      expect(await readWorkspaceFile(rig.rt, env(knowledge), path)).toBeNull();
    }
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("what stops an answer", () => {
  test("Cancel is heard while an Apply's write still waits, and the Apply lands once its write does", async () => {
    const { rig, chatId } = await alder();
    model(rig, (req) => (resultsOf(req).length === 0 ? { content: "", toolCalls: [call("gm_move", { entity: "Danny Okafor", to: "Bluebird Coffee" })] } : "I propose moving Danny Okafor to Bluebird Coffee."));
    const [proposal] = (await ask(rig, chatId, "Move Danny to Bluebird Coffee.")).proposals;
    // An answer that never comes until it is stopped.
    const { promise: asking, resolve: asked } = Promise.withResolvers<void>();
    model(rig, () => {
      asked();
      return new Promise<QuietScript>(() => undefined);
    });
    rig.body(await rig.send({ type: "lre.assistant", op: "send", chatId, text: "Where is Priya?" }, PAGE));
    await asking;
    // The ledger takes the Apply's write only once it is let go.
    const { promise: gate, resolve: letGo } = Promise.withResolvers<void>();
    const ledger = rig.rt.ledger;
    const write = ledger.write.bind(ledger);
    ledger.write = async (...args) => {
      await gate;
      return write(...args);
    };
    const applying = rig.send({ type: "lre.assistant", op: "apply", chatId, proposalId: proposal?.id }, PAGE);
    // Cancel answers while that write waits, and so does the thread.
    rig.body(await rig.send({ type: "lre.assistant", op: "cancel", chatId }, PAGE));
    await rig.dispatch.assistant.settle();
    const meanwhile = await thread(rig, chatId);
    expect(meanwhile.running).toBeNull();
    expect(meanwhile.thread.at(-1)).toMatchObject({ role: "assistant", status: "cancelled" });
    expect(meanwhile.proposals[0]?.status).toBe("open");
    // Nothing else may apply or turn down that proposal while its write is under way.
    expect(await rig.send({ type: "lre.assistant", op: "reject", chatId, proposalId: proposal?.id }, PAGE)).toMatchObject({ type: "lre.error", code: "conflict" });
    letGo();
    const landed = rig.body(await applying) as unknown as AssistantView;
    expect(landed.proposals[0]).toMatchObject({ status: "applied", chipId: expect.any(String) });
    expect((await whereIs(rig, chatId, DANNY)).name).toBe("Bluebird Coffee");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a connection's refusal of native tools is a Diagnostics record of its own, and the answer goes on with them as text", async () => {
    const { rig, chatId } = await alder();
    // The provider takes no tools: the assistant's call with them is refused, and the same call with them written as text is answered.
    let refused = false;
    rig.host.quietReply = (req) => {
      if (isAssistant(req)) {
        refused = true;
        throw new Error("404: No endpoints found that support tool use.");
      }
      return refused && JSON.stringify(req.messages).includes(SCRATCH_READ) ? "Danny is at home." : "{}";
    };
    expect((await ask(rig, chatId, "Where is Danny?")).thread.at(-1)).toMatchObject({ role: "assistant", text: "Danny is at home.", status: "answered" });
    const records = await agentRecords(rig, chatId);
    expect(records.map((r) => r.agent?.outcome)).toEqual(["refused", "ok"]);
    expect(records[0]?.agent?.error).toContain("No endpoints found that support tool use");
  });

  test("the loop detector stops the same call made again and again, and nothing it found is lost", async () => {
    const { rig, chatId } = await alder();
    const asked = model(rig, () => ({ content: "", toolCalls: [call("people_where", { person: "Danny" })] }));
    const loop = defaultAgentSettings().loopRepeats;
    const view = await ask(rig, chatId, "Where is Danny? Check, and check again.");
    expect(view.thread.at(-1)).toMatchObject({ role: "assistant", status: "stopped" });
    expect(view.thread.at(-1)?.reason).toContain("Loop detector");
    // The call that would have repeated is never run.
    expect(asked).toHaveLength(loop);
    expect(view.thread.at(-1)?.trace).toHaveLength(loop - 1);
    expect([view.running, view.proposals]).toEqual([null, []]);
    expect((await agentRecords(rig, chatId)).map((r) => r.agent?.outcome)).toEqual([...Array.from({ length: loop }, (): DiagAgentOutcome => "ok"), "refused"]);
  });

  test("the assistant's own budget stands in for every agent's", async () => {
    const { rig, chatId } = await alder({ agents: { assistant: { budget: { toolTurns: 1 } } } });
    model(rig, (_req, n) => ({ content: "", toolCalls: [call(n === 0 ? "people_where" : "items_inventory", { person: n === 0 ? "Danny" : "Jordan" })] }));
    const answer = (await ask(rig, chatId, "Where is Danny, and what does Jordan carry?")).thread.at(-1);
    expect(answer).toMatchObject({ status: "refused", trace: [{ tool: "people_where" }] });
    expect(answer?.reason).toContain("Tool rounds per agent");
  });

  test("Cancel stops the answer under way; while it ran, the drawer's line said only the assistant's label", async () => {
    const { rig, chatId } = await alder();
    const { promise: asking, resolve: asked } = Promise.withResolvers<void>();
    model(rig, () => {
      asked();
      // An answer that never comes until the call is stopped.
      return new Promise<QuietScript>(() => undefined);
    });
    const started = rig.body(await rig.send({ type: "lre.assistant", op: "send", chatId, text: "Where is Danny?" })) as unknown as AssistantView;
    expect(started.running).toMatchObject({ label: STEP_LABEL.assistant, tokens: { in: 0, out: 0 } });
    expect(started.thread.map((m) => m.role)).toEqual(["user"]);
    await asking;
    expect(rig.rt.diag.activityOf(chatId)).toEqual({ chatId, turn: null, state: "running", label: STEP_LABEL.assistant ?? "", since: expect.any(Number) });
    // One answer at a time.
    expect((await rig.send({ type: "lre.assistant", op: "send", chatId, text: "And Priya?" })).type).toBe("lre.error");
    rig.body(await rig.send({ type: "lre.assistant", op: "cancel", chatId }));
    await rig.dispatch.assistant.settle();
    await rig.host.settle();
    const view = await thread(rig, chatId);
    expect(view.running).toBeNull();
    expect(view.thread.at(-1)).toMatchObject({ role: "assistant", status: "cancelled" });
    expect(rig.host.quietStopped).toHaveLength(1);
    expect(rig.rt.diag.activityOf(chatId)).toBeNull();
    expect((await agentRecords(rig, chatId)).map((r) => r.agent?.outcome)).toEqual(["cancelled"]);
    labelOnly(rig, chatId);
  });
});

describe("its texts and its thread", () => {
  test("an edited system prompt is the one sent, and its reset brings back the shipped text", async () => {
    const { rig, chatId } = await alder();
    const vars = { world: "Port Alder", pov: "Jordan Ellis" };
    const knowledge = renderPrompt(GM_TEXT.knowledge.everyone, {}, vars);
    const instructions = renderPrompt(GM_TEXT.instructions, {}, vars);
    const mine = "You help the game master of {{world}}, where {{pov}} plays; your tools show you {{knowledge}}.";
    rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts: { [GM_TEXT.system]: mine } } } }));
    const asked = model(rig, () => "Ready.");
    await ask(rig, chatId, "Are you there?");
    expect(asked[0]?.messages[0]).toMatchObject({ role: "system", content: `You help the game master of Port Alder, where Jordan Ellis plays; your tools show you ${knowledge}.\n\n${instructions}` });
    // Its Diagnostics record keeps what was sent.
    const [record] = await agentRecords(rig, chatId);
    expect(rig.body(await rig.send({ type: "lre.diag", chatId, op: "text", hash: record?.agent?.text ?? "" })).text).toContain("You help the game master of Port Alder");

    rig.body(await rig.send({ type: "lre.settings.set", patch: { prompts: { texts: { [GM_TEXT.system]: null } } } }));
    await ask(rig, chatId, "And now?");
    const shipped = renderPrompt(GM_TEXT.system, {}, { ...vars, knowledge });
    expect(shipped.startsWith((promptDef(GM_TEXT.system)?.text ?? "").slice(0, 40))).toBe(true);
    expect(asked[1]?.messages[0]?.content).toBe(`${shipped}\n\n${instructions}`);
    // The thread so far went with it.
    expect(asked[1]?.messages.slice(1).map((m) => [m.role, m.content])).toEqual([
      ["user", "Are you there?"],
      ["assistant", "Ready."],
      ["user", "And now?"],
    ]);
  });

  test("the past messages sent stay within History tokens, the older ones left out with a note saying how many", async () => {
    const { rig, chatId } = await alder();
    const asked = model(rig, (_req, n) => `Answer ${n + 1}.`);
    await ask(rig, chatId, "What day is it?");
    await ask(rig, chatId, "And the time?");
    // Room for the latest exchange only.
    const room = tokensOf("And the time?") + tokensOf("Answer 2.");
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { assistant: { historyTokens: room } } } }));
    await ask(rig, chatId, "Where am I?");
    const vars = { world: "Port Alder", pov: "Jordan Ellis" };
    const note = (count: number): string => renderPrompt(GM_TEXT.historyNote, {}, { ...vars, count: String(count), messages: nounFor(count, "message", "messages") });
    expect(asked[2]?.messages.slice(1).map((m) => [m.role, m.content])).toEqual([
      ["user", `${note(2)}\n\nAnd the time?`],
      ["assistant", "Answer 2."],
      ["user", "Where am I?"],
    ]);
    // With none, the note goes with the message itself.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { assistant: { historyTokens: 0 } } } }));
    await ask(rig, chatId, "Who is here?");
    expect(asked[3]?.messages.slice(1).map((m) => [m.role, m.content])).toEqual([["user", `${note(6)}\n\nWho is here?`]]);
    // An answer that said nothing goes with no exchange.
    expect(historyOf([{ id: "a", role: "user", text: "Hello?", at: 0 }, { id: "b", role: "assistant", text: "", at: 1, status: "cancelled" }], 1000, "gm")).toEqual({ history: [], left: 2 });
  });

  test("a message written with more knowledge than the assistant reads with now never goes with a new one: the debt asked about with everyone's isn't sent with your character's", async () => {
    const { rig, chatId } = await alder({ agents: { assistant: { knowledge: "everyone" } } });
    await seedDebt(rig, chatId);
    const asked = model(rig, (_req, n) => (n === 0 ? `Marcus keeps it from everyone: ${CLAIM}.` : `Answer ${n + 1}.`));
    await ask(rig, chatId, "What is Marcus hiding?");
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { assistant: { knowledge: "pov" } } } }));
    await ask(rig, chatId, "What do I know about the shop?");
    const vars = { world: "Port Alder", pov: "Jordan Ellis" };
    const note = (count: number): string => renderPrompt(GM_TEXT.historyNote, {}, { ...vars, count: String(count), messages: nounFor(count, "message", "messages") });
    // The first exchange was written with everyone's knowledge: left out, and counted in the note.
    expect(JSON.stringify(asked[1]?.messages)).not.toContain(MARK);
    expect(asked[1]?.messages.slice(1).map((m) => [m.role, m.content])).toEqual([["user", `${note(2)}\n\nWhat do I know about the shop?`]]);
    // With everyone's again, both go: one was written with it, the other with less.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { assistant: { knowledge: "everyone" } } } }));
    await ask(rig, chatId, "And now?");
    expect(asked[2]?.messages.slice(1).map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(JSON.stringify(asked[2]?.messages)).toContain(MARK);
  });

  test("its pushes go to the pages that asked about the chat's assistant, and to no other", async () => {
    const { rig, chatId } = await alder();
    model(rig, () => "Danny is at home.");
    await ask(rig, chatId, "Where is Danny?");
    const pushed = rig.host.sent.flatMap((m, i) => (m.type === "lre.assistant.update" ? [rig.host.sentTo[i]?.session] : []));
    expect(pushed.length).toBeGreaterThan(0);
    expect(new Set(pushed)).toEqual(new Set([PAGE]));
    // A request from no page asks for none: nothing is pushed to every page of the user's.
    const other = await alder();
    model(other.rig, () => "Priya is at the hall.");
    other.rig.body(await other.rig.send({ type: "lre.assistant", op: "send", chatId: other.chatId, text: "Where is Priya?" }));
    await other.rig.dispatch.assistant.settle();
    await other.rig.host.settle();
    expect(other.rig.host.sent.some((m) => m.type === "lre.assistant.update")).toBe(false);
  });

  test("a Branch keeps the thread as it stood and goes on with its own, and the sweep keeps what every thread names", async () => {
    const { rig, chatId } = await alder({ retention: { unreferencedDays: 0 } });
    const user = rig.host.userId;
    model(rig, () => "Danny is at home.");
    const original = await ask(rig, chatId, "Where is Danny?");
    const last = (await rig.host.chats.messages(chatId, user)).at(-1)?.id;
    if (!last) throw new Error("no message to branch at");
    const branch = rig.host.branch(chatId, last);
    expect((await thread(rig, branch)).thread).toEqual(original.thread);
    // Each goes on with its own.
    model(rig, () => "Priya is at the market.");
    await ask(rig, branch, "And Priya?");
    expect((await thread(rig, chatId)).thread).toEqual(original.thread);
    expect((await thread(rig, branch)).thread).toHaveLength(4);
    // The thread's messages are blobs its chat's metadata names, which the sweep keeps; a blob nothing names goes.
    const stray = await rig.rt.blobs.put(user, "Nothing names this.");
    await rig.rt.sweep.run(user);
    await rig.rt.sweep.run(user);
    expect(await rig.rt.blobs.get(user, stray)).toBeNull();
    expect((await thread(rig, chatId)).thread).toEqual(original.thread);
    expect((await thread(rig, branch)).thread.map((m) => m.text)).toEqual(["Where is Danny?", "Danny is at home.", "And Priya?", "Priya is at the market."]);
    // Clear forgets the thread in its own chat only.
    expect((rig.body(await rig.send({ type: "lre.assistant", op: "clear", chatId })) as unknown as AssistantView).thread).toEqual([]);
    expect((await thread(rig, branch)).thread).toHaveLength(4);
    const own = (await rig.host.chats.chatMetadata(branch, user))[LEDGER_NAMESPACE];
    expect(own).toMatchObject({ agents: { assistant: { messages: [expect.any(String), expect.any(String), expect.any(String), expect.any(String)] } } });
  });
});

describe("Settings → Agents → Assistant", () => {
  test("its defaults, and a stored value it can't take keeps the default", () => {
    const d = defaultAgentSettings();
    expect(d.assistant).toEqual({ connectionId: null, model: null, effort: "inherit", knowledge: "everyone", apply: "ask", historyTokens: 20_000, budget: {} });
    const read = agentSettingsOf({ assistant: { connectionId: "", model: 7, effort: "loud", knowledge: "nobody", apply: "later", historyTokens: -1, budget: { toolTurns: 4, tokensIn: "none", revisions: "none", concurrency: 0, nope: 3 } } });
    expect(read.assistant).toEqual({ ...d.assistant, budget: { toolTurns: 4, tokensIn: "none" } });
    expect(assistantBudget(read)).toEqual({ ...d.budget, toolTurns: 4, tokensIn: "none" });
    expect(agentSettingsOf({ assistant: { connectionId: "conn-main", model: "deepseek-v4-flash", effort: "low", knowledge: "pov", apply: "at_once", historyTokens: 0 } }).assistant).toEqual({ connectionId: "conn-main", model: "deepseek-v4-flash", effort: "low", knowledge: "pov", apply: "at_once", historyTokens: 0, budget: {} });
  });
});

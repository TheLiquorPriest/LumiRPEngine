// Telling the story of an action done off screen (DESIGN §11): a standing payment set up at once is
// a payment to someone else, told by default, so the next turn's Outcome leads with it, once; one
// whose Tell is off, or that the player undid before the turn, gives no line; a Re-run of that turn
// tells it again while the turn after doesn't; and the choice recorded on the action stands
// whatever Settings says later. Tell and Don't tell change only the last thing done, never while a
// turn is under way or once it has come, and a double tap changes it once. Port Alder's player
// character, at its own Money level.

import { describe, expect, test } from "bun:test";
import { actionRequest, blankFlowForm, flowCreateAction, flowStatusAction, transferAction, type ActionBody } from "../../src/packs/economy/ui/requests";
import { flowSources } from "../../src/packs/economy/ui/layout";
import { account, MoneyChat } from "../support/money-chat";
import { toChain } from "../../src/backend/ledger-io";
import { TELL_FIXED } from "../../src/backend/view";
import { provenance } from "../../src/packs/economy/core/flows";

const CHECKING = "acct_pov_checking";
const SAVINGS = "acct_pov_savings";
const TOLD = "Off screen before this turn, you saw to this yourself: Set up a standing payment";
/** Every line an Outcome leads with for an action done off screen (`outcome.offstage`). */
const OFFSTAGE_LINE = "Off screen before this turn, you saw to this yourself:";
/** Port Alder's own standing payment from Jordan's checking to their savings. */
const SAVINGS_FLOW = "flow_pov_savings";

/** A tap with no words: done at once, its answer's body. */
async function tap(chat: MoneyChat, body: ActionBody, extra: { tell?: boolean } = {}) {
  const reply = await chat.rig.send({ ...actionRequest(chat.chatId, body), ...extra });
  await chat.rig.rt.push.settle();
  return chat.rig.body(reply);
}

/** A chip's choice as the chat sends it: the answer, a refusal included. */
async function choose(chat: MoneyChat, chip: string, choice: string) {
  const reply = await chat.rig.send({ type: "lre.chip", chatId: chat.chatId, chip, choice });
  await chat.rig.rt.push.settle();
  return reply;
}

/** The off-screen chips on the head, as `[id, action ids]`, oldest first. */
async function fixChips(chat: MoneyChat): Promise<[string, string[]][]> {
  return (await chat.state()).chips.filter((c) => c.kind === "fix").map((c) => [c.id, c.actions.map((a) => a.id)]);
}

/** The savings standing payment's status as Play → Money shows it. */
async function savingsFlow(chat: MoneyChat): Promise<string | undefined> {
  return (await chat.hub()).flows.find((f) => f.id === SAVINGS_FLOW)?.status;
}

/** Its chip id, from an at-once tap's answer. */
function chipOf(done: Record<string, unknown>): string {
  if (typeof done.undo !== "string") throw new Error("no chip");
  return done.undo;
}

async function gym(chat: MoneyChat): Promise<ActionBody> {
  const from = flowSources(await chat.hub())[0]?.id;
  if (!from) throw new Error("no account can pay a standing payment");
  return flowCreateAction({ ...blankFlowForm(from), label: "Gym", to: "Harbor Gym", amount: "40", day: 5 }, chat.currency);
}

/** A turn: a transfer played with Send now; the Outcome its narrator got. */
const turn = (chat: MoneyChat): Promise<string> => chat.play(transferAction(CHECKING, SAVINGS, 100));

describe("an action done off screen and told", () => {
  test("leads the next turn's Outcome once, and the turn after doesn't", async () => {
    const chat = await MoneyChat.start();
    expect(await tap(chat, await gym(chat))).toHaveProperty("applied", true);
    const fix = (await chat.state()).chips.find((c) => c.kind === "fix");
    expect(fix?.actions.map((a) => a.id)).toEqual(["untell", "undo"]);
    const outcome = await turn(chat);
    expect(outcome).toContain(TOLD);
    expect(outcome.indexOf(TOLD)).toBeLessThan(outcome.indexOf("Transfer between accounts"));
    expect(await turn(chat)).not.toContain(TOLD);
  });

  test("a Re-run of that turn tells it again, and the turn after doesn't", async () => {
    const chat = await MoneyChat.start();
    expect(await tap(chat, await gym(chat))).toHaveProperty("applied", true);
    expect(await turn(chat)).toContain(TOLD);
    chat.rig.rt.setSwipeChoice(chat.chatId, "rerun");
    const again = await chat.rig.host.start(chat.chatId, { type: "swipe" });
    const rerun = chat.rig.host.section("Outcome");
    await chat.rig.host.finish(again, "Done again.");
    await chat.rig.rt.push.settle();
    expect(rerun).toContain(TOLD);
    expect(rerun.indexOf(TOLD)).toBeLessThan(rerun.indexOf("Transfer between accounts"));
    expect(await turn(chat)).not.toContain(TOLD);
  });

  test("Tell off gives no line, and neither does one undone before the turn", async () => {
    const chat = await MoneyChat.start();
    expect(await tap(chat, await gym(chat), { tell: false })).toHaveProperty("applied", true);
    expect(await turn(chat)).not.toContain(TOLD);
    const undo = await tap(chat, await gym(chat));
    if (typeof undo.undo !== "string") throw new Error("no Undo");
    chat.rig.body(await chat.rig.send({ type: "lre.chip", chatId: chat.chatId, chip: undo.undo, choice: "undo" }));
    expect(await turn(chat)).not.toContain(TOLD);
  });

  test("the chip's Tell changes it until the turn, and a later settings change leaves the record alone", async () => {
    const chat = await MoneyChat.start();
    const done = await tap(chat, await gym(chat), { tell: false });
    if (typeof done.undo !== "string") throw new Error("no chip");
    chat.rig.body(await chat.rig.send({ type: "lre.chip", chatId: chat.chatId, chip: done.undo, choice: "tell" }));
    await chat.rig.rt.push.settle();
    chat.rig.body(await chat.rig.send({ type: "lre.settings.set", patch: { offstage: { tell: { payments: false } } } }));
    expect(await turn(chat)).toContain(TOLD);
  });
});

describe("Tell and Don't tell change only the last thing done, between turns", () => {
  test("a pause, then a resume: Don't tell on the pause is refused, and the payment stays resumed", async () => {
    const chat = await MoneyChat.start();
    const paused = chipOf(await tap(chat, flowStatusAction(SAVINGS_FLOW, "pause")));
    const resumed = chipOf(await tap(chat, flowStatusAction(SAVINGS_FLOW, "resume")));
    expect(await savingsFlow(chat)).toBe("active");
    // The pause, with the resume after it, keeps its Undo alone and says why; the resume offers Don't tell.
    expect(await fixChips(chat)).toEqual([
      [paused, ["undo"]],
      [resumed, ["untell", "undo"]],
    ]);
    expect((await chat.state()).chips.find((c) => c.id === paused)?.detail).toContain(TELL_FIXED);
    // A tap from a view from before the resume is refused with why, and nothing changes.
    const refused = await choose(chat, paused, "untell");
    expect(refused).toMatchObject({ type: "lre.error", code: "bad_request", message: "Something changed after this, so whether it's told can't change now: only the last thing done can be told or not." });
    expect(await savingsFlow(chat)).toBe("active");
    expect(await fixChips(chat)).toEqual([
      [paused, ["undo"]],
      [resumed, ["untell", "undo"]],
    ]);
    // Both stay told to the next turn, the pause before the resume.
    const outcome = await turn(chat);
    expect(outcome.split(OFFSTAGE_LINE)).toHaveLength(3);
    expect(outcome.indexOf("Pause a standing payment")).toBeLessThan(outcome.indexOf("Resume a standing payment"));
  });

  test("the last thing done is told or not again and again, its events as they were", async () => {
    const chat = await MoneyChat.start();
    const paused = chipOf(await tap(chat, flowStatusAction(SAVINGS_FLOW, "pause")));
    let chip = chipOf(await tap(chat, flowStatusAction(SAVINGS_FLOW, "resume")));
    for (const [choice, offered] of [["untell", "tell"], ["tell", "untell"], ["untell", "tell"]] as const) {
      expect(chat.rig.body(await choose(chat, chip, choice))).toEqual({ applied: true, pending: false });
      const chips = await fixChips(chat);
      expect(chips.map(([, actions]) => actions)).toEqual([["undo"], [offered, "undo"]]);
      expect(chips[0]?.[0]).toBe(paused);
      chip = chips[1]?.[0] ?? "";
      expect(await savingsFlow(chat)).toBe("active");
    }
    // The resume is left untold: the next turn tells the pause alone, and the payment runs.
    const outcome = await turn(chat);
    expect(outcome.split(OFFSTAGE_LINE)).toHaveLength(2);
    expect(outcome).toContain("Pause a standing payment");
    expect(await savingsFlow(chat)).toBe("active");
  });

  test("Don't tell while a turn is under way is refused, the turn tells it, and once it has, it stays told", async () => {
    const chat = await MoneyChat.start();
    const done = chipOf(await tap(chat, await gym(chat)));
    chat.rig.body(await chat.rig.send({ ...actionRequest(chat.chatId, transferAction(CHECKING, SAVINGS, 100)), now: true }));
    await chat.rig.host.settle();
    const generation = await chat.rig.host.start(chat.chatId, { type: "normal" });
    expect(await choose(chat, done, "untell")).toMatchObject({ type: "lre.error", code: "unavailable", message: "The next turn is already under way, so whether this is told can't change now." });
    const outcome = chat.rig.host.section("Outcome");
    await chat.rig.host.finish(generation, "Done.");
    await chat.rig.rt.push.settle();
    expect(outcome).toContain(TOLD);
    expect(await choose(chat, done, "untell")).toMatchObject({ type: "lre.error", code: "bad_request", message: "The next turn has already come, so whether this was told can't change now." });
    expect((await chat.hub()).flows.filter((f) => f.label === "Gym")).toHaveLength(1);
  });

  test("a double tap on Tell tells it once, and moves the money once", async () => {
    const chat = await MoneyChat.start();
    const before = account(await chat.hub(), SAVINGS).cents;
    // Between your own accounts: not told by default, so the chip offers Tell.
    const done = chipOf(await tap(chat, transferAction(CHECKING, SAVINGS, 100)));
    expect(await fixChips(chat)).toEqual([[done, ["tell", "undo"]]]);
    const taps = await Promise.all([0, 1].map(() => chat.rig.send({ type: "lre.chip", chatId: chat.chatId, chip: done, choice: "tell" })));
    await chat.rig.rt.push.settle();
    expect(taps.map((reply) => chat.rig.body(reply).applied).sort()).toEqual([false, true]);
    expect(account(await chat.hub(), SAVINGS).cents).toBe(before + 100);
    expect((await fixChips(chat)).map(([, actions]) => actions)).toEqual([["untell", "undo"]]);
    expect((await turn(chat)).split(OFFSTAGE_LINE)).toHaveLength(2);
  });

  test("a setting changed after it keeps it as it was too", async () => {
    const chat = await MoneyChat.start();
    const done = chipOf(await tap(chat, await gym(chat)));
    await chat.level(4);
    await chat.rig.rt.push.settle();
    expect(await fixChips(chat)).toEqual([[done, ["undo"]]]);
    expect(await choose(chat, done, "untell")).toMatchObject({ type: "lre.error", code: "bad_request" });
    expect(await turn(chat)).toContain(TOLD);
  });
});

describe("a standing payment's provenance", () => {
  test("one authored in the world says so when it pays in a time skip, and one set up off screen carries its origin", async () => {
    const chat = await MoneyChat.start();
    expect(await tap(chat, await gym(chat), { tell: false })).toHaveProperty("applied", true);
    await chat.timelapse(40 * 24 * 60);
    expect((await chat.state()).journal.map((n) => n.text).join("\n")).toMatch(/: \$[\d,.]+ paid \(set up in the world\)\./);
    const core = await chat.rig.rt.ledger.core(chat.chatId, chat.rig.host.userId);
    const head = core?.renderState(toChain(await chat.rig.host.chats.messages(chat.chatId, chat.rig.host.userId)));
    if (!head) throw new Error("no head");
    const id = Object.keys(head.state.entities).find((e) => head.state.entities[e]?.kind === "flow" && head.state.entities[e]?.name === "Gym");
    if (!id) throw new Error("no Gym flow");
    expect(provenance(head, id)).toBe(" (set up off screen)");
  });
});

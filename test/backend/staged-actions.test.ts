// A palette, panel or map tap with no words is staged for the player's next message (DESIGN §11),
// never played blind: no message and no generation until the player sends one, which then plays the
// action with its words as the described approach, recorded on it so a Re-run plays it alike. The
// same tap again clears the stage, Send now plays it at once, and a mechanical action stays immediate.

import { describe, expect, test } from "bun:test";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { actionRequest, transferAction, type ActionBody } from "../../src/packs/economy/ui/requests";
import { account, MoneyChat } from "../support/money-chat";

const CHECKING = "acct_pov_checking";
const SAVINGS = "acct_pov_savings";
/** Paying Danny: not mechanical, since someone else is in it. */
const PAY: ActionBody = { action: "pay", params: { to: "danny_okafor", amount: 2000 } };

function messages(chat: MoneyChat) {
  return chat.rig.host.chat(chat.chatId).messages;
}

async function tap(chat: MoneyChat, body: ActionBody, now = false) {
  const reply = chat.rig.body(await chat.rig.send({ ...actionRequest(chat.chatId, body), ...(now ? { now: true } : {}) }));
  await chat.rig.rt.push.settle();
  return reply;
}

/** Sends the player's message and plays its reply; returns the turn's Outcome section. */
async function say(chat: MoneyChat, text: string): Promise<string> {
  chat.rig.host.sendUser(chat.chatId, text);
  await chat.rig.host.settle();
  const generation = await chat.rig.host.start(chat.chatId, { type: "normal" });
  const outcome = chat.rig.host.section("Outcome");
  await chat.rig.host.finish(generation, "Done.");
  await chat.rig.rt.push.settle();
  return outcome;
}

describe("a tap with no words waits for the player's next message", () => {
  test("it stages, and the next message plays it with its words as the approach; a Re-run plays it again", async () => {
    const chat = await MoneyChat.start();
    const count = messages(chat).length;
    expect(await tap(chat, PAY)).toEqual({ staged: true });
    expect(messages(chat).length).toBe(count);
    expect(chat.rig.host.restarts).toEqual([]);
    expect((await chat.state()).staged).toMatchObject({ action: "pay", params: PAY.params, label: expect.stringContaining("Danny") });

    const outcome = await say(chat, "I slide Danny twenty for the gas, no fuss.");
    const sent = messages(chat).findLast((m) => m.isUser);
    expect(sent?.swipes[sent.swipeId]).toBe("I slide Danny twenty for the gas, no fuss.");
    expect(sent?.bag[LEDGER_NAMESPACE]).toMatchObject({ action: "pay", params: PAY.params, described: true });
    expect(outcome).toContain("Pay");
    expect((await chat.state()).staged ?? null).toBeNull();

    // A Re-run of that message plays the same action.
    chat.rig.rt.setSwipeChoice(chat.chatId, "rerun");
    const again = await chat.rig.host.start(chat.chatId, { type: "swipe" });
    expect(chat.rig.host.section("Outcome")).toContain("Pay");
    await chat.rig.host.finish(again, "Done again.");
  });

  test("the same tap again clears it, and the next message plays as typed text", async () => {
    const chat = await MoneyChat.start();
    expect(await tap(chat, PAY)).toEqual({ staged: true });
    expect(await tap(chat, PAY)).toEqual({ staged: false });
    expect((await chat.state()).staged ?? null).toBeNull();
    await say(chat, "I look around the room.");
    expect(messages(chat).findLast((m) => m.isUser)?.bag[LEDGER_NAMESPACE]).toBeUndefined();
  });

  test("Send now plays it at once, and the stage goes with it", async () => {
    const chat = await MoneyChat.start();
    const count = messages(chat).length;
    await tap(chat, PAY);
    const sent = await tap(chat, PAY, true);
    expect(sent.messageId).toEqual(expect.any(String));
    expect(messages(chat).length).toBe(count + 1);
    expect(messages(chat).at(-1)?.bag[LEDGER_NAMESPACE]).toMatchObject({ action: "pay" });
    expect((await chat.state()).staged ?? null).toBeNull();
  });

  test("a mechanical action stays immediate", async () => {
    const chat = await MoneyChat.start();
    const count = messages(chat).length;
    const before = account(await chat.hub(), SAVINGS).cents;
    expect(await tap(chat, transferAction(CHECKING, SAVINGS, 1000))).toEqual({ applied: true, pending: false });
    expect(messages(chat).length).toBe(count);
    expect(account(await chat.hub(), SAVINGS).cents).toBe(before + 1000);
    expect((await chat.state()).staged ?? null).toBeNull();
  });

  test("the staged action is the player's pick, held to its requirements: one they can't afford is refused, never played as roleplay", async () => {
    const chat = await MoneyChat.start();
    expect(await tap(chat, { action: "pay", params: { to: "danny_okafor", amount: 100_000_000 } })).toEqual({ staged: true });
    const outcome = await say(chat, "I hand Danny the money.");
    const chips = (await chat.rig.rt.view(chat.chatId, chat.rig.host.userId)).chips.filter((c) => c.label.startsWith("Pay"));
    expect(chips.map((c) => c.kind)).toEqual(["decline"]);
    expect(outcome).toContain("Pay");
  });
});

describe("a staged action's message is read for all else its words say", () => {
  test("a staged Walk plays, and the routine the message states brings up its ask", async () => {
    const chat = await MoneyChat.start();
    const said = "I tell Dale I start nights at the marina Monday";
    const routine = { entity: "pov", change: "start", label: "Nights at the marina", days: ["monday"], start: "22:00", end: "06:00", activity: "work", place: "alder_harbor_marina", said };
    const other = chat.rig.host.quietReply;
    // Interpret reads no action of its own in the words, only the routine they state.
    chat.rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes("You map a player's typed input") ? JSON.stringify({ action: null, params: {}, confidence: 0.9, routine: [routine] }) : (other?.(req) ?? "{}"));
    expect(await tap(chat, { action: "go", params: { to: "alder_harbor_marina" } })).toEqual({ staged: true });
    const outcome = await say(chat, `${said}.`);
    expect(outcome).toContain("Go to");
    expect((await chat.state()).chips.some((c) => c.kind === "routine_ask")).toBe(true);
  });
});

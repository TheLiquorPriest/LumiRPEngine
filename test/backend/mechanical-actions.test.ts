// Bookkeeping the player does alone (`ActionDef.mechanical`), tapped from Play → Money with no words,
// is no turn: it is recorded on the head at once, with no message, no reply and no clock time. One
// whose requirement or effect fails records nothing and says why to the panel. Every other action,
// and a mechanical one sent with words, still plays as the player's message.

import { describe, expect, test } from "bun:test";
import { actionRequest, transferAction, tradeAction, type ActionBody } from "../../src/packs/economy/ui/requests";
import { account, MoneyChat } from "../support/money-chat";

const CHECKING = "acct_pov_checking";
const SAVINGS = "acct_pov_savings";
const LKFR = "hold_pov_lkfr";

/** How many messages the chat holds, the player's and the replies. */
function messages(chat: MoneyChat): number {
  return chat.rig.host.chat(chat.chatId).messages.length;
}

async function send(chat: MoneyChat, body: ActionBody, text?: string) {
  const reply = await chat.rig.send({ ...actionRequest(chat.chatId, body), ...(text ? { text } : {}) });
  await chat.rig.rt.push.settle();
  return reply;
}

describe("a mechanical action from a panel", () => {
  test("a trade posts at once: no message, no generation, the clock where it was", async () => {
    const chat = await MoneyChat.start();
    const before = await chat.hub();
    const held = before.investments?.holdings.find((h) => h.id === LKFR)?.qty;
    const clock = (await chat.state()).hud?.clock;
    const count = messages(chat);
    const body = tradeAction({ side: "buy", holding: LKFR, asset: "", account: "", qty: 5, amount: "", from: CHECKING, to: "", option: null }, chat.currency);
    if (typeof body === "string") throw new Error(body);
    const reply = await send(chat, body);
    expect(chat.rig.body(reply)).toEqual({ applied: true, pending: false });
    expect(messages(chat)).toBe(count);
    expect(chat.rig.host.restarts).toEqual([]);
    const after = await chat.hub();
    expect(after.investments?.holdings.find((h) => h.id === LKFR)?.qty).toBe((held ?? 0) + 5);
    expect(account(after, CHECKING).cents).toBe(account(before, CHECKING).cents - 5 * 4200);
    expect((await chat.state()).hud?.clock).toEqual(clock);
    // Its Undo comes as a correction's does, and takes it back.
    const undo = (await chat.state()).chips.find((c) => c.kind === "fix");
    if (!undo) throw new Error("no Undo");
    chat.rig.body(await chat.rig.send({ type: "lre.chip", chatId: chat.chatId, chip: undo.id, choice: "undo" }));
    expect(account(await chat.hub(), CHECKING).cents).toBe(account(before, CHECKING).cents);
  });

  test("one that can't apply records nothing and returns why", async () => {
    const chat = await MoneyChat.start();
    const before = await chat.hub();
    const count = messages(chat);
    const room = account(before, CHECKING).available ?? 0;
    const reply = await send(chat, transferAction(CHECKING, SAVINGS, room + 1));
    expect(reply.type).toBe("lre.error");
    expect(messages(chat)).toBe(count);
    expect((await chat.hub()).accounts.map((a) => [a.id, a.cents])).toEqual(before.accounts.map((a) => [a.id, a.cents]));
    expect((await chat.state()).chips.some((c) => c.kind === "fix")).toBe(false);
  });

  test("an action that isn't mechanical, or one sent with words, still appends the player's message", async () => {
    const chat = await MoneyChat.start();
    const count = messages(chat);
    const withdraw: ActionBody = { action: "withdraw_cash", params: { account: CHECKING, amount: 2000 } };
    expect(chat.rig.body(await send(chat, withdraw)).messageId).toEqual(expect.any(String));
    expect(messages(chat)).toBe(count + 1);
    expect(chat.rig.body(await send(chat, transferAction(CHECKING, SAVINGS, 1000), "I move ten bucks to savings."))).toHaveProperty("messageId");
    expect(messages(chat)).toBe(count + 2);
  });
});

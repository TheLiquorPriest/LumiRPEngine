// Money and organization actions (`shared/offstage.ts`), tapped from Play → Money or an
// organization's pages with no words, are no turn (DESIGN §11): each is recorded on the head at
// once, with no message, no reply and no clock time, and its Undo, even one that asks for approval
// or puts the act to a vote. One whose requirement or effect fails records nothing and says why to
// the panel, as does cash handed to someone who isn't there. Sent with words, or with Send now, it
// still plays as the player's message, and `buy` stays in the world: a tap of it is staged.

import { describe, expect, test } from "bun:test";
import { chatHead } from "../../src/backend/agents/tools/workspace";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { requestsOf } from "../../src/packs/orgs/core/approvals";
import { motionsOf } from "../../src/packs/orgs/core/motions";
import { actionRequest, transferAction, tradeAction, type ActionBody } from "../../src/packs/economy/ui/requests";
import { account, MoneyChat } from "../support/money-chat";
import { TELL_FIXED } from "../../src/backend/view";

const CHECKING = "acct_pov_checking";
const SAVINGS = "acct_pov_savings";
const LKFR = "hold_pov_lkfr";
const SHOP = "alder_automotive_co";
const MARCUS = "marcus_delgado";
const JESS = "jess_kowalczyk";
const PRIYA = "priya_nair";
const DANNY = "danny_okafor";
const DALE = "dale_whitcomb";
const EMR = "ellis_mobile_repair_co";

/** How many messages the chat holds, the player's and the replies. */
function messages(chat: MoneyChat): number {
  return chat.rig.host.chat(chat.chatId).messages.length;
}

async function send(chat: MoneyChat, body: ActionBody, text?: string) {
  const reply = await chat.rig.send({ ...actionRequest(chat.chatId, body), ...(text ? { text } : {}) });
  await chat.rig.rt.push.settle();
  return reply;
}

/** The head's state, what the next turn acts on. */
async function head(chat: MoneyChat): Promise<Readonly<WorldState>> {
  const at = await chatHead(chat.rig.rt, chat.chatId, chat.rig.host.userId);
  if (!at) throw new Error("no head");
  return at.state;
}

/** A tap with no words, done at once: no message, no generation, the clock where it was. Its Undo chip. */
async function atOnce(chat: MoneyChat, body: ActionBody): Promise<string> {
  const count = messages(chat);
  const clock = (await chat.state()).hud?.clock;
  const done = chat.rig.body(await send(chat, body));
  expect(done).toEqual({ applied: true, pending: false, undo: expect.stringMatching(/^fix:/) });
  expect(messages(chat)).toBe(count);
  expect(chat.rig.host.restarts).toEqual([]);
  expect((await chat.state()).hud?.clock).toEqual(clock);
  return String(done.undo);
}

async function undo(chat: MoneyChat, chip: string): Promise<void> {
  chat.rig.body(await chat.rig.send({ type: "lre.chip", chatId: chat.chatId, chip, choice: "undo" }));
  await chat.rig.rt.push.settle();
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
    expect(chat.rig.body(reply)).toEqual({ applied: true, pending: false, undo: expect.stringMatching(/^fix:/) });
    expect(messages(chat)).toBe(count);
    expect(chat.rig.host.restarts).toEqual([]);
    const after = await chat.hub();
    expect(after.investments?.holdings.find((h) => h.id === LKFR)?.qty).toBe((held ?? 0) + 5);
    expect(account(after, CHECKING).cents).toBe(account(before, CHECKING).cents - 5 * 4200);
    expect((await chat.state()).hud?.clock).toEqual(clock);
    // Its Undo comes as a correction's does, and takes it back; its chip names the trade, never a correction.
    const undo = (await chat.state()).chips.find((c) => c.kind === "fix");
    if (!undo) throw new Error("no Undo");
    expect(undo.label).toContain("Buy or sell investments");
    expect(undo.label).not.toContain("Corrected");
    const edits = chat.rig.body(await chat.rig.send({ type: "lre.gm", chatId: chat.chatId })).edits;
    expect(edits).toEqual([expect.objectContaining({ by: expect.stringContaining("Buy or sell investments") })]);
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

  test("a withdrawal is done at once off screen where the chat's cash rule lets it; with words, or Send now, it is a turn", async () => {
    const chat = await MoneyChat.start();
    // This chat's own cash rule: no machine needed (GM → This chat → Money), one GM edit.
    expect(chat.rig.body(await chat.edit([{ op: "effect", effect: "economy.cash_rule", args: { atm: false } }]))).toHaveProperty("pending", false);
    expect((await chat.state()).controls?.cash?.chat).toBe(false);
    const before = await chat.hub();
    const clock = (await chat.state()).hud?.clock;
    const count = messages(chat);
    const withdraw: ActionBody = { action: "withdraw_cash", params: { account: CHECKING, amount: 2000 } };
    expect(chat.rig.body(await send(chat, withdraw))).toEqual({ applied: true, pending: false, undo: expect.stringMatching(/^fix:/) });
    expect(messages(chat)).toBe(count);
    expect(chat.rig.host.restarts).toEqual([]);
    expect((await chat.state()).hud?.clock).toEqual(clock);
    expect(account(await chat.hub(), CHECKING).cents).toBe(account(before, CHECKING).cents - 2000);
    // Your own accounts aren't told by default: its chip offers Tell, and Undo takes it back.
    const undo = (await chat.state()).chips.find((c) => c.kind === "fix" && c.label.includes("Withdraw cash"));
    if (!undo) throw new Error("no Undo");
    expect(undo.actions.map((a) => a.id)).toEqual(["tell", "undo"]);
    chat.rig.body(await chat.rig.send({ type: "lre.chip", chatId: chat.chatId, chip: undo.id, choice: "undo" }));
    expect(account(await chat.hub(), CHECKING).cents).toBe(account(before, CHECKING).cents);
    expect(chat.rig.body(await send(chat, withdraw, "I hit the cash machine."))).toHaveProperty("messageId");
    expect(messages(chat)).toBe(count + 1);
    expect(chat.rig.body(await chat.rig.send({ ...actionRequest(chat.chatId, transferAction(CHECKING, SAVINGS, 1000)), now: true }))).toHaveProperty("messageId");
    expect(messages(chat)).toBe(count + 2);
  });

  test("the chat's cash rule comes before the world's, null returns to it, and with none the world's stands", async () => {
    const chat = await MoneyChat.start();
    expect((await chat.state()).controls?.cash?.chat).toBeNull();
    const withdraw: ActionBody = { action: "withdraw_cash", params: { account: CHECKING, amount: 2000 } };
    // The world's rule at the top level: no machine here, so nothing is done.
    expect((await send(chat, withdraw)).type).toBe("lre.error");
    chat.rig.body(await chat.edit([{ op: "effect", effect: "economy.cash_rule", args: { atm: false } }]));
    expect(chat.rig.body(await send(chat, withdraw))).toHaveProperty("applied", true);
    chat.rig.body(await chat.edit([{ op: "effect", effect: "economy.cash_rule", args: { atm: null } }]));
    expect((await chat.state()).controls?.cash?.chat).toBeNull();
    expect((await send(chat, withdraw)).type).toBe("lre.error");
  });
});

describe("money and organization actions done at once, off screen", () => {
  test("Marcus hires Jess and admits Priya at Alder Automotive, each at once, and each Undo takes it back", async () => {
    const chat = await MoneyChat.start({ pov: MARCUS });
    const jobs = async (): Promise<string[]> => Object.values((await head(chat)).entities).flatMap((e) => (e.kind === "job" && e.fields.worker === JESS && e.fields.employer === SHOP ? [String(e.fields.title)] : []));
    const member = async (): Promise<boolean> => ((await head(chat)).entities[PRIYA]?.relations ?? []).some((r) => r.type === "member_of" && r.to === SHOP);
    const hired = await atOnce(chat, { action: "job_hire", params: { business: SHOP, worker: JESS, title: "Receptionist", basis: "hourly", rate: 1700, hours_per_week: 20 } });
    expect(await jobs()).toEqual(["Receptionist"]);
    const admitted = await atOnce(chat, { action: "org_admit", params: { org: SHOP, who: PRIYA } });
    expect(await member()).toBe(true);
    // Staff and members are told by default: the admission's chip offers Don't tell, and Undo; the
    // hire, with the admission after it, keeps its Undo alone, and says why.
    const chips = (await chat.state()).chips.filter((c) => c.kind === "fix");
    expect(chips.map((c) => [c.label.split(":")[0], c.actions.map((a) => a.id)])).toEqual([
      ["Hire", ["undo"]],
      ["Admit a member", ["untell", "undo"]],
    ]);
    expect(chips[0]?.detail).toContain(TELL_FIXED);
    await undo(chat, admitted);
    expect(await member()).toBe(false);
    // The admission undone, the hire is the last thing done again, and its Don't tell is back.
    expect((await chat.state()).chips.filter((c) => c.kind === "fix").map((c) => [c.label.split(":")[0], c.actions.map((a) => a.id)])).toEqual([["Hire", ["untell", "undo"]]]);
    await undo(chat, hired);
    expect(await jobs()).toEqual([]);
  });

  test("Jordan pays $250 as the shop, over the $200 Marcus delegated, asking: the request is made at once, and Undo withdraws it", async () => {
    const chat = await MoneyChat.start();
    chat.rig.body(await chat.edit([{ op: "org", change: { do: "delegate", org: SHOP, to: "pov", powers: ["money.spend"], payment: 20_000, by: MARCUS } }]));
    const asked = await atOnce(chat, { action: "pay", params: { to: PRIYA, amount: 25_000, as: SHOP, ask: true } });
    const asking = await head(chat);
    expect(requestsOf(asking, SHOP)).toEqual([expect.objectContaining({ by: "pov", cents: 25_000, approvers: [MARCUS], status: "asked" })]);
    // Asked, nothing is paid yet: Priya's checking is as it opened.
    expect(asking.accounts.acct_priya_checking).toBe(Number(asking.entities.acct_priya_checking?.fields.opening));
    await undo(chat, asked);
    expect(requestsOf(await head(chat), SHOP)).toEqual([]);
  });

  test("Jordan's issue of shares, short of his 40 %, put to a vote: the motion opens at once with his vote for it, and Undo takes it back", async () => {
    const chat = await MoneyChat.start();
    chat.rig.body(
      await chat.edit([
        { op: "org", change: { do: "found", type: "company", name: "Ellis Mobile Repair", founder: "pov", capital: 50_000, from: CHECKING, units: 1000 } },
        { op: "org", change: { do: "issue", org: EMR, to: DANNY, units: 875, price: 0 } },
        { op: "org", change: { do: "issue", org: EMR, to: PRIYA, units: 625, price: 0 } },
      ]),
    );
    const vote = await atOnce(chat, { action: "shares_issue", params: { business: EMR, to: DANNY, units: 100, price: 0, vote: true } });
    expect(motionsOf(await head(chat), EMR)).toEqual([expect.objectContaining({ by: "pov", status: "open", votes: { pov: expect.objectContaining({ vote: "for" }) } })]);
    await undo(chat, vote);
    expect(motionsOf(await head(chat), EMR)).toEqual([]);
  });

  test("cash handed to someone who isn't there is refused, by card it is done; a buy is staged for the next message", async () => {
    const chat = await MoneyChat.start();
    const count = messages(chat);
    const start = await head(chat);
    expect(placeOfEntity(start, DALE)).not.toBe(placeOfEntity(start, "pov"));
    const cash = await send(chat, { action: "pay", params: { to: DALE, amount: 2000, method: "cash" } });
    expect(cash.type === "lre.error" ? cash.message : cash.type).toBe("Cash goes hand to hand, and Dale Whitcomb isn't here: pay by card or from an account, or type how you hand it over to play it as a turn.");
    expect((await chat.state()).chips.some((c) => c.kind === "fix")).toBe(false);
    // Danny is where Jordan is: cash to him is handed over; Dale is paid from the account.
    expect(placeOfEntity(start, DANNY)).toBe(placeOfEntity(start, "pov"));
    await atOnce(chat, { action: "pay", params: { to: DANNY, amount: 2000, method: "cash" } });
    await atOnce(chat, { action: "pay", params: { to: DALE, amount: 2000, method: "debit" } });
    // `buy` stays in the world: the tap waits for the player's next message.
    expect(chat.rig.body(await send(chat, { action: "buy", params: { item: "coffee" } }))).toEqual({ staged: true });
    expect(messages(chat)).toBe(count);
    expect((await chat.state()).staged).toMatchObject({ action: "buy", params: { item: "coffee" } });
  });
});

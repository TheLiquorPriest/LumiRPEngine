// The money hub's controls end to end (DESIGN §7, §25): each control's request, built as the hub
// builds it, goes over the protocol to the backend on the shipped packs, plays as the player's turn
// or applies as the GM's edit, and the view the hub draws next shows what it did. Port Alder at
// Simulation (Money 4) unless a test sets another level.

import { describe, expect, test } from "bun:test";
import type { AccountView, FinanceView, PayTier } from "../../src/shared/finance";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { BackendToFrontend, EditOp } from "../../src/shared/protocol";
import type { Level } from "../../src/shared/ids";
import { DEFAULT_CURRENCY, type WorldCurrency } from "../../src/shared/world";
import { adjustOp, editRequest, resolveMarker, timelapseRequest } from "../../src/frontend/requests";
import { decodeFinanceView } from "../../src/packs/economy/ui/decode";
import { accountBlocks, accountControls, cardControls, creditBlocks, flowSources, hubTabs, overviewBlocks, paySources, transferTargets } from "../../src/packs/economy/ui/layout";
import {
  accountStatusOps,
  actionRequest,
  amountOf,
  applyCreditAction,
  autopayAction,
  autopayOps,
  blankFlowForm,
  cardAction,
  cashAction,
  closeAccountOps,
  flowCreateAction,
  flowEditOps,
  flowFormOf,
  flowSpawnOps,
  flowStatusAction,
  flowStatusOps,
  flowUpdateAction,
  newIdFor,
  payCardAction,
  payPrefsAction,
  payPrefsOps,
  releaseHoldOps,
  transferAction,
  type ActionBody,
  type FlowForm,
} from "../../src/packs/economy/ui/requests";
import { Rig } from "../support/rig";

const CHECKING = "acct_pov_checking";
const SAVINGS = "acct_pov_savings";
const CARD = "acct_pov_card";
const LOAN = "acct_pov_auto_loan";
const DANNY = "danny_okafor";
const DANNY_CHECKING = "acct_danny_checking";
/** Where the POV starts, and the bank of their checking and savings. */
const HOME = "harbor_street_114";
const BANK = "Lakeshore Credit Union";

/** The GM view's Money tab: everyone's money as it decodes `lre.gm`, and each entity's declared fields (what its ✎ forms edit). */
interface GmMoney {
  money: FinanceView[];
  fields: Map<string, string[]>;
}

/** A Port Alder chat and the hub's two ways in: the player's actions and the GM's edits. */
class MoneyChat {
  private constructor(
    readonly rig: Rig,
    readonly chatId: string,
    readonly currency: WorldCurrency,
  ) {}

  /** Port Alder on the shipped packs; `places` adds fields (a cash machine, a branch) to places before the chat starts. */
  static async start(places: Record<string, JsonObject> = {}): Promise<MoneyChat> {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    if (Object.keys(places).length > 0) {
      const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
      const doc = isRecord(draft.draft) && isRecord(draft.draft.places) ? draft.draft.places : {};
      for (const [id, fields] of Object.entries(places)) {
        const place = doc[id];
        if (!isRecord(place)) throw new Error(`no place ${id}`);
        const value = { ...place, fields: { ...(isRecord(place.fields) ? place.fields : {}), ...fields } };
        rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "places", id, value }));
      }
      rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
    }
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    // Picking Play → Money opens the POV's money (play.tsx), which posts the authored openings.
    rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "economy.money", entity: null }));
    await rig.rt.push.settle();
    return new MoneyChat(rig, chatId, (await rig.rt.view(chatId, rig.host.userId)).currency ?? DEFAULT_CURRENCY);
  }

  /** Play → Money: the POV's money as the panel decodes the view the backend sends. */
  async hub(): Promise<FinanceView> {
    const view = decodeFinanceView((await this.rig.rt.view(this.chatId, this.rig.host.userId)).panels["economy.money"]);
    if (!view) throw new Error("Play → Money can't draw the POV's money");
    return view;
  }

  async gm(): Promise<GmMoney> {
    const body = this.rig.body(await this.rig.send({ type: "lre.gm", chatId: this.chatId }));
    const money = (Array.isArray(body.money) ? body.money : []).map((raw) => {
      const view = decodeFinanceView(raw);
      if (!view) throw new Error("the GM view's Money can't draw a party");
      return view;
    });
    const fields = new Map<string, string[]>();
    for (const e of Array.isArray(body.entities) ? body.entities : []) {
      if (isRecord(e) && typeof e.id === "string") fields.set(e.id, Array.isArray(e.fields) ? e.fields.flatMap((f) => (isRecord(f) && typeof f.id === "string" ? [f.id] : [])) : []);
    }
    return { money, fields };
  }

  /** One party's money in the GM view. */
  async party(id: string): Promise<FinanceView> {
    const view = (await this.gm()).money.find((m) => m.party === id);
    if (!view) throw new Error(`the GM view has no money for ${id}`);
    return view;
  }

  /** A player control: its action sent as the hub sends it, then the turn it plays as. Returns the turn's outcome lines. */
  async play(body: ActionBody): Promise<string> {
    this.rig.body(await this.rig.send(actionRequest(this.chatId, body)));
    await this.rig.host.settle();
    const generation = await this.rig.host.start(this.chatId, { type: "normal" });
    const outcome = this.rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outcome]"))?.content ?? "";
    await this.rig.host.finish(generation, "Done.");
    await this.rig.rt.push.settle();
    return outcome;
  }

  /** A GM control: its operations as one edit. Returns the reply, a refusal included. */
  async edit(ops: EditOp[]): Promise<BackendToFrontend> {
    const reply = await this.rig.send(editRequest(this.chatId, ops));
    await this.rig.rt.push.settle();
    return reply;
  }

  /** Time passing, as the palette's Timelapse sends it. */
  async timelapse(minutes: number): Promise<void> {
    const timelapse = (await this.rig.rt.view(this.chatId, this.rig.host.userId)).palette?.timelapse;
    if (!timelapse) throw new Error("no Timelapse");
    this.rig.body(await this.rig.send(timelapseRequest(timelapse, { type: "duration", minutes }, {}, this.chatId)));
    await this.rig.host.settle();
    const generation = await this.rig.host.start(this.chatId, { type: "normal" });
    await this.rig.host.finish(generation, "Time passes.");
    await this.rig.rt.push.settle();
  }

  /** The POV's Money level, as Play → Realism sets it. */
  async level(to: Level): Promise<void> {
    this.rig.body(await this.rig.send(resolveMarker(this.chatId, "money", { entity: "pov" }, to)));
  }

  /** An amount as typed into a control. */
  cents(text: string): number {
    const cents = amountOf(text, this.currency);
    if (cents === null) throw new Error(`${text} isn't an amount`);
    return cents;
  }
}

function account(view: FinanceView, id: string): AccountView {
  const a = view.accounts.find((x) => x.id === id);
  if (!a) throw new Error(`no ${id} in ${view.name}'s money`);
  return a;
}

/** What a refused edit says. */
function refusal(reply: BackendToFrontend): string {
  if (reply.type !== "lre.error") throw new Error(`the edit wasn't refused (${reply.type})`);
  return reply.message;
}

function accepted(reply: BackendToFrontend): void {
  if (reply.type === "lre.error") throw new Error(`the edit was refused: ${reply.message}`);
  expect(reply.type).toBe("lre.result");
}

/** A $40 gym membership on the 5th of each month, from `from`, as the flow form fills it in. */
function gymForm(from: string): FlowForm {
  return { ...blankFlowForm(from), label: "Harbor Gym", kind: "subscription", to: "Harbor Gym", amount: "40", every: "month", day: 5 };
}

describe("Play → Money: each control plays as the player's turn", () => {
  test("Transfer moves money between the POV's own accounts; one the account can't cover moves nothing", async () => {
    const chat = await MoneyChat.start();
    const before = await chat.hub();
    const checking = account(before, CHECKING);
    expect(accountControls(before, checking)).toContain("transfer");
    expect(transferTargets(before, CHECKING).map((a) => a.id)).toContain(SAVINGS);
    expect(await chat.play(transferAction(CHECKING, SAVINGS, chat.cents("100")))).toContain("done");
    const after = await chat.hub();
    expect(account(after, CHECKING).cents).toBe(checking.cents - 10000);
    expect(account(after, SAVINGS).cents).toBe(account(before, SAVINGS).cents + 10000);
    expect(account(after, SAVINGS).transactions[0]?.cents).toBe(10000);
    const room = account(after, CHECKING).available ?? 0;
    expect(await chat.play(transferAction(CHECKING, SAVINGS, room + 1))).toContain("didn't");
    expect((await chat.hub()).accounts.map((a) => [a.id, a.cents])).toEqual(after.accounts.map((a) => [a.id, a.cents]));
  });

  test("Pay pays a card or a loan from the account picked: the amount typed, or with none the whole balance", async () => {
    const chat = await MoneyChat.start();
    const before = await chat.hub();
    const card = account(before, CARD);
    expect(accountControls(before, card)).toContain("pay");
    expect(paySources(before).map((a) => a.id)).toContain(CHECKING);
    await chat.play(payCardAction(CARD, CHECKING, chat.cents("200")));
    let view = await chat.hub();
    expect(account(view, CARD).cents).toBe(card.cents + 20000);
    expect(account(view, CHECKING).cents).toBe(account(before, CHECKING).cents - 20000);
    await chat.play(payCardAction(CARD, CHECKING, null));
    view = await chat.hub();
    expect(account(view, CARD).cents).toBe(0);
    expect(account(view, CHECKING).cents).toBe(account(before, CHECKING).cents + card.cents);
    expect(accountControls(view, account(view, CARD))).not.toContain("pay");
    await chat.play(payCardAction(LOAN, CHECKING, chat.cents("300")));
    expect(account(await chat.hub(), LOAN).cents).toBe(account(before, LOAN).cents + 30000);
  });

  test("Autopay sets what a card pays itself and from where: the statement, a fixed amount, or nothing", async () => {
    const chat = await MoneyChat.start();
    const before = await chat.hub();
    expect(account(before, CARD).autopay).toEqual({ mode: "minimum", from: CHECKING, fromName: "Your checking account", cents: null });
    expect(accountControls(before, account(before, CARD))).toContain("autopay");
    await chat.play(autopayAction(CARD, "statement", SAVINGS, null));
    expect(account(await chat.hub(), CARD).autopay).toMatchObject({ mode: "statement", from: SAVINGS, fromName: "Your savings account" });
    await chat.play(autopayAction(CARD, "fixed", CHECKING, chat.cents("150")));
    expect(account(await chat.hub(), CARD).autopay).toEqual({ mode: "fixed", from: CHECKING, fromName: "Your checking account", cents: 15000 });
    await chat.play(autopayAction(CARD, "none", null, null));
    expect(account(await chat.hub(), CARD).autopay?.mode).toBe("none");
  });

  test("at the top level cash moves at a branch of the account's bank; with no machine or branch the turn says so and nothing moves", async () => {
    const nowhere = await MoneyChat.start();
    const start = await nowhere.hub();
    expect(accountControls(start, account(start, CHECKING))).toEqual(expect.arrayContaining(["withdraw", "deposit"]));
    expect(await nowhere.play(cashAction("withdraw", CHECKING, nowhere.cents("20")))).toContain(`no cash machine or ${BANK} branch here`);
    const unmoved = await nowhere.hub();
    expect(unmoved.cash).toEqual(start.cash);
    expect(account(unmoved, CHECKING).cents).toBe(account(start, CHECKING).cents);

    const branch = await MoneyChat.start({ [HOME]: { branch: { bank: BANK } } });
    const before = await branch.hub();
    await branch.play(cashAction("withdraw", CHECKING, branch.cents("20")));
    const out = await branch.hub();
    expect(out.cash).toEqual({ cents: (before.cash && "cents" in before.cash ? before.cash.cents : 0) + 2000 });
    expect(account(out, CHECKING).cents).toBe(account(before, CHECKING).cents - 2000);
    await branch.play(cashAction("deposit", CHECKING, branch.cents("10")));
    const back = await branch.hub();
    expect(account(back, CHECKING).cents).toBe(account(before, CHECKING).cents - 1000);
    expect(account(back, CHECKING).holds).toEqual([]);
  });

  test("at the bank's deposit machine a cash deposit is held; a withdrawal there needs a card on the account", async () => {
    const chat = await MoneyChat.start({ [HOME]: { atm: { bank: BANK, deposits: true } } });
    const before = await chat.hub();
    await chat.play(cashAction("deposit", CHECKING, chat.cents("20")));
    const after = await chat.hub();
    const checking = account(after, CHECKING);
    expect(checking.cents).toBe(account(before, CHECKING).cents + 2000);
    expect(checking.available).toBe(checking.cents - 2000);
    expect(checking.holds).toEqual([expect.objectContaining({ cents: 2000, kind: "deposit" })]);
    expect(accountBlocks(after, checking).holds).toBe(true);
    expect(await chat.play(cashAction("withdraw", CHECKING, chat.cents("20")))).toContain("has no card for a cash machine");
  });

  test("below the top level cash moves without a machine", async () => {
    const chat = await MoneyChat.start();
    await chat.level(3);
    const before = await chat.hub();
    expect(before.level).toBe(3);
    await chat.play(cashAction("withdraw", CHECKING, chat.cents("20")));
    const after = await chat.hub();
    expect(after.cash).toEqual({ cents: (before.cash && "cents" in before.cash ? before.cash.cents : 0) + 2000 });
    expect(account(after, CHECKING).cents).toBe(account(before, CHECKING).cents - 2000);
  });

  test("Apply for credit opens the card offered at the limit asked, with its card, and the report shows the inquiry", async () => {
    const chat = await MoneyChat.start();
    const before = await chat.hub();
    const offer = before.credit?.offers.find((o) => o.class === "credit_card");
    if (!offer) throw new Error("no card on offer");
    expect(offer.limit ?? 0).toBeGreaterThan(200000);
    expect(await chat.play(applyCreditAction(offer.product, chat.cents("2000")))).toContain("done");
    const after = await chat.hub();
    const opened = after.accounts.find((a) => a.class === "credit_card" && a.id !== CARD);
    expect(opened).toMatchObject({ limit: 200000, cents: 0, status: "open" });
    expect(opened?.cards.map((c) => [c.network, c.state])).toEqual([["credit", "active"]]);
    expect(after.credit?.inquiries.length).toBe((before.credit?.inquiries.length ?? 0) + 1);
  });

  test("a card freezes, unfreezes, is reported lost and is replaced, each control offered only when its state allows it", async () => {
    const chat = await MoneyChat.start();
    await chat.play(applyCreditAction("credit_card", chat.cents("2000")));
    const cardOf = async (id: string) => {
      const view = await chat.hub();
      const card = view.cards.find((c) => c.id === id);
      if (!card) throw new Error(`no card ${id}`);
      return { view, card };
    };
    const first = (await chat.hub()).cards.find((c) => c.account !== CARD);
    if (!first) throw new Error("no new card");
    expect(cardControls(await chat.hub(), first)).toEqual(["freeze", "lost", "replace"]);
    await chat.play(cardAction(first.id, "freeze"));
    let { view, card } = await cardOf(first.id);
    expect(card.state).toBe("frozen");
    expect(cardControls(view, card)).toEqual(["unfreeze", "lost", "replace"]);
    expect(view.overview?.alerts).toContainEqual(expect.objectContaining({ tone: "warn", text: `${card.name} is frozen.` }));
    await chat.play(cardAction(first.id, "unfreeze"));
    expect((await cardOf(first.id)).card.state).toBe("active");
    await chat.play(cardAction(first.id, "lost"));
    ({ view, card } = await cardOf(first.id));
    expect(card.state).toBe("lost");
    expect(cardControls(view, card)).toEqual(["replace"]);
    await chat.play(cardAction(first.id, "replace"));
    ({ view, card } = await cardOf(first.id));
    expect(card.state).toBe("cancelled");
    expect(cardControls(view, card)).toEqual([]);
    const replacement = view.cards.find((c) => c.account === first.account && c.id !== first.id);
    expect(replacement).toMatchObject({ state: "active", network: "credit" });
    expect(replacement?.last4 ?? "").toMatch(/^\d{4}$/);
  });

  test("How I pay sets the POV's payment tiers, and a purchase then pays by them", async () => {
    const chat = await MoneyChat.start();
    await chat.play(applyCreditAction("credit_card", chat.cents("2000")));
    const card = (await chat.hub()).cards.find((c) => c.account !== CARD);
    if (!card) throw new Error("no new card");
    const tiers: PayTier[] = [{ use: card.id, max: chat.cents("50") }];
    expect(await chat.play(payPrefsAction(tiers))).toContain("done");
    const set = await chat.hub();
    expect(set.payPrefs).toEqual(tiers);
    // A coffee goes on the new card, not the wallet cash the default tiers try first.
    await chat.play({ action: "buy", params: { item: "coffee", price: chat.cents("3") } });
    const after = await chat.hub();
    expect(after.cash).toEqual(set.cash);
    expect(account(after, card.account).cents).toBeLessThan(0);
  });

  test("a standing payment is set up, changed, paused, resumed and cancelled; a one-off pays when its time comes", async () => {
    const chat = await MoneyChat.start();
    const before = await chat.hub();
    expect(flowSources(before).map((s) => s.id)).toContain(CHECKING);
    await chat.play(flowCreateAction(gymForm(CHECKING), chat.currency));
    let view = await chat.hub();
    const gym = view.flows.find((f) => f.label === "Harbor Gym");
    if (!gym) throw new Error("no Harbor Gym flow");
    expect(gym).toMatchObject({ kind: "subscription", from: "Your checking account", to: "Harbor Gym", amount: "$40.00", schedule: "monthly on the 5th", status: "active", editable: true, source: "entity" });
    expect(view.overview?.upcoming).toContainEqual(expect.objectContaining({ label: "Harbor Gym", cents: -4000, flow: gym.id }));

    const change = flowUpdateAction(gym.spec, { ...flowFormOf(gym.spec, chat.currency), amount: "45", every: "week", weekday: 5 }, chat.currency);
    // Only what changed travels, the schedule whole.
    expect(change?.params).toEqual({ flow: gym.id, every: "week", amount: 4500, weekday: 5 });
    if (!change) throw new Error("no change");
    await chat.play(change);
    view = await chat.hub();
    expect(view.flows.find((f) => f.id === gym.id)).toMatchObject({ amount: "$45.00", schedule: "every Fri", next: "Fri 18 Sep 2026, 09:00" });

    await chat.play(flowStatusAction(gym.id, "pause"));
    view = await chat.hub();
    expect(view.flows.find((f) => f.id === gym.id)).toMatchObject({ status: "paused", next: null });
    expect(view.overview?.upcoming.some((u) => u.flow === gym.id)).toBe(false);
    await chat.play(flowStatusAction(gym.id, "resume"));
    expect((await chat.hub()).flows.find((f) => f.id === gym.id)).toMatchObject({ status: "active", next: "Fri 18 Sep 2026, 09:00" });
    await chat.play(flowStatusAction(gym.id, "delete"));
    expect((await chat.hub()).flows.some((f) => f.id === gym.id)).toBe(false);

    const dentist: FlowForm = { ...blankFlowForm(CHECKING), label: "Dentist", kind: "bill", to: "Lakeshore Dental", amount: "120", every: "once", start: "2026-09-14", at: "07:30" };
    await chat.play(flowCreateAction(dentist, chat.currency));
    const due = await chat.hub();
    expect(due.flows.find((f) => f.label === "Dentist")).toMatchObject({ schedule: "once, 2026-09-14 07:30", next: "Mon 14 Sep 2026, 07:30" });
    await chat.timelapse(120);
    const paid = await chat.hub();
    expect(account(paid, CHECKING).transactions).toContainEqual(expect.objectContaining({ memo: "Dentist", cents: -12000 }));
    expect(account(paid, CHECKING).cents).toBe(account(due, CHECKING).cents - 12000);
    expect(paid.flows.find((f) => f.label === "Dentist")).toMatchObject({ done: 1, next: null, status: "ended" });
  });
});

describe("GM view → Money: each control is one edit", () => {
  test("Add money and Take money on anyone's account; the player's Money never shows another's books", async () => {
    const chat = await MoneyChat.start();
    const danny = account(await chat.party(DANNY), DANNY_CHECKING);
    const add = adjustOp(DANNY_CHECKING, "25", chat.currency, false);
    const take = adjustOp(DANNY_CHECKING, "10", chat.currency, true);
    if (!add || !take) throw new Error("no amounts");
    accepted(await chat.edit([add]));
    expect(account(await chat.party(DANNY), DANNY_CHECKING).cents).toBe(danny.cents + 2500);
    accepted(await chat.edit([take]));
    expect(account(await chat.party(DANNY), DANNY_CHECKING).cents).toBe(danny.cents + 1500);
    const mine = await chat.hub();
    expect(mine.accounts.some((a) => a.id === DANNY_CHECKING)).toBe(false);
    expect(mine.flows.some((f) => f.spec.from === DANNY_CHECKING)).toBe(false);
  });

  test("an account's declared fields, its status and closing it; what the backend won't do it says", async () => {
    const chat = await MoneyChat.start();
    expect((await chat.gm()).fields.get(CARD)).toEqual(expect.arrayContaining(["limit", "apr_pct", "autopay", "autopay_from", "status"]));
    // The ✎ on a field sends one set, as the GM view's entity form does.
    accepted(await chat.edit([{ op: "set", entity: CARD, field: "limit", value: chat.cents("5000") }]));
    const card = account(await chat.hub(), CARD);
    expect(card).toMatchObject({ limit: 500000, available: 500000 + card.cents });

    accepted(await chat.edit(accountStatusOps(SAVINGS, "frozen")));
    let mine = await chat.hub();
    expect(account(mine, SAVINGS).status).toBe("frozen");
    expect(accountControls(mine, account(mine, SAVINGS))).toEqual([]);
    expect(mine.overview?.alerts).toContainEqual(expect.objectContaining({ tone: "neg", text: "Your savings account is frozen.", account: SAVINGS }));
    expect(refusal(await chat.edit(accountStatusOps(SAVINGS, "bogus")))).toContain("an account can't be bogus");
    accepted(await chat.edit(accountStatusOps(SAVINGS, "open")));

    const savings = account(await chat.party("pov"), SAVINGS);
    expect(refusal(await chat.edit(closeAccountOps(SAVINGS)))).toContain("still has $3,260.00 on it");
    const empty = adjustOp(SAVINGS, String(savings.cents / 100), chat.currency, true);
    if (!empty) throw new Error("no amount");
    accepted(await chat.edit([empty]));
    accepted(await chat.edit(closeAccountOps(SAVINGS)));
    mine = await chat.hub();
    expect(account(mine, SAVINGS)).toMatchObject({ status: "closed", cents: 0 });
    expect(accountControls(mine, account(mine, SAVINGS))).toEqual([]);
    expect(account(await chat.party("pov"), SAVINGS).status).toBe("closed");
  });

  test("Release lets a held deposit go before it lapses", async () => {
    const chat = await MoneyChat.start({ [HOME]: { atm: { bank: BANK, deposits: true } } });
    await chat.play(cashAction("deposit", CHECKING, chat.cents("20")));
    const held = account(await chat.party("pov"), CHECKING);
    const hold = held.holds[0];
    if (!hold) throw new Error("no hold");
    accepted(await chat.edit(releaseHoldOps(CHECKING, hold.id)));
    const released = account(await chat.hub(), CHECKING);
    expect(released.holds).toEqual([]);
    expect(released.available).toBe((held.available ?? 0) + 2000);
  });

  test("the GM's autopay sets the account's own fields, and the loan's autopay pays that way", async () => {
    const chat = await MoneyChat.start();
    const loan = account(await chat.party("pov"), LOAN);
    const ops = autopayOps(LOAN, loan.autopay, "fixed", SAVINGS, chat.cents("500"));
    expect(ops.map((op) => (op.op === "set" ? op.field : op.op))).toEqual(["autopay", "autopay_from", "autopay_cents"]);
    accepted(await chat.edit(ops));
    const mine = await chat.hub();
    expect(account(mine, LOAN).autopay).toEqual({ mode: "fixed", from: SAVINGS, fromName: "Your savings account", cents: 50000 });
    expect(mine.flows.find((f) => f.id === `autopay:${LOAN}`)).toMatchObject({ from: "Your savings account", amount: "$500.00", editable: false, source: "autopay" });
  });

  test("a card's state is one of its fields", async () => {
    const chat = await MoneyChat.start();
    await chat.play(applyCreditAction("credit_card", chat.cents("2000")));
    const card = (await chat.hub()).cards.find((c) => c.account !== CARD);
    if (!card) throw new Error("no new card");
    expect((await chat.gm()).fields.get(card.id)).toEqual(expect.arrayContaining(["state", "holder", "account"]));
    accepted(await chat.edit([{ op: "set", entity: card.id, field: "state", value: "frozen" }]));
    const view = await chat.hub();
    const frozen = view.cards.find((c) => c.id === card.id);
    expect(frozen?.state).toBe("frozen");
    if (frozen) expect(cardControls(view, frozen)).toEqual(["unfreeze", "lost", "replace"]);
  });

  test("the GM adds a flow to anyone, changes it, pauses it and removes it; one paid from the POV's account shows on their Money", async () => {
    const chat = await MoneyChat.start();
    const ids = new Set((await chat.gm()).fields.keys());
    const id = newIdFor("flow", "Harbor Gym", ids);
    accepted(await chat.edit(flowSpawnOps(id, gymForm(DANNY_CHECKING), chat.currency)));
    let danny = await chat.party(DANNY);
    const gym = danny.flows.find((f) => f.id === id);
    if (!gym) throw new Error("no Harbor Gym flow");
    expect(gym).toMatchObject({ label: "Harbor Gym", from: "Danny's checking", amount: "$40.00", schedule: "monthly on the 5th", status: "active", source: "entity" });
    expect((await chat.hub()).flows.some((f) => f.id === id)).toBe(false);

    const ops = flowEditOps(gym.spec, { ...flowFormOf(gym.spec, chat.currency), amount: "45", every: "week", weekday: 1 }, chat.currency);
    // A monthly flow turned weekly sheds its day of the month.
    expect(ops).toContainEqual({ op: "set", entity: id, field: "days", value: [] });
    accepted(await chat.edit(ops));
    danny = await chat.party(DANNY);
    expect(danny.flows.find((f) => f.id === id)).toMatchObject({ amount: "$45.00", schedule: "every Mon" });
    accepted(await chat.edit(flowStatusOps(id, "paused")));
    expect((await chat.party(DANNY)).flows.find((f) => f.id === id)).toMatchObject({ status: "paused", next: null });
    accepted(await chat.edit([{ op: "despawn", entity: id }]));
    expect((await chat.party(DANNY)).flows.some((f) => f.id === id)).toBe(false);

    const mineId = newIdFor("flow", "Harbor Gym", new Set((await chat.gm()).fields.keys()));
    accepted(await chat.edit(flowSpawnOps(mineId, gymForm(CHECKING), chat.currency)));
    expect((await chat.hub()).flows.find((f) => f.id === mineId)).toMatchObject({ from: "Your checking account", amount: "$40.00", editable: true });
  });

  test("the GM adds someone to a household and takes them out; the POV's Money shows who shares their home", async () => {
    const chat = await MoneyChat.start();
    accepted(await chat.edit([{ op: "spawn", kind: "household", name: "Unit 2B", id: "unit_2b" }, { op: "link", rel: "member_of", from: "pov", to: "unit_2b" }]));
    let mine = await chat.hub();
    expect(hubTabs(mine).map((t) => t.id)).toContain("household");
    expect(mine.household?.members.map((m) => m.id)).toEqual(["pov"]);
    // As the household's Add a member and its ✕ send them.
    accepted(await chat.edit([{ op: "link", rel: "member_of", from: DANNY, to: "unit_2b" }]));
    mine = await chat.hub();
    expect(mine.household?.members.map((m) => m.id).sort()).toEqual([DANNY, "pov"]);
    expect((await chat.party("unit_2b")).partyKind).toBe("household");
    accepted(await chat.edit([{ op: "unlink", rel: "member_of", from: DANNY, to: "unit_2b" }]));
    expect((await chat.hub()).household?.members.map((m) => m.id)).toEqual(["pov"]);
  });

  test("the GM sets anyone's payment preferences", async () => {
    const chat = await MoneyChat.start();
    const tiers: PayTier[] = [{ use: "cash", max: chat.cents("20") }, { use: "debit" }];
    accepted(await chat.edit(payPrefsOps(DANNY, tiers)));
    expect((await chat.party(DANNY)).payPrefs).toEqual(tiers);
  });

  test("a player's effect isn't a GM control", async () => {
    const chat = await MoneyChat.start();
    expect(refusal(await chat.edit([{ op: "effect", effect: "economy.withdraw", args: { account: CHECKING, cents: 100 } }]))).toContain("economy withdraw isn't something the GM view can run");
  });

  test("an NPC's declined bill is a GM note; the player's Money carries no notes and none of it", async () => {
    const chat = await MoneyChat.start();
    // A one-off bigger than all Danny has, due at 08:00: it declines.
    const boat: FlowForm = { ...blankFlowForm(DANNY_CHECKING), label: "Boat repair", kind: "bill", to: "Alder Harbor Marina", amount: "5000", every: "once", start: "2026-09-14", at: "08:00" };
    accepted(await chat.edit(flowSpawnOps(newIdFor("flow", boat.label, new Set((await chat.gm()).fields.keys())), boat, chat.currency)));
    await chat.timelapse(180);
    const notes = (await chat.party(DANNY)).notes;
    expect(notes.length).toBeGreaterThan(0);
    const mine = await chat.hub();
    expect(mine.notes).toEqual([]);
    const shown = JSON.stringify(mine);
    for (const n of notes) expect(shown).not.toContain(n.text);
  });
});

describe("the hub shows what each Money level shows", () => {
  test("the POV at Money 4, 3, 2 and 1: credit and the full books, then every account and flow, then cash and one account, then a band", async () => {
    const chat = await MoneyChat.start();
    const top = await chat.hub();
    expect(top.level).toBe(4);
    expect(hubTabs(top).map((t) => t.id)).toEqual(expect.arrayContaining(["overview", "accounts", "flows", "credit"]));
    expect(account(top, CARD).aprPct).toBe(22);
    expect(accountBlocks(top, account(top, CARD)).terms).toBe(true);
    expect(overviewBlocks(top)).toMatchObject({ cashFlowAhead: true, upcoming: 20 });
    expect(creditBlocks(top)).toEqual({ factors: true, report: true, history: 12 });

    await chat.level(3);
    const three = await chat.hub();
    expect(three.level).toBe(3);
    const threeTabs = hubTabs(three).map((t) => t.id);
    expect(threeTabs).toContain("flows");
    expect(threeTabs).not.toContain("credit");
    expect(three.accounts.map((a) => a.id).sort()).toEqual(top.accounts.map((a) => a.id).sort());
    expect(account(three, CARD).aprPct).toBeNull();
    expect(accountBlocks(three, account(three, CARD)).terms).toBe(false);
    expect(overviewBlocks(three)).toMatchObject({ cashFlowAhead: false, upcoming: 5 });
    expect(accountControls(three, account(three, CARD))).toEqual(["pay", "autopay"]);
    expect(three.flows.length).toBeGreaterThan(0);

    await chat.level(2);
    const two = await chat.hub();
    expect(two.accounts.map((a) => a.id).sort()).toEqual(["acct_pov_cash", CHECKING]);
    const twoTabs = hubTabs(two).map((t) => t.id);
    expect(twoTabs).toContain("accounts");
    expect(twoTabs).not.toContain("flows");
    expect(two.flows).toEqual([]);
    expect(accountControls(two, account(two, CHECKING))).toEqual(["withdraw", "deposit"]);
    expect(account(two, CHECKING).autopay).toBeNull();

    await chat.level(1);
    const one = await chat.hub();
    expect(one.accounts).toEqual([]);
    expect(one.cash).toEqual({ band: one.band ?? "" });
    expect(hubTabs(one).map((t) => t.id)).toEqual(["overview"]);
  });

  test("the GM view draws every party with money at their own level, the POV first", async () => {
    const chat = await MoneyChat.start();
    const { money } = await chat.gm();
    expect(money[0]?.party).toBe("pov");
    expect(new Set(money.map((m) => m.party)).size).toBe(money.length);
    const sam = money.find((m) => m.party === "sam_reyes");
    const helen = money.find((m) => m.party === "helen_kowalczyk");
    const danny = money.find((m) => m.party === DANNY);
    expect(sam?.level).toBe(2);
    expect(sam?.flows).toEqual([]);
    expect(sam ? hubTabs(sam).map((t) => t.id) : []).not.toContain("flows");
    expect(helen?.level).toBe(3);
    expect(helen?.flows.length).toBeGreaterThan(0);
    expect(helen?.credit).toBeNull();
    expect(danny?.level).toBe(4);
    expect(danny?.credit).not.toBeNull();
  });
});

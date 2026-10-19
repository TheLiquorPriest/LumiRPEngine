// The POV's money before anything opens its accounts: a fresh chat shows the authored opening
// balances in the HUD and on Money (their representation, DESIGN §9.2), and what each account has
// available from them; opening Money posts exactly those amounts, and the update the client
// receives after the write carries them. A cash fix made before then is measured from the opening
// balances, not from nothing.

import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../src/shared/world";
import type { StateView } from "../../src/shared/state-view";
import { STARTER_WORLDS } from "../../src/packs/index";
import { applyDelta } from "../../src/frontend/delta";
import { decodeFinanceView } from "../../src/packs/economy/ui/decode";
import { toChain } from "../../src/backend/ledger-io";
import { Rig } from "../support/rig";

const authored = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("pa", "Port Alder");
const openingOf = (account: string): number => Number(authored.entities[account]?.fields.opening);

async function freshChat() {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.hello", chatId }));
  return { rig, chatId };
}

/** The view the client holds: the last snapshot with every later delta applied. */
function clientView(rig: Rig, chatId: string): StateView {
  let view: unknown = null;
  for (const m of rig.host.sent) {
    if (m.type === "lre.state.snapshot" && m.chatId === chatId) view = m.view;
    else if (m.type === "lre.state.delta" && m.chatId === chatId && view !== null) view = applyDelta(view, m.ops);
  }
  if (view === null) throw new Error("no snapshot");
  return view as StateView;
}

/** What Money shows of the POV's money: its level, cash and each account's amount and what's available, and whether the accounts have opened. */
function money(view: StateView) {
  const m = decodeFinanceView(view.panels["economy.money"]);
  if (!m) throw new Error("no Money panel");
  return { opened: m.opened, amounts: { level: m.level, cash: m.cash, accounts: m.accounts.map((a) => ({ id: a.id, cents: a.cents, available: a.available })) } };
}

async function posted(rig: Rig, chatId: string): Promise<Record<string, number>> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return { ...state.accounts };
}

describe("the POV's money before its accounts open", () => {
  test("a fresh Port Alder chat shows the authored cash and balances; opening Money posts the same amounts", async () => {
    const { rig, chatId } = await freshChat();
    const before = clientView(rig, chatId);
    const cash = openingOf("acct_pov_cash");
    expect(cash).toBeGreaterThan(0);
    expect(before.hud?.cash).toEqual({ cents: cash });
    const { opened, amounts: shown } = money(before);
    expect(opened).toBe(false);
    expect(shown.level).toBe(4);
    expect(shown.cash).toEqual({ cents: cash });
    for (const id of ["acct_pov_checking", "acct_pov_savings", "acct_pov_card", "acct_pov_auto_loan"]) expect(shown.accounts.find((a) => a.id === id)?.cents).toBe(openingOf(id));
    // What's available is counted from the openings too: a card has its limit less what it owes.
    expect(shown.accounts.find((a) => a.id === "acct_pov_card")?.available).toBe(Number(authored.entities.acct_pov_card?.fields.limit) + openingOf("acct_pov_card"));
    expect(shown.accounts.find((a) => a.id === "acct_pov_savings")?.available).toBe(openingOf("acct_pov_savings"));
    // Nothing is posted yet: the amounts are the representation.
    expect((await posted(rig, chatId)).acct_pov_cash ?? 0).toBe(0);

    expect(rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "economy.money", entity: null }))).toEqual({ materialized: true, pending: false });
    await rig.rt.push.settle();
    const books = await posted(rig, chatId);
    expect(books.acct_pov_cash).toBe(cash);
    const after = clientView(rig, chatId);
    expect(after.hud?.cash).toEqual({ cents: cash });
    expect(money(after)).toEqual({ opened: true, amounts: shown });
    expect(money(await rig.rt.view(chatId, rig.host.userId))).toEqual({ opened: true, amounts: shown });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("while a reply runs, the opening balances stay showing; they post by the time it finishes", async () => {
    const { rig, chatId } = await freshChat();
    const shown = money(clientView(rig, chatId)).amounts;
    rig.host.sendUser(chatId, "I check my wallet.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    // The turn in flight may already plan the opening (then there's nothing to hold); either way the
    // client keeps showing the opening balances until the reply finishes.
    rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "economy.money", entity: null }));
    await rig.rt.push.settle();
    expect(clientView(rig, chatId).hud?.cash).toEqual({ cents: openingOf("acct_pov_cash") });
    await rig.host.finish(g, "Eighty-five dollars, give or take.");
    await rig.rt.push.settle();
    expect((await posted(rig, chatId)).acct_pov_cash).toBe(openingOf("acct_pov_cash"));
    expect(money(clientView(rig, chatId)).amounts.cash).toEqual(shown.cash);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a cash fix before the accounts open makes cash the amount typed", async () => {
    const { rig, chatId } = await freshChat();
    const target = openingOf("acct_pov_cash") + 1500;
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: authored.pov, field: "cash", value: target }));
    await rig.rt.push.settle();
    expect(clientView(rig, chatId).hud?.cash).toEqual({ cents: target });
    const books = await posted(rig, chatId);
    expect(books.acct_pov_cash).toBe(target);
    expect(books.acct_pov_checking).toBe(openingOf("acct_pov_checking"));
  });
});

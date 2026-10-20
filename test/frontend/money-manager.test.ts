// What the money hub offers someone who runs a business's money (DESIGN §25.1), on Port Alder as the
// engine serves it: money they only manage pays for the business, so no picker offers it to pay
// them, and what the hub does offer, the actions take.

import { describe, expect, test } from "bun:test";
import type { AccountView, FinanceView } from "../../src/shared/finance";
import { autopaySources, fallbackSources, findAccount, flowSources, flowTargets, jobControls, payeeProblem } from "../../src/packs/economy/ui/layout";
import { autopayAction, flowCreateAction, blankFlowForm } from "../../src/packs/economy/ui/requests";
import { MoneyChat } from "../support/money-chat";

const MARCUS = "marcus_delgado";
const BUSINESS = "alder_automotive_co";
const SHOP = "acct_marcus_shop";
const LIFT_LOAN = "acct_alder_lift_loan";
const MINE = "acct_marcus_checking";
const MORTGAGE = "acct_marcus_mortgage";

/** An account the view holds, as the hub finds it. */
function held(view: FinanceView, id: string): AccountView {
  const a = findAccount(view, id);
  if (!a) throw new Error(`no ${id} in the view`);
  return a;
}

describe("a manager's pickers", () => {
  test("with no role of his own on the shop's checking, Marcus is offered it only for the shop: its loan's autopay and payments to others, never his mortgage, his accounts or his name", async () => {
    // As Port Alder has it, but with the shop's checking held by the shop alone.
    const chat = await MoneyChat.start({ pov: MARCUS, entities: { [SHOP]: { owners: [{ party: BUSINESS, role: "owner" }] } } });
    const view = await chat.hub();
    const palette = (await chat.state()).palette;
    expect(held(view, SHOP)).toMatchObject({ manages: true, spends: false });

    // Autopay: his mortgage draws on his own money, the shop's loan on the shop's.
    expect(autopaySources(view, held(view, MORTGAGE)).map((a) => a.id)).toContain(MINE);
    expect(autopaySources(view, held(view, MORTGAGE)).map((a) => a.id)).not.toContain(SHOP);
    expect(autopaySources(view, held(view, LIFT_LOAN)).map((a) => a.id)).toEqual([SHOP]);

    // A standing payment from the shop's checking may go to the shop's loan or to someone else, never to him.
    expect(flowSources(view).map((s) => s.id)).toContain(SHOP);
    const fromShop = flowTargets(view, palette, [SHOP]).map((t) => t.id);
    expect(fromShop).toContain(LIFT_LOAN);
    expect(fromShop).not.toContain(MINE);
    expect(fromShop).not.toContain(MORTGAGE);
    expect(fromShop).not.toContain(MARCUS);
    expect(payeeProblem(view, [SHOP], "Marcus Delgado")).not.toBeNull();
    expect(payeeProblem(view, [SHOP], "Harbor Cleaners")).toBeNull();
    // From his own checking he pays his own mortgage, and the shop's money never backs it.
    expect(flowTargets(view, palette, [MINE]).map((t) => t.id)).toContain(MORTGAGE);
    expect(fallbackSources(view, MINE, MORTGAGE).map((a) => a.id)).not.toContain(SHOP);

    // What the pickers offer, the actions take.
    expect(await chat.play(autopayAction(LIFT_LOAN, "minimum", SHOP, null))).toContain("done");
    expect(await chat.play(autopayAction(MORTGAGE, "minimum", MINE, null))).toContain("done");
    const cleaning = { ...blankFlowForm(SHOP), label: "Shop cleaning", to: "Harbor Cleaners", amount: "90", day: 5 };
    expect(await chat.play(flowCreateAction(cleaning, chat.currency))).toContain("done");
  });

  test("an employee Marcus can't see is a payroll row with no one to raise or let go; one he can see has both", async () => {
    const chat = await MoneyChat.start({ pov: MARCUS, secret: ["danny_okafor"] });
    const view = await chat.hub();
    const shop = view.businesses.find((b) => b.id === BUSINESS);
    if (!shop) throw new Error("Marcus doesn't run the shop");
    const hidden = shop.employees.find((j) => j.workerId === "");
    const seen = shop.employees.find((j) => j.workerId === "pov");
    if (!hidden || !seen) throw new Error("the payroll lacks a row");
    expect(hidden.worker).toBe("an employee");
    expect(jobControls(view, hidden, shop)).toEqual([]);
    expect(jobControls(view, seen, shop)).toEqual(["raise", "let_go"]);
  });
});

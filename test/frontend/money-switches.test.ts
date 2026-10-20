// The world's money switches (DESIGN §25.12) on Port Alder as the engine serves it: a feature
// switched on below its usual level opens its controls in the hub where it runs, and what the hub
// offers there, the actions take.

import { describe, expect, test } from "bun:test";
import { cardControls, flowSources } from "../../src/packs/economy/ui/layout";
import { blankFlowForm, cardAction, flowCreateAction, payPrefsAction } from "../../src/packs/economy/ui/requests";
import { MoneyChat } from "../support/money-chat";

describe("Money 2 with the switches on", () => {
  test("standing payments, payment preferences and card changes are offered and taken", async () => {
    const chat = await MoneyChat.start({ features: { flows: true, payment_prefs: true, cards: true } });
    await chat.level(2);
    const view = await chat.hub();
    expect(view.level).toBe(2);
    // How you pay and its Change, the Flows' New, and card changes all follow these.
    expect(view.features).toEqual(expect.arrayContaining(["flows", "payment_prefs", "cards"]));

    const from = flowSources(view)[0]?.id;
    if (!from) throw new Error("no account can pay a standing payment");
    expect(await chat.play(flowCreateAction({ ...blankFlowForm(from), label: "Gym", to: "Harbor Gym", amount: "40", day: 5 }, chat.currency))).toContain("done");
    expect(await chat.play(payPrefsAction([{ use: "cash", max: 2000 }]))).toContain("done");

    const card = view.cards.find((c) => c.state === "active" && cardControls(view, c).includes("freeze"));
    if (!card) throw new Error("no card to freeze");
    expect(await chat.play(cardAction(card.id, "freeze"))).toContain("done");
  });

  test("switched off, Money 2 offers none of them", async () => {
    const chat = await MoneyChat.start({ features: { flows: false, payment_prefs: false, cards: false } });
    await chat.level(2);
    const view = await chat.hub();
    expect(view.features).not.toContain("flows");
    expect(view.features).not.toContain("payment_prefs");
    expect(view.cards.flatMap((c) => cardControls(view, c))).toEqual([]);
    expect(view.payPrefs).toEqual([]);
  });
});

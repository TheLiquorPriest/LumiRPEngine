// GM → This chat → Money (DESIGN §25.8) and Settings → Narrator → Out-of-play actions (DESIGN §11),
// pressed without a DOM: the chat's cash rule beside the world's and the GM edit each choice sends,
// and the Tell defaults' patches and their reset.

import { describe, expect, test } from "bun:test";
import { cashNeedsMachine, cashRuleEdit, cashSummary } from "../../src/frontend/gm/chat-money";
import { offstageIsDefault, offstagePatch } from "../../src/frontend/settings/narrator";
import { OFFSTAGE_DEFAULTS, offstageSettingsOf, tellPreset, toldByDefault } from "../../src/shared/offstage";

describe("GM → This chat → Money", () => {
  test("the chat's rule comes before the world's switch, and that before its usual level", () => {
    expect(cashNeedsMachine({ chat: null, world: null, level: 4, usual: 4 })).toBe(true);
    expect(cashNeedsMachine({ chat: null, world: null, level: 3, usual: 4 })).toBe(false);
    expect(cashNeedsMachine({ chat: null, world: true, level: 3, usual: 4 })).toBe(true);
    expect(cashNeedsMachine({ chat: false, world: true, level: 4, usual: 4 })).toBe(false);
    expect(cashSummary({ chat: null, world: true, level: 4, usual: 4 })).toBe("Cash needs a machine or a branch · the world's rule");
    expect(cashSummary({ chat: false, world: true, level: 4, usual: 4 })).toBe("Cash comes and goes anywhere · this chat's own");
  });

  test("each choice is one GM edit of the cash rule; As the world sends null", () => {
    const ops = (choice: "world" | "machine" | "free") => cashRuleEdit("chat1", choice).ops;
    expect(ops("machine")).toEqual([{ op: "effect", effect: "economy.cash_rule", args: { atm: true } }]);
    expect(ops("free")).toEqual([{ op: "effect", effect: "economy.cash_rule", args: { atm: false } }]);
    expect(ops("world")).toEqual([{ op: "effect", effect: "economy.cash_rule", args: { atm: null } }]);
  });
});

describe("Settings → Narrator → Out-of-play actions", () => {
  test("told by default: payments to others at any amount, credit, property, business, staff, members, structure", () => {
    expect(OFFSTAGE_DEFAULTS.tell).toEqual({ payments: true, credit: true, property: true, business: true, staff: true, members: true, structure: true, accounts: false, investing: false, governance: false, things: false });
    expect(toldByDefault("pay", { to: "x", amount: 1 }, OFFSTAGE_DEFAULTS, 2)).toBe(true);
    expect(toldByDefault("move_money", { amount: 100_000 }, OFFSTAGE_DEFAULTS, 2)).toBe(false);
    expect(toldByDefault("buy", {}, OFFSTAGE_DEFAULTS, 2)).toBe(false);
    // From an amount in whole units of the world's money: $20 is 2000 cents.
    const from20 = { ...OFFSTAGE_DEFAULTS, paymentsFrom: 20 };
    expect(toldByDefault("pay", { amount: 1999 }, from20, 2)).toBe(false);
    expect(toldByDefault("pay", { amount: 2000 }, from20, 2)).toBe(true);
  });

  test("a confirm step's Tell switch starts from them, and an action done in the story has none", () => {
    expect(tellPreset("pay", { to: "x", amount: 2000 }, OFFSTAGE_DEFAULTS, 2)).toBe(true);
    expect(tellPreset("org_admit", { org: "o", who: "w" }, OFFSTAGE_DEFAULTS, 2)).toBe(true);
    expect(tellPreset("move_money", { amount: 2000 }, OFFSTAGE_DEFAULTS, 2)).toBe(false);
    expect(tellPreset("pay", { amount: 1999 }, { ...OFFSTAGE_DEFAULTS, paymentsFrom: 20 }, 2)).toBe(false);
    expect(tellPreset("move_money", {}, offstageSettingsOf({ tell: { accounts: true } }), 2)).toBe(true);
    // `buy` plays in the story, and Gear → Manage's actions have no confirm step.
    expect(tellPreset("buy", { item: "coffee" }, OFFSTAGE_DEFAULTS, 2)).toBeNull();
    expect(tellPreset("wear", { item: "coat" }, OFFSTAGE_DEFAULTS, 2)).toBeNull();
  });

  test("a switch patches one group, the amount a whole number from 0, and Reset all of it", () => {
    expect(offstagePatch({ group: "accounts", tell: true })).toEqual({ offstage: { tell: { accounts: true } } });
    expect(offstagePatch({ paymentsFrom: -3.4 })).toEqual({ offstage: { paymentsFrom: 0 } });
    expect(offstagePatch("reset")).toEqual({ offstage: { tell: { ...OFFSTAGE_DEFAULTS.tell }, paymentsFrom: 0 } });
    const changed = offstageSettingsOf({ tell: { accounts: true }, paymentsFrom: 5 });
    expect(offstageIsDefault(changed)).toBe(false);
    expect(offstageIsDefault(offstageSettingsOf(undefined))).toBe(true);
    // What doesn't read as a setting keeps its default.
    expect(offstageSettingsOf({ tell: { payments: "yes" }, paymentsFrom: 1.5 })).toEqual(OFFSTAGE_DEFAULTS);
  });
});

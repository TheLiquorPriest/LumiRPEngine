// Build's money editors (DESIGN §13, §25): the Custom toggles as the economy config stores them,
// household shares that add up, schedule lists as typed, structured values kept free of empty
// parts, and every money field and place field reaching its editor through the registry.

import { describe, expect, test } from "bun:test";
import { fieldEditorFor } from "../../src/frontend/build/schema-form";
import { buildCatalog } from "../../src/frontend/ui-registry";
import economy from "../../src/packs/economy/ui/index";
import { toggleOf, withToggle } from "../../src/packs/economy/ui/config";
import { compact, equalShares, householdMembers, monthDays, numbersOf, recordsOf } from "../../src/packs/economy/ui/field-editors";
import type { WorldDoc } from "../../src/shared/world";

describe("the Custom money toggles", () => {
  test("a toggle is stored as on or off, and By level removes it (and an empty set of toggles)", () => {
    const on = withToggle({ unpricedCap: 500 }, "statements", "on");
    expect(on).toEqual({ unpricedCap: 500, features: { statements: true } });
    expect(toggleOf(on, "statements")).toBe("on");
    const off = withToggle(on, "atm", "off");
    expect(off.features).toEqual({ statements: true, atm: false });
    expect(toggleOf(off, "atm")).toBe("off");
    expect(withToggle(withToggle(off, "atm", "level"), "statements", "level")).toEqual({ unpricedCap: 500 });
    expect(toggleOf({}, "holds")).toBe("level");
  });
});

describe("structured money values", () => {
  test("equal household shares are whole percentages that make 100", () => {
    expect(equalShares(["a", "b", "c"])).toEqual([{ party: "a", pct: 34 }, { party: "b", pct: 33 }, { party: "c", pct: 33 }]);
    expect(equalShares(["a", "b"]).reduce((s, x) => s + Number(x.pct), 0)).toBe(100);
    expect(equalShares([])).toEqual([]);
  });

  test("a household's members are those who hold member_of toward it", () => {
    const doc = { entities: { ana: { id: "ana", relations: [{ type: "member_of", to: "home" }] }, ben: { id: "ben", relations: [{ type: "member_of", to: "home" }, { type: "knows", to: "ana" }] }, cy: { id: "cy", relations: [{ type: "member_of", to: "club" }] } } } as unknown as WorldDoc;
    expect(householdMembers(doc, "home")).toEqual(["ana", "ben"]);
  });

  test("days of the month read as typed, -1 for the last; anything else isn't taken", () => {
    expect(monthDays("15, 1, -1, 15")).toEqual([-1, 1, 15]);
    expect(monthDays("")).toEqual([]);
    expect(monthDays("0")).toBeNull();
    expect(monthDays("32")).toBeNull();
    expect(monthDays("first")).toBeNull();
  });

  test("lists keep only what they hold, and a record drops its empty parts", () => {
    expect(recordsOf([{ to: "sav" }, 3, "x", null, { pct: 5 }])).toEqual([{ to: "sav" }, { pct: 5 }]);
    expect(numbersOf([5, 1, 5, "2"])).toEqual([1, 5]);
    expect(compact({ to: "sav", cents: undefined, pct: 10, from: "", note: null })).toEqual({ to: "sav", pct: 10 });
  });
});

describe("every money field reaches its editor", () => {
  const catalog = buildCatalog([economy]);
  const doc = { kinds: { account: { id: "account", label: "Account", fields: {} }, flow: { id: "flow", label: "Flow", fields: {} }, job: { id: "job", label: "Job", fields: {} }, holding: { id: "holding", label: "Holding", fields: {} }, business: { id: "business", label: "Business", extends: "thing", fields: {} }, shop: { id: "shop", label: "Shop", extends: "business", fields: {} }, person: { id: "person", label: "Person", fields: {} }, thing: { id: "thing", label: "Thing", fields: {} } } } as unknown as WorldDoc;

  test.each([
    ["account", "owners"],
    ["account", "product"],
    ["flow", "splits"],
    ["flow", "shares"],
    ["flow", "weekdays"],
    ["flow", "days"],
    ["flow", "months"],
    ["flow", "except"],
    ["job", "splits"],
    ["job", "deductions"],
    ["job", "pay_days"],
    ["holding", "lots"],
    ["holding", "route"],
    ["holding", "asset"],
    ["business", "places"],
    ["business", "trading_days"],
    ["person", "pay_prefs"],
  ])("%s.%s has its editor", (kind, field) => {
    expect(fieldEditorFor(catalog.fields, doc, kind, field)).toBeDefined();
  });

  test("a kind that extends a money kind gets its editors; other fields stay generic", () => {
    expect(fieldEditorFor(catalog.fields, doc, "shop", "owners")).toBeDefined();
    expect(fieldEditorFor(catalog.fields, doc, "account", "apr_pct")).toBeUndefined();
  });

  test("places get the cash machine and branch editors", () => {
    expect(catalog.placeFields.map((p) => p.field)).toEqual(["atm", "branch"]);
    expect(catalog.gmSections.map((s) => s.id)).toEqual(["economy.money"]);
  });
});

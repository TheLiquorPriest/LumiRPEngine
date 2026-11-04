// The "Me" packs' rules for Now and the item sheet: what the garage flags, which loans are overdue,
// and where an item sits.

import { describe, expect, test } from "bun:test";
import { overdueLoans } from "../../src/packs/gear/ui/glance";
import { findItem } from "../../src/packs/gear/ui/item";
import { decodeGearView } from "../../src/packs/gear/ui/panel";
import { garageAlerts } from "../../src/packs/vehicles/ui/glance";
import { decodeGarageView } from "../../src/packs/vehicles/ui/panel";

describe("garageAlerts", () => {
  test("flags low fuel, an overdue loan and overdue service, and nothing on a vehicle in order", () => {
    const view = decodeGarageView({
      level: 4,
      vehicles: [
        { id: "car", name: "Civic", kind: "road", status: "ok", fuelPct: 38, service: [{ label: "Service", due: "150000 mi", overdue: false }] },
        { id: "boat", name: "Jon boat", kind: "water", status: "needs work", fuelPct: 10, assignedTo: { name: "Dev", until: "Sun 18:00", overdue: true }, service: [{ label: "Service", due: "212 h", overdue: true }] },
      ],
    });
    if (!view) throw new Error("no view");
    expect(garageAlerts(view).map((a) => [a.vehicle, a.icon, a.flag, a.text])).toEqual([
      ["Jon boat", "boat", "Low", "Fuel 10%"],
      ["Jon boat", "boat", "Overdue", "Loan to Dev ended Sun 18:00"],
      ["Jon boat", "boat", "Overdue", "Service · 212 h"],
    ]);
  });
});

describe("gear", () => {
  const view = decodeGearView({
    level: 3,
    on: [{ id: "backpack", name: "Backpack", load: { used: 4, capacity: 10 }, whose: "yours", children: [{ id: "wallet", name: "Wallet", whose: "yours", children: [{ id: "cash", name: "Cash", qty: 46, whose: "yours" }] }] }],
    holding: [{ id: "parcel", name: "Parcel", whose: "Dev's", why: "Dev handed it to you to hold", where: "In Backpack" }],
    elsewhere: [{ id: "drill", name: "Cordless drill", whose: "yours", where: "With Dev", lent: { to: "Dev", until: "Mon 18:00", overdue: true } }],
    lent: [
      { id: "drill", name: "Cordless drill", lent: { to: "Dev", until: "Mon 18:00", overdue: true } },
      { id: "tent", name: "Tent", lent: { to: "Mara", overdue: false, hold: true } },
    ],
    borrowed: [{ id: "ladder", name: "Ladder", borrowed: { from: "Mara", overdue: false, assigned: true } }],
  });
  if (!view) throw new Error("no view");

  test("an item is in the first section that holds it, inside its containers", () => {
    const cash = findItem(view, "cash");
    expect(cash && [cash.section, cash.path.map((p) => p.id), cash.item.whose]).toEqual(["on", ["backpack", "wallet"], "yours"]);
    const parcel = findItem(view, "parcel");
    expect(parcel && [parcel.section, parcel.item.whose, parcel.item.where]).toEqual(["holding", "Dev's", "In Backpack"]);
    expect(findItem(view, "drill")?.section).toBe("elsewhere");
    expect(findItem(view, "tent")?.item.lent).toEqual({ to: "Mara", until: undefined, overdue: false, hold: true });
    expect(findItem(view, "ladder")?.item.borrowed).toEqual({ from: "Mara", until: undefined, overdue: false, assigned: true });
    expect(findItem(view, "nope")).toBeNull();
  });

  test("overdue loans list each lent item once", () => {
    expect(overdueLoans(view).map((item) => item.id)).toEqual(["drill"]);
  });
});

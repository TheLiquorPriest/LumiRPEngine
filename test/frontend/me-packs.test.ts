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
    owned: [
      { id: "drill", name: "Cordless drill", lent: { to: "Dev", until: "Mon 18:00", overdue: true } },
      { id: "backpack", name: "Backpack", children: [{ id: "wallet", name: "Wallet" }] },
    ],
    worn: [],
    carried: [{ id: "backpack", name: "Backpack", load: { used: 4, capacity: 10 }, children: [{ id: "wallet", name: "Wallet", children: [{ id: "cash", name: "Cash", qty: 46 }] }] }],
    stored: [{ id: "tent", name: "Tent", lent: { to: "Mara", overdue: false } }],
  });
  if (!view) throw new Error("no view");

  test("an item is where the POV keeps it, inside its containers, and owned when it's among the owned", () => {
    const cash = findItem(view, "cash");
    expect(cash && [cash.section, cash.path.map((p) => p.id), cash.owned]).toEqual(["carried", ["backpack", "wallet"], false]);
    const wallet = findItem(view, "wallet");
    expect(wallet && [wallet.section, wallet.owned]).toEqual(["carried", true]);
    expect(findItem(view, "drill")?.section).toBe("owned");
    expect(findItem(view, "nope")).toBeNull();
  });

  test("overdue loans list each lent item once", () => {
    expect(overdueLoans(view).map((item) => item.id)).toEqual(["drill"]);
  });
});

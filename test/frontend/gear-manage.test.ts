// Play → Me → Gear → Manage and the place sheet's Things here (ITEMS-SPEC §10.3), walked as rendered
// trees (no DOM): the groups (Outfit, Carried, Wardrobe by holder; below Gear 3 only Carried; Things
// here's room, loose and holders), the controls a thing of your own gets (none for someone else's,
// Wear only on what is worn, Put in… only with somewhere to put it), and every control sending its
// gear action at once, off screen (`offstage`, no words), with the palette's reason greying one.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { Button } from "../../src/frontend/components";
import { OFFSTAGE_GEAR } from "../../src/shared/offstage";
import type { GearItem, GearView } from "../../src/packs/gear/core/view";
import { controlsFor, hereGroups, holdersFor, MANAGE_CONTROLS, ManageList, manageGroups, manageRequest } from "../../src/packs/gear/ui/manage";
import type { Props } from "../support/tree";

const watch: GearItem = { id: "watch", name: "Wristwatch", as: "worn", slot: "wrist", mine: true, wearable: true };
const shirt: GearItem = { id: "shirt", name: "Flannel shirt", mine: true, wearable: true };
const bag: GearItem = { id: "bag", name: "Backpack", mine: true, holds: "hand", children: [{ id: "book", name: "Paperback", mine: true }] };
const keys: GearItem = { id: "danny_keys", name: "Truck keys", whose: "Danny Okafor's" };
const view: GearView = {
  level: 3,
  on: [],
  holding: [],
  elsewhere: [],
  lent: [],
  borrowed: [],
  outfit: [watch],
  carried: [bag, keys],
  wardrobe: [{ holder: { id: "dresser", name: "Dresser" }, where: "114 Harbor Street", items: [shirt] }],
  here: { place: "114 Harbor Street", room: [{ id: "sofa", name: "Sofa", size: "furniture", mine: true }], lying: [{ id: "mug", name: "Mug", mine: true }], inside: [{ holder: { id: "fridge", name: "Refrigerator" }, items: [{ id: "milk", name: "Milk", mine: true }] }] },
};

function elements(node: unknown): VNode<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return [];
  const v = node as VNode<Props>;
  // A row is a component of its own: it is drawn, so its buttons are reached (the shared ones aren't, as they read the page's context).
  const inner = typeof v.type === "function" && v.type.name === "ManageRow" ? elements((v.type as (p: Props) => unknown)(v.props)) : [];
  return [v, ...inner, ...Object.values(v.props).flatMap(elements)];
}

const textOf = (node: unknown): string => (typeof node === "string" ? node : Array.isArray(node) ? node.map(textOf).join("") : "");

describe("Gear → Manage", () => {
  test("Outfit, Carried and Wardrobe by holder; below Gear 3 only Carried", () => {
    expect(manageGroups(view).map((g) => [g.key, g.title, g.items.map((i) => i.id)])).toEqual([
      ["outfit", "Outfit", ["watch"]],
      ["carried", "Carried", ["bag", "danny_keys"]],
      ["wardrobe", "Wardrobe · Dresser", ["shirt"]],
    ]);
    expect(manageGroups({ ...view, level: 2 }).map((g) => g.key)).toEqual(["carried"]);
    expect(hereGroups(view.here!).map((g) => [g.key, g.title])).toEqual([
      ["room", "In the room"],
      ["lying", "Lying here"],
      ["inside", "In Refrigerator"],
    ]);
  });

  test("each of your own things gets its group's controls; someone else's none; Wear only on what is worn; Put in… with somewhere to put it", () => {
    expect(controlsFor("outfit", watch, [])).toEqual(["remove", "put_away", "drop"]);
    const holders = holdersFor(view, view.carried[1]!);
    expect(holders.map((h) => h.id)).toEqual(["bag", "fridge", "dresser"]);
    expect(controlsFor("carried", keys, holders)).toEqual([]);
    expect(controlsFor("carried", bag, holdersFor(view, bag))).toEqual(["put_in", "put_away", "drop"]);
    // A thing never goes into itself or what is in it.
    expect(holdersFor(view, bag).map((h) => h.id)).not.toContain("bag");
    expect(controlsFor("wardrobe", shirt, [])).toEqual(["wear", "take"]);
    expect(controlsFor("room", view.here!.room[0]!, [])).toEqual([]);
    expect(Object.keys(MANAGE_CONTROLS).every((a) => OFFSTAGE_GEAR.includes(a))).toBe(true);
  });

  test("a control sends its gear action at once, off screen, with no words; the palette's reason greys one", () => {
    const sent: unknown[] = [];
    const entries = [{ action: "drop", label: "Drop", group: "action" as const, options: [{ label: "Wristwatch", params: { item: "watch" }, disabled: "Not here" }] }];
    const tree = ManageList({ chatId: "chat_1", view, entries, groups: manageGroups(view), busy: false, putting: null, onPutting: () => undefined, onSend: (request) => sent.push(request) });
    const buttons = elements(tree).filter((v) => v.type === Button).map((v) => v.props);
    const press = (label: string, nth = 0) => (buttons.filter((p) => textOf(p.children) === label)[nth]?.onClick as () => void)();
    press("Take off");
    press("Wear");
    press("Take");
    expect(sent).toEqual([manageRequest("chat_1", "remove", "watch"), manageRequest("chat_1", "wear", "shirt"), manageRequest("chat_1", "take", "shirt")]);
    expect(manageRequest("chat_1", "put_in", "book", "bag")).toEqual({ type: "lre.action", chatId: "chat_1", action: "put_in", params: { item: "book", into: "bag" }, source: "palette", offstage: true });
    expect(buttons.find((p) => textOf(p.children) === "Drop")).toMatchObject({ disabled: true, title: "Not here" });
  });
});

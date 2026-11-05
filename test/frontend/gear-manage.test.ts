// Play → Me → Belongings' sections and select bar, and the place sheet's Things here (ITEMS-SPEC
// §10.3), walked as rendered trees (no DOM): the sections All shows (Wearing from Gear 3, Carried,
// Here, Home storage, Elsewhere, Lent and borrowed), the bar's Wear or Take off and its one ✎ fix
// for every thing picked; Things here's groups and the controls a thing of your own gets there, each
// sending its gear action at once, off screen (`offstage`, no words).

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { Button } from "../../src/frontend/components";
import type { Selection } from "../../src/frontend/multi-select";
import { OFFSTAGE_GEAR } from "../../src/shared/offstage";
import type { GearItem, GearView } from "../../src/packs/gear/core/view";
import { BelongingsBar, belongingsSections, bulkRequest, sectionCount, wearToggle, type Picked } from "../../src/packs/gear/ui/belongings";
import { controlsFor, hereGroups, holdersFor, MANAGE_CONTROLS, ManageList, manageRequest } from "../../src/packs/gear/ui/manage";
import { propsOf, type Props } from "../support/tree";

const watch: GearItem = { id: "watch", name: "Wristwatch", as: "worn", slot: "wrist", mine: true, wearable: true };
const shirt: GearItem = { id: "shirt", name: "Flannel shirt", mine: true, wearable: true };
const bag: GearItem = { id: "bag", name: "Backpack", mine: true, holds: "hand", children: [{ id: "book", name: "Paperback", mine: true }] };
const keys: GearItem = { id: "danny_keys", name: "Truck keys", whose: "Danny Okafor's" };
const tent: GearItem = { id: "tent", name: "Tent", mine: true, where: "At the shop" };
const view: GearView = {
  level: 3,
  on: [],
  holding: [],
  elsewhere: [shirt, tent],
  lent: [],
  borrowed: [{ id: "drill", name: "Drill", borrowed: { from: "Dev", overdue: false } }],
  outfit: [watch],
  carried: [bag, keys],
  wardrobe: [{ holder: { id: "dresser", name: "Dresser" }, where: "114 Harbor Street", items: [shirt] }],
  here: { place: "114 Harbor Street", room: [{ id: "sofa", name: "Sofa", size: "furniture", mine: true }], lying: [{ id: "mug", name: "Mug", mine: true }], inside: [{ holder: { id: "fridge", name: "Refrigerator" }, items: [{ id: "milk", name: "Milk", mine: true }] }] },
  stored: [{ holder: { id: "dresser", name: "Dresser" }, where: "114 Harbor Street", items: [shirt] }],
  sets: [],
  people: [{ id: "danny", name: "Danny Okafor" }],
  vehicles: 1,
  loans: [{ label: "For a day", until: 1440 }],
  household: null,
  home: { id: "harbor_street_114", name: "114 Harbor Street" },
  ceiling: "armful",
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

const selection = (ids: string[]): Selection => ({ on: true, ids, start: () => undefined, stop: () => undefined, toggle: () => undefined, set: () => undefined });

describe("Belongings' sections", () => {
  test("All: Wearing (Gear 3), Carried, Here, Home storage, Elsewhere (neither at home nor here), Lent and borrowed; below Gear 3 no Wearing", () => {
    const sections = belongingsSections(view, "all");
    expect(sections.map((s) => [s.key, s.title, sectionCount(s)])).toEqual([
      ["wearing", "Wearing", 1],
      ["carried", "Carried", 2],
      ["here", "Here · 114 Harbor Street", 3],
      ["home", "Home storage · 114 Harbor Street", 1],
      ["elsewhere", "Elsewhere", 1],
      ["lent", "Lent and borrowed", 1],
    ]);
    expect(sections.find((s) => s.key === "home")?.groups.map((g) => [g.title, g.sub])).toEqual([["Dresser", "114 Harbor Street"]]);
    expect(belongingsSections({ ...view, level: 2 }, "all").map((s) => s.key)).not.toContain("wearing");
    // A chip's own section says so when it is empty.
    expect(belongingsSections({ ...view, lent: [], borrowed: [] }, "lent")[0]?.empty).toBe("Nothing lent out or borrowed.");
  });
});

describe("Belongings' select bar", () => {
  const picked = (items: [GearItem, Picked["at"]][]): Picked[] => items.map(([item, at]) => ({ item, at }));

  test("Wear or Take off: Take off when every one picked is worn, else Wear what can be", () => {
    expect(wearToggle(picked([[watch, "wearing"]]), 3)).toEqual({ action: "take_off", things: [watch] });
    expect(wearToggle(picked([[watch, "wearing"], [shirt, "home"], [bag, "carried"]]), 3)).toEqual({ action: "wear", things: [shirt] });
    expect(wearToggle(picked([[bag, "carried"]]), 3)).toBeNull();
    expect(wearToggle(picked([[watch, "wearing"]]), 2)).toBeNull();
  });

  test("every thing picked goes as one ✎ fix with one label: Put away three things is one request", () => {
    expect(bulkRequest("chat_1", "away", [bag, shirt, tent], null)).toEqual({ type: "lre.fix", chatId: "chat_1", things: [{ do: "away", item: "bag" }, { do: "away", item: "shirt" }, { do: "away", item: "tent" }], label: "Backpack, Flannel shirt and Tent are put away, each where it is kept." });
    expect(bulkRequest("chat_1", "drop", [bag], "harbor_street_114")?.things).toEqual([{ do: "move", item: "bag", to: { place: "harbor_street_114" } }]);
    expect(bulkRequest("chat_1", "drop", [bag], null)).toBeNull();
  });

  test("the bar: Move to…, Put away, Wear or Take off and Give/Lend…, off with nothing picked or nobody here", () => {
    const sheets: string[] = [];
    const bulk: string[] = [];
    const tree = BelongingsBar({ selection: selection(["watch"]), all: ["watch", "bag"], shown: ["watch", "bag"], picked: picked([[watch, "wearing"]]), level: 3, here: "harbor_street_114", people: 1, busy: false, onBulk: (a) => bulk.push(a), onSheet: (s) => sheets.push(s) });
    const buttons = propsOf(tree, Button);
    expect(buttons.map((p) => textOf(p.children))).toEqual(["Move to…", "Put away", "Take off", "Give/Lend…"]);
    for (const p of buttons) (p.onClick as () => void)();
    expect(sheets).toEqual(["move", "give"]);
    expect(bulk).toEqual(["away", "take_off"]);
    const none = propsOf(BelongingsBar({ selection: selection([]), all: [], shown: [], picked: [], level: 3, here: null, people: 0, busy: false, onBulk: () => undefined, onSheet: () => undefined }), Button);
    expect(none.every((p) => p.disabled === true)).toBe(true);
  });
});

describe("Things here", () => {
  test("the place sheet's groups: In the room, Lying here, and each holder here", () => {
    expect(hereGroups(view.here!).map((g) => [g.key, g.title])).toEqual([
      ["room", "In the room"],
      ["lying", "Lying here"],
      ["inside", "In Refrigerator"],
    ]);
  });

  test("each of your own things gets its group's controls; furnishings none; Put in… with somewhere to put it", () => {
    const mug = view.here!.lying[0]!;
    expect(controlsFor("lying", mug, holdersFor(view, mug))).toEqual(["take", "put_in", "put_away"]);
    expect(controlsFor("room", view.here!.room[0]!, [])).toEqual([]);
    expect(controlsFor("inside", { id: "x", name: "Not mine" }, [])).toEqual([]);
    expect(holdersFor(view, bag).map((h) => h.id)).not.toContain("bag");
    expect(Object.keys(MANAGE_CONTROLS).every((a) => OFFSTAGE_GEAR.includes(a))).toBe(true);
  });

  test("a control sends its gear action at once, off screen, with no words; the palette's reason greys one", () => {
    const sent: unknown[] = [];
    const entries = [{ action: "take", label: "Take", group: "action" as const, options: [{ label: "Milk", params: { item: "milk" }, disabled: "Out of reach" }] }];
    const tree = ManageList({ chatId: "chat_1", view, entries, groups: hereGroups(view.here!), busy: false, putting: null, onPutting: () => undefined, onSend: (request) => sent.push(request) });
    const buttons = elements(tree).filter((v) => v.type === Button).map((v) => v.props);
    (buttons.find((p) => textOf(p.children) === "Take" && p.disabled !== true)?.onClick as () => void)();
    expect(sent).toEqual([manageRequest("chat_1", "take", "mug")]);
    expect(buttons.filter((p) => textOf(p.children) === "Take").map((p) => p.disabled)).toEqual([false, true]);
  });
});

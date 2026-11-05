// Play → Me → Belongings (ITEMS-SPEC §10.3), walked as rendered trees (no DOM): the filter chips
// (Wearing only from Gear 3, one pressed), the search through every section, each row's one main
// verb (Ready and Stow for a weapon), the outfit bar's name, and Change into, sent at once, off
// screen, as the gear pack's `set_apply`.

import { describe, expect, test } from "bun:test";
import { Button } from "../../src/frontend/components";
import { offstageGroupOf } from "../../src/shared/offstage";
import type { GearItem, GearSet, GearView } from "../../src/packs/gear/core/view";
import { belongingsSections, FilterChips, filtersAt, mainVerb, OutfitBar, searchSections, verbRequest } from "../../src/packs/gear/ui/belongings";
import { outfitBarText, piecesLine, SetRows, setApplyRequest } from "../../src/packs/gear/ui/sets-sheet";
import { propsOf } from "../support/tree";

const textOf = (node: unknown): string => (typeof node === "string" ? node : Array.isArray(node) ? node.map(textOf).join("") : "");

const pistol: GearItem = { id: "pistol", name: "Pistol", category: "weapon", wearable: true, mine: true, slot: "holster", as: "worn" };
const bag: GearItem = { id: "bag", name: "Backpack", mine: true, holds: "hand", children: [{ id: "book", name: "Paperback", mine: true }, { id: "torch", name: "Flashlight", mine: true }] };
const jeans: GearItem = { id: "jeans", name: "Jeans", mine: true, wearable: true };
const work: GearSet = { id: "set_work", name: "Work clothes", kind: "outfit", pieces: [{ item: "jeans", name: "Jeans" }, { item: "boots", name: "Boots", missing: true }] };
const view: GearView = {
  level: 3,
  on: [],
  holding: [],
  elsewhere: [],
  lent: [],
  borrowed: [],
  outfit: [pistol],
  carried: [bag],
  wardrobe: [],
  here: null,
  stored: [{ holder: { id: "closet", name: "Closet" }, where: "Bedroom", items: [jeans] }],
  sets: [work, { id: "set_range", name: "Range day", kind: "loadout", pieces: [{ item: "pistol", name: "Pistol", slot: "holster" }], on: true }],
  people: [],
  vehicles: 0,
  loans: [],
  household: null,
  home: { id: "home", name: "114 Harbor Street" },
  ceiling: "armful",
};

describe("Belongings", () => {
  test("the chips: every filter from Gear 3, Wearing only there; one pressed, a tap picks another", () => {
    expect(filtersAt(3)).toEqual(["all", "wearing", "carried", "arsenal", "home", "here", "lent"]);
    expect(filtersAt(2)).not.toContain("wearing");
    const picked: string[] = [];
    const chips = propsOf(FilterChips({ filters: filtersAt(3), value: "home", onPick: (f) => picked.push(f) }), "button");
    expect(chips.filter((p) => p["aria-pressed"] === true).map((p) => p["data-lre-bel-filter"])).toEqual(["home"]);
    (chips.find((p) => p["data-lre-bel-filter"] === "arsenal")?.onClick as () => void)();
    expect(picked).toEqual(["arsenal"]);
    expect(belongingsSections(view, "arsenal")[0]?.groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ["worn", ["pistol"]],
      ["carried", []],
      ["home", []],
    ]);
  });

  test("the search goes through every section and into bags, keeping only what it finds", () => {
    const found = searchSections(belongingsSections(view, "all"), "paper");
    expect(found.map((s) => s.key)).toEqual(["carried"]);
    expect(found[0]?.groups[0]?.items[0]?.children?.map((c) => c.id)).toEqual(["book"]);
    expect(searchSections(belongingsSections(view, "all"), "nothing like it")).toEqual([]);
  });

  test("each row's one main verb: a holstered weapon Ready, one in hand Stow, clothing at home Wear, a borrowed thing Give back; at once, off screen", () => {
    const ctx = { level: 3, canPutIn: true, here: "kitchen" };
    expect(mainVerb(pistol, "wearing", ctx)).toBe("ready");
    expect(mainVerb({ ...pistol, as: "hand" }, "wearing", ctx)).toBe("stow");
    expect(mainVerb(jeans, "home", ctx)).toBe("wear");
    expect(mainVerb(bag, "carried", ctx)).toBe("put_in");
    expect(mainVerb({ id: "x", name: "Someone's" }, "carried", ctx)).toBeNull();
    expect(mainVerb({ id: "drill", name: "Drill" }, "borrowed", ctx)).toBe("give_back");
    expect(verbRequest("chat_1", "ready", pistol, { pov: "pov", here: null })).toEqual({ type: "lre.fix", chatId: "chat_1", things: [{ do: "wear", item: "pistol", slot: "hand_held" }], label: "Pistol is ready in your hand." });
    expect(verbRequest("chat_1", "give_back", { id: "drill", name: "Drill" }, { pov: "pov", here: null })).toEqual({ type: "lre.action", chatId: "chat_1", action: "give_back", params: { item: "drill" }, source: "palette", offstage: true });
  });

  test("the outfit bar names the saved outfit worn now; its sheet changes into one at once, off screen", () => {
    expect(outfitBarText(view)).toBe("Not a saved outfit");
    expect(outfitBarText({ ...view, sets: [{ ...work, on: true }] })).toBe("Work clothes");
    expect(outfitBarText({ ...view, sets: [] })).toBe("No saved outfits yet");
    expect(OutfitBar({ view: { ...view, level: 2 }, onOpen: () => undefined })).toBeNull();
    expect(piecesLine(work)).toBe("Jeans · missing Boots");
    const applied: string[] = [];
    const rows = SetRows({ sets: view.sets, kind: "outfit", busy: false, onApply: (s) => applied.push(s.id), onDrop: () => undefined });
    const change = propsOf(rows, Button).filter((p) => textOf(p.children) === "Change into");
    expect(change.length).toBe(1);
    (change[0]?.onClick as () => void)();
    expect(applied).toEqual(["set_work"]);
    expect(propsOf(SetRows({ sets: view.sets, kind: "loadout", busy: false, onApply: () => undefined, onDrop: () => undefined }), Button).find((p) => textOf(p.children) === "Change into")?.disabled).toBe(true);
    expect(setApplyRequest("chat_1", "set_work")).toEqual({ type: "lre.action", chatId: "chat_1", action: "set_apply", params: { set: "set_work" }, source: "palette", offstage: true });
    expect(offstageGroupOf("set_apply")).not.toBeNull();
  });
});

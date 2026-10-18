import { describe, expect, test } from "bun:test";
import { checkBalance } from "../../src/frontend/build/expr-editor";
import { issuePart, issueTarget } from "../../src/frontend/build/check";
import { proposalGroups, proposalWrites, shownValue, startTicked } from "../../src/frontend/build/jobs";
import { kindFields, refOptions } from "../../src/frontend/build/schema-form";
import { cellProblem } from "../../src/frontend/build/table-editor";
import { parseFixValue } from "../../src/frontend/fix-editor";
import { visiblePanels } from "../../src/frontend/play/play";
import { settingsTimePatch, speedRows } from "../../src/frontend/time-controls";
import type { PanelDef } from "../../src/frontend/registry";
import type { UiCatalog } from "../../src/frontend/ui-registry";
import { slotProblems } from "../../src/packs/calendar/ui/schedule-editor";
import { cellAt, paintCell, resizeGrid } from "../../src/packs/space/ui/editors";
import { layoutTrack } from "../../src/packs/story/ui/track-editor";
import type { JobProposal } from "../../src/shared/protocol";
import type { StateView } from "../../src/shared/state-view";
import type { GridDef, KindDef } from "../../src/shared/world";
import { baseWorld } from "../packs/support";
import { COLLECTION_SPECS } from "../../src/frontend/build/schema";
import { boolChecked } from "../../src/frontend/build/schema-form";

const grid = (): GridDef => ({ id: "g", width: 3, height: 2, terrain: ["a", "b", "c", "d", "e", "f"], blocked: [2, 4], zones: { z: [0, 5] } });

describe("grid painter", () => {
  test("shrinking keeps the overlapping rectangle and remaps blocked cells and zones", () => {
    const small = resizeGrid(grid(), 2, 2, "grass");
    expect(small.terrain).toEqual(["a", "b", "d", "e"]);
    expect(small.blocked).toEqual([3]);
    expect(small.zones).toEqual({ z: [0] });
  });

  test("growing fills new cells with the brush and moves row-major indexes", () => {
    const big = resizeGrid(grid(), 4, 3, "x");
    expect(big.terrain).toEqual(["a", "b", "c", "x", "d", "e", "f", "x", "x", "x", "x", "x"]);
    expect(big.blocked).toEqual([2, 5]);
    expect(big.zones).toEqual({ z: [0, 6] });
  });

  test("painting terrain, toggling blocked and zones follow the stroke's first cell", () => {
    const g = grid();
    expect(paintCell(g, 0, "paint", "road", "", true).terrain[0]).toBe("road");
    expect(paintCell(g, 0, "paint", "a", "", true)).toBe(g);
    expect(paintCell(g, 1, "block", "", "", true).blocked).toEqual([1, 2, 4]);
    expect(paintCell(g, 2, "block", "", "", false).blocked).toEqual([4]);
    expect(paintCell(g, 2, "block", "", "", true)).toBe(g);
    expect(paintCell(g, 3, "zone", "", "z", true).zones.z).toEqual([0, 3, 5]);
    expect(paintCell(g, 3, "zone", "", "", true)).toBe(g);
  });

  test("cellAt maps a screen point through the transform and rejects points outside", () => {
    expect(cellAt({ x: 10, y: 10, k: 20 }, { width: 3, height: 2 }, { x: 55, y: 31 })).toBe(5);
    expect(cellAt({ x: 10, y: 10, k: 20 }, { width: 3, height: 2 }, { x: 5, y: 31 })).toBeNull();
  });
});

describe("track graph layout", () => {
  test("layers by distance from the start; fail edges count; unreachable stages go last", () => {
    const { nodes, edges } = layoutTrack({
      start: "a",
      stages: {
        a: { label: "A", next: [{ to: "b", when: "x" }, { to: "c", when: "y" }] },
        b: { label: "B", next: [{ to: "d", when: "z" }], fail: { when: "f", to: "lost" } },
        c: { label: "C", next: [{ to: "a", when: "back" }] },
        d: { label: "D", next: [] },
        lost: { label: "Lost", next: [] },
        orphan: { label: "O", next: [] },
      },
    });
    const at = Object.fromEntries(nodes.map((n) => [n.id, [n.layer, n.reachable]]));
    expect(at).toEqual({ a: [0, true], b: [1, true], c: [1, true], d: [2, true], lost: [2, true], orphan: [3, false] });
    expect(edges.filter((e) => e.fail)).toEqual([{ from: "b", to: "lost", fail: true }]);
    expect(nodes.find((n) => n.id === "c")?.row).toBe(1);
  });

  test("a missing start leaves every stage unreachable in layer 0", () => {
    const { nodes } = layoutTrack({ start: "nope", stages: { a: { label: "A", next: [] } } });
    expect(nodes).toEqual([{ id: "a", layer: 0, row: 0, reachable: false }]);
  });
});

describe("schedule slots", () => {
  test("a valid day, including a slot past midnight, has no problems", () => {
    expect(slotProblems([{ start: "05:30", end: "14:00", value: "diner" }, { start: "14:00", end: "22:00", value: "home" }, { start: "22:00", end: "05:30", value: "home" }])).toEqual([]);
  });

  test("bad times, overlaps, missing values and zero weights are reported", () => {
    expect(slotProblems([{ start: "9:00", end: "10:00", value: 1 }])).toEqual(["Slot 1: times must be HH:MM"]);
    expect(slotProblems([{ start: "08:00", end: "12:00", value: 1 }, { start: "11:00", end: "13:00", value: 2 }])).toEqual(["Slots 1 and 2 overlap"]);
    expect(slotProblems([{ start: "22:00", end: "02:00", value: 1 }, { start: "01:00", end: "03:00", value: 2 }])).toEqual(["Slots 1 and 2 overlap"]);
    expect(slotProblems([{ start: "08:00", end: "09:00" }])).toEqual(["Slot 1: no value"]);
    expect(slotProblems([{ start: "08:00", end: "09:00", weighted: [{ value: "a", weight: 0 }] }])).toEqual(["Slot 1: weights must add up to more than 0"]);
  });
});

describe("data-table cells", () => {
  test("each column type checks its contract", () => {
    expect(cellProblem({ type: "int" }, 3)).toBeNull();
    expect(cellProblem({ type: "int" }, 3.5)).toBe("Whole number");
    expect(cellProblem({ type: "enum", values: ["a", "b"] }, "c")).toBe("One of a, b");
    expect(cellProblem({ type: "band" }, { min: 1, typical: 2, max: 3 })).toBeNull();
    expect(cellProblem({ type: "band" }, { min: 9, typical: 4, max: 12 })).toBe("min ≤ typical ≤ max");
    expect(cellProblem({ type: "band" }, { min: 1, max: 3 })).toBe("min, typical and max");
    expect(cellProblem({ type: "text" }, undefined)).toBe("Required");
    expect(cellProblem({ type: "text", optional: true }, undefined)).toBeNull();
    expect(cellProblem({ type: "list" }, "x")).toBe("List");
  });
});

describe("job review", () => {
  const p = (id: string, key: string): JobProposal => ({ id, collection: "entities", key, value: { id: key }, source: "lore", confidence: 0.9 });

  test("only accepted proposals become draft puts, in proposal order", () => {
    expect(proposalWrites("w1", [p("1", "a"), p("2", "b"), p("3", "c")], new Set(["3", "1"]))).toEqual([
      { type: "lre.editor", worldId: "w1", base: null, op: "put", collection: "entities", id: "a", value: { id: "a" } },
      { type: "lre.editor", worldId: "w1", base: null, op: "put", collection: "entities", id: "c", value: { id: "c" } },
    ]);
  });

  test("the review groups proposals by pack in first-seen order; no pack is other", () => {
    const groups = proposalGroups([{ ...p("1", "car"), pack: "vehicles" }, { ...p("2", "diner"), pack: "space" }, p("3", "x"), { ...p("4", "van"), pack: "vehicles" }]);
    expect(groups.map((g) => [g.pack, g.proposals.map((q) => q.id)])).toEqual([["vehicles", ["1", "4"]], ["space", ["2"]], ["other", ["3"]]]);
  });

  test("Show value names each lore source by its entry and its book; an id stands in only where no name is known", () => {
    const linked: JobProposal = { ...p("1", "old_lighthouse"), value: { id: "old_lighthouse", name: "The Old Lighthouse", sources: ["b1/e1", "b2/e2", "b3/e3", "b4/e4"] }, sourceNames: { "b1/e1": "Lighthouse", "b4/e4": "Ferry" } };
    expect(shownValue(linked, { b1: "B2 Chat Lore", b2: "B2 Card Lore" })).toEqual({ id: "old_lighthouse", name: "The Old Lighthouse", sources: ["Lighthouse · B2 Chat Lore", "e2 · B2 Card Lore", "b3/e3", "Ferry · b4"] });
    // The value applied to the draft keeps the back-links.
    expect(linked.value).toEqual({ id: "old_lighthouse", name: "The Old Lighthouse", sources: ["b1/e1", "b2/e2", "b3/e3", "b4/e4"] });
    expect(shownValue(p("2", "x"), {})).toEqual({ id: "x" });
  });

  test("an assumed-kind proposal starts unticked whatever its confidence; the rest start ticked from 70%", () => {
    const kindless: JobProposal = { ...p("1", "okafor"), confidence: 0.95, value: { id: "okafor", kind: "thing", assumed: ["kind"] } };
    const tabled: JobProposal = { ...p("2", "lamp"), value: { id: "lamp", assumed: ["catalog"] } };
    const low: JobProposal = { ...p("3", "dog"), confidence: 0.6 };
    expect([...startTicked([kindless, tabled, low, p("4", "diner")])]).toEqual(["2", "4"]);
  });
});

describe("Build kind pickers", () => {
  const container: KindDef = { id: "container", label: "Container", pack: "gear", fields: { stock: { type: "text" }, capacity_l: { type: "number" } } };
  const world = baseWorld({ kinds: { crate: { id: "crate", label: "Crate", extends: "container", fields: { label: { type: "text" } } } } });
  const doc = { ...world, kinds: { container, ...world.kinds } };

  test("pack kinds are pickable and labelled with their pack; world kinds stay plain", () => {
    const options = refOptions(doc, "kinds");
    expect(options).toContainEqual({ value: "container", label: "Container (container, gear pack)" });
    expect(options).toContainEqual({ value: "crate", label: "Crate (crate)" });
  });

  test("a world kind extending a pack kind shows the pack's fields", () => {
    expect(Object.keys(kindFields(doc, "crate")).sort()).toEqual(["capacity_l", "label", "stock"]);
  });
});

describe("time settings patches", () => {
  test("each time control maps to its settings path; scope-less ones without a scope give no patch", () => {
    expect(settingsTimePatch({ control: "tick", scope: { sceneType: "action" }, to: 0.5 })).toEqual({ time: { sceneTicks: { action: 0.5 } } });
    expect(settingsTimePatch({ control: "tick", scope: { all: true }, to: 1 })).toEqual({});
    expect(settingsTimePatch({ control: "interrupt", scope: { interrupt: "bill" }, to: "stop" })).toEqual({ time: { interrupts: { bill: "stop" } } });
    expect(settingsTimePatch({ control: "speed_through", scope: { activity: "sleep" }, to: { mode: "auto", thresholdMinutes: 60 } })).toEqual({ time: { speedThrough: { sleep: { mode: "auto", thresholdMinutes: 60 } } } });
    expect(settingsTimePatch({ control: "pause", scope: { all: true }, to: true })).toEqual({});
  });

  test("Speed through lists its four activities and the world's own, and one without a policy shows none rather than a default", () => {
    const rows = speedRows({ sleep: { mode: "auto", thresholdMinutes: 60 }, ferry: { mode: "offer", thresholdMinutes: 15 } });
    expect(rows.map((r) => r.activity)).toEqual(["sleep", "work_shift", "travel", "waiting", "ferry"]);
    expect(rows.find((r) => r.activity === "sleep")?.policy).toEqual({ mode: "auto", thresholdMinutes: 60 });
    expect(rows.find((r) => r.activity === "travel")?.policy).toBeNull();
  });
});

describe("Play panels", () => {
  const Empty = () => null;
  const panel = (id: string, order: number): PanelDef => ({ id, label: id, order, component: Empty });
  const catalog: UiCatalog = { panels: [panel("core.scene", 10), panel("economy.money", 30), panel("core.journal", 90), panel("gear.gear", 50)], editors: new Map(), configs: new Map(), chips: new Map(), previews: new Map(), packs: [] };

  test("core panels always show; a pack panel shows once its view is in the state", () => {
    const view = { panels: { "economy.money": { level: 1 } } } as unknown as StateView;
    expect(visiblePanels(catalog, view).map((p) => p.id)).toEqual(["core.scene", "economy.money", "core.journal"]);
  });
});

describe("small parsers", () => {
  test("fix values parse by field type and respect min and max; money is typed in the world's currency", () => {
    const usd = { code: "USD", symbol: "$", minorUnit: "cent", decimals: 2, format: "{sign}{symbol}{amount}" };
    const bits = { code: "BIT", symbol: "bits", minorUnit: "bit", decimals: 0, format: "{sign}{amount} bits" };
    expect(parseFixValue({ entity: "e", field: "cash", type: "money", value: 0 }, "12.5", usd)).toBe(1250);
    expect(parseFixValue({ entity: "e", field: "cash", type: "money", value: 0 }, "12.555", usd)).toBeNull();
    expect(parseFixValue({ entity: "e", field: "cash", type: "money", value: 0 }, "5", bits)).toBe(5);
    expect(parseFixValue({ entity: "e", field: "cash", type: "money", value: 0 }, "5.5", bits)).toBeNull();
    expect(parseFixValue({ entity: "e", field: "energy", type: "number", value: 0, min: 0, max: 100 }, "101", usd)).toBeNull();
    expect(parseFixValue({ entity: "e", field: "ok", type: "bool", value: false }, "true", usd)).toBe(true);
    expect(parseFixValue({ entity: "e", field: "tags", type: "list", value: [] }, "[1,2]", usd)).toEqual([1, 2]);
  });

  test("expression balance catches brackets and strings; issues open the item they point at", () => {
    expect(checkBalance("min(a, (b + 1))").ok).toBe(true);
    expect(checkBalance("min(a, b").message).toBe("1 unclosed (");
    expect(checkBalance("a)").message).toBe("Unexpected ) at 2");
    expect(checkBalance("'abc").message).toBe("Unclosed string");
    expect(checkBalance("'a)' + (b)").ok).toBe(true);
    expect(issueTarget("entities.npc_dev.fields.cash")).toEqual({ collection: "entities", id: "npc_dev" });
    expect(issueTarget("lore.store_history.content")).toEqual({ collection: "lore", id: "store_history" });
    expect(issueTarget("calendar.holidays")).toBeNull();
    // A part's issue opens the part, the tiers' and the spawn tier's included.
    expect(issuePart("calendar.holidays")).toBe("calendar");
    expect(issuePart("tiers.crowd.band")).toBe("tiers");
    expect(issuePart("tiers.crowd.label")).toBe("tiers");
    expect(issuePart("spawnTier")).toBe("tiers");
    expect(issuePart("entities.npc_dev.fields.cash")).toBeNull();
  });
});

describe("Build's checkboxes", () => {
  test("a lore secret that isn't a boolean shows ticked, as the engine reads it; another box shows only true", () => {
    const secret = COLLECTION_SPECS.lore.find((s) => s.key === "secret");
    if (secret?.kind !== "bool") throw new Error("no checkbox");
    expect([true, "true", 1, false, undefined].map((v) => boolChecked(secret, v))).toEqual([true, true, true, false, false]);
    const symmetric = { kind: "bool", key: "symmetric", label: "Symmetric" } as const;
    expect([true, "true", 1].map((v) => boolChecked(symmetric, v))).toEqual([true, false, false]);
  });
});

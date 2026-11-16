import { describe, expect, test } from "bun:test";
import { Working } from "../../../src/engine/working";
import { initialState } from "../../../src/engine/world-state";
import { parseLayout } from "../../../src/iface/map/layout";
import { doorEvent, positionEvent, squaresEvent, whereEvent } from "../../../src/iface/map/record";
import { mapView, type MapWording } from "../../../src/iface/map/words";
import { MAP_DEFAULTS } from "../../../src/shared/map-config";
import type { LedgerEvent } from "../../../src/shared/ledger";
import type { StoreState } from "../../../src/store/types";
import { INN, LAYOUT, registry, worldWith } from "./fixtures";
import { Lines } from "../../../src/iface/texts";

const world = worldWith(INN);
const reg = registry();
const env = { registry: reg, worlds: (r: string) => (r === "r" ? world : undefined) };
const wording: MapWording = { lines: Lines.none(), layout: LAYOUT };

/** The chat's store state after `events`. */
function after(...events: LedgerEvent[]): StoreState {
  const w = new Working(reg, world, initialState(world, "r", reg));
  for (const e of events) expect(w.apply(e)).toBeNull();
  return { world: w.state, horizon: [], notes: {}, touched: {}, marks: {}, facts: {} };
}

describe("the map's two layers", () => {
  test("the drawn version changes when a square is edited, and not when someone moves or a door opens", () => {
    const text = (state: StoreState, layer: "drawn" | "moving") => mapView(wording).text({ state, env, place: "common_room", layer });
    const start = text(after(), "drawn");
    const moved = text(after(positionEvent({ scope: "common_room" }, "wren", [3, 3], null) as unknown as LedgerEvent, doorEvent({ scope: "common_room" }, [6, 1], "open") as unknown as LedgerEvent), "drawn");
    const edited = text(after(squaresEvent("inn_room", [{ at: [2, 2], symbol: "#" }], {}) as unknown as LedgerEvent), "drawn");
    expect(moved?.drawn).toBe(start?.drawn);
    expect(edited?.drawn).not.toBe(start?.drawn);
    expect(start?.text).toContain("   2  # . . . . . . . T T  .  #");
    expect(start?.text).not.toContain("Who and what");
    expect(text(after(positionEvent({ scope: "common_room" }, "wren", [3, 3], null) as unknown as LedgerEvent), "moving")?.text).toContain("Wren [wren] (3,3)");
  });

  test("a layout file with the list first and no picture prints the list first and no picture, with no code changed", () => {
    const layout = parseLayout(LAYOUT.source.replace(/\n---\n[\s\S]*$/, "\n---\n{{#list}}\n{{who}}\n{{list}}\n{{/list}}\n{{#title}}\n{{title}}\n{{/title}}\n"));
    const text = mapView({ lines: Lines.none(), layout }).text({ state: after(positionEvent({ scope: "common_room" }, "wren", [3, 3], null) as unknown as LedgerEvent), env, place: "common_room" })?.text ?? "";
    expect(text.startsWith("Who and what is where:")).toBe(true);
    expect(text).not.toContain("   2  #");
    expect(MAP_DEFAULTS.picture).toBe(true);
  });

  test("the list gives a piece's words and activity beside its square, and those with no square their words alone", () => {
    const set = (entity: string, value: string): LedgerEvent => ({ type: "set", entity, field: "activity", value });
    const state = after(
      positionEvent({ scope: "common_room" }, "wren", [6, 5], null) as unknown as LedgerEvent,
      positionEvent({ scope: "common_room" }, "bram", [4, 3], null) as unknown as LedgerEvent,
      set("wren", "standing"),
      whereEvent("bram", { words: "behind the bar" }) as unknown as LedgerEvent,
      whereEvent("cask", { zone: "by the barrels" }) as unknown as LedgerEvent,
    );
    const text = mapView(wording).text({ state, env, place: "common_room" })?.text ?? "";
    expect(text).toContain("you, Wren [wren] (6,5), standing");
    expect(text).toContain("Bram [bram] (4,3), behind the bar");
    expect(text).not.toContain("by the barrels");
  });
});

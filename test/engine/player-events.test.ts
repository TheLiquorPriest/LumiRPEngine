// Player-facing event lines. Visible only when the POV may see the event and has met everyone
// it names; worded with names and labels; never bookkeeping, off-screen NPC↔NPC news or secrets.
import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../src/shared/ledger";
import { createRegistry } from "../../src/engine/registry-impl";
import { metBy, playerDrop, playerLine, playerLines, UNSEEN_DROP } from "../../src/engine/player-events";
import { buildGarageView } from "../../src/packs/vehicles/core/view";
import type { WorldState } from "../../src/engine/state";
import type { WorldDoc } from "../../src/shared/world";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";

const reg = createRegistry(ALL_PACKS);
const TRUTH = "Jordan pockets the tips";

function setup(): { world: WorldDoc; state: WorldState } {
  const world = modernUsWorld("pe", "R");
  world.tracks.tips = { id: "tips", kind: "secret", label: "The missing tips", start: "unseen", visibility: "secret", stages: { unseen: { label: "Unseen", next: [] }, noticed: { label: "Tips go missing", truth: TRUTH, next: [] } } };
  return { world, state: startState(world) };
}

const line = (world: WorldDoc, state: WorldState, e: LedgerEvent): string | null => playerLine(reg, world, state, world.pov, e);

describe("player-facing event lines", () => {
  test("an unmet NPC's move is hidden until the POV knows them; then it reads in names", () => {
    const { world, state } = setup();
    const move: LedgerEvent = { type: "set", entity: "maya", field: "place", value: "park" };
    expect(metBy(state, "you", "maya")).toBe(false);
    expect(line(world, state, move)).toBeNull();
    state.entities.you!.relations.push({ type: "knows", to: "maya" });
    expect(line(world, state, move)).toBe("Maya Chen → Riverside Park");
    expect(line(world, state, { type: "set", entity: "you", field: "place", value: "cafe" })).toBe("You → Daybreak Café");
  });

  test("someone where the POV is counts as met; a secret entity never shows", () => {
    const { world, state } = setup();
    state.entities.maya!.fields.place = "apartment";
    expect(line(world, state, { type: "set", entity: "maya", field: "activity", value: "reading" })).toBe("Maya Chen: reading");
    world.entities.maya!.visibility = "secret";
    expect(line(world, state, { type: "set", entity: "maya", field: "activity", value: "reading" })).toBeNull();
  });

  test("secret-track stages, their truth and their labels stay out; public stages read as labels", () => {
    const { world, state } = setup();
    expect(line(world, state, { type: "stage", track: "tips", to: "noticed" })).toBeNull();
    expect(line(world, state, { type: "engine.note", data: { text: `Rumor: ${TRUTH}` } })).toBeNull();
    expect(line(world, state, { type: "engine.note", data: { text: "Someone mentions The missing tips" } })).toBeNull();
    expect(line(world, state, { type: "stage", track: "first_week", to: "garage" })).toMatch(/^Settle in: /);
  });

  test("bookkeeping, internal fields and off-screen NPC↔NPC regard never show", () => {
    const { world, state } = setup();
    state.entities.you!.relations.push({ type: "knows", to: "maya" }, { type: "knows", to: "jordan" });
    const hidden: LedgerEvent[] = [
      { type: "engine.choice", data: { key: "maya:invite:3", choice: "stay" } },
      { type: "castlife.decision", data: { agent: "maya", choice: "work" } },
      { type: "relationships.regard", data: { from: "maya", to: "jordan", npc: true, delta: 2 } },
      { type: "set", entity: "maya", field: "activity_until", value: 4000 },
      { type: "clock", minutes: 30, cause: "tick" },
    ];
    expect(playerLines(reg, world, state, "you", hidden)).toEqual([]);
  });

  test("lines are deduplicated and capped; a field set several times reads once, at its latest value", () => {
    const { world, state } = setup();
    const e: LedgerEvent = { type: "set", entity: "you", field: "activity", value: "working" };
    expect(playerLines(reg, world, state, "you", [e, e, { type: "set", entity: "you", field: "activity", value: "resting" }])).toEqual(["You: resting"]);
    const moves: LedgerEvent[] = [{ type: "set", entity: "you", field: "place", value: "cafe" }, { type: "set", entity: "you", field: "place", value: "office" }, { type: "set", entity: "you", field: "activity", value: "working" }];
    expect(playerLines(reg, world, state, "you", moves, 1)).toEqual([`You → ${world.places.office?.name}`]);
  });

  test("the weather where the POV stands reads in the montage; another region's stays out", () => {
    const { world, state } = setup();
    state.entities.far = { kind: "region", name: "Far coast", tier: "background", fields: { climate: "temperate", weather: "clear" }, relations: [], levels: {}, agent: false };
    const temps: LedgerEvent[] = [9, 10.5, 12].map((t) => ({ type: "set", entity: "region_riverton", field: "temp_c", value: t }));
    const lines = playerLines(reg, world, state, "you", [{ type: "set", entity: "region_riverton", field: "weather", value: "rain" }, ...temps, { type: "set", entity: "far", field: "weather", value: "snow" }]);
    expect(lines.filter((l) => l.startsWith("Riverton area:")).length).toBe(2);
    expect(lines.some((l) => l.includes("12"))).toBe(true);
    expect(lines.some((l) => l.includes("Far coast"))).toBe(false);
  });

  test("postings read with their amounts and the POV's accounts; the transaction mirror is not repeated", () => {
    const { world, state } = setup();
    const transfer: LedgerEvent = { type: "post", memo: "Transfer", lines: [{ account: "checking", amount: -20000 }, { account: "savings", amount: 20000 }] };
    const mirror: LedgerEvent = { type: "economy.txn", data: { memo: "Transfer", account: "checking", cents: -20000 } };
    expect(playerLines(reg, world, state, "you", [transfer, mirror])).toEqual([`Transfer: $200.00 from ${state.entities.checking!.name} to ${state.entities.savings!.name}`]);
    expect(line(world, state, { type: "post", memo: "Coffee", lines: [{ account: "card", amount: -450 }, { account: "economy.external:cafe", amount: 450 }] })).toBe(`Coffee: −$4.50 (${state.entities.card!.name})`);
  });

  test("past the cap, a payday outranks ordinary lines and routine goes first; kept lines stay in order", () => {
    const { world, state } = setup();
    const routine: LedgerEvent = { type: "set", entity: "you", field: "activity", value: "working" };
    const ordinary: LedgerEvent[] = Array.from({ length: 9 }, (_, i) => ({ type: "set", entity: "you", field: `note_${i}`, value: `n${i}` }));
    const payday: LedgerEvent = { type: "post", memo: "Payroll", lines: [{ account: "economy.external:employer", amount: -75858 }, { account: "checking", amount: 75858 }] };
    const lines = playerLines(reg, world, state, "you", [routine, ...ordinary, payday], 8);
    expect(lines).toHaveLength(8);
    expect(lines.at(-1)).toBe(`Payroll: +$758.58 (${state.entities.checking!.name})`);
    expect(lines).not.toContain("You: working");
    expect(lines.slice(0, 7)).toEqual(Array.from({ length: 7 }, (_, i) => `You: note ${i} n${i}`));
  });

  test("enum values and code-like words read as words", () => {
    const { world, state } = setup();
    expect(line(world, state, { type: "set", entity: "truck", field: "status", value: "needs_service" })).toBe(`${state.entities.truck!.name}: Status needs service`);
    expect(line(world, state, { type: "set", entity: "you", field: "activity", value: "on_shift" })).toBe("You: on shift");
    expect(line(world, state, { type: "set", entity: "you", field: "activity", value: "Reading the paper" })).toBe("You: Reading the paper");
  });

  test("pack lines and panels word their values: a route by its ends, a vehicle's status", () => {
    const { world, state } = setup();
    expect(line(world, state, { type: "space.route", data: { route: "apt_cafe", open: false } })).toBe(`The way from ${world.places.apartment_bldg?.name} to ${world.places.cafe?.name} closes`);
    state.entities.truck!.fields.status = "needs_service";
    const garage = buildGarageView(reg.context(world, state));
    expect(garage.vehicles.find((v) => v.id === "truck")?.status).toBe("needs service");
  });

  test("a dropped change reads as its player line when the POV may see it, else neutrally; the raw reason stays for the GM", () => {
    const { world, state } = setup();
    const reason = "Maya Chen's checking (maya_checking) can't cover $40.00";
    const mine = playerDrop(reg, world, state, "you", { type: "set", entity: "you", field: "place", value: "cafe" }, "no route to cafe");
    expect(mine).toEqual({ text: "You → Daybreak Café", visible: true, gm: "no route to cafe" });
    const unmet = playerDrop(reg, world, state, "you", { type: "set", entity: "maya", field: "place", value: "park" }, reason);
    expect(unmet).toEqual({ text: UNSEEN_DROP, visible: false, gm: reason });
    expect(unmet.text).not.toMatch(/Maya|maya|\$/);
    expect(playerDrop(reg, world, state, "you", { type: "stage", track: "tips", to: "noticed" }, `stage ${TRUTH}`).text).toBe(UNSEEN_DROP);
    expect(playerDrop(reg, world, state, "you", null, "marker 12 made on another branch").text).toBe(UNSEEN_DROP);
  });
});

import { describe, expect, test } from "bun:test";
import { applyDelta, DeltaError } from "../../src/frontend/delta";
import type { DeltaOp } from "../../src/shared/protocol";

interface Fixture {
  hud: Record<string, unknown>;
  chips: { id: string }[];
  panels: { "economy.money": { accounts: { id: string; cents: number }[] }; "gear.gear": { worn: unknown[] } };
}

const base = (): Fixture => ({
  hud: { clock: { minutes: 10, label: "07:10" }, weather: "rain" },
  chips: [{ id: "a" }, { id: "b" }, { id: "c" }],
  panels: { "economy.money": { accounts: [{ id: "cash", cents: 4600 }] }, "gear.gear": { worn: [] } },
});

describe("applyDelta", () => {
  test("sets a nested value copy-on-write: touched path is new, siblings keep identity", () => {
    const before = base();
    const after = applyDelta(before, [{ op: "set", path: ["panels", "economy.money", "accounts", 0, "cents"], value: 3700 }]) as Fixture;
    expect(after.panels["economy.money"].accounts[0]?.cents).toBe(3700);
    expect(before.panels["economy.money"].accounts[0]?.cents).toBe(4600);
    expect(after).not.toBe(before);
    expect(after.panels).not.toBe(before.panels);
    expect(after.panels["gear.gear"]).toBe(before.panels["gear.gear"]);
    expect(after.hud).toBe(before.hud);
    expect(after.chips).toBe(before.chips);
  });

  test("ops apply in order; later ops see earlier results", () => {
    const after = applyDelta(base(), [
      { op: "set", path: ["hud", "weather"], value: "clear" },
      { op: "set", path: ["hud", "wind"], value: "calm" },
      { op: "del", path: ["hud", "weather"] },
    ]) as Record<string, Record<string, unknown>>;
    expect(after.hud).toEqual({ clock: { minutes: 10, label: "07:10" }, wind: "calm" });
  });

  test("array delete splices and set may append exactly at the end", () => {
    const removed = applyDelta(base(), [{ op: "del", path: ["chips", 1] }]) as Fixture;
    expect(removed.chips.map((chip) => chip.id)).toEqual(["a", "c"]);
    const appended = applyDelta(base(), [{ op: "set", path: ["chips", 3], value: { id: "d" } }]) as Fixture;
    expect(appended.chips.map((chip) => chip.id)).toEqual(["a", "b", "c", "d"]);
    const numericString = applyDelta(base(), [{ op: "set", path: ["chips", "0", "id"], value: "z" }]) as Fixture;
    expect(numericString.chips[0]?.id).toBe("z");
  });

  test("an empty path replaces the whole view", () => {
    expect(applyDelta(base(), [{ op: "set", path: [], value: { v: 1 } }])).toEqual({ v: 1 });
  });

  test("paths that do not resolve throw DeltaError (the client resyncs)", () => {
    const cases: DeltaOp[][] = [
      [{ op: "set", path: ["nope", "x"], value: 1 }],
      [{ op: "set", path: ["chips", 5], value: {} }],
      [{ op: "del", path: ["chips", 3] }],
      [{ op: "del", path: ["hud", "missing"] }],
      [{ op: "set", path: ["hud", "weather", "x"], value: 1 }],
      [{ op: "set", path: ["chips", "first"], value: 1 }],
      [{ op: "set", path: ["chips", -1], value: 1 }],
      [{ op: "del", path: [] }],
    ];
    for (const ops of cases) expect(() => applyDelta(base(), ops)).toThrow(DeltaError);
  });

  test("a failed op leaves the original untouched", () => {
    const before = base();
    const snapshot = JSON.stringify(before);
    expect(() =>
      applyDelta(before, [
        { op: "set", path: ["hud", "weather"], value: "snow" },
        { op: "del", path: ["chips", 9] },
      ]),
    ).toThrow(DeltaError);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  test("__proto__ is written as an own key, never as the prototype", () => {
    const after = applyDelta({ panels: {} }, [{ op: "set", path: ["panels", "__proto__"], value: { polluted: true } }]) as Record<string, Record<string, unknown>>;
    expect(Object.prototype.hasOwnProperty.call(after.panels, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(after.panels)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

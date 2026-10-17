import { describe, expect, test } from "bun:test";
import type { UiPackDef } from "../../src/frontend/registry";
import { buildCatalog } from "../../src/frontend/ui-registry";

const Empty = () => null;

describe("UI registry", () => {
  test("panels come out in order, ties broken by id; editors and chips are looked up by key", () => {
    const packs: UiPackDef[] = [
      {
        id: "economy",
        register(r) {
          r.panel({ id: "economy.money", label: "Money", order: 30, component: Empty });
          r.editor({ collection: "tables", label: "Tables", component: Empty });
          r.chip("price", Empty);
        },
      },
      {
        id: "core",
        register(r) {
          r.panel({ id: "core.scene", label: "Scene", order: 10, component: Empty });
          r.panel({ id: "core.journal", label: "Journal", order: 30, component: Empty });
        },
      },
    ];
    const catalog = buildCatalog(packs);
    expect(catalog.panels.map((p) => p.id)).toEqual(["core.scene", "core.journal", "economy.money"]);
    expect(catalog.editors.get("tables")?.label).toBe("Tables");
    expect(catalog.chips.has("price")).toBe(true);
    expect(catalog.packs).toEqual(["economy", "core"]);
  });

  test("a second registration of the same panel, editor, chip kind or pack throws", () => {
    const panel = (id: string): UiPackDef => ({ id, register: (r) => r.panel({ id: "x.p", label: "P", order: 1, component: Empty }) });
    expect(() => buildCatalog([panel("a"), panel("b")])).toThrow("Panel x.p");
    const editor = (id: string): UiPackDef => ({ id, register: (r) => r.editor({ collection: "kinds", label: "K", component: Empty }) });
    expect(() => buildCatalog([editor("a"), editor("b")])).toThrow("kinds");
    const chip = (id: string): UiPackDef => ({ id, register: (r) => r.chip("roll", Empty) });
    expect(() => buildCatalog([chip("a"), chip("b")])).toThrow("roll");
    expect(() => buildCatalog([{ id: "a", register: () => {} }, { id: "a", register: () => {} }])).toThrow("registered twice");
  });
});

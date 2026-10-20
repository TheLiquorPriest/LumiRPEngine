import { describe, expect, test } from "bun:test";
import { fieldEditorFor } from "../../src/frontend/build/schema-form";
import type { UiPackDef } from "../../src/frontend/registry";
import { buildCatalog } from "../../src/frontend/ui-registry";
import type { WorldDoc } from "../../src/shared/world";

const Empty = () => null;

describe("UI registry", () => {
  test("panels come out in order, ties broken by id; editors, chips and sheets are looked up by key", () => {
    const packs: UiPackDef[] = [
      {
        id: "economy",
        register(r) {
          r.panel({ id: "economy.money", label: "Money", order: 30, home: "me", component: Empty });
          r.editor({ collection: "tables", label: "Tables", component: Empty });
          r.chip("price", Empty);
          r.sheet("account", Empty);
        },
      },
      {
        id: "core",
        register(r) {
          r.panel({ id: "core.scene", label: "Scene", order: 10, home: "now", component: Empty });
          r.panel({ id: "core.journal", label: "Journal", order: 30, home: "story", component: Empty });
        },
      },
    ];
    const catalog = buildCatalog(packs);
    expect(catalog.panels.map((p) => p.id)).toEqual(["core.scene", "core.journal", "economy.money"]);
    expect(catalog.panels.map((p) => p.home)).toEqual(["now", "story", "me"]);
    expect(catalog.editors.get("tables")?.label).toBe("Tables");
    expect(catalog.chips.has("price")).toBe(true);
    expect(catalog.sheets.has("account")).toBe(true);
    expect(catalog.sheets.has("person")).toBe(false);
    expect(catalog.packs).toEqual(["economy", "core"]);
  });

  test("glances come out in order, ties broken by id, whichever pack registered them", () => {
    const glance = (id: string, order: number) => ({ id, order, panel: "x.p", component: Empty });
    const catalog = buildCatalog([
      {
        id: "a",
        register(r) {
          r.glance(glance("story.step", 20));
          r.glance(glance("calendar.next", 10));
        },
      },
      {
        id: "b",
        register(r) {
          r.glance(glance("economy.due", 20));
          r.glance(glance("vehicles.due", 5));
        },
      },
    ]);
    expect(catalog.glances.map((g) => g.id)).toEqual(["vehicles.due", "calendar.next", "economy.due", "story.step"]);
  });

  test("a second registration of the same panel, editor, chip kind, sheet kind, glance or pack throws", () => {
    const panel = (id: string): UiPackDef => ({ id, register: (r) => r.panel({ id: "x.p", label: "P", order: 1, home: "now", component: Empty }) });
    expect(() => buildCatalog([panel("a"), panel("b")])).toThrow("Panel x.p");
    const editor = (id: string): UiPackDef => ({ id, register: (r) => r.editor({ collection: "kinds", label: "K", component: Empty }) });
    expect(() => buildCatalog([editor("a"), editor("b")])).toThrow("kinds");
    const chip = (id: string): UiPackDef => ({ id, register: (r) => r.chip("roll", Empty) });
    expect(() => buildCatalog([chip("a"), chip("b")])).toThrow("roll");
    const preview = (id: string): UiPackDef => ({ id, register: (r) => r.preview("maps", Empty) });
    expect(() => buildCatalog([preview("a"), preview("b")])).toThrow("maps");
    const gm = (id: string): UiPackDef => ({ id, register: (r) => r.gm({ id: "x.tab", label: "T", icon: "layers", order: 1, component: Empty }) });
    expect(() => buildCatalog([gm("a"), gm("b")])).toThrow("GM view tab x.tab");
    const field = (id: string): UiPackDef => ({ id, register: (r) => r.field({ kind: "person", field: "flows", component: Empty }) });
    expect(() => buildCatalog([field("a"), field("b")])).toThrow("person.flows");
    const sheet = (id: string): UiPackDef => ({ id, register: (r) => r.sheet("person", Empty) });
    expect(() => buildCatalog([sheet("a"), sheet("b")])).toThrow("A sheet for person (pack b)");
    const glance = (id: string): UiPackDef => ({ id, register: (r) => r.glance({ id: "x.g", order: 1, panel: "x.p", component: Empty }) });
    expect(() => buildCatalog([glance("a"), glance("b")])).toThrow("Glance x.g (pack b)");
    expect(() => buildCatalog([{ id: "a", register: () => {} }, { id: "a", register: () => {} }])).toThrow("registered twice");
  });

  test("the packs' GM view tabs come out in order, ties broken by id", () => {
    const tab = (pack: string, id: `${string}.${string}`, order: number): UiPackDef => ({ id: pack, register: (r) => r.gm({ id, label: id, icon: "layers", order, component: Empty }) });
    const catalog = buildCatalog([tab("minds", "minds.minds", 20), tab("economy", "economy.money", 30), tab("aaa", "aaa.tab", 20)]);
    expect(catalog.gmSections.map((def) => def.id)).toEqual(["aaa.tab", "minds.minds", "economy.money"]);
  });

  test("an entity's structured field gets the editor registered on the nearest kind up its chain", () => {
    const parent = () => null;
    const child = () => null;
    const catalog = buildCatalog([
      {
        id: "economy",
        register(r) {
          r.field({ kind: "person", field: "flows", component: parent });
          r.field({ kind: "shopkeeper", field: "flows", component: child });
        },
      },
    ]);
    const doc = { kinds: { person: { id: "person", label: "Person", fields: {} }, shopkeeper: { id: "shopkeeper", label: "Shopkeeper", extends: "person", fields: {} }, baker: { id: "baker", label: "Baker", extends: "shopkeeper", fields: {} }, crate: { id: "crate", label: "Crate", fields: {} } } } as unknown as WorldDoc;
    expect(fieldEditorFor(catalog.fields, doc, "person", "flows")?.component).toBe(parent);
    expect(fieldEditorFor(catalog.fields, doc, "baker", "flows")?.component).toBe(child);
    expect(fieldEditorFor(catalog.fields, doc, "crate", "flows")).toBeUndefined();
    expect(fieldEditorFor(catalog.fields, doc, "person", "bills")).toBeUndefined();
  });
});

// The UiRegistry implementation (ARCHITECTURE §5). Each pack's ui registers its panels, Build
// editors, config fields, chip renderers, detail sheets, Now glances, GM view tabs and editors for
// its kinds' structured fields; a duplicate registration is a pack conflict and throws, so two packs
// can never silently shadow each other.

import type { ComponentType } from "preact";
import type { PackId } from "../shared/ids";
import type { WorldCollection } from "../shared/protocol";
import type { ChipKind } from "../shared/state-view";
import type { SheetKind } from "./app";
import type { ChipProps, EditorDef, FieldEditorDef, GlanceDef, GmSectionDef, PackConfigProps, PanelDef, PlaceFieldDef, PreviewProps, SheetProps, UiPackDef, UiRegistry } from "./registry";

export interface UiCatalog {
  /** Panels in `order`, ties by id. */
  panels: readonly PanelDef[];
  editors: ReadonlyMap<WorldCollection, EditorDef>;
  /** A pack's config fields, by pack id. */
  configs: ReadonlyMap<PackId, ComponentType<PackConfigProps>>;
  chips: ReadonlyMap<ChipKind, ComponentType<ChipProps>>;
  /** How a job's review draws a proposed value, by collection. */
  previews: ReadonlyMap<WorldCollection, ComponentType<PreviewProps>>;
  /** The packs' GM view tabs in `order`, ties by id. */
  gmSections: readonly GmSectionDef[];
  /** Build's editors for structured fields, by kind and field. */
  fields: readonly FieldEditorDef[];
  /** Build's editors for place fields, in registration order. */
  placeFields: readonly PlaceFieldDef[];
  /** The detail sheet for each kind of thing that has one. */
  sheets: ReadonlyMap<SheetKind, ComponentType<SheetProps>>;
  /** Now's glances in `order`, ties by id. */
  glances: readonly GlanceDef[];
  packs: readonly string[];
}

export function buildCatalog(packs: readonly UiPackDef[]): UiCatalog {
  const panels = new Map<string, PanelDef>();
  const editors = new Map<WorldCollection, EditorDef>();
  const configs = new Map<PackId, ComponentType<PackConfigProps>>();
  const chips = new Map<ChipKind, ComponentType<ChipProps>>();
  const previews = new Map<WorldCollection, ComponentType<PreviewProps>>();
  const gmSections = new Map<string, GmSectionDef>();
  const fields = new Map<string, FieldEditorDef>();
  const placeFields = new Map<string, PlaceFieldDef>();
  const sheets = new Map<SheetKind, ComponentType<SheetProps>>();
  const glances = new Map<string, GlanceDef>();
  const ids = new Set<string>();
  for (const pack of packs) {
    if (ids.has(pack.id)) throw new Error(`UI pack ${pack.id} is registered twice`);
    ids.add(pack.id);
    const registry: UiRegistry = {
      panel(def) {
        if (panels.has(def.id)) throw new Error(`Panel ${def.id} (pack ${pack.id}) is already registered`);
        panels.set(def.id, def);
      },
      editor(def) {
        if (editors.has(def.collection)) throw new Error(`An editor for ${def.collection} (pack ${pack.id}) is already registered`);
        editors.set(def.collection, def);
      },
      config(component) {
        if (configs.has(pack.id)) throw new Error(`Config fields for pack ${pack.id} are already registered`);
        configs.set(pack.id, component);
      },
      chip(kind, component) {
        if (chips.has(kind)) throw new Error(`A chip renderer for ${kind} (pack ${pack.id}) is already registered`);
        chips.set(kind, component);
      },
      preview(collection, component) {
        if (previews.has(collection)) throw new Error(`A preview for ${collection} (pack ${pack.id}) is already registered`);
        previews.set(collection, component);
      },
      gm(def) {
        if (gmSections.has(def.id)) throw new Error(`A GM view tab ${def.id} (pack ${pack.id}) is already registered`);
        gmSections.set(def.id, def);
      },
      field(def) {
        const key = `${def.kind}.${def.field}`;
        if (fields.has(key)) throw new Error(`An editor for the field ${key} (pack ${pack.id}) is already registered`);
        fields.set(key, def);
      },
      placeField(def) {
        if (placeFields.has(def.field)) throw new Error(`An editor for the place field ${def.field} (pack ${pack.id}) is already registered`);
        placeFields.set(def.field, def);
      },
      sheet(kind, component) {
        if (sheets.has(kind)) throw new Error(`A sheet for ${kind} (pack ${pack.id}) is already registered`);
        sheets.set(kind, component);
      },
      glance(def) {
        if (glances.has(def.id)) throw new Error(`Glance ${def.id} (pack ${pack.id}) is already registered`);
        glances.set(def.id, def);
      },
    };
    pack.register(registry);
  }
  return {
    panels: [...panels.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    editors,
    configs,
    chips,
    previews,
    gmSections: [...gmSections.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    fields: [...fields.values()],
    placeFields: [...placeFields.values()],
    sheets,
    glances: [...glances.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    packs: [...ids],
  };
}

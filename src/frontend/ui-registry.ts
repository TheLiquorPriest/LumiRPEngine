// The UiRegistry implementation (ARCHITECTURE §5). Each pack's ui registers its Play panels,
// Build editors and chip renderers; a duplicate registration is a pack conflict and throws, so
// two packs can never silently shadow each other.

import type { ComponentType } from "preact";
import type { WorldCollection } from "../shared/protocol";
import type { ChipKind } from "../shared/state-view";
import type { ChipProps, EditorDef, PanelDef, UiPackDef, UiRegistry } from "./registry";

export interface UiCatalog {
  /** Play panels in `order`, ties by id. */
  panels: readonly PanelDef[];
  editors: ReadonlyMap<WorldCollection, EditorDef>;
  chips: ReadonlyMap<ChipKind, ComponentType<ChipProps>>;
  packs: readonly string[];
}

export function buildCatalog(packs: readonly UiPackDef[]): UiCatalog {
  const panels = new Map<string, PanelDef>();
  const editors = new Map<WorldCollection, EditorDef>();
  const chips = new Map<ChipKind, ComponentType<ChipProps>>();
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
      chip(kind, component) {
        if (chips.has(kind)) throw new Error(`A chip renderer for ${kind} (pack ${pack.id}) is already registered`);
        chips.set(kind, component);
      },
    };
    pack.register(registry);
  }
  const ordered = [...panels.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { panels: ordered, editors, chips, packs: [...ids] };
}

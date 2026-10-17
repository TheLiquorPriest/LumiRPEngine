// A map as Play will draw it, for Build (the map editor and a proposed map): the map's scope with
// the map compiled into the draft in place of any stored version, every place shown, drawn by the
// same stage and drawing as Play's map.

import { useMemo, useState } from "preact/hooks";
import { compileMaps, readMap } from "../../../shared/maps";
import type { MapDoc, WorldDoc } from "../../../shared/world";
import { Empty } from "../../../frontend/components";
import type { PreviewProps } from "../../../frontend/registry";
import { scopeView, type MapScopeView } from "../core/map-scope";
import { MapStage } from "./map";

const NOBODY_INSIDE: ReadonlySet<string> = new Set();

/** The scope `map` draws once it's compiled into `world` under `key`; Build sees every place, at the highest Space level. */
export function previewScope(world: WorldDoc, key: string, map: MapDoc): MapScopeView {
  const doc = compileMaps({ ...world, maps: { ...world.maps, [key]: map } });
  return scopeView(doc, map.scope, { drawn: () => true, known: () => true }, { level: 4, trail: [] });
}

/** A proposed map (Describe a map) as Play will draw it, compiled into the draft. */
export function MapProposalPreview(props: PreviewProps) {
  const scope = useMemo(() => {
    const { map } = readMap(props.value);
    return map ? previewScope(props.world, props.id, map) : null;
  }, [props.world, props.id, JSON.stringify(props.value)]);
  return scope ? <MapPreview scope={scope} height={260} /> : <Empty>This proposal isn't a map the engine can read.</Empty>;
}

export function MapPreview(props: { scope: MapScopeView; height?: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  const place = props.scope.places.find((p) => p.id === selected);
  const grid = props.scope.grid;
  return (
    <div class="lre-stack" data-lre-map-preview={props.scope.id ?? ""}>
      <div class="lre-map" style={{ height: `${props.height ?? 300}px` }}>
        <MapStage scope={props.scope} here={null} inside={NOBODY_INSIDE} selected={selected} onTap={(p) => setSelected(p?.id ?? null)} top={8} />
      </div>
      <span class="lre-small lre-muted">
        {place
          ? `${place.name} · ${place.id}`
          : `${props.scope.name}: ${props.scope.places.length} place${props.scope.places.length === 1 ? "" : "s"}${grid ? ` on a ${grid.width} × ${grid.height} grid` : ""}. Tap a place for its id.`}
      </span>
    </div>
  );
}

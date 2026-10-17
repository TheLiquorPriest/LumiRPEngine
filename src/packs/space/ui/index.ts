// Space & travel UI: the map panel (also shown in the fullscreen float widget) and the Build
// editors for places, routes, grids (the map/grid special widget) and maps (lre-map-v1).

import type { UiPackDef } from "../../../frontend/registry";
import { GridEditor, PlaceEditor } from "./editors";
import { MapPanel } from "./map";
import { MapEditor } from "./map-editor";

const space: UiPackDef = {
  id: "space",
  register(r) {
    r.panel({ id: "space.map", label: "Map", order: 15, component: MapPanel });
    r.editor({ collection: "grids", label: "Grids", component: GridEditor });
    r.editor({ collection: "places", label: "Places", component: PlaceEditor });
    r.editor({ collection: "maps", label: "Maps", component: MapEditor });
  },
};

export default space;

// Space & travel UI: the map panel (also shown in the map overlay), the place sheet, and the Build
// editors for places, routes, grids (the map/grid special widget) and maps (lre-map-v1).

import type { UiPackDef } from "../../../frontend/registry";
import { GridEditor, PlaceEditor } from "./editors";
import { MapPanel } from "./map";
import { MapEditor } from "./map-editor";
import { MapProposalPreview } from "./map-preview";
import { PlaceSheet } from "./place";

const space: UiPackDef = {
  id: "space",
  register(r) {
    r.panel({ id: "space.map", label: "Map", order: 15, home: "places", component: MapPanel });
    r.sheet("place", PlaceSheet);
    r.editor({ collection: "grids", label: "Grids", component: GridEditor });
    r.editor({ collection: "places", label: "Places", component: PlaceEditor });
    r.editor({ collection: "maps", label: "Maps", component: MapEditor });
    r.preview("maps", MapProposalPreview);
  },
};

export default space;

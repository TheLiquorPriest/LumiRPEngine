// The map's face for the engine's tools (plan §8.2): what the map tools (`map_lay`, `map_edit`,
// `map_place`, `map_view`, `map_measure`, `map_door`), the everyday operations and the world state
// call. The grid's geometry itself (squares, ways, measuring, sight) is the space pack's
// (`packs/space/core/grid-model.ts`, `grid-path.ts`, `grid-measure.ts`), read from there.

export { printMap, type LegendEntry, type Listed, type Printed } from "./print";
export { layForPlace, layOverSquare, plainRows, type Laid, type Laying } from "./lay";
export { editMap, type Stroke } from "./edit";
export { roundsClock, type RoundsClock } from "./time";
export { doorEvent, draftChange, positionChange, positionChanges, positionEvent, shapeEvent, squaresEvent } from "./record";
export { beside, gridMoves, inZone } from "./moves";
export { amountOf, distanceData, farText, layersAt, MAP_ANSWERS, mapLines, mapView, mapWording, mapWords, NO_WORDING, type Layers, type MapWording } from "./words";
export { DIAGONALS, MAP_DEFAULTS, MAP_SETTING_DEFS, MAP_SETTINGS, mapConfigRead, UNITS, type MapConfig, type Unit } from "./settings";

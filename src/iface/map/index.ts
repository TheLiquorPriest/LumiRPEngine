// The grid (plan §8.2) on today's maps: what the map tools (`map_lay`, `map_edit`, `map_place`,
// `map_view`, `map_measure`, `map_door`), the everyday operations and the world state call.

export {
  blockersOf,
  cellOf,
  doorState,
  drawnOf,
  footprint,
  indexOf,
  laidMetres,
  lift,
  METRES_PER_FOOT,
  movingOf,
  NOTHING_MOVES,
  place,
  putOn,
  scaleOf,
  setDoor,
  squareAt,
  squareKey,
  squareOf,
  standsAt,
  type Blockers,
  type Diagonal,
  type DoorState,
  type Drawn,
  type Moving,
  type Piece,
  type Placed,
  type Scale,
  type Square,
  type StoredMoving,
  type TimeStep,
} from "./grid";
export { between, burst, cone, distance, line, sees, within, type Area, type Spot } from "./measure";
export { move, walk, type Moved, type Walk } from "./path";
export { printMap, type LegendEntry, type Listed, type Printed } from "./print";
export { layForPlace, layOverSquare, plainRows, type Laid, type Laying } from "./lay";
export { editMap, type Stroke } from "./edit";
export { clockChange, moveTime, roundsTime, type Took } from "./time";
export { doorEvent, draftChange, positionChange, positionChanges, positionEvent, shapeEvent, squaresEvent } from "./record";
export { beside, gridMoves, inZone } from "./moves";
export { amountOf, distanceData, farText, layersAt, MAP_ANSWERS, mapLines, mapView, mapWords, type Layers } from "./words";
export { DIAGONALS, MAP_DEFAULTS, MAP_SETTING_DEFS, MAP_SETTINGS, mapConfigRead, UNITS, type MapConfig, type Unit } from "./settings";

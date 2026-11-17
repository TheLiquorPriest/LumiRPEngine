// The engine's interface for agents (plan §6.8): what the turn (`src/turn/`) calls to hand RPH the
// engine's tools, and the faces other modules fill in (what time brings due, the state search, the
// fact store, squares and maps).

export { engineTools, ENGINE_TOOLS, FIXED_TOOLS, ANSWERS_PART, answerLines } from "./tools";
export { stateScan } from "./search";
export { HISTORY_PART, historyLines, installHistoryLines } from "./history-lines";
export { bestiaryOf, bestiaryRow, rulesetData, BESTIARY_TABLE, BESTIARY_COLUMNS, BESTIARY_SCHEMA, type BestiaryRow } from "./bestiary";
export { OPERATIONS, OPERATION_NAMES } from "./apply";
export { shippedTexts, SHIPPED_GUIDANCE, Lines, Template, toolText, type GuidanceFiles, type TextKind, type ToolText } from "./texts";
export {
  IFACE_DEFAULTS,
  IFACE_SETTING_DEFS,
  IFACE_SETTINGS,
  type DueItem,
  type DueList,
  type DueListing,
  type EngineDeps,
  type FactStore,
  type FactWrite,
  type IfaceSettings,
  type SearchKind,
  type StateHit,
  type StateSearch,
  type ToolSpec,
  type Writes,
} from "./kit";
export { MARKS } from "./source";
export { MAP_TOOLS } from "./maptools";
export type { GridMoves, MapLayer, MapPrinted, MapView } from "./map/ports";
export { gridMoves, MAP_ANSWERS, mapLines, mapView, mapWording, NO_WORDING, noMapWords, type MapWording } from "./map/index";

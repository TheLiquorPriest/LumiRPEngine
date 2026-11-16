// The places' public face: a place's record by its parts, its area of the store (the base), the lines the tree carries and what the
// engine's operations take from it.

export { baseAt, type PlaceBaseShown } from "./base";
export { BASE_KEYS, drawnAgainst, prepareBases } from "./prepare";
export { baseOf, PLACE_AREA_ID, PLACE_OPS, PLACE_STORE_AREA, placeSliceOf, type SourceDoc, sourcesOf, type SourceValue, type BaseDoc, type BaseVersionDoc, type PlaceSlice } from "./fold";
export { type PlaceLinesInput, placeLines, placeLinesAt, withPlaceLines } from "./lines";
export { isPlaceFactPart, PLACE_FACT_PARTS, PLACE_PARTS, type PlaceFactPart, type PlacePart } from "./parts";
export { accessOf, doorsOf, entryOf, type FactReader, factReader, factsOfPart, featuresOf, fixturesOf, gridOf, newest, type PlaceAt, placeAt, placeAtState, placeDef, placeKindOf, rowFields, sinceOf, zonesOf } from "./record";
export { PLACES_DEFAULTS, PLACES_SETTING_DEFS, PLACES_SETTINGS, type PlacesSettings } from "./settings";
export { drawnFrom, type EntryNow, type PlaceBinding, type PlaceSources, type PlaceSourceShown, type PlaceSourcesReader, sourcesNow } from "./sources";
export { type PlaceReadDeps, placeRow, placeRows, readPlace, sourceRows } from "./read";
export { PLACE_BASE_PATH, PLACE_PATH, PLACES_PATH, placesRoutes, type PlacesRoutesDeps } from "./routes";
export { makePlace, PLACE_MAKE_KINDS, sourcesArg } from "./make";
export { adjoiningOf, routesLaidIn, type PlaceAdjoining, type PlaceWay, waysOf, waysPart } from "./ways";
export { hereOf, historyOf, knownOf, type PlaceHere, type PlaceHistoryRow, type PlaceKnown } from "./whole";
export { type PlaceWriter, writeBase } from "./write";
export { type PlaceBaseBody, type PlaceBaseWritten, type PlaceRecordAnswer, type PlaceRowShown, type PlacesPage } from "./shapes";
export { type CastKnowledge, knowledgeNaming, knownByCast, type Knowing } from "./known";

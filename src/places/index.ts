// The places' public face: a place's record by its parts, its area of the store (the base), the lines the tree carries and what the
// engine's operations take from it.

export { baseOf, PLACE_AREA_ID, PLACE_OPS, PLACE_STORE_AREA, placeSliceOf, type BaseDoc, type BaseVersionDoc, type PlaceSlice } from "./fold";
export { type PlaceLinesInput, placeLines } from "./lines";
export { isPlaceFactPart, PLACE_FACT_PARTS, PLACE_PARTS, type PlaceFactPart, type PlacePart } from "./parts";
export { accessOf, doorsOf, entryOf, type FactReader, factReader, factsOfPart, featuresOf, fixturesOf, gridOf, newest, type PlaceAt, placeAt, placeDef, placeKindOf, rowFields, sinceOf, zonesOf } from "./record";
export { PLACES_DEFAULTS, PLACES_SETTING_DEFS, PLACES_SETTINGS, type PlacesSettings } from "./settings";
export { drawnFrom, type EntryNow, type PlaceBinding, type PlaceSources, type PlaceSourceShown, type PlaceSourcesReader, sourcesNow } from "./sources";

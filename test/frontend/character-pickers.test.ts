// The character pickers (DESIGN §7, the Character model) over the preview's 320-place world: a
// search finds places by any word of their name or of the places around them, browsing drills down
// by parent ids (names repeat), the bed picker offers home, then the rooms there, then the beds, and
// a list of text changes a word at a time.

import { describe, expect, test } from "bun:test";
import { bedValue } from "../../src/frontend/character/bed-picker";
import { bedOf, bedOptions, browseStart, pathLabel, placeIndex, SEARCH_LIMIT, searchPlaces, searchThings, trailTo, withText } from "../../src/frontend/character/places";
import { PICKER_CHARACTER, PICKER_PLACES, PICKER_THINGS } from "../../dev/preview/character-fixture";

const index = placeIndex(PICKER_PLACES);

describe("the place picker", () => {
  test("the fixture is the user's world's size and depth", () => {
    expect(PICKER_PLACES.length).toBe(320);
    expect(Math.max(...PICKER_PLACES.map((p) => p.path.length))).toBe(6);
  });

  test("a search matches words of the name or of the path, and each result carries its path", () => {
    // Every word is the start of a word of the name or the path ("apartments" is the building's,
    // not every flat's "Apartment"); the shallower first.
    const hits = searchPlaces(index, "riverton elm apartments 2b");
    expect(hits.map(pathLabel)).toEqual([
      "Riverton › Elm Street › Elm Street Apartments › Floor 1 › Apartment 2B",
      "Riverton › Elm Street › Elm Street Apartments › Floor 1 › Apartment 2B › Bedroom",
      "Riverton › Elm Street › Elm Street Apartments › Floor 1 › Apartment 2B › Kitchen",
      "Riverton › Elm Street › Elm Street Apartments › Floor 1 › Apartment 2B › Bedroom › Closet",
    ]);
    // A name that repeats (every flat has a Kitchen) is told apart by the path words typed with it.
    const kitchens = searchPlaces(index, "kitchen riverton elm apartments 2b");
    expect(kitchens.map((p) => p.id)).toEqual(["riverton_elm_street_b1_f1_u2_kitchen"]);
    // A place named by every word comes before one that only lies inside such a place.
    const harbor = searchPlaces(index, "harbor");
    expect(harbor[0]?.name).toBe("Harbor");
    expect(harbor.every((p) => p.name.toLowerCase().includes("harbor") || p.path.some((n) => n.toLowerCase().includes("harbor")))).toBe(true);
    // A broad search (64 kitchens) stops at its limit.
    expect(searchPlaces(index, "kitchen").length).toBe(SEARCH_LIMIT);
    expect(searchPlaces(index, "  ")).toEqual([]);
  });

  test("browsing starts among the current place's neighbours and drills down by parent, each level with how many it holds", () => {
    const roots = index.children.get(null) ?? [];
    expect(roots.map((p) => p.name)).toEqual(["Cedar Hollow", "Lake County", "Port Alder", "Riverton"]);
    const home = PICKER_CHARACTER.home;
    if (!home) throw new Error("no home");
    // From the flat, browsing opens on its floor: the flat among its neighbours.
    const start = browseStart(index, home.id);
    expect(start).toBe("riverton_elm_street_b1_f1");
    expect((index.children.get(start) ?? []).map((p) => p.name)).toEqual(["Apartment 1A", "Apartment 2B"]);
    expect(trailTo(index, start).map((p) => p.name)).toEqual(["Riverton", "Elm Street", "Elm Street Apartments", "Floor 1"]);
    // Drilling into Riverton shows its districts; two flats' Kitchens are different places.
    expect((index.children.get("riverton") ?? []).map((p) => p.name)).toEqual(["Elm Street", "Harbor", "Mill Row", "Old Town"]);
    expect((index.children.get(home.id) ?? []).map((p) => [p.name, index.children.get(p.id)?.length ?? 0])).toEqual([
      ["Bedroom", 1],
      ["Kitchen", 0],
    ]);
    // With no current place it starts at the roots.
    expect(browseStart(index, null)).toBeNull();
  });
});

describe("the bed picker", () => {
  test("it offers sleeping at home first, then the rooms in their home, then the beds lying there", () => {
    const options = bedOptions(PICKER_CHARACTER);
    expect(options.map((o) => (o.kind === "home" ? "home" : o.kind === "place" ? `room:${o.place.name}` : `item:${o.item.name}`))).toEqual(["home", "room:Bedroom", "room:Kitchen", "room:Closet", "item:Double bed", "item:Futon"]);
    // What each choice writes to the bed field: nothing for home, else the place's or the thing's id.
    expect(options.map((o) => bedValue(bedOf(o)))).toEqual([null, "riverton_elm_street_b1_f1_u2_bedroom", "riverton_elm_street_b1_f1_u2_kitchen", "riverton_elm_street_b1_f1_u2_bedroom_closet", "maya_bed", "maya_futon"]);
  });

  test("a thing somewhere else is found by its name or where it lies, with its place's path", () => {
    expect(searchThings(PICKER_THINGS, "hammock").map((t) => [t.name, t.place ? pathLabel(t.place) : null])).toEqual([["Hammock", "Riverton › Harbor › Harbor Court › Floor 1 › Apartment 1A › Bedroom"]]);
    expect(searchThings(PICKER_THINGS, "old town kitchen").map((t) => t.name)).toEqual(["Old couch"]);
  });
});

describe("the text list", () => {
  test("adding trims and collapses spaces; a blank one or one already there, in any case, adds nothing", () => {
    expect(withText(["patient"], "  night   owl ")).toEqual(["patient", "night owl"]);
    expect(withText(["patient"], "Patient")).toEqual(["patient"]);
    expect(withText(["patient"], "   ")).toEqual(["patient"]);
  });
});

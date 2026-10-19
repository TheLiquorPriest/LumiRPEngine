// The world packs' rules for People, Places and Story: how the cast list splits and what a row says
// of someone away, where the POV stands with a place, how terrain names map to fills, and which
// quest Now's glance follows.

import { describe, expect, test } from "bun:test";
import { castSections, decodeCastView, whereabouts } from "../../src/packs/castlife/ui/panel";
import type { CanvasPalette } from "../../src/packs/space/ui/canvas-theme";
import { terrainFill } from "../../src/packs/space/ui/map-draw";
import { placeStatus } from "../../src/packs/space/ui/place";
import { decodeMapView } from "../../src/packs/space/ui/view";
import { decodeQuestsView, objectiveCount, questInHand } from "../../src/packs/story/ui/panel";

const cast = decodeCastView({
  level: 3,
  people: [
    { id: "mara", name: "Mara", role: "Cook", here: false, lastSeen: { place: "the diner", at: "Mon 21:40" }, tier: "supporting", classes: {}, groups: [] },
    { id: "rosie", name: "Rosie", role: "Boss", here: true, activity: "Working", tier: "principal", classes: {}, groups: [] },
    { id: "okafor", name: "Mr. Okafor", role: "Regular", here: false, place: "the park", tier: "", classes: {}, groups: [] },
  ],
  tiers: [
    { id: "principal", label: "Leads" },
    { id: "supporting", label: "Supporting" },
  ],
});

describe("the cast list", () => {
  test("by default, the people here come first, then the rest the POV knows; an empty side is left out", () => {
    if (!cast) throw new Error("no cast");
    expect(castSections(cast, cast.people, "none").map((s) => [s.label, s.people.map((p) => p.id)])).toEqual([
      ["Here", ["rosie"]],
      ["People you know", ["mara", "okafor"]],
    ]);
    expect(castSections(cast, cast.people.filter((p) => !p.here), "none").map((s) => s.label)).toEqual(["People you know"]);
  });

  test("grouped another way, sections follow that order, and anyone outside it closes the list", () => {
    if (!cast) throw new Error("no cast");
    expect(castSections(cast, cast.people, "tier").map((s) => [s.label, s.people.map((p) => p.id)])).toEqual([
      ["Leads", ["rosie"]],
      ["Supporting", ["mara"]],
      ["No tier", ["okafor"]],
    ]);
  });

  test("a row says what someone here is doing, else where and when the POV last saw them", () => {
    if (!cast) throw new Error("no cast");
    const [mara, rosie, okafor] = cast.people;
    expect([rosie && whereabouts(rosie), mara && whereabouts(mara), okafor && whereabouts(okafor)]).toEqual(["Working", "Last seen Mon 21:40 at the diner", "the park"]);
  });
});

describe("where the POV stands with a place", () => {
  const view = decodeMapView({
    here: "diner",
    path: ["town", "diner"],
    scope: "town",
    scopes: [
      {
        id: "town",
        name: "Town",
        places: [
          { id: "diner", name: "Diner", x: 0, y: 0, known: true, visited: true },
          { id: "garage", name: "Garage", x: 1, y: 0, known: true, visited: true },
          { id: "lake", name: "Lake", x: 2, y: 0, known: true, visited: false },
          { id: "~1", name: "Somewhere", x: 3, y: 0, known: false, visited: true },
        ],
      },
      { id: null, name: "World", places: [{ id: "town", name: "Town", x: 0, y: 0, known: true, visited: true }] },
    ],
  });

  test("here, inside, been there, heard of, or a place it can't tell", () => {
    if (!view) throw new Error("no map");
    const status = (scope: number, id: string) => {
      const place = view.scopes[scope]?.places.find((p) => p.id === id);
      return place ? placeStatus(view, place).short : null;
    };
    expect([status(0, "diner"), status(1, "town"), status(0, "garage"), status(0, "lake"), status(0, "~1")]).toEqual(["You're here", "You're inside", "Been there", "Heard of", "Somewhere"]);
  });
});

describe("terrain fills", () => {
  const palette: CanvasPalette = { bg: "bg", ink: "ink", muted: "muted", line: "line", pov: "pov", fog: "fog", item: "item", series: ["s1", "s2", "s3", "s4", "s5", "s6"], font: "sans-serif" };

  test("the first word that matches decides: a wood floor is a floor, not a forest", () => {
    expect(terrainFill("Wood floor", palette)).toEqual(terrainFill("floor", palette));
    expect(terrainFill("oak forest", palette).color).toBe("s1");
    expect(terrainFill("oak forest", palette)).not.toEqual(terrainFill("wood floor", palette));
  });

  test("walls take the ink, and ground with no name of its own reads as floor", () => {
    expect(terrainFill("stone wall", palette).color).toBe("ink");
    expect(terrainFill("", palette)).toEqual(terrainFill("floor", palette));
    expect(terrainFill("glimmerweave", palette)).toEqual(terrainFill("floor", palette));
  });
});

describe("the quest in hand", () => {
  const log = (value: unknown) => decodeQuestsView(value)?.tracks ?? [];

  test("a quest leads over other kinds; its next step is the first objective not done", () => {
    const tracks = log({
      active: [
        { id: "boat", label: "Dev's boat", kind: "agenda", objectives: [{ label: "Find a part", done: false }] },
        { id: "raise", label: "Ask for a raise", kind: "quest", objectives: [{ label: "Cover shifts", done: true }, { label: "Get a voucher", done: false }, { label: "Ask", done: false }] },
      ],
      done: [{ id: "lease", label: "Renew the lease", kind: "quest", objectives: [] }],
    });
    const hand = questInHand(tracks);
    expect([hand?.track.id, hand?.next?.label, hand && objectiveCount(hand.track)]).toEqual(["raise", "Get a voucher", "1 of 3"]);
  });

  test("with no quest under way, any active track; with nothing active, nothing", () => {
    expect(questInHand(log({ active: [{ id: "boat", label: "Dev's boat", kind: "agenda", objectives: [] }] }))?.track.id).toBe("boat");
    expect(questInHand(log({ active: [], done: [{ id: "lease", label: "Renew the lease", kind: "quest", objectives: [] }] }))).toBeNull();
  });
});

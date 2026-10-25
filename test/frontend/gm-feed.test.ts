// GM → This chat → Sections (DESIGN §6.11): a save sends the form's settings whole, so a cap the GM
// switched off is gone from them, and the chat's settings stand in place of the world's. Sources are
// ticked by what they tell; ticking just a section's own is no pick at all.

import { describe, expect, test } from "bun:test";
import { chatFeedOf, feedSummary, ownSources, SCOPE_LABEL, sourcesMissing, sourcesTaken } from "../../src/frontend/gm/feed";

const SOURCES = [
  { id: "location", slot: "scene", label: "Where" },
  { id: "weather", slot: "scene", label: "Weather" },
  { id: "place", slot: "place", label: "The place" },
  { id: "place_lore", slot: "place", label: "Lore" },
];

describe("the GM's section settings form", () => {
  test("a cap switched off is no cap in what is sent; what is set is sent whole", () => {
    expect(chatFeedOf({ maxLines: undefined, maxTokens: undefined, scope: "gm" }, ["location", "weather"], ["location", "weather"])).toEqual({ scope: "gm" });
    expect(chatFeedOf({ enabled: false, maxLines: 3 }, ["location", "weather"], ["place", "place_lore"])).toEqual({ enabled: false, maxLines: 3, include: ["location", "weather"] });
  });

  test("ticking exactly a section's own sources, in any order, sends no pick", () => {
    const own = ownSources(SOURCES, "place");
    expect(own).toEqual(["place", "place_lore"]);
    expect(chatFeedOf({}, ["place_lore", "place"], own).include).toBeUndefined();
    expect(chatFeedOf({}, ["place"], own).include).toEqual(["place"]);
    expect(chatFeedOf({}, ["place", "place_lore", "weather"], own).include).toEqual(["place", "place_lore", "weather"]);
  });

  test("the boxes start ticked as the feed takes them: its pick, else its own", () => {
    expect(sourcesTaken({}, SOURCES, "scene")).toEqual(["location", "weather"]);
    expect(sourcesTaken({ include: ["place_lore"] }, SOURCES, "scene")).toEqual(["place_lore"]);
  });

  test("a row says the scope in the dropdown's own words, and an off section only that it's off", () => {
    for (const scope of ["player", "scene", "gm"] as const) expect(feedSummary({ scope })).toContain(SCOPE_LABEL[scope]);
    expect(feedSummary({})).toContain(SCOPE_LABEL.player);
    const off = feedSummary({ enabled: false, scope: "gm" });
    expect(off).not.toContain(SCOPE_LABEL.gm);
    expect(off).not.toBe(feedSummary({ scope: "gm" }));
  });

  test("a section with no sources of its own saves its caps for this chat; one with sources needs one ticked", () => {
    // Outline: no renderer fills it, so its boxes start empty and stay so.
    const own = ownSources(SOURCES, "outline");
    const picked = sourcesTaken({}, SOURCES, "outline");
    const draft = { maxTokens: 300 };
    expect(sourcesMissing(draft, picked, own)).toBe(false);
    expect(chatFeedOf(draft, picked, own)).toEqual({ maxTokens: 300 });
    // Place has its own: nothing ticked blocks the save, unless the section is switched off.
    expect(sourcesMissing({}, [], ownSources(SOURCES, "place"))).toBe(true);
    expect(sourcesMissing({ enabled: false }, [], ownSources(SOURCES, "place"))).toBe(false);
  });
});

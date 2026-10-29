// GM → This chat → Sections (DESIGN §6.11): a save sends the form's settings whole, so a cap the GM
// switched off is gone from them, and the chat's settings stand in place of the world's. Sources are
// ticked by what they tell; ticking just a section's own is no pick at all.

import { describe, expect, test } from "bun:test";
import { chatFeedOf, feedNoticeStands, feedSummary, ownSources, sourcesMissing, sourcesTaken } from "../../src/frontend/gm/feed";
import { feedSentence } from "../../src/shared/words";
import { SCOPE_LABEL } from "../../src/shared/world";

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

  test("a scope the GM sets is kept, the player's included; unset sends none and follows the narrator's knowledge", () => {
    for (const scope of ["player", "scene", "gm"] as const) expect(chatFeedOf({ scope }, [], []).scope).toBe(scope);
    expect(chatFeedOf({}, [], [])).toEqual({});
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
    // Unset follows the narrator's knowledge: it reads as none of the scopes.
    for (const scope of ["player", "scene", "gm"] as const) expect(feedSummary({})).not.toBe(feedSummary({ scope }));
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

  test("a save leaves a notice naming the section and what this chat now sets, and its Undo stands while its chip does", () => {
    const capped = feedSentence("Outline", { maxTokens: 400 });
    expect(capped).toContain("Outline");
    expect(capped).toContain("400");
    // Going back to the world's, switching off, a wider scope and the plain section each read differently.
    const notices = [feedSentence("Outline", null), feedSentence("Outline", { enabled: false }), feedSentence("Outline", { scope: "gm" }), feedSentence("Outline", { scope: "scene" }), feedSentence("Outline", {}), capped];
    expect(new Set(notices).size).toBe(notices.length);
    // A sentence, never the section's label glued to a value.
    for (const notice of notices) expect(notice).not.toMatch(/^Outline:/);
    const notice = { text: capped, undo: ["fix:m4:0:3"] };
    expect(feedNoticeStands(notice, [{ id: "fix:m4:0:3" }, { id: "other" }])).toBe(true);
    expect(feedNoticeStands(notice, [{ id: "other" }])).toBe(false);
  });
});

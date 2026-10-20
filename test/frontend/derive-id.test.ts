import { describe, expect, test } from "bun:test";
import { deriveId } from "../../src/frontend/build/schema";

const none = new Set<string>();

describe("ids derived from names", () => {
  test("a name becomes lower snake case, without accents, apostrophes or stray separators", () => {
    expect(deriveId("Old Lighthouse", none)).toBe("old_lighthouse");
    expect(deriveId("  Café -- Noir! ", none)).toBe("cafe_noir");
    expect(deriveId("Bob's Diner", none)).toBe("bobs_diner");
    expect(deriveId("Straße Œuvre", none)).toBe("strasse_oeuvre");
  });

  test("a leading digit gets an x, so a formula can name the id", () => {
    expect(deriveId("42nd Street", none)).toBe("x42nd_street");
  });

  test("a taken id counts up from _2, and the prototype keys count as taken", () => {
    expect(deriveId("Old Lighthouse", new Set(["old_lighthouse"]))).toBe("old_lighthouse_2");
    expect(deriveId("Old Lighthouse", new Set(["old_lighthouse", "old_lighthouse_2"]))).toBe("old_lighthouse_3");
    expect(deriveId("Constructor", none)).toBe("constructor_2");
  });

  test("a name without a letter or digit gives item", () => {
    expect(deriveId("東京", none)).toBe("item");
    expect(deriveId("", new Set(["item"]))).toBe("item_2");
  });

  test("ids stay within 64 characters, the suffix included", () => {
    const long = "word ".repeat(30);
    const first = deriveId(long, none);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(first.endsWith("_")).toBe(false);
    const second = deriveId(long, new Set([first]));
    expect(second.length).toBeLessThanOrEqual(64);
    expect(second.endsWith("_2")).toBe(true);
    expect(second).not.toContain("__");
  });
});

// The bootstrap on the pages: on a chat's Story page, the six facts of "done enough" as the route gives
// them (each with its counts, or not known with the page's words for why), with no verdict on any of
// them, since whether the record is done enough is the bootstrap skill's to say. The start with its
// limit and caps, the question of a job that asks, the jobs a page at a time and the Migration page's
// offer are for the hardening build's tests. Every name and number here is made up.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { FactsView } from "../../src/ui/pages/bootstrap";
import { BOOT } from "./bootstrap-recorded";
import { elements, expand, textOf } from "./vnodes";

// The start and the question hold state of their own (hooks), which this expansion does not run: the facts are drawn by themselves.
function view() {
  const tree = expand(h(FactsView, { facts: BOOT.facts }));
  return { tree, text: textOf(tree) };
}

const fact = (tree: unknown, id: string): string => textOf(elements(tree).find((e) => e.props["data-fact"] === id)?.props.children);

describe("the bootstrap on a chat's page", () => {
  test("the six facts in the skill's order, each with its counts, or not known in the page's words; none says whether it holds", () => {
    const { tree } = view();
    expect(elements(tree).flatMap((e) => (typeof e.props["data-fact"] === "string" ? [e.props["data-fact"]] : []))).toEqual(["lore", "history", "cast", "story", "horizon", "principals"]);
    expect(fact(tree, "lore")).toBe("The lore index12 entries, 12 indexed as they stand, 0 indexed at an earlier revision");
    expect(fact(tree, "history")).toBe("The history the window leaves outnot knownIts records could not be read; RPE's log says what failed.");
    expect(fact(tree, "cast")).toBe("The cast3 characters, 2 castNot cast: Tobin Reede");
    expect(fact(tree, "story")).toContain("1 premise, 1 chapter, 2 scenes, 5 beats");
    expect(fact(tree, "story")).toContain("2 threads (1 open), 0 arcs, 1 reading of the player");
    expect(fact(tree, "story")).toContain("0 of 1 principal with an arc");
    expect(fact(tree, "horizon")).toBe("The horizon2 entries, 1 naming a place or thing of the world; story time kept");
    expect(fact(tree, "principals")).toBe("Each principal's base and memoriesOdile Holt: base seed; 0 memories");
    expect(textOf(elements(tree).find((e) => e.props["data-facts"] === "true")?.props.children)).not.toMatch(/\bhold/);
  });
});

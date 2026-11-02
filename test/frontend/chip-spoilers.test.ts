// Spoilers on the player's chips (DESIGN §5.2, §7.1: secrecy is guidance, never a filter): an
// outline gate's line carrying a secret and a suggestion carrying one are shown, but each collapsed
// in a spoiler the player taps open; a chip without one shows as it is.

import { describe, expect, test } from "bun:test";
import { h, type VNode } from "preact";
import { Spoiler, SpoilerLines, SuggestionPill } from "../../src/frontend/chips";
import { expand, propsOf, type Props } from "../support/tree";

/** Every text in a rendered tree, in order. */
function textsOf(node: unknown): string[] {
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textsOf);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  return textsOf((node as VNode<Props>).props.children);
}

/** The `<details>` a Spoiler element renders. */
function detailsOf(spoiler: Props): VNode<Props> {
  return expand(h(Spoiler, spoiler as { label: string; children: never })) as VNode<Props>;
}

describe("a spoiler", () => {
  test("is a collapsed details element, marked as a spoiler, holding what it hides under its label", () => {
    const shown = detailsOf({ label: "A line with a spoiler: tap to show", children: "Vex Morrow steps off the ferry." });
    expect(shown.type).toBe("details");
    expect(shown.props["data-lre-spoiler"]).toBe(true);
    expect(shown.props.open).toBeUndefined();
    const texts = textsOf(shown);
    expect(texts).toContain("A line with a spoiler: tap to show");
    expect(texts).toContain("Vex Morrow steps off the ferry.");
  });
});

describe("the outline gate's held lines", () => {
  test("each line carrying a secret is a spoiler of its own, collapsed, with the line inside", () => {
    const held = ["Brief: Sam waits for Vex Morrow. [secret; kept from Sam]", "Vex Morrow steps off the ferry. [secret; kept from Sam]"];
    const tree = expand(h(SpoilerLines, { lines: held }));
    const spoilers = propsOf(tree, Spoiler);
    expect(spoilers).toHaveLength(2);
    spoilers.forEach((p, i) => {
      const details = detailsOf(p);
      expect(details.type).toBe("details");
      expect(details.props["data-lre-spoiler"]).toBe(true);
      expect(details.props.open).toBeUndefined();
      expect(textsOf(details)).toContain(held[i] ?? "");
    });
  });

  test("a gate holding none shows no spoiler", () => {
    expect(expand(h(SpoilerLines, { lines: undefined }))).toBeNull();
    expect(expand(h(SpoilerLines, { lines: [] }))).toBeNull();
  });
});

describe("a suggestion's Send pill", () => {
  const pill = h("button", { type: "button", class: "lre-chat-pill" }, h("strong", null, "Send:"), h("span", null, "I ask Vex Morrow about the ferry"));

  test("carrying a secret is inside a collapsed spoiler", () => {
    const tree = expand(h(SuggestionPill, { spoiler: true, children: pill }));
    const [spoiler] = propsOf([tree], Spoiler);
    if (!spoiler) throw new Error("no spoiler");
    const details = detailsOf(spoiler);
    expect(details.props["data-lre-spoiler"]).toBe(true);
    expect(details.props.open).toBeUndefined();
    expect(propsOf(details, "button")).toHaveLength(1);
    expect(textsOf(details)).toContain("I ask Vex Morrow about the ferry");
  });

  test("carrying none is the pill as it is", () => {
    const tree = expand(h(SuggestionPill, { spoiler: false, children: pill }));
    expect(propsOf([tree], Spoiler)).toEqual([]);
    expect(propsOf([tree], "button")).toHaveLength(1);
  });
});

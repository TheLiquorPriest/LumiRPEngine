// GM → Depth → Bootstrap's LumiBooks tree rendered from a fixture with no DOM: each node in reading
// order with its range, coverage and who has caught up, the ranges no entry spans, and each node's
// deepenings, which ask for their estimate first and run only on Confirm. A chat with no book offers
// summarizing it with LumiBooks first.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import type { LbTree } from "../../src/shared/bootstrap";
import { Button, HostSwitch, Seg } from "../../src/frontend/components";
import { type LbDeepening, lbOp, LumiBooksBody, type LumiBooksControls } from "../../src/frontend/depth/lumibooks";
import { type Props, propsOf } from "../support/tree";

const OPAQUE = new Set<unknown>([HostSwitch]);

function render(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(render);
  if (!node || typeof node !== "object" || !("type" in node)) return node;
  const v = node as VNode<Props>;
  if (typeof v.type === "function" && !OPAQUE.has(v.type)) return { ...v, props: { ...v.props, children: render((v.type as (p: Props) => unknown)(v.props)) } };
  return { ...v, props: { ...v.props, children: render(v.props.children) } };
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** What the node's own row rendered (its element, not its children's). */
function nodeOf(tree: unknown, id: string): unknown {
  const found = propsOf(tree, "div").filter((p) => p["data-lre-lb-node"] === id);
  if (found.length !== 1) throw new Error(`${found.length} nodes ${id}`);
  return found[0]?.children;
}

function button(tree: unknown, text: string): Props {
  const found = propsOf(tree, Button).filter((p) => textOf(p.children).trim() === text);
  if (found.length !== 1) throw new Error(`${found.length} buttons "${text}"`);
  return found[0] ?? {};
}

const TREE: LbTree = {
  chatId: "chat1",
  book: "The Long Winter",
  cast: [
    { id: "npc_rosie", name: "Rosie Alvarez" },
    { id: "npc_dev", name: "Dev Patel" },
  ],
  nodes: [
    {
      id: "v1",
      level: "volume",
      title: "Snowed in",
      range: [0, 99],
      coverage: "covered",
      changed: 0,
      caughtUp: [],
      fullMind: [],
      children: [
        {
          id: "a1",
          level: "arc",
          title: "The diner",
          range: [0, 49],
          coverage: "changed",
          changed: 3,
          caughtUp: [],
          fullMind: [],
          children: [{ id: "c1", level: "chapter", title: "First night", range: [0, 19], coverage: "deep", changed: 0, caughtUp: ["npc_rosie"], fullMind: ["npc_dev"], children: [] }],
        },
      ],
    },
  ],
  uncovered: [[100, 119]],
};

function controls(over: Partial<LumiBooksControls> = {}): LumiBooksControls & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return { busy: false, pending: null, onPick: (what) => void calls.push(["pick", what]), onEstimate: () => void calls.push(["estimate"]), onConfirm: () => void calls.push(["confirm"]), ...over, calls };
}

describe("GM → Depth → Bootstrap's LumiBooks tree", () => {
  test("shows each node in reading order with its range, coverage and who has caught up, and the ranges no entry spans", () => {
    const tree = render(LumiBooksBody({ tree: TREE, c: controls() }));
    const text = textOf(tree);
    expect(propsOf(tree, "div").filter((p) => typeof p["data-lre-lb-node"] === "string").map((p) => [p["data-lre-lb-node"], p["data-lre-lb-level"]])).toEqual([
      ["v1", "volume"],
      ["a1", "arc"],
      ["c1", "chapter"],
    ]);
    for (const part of ["LumiBooks: The Long Winter", "Volume: Snowed in", "Messages 1–100", "Imported", "Arc: The diner", "3 messages changed since", "Changed since", "Chapter: First night", "Messages 1–20", "Read deeply", "Caught up: Rosie Alvarez", "Full mind: Dev Patel", "Not in the book", "Messages 101–120"]) expect(text).toContain(part);
    // Read deeply is offered until the node was read deeply.
    expect(button(nodeOf(tree, "c1"), "Read deeply").disabled).toBe(true);
    expect(button(nodeOf(tree, "a1"), "Read deeply").disabled).toBe(false);
  });

  test("each node's deepenings set up what they're for; nothing runs before its estimate and Confirm", () => {
    const c = controls();
    const tree = render(LumiBooksBody({ tree: TREE, c }));
    (button(nodeOf(tree, "a1"), "Catch up…").onClick as () => void)();
    (button(nodeOf(tree, "a1"), "Read deeply").onClick as () => void)();
    (button(nodeOf(tree, "v1"), "Build a full mind…").onClick as () => void)();
    (button(tree, "Build a full mind from the whole book…").onClick as () => void)();
    expect(c.calls).toEqual([
      ["pick", { kind: "catchup", node: "a1", who: [] }],
      ["pick", { kind: "deep", node: "a1" }],
      ["pick", { kind: "fullmind", node: "v1", who: null }],
      ["pick", { kind: "fullmind", node: null, who: null }],
    ]);
  });

  test("Catch up picks several characters, estimates once someone is picked, and confirms with the estimate shown", () => {
    const none = controls({ pending: { what: { kind: "catchup", node: "a1", who: [] }, estimate: null } });
    const picking = render(LumiBooksBody({ tree: TREE, c: none }));
    expect(button(picking, "Estimate").disabled).toBe(true);
    const dev = propsOf(picking, HostSwitch).find((p) => p.label === "Dev Patel");
    (dev?.onChange as (on: boolean) => void)(true);
    expect(none.calls).toEqual([["pick", { kind: "catchup", node: "a1", who: ["npc_dev"] }]]);

    const picked = controls({ pending: { what: { kind: "catchup", node: "a1", who: ["npc_rosie", "npc_dev"] }, estimate: null } });
    const ready = render(LumiBooksBody({ tree: TREE, c: picked }));
    expect(propsOf(ready, HostSwitch).map((p) => [p.label, p.checked])).toEqual([
      ["Rosie Alvarez", true],
      ["Dev Patel", true],
    ]);
    (button(ready, "Estimate").onClick as () => void)();
    expect(picked.calls).toEqual([["estimate"]]);

    const estimated = controls({ pending: { what: { kind: "catchup", node: "a1", who: ["npc_rosie"] }, estimate: { calls: 14, tokens: 180_000, cost: 0.31, ms: 120_000, notes: ["Rosie's catch-up reads 50 messages."] } } });
    const confirm = render(LumiBooksBody({ tree: TREE, c: estimated }));
    const text = textOf(confirm);
    expect(text).toContain("It would take 14 calls · 180K tokens · $0.31 · 2 min.");
    expect(text).toContain("Rosie's catch-up reads 50 messages.");
    (button(confirm, "Confirm: Catch up").onClick as () => void)();
    (button(confirm, "Cancel").onClick as () => void)();
    expect(estimated.calls).toEqual([["confirm"], ["pick", null]]);
  });

  test("Build a full mind picks one character; the requests ask for the estimate first, then run on confirm", () => {
    const c = controls({ pending: { what: { kind: "fullmind", node: null, who: null }, estimate: null } });
    const tree = render(LumiBooksBody({ tree: TREE, c }));
    expect(textOf(tree)).toContain("the whole book");
    (propsOf(tree, Seg)[0]?.onChange as (who: string) => void)("npc_rosie");
    expect(c.calls).toEqual([["pick", { kind: "fullmind", node: null, who: "npc_rosie" }]]);
    const ops: [LbDeepening, boolean][] = [
      [{ kind: "catchup", node: "a1", who: [] }, false],
      [{ kind: "catchup", node: "a1", who: ["npc_rosie"] }, false],
      [{ kind: "deep", node: "c1" }, true],
      [{ kind: "fullmind", node: null, who: "npc_dev" }, false],
      [{ kind: "fullmind", node: "v1", who: "npc_dev" }, true],
    ];
    expect(ops.map(([what, confirm]) => lbOp(what, confirm))).toEqual([null, { op: "lb_catchup", node: "a1", who: ["npc_rosie"] }, { op: "lb_deep", node: "c1", confirm: true }, { op: "lb_fullmind", who: "npc_dev" }, { op: "lb_fullmind", who: "npc_dev", node: "v1", confirm: true }]);
  });

  test("a chat with no book offers summarizing it with LumiBooks first", () => {
    const text = textOf(render(LumiBooksBody({ tree: { ...TREE, book: null, nodes: [], uncovered: [] }, c: controls() })));
    expect(text).toContain("This chat has no LumiBooks book");
    expect(text).not.toContain("Volume");
  });
});

// A chip's detail, a line each (DESIGN §28.13): up to eight lines show whole; past them the first
// eight show, and the rest fold under "+N more", which opens them, so a Things tidied chip lists
// every move without crowding the receipt.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { ChipDetail } from "../../src/frontend/chips";
import { propsOf, type Props } from "../support/tree";

describe("a chip's detail", () => {
  test("up to eight lines shows whole; past them, the first eight, then +N more holding the rest", () => {
    const lines = Array.from({ length: 11 }, (_, i) => `Line ${i + 1}`);
    const short = ChipDetail({ detail: lines.slice(0, 8).join("\n") }) as VNode<Props>;
    expect(short.props.children).toBe(lines.slice(0, 8).join("\n"));
    expect(propsOf(short, "details")).toEqual([]);
    const long = ChipDetail({ detail: lines.join("\n") }) as VNode<Props>;
    expect((long.props.children as unknown[])[0]).toBe(lines.slice(0, 8).join("\n"));
    expect(propsOf(long, "summary").map((p) => p.children)).toEqual(["+3 more"]);
    expect((propsOf(long, "details")[0]?.children as unknown[])[1]).toBe("Line 9\nLine 10\nLine 11");
  });
});

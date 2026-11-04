// Reading a large value a piece at a time (`readAt`): a token on a list names an index or, keyed, an
// item by its id or name, an ambiguous name is refused with the ids, and a list's or an object's
// entries page from `from`, the outline saying where the next page starts.

import { describe, expect, test } from "bun:test";
import { BODY_LIMIT, readAt } from "../../src/cli/read";

/** The value a read answers (the JSON after its header line). */
function value(text: string): unknown {
  return JSON.parse(text.slice(text.indexOf("\n\n") + 2).replace(/\n\n\((Continues|That is the end)[^)]*\)$/, ""));
}

const view = {
  money: [
    { party: "pov", name: "Jordan Reyes", accounts: [{ id: "pov_checking", name: "Checking" }] },
    { party: "danny_okafor", name: "Danny Okafor", accounts: [] },
    { party: "maya_okafor", name: "Maya Okafor", accounts: [] },
    { party: "maya_2", name: "Maya Okafor", accounts: [] },
  ],
  orgs: [{ page: { id: "alder_automotive_co", name: "Alder Automotive" }, may: {} }],
  entities: [{ id: "pov", name: "Jordan Reyes" }],
};

describe("readAt", () => {
  test("a keyed token reads a list's item by its id, a party's money by its party, an organization by its page's id, or any of them by name", () => {
    const by = (pointer: string): unknown => {
      const read = readAt(view, { what: "the view", pointer });
      if (!read.ok) throw new Error(read.text);
      return value(read.text);
    };
    expect(by("/money/danny_okafor/name")).toBe("Danny Okafor");
    expect(by("/money/danny okafor/party")).toBe("danny_okafor");
    expect(by("/money/1/party")).toBe("danny_okafor");
    expect(by("/money/pov/accounts/Checking/id")).toBe("pov_checking");
    expect(by("/orgs/alder_automotive_co/page/name")).toBe("Alder Automotive");
    expect(by("/orgs/Alder Automotive/page/id")).toBe("alder_automotive_co");
    expect(by("/entities/pov/name")).toBe("Jordan Reyes");
    // The header says which index a keyed token named, so the next pointer can be either.
    const read = readAt(view, { what: "the view", pointer: "/money/danny_okafor" });
    expect(read.text).toContain("at /money/danny_okafor (/money/1)");
  });

  test("a name several items share is refused, listing their ids; one nobody has says what the list takes", () => {
    const twice = readAt(view, { what: "the view", pointer: "/money/Maya Okafor" });
    expect(twice).toEqual({ ok: false, text: expect.stringContaining("maya_okafor, maya_2") });
    const none = readAt(view, { what: "the view", pointer: "/money/nobody" });
    expect(none.ok).toBe(false);
    expect(none.text).toContain("an item's id or name");
  });

  test("from and limit page a list's entries, whole when they fit, saying where the next page starts", () => {
    const list = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, name: `Entity ${i}` }));
    const page = readAt({ list }, { what: "the view", pointer: "/list", from: 10, limit: 5 });
    expect(page.ok).toBe(true);
    expect(page.text).toContain("entries 10–14 of 30");
    expect(page.text).toContain("(Continues: read on with from 15.)");
    expect(value(page.text)).toEqual(list.slice(10, 15));
    const last = readAt({ list }, { what: "the view", pointer: "/list", from: 28 });
    expect(last.text).toContain("(That is the end.)");
    expect(readAt({ list }, { what: "the view", pointer: "/list", from: 30 }).ok).toBe(false);
    expect(readAt({ list }, { what: "the view", pointer: "/list/0/name", from: 0 }).ok).toBe(false);
  });

  test("an outline too long for one answer says to read on with from, and from continues it where it stopped", () => {
    const big = Array.from({ length: 2000 }, (_, i) => ({ id: `thing_${i}`, name: `A thing with a long name, number ${i}`, note: "x".repeat(40) }));
    const first = readAt({ big }, { what: "the view", pointer: "/big" });
    expect(first.ok).toBe(true);
    const at = /read on with from (\d+)/.exec(first.text)?.[1];
    expect(at).toBeDefined();
    expect(first.text.length).toBeLessThan(BODY_LIMIT + 1000);
    const next = readAt({ big }, { what: "the view", pointer: "/big", from: Number(at) });
    expect(next.text).toContain(`- [${at}] thing_${at}`);
    expect(next.text).not.toContain("- [0] thing_0");
  });
});

// The docs lookup (`lre_docs`, `lre_guide`'s fallback): BM25 over sections, headings counting three
// times their words, stopwords left out, words lightly stemmed and ids whole; the agent guide, the
// MCP doc, the depth guide and the loopback's are in the corpus; and the loan query finds "When a
// loan bills" first.

import { describe, expect, test } from "bun:test";
import { DOCS, docs, lookup, stem, termsOf, type Section } from "../../src/cli/texts";

/** The titles a lookup answered with, best first. */
const titles = (answer: string): string[] => [...answer.matchAll(/^## (.*)$/gm)].map((m) => m[1] ?? "");

describe("the docs lookup", () => {
  test("words are lightly stemmed, stopwords left out and ids kept whole", () => {
    for (const w of ["bills", "billing", "billed", "bill"]) expect(stem(w)).toBe("bill");
    expect(stem("stopped")).toBe("stop");
    expect(stem("added")).toBe("add");
    expect(stem("policies")).toBe("policy");
    expect(stem("string")).toBe("string");
    expect(termsOf("When does the loan's due_day start billing?")).toEqual(["loan", "due_day", "start", "bill"]);
    expect(termsOf("economy.people_money and lre_gm")).toEqual(["economy.people_money", "lre_gm"]);
    expect(lookup([{ title: "A", depth: 1, body: "x" }], "the of and how")).toContain("Give a few words");
  });

  test("a word in a heading counts more than in a body, and a rare word more than a common one", () => {
    const sections: Section[] = [
      { title: "Accounts", depth: 2, body: "An account holds money. A statement closes each month and lists the interest." },
      { title: "Statements", depth: 2, body: "Each month." },
      { title: "Cards", depth: 2, body: "A card draws on an account; money moves when it is used." },
    ];
    expect(titles(lookup(sections, "statement"))[0]).toBe("Statements");
    expect(titles(lookup(sections, "money interest"))[0]).toBe("Accounts");
    // An id matches whole, not its parts.
    const ids: Section[] = [
      { title: "Due dates", depth: 2, body: "A bill is due on its due day." },
      { title: "Fields", depth: 2, body: "`due_day` sets the day of the month." },
    ];
    expect(titles(lookup(ids, "due_day"))).toEqual(["Fields"]);
  });

  test("the agent guide, the MCP doc, the depth guide and the loopback's are searched too", () => {
    expect(Object.keys(DOCS)).toEqual(expect.arrayContaining(["agent-guide", "mcp", "depth", "loopback"]));
    expect(titles(docs("lre_orgs", "mcp"))[0]).toStartWith("MCP.md ›");
    expect(titles(docs("world model", "agent-guide"))[0]).toStartWith("AGENT-GUIDE.md ›");
    expect(titles(docs("bootstrap estimate", "depth"))[0]).toStartWith("DEPTH.md ›");
    expect(titles(docs("mint loopback key", "loopback"))[0]).toStartWith("LOOPBACK.md ›");
    // In the whole corpus too, not only when named.
    expect(titles(docs("turn off lumibooks summary memory cortex"))[0]).toStartWith("DEPTH.md ›");
    expect(titles(docs("relay docker"))[0]).toStartWith("LOOPBACK.md ›");
  });

  test("the loan query finds the section on when a loan bills first", () => {
    const first = titles(docs("when does a loan start billing"))[0] ?? "";
    expect(first).toContain("When a loan bills");
  });
});

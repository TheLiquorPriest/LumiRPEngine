// The answers' files and the tools' files are a user's to edit, so a slip in one must never end a
// turn: what cannot be read is left out and said, and the rest stands. The shipped files read whole.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Lines, toolText } from "../../src/iface/texts";

const SHIPPED = join(import.meta.dir, "..", "..", "guidance");

const ANSWERS = ["---", "format: lines", "---", "paid: {{who}} paid {{amount}}.", "A stray line with no name in front.", "broken: {{#open}} never closed", "moved: {{who}} went to {{place}}.", ""].join("\n");

describe("a file of answer lines", () => {
  test("with a stray line and a line whose tags do not close: both are left out and said, the others stand", () => {
    const lines = Lines.parse(ANSWERS, ".prompts/engine-answers.md");
    expect(lines.names).toEqual(["paid", "moved"]);
    expect(lines.line("moved", { who: "Odile", place: "the quay" })).toBe("Odile went to the quay.");
    expect(lines.problems).toHaveLength(2);
    expect(lines.problems[0]).toContain("body line 2 is not name: text");
    expect(lines.problems[1]).toContain("broken");
  });

  test("whose header cannot be read gives no lines, and says why", () => {
    const lines = Lines.parse("---\nformat: lines\npaid: never closed header", ".prompts/engine-answers.md");
    expect(lines.names).toEqual([]);
    expect(lines.line("paid", { who: "Odile" })).toBeUndefined();
    expect(lines.problems).toHaveLength(1);
  });

  test("every shipped file of answer lines reads whole", () => {
    const parts = join(SHIPPED, ".prompts");
    const files = readdirSync(parts).filter((name) => name.endsWith(".md"));
    const lined = files.filter((name) => /^format:\s*lines\s*$/m.test(readFileSync(join(parts, name), "utf8").split("---")[1] ?? ""));
    expect(lined.length).toBeGreaterThan(3);
    for (const name of lined) expect({ name, problems: Lines.parse(readFileSync(join(parts, name), "utf8"), name).problems }).toEqual({ name, problems: [] });
  });
});

describe("a tool's file", () => {
  test("with a tag that names nothing is given as written, and says what could not be read", () => {
    const read = toolText(["---", "arguments:", "  who: Who pays.", "---", "Records a payment {{ }} as it happened.", ""].join("\n"), ".tools/pay.md");
    expect(read.description).toBe("Records a payment {{ }} as it happened.");
    expect(read.arguments).toEqual({ who: "Who pays." });
    expect(read.problem).toBeDefined();
  });

  test("every shipped tool file reads whole", () => {
    const tools = join(SHIPPED, ".tools");
    for (const name of readdirSync(tools).filter((n) => n.endsWith(".md"))) expect({ name, problem: toolText(readFileSync(join(tools, name), "utf8"), name).problem }).toEqual({ name, problem: undefined });
  });
});

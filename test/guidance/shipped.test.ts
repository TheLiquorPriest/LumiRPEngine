// The shipped guidance is data a user edits and an agent's behaviour hangs on. A header that
// does not parse silently takes a whole file out of force, so every shipped file is checked here
// for what a loader needs of it: a header that is valid YAML, the fields its kind requires, and
// `needs:` that names a file that ships.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../guidance");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".md")) out.push(path);
  }
  return out;
}

interface Shipped {
  rel: string;
  header: Record<string, unknown> | null;
  body: string;
}

function read(path: string): Shipped {
  const text = readFileSync(path, "utf8");
  const rel = relative(ROOT, path).split("\\").join("/");
  if (!text.startsWith("---\n")) return { rel, header: null, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) throw new Error(`${rel}: the header is never closed`);
  const header = Bun.YAML.parse(text.slice(4, end));
  if (header === null || typeof header !== "object" || Array.isArray(header)) throw new Error(`${rel}: the header is not a set of fields`);
  return { rel, header: header as Record<string, unknown>, body: text.slice(end + 5) };
}

const files = walk(ROOT).map(read);
const byRel = (prefix: string) => files.filter((f) => f.rel.startsWith(prefix));

/** What `needs:` may name: an instruction file or a rule, by its name without the extension. */
const names = new Set(files.map((f) => basename(f.rel, ".md")));

describe("the shipped guidance", () => {
  test("instruction files are plain markdown with no header", () => {
    const instructions = files.filter((f) => f.rel === "ALL-AGENTS.md" || f.rel.startsWith("chat-defaults/"));
    expect(instructions.length).toBeGreaterThan(0);
    expect(instructions.filter((f) => f.header !== null).map((f) => f.rel)).toEqual([]);
  });

  test("every agent definition names itself, says what it is for, and lists what it holds, reads and is given", () => {
    const agents = byRel(".agents/");
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      const h = agent.header ?? {};
      expect({ file: agent.rel, name: h.name }).toEqual({ file: agent.rel, name: basename(agent.rel, ".md") });
      expect(typeof h.description).toBe("string");
      for (const list of ["tools", "reads", "given"]) {
        const value = h[list];
        expect({ file: agent.rel, field: list, isList: Array.isArray(value) }).toEqual({ file: agent.rel, field: list, isList: true });
        expect((value as unknown[]).every((item) => typeof item === "string")).toBe(true);
      }
      expect(agent.body.trim().length).toBeGreaterThan(0);
    }
  });

  test("every skill has a name, a description and a body", () => {
    for (const skill of byRel(".skills/")) {
      expect(typeof skill.header?.name).toBe("string");
      expect(typeof skill.header?.description).toBe("string");
      expect(skill.body.trim().length).toBeGreaterThan(0);
    }
  });

  test("every rule says who it is for, and a rule that needs a file names one that ships", () => {
    const rules = byRel(".rules/");
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      const h = rule.header ?? {};
      expect(typeof h.description).toBe("string");
      expect({ file: rule.rel, agents: h.agents === "all" || Array.isArray(h.agents) }).toEqual({ file: rule.rel, agents: true });
      if (h.needs !== undefined) expect({ file: rule.rel, needs: h.needs, ships: names.has(String(h.needs)) }).toEqual({ file: rule.rel, needs: h.needs, ships: true });
    }
  });

  test("every prompt part says what it is, and the reply contract names its tags", () => {
    const parts = byRel(".prompts/");
    for (const part of parts) expect({ file: part.rel, described: typeof part.header?.description }).toEqual({ file: part.rel, described: "string" });
    const contract = parts.find((f) => f.rel === ".prompts/reply-contract.md");
    expect(contract?.header?.tags).toEqual({ reply: expect.any(String), intent: expect.any(String) });
  });
});

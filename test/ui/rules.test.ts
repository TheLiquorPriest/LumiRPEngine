// The Rules page: a rule's header said in words, why a rule is not in force in RPH's own word, the list's order, and the facts' and firings' lines.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { FiringLine, thenWords } from "../../src/ui/pages/rules/firings";
import { namesOf, ruleFileOf, triggerWords } from "../../src/ui/pages/rules/header";
import { sortedRules, whyWords } from "../../src/ui/pages/rules";
import type { RuleShown } from "../../src/ui/wanted";
import { expand, textOf } from "./vnodes";

const rule = (name: string, over: Partial<RuleShown> = {}): RuleShown => ({ name, path: `@shipped/rules/${name}.md`, level: "shipped", description: "", agents: "all", inForce: true, replaces: [], ...over });

describe("a rule's header in words", () => {
  const FILE = `---\ndescription: Notices silence.\nagents: [author]\nneeds: TURN\nfact: turns.since.engine.change >= 6\nat: turn-start\nrepeat: after 6 turns\n---\nNothing has been recorded.`;
  test("the fields and the text come apart, and a moment rule says its moment, fact and repeat", () => {
    const file = ruleFileOf(FILE);
    expect(file.body).toBe("Nothing has been recorded.");
    expect(namesOf(file.fields.get("agents"))).toEqual(["author"]);
    expect(triggerWords(file.fields)).toBe("At a turn's start while turns.since.engine.change >= 6 holds. It may fire after 6 turns.");
  });

  test("a pattern says where it looks and what a match does; no trigger says it is in the briefing", () => {
    const pattern = ruleFileOf(`---\nagents: all\nscope: [reply, arguments:file_write]\ncondition: '(a|b)'\ncase: ignore\n---\ntext`);
    expect(triggerWords(pattern.fields)).toContain("looked for in the reply, a tool's arguments of file_write");
    expect(triggerWords(pattern.fields)).toContain("stops the call");
    expect(triggerWords(ruleFileOf("---\nagents: all\nturns: [swipe]\n---\nt").fields)).toContain("swipe");
    expect(triggerWords(ruleFileOf("no header at all").fields)).toContain("every turn");
  });
});

describe("the list", () => {
  test("RPH's word for why a rule is not in force is said, and a rule in force says none; the order is in force, not, examples", () => {
    expect(whyWords(rule("a"))).toBeNull();
    expect(whyWords(rule("b", { inForce: false, why: "needs" }))).toBe("a file it needs is not in force");
    expect(whyWords(rule("c", { inForce: false, why: "judge", judge: "yes" }))).toContain("names no yes: answer");
    expect(sortedRules([rule("z", { inForce: false, why: "example" }), rule("m", { inForce: false, why: "off" }), rule("b")]).map((r) => r.name)).toEqual(["b", "m", "z"]);
  });

  test("a firing says what happened, and what it matched and what the agent did next only behind the gate", () => {
    const firing = { rule: "banned-phrases", path: "rules/banned-phrases.md", level: "global" as const, moment: "stream" as const, watched: "reply" as const, agent: { id: "a1", definition: "author" }, matched: "a testament to", action: "cut" as const, then: { did: "wrote" as const } };
    expect(thenWords(firing.then)).toBe("it wrote on");
    const shut = textOf(expand(h(FiringLine, { firing, gate: false })));
    expect(shut).toContain("the call was stopped and its text added");
    expect(shut).not.toContain("a testament to");
    const open = textOf(expand(h(FiringLine, { firing, gate: true })));
    expect(open).toContain("a testament to");
    expect(open).toContain("Then it wrote on.");
  });
});

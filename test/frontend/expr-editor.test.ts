import { describe, expect, test } from "bun:test";
import { argText, parseArgText } from "../../src/frontend/build/effect-args";
import { exprCompletions, exprFunctions } from "../../src/frontend/build/expr-editor";
import { createRegistry } from "../../src/engine/registry-impl";
import { formulaFunctions } from "../../src/engine/scope";
import { ALL_PACKS } from "../../src/packs/index";

// What `lre.world get` sends as `functions`.
const registry = createRegistry(ALL_PACKS);
const backendList = formulaFunctions(registry);

describe("expression editor functions", () => {
  test("the editor offers exactly the backend's list: every pack formula and engine built-in, and nothing the engine lacks", () => {
    const offered = exprFunctions(backendList, "formula");
    expect(offered).toEqual([...new Set(backendList)].sort());
    for (const name of registry.formulas.keys()) expect(offered).toContain(name);
    for (const name of ["min", "max", "clamp", "field", "has_rel", "table", "table_step"]) expect(offered).toContain(name);
    expect(offered).not.toContain("now");
    // A pack formula the registry doesn't have is never offered, whatever an older editor listed.
    expect(exprFunctions(["min", "wealth"], "formula")).toEqual(["min", "wealth"]);
  });

  test("roll( is offered only to an effect argument", () => {
    expect(exprFunctions(backendList, "formula")).not.toContain("roll");
    expect(exprFunctions(backendList, "effect")).toContain("roll");
    expect(exprCompletions("ro", [], exprFunctions(backendList, "formula"))).not.toContain("roll(");
    expect(exprCompletions("ro", [], exprFunctions(backendList, "effect"))).toContain("roll(");
    // Even a list that carried roll offers it only in effect mode.
    expect(exprFunctions(["roll", "min"], "formula")).toEqual(["min"]);
  });

  test("typing suggests identifiers that extend the word, then functions as calls", () => {
    expect(exprCompletions("mi", ["might", "mi"], ["min", "max"])).toEqual(["might", "min("]);
    expect(exprCompletions("", ["might"], ["min"])).toEqual([]);
  });
});

describe("effect argument values", () => {
  test("a value typed reads back as the same value, and a leading = keeps the formula as text", () => {
    for (const value of ["self", "might", 2, "2", true, "true", null, { mode: "full" }, ["a", 1]]) expect(parseArgText(argText(value))).toEqual(value);
    expect(parseArgText("=roll(\"1d6\") + 2")).toBe("=roll(\"1d6\") + 2");
    expect(parseArgText("12")).toBe(12);
    expect(parseArgText("hp")).toBe("hp");
  });
});

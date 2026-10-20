import { describe, expect, test } from "bun:test";
import { argText, parseArgText } from "../../src/frontend/build/effect-args";
import { exprCompletions, exprFunctions, exprReads, exprSummary } from "../../src/frontend/build/expr-editor";
import { createRegistry } from "../../src/engine/registry-impl";
import { formulaFunctions } from "../../src/engine/scope";
import { ALL_PACKS } from "../../src/packs/index";
import type { WorldDoc } from "../../src/shared/world";
import { baseWorld } from "../packs/support";

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

/** Sam (the POV) and Dev, three places, a track and a check. People label their cash, might and HP; only vehicles have fuel. */
function readoutWorld(): WorldDoc {
  const world = baseWorld();
  const person = world.kinds.person;
  if (person) {
    person.fields.cash = { type: "money", min: 0, label: "Cash" };
    person.fields.might = { type: "number", label: "Might" };
    person.fields.hp = { type: "number", label: "HP" };
  }
  world.kinds.vehicle = { id: "vehicle", label: "Vehicle", fields: { fuel: { type: "number", label: "Fuel left" } } };
  world.tracks.lighthouse = { id: "lighthouse", kind: "quest", label: "The lighthouse", start: "rumour", stages: { rumour: { label: "A rumour", next: [] } }, visibility: "public" };
  world.checks.lockpick = { id: "lockpick", dice: "1d20" };
  return world;
}

describe("formula readout", () => {
  test("dotted reads are named from the world: an entity's field, a place's field, a track's stage", () => {
    const world = readoutWorld();
    expect(exprReads("sam.cash > home.security + stage.lighthouse", world).reads).toEqual([
      { id: "sam.cash", label: "Sam's cash", what: "entity field" },
      { id: "home.security", label: "Home's security", what: "place field" },
      { id: "stage.lighthouse", label: "the stage of “The lighthouse”", what: "track stage" },
    ]);
    // An abbreviation keeps its capitals; a bare id names the thing itself.
    expect(exprReads("dev.hp + at(dev, cafe) + lighthouse + lockpick", world).reads).toEqual([
      { id: "dev.hp", label: "Dev's HP", what: "entity field" },
      { id: "dev", label: "Dev", what: "entity" },
      { id: "cafe", label: "Cafe", what: "place" },
      { id: "lighthouse", label: "the track “The lighthouse”", what: "track" },
      { id: "lockpick", label: "the lockpick check", what: "check" },
    ]);
  });

  test("the clock's names, levels, the POV and here read as themselves", () => {
    const world = readoutWorld();
    expect(exprReads("hour >= 20 or daypart == 'night' and weekday < 5", world).reads).toEqual([
      { id: "hour", label: "the hour", what: "the clock" },
      { id: "daypart", label: "the part of the day", what: "the clock" },
      { id: "weekday", label: "the weekday", what: "the clock" },
    ]);
    expect(exprReads("level.money + pov.cash + here.security + here", world).reads).toEqual([
      { id: "level.money", label: "the money level", what: "level" },
      { id: "pov.cash", label: "the POV character's cash", what: "pov" },
      { id: "here.security", label: "the security here", what: "here" },
      { id: "here", label: "the current place", what: "here" },
    ]);
  });

  test("self.<field> and a bare field name read the formula's own field, labelled by any kind that defines it", () => {
    const world = readoutWorld();
    expect(exprReads("self.might + might + self.fuel + has_rel(self, 'knows')", world).reads).toEqual([
      { id: "self.might", label: "own might", what: "own field" },
      { id: "might", label: "own might", what: "own field" },
      { id: "self.fuel", label: "own fuel left", what: "own field" },
      { id: "self", label: "self", what: "self" },
    ]);
    // A dotted path is one name, spaces around its dot or not; the sentence says a thing once.
    expect(exprReads("self . might", world).reads).toEqual([{ id: "self.might", label: "own might", what: "own field" }]);
    expect(exprSummary("self.might + might", world)).toBe("Reads own might.");
  });

  test("each function is listed once, in the order it is first called", () => {
    expect(exprReads("min(max(a, 1), min(b, 2)) + table('wages', c, 'pay') + max(1, 2)").functions).toEqual(["min", "max", "table"]);
  });

  test("what a quoted string says is never read", () => {
    expect(exprReads("has('sam.cash') == \"hour\" or note == 'it\\'s min(x)'", readoutWorld())).toEqual({ reads: [{ id: "note", label: "note", what: "param" }], functions: ["has"] });
  });

  test("a name the world doesn't know is a param; literals and word operators are no names", () => {
    const world = readoutWorld();
    expect(exprReads("price * qty + event.amount + target.cash", world).reads).toEqual([
      { id: "price", label: "price", what: "param" },
      { id: "qty", label: "qty", what: "param" },
      { id: "event.amount", label: "event.amount", what: "param" },
      { id: "target.cash", label: "the target's cash", what: "param" },
    ]);
    expect(exprReads("not (true or false) and null == price", world).reads).toEqual([{ id: "price", label: "price", what: "param" }]);
  });

  test("the sentence names what the formula reads and the functions it uses; a constant reads nothing", () => {
    const world = readoutWorld();
    expect(exprSummary("min(sam.cash, 100) + hour * table('wages', stage.lighthouse, 'pay')", world)).toBe("Reads Sam's cash, the hour and the stage of “The lighthouse”; uses min and table.");
    expect(exprSummary("2 + 3 * (4 - 1)", world)).toBe("Reads nothing.");
    expect(exprSummary("roll('1d6') + 2", world)).toBe("Reads nothing; uses roll.");
  });

  test("without a world the ids stand in for names", () => {
    expect(exprReads("sam.cash + stage.lighthouse + self.might + hour").reads).toEqual([
      { id: "sam.cash", label: "sam.cash", what: "param" },
      { id: "stage.lighthouse", label: "the stage of “lighthouse”", what: "track stage" },
      { id: "self.might", label: "own might", what: "own field" },
      { id: "hour", label: "the hour", what: "the clock" },
    ]);
    expect(exprSummary("sam.cash > 100 and hour < 9")).toBe("Reads sam.cash and the hour.");
  });
});

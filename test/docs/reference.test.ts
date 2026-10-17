// The authors' reference (docs/REFERENCE.md) is generated from the registry: a build is
// deterministic, and the committed file is what the packs register now.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildReference, REFERENCE_PATH } from "../../scripts/reference/build";
import { createRegistry } from "../../src/engine/registry-impl";
import { formulaFunctions } from "../../src/engine/scope";
import { ALL_PACKS } from "../../src/packs/index";

describe("authors' reference", () => {
  const built = buildReference();

  test("a build is deterministic", () => {
    expect(buildReference()).toBe(built);
  });

  test("the committed reference equals a fresh build (run `bun run reference` after changing a pack)", () => {
    expect(readFileSync(REFERENCE_PATH, "utf8")).toBe(built);
  });

  test("it lists every effect, and every function a formula may call by name or with its parameters", () => {
    const reg = createRegistry(ALL_PACKS);
    const effects = [...reg.effects.keys()].filter((type) => !built.includes(`\`${type}\``));
    const functions = formulaFunctions(reg).filter((name) => !built.includes(`\`${name}(`) && !built.includes(`\`${name}\``));
    expect([...effects, ...functions]).toEqual([]);
  });
});

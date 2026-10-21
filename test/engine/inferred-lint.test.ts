// DESIGN §13 lint for the world's inferred-checks default (§11): Build's Check names a policy the
// engine can't read, values it can't hold, skills the sheet lacks, swapped bands and guidance faults.
import { describe, expect, test } from "bun:test";
import type { WorldDoc } from "../../src/shared/world";
import { lintWorld } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";

const reg = createRegistry(ALL_PACKS);

/** Port Alder, whose sheet is the Sheets pack's (charm, fitness, driving…), with this inferred-checks default. */
function portAlder(inferred: unknown): WorldDoc {
  const world = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Port Alder");
  world.ruleset = { ...world.ruleset, inferred } as unknown as NonNullable<WorldDoc["ruleset"]>;
  return world;
}

const found = (world: WorldDoc): string[] => lintWorld(world, reg).filter((i) => i.code.startsWith("inferred")).map((i) => `${i.severity} ${i.code}@${i.path}`).sort();

describe("§13 lint: inferred checks", () => {
  test("a readable policy within its bounds, naming the sheet's own skills, passes", () => {
    expect(found(portAlder(undefined))).toEqual([]);
    expect(found(portAlder({ mode: "auto", when: "risky", who: "companions", skills: ["charm", "fitness"], difficulty: { lowest: "easy", highest: "hard" }, most: 3, guidance: { pass: "Narrate {who} managing {attempt} against {against}.", fail: "Narrate the {skill} attempt failing." } }))).toEqual([]);
  });

  test("a policy the engine can't read, which plays as unset, is an error", () => {
    expect(found(portAlder("auto"))).toEqual(["error inferred@ruleset.inferred"]);
    expect(found(portAlder({ when: "risky", most: 3 }))).toEqual(["error inferred@ruleset.inferred.mode"]);
    expect(found(portAlder({ mode: "sometimes" }))).toEqual(["error inferred@ruleset.inferred.mode"]);
  });

  test("a skill the sheet lacks, swapped bands, rolls out of bounds and faulty guidance are each named at their path", () => {
    const world = portAlder({ mode: "auto", when: "often", skills: ["charm", "stealth"], difficulty: { lowest: "hard", highest: "easy" }, most: 20, guidance: { pass: `Narrate it succeeding ${"and going well ".repeat(16)}`, fail: "Narrate {who} failing at {skil}." } });
    expect(found(world)).toEqual([
      "warning inferred_difficulty@ruleset.inferred.difficulty",
      "warning inferred_guidance@ruleset.inferred.guidance.fail",
      "warning inferred_skill@ruleset.inferred.skills",
      "warning inferred_value@ruleset.inferred.guidance.pass",
      "warning inferred_value@ruleset.inferred.most",
      "warning inferred_value@ruleset.inferred.when",
    ]);
    const issues = lintWorld(world, reg).filter((i) => i.code.startsWith("inferred"));
    // Only the missing skill is named, never one the sheet has.
    expect(issues.find((i) => i.code === "inferred_skill")?.message).toContain("stealth");
    expect(issues.some((i) => i.code === "inferred_skill" && i.message.includes("charm"))).toBe(false);
    expect(issues.every((i) => !i.message.includes("undefined"))).toBe(true);
  });

  test("most below its bounds is named too", () => {
    expect(found(portAlder({ mode: "suggest", most: 0 }))).toEqual(["warning inferred_value@ruleset.inferred.most"]);
  });
});

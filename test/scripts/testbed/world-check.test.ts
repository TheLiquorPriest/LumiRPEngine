import { describe, expect, test } from "bun:test";
import { emptyParts, partSizes, revisionNumbers, unknownParts, WORLD_PARTS } from "../../../scripts/testbed/lib/instance/world-check";
import { thirdRevision } from "../../../scripts/testbed/steps/world-parts";

type Doc = { [part: string]: unknown };

function isDoc(value: unknown): value is Doc {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The two operations the world's patches use, as the CLI's `edit --ops` applies them: add (an array's "-" appends) and replace. */
function apply(doc: Doc, ops: { op: string; path: string; value: unknown }[]): Doc {
  const out = structuredClone(doc);
  for (const { op, path, value } of ops) {
    const keys = path.split("/").slice(1);
    const last = keys.pop() ?? "";
    let at: unknown = out;
    for (const key of keys) at = isDoc(at) ? at[key] : undefined;
    if (Array.isArray(at) && last === "-" && op === "add") at.push(value);
    else if (isDoc(at)) at[last] = value;
    else throw new Error(`nothing at ${path}`);
  }
  return out;
}
/** An invented world document in which every part holds something but the ones the starter and the first two revisions leave empty. */
function beforeLastParts(): Doc {
  const doc: Doc = {};
  for (const part of WORLD_PARTS) doc[part] = { one: 1 };
  Object.assign(doc, { format: "lre-world-v1", id: "w_0000000000000001", name: "Invented harbour", seedMode: "fresh", lenientPricing: false, pov: "pov" });
  doc.sections = {};
  doc.steps = {};
  doc.suppressed = [];
  for (const part of ["sectionTemplates", "spawnCap", "placeCap", "placesPerTurn"]) delete doc[part];
  return doc;
}

describe("a world with every part filled", () => {
  test("the parts a world leaves out or holds empty are each named", () => {
    const empty: string[] = emptyParts(beforeLastParts());
    expect(empty.sort()).toEqual(["placeCap", "placesPerTurn", "sectionTemplates", "sections", "spawnCap", "steps", "suppressed"].sort());
  });

  test("the last revision fills every part the earlier ones left empty", () => {
    const filled = apply(beforeLastParts(), thirdRevision({ bookId: "book-invented", legacyEntryId: "entry-invented" }));
    expect(emptyParts(filled)).toEqual([]);
    expect(partSizes(filled).suppressed).toBe(1);
    expect(unknownParts(filled)).toEqual([]);
  });

  test("a switch set to off and a count are values; a blank name is not", () => {
    const doc = apply(beforeLastParts(), thirdRevision({ bookId: "b", legacyEntryId: "e" }));
    doc.name = "";
    expect(emptyParts(doc)).toEqual(["name"]);
    expect(partSizes(doc).lenientPricing).toBe(1);
  });

  test("a part today's build does not declare is named, so the list of parts cannot fall behind", () => {
    expect(unknownParts({ ...beforeLastParts(), weatherMachines: {} })).toEqual(["weatherMachines"]);
  });

  test("each chat's revision is told by its place in the history, not by its hash", () => {
    const history = [{ revision: "aaa" }, { revision: "bbb" }, { revision: "ccc" }];
    expect(revisionNumbers(history, { classic: "bbb", agents: "aaa", lost: "zzz", none: null })).toEqual({ classic: 2, agents: 1, lost: 0, none: 0 });
  });
});

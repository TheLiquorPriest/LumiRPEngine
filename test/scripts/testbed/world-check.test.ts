import { describe, expect, test } from "bun:test";
import { emptyParts, partSizes, revisionNumbers, unknownParts, WORLD_PARTS } from "../../../scripts/testbed/lib/instance/world-check";
import { thirdRevision, withAdoptedEntry } from "../../../scripts/testbed/steps/world-parts";

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
  Object.assign(doc, { format: "lre-world-v1", id: "w_0000000000000001", name: "Invented harbour", seedMode: "fresh", lenientPricing: false, pov: "pov", packs: { gear: { version: 1, config: {} } } });
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

  /** The first revision as Build's Import makes it a world, its file given the adopted entry, then the last revision. */
  function madeAsTheStepsMakeIt(): Doc {
    const file = withAdoptedEntry({ format: "lre-world-export-v1", world: beforeLastParts() }, { bookId: "book-invented", legacyEntryId: "entry-invented" });
    if (!isDoc(file.world)) throw new Error("the import file lost its world");
    return apply(file.world, thirdRevision());
  }

  test("the import and the last revision fill every part the earlier ones left empty", () => {
    const filled = madeAsTheStepsMakeIt();
    expect(emptyParts(filled)).toEqual([]);
    expect(filled.suppressed).toEqual([{ bookId: "book-invented", entryId: "entry-invented" }]);
    expect(unknownParts(filled)).toEqual([]);
  });

  test("without the import's adopted entry, suppressed is the one part left empty", () => {
    expect(emptyParts(apply(beforeLastParts(), thirdRevision()))).toEqual(["suppressed"]);
  });

  test("a switch set to off and a count are values; a blank name is not", () => {
    const doc = madeAsTheStepsMakeIt();
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

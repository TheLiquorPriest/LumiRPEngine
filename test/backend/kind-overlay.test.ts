// A world kind with a pack kind's id lies over it (DESIGN §4.1). A world whose own Person kind types
// none of the packs' fields wrote its own words in them before it did: it still commits and imports,
// each such value told as a warning, while a reference the world's own kinds type stays an error.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import type { LintIssue } from "../../src/shared/protocol";
import { lintWorld, newBlankWorld } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import { Rig } from "../support/rig";

const reg = createRegistry(ALL_PACKS);
/** Words where the packs' Person reads a reference: none names anything in the world. */
const WORDS = { home: "the flat above the shop", bed: "the couch", place: "the back room", employer: "Harbor Hardware" };
const PATHS = Object.keys(WORDS)
  .map((field) => `entities.you.fields.${field}`)
  .sort();

/** The issues at those four fields, as [severity, path], in path order. */
function atWords(lint: unknown): [string, string][] {
  const issues: LintIssue[] = Array.isArray(lint) ? lint : [];
  return issues
    .filter((i) => PATHS.includes(i.path))
    .map((i): [string, string] => [i.severity, i.path])
    .sort((a, b) => a[1].localeCompare(b[1]));
}

describe("a blank world's own Person kind, which types none of the packs' fields", () => {
  test("commits, exports and imports with words in Home, Bed, Place and Employer, each told as a warning", async () => {
    const rig = new Rig({ shipped: true });
    const created = rig.body(await rig.send({ type: "lre.world", op: "create", name: "Harbor" }));
    const worldId = isRecord(created.world) ? String(created.world.id) : "";
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "you", value: { id: "you", kind: "person", name: "You", tier: "principal", fields: WORDS, relations: [] } }));
    const committed = rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    expect(committed.revision).toBeString();
    expect(atWords(committed.lint)).toEqual(PATHS.map((path): [string, string] => ["warning", path]));

    const file = rig.body(await rig.send({ type: "lre.world", op: "export", worldId })).file;
    const imported = rig.body(await rig.send({ type: "lre.world", op: "import", file }));
    const world = isRecord(imported.world) ? imported.world : {};
    const you = isRecord(world.entities) ? world.entities.you : null;
    expect(isRecord(you) ? you.fields : null).toEqual(WORDS);
    const checked = rig.body(await rig.send({ type: "lre.world", op: "lint", worldId: String(world.id) }));
    expect(atWords(checked.lint)).toEqual(PATHS.map((path): [string, string] => ["warning", path]));
  });

  test("how firmly follows the world's own kinds: words only the packs' Person types are warnings, a reference the world's own kind types, or the packs' Person with no kind of the world's over it, is an error", () => {
    const world = newBlankWorld("w_refs", "Refs", reg);
    const you = world.entities.you;
    if (!you) throw new Error("the blank world has no you");
    you.fields = { ...WORDS };
    expect(atWords(lintWorld(world, reg))).toEqual(PATHS.map((path): [string, string] => ["warning", path]));
    world.kinds.person = { id: "person", label: "Person", fields: { home: { type: "ref", label: "Home" } } };
    expect(atWords(lintWorld(world, reg)).find(([, path]) => path === "entities.you.fields.home")?.[0]).toBe("error");
    delete world.kinds.person;
    expect(atWords(lintWorld(world, reg))).toEqual(PATHS.map((path): [string, string] => ["error", path]));
  });
});

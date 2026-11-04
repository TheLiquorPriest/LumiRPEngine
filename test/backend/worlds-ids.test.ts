// A new collection item written without its id takes its key, in both of the draft's write paths
// (Build's one-item put and a JSON Patch), so an id isn't typed twice; one written with another id
// keeps it, and lint still refuses the mismatch.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";

/** The draft and lint an editor reply carries. */
function draftOf(body: Record<string, unknown>): { draft: WorldDoc; codes: string[] } {
  if (!isRecord(body.draft)) throw new Error("no draft");
  const lint = Array.isArray(body.lint) ? body.lint.filter(isRecord) : [];
  return { draft: body.draft as unknown as WorldDoc, codes: lint.map((i) => String(i.code)) };
}

const person = (name: string): Record<string, unknown> => ({ kind: "person", name, tier: "background", fields: {}, relations: [] });

describe("ids from keys", () => {
  test("a put of a new item without an id takes its key; a mismatched id is kept and still id_mismatch", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const editor = { type: "lre.editor", worldId, base: null } as const;
    const put = draftOf(rig.body(await rig.send({ ...editor, op: "put", collection: "entities", id: "rosa_vega", value: person("Rosa Vega") })));
    expect(put.draft.entities.rosa_vega).toMatchObject({ id: "rosa_vega", name: "Rosa Vega" });
    expect(Object.keys(put.draft.entities.rosa_vega ?? {})[0]).toBe("id");
    expect(put.codes).not.toContain("id_mismatch");
    const place = draftOf(rig.body(await rig.send({ ...editor, op: "put", collection: "places", id: "pier", value: { name: "Pier", fields: {} } })));
    expect(place.draft.places.pier).toMatchObject({ id: "pier", name: "Pier" });
    const wrong = draftOf(rig.body(await rig.send({ ...editor, op: "put", collection: "entities", id: "dale", value: { id: "dale_x", ...person("Dale") } })));
    expect(wrong.draft.entities.dale?.id).toBe("dale_x");
    expect(wrong.codes).toContain("id_mismatch");
  });

  test("a patch adding a new item without an id takes its key; a mismatched id still errors", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const editor = { type: "lre.editor", worldId, base: null } as const;
    const added = draftOf(rig.body(await rig.send({ ...editor, op: "patch", ops: [{ op: "add", path: "/entities/nora_bell", value: person("Nora Bell") }] })));
    expect(added.draft.entities.nora_bell).toMatchObject({ id: "nora_bell", name: "Nora Bell" });
    expect(added.codes).not.toContain("id_mismatch");
    const wrong = draftOf(rig.body(await rig.send({ ...editor, op: "patch", ops: [{ op: "add", path: "/entities/sam", value: { id: "samuel", ...person("Sam") } }] })));
    expect(wrong.draft.entities.sam?.id).toBe("samuel");
    expect(wrong.codes).toContain("id_mismatch");
  });

  test("an existing item rewritten without its id isn't given one", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const editor = { type: "lre.editor", worldId, base: null } as const;
    rig.body(await rig.send({ ...editor, op: "put", collection: "places", id: "pier", value: { name: "Pier", fields: {} } }));
    const removed = draftOf(rig.body(await rig.send({ ...editor, op: "patch", ops: [{ op: "remove", path: "/places/pier/id" }] })));
    expect(removed.draft.places.pier).toBeDefined();
    expect(removed.draft.places.pier).not.toHaveProperty("id");
  });
});

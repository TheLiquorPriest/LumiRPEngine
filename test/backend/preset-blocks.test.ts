// Add RPEngine blocks writes the preset once, its stored blocks as they are (DESIGN §6.8): the host's
// block API sends every block of the preset through a normalizer that drops what it doesn't know, a
// sealed block's protection among it, so the engine splices its blocks into the stored list instead.

import { describe, expect, test } from "bun:test";
import type { PromptBlockSnapshotDTO } from "lumiverse-spindle-types";
import { spliceBlocks } from "../../src/backend/spindle-host";

const stored = (id: string, more: Partial<PromptBlockSnapshotDTO> = {}): PromptBlockSnapshotDTO => ({ id, name: id, content: `${id} text`, role: "system", enabled: true, position: "pre_history", depth: 0, marker: null, isLocked: false, color: null, injectionTrigger: [], group: null, ...more });

describe("adding RPEngine blocks to a stored preset", () => {
  test("every stored block stays exactly as stored, sealed fields included; the new ones are complete, switched off but for the category", () => {
    const sealed = stored("protected", { sealed: true, sealedKey: "k1", sealedSource: "lumihub", isLocked: true });
    const plain = stored("main");
    let n = 0;
    const out = spliceBlocks([sealed, plain], 1, [{ kind: "category", name: "RPEngine" }, { kind: "text", name: "RPEngine · extract", content: "// notes" }], () => `new${++n}`);
    expect(out[0]).toBe(sealed);
    expect(out[3]).toBe(plain);
    expect(out.map((b) => b.id)).toEqual(["protected", "new1", "new2", "main"]);
    expect(out[1]).toMatchObject({ name: "RPEngine", marker: "category", categoryMode: "checkbox", enabled: true, content: "" });
    expect(out[2]).toMatchObject({ name: "RPEngine · extract", content: "// notes", enabled: false, marker: null, role: "system", position: "pre_history", injectionTrigger: [] });
    expect(spliceBlocks([plain], null, [{ kind: "category", name: "RPEngine" }], () => "c").map((b) => b.id)).toEqual(["main", "c"]);
  });
});

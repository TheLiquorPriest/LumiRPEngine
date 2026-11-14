// The worlds a migration carried become Build's: copied in once, replaced by a later run while Build's
// copy is still the one a run put there, and never overwritten once it was changed in RPE.

import { describe, expect, test } from "bun:test";
import { seedCarriedWorlds } from "../../src/build/index";
import { hashJson } from "../../src/shared/hash";
import type { WorldDoc } from "../../src/shared/world";
import { type Bed, body, makeBed, makePage, starter, USER } from "./bed";

/** A world as today's storage holds it, revision by revision, oldest first. */
interface Today {
  id: string;
  name: string;
  docs: WorldDoc[];
}

function revisionOf(doc: WorldDoc): string {
  return hashJson(doc);
}

/** A migration run's copy of today's worlds, in place of the last run's, as `carryWorlds` writes it. */
async function carry(bed: Bed, run: string, worlds: readonly Today[]): Promise<void> {
  const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
  await bed.writes.run((db) => {
    db.run("DELETE FROM world_file WHERE user = ?", [USER]);
    const put = db.query("INSERT INTO world_file (user, world, file, bytes, sha256, run) VALUES (?, ?, ?, ?, 'not checked here', ?)");
    for (const w of worlds) {
      const revisions = w.docs.map(revisionOf);
      put.run(USER, w.id, "index.json", bytes({ id: w.id, name: w.name, head: revisions.at(-1), loreBookId: null, revisions }), run);
      put.run(USER, w.id, "history.json", bytes({ v: 1, notes: revisions.map((revision, i) => ({ revision, at: i + 1, source: i === 0 ? "create" : "build" })) }), run);
      for (const doc of w.docs) put.run(USER, w.id, `rev/${revisionOf(doc)}.json`, bytes(doc), run);
    }
  }, "a migration run's copy of the worlds");
}

/** A world of today's: a starter world under its own id, and a later revision of it with one more kind. */
function todays(id: string, name: string): { first: WorldDoc; second: WorldDoc } {
  const first = { ...starter("fantasy_town", name), id };
  return { first, second: { ...first, kinds: { ...first.kinds, ferryman: { id: "ferryman", label: "Ferryman", extends: "person", fields: {} } } } };
}

describe("the worlds a migration carried", () => {
  test("are copied in once, replaced while Build's copy is a run's, and kept once changed in RPE", async () => {
    const bed = makeBed();
    const page = makePage(bed);
    const seed = () => bed.writes.run((db) => seedCarriedWorlds(db, USER), "taking the carried worlds into Build");
    const mill = todays("w_mill", "Millbrook");
    const quay = todays("w_quay", "Saltquay");

    await carry(bed, "run-1", [{ id: "w_mill", name: "Millbrook", docs: [mill.first] }]);
    expect(await seed()).toEqual({ copied: ["w_mill"], replaced: [], unchanged: [], kept: [] });
    const listed = body(await page.send({ type: "lre.world", op: "list" }), "lre.world").worlds ?? [];
    expect(listed.map((w) => [w.id, w.name, w.head])).toEqual([["w_mill", "Millbrook", revisionOf(mill.first)]]);
    expect(body(await page.send({ type: "lre.world", op: "get", worldId: "w_mill" }), "lre.world").world?.name).toBe("Millbrook");

    // The same run again changes nothing; a later run with a newer revision replaces a copy Build left as it was.
    expect(await seed()).toEqual({ copied: [], replaced: [], unchanged: ["w_mill"], kept: [] });
    await carry(bed, "run-2", [
      { id: "w_mill", name: "Millbrook", docs: [mill.first, mill.second] },
      { id: "w_quay", name: "Saltquay", docs: [quay.first] },
    ]);
    expect(await seed()).toEqual({ copied: ["w_quay"], replaced: ["w_mill"], unchanged: [], kept: [] });
    const millHead = revisionOf(mill.second);
    expect(body(await page.send({ type: "lre.world", op: "get", worldId: "w_mill" }), "lre.world").revision).toBe(millHead);

    // Changed in RPE: Millbrook edited and committed, Saltquay removed. A later run takes neither back.
    await page.send({ type: "lre.editor", op: "put", worldId: "w_mill", base: millHead, collection: "kinds", id: "lamplighter", value: { id: "lamplighter", label: "Lamplighter", extends: "person", fields: {} } });
    const committed = body(await page.send({ type: "lre.world", op: "commit", worldId: "w_mill", base: millHead }), "lre.world").revision ?? "";
    await page.send({ type: "lre.world", op: "delete", worldId: "w_quay" });
    const later = { ...mill.second, name: "Millbrook-on-Wend" };
    await carry(bed, "run-3", [
      { id: "w_mill", name: "Millbrook-on-Wend", docs: [mill.first, mill.second, later] },
      { id: "w_quay", name: "Saltquay", docs: [quay.first] },
    ]);
    expect(await seed()).toEqual({ copied: [], replaced: [], unchanged: [], kept: ["w_mill", "w_quay"] });
    const after = body(await page.send({ type: "lre.world", op: "list" }), "lre.world").worlds ?? [];
    expect(after.map((w) => [w.id, w.name, w.head])).toEqual([["w_mill", "Millbrook", committed]]);
    expect(after[0]?.revisions).not.toContain(revisionOf(later));
  });
});

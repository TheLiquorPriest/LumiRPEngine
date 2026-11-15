// Build's home for worlds: the files today's world store writes, per user, in RPE's database. Today's
// store runs over it unchanged, so what it does there is what it does on Lumiverse's storage.

import { describe, expect, test } from "bun:test";
import { BuildFiles, worldHost } from "../../src/build/files";
import { WorldStore } from "../../src/worlds/worlds";
import { STARTER_TABLES } from "../../src/packs/index";
import { type Bed, makeBed, OTHER, registry, starter, USER } from "./bed";

function storeOn(bed: Bed): { files: BuildFiles; worlds: WorldStore } {
  const files = new BuildFiles(bed.db, bed.writes);
  return { files, worlds: new WorldStore(worldHost(files, bed.log), registry(), STARTER_TABLES) };
}

describe("Build's home for worlds", () => {
  test("today's world store makes, edits and lists a world in RPE's database, and another user sees none of it", async () => {
    const bed = makeBed();
    const { files, worlds } = storeOn(bed);
    const made = await worlds.create("Fernwick", starter("fantasy_town", "Fernwick"), USER);
    const id = made.world.id;
    expect((await files.list("", USER)).sort()).toEqual([`worlds/${id}/history.json`, `worlds/${id}/index.json`, `worlds/${id}/rev/${made.revision}.json`]);

    const edited = await worlds.edit({ lre: 1, type: "lre.editor", reqId: "r1", op: "set", worldId: id, base: made.revision, part: "meta", value: { genre: "fantasy" } }, USER);
    expect(edited).toMatchObject({ base: made.revision, stored: true, version: 1 });
    expect(await files.list(`worlds/${id}`, USER)).toContain(`worlds/${id}/draft.json`);
    expect((await worlds.list(USER)).map((w) => [w.id, w.name, w.head])).toEqual([[id, "Fernwick", made.revision]]);

    expect(await worlds.list(OTHER)).toEqual([]);
    expect(await files.list("", OTHER)).toEqual([]);
    await expect(worlds.get(id, OTHER)).rejects.toThrow("not found");
  });

  test("a folder is listed by its own name only, and a world removed takes none of another's files", async () => {
    const { files, worlds } = storeOn(makeBed());
    await files.write("worlds/w_1/index.json", "{}", USER);
    await files.write("worlds/w_10/index.json", "{}", USER);
    expect(await files.list("worlds/w_1/", USER)).toEqual(["worlds/w_1/index.json"]);
    await worlds.remove("w_1", USER);
    expect(await files.list("worlds/", USER)).toEqual(["worlds/w_10/index.json"]);
  });

  test("a damaged history is set aside beside it and said in the application's log; a move of nothing fails", async () => {
    const bed = makeBed();
    const { files, worlds } = storeOn(bed);
    const made = await worlds.create("Fernwick", starter("fantasy_town", "Fernwick"), USER);
    const path = `worlds/${made.world.id}/history.json`;
    await files.write(path, "{ not json", USER);
    expect(await worlds.history(made.world.id, USER)).toEqual([]);
    const aside = (await files.list(`worlds/${made.world.id}`, USER)).filter((p) => p.startsWith(`${path}.corrupt-`));
    expect(aside.length).toBe(1);
    expect(await files.read(aside[0] ?? "", USER)).toBe("{ not json");
    expect(await files.read(path, USER)).toBeNull();
    expect(bed.logs.filter((l) => l.level === "warn").map((l) => l.fields)).toEqual([{ user: USER }]);
    await expect(files.move("worlds/none.json", "worlds/other.json", USER)).rejects.toThrow("File not found");
  });
});

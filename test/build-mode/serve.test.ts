// Build's route answers today's messages as today's dispatcher does: a world made from a starter
// template, edited, committed, listed, exported and imported again, each answer in the shape
// `ResultBodies` gives it, with the pushes it caused; what this build does not serve says so.

import { describe, expect, test } from "bun:test";
import { RouteError } from "../../src/app";
import { EXPORT_FORMAT, type WorldDoc } from "../../src/shared/world";
import { body, makeBed, makePage, OTHER, refusal, words as line } from "./bed";

const keys = (value: object): string[] => Object.keys(value).sort();

describe("Build's route", () => {
  test("a world is made from a starter template, edited, committed, listed, exported and imported again", async () => {
    const page = makePage(makeBed());
    const templates = body(await page.send({ type: "lre.world", op: "templates" }), "lre.world");
    expect(keys(templates)).toEqual(["templates"]);
    expect(templates.templates?.map((t) => t.id)).toContain("fantasy_town");

    const created = await page.send({ type: "lre.world", op: "create", name: "Fernwick", template: "fantasy_town" });
    const made = body(created, "lre.world");
    expect(keys(made)).toEqual(["revision", "world"]);
    expect(created.pushes).toEqual([]);
    const worldId = made.world?.id ?? "";
    const head = made.revision ?? "";
    const place = Object.values(made.world?.places ?? {}).find((p) => p.map === undefined);
    if (place === undefined) throw new Error("the starter world has no place of its own");

    const opened = body(await page.send({ type: "lre.editor", op: "get", worldId, base: null }), "lre.editor");
    expect(keys(opened)).toEqual(["base", "draft", "lint", "stored", "version"]);
    expect({ base: opened.base, stored: opened.stored, version: opened.version }).toEqual({ base: head, stored: false, version: 0 });

    const kind = { id: "lamplighter", label: "Lamplighter", extends: "person", fields: {} };
    const put = await page.send({ type: "lre.editor", op: "put", worldId, base: head, version: 0, collection: "kinds", id: "lamplighter", value: kind });
    expect(keys(body(put, "lre.editor"))).toEqual(["base", "draft", "lint", "stored", "version"]);
    expect(put.pushes).toEqual([{ lre: 1, type: "lre.draft.changed", worldId, version: 1, stored: true, base: head }]);

    const renamed = await page.send({ type: "lre.editor", op: "patch", worldId, base: head, version: 1, ops: [{ op: "replace", path: `/places/${place.id}/name`, value: "Lantern Row" }] });
    expect(body(renamed, "lre.editor").version).toBe(2);

    // A page that read the draft at version 1 writes again: the draft moved on, so it is told, and nothing changed.
    const stale = await page.send({ type: "lre.editor", op: "put", worldId, base: head, version: 1, collection: "kinds", id: "lamplighter", value: { ...kind, label: "Lamp-man" } });
    expect({ code: refusal(stale).code, pushes: stale.pushes }).toEqual({ code: "conflict", pushes: [] });

    const committed = await page.send({ type: "lre.world", op: "commit", worldId, base: head, version: 2, note: "lamps and a new street" });
    const commit = body(committed, "lre.world");
    expect(keys(commit)).toEqual(["lint", "revision"]);
    const revision = commit.revision ?? "";
    expect(revision).not.toBe(head);
    expect(committed.pushes).toEqual([{ lre: 1, type: "lre.draft.changed", worldId, version: 3, stored: false, base: revision }]);

    const listed = body(await page.send({ type: "lre.world", op: "list" }), "lre.world");
    expect(keys(listed)).toEqual(["worlds"]);
    expect(listed.worlds?.map((w) => [w.id, w.name, w.head])).toEqual([[worldId, "Fernwick", revision]]);

    const got = body(await page.send({ type: "lre.world", op: "get", worldId }), "lre.world");
    expect(keys(got)).toEqual(["functions", "history", "packKinds", "packRelations", "revision", "world"]);
    expect(got.history?.map((n) => [n.revision, n.source, n.note])).toEqual([
      [head, "create", undefined],
      [revision, "build", "lamps and a new street"],
    ]);

    const exported = body(await page.send({ type: "lre.world", op: "export", worldId }), "lre.world");
    expect(keys(exported)).toEqual(["file"]);
    // An export file is JSON to the protocol; its shape is today's world store's `exportFile`.
    const file = exported.file as unknown as { format: string; world: WorldDoc };
    expect(file.format).toBe(EXPORT_FORMAT);
    expect({ kind: file.world.kinds.lamplighter?.label, place: file.world.places[place.id]?.name }).toEqual({ kind: "Lamplighter", place: "Lantern Row" });

    const imported = body(await page.send({ type: "lre.world", op: "import", file }), "lre.world");
    expect(keys(imported)).toEqual(["lint", "revision", "world"]);
    expect(imported.world?.id).not.toBe(worldId);
    expect({ kind: imported.world?.kinds.lamplighter?.label, place: imported.world?.places[place.id]?.name }).toEqual({ kind: "Lamplighter", place: "Lantern Row" });
    expect(body(await page.send({ type: "lre.world", op: "list" }), "lre.world").worlds?.length).toBe(2);
  });

  test("the draft's reads answer from the draft, and a second user sees none of the first user's worlds", async () => {
    const page = makePage(makeBed());
    const made = body(await page.send({ type: "lre.world", op: "create", name: "Fernwick", template: "fantasy_town" }), "lre.world");
    const worldId = made.world?.id ?? "";
    const pov = made.world?.pov ?? "";

    expect(keys(body(await page.send({ type: "lre.things", scope: "build", worldId, op: "list" }), "lre.things"))).toEqual(["list"]);
    const character = body(await page.send({ type: "lre.character", op: "get", scope: "build", worldId, entity: pov }), "lre.character");
    expect({ keys: keys(character), id: character.character.id }).toEqual({ keys: ["character", "places", "things"], id: pov });
    expect(refusal(await page.send({ type: "lre.character", op: "get", scope: "build", worldId, entity: "nobody" })).code).toBe("not_found");
    expect(keys(body(await page.send({ type: "lre.world", op: "sheet", worldId, ruleset: made.world?.ruleset ?? null }), "lre.world"))).toEqual(["sheet", "skills"]);
    expect(keys(body(await page.send({ type: "lre.world", op: "updates", worldId }), "lre.world"))).toEqual(["updates"]);

    expect(body(await page.send({ type: "lre.world", op: "list" }, OTHER), "lre.world").worlds).toEqual([]);
    expect(refusal(await page.send({ type: "lre.world", op: "get", worldId }, OTHER)).code).toBe("not_found");
    expect(refusal(await page.send({ type: "lre.editor", op: "get", worldId, base: null }, OTHER)).code).toBe("not_found");
    expect(body(await page.send({ type: "lre.world", op: "delete", worldId }), "lre.world").worlds).toEqual([]);
  });

  test("what this build does not serve is answered unavailable, in the words of Build's file", async () => {
    const page = makePage(makeBed());
    for (const [message, words] of [
      [{ type: "lre.job", op: "list", worldId: "w_1" }, line("job")],
      [{ type: "lre.lore", op: "books" }, line("lore")],
      [{ type: "lre.secrecy", op: "books" }, line("secrecy")],
      [{ type: "lre.world", op: "chats" }, line("world_chats")],
      [{ type: "lre.things", scope: "gm", chatId: "c_1", op: "list" }, line("scope", { type: "lre.things", scope: "gm" })],
    ] as const) {
      const answer = refusal(await page.send(message));
      expect({ code: answer.code, message: answer.message }).toEqual({ code: "unavailable", message: words });
      expect(answer.message.length).toBeGreaterThan(0);
    }
    expect(refusal(await page.send({ type: "lre.hello" }))).toMatchObject({ code: "bad_request", message: line("not_build", { type: "lre.hello" }) });
    expect(refusal(await page.send({ type: "lre.world", op: "get", worldId: "../w_1" }))).toMatchObject({ code: "bad_request", message: "invalid worldId" });
    await expect(page.send({ type: 7 })).rejects.toBeInstanceOf(RouteError);
  });
});

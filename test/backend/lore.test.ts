// Lore curation on the fake host (DESIGN §4.2): drift between a book-sourced entry and its World
// Info entry, and the lookup table written whole as a world part.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import { bookTextHash } from "../../src/shared/lore";
import { Rig } from "../support/rig";

const bookEntry = (comment: string, content: string) => ({ comment, content, keys: [comment.toLowerCase()], disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {} });

describe("lore curation", () => {
  test("drift: a book-sourced entry whose book entry changed shows the new text; one whose entry is gone says so", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const user = rig.host.userId;
    const book = await rig.host.books.create("Harbor lore", "", user);
    const text = "The old lighthouse stands dark on the breakwater.";
    const entryId = await rig.host.books.createEntry(book, bookEntry("Lighthouse", text), user);
    const gone = await rig.host.books.createEntry(book, bookEntry("Ferry", "The ferry runs hourly."), user);
    const put = (id: string, from: string, content: string) => rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id, value: { id, title: id, content, keys: [], links: [], source: { kind: "book", bookId: book, entryId: from, hash: bookTextHash(content) } } });
    rig.body(await put("lighthouse", entryId, text));
    rig.body(await put("ferry", gone, "The ferry runs hourly."));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "authored", value: { id: "authored", title: "Authored", content: "x", keys: [], links: [] } }));
    const drift = async (id?: string) => rig.body(await rig.send({ type: "lre.lore", op: "drift", worldId, ...(id ? { id } : {}) })).drift;
    expect(await drift()).toEqual({});
    rig.host.editEntry(entryId, { content: "The old lighthouse burns again." });
    await rig.host.books.deleteEntry(gone, user);
    expect(await drift()).toEqual({ lighthouse: { status: "changed", content: "The old lighthouse burns again.", hash: bookTextHash("The old lighthouse burns again.") }, ferry: { status: "missing" } });
    expect(await drift("ferry")).toEqual({ ferry: { status: "missing" } });
    expect(await drift("authored")).toEqual({});
    // Refreshed from the book (as the form does) and saved: it matches again.
    rig.body(await put("lighthouse", entryId, "The old lighthouse burns again."));
    expect(await drift("lighthouse")).toEqual({});
    const unknown = await rig.send({ type: "lre.lore", op: "drift", worldId, id: "constructor" });
    expect(unknown.type === "lre.error" && unknown.code).toBe("not_found");
  });

  test("the lookup table is written whole; keys that could reach a prototype and lists of other things are dropped", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const value = JSON.parse('{"terms":{"lamp":["lighthouse",4,null],"__proto__":["x"],"dock":"pier"},"topics":{"harbor":{"label":"Harbor","entries":["lighthouse"]},"constructor":{"label":"x","entries":[]},"odd":"nope"}}');
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "loreIndex", value })).draft;
    expect(isRecord(draft) && draft.loreIndex).toEqual({ terms: { lamp: ["lighthouse"], dock: [] }, topics: { harbor: { label: "Harbor", entries: ["lighthouse"] } } });
  });
});

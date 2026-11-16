// Build's lore tools on his books (PlanChatUI-B3): his books listed with each entry's LRE fields and secret marks, pins of a world read now,
// LRE's fields and Make secret written on his press with the revision the page read (a stale write refused, before and after kept), and a chat's
// reply saved as a draft lore entry of the world it plays. His books are in memory (books-bed.ts); the world service is the real one over a bed.

import { describe, expect, test } from "bun:test";
import { LEDGER_NAMESPACE as NS } from "../../src/shared/ledger";
import { parseSecretMarks } from "../../src/shared/secret-marks";
import { LoreError } from "../../src/build/lore/service";
import { FakeBooks, loreOn } from "./books-bed";
import { makeBed, USER } from "./bed";

describe("his books in Build", () => {
  test("a book of sixty entries lists with each entry's fields, marks and revision", async () => {
    const bed = makeBed();
    const books = new FakeBooks();
    const book = books.add("Port Alder");
    for (let i = 0; i < 60; i++) books.put(book, { comment: `Entry ${i}`, content: i === 3 ? "{{// Secret (known to priya): She sleeps in the back room.}}" : `Text ${i}`, extensions: i === 5 ? { [NS]: { lore: { links: ["harbor"], aliases: ["the pier"] } } } : {} });
    books.add("Other");
    const { lore } = loreOn(bed, books);
    expect((await lore.books(USER, null)).map((b) => b.name)).toEqual(["Other", "Port Alder"]);
    const entries = await lore.entries(USER, book);
    expect(entries).toHaveLength(60);
    expect(entries[3]).toMatchObject({ title: "Entry 3", whole: true, revision: 1, marks: [{ knownTo: ["priya"] }] });
    expect(entries[5]?.lore).toEqual({ links: ["harbor"], aliases: ["the pier"] });
    expect(entries[0]?.marks).toBeUndefined();
  });

  test("a book entry and a whole book pinned to a place read back, with the title, source and status", async () => {
    const bed = makeBed();
    const books = new FakeBooks();
    const book = books.add("Port Alder");
    const harbor = books.put(book, { comment: "The harbor", content: "Boats tie up at the north pier." });
    const off = books.put(book, { comment: "Old harbor", content: "Gone.", disabled: true });
    const { lore, worlds } = loreOn(bed, books);
    const made = await worlds.create(USER, "Fernwick", "fantasy_town");
    const place = Object.keys(made.world.places)[0] ?? "";
    await worlds.draft(USER, made.world.id, { op: "patch", ops: [{ op: "add", path: `/lorePins`, value: { places: { [place]: [{ book, entry: harbor }, { book, entry: off }, { book }, { book: "gone" }] } } }] });
    const { places } = await lore.pins(USER, { world: made.world.id });
    expect((places[place] ?? []).map((p) => [p.title, p.status])).toEqual([
      ["The harbor", "ok"],
      ["Old harbor", "off"],
      ["Port Alder", "ok"],
      ["A World Info book", "missing"],
    ]);
    expect(places[place]?.[2]?.source).toBe("The whole book: 1 entry switched on");
  });

  test("Make secret writes the mark; a second write after the entry changed in Lumiverse is refused as stale; before and after are kept", async () => {
    const bed = makeBed();
    const books = new FakeBooks();
    const book = books.add("Port Alder");
    const id = books.put(book, { comment: "The key", content: "Helen keeps the spare key under the mat." });
    const { lore } = loreOn(bed, books);
    const read = (await lore.entries(USER, book))[0];
    const after = await lore.mark(USER, book, id, { kind: "secret", knownTo: ["helen"], keptFrom: "everyone" }, read?.revision ?? -1);
    expect(parseSecretMarks(books.at(id).content).map((m) => [m.text, m.knownTo])).toEqual([["Helen keeps the spare key under the mat.", ["helen"]]]);
    expect(after[0]?.whole).toBe(true);
    expect(books.written).toHaveLength(1);
    expect(books.written[0]?.before.content).toBe("Helen keeps the spare key under the mat.");
    // The entry changes in Lumiverse; the page still holds the old revision.
    books.elsewhere(id, { content: "Someone moved the key." });
    const stale = lore.mark(USER, book, id, { kind: "public", mark: 0 }, after[0]?.revision ?? -1);
    await expect(stale).rejects.toBeInstanceOf(LoreError);
    await expect(stale).rejects.toMatchObject({ code: "conflict" });
    expect(books.at(id).content).toBe("Someone moved the key.");
    expect(books.written).toHaveLength(1);
  });

  test("LRE's fields are written into the entry's extension data and nothing else; an entry the engine wrote, and a field of the old secrecy, are refused", async () => {
    const bed = makeBed();
    const books = new FakeBooks();
    const book = books.add("Port Alder");
    const id = books.put(book, { comment: "The harbor", content: "Boats.", extensions: { other_extension: { kept: true }, [NS]: { lore: { secret: true } } } });
    const scene = books.put(book, { comment: "Scene", content: "", extensions: { [NS]: { slot: "scene" } } });
    const { lore } = loreOn(bed, books);
    const revision = books.at(id).revision;
    await lore.fields(USER, book, id, { links: ["harbor"], aliases: ["the pier"] }, revision);
    expect(books.at(id).extensions).toEqual({ other_extension: { kept: true }, [NS]: { lore: { secret: true, links: ["harbor"], aliases: ["the pier"] } } });
    expect([books.at(id).content, books.at(id).comment]).toEqual(["Boats.", "The harbor"]);
    await expect(lore.fields(USER, book, id, { secret: true } as never, books.at(id).revision)).rejects.toMatchObject({ code: "bad_request" });
    await expect(lore.fields(USER, book, scene, null, books.at(scene).revision)).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("Save to lore", () => {
  test("the latest reply, or an excerpt, becomes a draft lore entry of the chat's world, with the message it came from; nothing is committed", async () => {
    const bed = makeBed();
    const books = new FakeBooks();
    const messages = [
      { id: "m1", role: "user" as const, text: "Tell me about the harbor." },
      { id: "m2", role: "assistant" as const, text: "The harbor is old.  Boats tie up at the NORTH pier. Gulls cry." },
      { id: "m3", role: "assistant" as const, text: "It rains again." },
    ];
    const { lore, worlds } = loreOn(bed, books, messages);
    const made = await worlds.create(USER, "Fernwick", "fantasy_town");
    const s = bed.store.user(USER);
    await bed.writes.run(() => s.createChat({ id: "c", world: made.world.id }), "a chat that plays the world");
    await expect(lore.save(USER, "none")).rejects.toMatchObject({ code: "bad_request" });
    const first = await lore.save(USER, "c");
    const second = await lore.save(USER, "c", "boats tie up at the north pier");
    const again = await lore.save(USER, "c", "It rains again.");
    const doc = (await worlds.worlds.working(made.world.id, USER)).lore;
    expect(doc[first.id]).toMatchObject({ content: "It rains again.", source: { kind: "chat", chatId: "c", messageId: "m3" } });
    expect(doc[second.id]).toMatchObject({ content: "boats tie up at the north pier", source: { messageId: "m2" } });
    // The same title twice gets a fresh id.
    expect(new Set([first.id, second.id, again.id]).size).toBe(3);
    expect((await worlds.read(USER, made.world.id)).history).toHaveLength(1);
  });
});

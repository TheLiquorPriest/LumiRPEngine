// Lore curation on the fake host (DESIGN §4.2): drift between a book-sourced entry and its World
// Info entry, the lookup table written whole as a world part, and the AI indexing jobs end to end
// (book or text → helper → checked proposals with sources → applied as the review does).

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import { bookTextHash } from "../../src/shared/lore";
import type { JobProposal } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import { IMPORT_MAX_CALLS } from "../../src/backend/proposals";
import { INDEX_TEXT_CHUNK, textChunks } from "../../src/backend/lore-index";
import { proposalWrites } from "../../src/frontend/build/jobs";
import { Rig } from "../support/rig";

/** Starts a job on the rig's fake host and returns its last update. */
async function finished(rig: Rig, kind: "index_book" | "index_text", worldId: string, input: Record<string, unknown>) {
  const jobId = rig.body(await rig.send({ type: "lre.job", op: "start", kind, worldId, input: JSON.parse(JSON.stringify(input)) })).jobId;
  await rig.host.settle();
  const last = rig.host.sent.filter((m) => m.type === "lre.job.update" && m.jobId === jobId).at(-1);
  if (last?.type !== "lre.job.update") throw new Error("the job sent nothing");
  return { status: last.status, message: last.message, proposals: last.result && "proposals" in last.result ? last.result.proposals : [] };
}

async function draftOf(rig: Rig, worldId: string): Promise<WorldDoc> {
  return rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
}

/** Applies every proposal to the draft as the review's Apply does. */
async function applyAll(rig: Rig, worldId: string, proposals: JobProposal[]): Promise<WorldDoc> {
  for (const write of proposalWrites(worldId, proposals, new Set(proposals.map((p) => p.id)), (await draftOf(rig, worldId)).loreIndex)) rig.body(await rig.send({ ...write }));
  return draftOf(rig, worldId);
}

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

describe("AI lore indexing", () => {
  test("Index a World Info book: proposals keep the book's text and its hash, link only what exists, skip lore the world has, and join the lookup table when applied", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const user = rig.host.userId;
    const book = await rig.host.books.create("Harbor lore", "", user);
    const text = "The old lighthouse stands dark on the breakwater. Dev keeps the key.";
    const light = await rig.host.books.createEntry(book, bookEntry("Lighthouse", text), user);
    const ferry = await rig.host.books.createEntry(book, bookEntry("Ferry", "The ferry runs hourly from the home dock."), user);
    const off = await rig.host.books.createEntry(book, { ...bookEntry("Off", "Switched off."), disabled: true }, user);
    // The ferry was indexed before: it is skipped without being read.
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "ferry", value: { id: "ferry", title: "The ferry", content: "The ferry runs hourly from the home dock.", keys: [], links: [], source: { kind: "book", bookId: book, entryId: ferry, hash: bookTextHash("The ferry runs hourly from the home dock.") } } }));
    rig.host.quietReply = () =>
      JSON.stringify({
        entries: [
          { key: "Breakwater Lighthouse", title: "Breakwater Lighthouse", aliases: ["the old lighthouse", "Breakwater lighthouse"], topics: ["Harbor"], links: ["dev", "mars"], terms: ["Lamp house"], confidence: 0.9, source: light },
          { key: "light_again", title: "Lighthouse again", confidence: 0.5, source: "Lighthouse" },
          { key: "nowhere", title: "Nowhere", confidence: 0.9, source: "e-unknown" },
        ],
      });
    const out = await finished(rig, "index_book", worldId, { bookId: book });
    const prompt = rig.host.quietCalls.map((c) => c.messages.map((m) => m.content).join("\n")).join("\n");
    expect(rig.host.quietCalls.length).toBe(1);
    expect(prompt).toContain(`(source: ${light})`);
    expect(prompt).not.toContain(`(source: ${ferry})`);
    expect(prompt).not.toContain(`(source: ${off})`);
    expect(prompt).toContain("dev:person:Dev");
    expect(out.proposals.map((p) => p.key)).toEqual(["breakwater_lighthouse"]);
    const [p] = out.proposals;
    expect(p?.value).toEqual({ id: "breakwater_lighthouse", title: "Breakwater Lighthouse", content: text, keys: ["lighthouse"], links: ["dev"], aliases: ["the old lighthouse"], topics: ["Harbor"], source: { kind: "book", bookId: book, entryId: light, hash: bookTextHash(text) } });
    expect(p?.index).toEqual({ terms: ["breakwater lighthouse", "the old lighthouse", "lamp house"], topics: [{ id: "harbor", label: "Harbor" }] });
    expect(p?.note).toContain("dropped unknown link mars");
    expect(p?.sourceNames).toEqual({ [`${book}/${light}`]: "Lighthouse" });
    expect(out.message).toContain("1 entry already in the world's lore was skipped.");
    expect(out.message).toContain("2 of 3 proposal(s) dropped");
    const after = await applyAll(rig, worldId, out.proposals);
    expect(after.lore.breakwater_lighthouse?.source).toEqual({ kind: "book", bookId: book, entryId: light, hash: bookTextHash(text) });
    expect(after.loreIndex).toEqual({ terms: { "breakwater lighthouse": ["breakwater_lighthouse"], "the old lighthouse": ["breakwater_lighthouse"], "lamp house": ["breakwater_lighthouse"] }, topics: { harbor: { label: "Harbor", entries: ["breakwater_lighthouse"] } } });
    expect(rig.body(await rig.send({ type: "lre.lore", op: "drift", worldId })).drift).toEqual({});
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    // Run again: every entry with text is in the lore now, so nothing is asked.
    rig.host.quietCalls.length = 0;
    const again = await finished(rig, "index_book", worldId, { bookId: book });
    expect([again.status, again.message, rig.host.quietCalls.length]).toEqual(["failed", "every entry of that book with text is already in the world's lore", 0]);
    // The world's own engine book is never indexed.
    const engine = (await rig.rt.worlds.index(worldId, user))?.loreBookId ?? "";
    expect((await finished(rig, "index_book", worldId, { bookId: engine })).message).toBe("that is the world's own engine book; pick one of your books");
  });

  test("Index this text: entries in the AI's words are pending until applied; repeated titles and empty text are dropped; a taken id gets a number", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "night_market", value: { id: "night_market", title: "The old market", content: "Gone now.", keys: [], links: [] } }));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "harbor", value: { id: "harbor", title: "The Harbor", content: "Boats.", keys: [], links: [] } }));
    const good = JSON.stringify({
      entries: [
        { key: "night_market", title: "Night market", content: "Stalls open at dusk on the pier by Home.", topics: ["Harbor life"], links: ["home"], confidence: 0.8 },
        { key: "harbor_2", title: "the harbor", content: "Boats and gulls.", confidence: 0.9 },
        { key: "blank", title: "Blank", content: "   ", confidence: 0.9 },
      ],
    });
    // An empty list for text that has some is asked once more.
    const replies = [JSON.stringify({ entries: [] }), good];
    rig.host.quietReply = () => replies.shift() ?? "";
    const out = await finished(rig, "index_text", worldId, { text: "The night market opens at dusk on the pier. Stalls sell fried fish.\n\nThe harbor is full of boats." });
    expect(rig.host.quietCalls.length).toBe(2);
    expect((rig.host.userLogs.get(rig.host.userId) ?? []).filter((l) => l.includes("index part")).map((l) => l.replace(/ in \d+ ms$/, ""))).toEqual(["info: [LumiRPEngine] index part 1 of 1 call: an empty list for lore with text", "info: [LumiRPEngine] index part 1 of 1 retry: 3 proposal(s)"]);
    expect(out.proposals.map((p) => [p.key, isRecord(p.value) ? p.value.source : null])).toEqual([["night_market_2", { kind: "ai", status: "pending" }]]);
    expect(out.message).toBe("2 of 3 proposal(s) dropped: 1 repeated an existing entry's title; 1 had no text.");
    const after = await applyAll(rig, worldId, out.proposals);
    expect(after.lore.night_market_2).toEqual({ id: "night_market_2", title: "Night market", content: "Stalls open at dusk on the pier by Home.", keys: [], links: ["home"], topics: ["Harbor life"], source: { kind: "ai", status: "accepted" } });
    expect(after.lore.night_market?.title).toBe("The old market");
    expect(after.loreIndex.topics).toEqual({ harbor_life: { label: "Harbor life", entries: ["night_market_2"] } });
  });

  test("pasted text is split by paragraph into bounded parts, and only the first parts a job may call for are read", async () => {
    const para = (c: string) => `${c.repeat(10)} `.repeat(400).trim();
    const parts = textChunks([para("a"), para("b"), para("c")].join("\n\n"));
    expect(parts.length).toBe(3);
    expect(parts.every((p) => p.length <= INDEX_TEXT_CHUNK)).toBe(true);
    expect(textChunks(`${"word ".repeat(2000)}`).every((p) => p.length <= INDEX_TEXT_CHUNK && !p.startsWith(" "))).toBe(true);
    const rig = new Rig();
    const worldId = await rig.newWorld();
    rig.host.quietReply = (request) => JSON.stringify({ entries: [{ key: `e${rig.host.quietCalls.length}`, title: `Entry ${rig.host.quietCalls.length}`, content: request.messages.at(-1)?.content.slice(0, 20) ?? "", confidence: 0.8 }] });
    const many = Array.from({ length: IMPORT_MAX_CALLS + 2 }, (_, i) => para(String.fromCharCode(97 + i))).join("\n\n");
    const out = await finished(rig, "index_text", worldId, { text: many });
    expect(rig.host.quietCalls.length).toBe(IMPORT_MAX_CALLS);
    expect(out.proposals.length).toBe(IMPORT_MAX_CALLS);
    expect(out.message).toContain(`Only the first ${IMPORT_MAX_CALLS} parts of the text`);
  });
});

describe("save to lore from a chat", () => {
  test("the latest reply, or an excerpt, becomes a draft lore entry of the chat's world, with the message it came from; nothing is committed", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    const worldId = run?.worldId ?? "";
    await rig.turn(chatId, "I look around the harbor.", "*The fog lifts.* Gulls circle the old lighthouse, dark for thirty years. A ferry horn sounds twice.");
    await rig.turn(chatId, "I head home.", "The street is quiet tonight.");
    const messages = await rig.host.chats.messages(chatId, rig.host.userId);
    const latest = messages.at(-1);
    const earlier = messages.find((m) => m.content.includes("Gulls circle"));
    const save = async (text?: string) => rig.body(await rig.send({ type: "lre.lore", op: "save", chatId, ...(text === undefined ? {} : { text }) }));
    const whole = await save();
    expect(whole.worldId).toBe(worldId);
    let draft = await draftOf(rig, worldId);
    expect(draft.lore[String(whole.id)]).toEqual({ id: String(whole.id), title: "The street is quiet tonight", content: "The street is quiet tonight.", keys: [], links: [], source: { kind: "chat", chatId, messageId: latest?.id ?? "" } });
    // An excerpt names the message that holds it, whatever its spacing and case.
    const part = await save("gulls circle the OLD   lighthouse, dark for thirty years.");
    draft = await draftOf(rig, worldId);
    expect(draft.lore[String(part.id)]?.content).toBe("gulls circle the OLD   lighthouse, dark for thirty years.");
    expect(draft.lore[String(part.id)]?.source).toEqual({ kind: "chat", chatId, messageId: earlier?.id ?? "" });
    // Text the chat doesn't hold word for word was saved at its latest reply.
    const pasted = await save("A note of my own.");
    expect((await draftOf(rig, worldId)).lore[String(pasted.id)]?.source).toEqual({ kind: "chat", chatId, messageId: latest?.id ?? "" });
    // The same title twice gets a fresh id; the head revision is untouched until a commit.
    const again = await save();
    expect(again.id).not.toBe(whole.id);
    const head = rig.body(await rig.send({ type: "lre.world", op: "get", worldId })).world as WorldDoc;
    expect(Object.keys(head.lore)).toEqual([]);
    // A chat that plays no world has nothing to save into.
    const plain = rig.host.createChat("Hello.");
    const refused = await rig.send({ type: "lre.lore", op: "save", chatId: plain });
    expect(refused.type === "lre.error" && refused.code).toBe("not_world_chat");
  });
});

// Lore curation on the fake host (DESIGN §4.2): the lookup table written whole as a world part, and
// Index this text end to end (text → helper → checked proposals → applied as the review does).

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import type { JobProposal } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import { IMPORT_MAX_CALLS } from "../../src/backend/proposals";
import { INDEX_TEXT_CHUNK, textChunks } from "../../src/backend/lore-index";
import { proposalWrites } from "../../src/frontend/build/jobs";
import { Rig } from "../support/rig";

/** Starts a job on the rig's fake host and returns its last update. */
async function finished(rig: Rig, kind: "index_text", worldId: string, input: Record<string, unknown>) {
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
  test("the lookup table is written whole; keys that could reach a prototype and lists of other things are dropped", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const value = JSON.parse('{"terms":{"lamp":["lighthouse",4,null],"__proto__":["x"],"dock":"pier"},"topics":{"harbor":{"label":"Harbor","entries":["lighthouse"]},"constructor":{"label":"x","entries":[]},"odd":"nope"}}');
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "loreIndex", value })).draft;
    expect(isRecord(draft) && draft.loreIndex).toEqual({ terms: { lamp: ["lighthouse"], dock: [] }, topics: { harbor: { label: "Harbor", entries: ["lighthouse"] } } });
  });
});

describe("AI lore indexing", () => {
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

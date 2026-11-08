// LumiBooks as the bootstrap's starting evidence (DEPTH-PLAN Round 2 item 1): a book's entries read as
// its tree with each entry's messages, each message's coverage checked by LumiBooks' own hash, and the
// records landed as neutral layer entries with no model call. The fixtures are invented, in the shapes
// LumiBooks exports: its summaries lorebook (hashes computed apart from the code, with `shasum`) and
// its shelf as a Lumiverse world book.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { HostBookEntryInput } from "../../src/backend/host";
import { lbBookOfExport, lbCoverOf, lbDrafts, lbMessageHash, lbNodes, lbParents, lbProgressOf, lbRuns, type LbMessage } from "../../src/backend/bootstrap/lumibooks";
import { JUMPSTART_SKIPS_COVERED, LumiBooksBootstrap } from "../../src/backend/bootstrap/lumibooks-service";
import { bootstrapEnv } from "../../src/backend/bootstrap/wiring";
import type { BootstrapEstimate, LbActionEstimate, LbTree } from "../../src/shared/bootstrap";
import { layerDraftProblem, type Basis, type LayerDraft, type LayerSummary } from "../../src/shared/layer";
import { STORY_BEAT } from "../../src/shared/story";
import { recordOf, STORY_RECORD } from "../../src/shared/story-record";
import { isRecord, type JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/lumibooks/${name}`, import.meta.url), "utf8"));
}

/** The chat the summaries lorebook was made from: who wrote each message, and its text. */
const TEXTS: [boolean, string][] = [
  [false, "The ferry docks at Gull Point as the fog lifts."],
  [true, "I step off and look for the harbor master."],
  [false, "Mara Venn waves from the customs shed."],
  [true, "I ask Mara about the missing lighthouse keeper."],
  [false, "Mara says the keeper, Oren Dace, vanished three nights ago."],
  [true, "I head up the cliff path to the lighthouse."],
  [false, "The lighthouse door hangs open; salt crusts the stairs."],
  [true, "I climb to the lamp room."],
];

function messages(change: (m: LbMessage, i: number) => LbMessage = (m) => m): LbMessage[] {
  return TEXTS.map(([isUser, content], i) => change({ id: `m${i}`, isUser, content }, i));
}

const CHAIN: Basis[] = TEXTS.map((_, i) => ({ message: `m${i}`, swipe: `c${i}`, parentPath: `p${i}` }));

/** What the layer lists of a draft once it landed. */
function summaryOf(d: LayerDraft, seq: number): LayerSummary {
  return { ...d, chat: "chat-gull", events: d.events.length, landed: { seq, at: "2026-11-08T12:00:00.000Z" } };
}

describe("LumiBooks: the tree and its coverage", () => {
  test("the summaries lorebook reads as volumes, arcs and chapters, each with its messages", () => {
    const book = lbBookOfExport(fixture("summaries.json"), "lorebook");
    expect(book?.records.map((r) => [r.id, r.level, r.range, r.title])).toEqual([
      ["0", "volume", [0, 3], "Vol #1 - Fog at Gull Point (msgs 1-4)"],
      ["1", "arc", [4, 5], "Arc #2 - The Keeper Gone (msgs 5-6)"],
      ["2", "chapter", [6, 6], "#5 - Open Door (msgs 7-7)"],
    ]);
    expect(book?.records[1]?.keys).toEqual(["Oren Dace", "lighthouse keeper", "cliff path"]);
    expect(book?.hashes.map((h) => h.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test("each message is checked by LumiBooks' hash: sha256 of [role, content]", async () => {
    const book = lbBookOfExport(fixture("summaries.json"), "lorebook");
    if (!book) throw new Error("no book");
    // The fixture's hashes were taken apart from this code; the code's own matches them.
    expect(await lbMessageHash(false, TEXTS[0]?.[1] ?? "")).toBe(book.hashes[0]?.hash ?? "");
    expect(await lbMessageHash(true, TEXTS[1]?.[1] ?? "")).toBe(book.hashes[1]?.hash ?? "");
    expect(await lbCoverOf(book, messages())).toEqual(["covered", "covered", "covered", "covered", "covered", "covered", "covered", "uncovered"]);
    // An edited message, and one whose writer changed, no longer match; the last message no entry reached is uncovered.
    const cover = await lbCoverOf(book, messages((m, i) => (i === 2 ? { ...m, content: "Mara Venn waves from the harbor office." } : i === 5 ? { ...m, isUser: false } : m)));
    expect(cover).toEqual(["covered", "covered", "changed", "covered", "covered", "changed", "covered", "uncovered"]);
    expect(lbRuns(cover, new Set(["uncovered"]))).toEqual([[7, 7]]);
    expect(lbRuns(cover, new Set(["changed", "uncovered"]))).toEqual([[2, 2], [5, 5], [7, 7]]);
    const nodes = lbNodes(book.records, cover, { caughtUp: {}, fullMind: {} }, { deep: new Set(), readThrough: -1 });
    expect(nodes.map((n) => [n.id, n.coverage, n.changed])).toEqual([
      ["0", "changed", 1],
      ["1", "changed", 1],
      ["2", "covered", 0],
    ]);
  });

  test("the shelf's chapters sit under the arc that rolled them up, and cover the messages they name", async () => {
    const book = lbBookOfExport(fixture("shelf.json"), "shelf");
    if (!book) throw new Error("no book");
    expect(book.records.map((r) => [r.id, r.level, r.range, r.superseded])).toEqual([
      ["a1", "arc", [0, 3], false],
      ["c1", "chapter", [0, 1], true],
      ["c2", "chapter", [2, 3], true],
      ["c3", "chapter", [4, 5], false],
    ]);
    expect([...lbParents(book.records)]).toEqual([
      ["c1", "a1"],
      ["c2", "a1"],
    ]);
    const cover = await lbCoverOf(book, messages());
    expect(cover).toEqual(["covered", "covered", "covered", "covered", "covered", "covered", "uncovered", "uncovered"]);
    const nodes = lbNodes(book.records, cover, { caughtUp: { c3: ["mara"] }, fullMind: {} }, { deep: new Set(["c1"]), readThrough: -1 });
    expect(nodes.map((n) => [n.id, n.coverage, n.children.map((c) => [c.id, c.coverage])])).toEqual([
      ["a1", "covered", [["c1", "deep"], ["c2", "covered"]]],
      ["c3", "covered", []],
    ]);
    expect(nodes[1]?.caughtUp).toEqual(["mara"]);
  });
});

describe("LumiBooks: records land with no model call", () => {
  test("each entry is a story.record at its last message, citing its range, its text a blob", () => {
    const book = lbBookOfExport(fixture("shelf.json"), "shelf");
    if (!book) throw new Error("no book");
    const { drafts, blobs } = lbDrafts("chat-gull", book, CHAIN, []);
    expect(drafts.map((d) => layerDraftProblem(d))).toEqual([null, null, null, null]);
    const records = drafts.map((d) => {
      expect(d.kind).toBe(STORY_RECORD);
      const event = d.events[0];
      const r = recordOf(event && "data" in event ? event.data : null);
      if (!r) throw new Error("not a record");
      expect(d.basis.message).toBe(r.to);
      return r;
    });
    expect(records.map((r) => [r.entry, r.level, r.range, r.from, r.to, r.parent ?? null])).toEqual([
      ["a1", "arc", [0, 3], "m0", "m3", null],
      ["c1", "chapter", [0, 1], "m0", "m1", "a1"],
      ["c2", "chapter", [2, 3], "m2", "m3", "a1"],
      ["c3", "chapter", [4, 5], "m4", "m5", null],
    ]);
    expect(blobs[records[3]?.text ?? ""]).toBe(book.records[3]?.text);
  });

  test("a changed entry supersedes what it landed before, and one the book lost is superseded", () => {
    const book = lbBookOfExport(fixture("shelf.json"), "shelf");
    if (!book) throw new Error("no book");
    const first = lbDrafts("chat-gull", book, CHAIN, []).drafts;
    const landed = first.map((d, i) => summaryOf(d, i + 1));
    // The same book again lands nothing new: every id is the one already there.
    expect(lbDrafts("chat-gull", book, CHAIN, landed).drafts.map((d) => d.id)).toEqual(first.map((d) => d.id));
    const edited = { ...book, records: book.records.filter((r) => r.id !== "c2").map((r) => (r.id === "c3" ? { ...r, text: `${r.text} The path is washed out halfway.` } : r)) };
    const again = lbDrafts("chat-gull", edited, CHAIN, landed).drafts;
    const c3 = again.find((d) => d.by?.job === "lumibooks:c3");
    expect(c3?.supersedes).toEqual([first[3]?.id ?? ""]);
    const gone = again.find((d) => d.events.length === 0);
    expect(gone?.supersedes).toEqual([first[2]?.id ?? ""]);
  });

  test("a record superseded by beats reads as read deeply; the run's beats mark how far it read", () => {
    const book = lbBookOfExport(fixture("shelf.json"), "shelf");
    if (!book) throw new Error("no book");
    const records = lbDrafts("chat-gull", book, CHAIN, []).drafts.map((d, i) => summaryOf(d, i + 1));
    const beats: LayerSummary = { id: "beats-1", chat: "chat-gull", basis: CHAIN[5] as Basis, kind: STORY_BEAT, events: 3, supersedes: [records[0]?.id ?? ""], by: { role: "historian", job: "chunk-1" }, landed: { seq: 9, at: "2026-11-08T12:00:00.000Z" } };
    const progress = lbProgressOf([...records, beats], CHAIN);
    expect([...progress.deep]).toEqual(["a1"]);
    expect(progress.readThrough).toBe(5);
  });

  test("a chat's LumiBooks shelf lands through the ledger with no model call", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Gull Point", "modern_slice_of_life");
    const chatId = rig.host.createChat(TEXTS[0]?.[1] ?? "");
    const chat = rig.host.chat(chatId);
    for (const [i, [isUser, text]] of TEXTS.slice(1, 7).entries()) rig.host.append(chat, { id: `g${i + 1}`, isUser, name: isUser ? "User" : "Narrator", swipes: [text], swipeId: 0, bag: {} });
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const shelf = fixture("shelf.json");
    if (!isRecord(shelf) || !Array.isArray(shelf.entries)) throw new Error("no shelf");
    const userId = rig.host.userId;
    const bookId = rig.host.userBook("LumiBooks - Gull Point - Narrator", { metadata: { lumibooks_chat_id: chatId } });
    const ids = new Map<string, string>();
    // The shelf names the chat's own messages by id, as LumiBooks keeps them.
    const chatIds = (await rig.rt.host.chats.messages(chatId, userId)).sort((a, b) => a.index - b.index).map((m) => m.id);
    for (const raw of shelf.entries) {
      if (!isRecord(raw) || !isRecord(raw.extensions) || !isRecord(raw.extensions.lumibooks)) continue;
      const own = { ...raw.extensions.lumibooks, msgIds: Array.isArray(raw.extensions.lumibooks.msgIds) ? raw.extensions.lumibooks.msgIds.map((id) => chatIds[Number(String(id).slice(1))] ?? "") : [] };
      const entry: HostBookEntryInput = { comment: String(raw.comment), content: String(raw.content), keys: Array.isArray(raw.key) ? raw.key.map(String) : [], disabled: raw.disabled === true, constant: true, extensions: { lumibooks: own } as JsonObject };
      ids.set(String(raw.uid), await rig.host.books.createEntry(bookId, entry, userId));
    }
    const asked = rig.host.quietCalls.length;
    const lumi = new LumiBooksBootstrap(rig.rt);
    expect(await lumi.land(chatId, userId)).toEqual({ landed: 4, refused: [] });
    expect(rig.host.quietCalls.length).toBe(asked);
    const landed = (await rig.rt.ledger.layerSummaries(chatId, userId)).filter((s) => s.kind === STORY_RECORD);
    expect(landed.map((s) => s.by?.job).sort()).toEqual([...ids.values()].map((id) => `lumibooks:${id}`).sort());
    // Landing again changes nothing: the same records are there under the same ids.
    expect(await lumi.land(chatId, userId)).toEqual({ landed: 4, refused: [] });
    expect((await rig.rt.ledger.layerSummaries(chatId, userId)).filter((s) => s.kind === STORY_RECORD)).toHaveLength(4);
    // GM → Depth → Bootstrap's tree: the arc holds the chapters it rolled up; the last message no entry names is uncovered.
    const tree = rig.body(await rig.send({ type: "lre.bootstrap", op: "lb_tree", chatId })).tree as LbTree;
    expect(tree.book).toBe("LumiBooks - Gull Point - Narrator");
    expect(tree.nodes.map((n) => [n.id, n.level, n.coverage, n.children.map((c) => c.id)])).toEqual([
      [ids.get("a1") ?? "", "arc", "covered", [ids.get("c1") ?? "", ids.get("c2") ?? ""]],
      [ids.get("c3") ?? "", "chapter", "covered", []],
    ]);
    expect(tree.uncovered).toEqual([[6, 6]]);
    const deep = rig.body(await rig.send({ type: "lre.bootstrap", op: "lb_deep", chatId, node: ids.get("c3") })).lbEstimate as LbActionEstimate;
    expect(deep.calls).toBeGreaterThan(0);
    expect(rig.host.quietCalls.length).toBe(asked);
    await rig.host.idle?.();
  });

  test("until the jumpstart pass exists, the run and its estimate read every message, the book's coverage only computed", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Gull Point", "modern_slice_of_life");
    const chatId = rig.host.createChat(TEXTS[0]?.[1] ?? "");
    const chat = rig.host.chat(chatId);
    for (const [i, [isUser, text]] of TEXTS.slice(1, 7).entries()) rig.host.append(chat, { id: `g${i + 1}`, isUser, name: isUser ? "User" : "Narrator", swipes: [text], swipeId: 0, bag: {} });
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const userId = rig.host.userId;
    const full = rig.body(await rig.send({ type: "lre.bootstrap", op: "estimate", chatId })).estimate as BootstrapEstimate;
    // LumiBooks' summaries lorebook: its hashes of messages 0-4, message 2 edited since.
    const hashes: { index: number; hash: string }[] = [];
    for (const [i, [isUser, text]] of TEXTS.slice(0, 5).entries()) hashes.push({ index: i, hash: await lbMessageHash(isUser, i === 2 ? "Mara Venn waved, before the edit." : text) });
    const lorebook = rig.host.userBook("LumiBooks summaries - gull", { metadata: { lumibooks_summary: { version: 1, algorithm: "sha256-role-content-v1", contentHash: "0".repeat(64), messages: hashes } } });
    await rig.host.books.createEntry(lorebook, { comment: "Vol #1 - Fog at Gull Point (msgs 1-5)", content: "The traveler lands at Gull Point and hears the keeper is gone.", keys: ["Gull Point"], disabled: false, constant: true, extensions: { lumibooks_summary: { tier: 3, messageIndices: [0, 1, 2, 3, 4] } } }, userId);
    const ids = (await rig.rt.host.chats.messages(chatId, userId)).sort((a, b) => a.index - b.index).map((m) => m.id);
    // What the book covers: the four messages whose hash still matches, not the edited one or those past it.
    expect([...(await new LumiBooksBootstrap(rig.rt).covered(chatId, userId))].sort()).toEqual([ids[0] ?? "", ids[1] ?? "", ids[3] ?? "", ids[4] ?? ""].sort());
    // Nothing reads the records yet, so the run skips none of them: the skip waits on the jumpstart pass.
    expect(JUMPSTART_SKIPS_COVERED).toBe(false);
    expect([...((await bootstrapEnv(rig.rt, chatId, userId, () => undefined).covered?.()) ?? [])]).toEqual([]);
    const read = rig.body(await rig.send({ type: "lre.bootstrap", op: "estimate", chatId })).estimate as BootstrapEstimate;
    expect(full.messages).toBe(7);
    expect(read.messages).toBe(7);
    expect(rig.host.quietCalls).toHaveLength(0);
    await rig.host.idle?.();
  });
});

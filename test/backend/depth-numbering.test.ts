// Every depth view names a message by the chat's own number for it (`index_in_chat`, its #N), as GM →
// Depth → Turn does: a message deleted before it never renumbers it, so the views agree with the chat
// where its place on the chain no longer does.

import { describe, expect, test } from "bun:test";
import { mindView, type EngineRt } from "../../src/backend/character-engine";
import { notebookView } from "../../src/backend/depth/notebook";
import { defaultSettings } from "../../src/backend/settings-store";
import { pollEvent } from "../../src/shared/author";
import { beatEvent, type Beat } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import authorPack from "../../src/packs/author/core/index";
import storyPack from "../../src/packs/story/core/index";
import { Harness } from "../support/harness";

describe("message numbers across the depth views", () => {
  test("Notebook and Minds number a message as the chat does, after a deletion before it", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack] });
    const stored = new Map<string, string>();
    const rt: EngineRt = {
      host: h.host,
      registry: h.registry,
      blobs: { get: async (_u, hash) => stored.get(hash) ?? null, put: async (_u, text) => (stored.set(blobHash(text), text), blobHash(text)) },
      settings: { get: async () => defaultSettings() },
      ledger: h.service,
    };
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "Coffee?");
    await h.send(chat, "See you at eight.");
    // The first exchange deleted: the head reply is still the chat's #4, though third on the chain.
    const listed = await h.host.chats.messages(chat, userId);
    for (const m of listed.filter((m) => m.index === 1 || m.index === 2)) h.host.deleteMessage(chat, m.id);
    await h.host.settle();
    const head = (await h.host.chats.messages(chat, userId)).at(-1);
    expect(head?.index).toBe(4);
    const basis = await h.service.basisFor(chat, userId);
    if (!basis || !head) throw new Error("no basis");
    expect(basis.message).toBe(head.id);

    const what = "Dev locks the cafe door.";
    stored.set(blobHash(what), what);
    const beat: Beat = { id: "b1", at: 600, order: 0, place: "home", actors: ["dev"], act: "did", about: [], what: blobHash(what), surface: blobHash(what), exposure: [{ who: "dev", channel: "sight", reach: "whole" }], by: { turn: "t1", decided: "character" } };
    expect((await h.service.landLayer(chat, userId, { id: "n1", basis, kind: "story.beat", events: [beatEvent(beat), pollEvent({ through: basis.message, considered: [], jobs: [] })] })).status).toBe("landed");

    const notebook = await notebookView({ host: h.host, blobs: rt.blobs, ledger: h.service }, chat, userId);
    expect(notebook.poll.map((p) => p.at)).toEqual(["after message 4"]);
    const mind = await mindView(rt, chat, userId, "dev");
    expect(mind.povs.map((p) => [p.beat.messageId, p.beat.index])).toEqual([[head.id, 4]]);
  });
});

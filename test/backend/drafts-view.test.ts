// GM → Depth → Drafts' presses while a reply is written (DEPTH-PLAN §4.6, §4.9): what the player does
// to an open draft anchors at the last message kept, before that reply, and lands as the reply is
// kept, rather than at the reply's blank, which a kept reply leaves. Both folds agree.

import { describe, expect, test } from "bun:test";
import { dropDraft, draftsView, type DraftsRt } from "../../src/backend/depth/drafts-view";
import { DRAFT_TYPES, draftsOn } from "../../src/backend/depth/offscreen/drafts";
import { defaultSettings } from "../../src/backend/settings-store";
import { AUTHOR_DROP, draftEvent, draftTexts, episodeBlobs, STORY_DRAFT, type DraftData } from "../../src/shared/episodes";
import { AUTHOR_VERDICT, verdictEvent } from "../../src/shared/author";
import { isRecord } from "../../src/shared/json";
import { hashJson, hashParts } from "../../src/shared/hash";
import { blobHash, isBlobHash } from "../../src/shared/stores";
import type { TurnModel } from "../../src/engine/ledger/journal";
import authorPack from "../../src/packs/author/core/index";
import storyPack from "../../src/packs/story/core/index";
import { Harness } from "../support/harness";

/** Turns that decide nothing: the drafts are the test's own. */
const model: TurnModel = { plan: () => [], read: () => [] };

/** A draft: Dale sells the boat at `at`, off screen. */
function boatDraft(id: string, at: number): DraftData {
  return {
    id,
    episode: { id: `e-${id}`, span: [at, at + 60], places: ["home"], people: ["dale"], why: "Dale needs the money before the bank calls.", parts: [{ subject: { event: "the boat's sale" }, treatment: "written", rationale: "routine business, nothing at stake on screen" }] },
    at,
    inputs: {},
    beats: [{ id: `${id}-sale`, at, order: 0, place: "home", actors: ["dale"], act: "did", about: [], what: hashParts("test.blob", `what ${id}`), surface: hashParts("test.blob", `surface ${id}`), exposure: [], by: { draft: id } }],
    effects: [{ type: "story.flag", data: { name: `sold-${id}`, value: true } }],
    touches: [{ ref: { thing: "boat" }, from: at }],
    summary: "Dale sells his boat to a buyer from the marina.",
  };
}

function rtOf(h: Harness): DraftsRt {
  const stored = new Map<string, string>();
  return {
    host: h.host,
    registry: h.registry,
    blobs: {
      get: async (_u: string, hash: string) => stored.get(hash) ?? null,
      put: async (_u: string, text: string) => {
        stored.set(blobHash(text), text);
        return blobHash(text);
      },
    },
    settings: { get: async () => defaultSettings() },
    ledger: h.service,
  } as unknown as DraftsRt;
}

describe("GM → Depth → Drafts while a reply is written", () => {
  test("a Drop anchors at the last message kept, before the reply, and lands as the reply is kept", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack], model });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "Hello.", "First reply.");
    const first = h.host.head(chat);
    const b1 = first ? await h.service.basisFor(chat, userId, first.id) : null;
    if (!b1) throw new Error("no basis");
    const d = boatDraft("d-boat", 0);
    expect((await h.service.landLayer(chat, userId, { id: "draft-d-boat", basis: b1, kind: STORY_DRAFT, events: [draftEvent(d)] })).status).toBe("landed");

    const said = h.host.sendUser(chat, "Onward.");
    await h.host.settle();
    const g = await h.host.start(chat, { type: "normal" });
    expect((await dropDraft(rt, chat, userId, d.id)).status).toBe("held");
    await h.host.finish(g, "Second reply.");
    await h.host.settle();

    expect(draftsOn(await h.service.readEvents(chat, userId, DRAFT_TYPES)).map((x) => [x.draft.id, x.state])).toEqual([["d-boat", "dropped"]]);
    expect((await h.service.layerSummaries(chat, userId)).filter((s) => s.kind === AUTHOR_DROP).map((s) => s.basis.message)).toEqual([said]);
    expect((await draftsView(rt, chat, userId)).drafts.map((x) => [x.id, x.state])).toEqual([["d-boat", "dropped"]]);
    const { reference, optimized, cold } = await h.folds(chat);
    expect(hashJson(optimized.state)).toBe(hashJson(reference.state));
    expect(hashJson(cold.state)).toBe(hashJson(reference.state));
    expect(reference.violations).toEqual([]);
    expect(h.service.errors).toEqual([]);
  });

  test("a draft's words ride in blobs it names, read back by the view; an old draft's inline words read as they are; two swipes sharing a text share its blob", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack], model });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "Hello.", "First reply.");
    await h.send(chat, "Onward.", "Second reply.");
    const second = h.host.head(chat);
    const b0 = second ? await h.service.basisFor(chat, userId, second.id) : null;
    if (!second || !b0) throw new Error("no basis");
    const d = boatDraft("d-blob", 0);
    const event = draftEvent(d);
    const data = "data" in event && isRecord(event.data) ? event.data : {};
    const episode = isRecord(data.episode) ? data.episode : {};
    const part = Array.isArray(episode.parts) && isRecord(episode.parts[0]) ? episode.parts[0] : {};
    expect([data.summary, episode.why, part.rationale]).toEqual([blobHash(d.summary), blobHash(d.episode.why), blobHash("routine business, nothing at stake on screen")]);
    expect([data.summary, episode.why, part.rationale].every(isBlobHash)).toBe(true);
    expect(episodeBlobs(STORY_DRAFT, data)).toEqual(expect.arrayContaining([data.summary, episode.why, part.rationale]));
    // The writer puts its texts before its entry lands.
    for (const t of draftTexts(d)) await rt.blobs.put(userId, t);
    expect((await h.service.landLayer(chat, userId, { id: "draft-d-blob", basis: b0, kind: STORY_DRAFT, events: [event] })).status).toBe("landed");
    // An old draft keeps its words inline.
    const old = boatDraft("d-old", 5);
    const inline = { type: STORY_DRAFT, data: { ...(old as unknown as Record<string, unknown>), summary: "An old draft's inline summary." } } as unknown as typeof event;
    expect((await h.service.landLayer(chat, userId, { id: "draft-d-old", basis: b0, kind: STORY_DRAFT, events: [inline] })).status).toBe("landed");
    const shown = new Map((await draftsView(rt, chat, userId)).drafts.map((x) => [x.id, x]));
    expect([...shown.keys()].sort()).toEqual(["d-blob", "d-old"]);
    expect(shown.get("d-blob")?.summary).toBe(d.summary);
    expect(shown.get("d-blob")?.why).toBe(d.episode.why);
    expect(shown.get("d-blob")?.parts.map((p) => p.rationale)).toEqual(["routine business, nothing at stake on screen"]);
    expect(shown.get("d-old")?.summary).toBe("An old draft's inline summary.");
    expect(shown.get("d-old")?.why).toBe(old.episode.why);

    // A swipe drafting the same words names the same blobs.
    await h.host.finish(await h.host.start(chat, { type: "swipe" }), "Second reply, again.");
    await h.host.settle();
    const b1 = await h.service.basisFor(chat, userId, second.id);
    if (!b1 || b1.swipe === b0.swipe) throw new Error("no second swipe");
    const again = draftEvent({ ...boatDraft("d-blob-2", 0) });
    const againData = "data" in again && isRecord(again.data) ? again.data : {};
    expect(againData.summary).toBe(data.summary);
    expect((await h.service.landLayer(chat, userId, { id: "draft-d-blob-2", basis: b1, kind: STORY_DRAFT, events: [again] })).status).toBe("landed");
    expect((await draftsView(rt, chat, userId)).drafts.map((x) => [x.id, x.summary])).toEqual([["d-blob-2", d.summary]]);
    expect(h.service.errors).toEqual([]);
  });

  test("the author's verdict on a draft's pins lands as an author.verdict entry at the chain it read, and a branch from after it reads it", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack], model });
    const userId = h.host.userId;
    const chat = await h.newChat();
    await h.send(chat, "Hello.", "First reply.");
    const first = h.host.head(chat);
    const b1 = first ? await h.service.basisFor(chat, userId, first.id) : null;
    if (!b1) throw new Error("no basis");
    const verdict = verdictEvent({ draft: "d-boat", page: 1, of: 2, span: "Monday morning", verdict: "contradicts", why: "Dale was seen keeping the boat.", forces: ["the sale falls through"] });
    expect((await h.service.landLayer(chat, userId, { id: "verdict-d-boat", basis: b1, kind: AUTHOR_VERDICT, events: [verdict], by: { role: "author" } })).status).toBe("landed");
    await h.send(chat, "Onward.", "Second reply.");
    // A branch from after it: the second reply swiped.
    await h.host.finish(await h.host.start(chat, { type: "swipe" }), "Second reply, again.");
    await h.host.settle();
    const read = await h.service.readEvents(chat, userId, [AUTHOR_VERDICT]);
    expect(read.map((e) => ("data" in e.event ? e.event.data : null))).toEqual([verdict.data]);
    expect((await h.service.layerSummaries(chat, userId)).filter((s) => s.kind === AUTHOR_VERDICT).map((s) => s.basis.message)).toEqual([b1.message]);
    expect(h.service.errors).toEqual([]);
  });
});

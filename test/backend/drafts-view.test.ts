// GM → Depth → Drafts' presses while a reply is written (DEPTH-PLAN §4.6, §4.9): what the player does
// to an open draft anchors at the last message kept, before that reply, and lands as the reply is
// kept, rather than at the reply's blank, which a kept reply leaves. Both folds agree.

import { describe, expect, test } from "bun:test";
import { dropDraft, draftsView, type DraftsRt } from "../../src/backend/depth/drafts-view";
import { DRAFT_TYPES, draftsOn } from "../../src/backend/depth/offscreen/drafts";
import { defaultSettings } from "../../src/backend/settings-store";
import { AUTHOR_DROP, draftEvent, STORY_DRAFT, type DraftData } from "../../src/shared/episodes";
import { hashJson, hashParts } from "../../src/shared/hash";
import { blobHash } from "../../src/shared/stores";
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
});

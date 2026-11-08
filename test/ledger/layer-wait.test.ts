// What the bootstrap reads and lands while play goes on (DEPTH-PLAN §4.9, §8.2–§8.4): a landing that
// waits answers once the windows its drafts were held for have closed, as the drain landed or refused
// each, so the job after it reads them; and a basis read can leave out the entries a redo is
// replacing (`foldAtBasis`'s `without`), in the state and the narrative record alike, while the
// chat's own fold keeps them.

import { describe, expect, test } from "bun:test";
import { hashParts } from "../../src/shared/hash";
import type { ChatId, MessageId } from "../../src/shared/ids";
import type { Basis, LayerDraft } from "../../src/shared/layer";
import type { LedgerEvent } from "../../src/shared/ledger";
import { beatEvent, beatId, type Beat } from "../../src/shared/story";
import type { TurnModel } from "../../src/engine/ledger/journal";
import { workspaceOf, wsWrite } from "../../src/engine/workspace";
import storyPack from "../../src/packs/story/core/index";
import { Harness } from "../support/harness";
import { POV } from "../support/test-pack";

const blob = (s: string): string => hashParts("test.blob", s);

function beat(id: string, at: number): Beat {
  return { id, at, order: 0, place: "home", actors: [POV], act: "said", about: [], what: blob(`what ${id}`), surface: blob(`surface ${id}`), exposure: [{ who: POV, channel: "hearing", reach: "whole" }], by: { turn: id, decided: "player" } };
}

const beatModel: TurnModel = {
  plan: ({ seed, state }) => [beatEvent(beat(beatId(seed), state.clock))],
  read: () => [],
};

function draft(id: string, basis: Basis, events: LedgerEvent[]): LayerDraft {
  return { id, basis, kind: events[0]?.type ?? "test", events };
}

const note = (name: string): LedgerEvent => wsWrite(`notebook/${name}.md`, blob(name));

async function setup(): Promise<{ h: Harness; chat: ChatId; ids: MessageId[] }> {
  const h = new Harness("fresh", { packs: [storyPack], model: beatModel });
  const chat = await h.newChat();
  await h.send(chat, "Hello.", "First reply.");
  await h.send(chat, "Again.", "Second reply.");
  return { h, chat, ids: (await h.chain(chat)).map((m) => m.id) };
}

async function basisOf(h: Harness, chat: ChatId, messageId: MessageId): Promise<Basis> {
  const b = await h.service.basisFor(chat, h.host.userId, messageId);
  if (!b) throw new Error(`no basis for ${messageId}`);
  return b;
}

describe("a landing that waits and a read without a redo's entries", () => {
  test("a landing that waits answers once the window it was held for closes: landed, or refused where the turn took its message away", async () => {
    const { h, chat, ids } = await setup();
    const [, , a1, , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const at1 = await basisOf(h, chat, a1);
    const at2 = await basisOf(h, chat, a2);
    const g = await h.host.start(chat, { type: "swipe" });
    let settled = false;
    const waiting = h.service.landLayers(chat, h.host.userId, [draft("kept-on-a1", at1, [note("kept")]), draft("made-on-a2", at2, [note("gone")])], { wait: true }).then((r) => {
      settled = true;
      return r;
    });
    // A landing that doesn't wait says held at once; the one before it on the chat's queue still waits.
    expect((await h.service.landLayers(chat, h.host.userId, [draft("now-on-a1", at1, [note("now")])])).map((r) => r.status)).toEqual(["held"]);
    expect(settled).toBe(false);
    await h.host.finish(g, "Second reply, swiped.");
    await h.host.settle();
    const out = await waiting;
    expect(out.map((r) => r.status)).toEqual(["landed", "refused"]);
    expect(out[1]?.status === "refused" ? out[1].reason : "").toBe("the message it was made from shows another swipe now");
    expect((await h.service.layerSummaries(chat, h.host.userId)).map((s) => s.id).sort()).toEqual(["kept-on-a1", "now-on-a1"]);
    expect(h.service.errors).toEqual([]);
  });

  test("a basis read leaves out the entries a redo replaces, in the state and the narrative record; the chat's own fold keeps them", async () => {
    const { h, chat, ids } = await setup();
    const [m0, , , , a2] = ids as [MessageId, MessageId, MessageId, MessageId, MessageId];
    const at0 = await basisOf(h, chat, m0);
    const at2 = await basisOf(h, chat, a2);
    const old = beat("b-old", 0);
    for (const d of [draft("old-note", at0, [note("old")]), draft("old-beat", at0, [beatEvent(old)]), draft("kept-note", at0, [note("kept")])]) expect((await h.service.landLayer(chat, h.host.userId, d)).status).toBe("landed");
    const read = async (without?: ReadonlySet<string>) => {
      const at = await h.service.foldAtBasis(chat, h.host.userId, at2, [], without);
      if (!at) throw new Error("no read");
      const notes = Object.keys(workspaceOf(at.state)).filter((p) => p.startsWith("notebook/")).map((p) => p.slice("notebook/".length, -".md".length));
      return { notes: notes.sort(), beats: at.story.beats.map((p) => p.beat.id) };
    };
    expect(await read()).toMatchObject({ notes: ["kept", "old"], beats: expect.arrayContaining(["b-old"]) });
    const without = await read(new Set(["old-note", "old-beat"]));
    expect(without.notes).toEqual(["kept"]);
    expect(without.beats).not.toContain("b-old");
    expect(await read()).toMatchObject({ notes: ["kept", "old"], beats: expect.arrayContaining(["b-old"]) });
    expect(h.service.errors).toEqual([]);
  });
});

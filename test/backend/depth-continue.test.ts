// A Continue on a chat on depth (DEPTH-PLAN §3.9): a Continue a scene carried on commits that
// scene's further beats and the prose rendered on from the reply's saved end as one `cont` entry on
// the reply's record, never a read of what it added, whether it ended or was stopped, and nothing
// marks the reply unread, so no chip says what it added isn't canon. A Continue no scene carried on
// is accepted unread, as before, and its chip says so.

import { describe, expect, test } from "bun:test";
import type { TurnModel } from "../../src/engine/ledger/journal";
import { activeRecord } from "../../src/engine/ledger/path";
import type { LedgerEvent, Rec } from "../../src/shared/ledger";
import { passageEvent } from "../../src/shared/passage";
import { beatEvent, beatId, type Beat } from "../../src/shared/story";
import { blobHash } from "../../src/shared/stores";
import storyPack from "../../src/packs/story/core/index";
import { Harness } from "../support/harness";
import { POV } from "../support/test-pack";

const NOTE: LedgerEvent = { type: "engine.note", data: { text: "The engine run's own event." } };
const READ = "A read of the reply's text, which a depth Continue never makes.";

/** A scene of one beat and its passage, made by the generation `turn`. */
function sceneFor(turn: string, order: number): { pre: LedgerEvent[]; read: LedgerEvent[]; blobs: Record<string, string> } {
  const said: Beat = { id: beatId(turn, "0"), at: 0, order, place: "home", actors: ["dev"], act: "said", about: [], what: blobHash(`what ${turn}`), surface: blobHash(`surface ${turn}`), exposure: [{ who: POV, channel: "hearing", reach: "whole" }], by: { turn, decided: "character" } };
  const passage = passageEvent({ moment: 0, index: 0, beats: [said.id], pov: POV, text: blobHash(`passage ${turn}`), drafts: [{ text: blobHash(`passage ${turn}`), faithful: true }] });
  return { pre: [beatEvent(said)], read: [passage], blobs: {} };
}

describe("a Continue on a chat on depth", () => {
  test("a scene's goes on as a `cont` entry on the reply's record, ended or stopped, unread by nothing; one no scene carried on is accepted unread", async () => {
    const model: TurnModel = { plan: () => [NOTE], read: () => [{ type: "engine.note", data: { text: READ } }] };
    const h = new Harness("fresh", { packs: [storyPack], model });
    const hooks = h.service.hooks;
    if (!hooks) throw new Error("no hooks");
    // The runtime's commit of a depth scene: a turn's becomes its plan and read part, a Continue's its `cont` entry.
    hooks.beforeCommit = async (input) => {
      if (input.scene) input.core.scene(input.generationId, input.scene.pre, input.scene.read, input.observed);
    };
    const chat = await h.newChat();
    const head = async (): Promise<Rec> => {
      const core = await h.core(chat);
      const reply = (await h.chain(chat)).findLast((m) => !m.isUser);
      const rec = reply ? activeRecord(reply, core.journal.tombstones) : null;
      if (!rec) throw new Error("no record on the head");
      return rec;
    };
    const conts = (rec: Rec): LedgerEvent[][] => rec.post.filter((p) => p.kind === "cont").map((p) => p.events);

    h.host.sendUser(chat, "Morning, Dev.");
    await h.host.settle();
    const ended = await h.host.start(chat, { type: "normal" });
    const first = sceneFor(ended.id, 0);
    h.service.sceneCommit(ended.id, { ...first, pre: [NOTE, ...first.pre] });
    await h.host.finish(ended, "Dev nods.");
    expect(conts(await head())).toEqual([]);

    // The chat is on depth from here: a Continue's generation is the scene's, and nothing reads its text.
    hooks.depthOn = async () => true;
    const carried = await h.host.start(chat, { type: "continue" });
    const more = sceneFor(carried.id, 1);
    h.service.sceneCommit(carried.id, more);
    await h.host.finish(carried, " He sets the cup down.");
    const rec = await head();
    expect(conts(rec)).toEqual([[...more.pre, ...more.read]]);
    expect([rec.unread, rec.shown, rec.accepted]).toEqual([undefined, undefined, undefined]);

    // Stopped after its passage streamed: what streamed stands, with its beats.
    const cut = await h.host.start(chat, { type: "continue" });
    const part = sceneFor(cut.id, 2);
    h.service.sceneCommit(cut.id, part);
    await h.host.stop(cut, " He looks up.");
    const stopped = await head();
    expect(conts(stopped)).toEqual([[...more.pre, ...more.read], [...part.pre, ...part.read]]);
    expect(stopped.unread).toBeUndefined();

    // No scene carried this one on: today's narrator's text, accepted unread, which its chip says isn't canon.
    const plain = await h.host.start(chat, { type: "continue" });
    await h.host.finish(plain, " Then he waits.");
    const unread = await head();
    expect(unread.unread).toBe("continue");
    expect(conts(unread)).toHaveLength(2);
    expect(JSON.stringify(unread)).not.toContain(READ);
    const { reference, optimized } = await h.folds(chat);
    expect([reference.violations, optimized.violations]).toEqual([[], []]);
  });
});

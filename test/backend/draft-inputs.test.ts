// What makes an off-screen draft read as changed underneath it (DEPTH-PLAN §4.6): only what it read.
// Its inputs are the mind files its plays and the author's playing of someone showed, and the
// notebook files the author said it draws on, each at the body it read. A revision elsewhere in the
// notebook, a write to a mind it never read and a mind file no play shows leave it as it was; a
// revision of what it read shows on GM → Depth → Drafts and in the poll's facts.

import { describe, expect, test } from "bun:test";
import { draftsView, type DraftsRt } from "../../src/backend/depth/drafts-view";
import { DRAFT_TYPES } from "../../src/backend/depth/offscreen/drafts";
import { draftEpisode, OFFSCREEN_PLUGS } from "../../src/backend/depth/offscreen/episode";
import { offscreenFacts } from "../../src/backend/depth/offscreen/jobs";
import type { ModelPort } from "../../src/backend/depth/port";
import { seedCore } from "../../src/backend/character-agent";
import { defaultSettings } from "../../src/backend/settings-store";
import { memoryPath, mindFileWrite, mindPath } from "../../src/shared/character-engine";
import type { DepthRole } from "../../src/shared/depth-settings";
import type { ChatId } from "../../src/shared/ids";
import type { LedgerEvent } from "../../src/shared/ledger";
import { blobHash } from "../../src/shared/stores";
import type { TurnModel } from "../../src/engine/ledger/journal";
import { notebookEvent } from "../../src/engine/notebook";
import authorPack from "../../src/packs/author/core/index";
import storyPack from "../../src/packs/story/core/index";
import { Harness } from "../support/harness";

/** Turns that decide nothing: the test's own entries are the story. */
const model: TurnModel = { plan: () => [], read: () => [] };

function rtOf(h: Harness): DraftsRt {
  const stored = new Map<string, string>();
  const settings = defaultSettings();
  return {
    host: h.host,
    registry: h.registry,
    blobs: { get: async (_u: string, hash: string) => stored.get(hash) ?? null, put: async (_u: string, text: string) => (stored.set(blobHash(text), text), blobHash(text)) },
    settings: { get: async () => settings },
    ledger: h.service,
  } as unknown as DraftsRt;
}

/** Each role answers in turn from its own list. */
function port(answers: Partial<Record<DepthRole, unknown[]>>): ModelPort {
  return (async (role) => ({ text: JSON.stringify(answers[role]?.shift() ?? {}), usage: { tokensIn: 1, tokensOut: 1 } })) as ModelPort;
}

describe("a draft's inputs", () => {
  test("are only the mind files its plays showed and the notebook files the author cited; nothing else it never read changes it", async () => {
    const h = new Harness("fresh", { packs: [storyPack, authorPack], model });
    const rt = rtOf(h);
    const userId = h.host.userId;
    const chat: ChatId = await h.newChat();
    const at = async () => {
      const b = await h.service.basisFor(chat, userId);
      if (!b) throw new Error("no head");
      return b;
    };
    let n = 0;
    /** Lands mind writes and notebook files at the head, their texts stored. */
    const land = async (writes: { events: unknown[]; blobs: Record<string, string> }[], notebook: Record<string, string> = {}): Promise<void> => {
      const events: LedgerEvent[] = writes.flatMap((w) => w.events as LedgerEvent[]);
      const files: Record<string, string> = {};
      for (const w of writes) for (const text of Object.values(w.blobs)) await rt.blobs.put(userId, text);
      for (const [path, text] of Object.entries(notebook)) {
        files[path] = await rt.blobs.put(userId, text);
        events.push({ type: "engine.ws.write", data: { path, hash: files[path] } });
      }
      if (Object.keys(files).length > 0) events.push(notebookEvent({ kind: "light", files, through: null }));
      expect((await h.service.landLayer(chat, userId, { id: `seed-${++n}`, basis: await at(), kind: "minds.v2.write", events })).status).toBe("landed");
    };
    const write = (who: string, path: string, text: string) => mindFileWrite({ who, path, at: 0, mode: "reflect", lived: [], about: [] }, text);

    // Dev has a mind to play live; Rat has one too, though the episode only writes him.
    await land(
      [seedCore({ who: "dev", at: 0, source: "card", text: "Dev runs the marina cafe and owes the bank." }), write("dev", mindPath("dev", "self"), "I keep the cafe going, whatever it costs."), seedCore({ who: "rat", at: 0, source: "card", text: "Rat watches the docks." })],
      { "notebook/threads.md": "Dev's debt comes due this week.", "notebook/tone.md": "Quiet, coastal, a little sad." },
    );
    await h.send(chat, "I head home for the night.", "Sam walks home.");
    const basis = await at();

    const out = await draftEpisode(
      rt,
      chat,
      userId,
      basis,
      { why: "The bank calls in Dev's loan.", in: 0, minutes: 45, places: ["home"], people: ["dev", "rat"], parts: [{ subject: { who: "dev" }, treatment: "live", rationale: "his choice decides what he owes" }, { subject: { who: "rat" }, treatment: "written", rationale: "he only watches" }] },
      {
        index: 0,
        plugs: OFFSCREEN_PLUGS,
        model: port({
          author: [
            { staging: [{ who: "dev", where: "on the dock", doing: "coiling a line" }], beats: [{ ref: "o1", by: "author", actors: [], act: "happened", what: "A buyer walks down the dock.", surface: "A stranger walks down the dock.", exposure: [{ who: "dev", channel: "sight", reach: "whole" }] }], next: ["dev"], end: null, touches: [], notebook: ["notebook/threads.md", "notebook/missing.md"], summary: "Dev sells his boat." },
            { exposure: [], beats: [], next: [], end: "The sale is made.", summary: "Dev sold his boat." },
          ],
          // His play writes how he is now: the episode's own, never an input.
          character: [{ say: "Ten thousand, and she's yours.", take: "I hate this.", now: "Sick about the boat." }],
        }),
      },
    );
    expect(out.landed?.status).toBe("landed");
    // What it read: Dev's files his play showed, at the bodies it read, and the notebook file the author cited; a file the notebook doesn't hold is refused and said.
    expect(Object.keys(out.draft?.inputs ?? {}).sort()).toEqual(["minds/dev/core.md", "minds/dev/self.md", "notebook/threads.md"]);
    expect(out.said).toContainEqual(expect.stringContaining('"notebook/missing.md" isn\'t a file of your notebook'));

    const changed = async (): Promise<{ view: string[]; poll: string[] }> => {
      const head = await at();
      const read = await h.service.foldAtBasis(chat, userId, head, DRAFT_TYPES);
      if (!read) throw new Error("no fold");
      const facts = await offscreenFacts(rt, chat, userId, read, defaultSettings().depth.budget);
      return { view: (await draftsView(rt, chat, userId)).drafts.map((d) => d.changed).flat(), poll: facts.drafts.map((d) => d.changed).flat() };
    };
    expect(await changed()).toEqual({ view: [], poll: [] });

    // A revision of a notebook file it didn't cite, a mind it never read, and one of Dev's files no play shows: nothing it read changed.
    await land([write("rat", mindPath("rat", "self"), "The docks have been busy."), write("dev", memoryPath("dev", "the-loan"), "The bank's letter came on Monday.")], { "notebook/tone.md": "Quiet, coastal, warmer now." });
    expect(await changed()).toEqual({ view: [], poll: [] });

    // What it read is revised: Dev's story of himself, and the thread the author cited.
    await land([write("dev", mindPath("dev", "self"), "I let the boat go, and the cafe with it.")], { "notebook/threads.md": "Dev's debt is paid; the cafe is the question now." });
    expect(await changed()).toEqual({ view: ["Dev's mind", "the author's notebook (threads.md)"], poll: ["Dev [dev]'s mind", "your notebook's threads.md"] });
    expect(h.service.errors).toEqual([]);
  });
});

// The Journal read back to front (BUILD-C C3, DESIGN §9.6): each turn's entries are its own, worded
// against the head state, so reading the chain from its end and stopping once `keep` entries are in
// gives what reading every turn and keeping the latest `keep` gave. On chats of 50 and 400 turns the
// state view's Journal, `{{recent}}` and the main agent's digest from its last turn are the whole
// read's, entry for entry, and each words only the turns it shows, however long the chat.

import { describe, expect, spyOn, test } from "bun:test";
import { buildView, journalNotes, recentLines, ViewMemo } from "../../src/backend/view";
import { resolveFix } from "../../src/engine/edits";
import { enginePack } from "../../src/engine/engine-pack";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import { LedgerFold } from "../../src/engine/ledger/fold";
import { emptyJournal, LedgerCore } from "../../src/engine/ledger/journal";
import { computePaths, contentId, nextPath } from "../../src/engine/ledger/path";
import * as playerEvents from "../../src/engine/player-events";
import { createRegistry } from "../../src/engine/registry-impl";
import { hashJson } from "../../src/shared/hash";
import type { ChatRun, LedgerEvent, Rec } from "../../src/shared/ledger";
import { OFFSTAGE_DEFAULTS } from "../../src/shared/offstage";
import { NARRATOR_DEFAULTS } from "../../src/shared/settings";
import { POV, testModel, testPack, testWorld, tieStubPack } from "../support/test-pack";

const reg = createRegistry([enginePack, testPack, tieStubPack]);
const world = testWorld();
const revision = hashJson(world);
const run: ChatRun = { v: 1, worldId: world.id, revision, runSeed: "journal-window", startedAt: 0 };

/** `{{recent}}`'s turns (DESIGN §5.2), and the state view's Journal entries. */
const RECENT = 5;
const JOURNAL = 100;
/** Turns since the main agent's last one, for its digest. */
const SINCE = 10;

/**
 * A chat of `turns` turns, each a message and its reply, the reply's record moving the clock by a
 * minute more than the one before and paying the player character that many cents, so every turn's
 * Journal entry is its own; with the ledger core that reads it.
 */
function chat(turns: number): { core: LedgerCore; observed: ChainMessage[] } {
  const observed: ChainMessage[] = [{ id: "m0", isUser: false, swipeId: 0, swipes: ["Morning, Sam."], ledger: null }];
  let parent = computePaths(observed, [])[0]?.path ?? "";
  for (let i = 1; i <= turns; i++) {
    const user: ChainMessage = { id: `u${i}`, isUser: true, swipeId: 0, swipes: [`I wait a while (${i}).`], ledger: null };
    parent = nextPath(user, parent, []);
    const text = `Time passes (${i}).`;
    const events: LedgerEvent[] = [
      { type: "clock", minutes: i, cause: "tick" },
      { type: "add", entity: POV, field: "cash", delta: i },
    ];
    const rec: Rec = { v: 1, defHash: revision, seq: i, swipeHash: contentId(text), path: parent, seed: `s${i}`, pre: events.length, events, post: [], markersApplied: 0, status: "ok", undone: [], intents: {} };
    const reply: ChainMessage = { id: `a${i}`, isUser: false, swipeId: 0, swipes: [text], ledger: { v: 1, swipes: { "0": rec }, markers: [] } };
    parent = nextPath(reply, parent, []);
    observed.push(user, reply);
  }
  const core = new LedgerCore(emptyJournal("journal-window"), { types: reg, worlds: (r) => (r === revision ? world : undefined), run, model: testModel, startMarkers: () => [], newSeed: () => "fresh", resolveFix: (doc, state, entry) => resolveFix(reg, doc, state, entry, run.runSeed) }, new LedgerFold(reg));
  return { core, observed };
}

/** What `fn` gave, and how many times it worded events for the player (`playerLines`): once for each turn it read. */
function worded<T>(fn: () => T): { value: T; calls: number } {
  const spy = spyOn(playerEvents, "playerLines");
  try {
    const value = fn();
    return { value, calls: spy.mock.calls.length };
  } finally {
    spy.mockRestore();
  }
}

const SIZES = [50, 400] as const;

describe("the Journal read back to front", () => {
  for (const turns of SIZES) {
    describe(`on a chat of ${turns} turns`, () => {
      const { core, observed } = chat(turns);
      // Every turn's entries, read whole (no window): what each window is held to.
      const all = journalNotes(core, observed, observed.length, reg);

      test("every turn has its own entry, oldest first", () => {
        expect(all.map((n) => n.messageId)).toEqual(Array.from({ length: turns }, (_, i) => `a${i + 1}`));
        expect(all.at(-1)?.text).toStartWith(`Your cash went up by $${(turns / 100).toFixed(2)} · `);
        expect(new Set(all.map((n) => n.text)).size).toBe(turns);
      });

      test("{{recent}} is the whole read's last five, worded from five turns", () => {
        const fresh = worded(() => recentLines(core, observed, observed.length, reg, false));
        expect(fresh.value).toEqual(all.slice(-RECENT).map((n) => n.text));
        expect(fresh.calls).toBe(RECENT);
        // Before an earlier reply, the latest five before it.
        const at = observed.length - 2 * SINCE;
        const earlier = worded(() => recentLines(core, observed, at, reg, false));
        expect(earlier.value).toEqual(journalNotes(core, observed, at, reg).slice(-RECENT).map((n) => n.text));
        expect(earlier.calls).toBe(RECENT);
        // Reusing built views: made once for the chain as it stands, then given again with nothing worded.
        const made = worded(() => recentLines(core, observed, observed.length, reg, true));
        const again = worded(() => recentLines(core, observed, observed.length, reg, true));
        expect([made.value, again.value]).toEqual([fresh.value, fresh.value]);
        expect([made.calls, again.calls]).toEqual([RECENT, 0]);
      });

      test("the main agent's digest reads the turns since its last one, as the whole read has them", () => {
        const start = observed.length - 2 * SINCE;
        const since = worded(() => journalNotes(core, observed, observed.length, reg, start));
        const index = new Map(observed.map((m, i) => [m.id, i]));
        expect(since.value).toEqual(all.filter((n) => (index.get(n.messageId) ?? -1) >= start));
        expect(since.value).toHaveLength(SINCE);
        expect(since.calls).toBe(SINCE);
      });

      test("the state view's Journal is the whole read's latest hundred", () => {
        const view = buildView({ chatId: "journal-window", run, core, observed, registry: reg, world: (r) => core.worldAt(r), stored: [], meter: null, knowledge: { chat: {}, tracking: false, narrator: NARRATOR_DEFAULTS }, offstage: OFFSTAGE_DEFAULTS, memo: new ViewMemo() });
        expect(view.journal).toEqual(all.slice(-JOURNAL));
        expect(view.journal).toHaveLength(Math.min(turns, JOURNAL));
      });
    });
  }

  test("a window's reads don't grow with the chat: {{recent}} and the digest word as many turns on 400 as on 50", () => {
    const calls = SIZES.map((turns) => {
      const { core, observed } = chat(turns);
      return [worded(() => recentLines(core, observed, observed.length, reg, false)).calls, worded(() => journalNotes(core, observed, observed.length, reg, observed.length - 2 * SINCE)).calls];
    });
    expect(calls[1]).toEqual(calls[0]);
    // Read whole, the chat's every turn is worded.
    const { core, observed } = chat(SIZES[1]);
    expect(worded(() => journalNotes(core, observed, observed.length, reg)).calls).toBe(SIZES[1]);
  });
});

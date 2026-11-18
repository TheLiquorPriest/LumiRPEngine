// Going back to a swipe the previous build made (the second walk's F6, plan §6.3 and §15.3 step 7): what a carried swipe's turn recorded
// for the story and the cast leaves the path when another swipe shows and comes back when it shows again; and what a later turn wrote
// about that reply while it showed one swipe (a beat it came from, a perception of its turn, the knowledge that perception gave) no
// longer applies once the reply shows another, is listed among what no longer applies, and applies again when the swipe shows again.
// The migration fixture's harness chat: m-h6 has two swipes, each its own carried turn with its own story record; the second shows.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { sliceOf } from "../../src/cast/fold";
import { writeCast } from "../../src/cast";
import { migrate } from "../../src/migrate/migrate";
import type { ShownMessage, Store, UserStore } from "../../src/store";
import { storyHead, writeStory } from "../../src/story";
import { buildFixture, CHAT, STRAY, USER, type Fixture } from "./fixture";
import { look } from "./look";
import { TREE as tree } from "./tree";

/** The texts of the beats that stand at the chat's head, struck ones left out. */
const beats = (store: Store): string[] => storyHead(store, USER, CHAT.harness).of("beat").map((b) => String(b.fields.text)).sort();

/** Every cast item of `part` at the chat's head, by the field `field`. */
const castAt = (s: UserStore, part: string, field: string): string[] =>
  Object.values(sliceOf(s.headState(CHAT.harness).state.areas).items)
    .flatMap((items) => Object.values(items))
    .filter((item) => item.part === part)
    .flatMap((item) => item.rows.map((row) => row.value[field]).filter((v): v is string => typeof v === "string"))
    .sort();

/** The chat as the store last compared it, with `message` showing the swipe its turn `turn` is tied to. */
function showing(s: UserStore, message: string, turn: string): ShownMessage[] {
  const row = s.turn(turn);
  return s.path(CHAT.harness).map((e) => (e.message === message ? { id: e.message, user: false, hash: row?.hash ?? "", date: row?.date ?? null, hidden: false } : { id: e.message, user: e.user, hash: e.hash, date: e.date, hidden: false }));
}

describe("going back to a swipe the previous build made", () => {
  let fixture: Fixture;
  let data: string;

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    data = join(fixture.root, "rpe-data");
    expect((await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date("2026-11-14T09:00:00.000Z") })).ran).toBe(true);
  });

  afterAll(async () => {
    await fixture.remove();
  });

  test("a carried swipe's story and cast leave the path with it and come back with it", () => {
    look(data, (_db, s, store) => {
      const [dark, lit] = (() => {
        const shown = s.path(CHAT.harness).find((e) => e.message === "m-h6")?.turn ?? "";
        const other = s.swipes(CHAT.harness, "m-h6").find((t) => t.id !== shown)?.id ?? "";
        return [shown, other];
      })();
      expect(lit).not.toBe("");
      // The second swipe shows: its beat stands, the first's does not, and the first's strike of the fog has not happened.
      expect(beats(store)).toEqual(["Fog came.", "The lamp stayed dark."]);
      expect(castAt(s, "perception", "moment")).not.toContain("Ada lit the lamp.");
      // The first swipe shown: its beat, its strike and its perception; the second's beat gone.
      s.sync(CHAT.harness, showing(s, "m-h6", lit));
      expect(beats(store)).toEqual(["Ada lit the lamp."]);
      expect(castAt(s, "perception", "moment")).toContain("Ada lit the lamp.");
      // Back again, exactly as it was.
      s.sync(CHAT.harness, showing(s, "m-h6", dark));
      expect(beats(store)).toEqual(["Fog came.", "The lamp stayed dark."]);
      expect(castAt(s, "perception", "moment")).not.toContain("Ada lit the lamp.");
    });
  });

  test("what a later turn wrote about that reply's swipe leaves the path when the reply shows another, is listed, and comes back", () => {
    look(data, (_db, s, store) => {
      const dark = s.path(CHAT.harness).find((e) => e.message === "m-h6")?.turn ?? "";
      const lit = s.swipes(CHAT.harness, "m-h6").find((t) => t.id !== dark)?.id ?? "";
      const character = Object.keys(sliceOf(s.headState(CHAT.harness).state.areas).items)[0] ?? "";
      expect(character).not.toBe("");
      // A turn RPE plays after the carried reply, as the walk's B1 did: the Author records a beat of that reply as it shows, one of its own reply, and a perception of that reply's turn with what it gave.
      const turn = s.beginTurn({ chat: CHAT.harness, kind: "normal" });
      writeStory(store, { user: USER, chat: CHAT.harness, turn: turn.id, by: "author", agent: null, job: null }, [
        { part: "beat", item: null, value: { text: "The lamp stays dark, and Bo sits by it.", message: "m-h6" } },
        { part: "beat", item: null, value: { text: "Ada waits by the window.", message: "m-h8" } },
      ]);
      const writer = { user: USER, turn: turn.id, by: "author", agent: null, job: null, at: null, now: 1 };
      const [perception] = writeCast(store, writer, [{ character, part: "perception", item: null, value: { moment: "Bo sits by the dark lamp.", reach: "whole", of: dark } }]);
      writeCast(store, writer, [{ character, part: "knowledge", item: null, value: { text: "The lamp is dark.", from: perception?.item ?? "" } }]);
      s.tieTurn(turn.id, { message: "m-h8", hash: "hash-m-h8", date: 99, text: "Ada waits by the window." });
      const later: ShownMessage[] = [{ id: "m-h7", user: true, hash: "hash-m-h7", hidden: false }, { id: "m-h8", user: false, hash: "hash-m-h8", date: 99, hidden: false }];
      s.sync(CHAT.harness, [...showing(s, "m-h6", dark).filter((m) => m.id !== "m-h7" && m.id !== "m-h8"), ...later]);
      const now = (): { beats: string[]; moments: string[]; knows: string[]; away: number } => ({
        beats: beats(store),
        moments: castAt(s, "perception", "moment"),
        knows: castAt(s, "knowledge", "text"),
        away: s.headState(CHAT.harness).notApplied.filter((n) => n.reports.some((r) => r.code === "another_swipe")).length,
      });
      expect(now()).toEqual({ beats: ["Ada waits by the window.", "Fog came.", "The lamp stayed dark.", "The lamp stays dark, and Bo sits by it."], moments: expect.arrayContaining(["Bo sits by the dark lamp."]), knows: expect.arrayContaining(["The lamp is dark."]), away: 0 });
      // The reply flipped to its first swipe, the later turn applied again on it: what it wrote about the dark lamp is of the other swipe.
      const flipped = s.sync(CHAT.harness, [...showing(s, "m-h6", lit).filter((m) => m.id !== "m-h7" && m.id !== "m-h8"), ...later]);
      expect(flipped.rebased?.turns).toContain(turn.id);
      const there = now();
      expect(there.beats).toEqual(["Ada lit the lamp.", "Ada waits by the window."]);
      expect(there.moments).not.toContain("Bo sits by the dark lamp.");
      expect(there.knows).not.toContain("The lamp is dark.");
      expect(there.away).toBe(3);
      // Back to the swipe it was written on: all of it applies again, and nothing is listed.
      s.sync(CHAT.harness, [...showing(s, "m-h6", dark).filter((m) => m.id !== "m-h7" && m.id !== "m-h8"), ...later]);
      expect(now()).toEqual({ beats: ["Ada waits by the window.", "Fog came.", "The lamp stayed dark.", "The lamp stays dark, and Bo sits by it."], moments: expect.arrayContaining(["Bo sits by the dark lamp."]), knows: expect.arrayContaining(["The lamp is dark."]), away: 0 });
    });
  });
});

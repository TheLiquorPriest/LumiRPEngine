// Today's story record as RPE's (STANDALONE-PLAN §15.2, story record row; §8.1): a beat recorded from a
// stretch of the chat's past covers the whole stretch, as the history window's cover; a beat keeps its
// story time; each version of a draft or a casting stands as that version says it, a field it no
// longer has gone with it; and a place made in play is named as the world in play names it.

import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { castAt } from "../../src/cast/path";
import { CastRecord, castingItemId, chatLine, findCharacter } from "../../src/cast/record";
import { migrate } from "../../src/migrate/migrate";
import type { Beat, Draft, LedgerEvent, Rec } from "../../src/shared/ledger";
import { storyCoverage } from "../../src/story/index";
import { storyClock } from "../../src/story/kit";
import { storyAt } from "../../src/story/path";
import { StoryRecord } from "../../src/story/record";
import { buildFixture, CHAT, PEOPLE, STRAY, USER, type Fixture } from "./fixture";
import { look } from "./look";
import { editRecord } from "./today-edits";
import { TREE as tree } from "./tree";

/** The harness chat's draft, open from its first reply, as the fixture has it. */
const SHIP: Draft = { id: "d1", what: "A ship comes in at dawn.", tier: 2, who: [PEOPLE.bo.entity], where: ["home"], when: 0, basis: { messageId: "m-h2", swipeId: 0 }, state: "open" };

/** A swipe's record with `beat` among its beats. */
const withBeat = (beat: Beat) => (rec: Rec): Rec => ({ ...rec, story: { ...rec.story, beats: [...(rec.story?.beats ?? []), beat] } });

async function migrated(change: (fixture: Fixture) => void, check: (data: string) => void): Promise<void> {
  const fixture = await buildFixture("operator");
  try {
    await rm(join(fixture.userFolder, STRAY));
    change(fixture);
    const data = join(fixture.root, "rpe-data");
    expect((await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date("2026-11-14T09:00:00.000Z") })).ran).toBe(true);
    check(data);
  } finally {
    await fixture.remove();
  }
}

describe("today's story record as RPE's", () => {
  test("a beat today's historian recorded from a stretch of the chat's past covers every message of the stretch", async () => {
    await migrated(
      (fixture) => editRecord(fixture, "m-h6", 1, withBeat({ id: "b-past", turn: "gen-3", at: 10, where: null, by: "world", kind: "happen", what: "The long night at the harbour.", surface: "", exposure: [], decidedBy: { agent: "historian" }, past: { from: "m-h1", to: "m-h5" } })),
      (data) => {
        const covered = look(data, (_db, _s, store) => storyCoverage({ store, user: USER, chat: CHAT.harness, turn: null }).covered);
        expect([...covered].sort()).toEqual(["m-h1", "m-h2", "m-h3", "m-h4", "m-h5", "m-h6"]);
      },
    );
  });

  test("a beat keeps today's story time for it, as the chat's story clock shows a time", async () => {
    await migrated(
      () => undefined,
      (data) =>
        look(data, (db, s, store) => {
          const beats = StoryRecord.read(db, USER, storyAt(s, CHAT.harness, null)).items;
          const clock = storyClock(store, USER, CHAT.harness, null);
          // The fog came at the story's start, and the lamp stayed dark half an hour on: each beat its own time.
          expect(typeof beats.get("b:b1")?.fields.time).toBe("string");
          expect(beats.get("b:b1")?.fields.time).toBe(clock?.text(0) ?? "no clock");
          expect(beats.get("b:b3")?.fields.time).toBe(clock?.text(30) ?? "no clock");
        }),
    );
  });

  test("each draft and casting stands as its latest version says it: a field that version no longer has is gone, not kept from an earlier one", async () => {
    await migrated(
      (fixture) => {
        // The first reply: the draft has a note and names Bo; Ada is cast as supporting, with a reason. The shown swipe of the last reply: the draft names no one and has no note; Ada is cast as principal, with none.
        editRecord(fixture, "m-h2", 0, (rec) => ({ ...rec, story: { ...rec.story, drafts: [{ ...SHIP, notes: "Watch the tide." }], cast: [{ entity: PEOPLE.ada.entity, standing: "supporting", why: "She only flies the ferry." }] } }));
        editRecord(fixture, "m-h6", 1, (rec) => ({ ...rec, story: { ...rec.story, drafts: [{ ...SHIP, who: [] }], cast: [{ entity: PEOPLE.ada.entity, standing: "principal" }] } }));
      },
      (data) =>
        look(data, (db, s) => {
          const draft = StoryRecord.read(db, USER, storyAt(s, CHAT.harness, null)).items.get("fu:d1")?.fields;
          expect(draft).toMatchObject({ who: [], notes: null, place: "Home" });
          const ada = findCharacter(db, USER, chatLine(s, CHAT.harness), PEOPLE.ada.name);
          if (ada === null) throw new Error("Ada has no character");
          expect(CastRecord.read(db, USER, castAt(s, CHAT.harness, null)).items.get(castingItemId(ada.id))?.fields).toEqual({ as: "principal", why: null });
        }),
    );
  });

  test("a place made in play is named as the world in play names it, not by its id", async () => {
    const made: LedgerEvent = { type: "space.place", data: { place: "lamp-room", def: { id: "lamp-room", name: "The lamp room", parent: "home", fields: {}, made: { as: "room", by: "story", at: 0, why: "Where the lamp is kept." } } } } as LedgerEvent;
    await migrated(
      (fixture) => editRecord(fixture, "m-h6", 1, (rec) => withBeat({ id: "b-lamp", turn: "gen-3", at: 30, where: "lamp-room", by: PEOPLE.ada.entity, kind: "do", what: "Ada climbed to the lamp room.", surface: "", exposure: [], decidedBy: { agent: "author" } })({ ...rec, events: [...rec.events, made] })),
      (data) => look(data, (db, s) => expect(StoryRecord.read(db, USER, storyAt(s, CHAT.harness, null)).items.get("b:b-lamp")?.fields.place).toBe("The lamp room")),
    );
  });
});
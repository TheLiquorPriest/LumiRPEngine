// Today's people as the cast's characters (STANDALONE-PLAN §7.1: one record per character; §9.6: who
// holds a secret is found by the character's name): a person is cast under one name, the one the world
// gives it at the chat's head, and never under a name the world also gives another person; a later run
// finds the same character again, renamed where the world renamed the person, and makes no second one.

import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { charactersOf, chatLine } from "../../src/cast/record";
import { personNamed } from "../../src/cast/secrets";
import type { ReadContext } from "../../src/engine/registry";
import { migrate } from "../../src/migrate/migrate";
import type { LedgerEvent, Rec } from "../../src/shared/ledger";
import type { Store, UserStore } from "../../src/store";
import { buildFixture, CHAT, PEOPLE, STRAY, USER, type Fixture } from "./fixture";
import { look, mindAt } from "./look";
import { editRecord } from "./today-edits";
import { TREE as tree } from "./tree";

/** A rename as today's build records one (`engine.rename`), among a swipe's events. */
const renamed = (entity: string, name: string, was: string) => (rec: Rec): Rec => ({ ...rec, events: [...rec.events, { type: "engine.rename", data: { entity, name, was } } as LedgerEvent] });

/** The world as the harness chat's head plays it. */
function head(s: UserStore, store: Store): ReadContext {
  const state = s.headState(CHAT.harness).state.world;
  const doc = store.env.worlds(state.revision);
  if (doc === undefined) throw new Error("the harness chat's world can't be read");
  return store.env.registry.context(doc, state);
}

/** The harness chat's characters: name, pin. */
const cast = (data: string): { name: string; pinned: string | null }[] => look(data, (db, s) => charactersOf(db, USER, chatLine(s, CHAT.harness)).map((c) => ({ name: c.name, pinned: c.pinned })));

async function withFixture(run: (fixture: Fixture, data: string) => Promise<void>): Promise<void> {
  const fixture = await buildFixture("operator");
  try {
    await rm(join(fixture.userFolder, STRAY));
    await run(fixture, join(fixture.root, "rpe-data"));
  } finally {
    await fixture.remove();
  }
}

const migrated = async (fixture: Fixture, data: string, hour: number): Promise<void> => {
  expect((await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date(`2026-11-14T${String(hour).padStart(2, "0")}:00:00.000Z`) })).ran).toBe(true);
};

describe("today's people as the cast's characters", () => {
  test("a person the shown swipe renamed is cast under the name the world gives it at the chat's head, by which the cast finds the world's person", async () => {
    await withFixture(async (fixture, data) => {
      editRecord(fixture, "m-h6", 1, renamed(PEOPLE.ada.entity, "Captain Ada", PEOPLE.ada.name));
      await migrated(fixture, data, 9);
      expect(cast(data).map((c) => c.name)).toEqual(["Captain Ada", PEOPLE.bo.name]);
      look(data, (db, s, store) => {
        expect(personNamed(head(s, store), "Captain Ada")).toEqual({ id: PEOPLE.ada.entity });
        expect(mindAt(db, s, CHAT.harness, "Captain Ada", null)["memory.md"]?.text).toBe("Fog over the pier.");
      });
    });
  });

  test("a later run finds the same character again, renamed as the world renamed the person since, its pin and its rows kept, and makes no second one", async () => {
    await withFixture(async (fixture, data) => {
      await migrated(fixture, data, 9);
      expect(cast(data)).toEqual([
        { name: PEOPLE.ada.name, pinned: "principal" },
        { name: PEOPLE.bo.name, pinned: null },
      ]);
      // On today's side since: the first reply renames Ada.
      editRecord(fixture, "m-h2", 0, renamed(PEOPLE.ada.entity, "Captain Ada", PEOPLE.ada.name));
      await migrated(fixture, data, 10);
      expect(cast(data)).toEqual([
        { name: "Captain Ada", pinned: "principal" },
        { name: PEOPLE.bo.name, pinned: null },
      ]);
      look(data, (db, s, store) => {
        expect(personNamed(head(s, store), "Captain Ada")).toEqual({ id: PEOPLE.ada.entity });
        expect(Object.keys(mindAt(db, s, CHAT.harness, "Captain Ada", null)).sort()).toEqual(["core.md", "memory.md"]);
      });
    });
  });

  test("two people the world gives one name are each cast under their own entity's id, so the cast finds each of them, never both", async () => {
    await withFixture(async (fixture, data) => {
      // The first reply renames Bo to Ada's name: at the chat's head the world gives "Ada Mirren" to both.
      editRecord(fixture, "m-h2", 0, renamed(PEOPLE.bo.entity, PEOPLE.ada.name, PEOPLE.bo.name));
      await migrated(fixture, data, 9);
      expect(cast(data).map((c) => c.name)).toEqual([PEOPLE.ada.entity, PEOPLE.bo.entity]);
      look(data, (_db, s, store) => {
        const world = head(s, store);
        expect(personNamed(world, PEOPLE.ada.entity)).toEqual({ id: PEOPLE.ada.entity });
        expect(personNamed(world, PEOPLE.bo.entity)).toEqual({ id: PEOPLE.bo.entity });
      });
    });
  });
});

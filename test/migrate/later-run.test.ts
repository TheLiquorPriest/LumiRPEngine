// A later run over today's data changed since the last (STANDALONE-PLAN §15.3: a run "replaces what an
// earlier run imported with what today's side holds now"): what an earlier run wrote into the file
// tree and today's side no longer has is gone, unless it was changed in RPE since; a version folder
// numbered by a message today's side deleted is gone with it; and each pin is as the chat shows it now.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataPaths } from "../../src/app/config";
import { charactersOf, chatLine } from "../../src/cast/record";
import { migrate } from "../../src/migrate/migrate";
import type { MigrationReport } from "../../src/migrate/report";
import type { Rec } from "../../src/shared/ledger";
import { AREAS, buildFixture, CHAT, PEOPLE, STRAY, USER, type Fixture } from "./fixture";
import { look, notesOf } from "./look";
import { deleteMessage, editRecord, putArea, showSwipe } from "./today-edits";
import { TREE as tree } from "./tree";

/** Each of the harness chat's characters' pinned casting, by name. */
const pins = (data: string): Record<string, string | null> => look(data, (db, s) => Object.fromEntries(charactersOf(db, USER, chatLine(s, CHAT.harness)).map((c) => [c.name, c.pinned])));

/** A swipe's castings as `cast` says them, the rest of its story as it was. */
const casting = (cast: NonNullable<NonNullable<Rec["story"]>["cast"]>) => (rec: Rec): Rec => ({ ...rec, story: { ...rec.story, cast } });

async function withFixture(run: (fixture: Fixture, data: string) => Promise<void>): Promise<void> {
  const fixture = await buildFixture("operator");
  try {
    await rm(join(fixture.userFolder, STRAY));
    await run(fixture, join(fixture.root, "rpe-data"));
  } finally {
    await fixture.remove();
  }
}

async function migrated(fixture: Fixture, data: string, hour: number): Promise<MigrationReport> {
  const run = await migrate(fixture.sources, { data, tree, now: () => new Date(`2026-11-14T${String(hour).padStart(2, "0")}:00:00.000Z`) });
  expect(run.ran).toBe(true);
  return run.report;
}

describe("a later run over today's data changed since", () => {
  test("what an earlier run wrote into the file tree and today's side no longer has is removed, unless it was changed in RPE since; a version folder of a deleted message goes with it", async () => {
    await withFixture(async (fixture, data) => {
      await migrated(fixture, data, 9);
      const imported = join(dataPaths(data).files, "imported");
      // In RPE: the player rewrote the imported skill.
      await writeFile(join(imported, ".skills/tide-tables/SKILL.md"), "My own tide tables.");
      // On today's side since: the user deleted their agent and their skill, and the last reply's area no longer holds prepare.md.
      const settings = join(fixture.userFolder, "harness/settings.json");
      const lumiah = JSON.parse(await readFile(settings, "utf8")) as { definitions: { agents: Record<string, unknown>; skills: Record<string, unknown> } };
      lumiah.definitions = { agents: {}, skills: {} };
      await writeFile(settings, JSON.stringify(lumiah));
      const { "author/prepare.md": _prepare, ...dark } = AREAS["gen-3"];
      await putArea(fixture, CHAT.harness, "gen-3", dark, 4);

      const second = await migrated(fixture, data, 10);
      expect(existsSync(join(imported, ".agents/scout.md"))).toBe(false);
      expect(existsSync(join(imported, ".agents/scout.original.json"))).toBe(false);
      expect(existsSync(join(imported, ".skills/tide-tables/original.json"))).toBe(false);
      expect(await readFile(join(imported, ".skills/tide-tables/SKILL.md"), "utf8")).toBe("My own tide tables.");
      const notes = await notesOf(data, CHAT.harness);
      expect(notes?.has("author/prepare.md")).toBe(false);
      // The first reply's version still holds it: its turn wrote it.
      expect(notes?.get("turns/message-1-swipe-0/author/prepare.md")).toBe(AREAS["gen-1"]["author/prepare.md"]);
      expect(second.carried?.ownFiles).toMatchObject({ removed: 4, changed: 1 });

      // Then the player deleted the message before the last reply: every later version folder is numbered anew, and the old numbers go.
      deleteMessage(fixture, "m-h5");
      await migrated(fixture, data, 11);
      const after = await notesOf(data, CHAT.harness);
      expect(after?.get("turns/message-4-swipe-0/notebook.md")).toBe(AREAS["gen-2"]["notebook.md"]);
      expect([...(after?.keys() ?? [])].filter((p) => p.startsWith("turns/message-5-"))).toEqual([]);
    });
  });

  test("a later run sets each pin as the chat shows it now: taken away where the player unpinned the person, or where the pinned casting is on a swipe the chat no longer shows", async () => {
    await withFixture(async (fixture, data) => {
      await migrated(fixture, data, 9);
      expect(pins(data)).toEqual({ [PEOPLE.ada.name]: "principal", [PEOPLE.bo.name]: null });
      // On today's side since: the player unpinned Ada on the first reply, and pinned her as supporting on the swipe of the last reply the chat doesn't show.
      editRecord(fixture, "m-h2", 0, casting([{ entity: PEOPLE.ada.entity, standing: "principal" }]));
      editRecord(fixture, "m-h6", 0, casting([{ entity: PEOPLE.bo.entity, standing: "supporting", why: "He keeps the ferry." }, { entity: PEOPLE.ada.entity, standing: "supporting", pinned: true }]));
      expect((await migrated(fixture, data, 10)).carried?.story.pinned).toBe(0);
      expect(pins(data)).toEqual({ [PEOPLE.ada.name]: null, [PEOPLE.bo.name]: null });
      // The player shows that swipe again: its pin is the one the chat shows.
      showSwipe(fixture, "m-h6", 0);
      await migrated(fixture, data, 11);
      expect(pins(data)).toEqual({ [PEOPLE.ada.name]: "supporting", [PEOPLE.bo.name]: null });
    });
  });
});

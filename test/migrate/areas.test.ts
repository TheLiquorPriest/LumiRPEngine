// A turn's area as LumiAH reads it, carried onto RPE's records (STANDALONE-PLAN §15.2: the mind files
// "per turn", the Author's notes "versioned by turn"): the area a reply's turn ended with, a Continue
// that wrote no file included; the chat's latest notes those of the reply the chat shows; and a branch
// that shares turns with the chat it was made from reading its notes from them. Each case changes the
// migration fixture's harness chat as today's build would have left it, then runs the migration.

import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { MIGRATED_PART, migratedChat } from "../../src/migrate/briefing";
import { migrate } from "../../src/migrate/migrate";
import { chatOne } from "../../src/migrate/page";
import { reportText, type MigrationReport } from "../../src/migrate/report";
import { AREAS, buildFixture, CHAT, IDENT, PEOPLE, STRAY, USER, type Fixture } from "./fixture";
import { accounted, look, mindAt, notesOf, turnOf, versionsOf } from "./look";
import { shippedParts } from "./parts";
import { branchChat, editRecord, headOf, putArea, showSwipe } from "./today-edits";
import { TREE as tree } from "./tree";

/** A fresh fixture, changed by `change`, migrated once, the report's accounts of what it found inside other rows' things adding up; then `check` on what the run left. */
async function migrated(change: (fixture: Fixture) => Promise<void> | void, check: (data: string, report: MigrationReport, fixture: Fixture) => Promise<void> | void): Promise<void> {
  const fixture = await buildFixture("operator");
  try {
    await rm(join(fixture.userFolder, STRAY));
    await change(fixture);
    const data = join(fixture.root, "rpe-data");
    const run = await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date("2026-11-14T09:00:00.000Z") });
    expect(run.ran).toBe(true);
    accounted(run.report);
    await check(data, run.report, fixture);
  } finally {
    await fixture.remove();
  }
}

describe("a turn's area as LumiAH reads it", () => {
  test("a reply that was continued keeps its own area: its mind files and the removal it made land on its own turn, none counted untied", async () => {
    await migrated(
      async (fixture) => {
        // The shown swipe of the last reply was continued, and the Continue wrote no file: LumiAH wrote no document for it, and its record names the area it ended with.
        const ended = await headOf(fixture, CHAT.harness, "gen-3");
        editRecord(fixture, "m-h6", 1, (rec) => ({ ...rec, harness: { turns: ["gen-3", "gen-3c"], record: { v: 1, generationId: "gen-3c", kind: "continue", at: 5, path: "p", workspace: ended, usage: {} } } }));
      },
      async (data, report) => {
        look(data, (db, s) => {
          const shown = turnOf(db, CHAT.harness, "m-h6", 1);
          // On the continued reply's own turn: the core it wrote, and Bo's profile, which it removed, gone.
          expect(mindAt(db, s, CHAT.harness, PEOPLE.ada.name, shown)["core.md"]?.text).toBe(AREAS["gen-3"]["minds/e-ada/core.md"]);
          expect(mindAt(db, s, CHAT.harness, PEOPLE.bo.name, shown)).toEqual({});
          // So at the chat's head the characters remember what they remembered at its last turn.
          expect(mindAt(db, s, CHAT.harness, PEOPLE.ada.name, null)["core.md"]?.text).toBe(AREAS["gen-3"]["minds/e-ada/core.md"]);
          expect(mindAt(db, s, CHAT.harness, PEOPLE.bo.name, null)).toEqual({});
        });
        expect(report.carried?.minds.untied).toBe(0);
        expect(reportText(report)).not.toContain("in areas no imported turn ended with");
        // The reply's document holds the very area its turn ended with: no version of the notes is kept under its generation.
        const notes = await notesOf(data, CHAT.harness);
        // The chat's area before any turn is the one document no turn ended with.
        expect(report.carried?.ownFiles?.untied).toBe(1);
        expect(notes?.get("notebook.md")).toBe(AREAS["gen-3"]["notebook.md"]);
      },
    );
  });

  test("a chat's notes as they stand are those of the reply it shows: flipped back to an earlier swipe, with a stopped generation's area written last, they agree with its characters' minds", async () => {
    await migrated(
      async (fixture) => {
        // The player flipped the last reply back to its first swipe (gen-2, written before gen-3); then a generation was stopped after its agents had written files, which LumiAH forgets but whose document stays.
        showSwipe(fixture, "m-h6", 0);
        await putArea(fixture, CHAT.harness, "gen-stopped", { ...AREAS["gen-3"], "notebook.md": "Half a thought, stopped." }, 9);
      },
      async (data, report) => {
        const notes = await notesOf(data, CHAT.harness);
        expect(notes?.get("notebook.md")).toBe(AREAS["gen-2"]["notebook.md"]);
        look(data, (db, s) => expect(mindAt(db, s, CHAT.harness, PEOPLE.ada.name, null)["core.md"]?.text).toBe(AREAS["gen-2"]["minds/e-ada/core.md"]));
        // The stopped generation's area, with the area before any turn, no imported turn ended with: in the backup only, counted.
        expect(report.carried?.ownFiles?.untied).toBe(2);
      },
    );
  });

  test("a branch of the harness chat made at its first reply and not played since reads its notes from the turns it shares, and its first briefing says what its path holds", async () => {
    const branch = "c-harness-branch";
    await migrated(
      (fixture) => branchChat(fixture, { from: CHAT.harness, at: "m-h2", id: branch, name: "Fog (branch)" }),
      async (data, report) => {
        expect(report.imports?.find((c) => c.chatId === branch)).toMatchObject({ outcome: "imported", turns: 0, shares: { chat: CHAT.harness, messages: 2 } });
        // Its notes as LumiAH gave them to it: the area of the last turn on its path, which it shares; that turn's version; and the learned/ of the chat it was made from.
        const notes = await notesOf(data, branch);
        expect(notes?.get("notebook.md")).toBe(AREAS["gen-1"]["notebook.md"]);
        expect(notes?.get("author/prepare.md")).toBe(AREAS["gen-1"]["author/prepare.md"]);
        expect(versionsOf(data, branch).find((v) => v.path === "notebook.md")).toMatchObject({ before: null, after: AREAS["gen-1"]["notebook.md"], stands: true });
        expect(notes?.get("learned/notes.md")).toBe("The pier floods at high tide.");
        // Nothing of what the harness chat played after the branch was made.
        expect(versionsOf(data, branch).length).toBeGreaterThan(0);
        const shipped = await shippedParts([MIGRATED_PART]);
        try {
          const fields = look(data, (db, s, store) => {
            expect(mindAt(db, s, branch, PEOPLE.ada.name, null)["core.md"]?.text).toBe(AREAS["gen-1"]["minds/e-ada/core.md"]);
            return migratedChat({ db, store, user: USER, chat: branch });
          });
          if (fields === null) throw new Error("the branch was migrated");
          expect(shipped.template(MIGRATED_PART).render(fields).text.trimEnd().split("\n")).toEqual([
            "It was played by the earlier build's harness engine; 1 of its turns were carried, each with what it changed, 1 of them shared with the chat it was branched from.",
            "Mind files from the earlier build, on each character's record word for word, not yet filed:",
            `- ${PEOPLE.ada.name}: core.md, memory.md`,
            `- ${PEOPLE.bo.name}: profile.md`,
            "Where the earlier build's minds pack kept notes of a character (its summary, notes, commitments, what it witnessed, its last mind), they are on the character's record too, as `minds`, not yet filed.",
            "From the earlier build's story record: 1 beat(s) and 0 strike(s) on the timeline, 1 draft(s) as proposed futures, 1 casting(s) in the cast.",
            "The Author's notes from the earlier build are in `persistent-workspace`, as the reply now shown left them; each earlier version is in the notes' own history, on the turn that wrote it, so showing an earlier reply puts its notes back; what it had learned is in `persistent-workspace/learned`.",
          ]);
        } finally {
          shipped.remove();
        }
        // The Migration page says the turns it shares, and with which chat.
        const chat = look(data, (db) => chatOne({ db, user: USER }, report, new Map(), branch, "run"));
        expect(chat).toMatchObject({ imported: 0, shares: { chat: CHAT.harness, messages: 2 }, carried: { turns: 1, shared: { chat: CHAT.harness, turns: 1 } } });
      },
    );
  });

  test("a note a turn removed is a version of that turn with no text after it, and the swipe that kept it has none", async () => {
    await migrated(
      async (fixture) => {
        // The shown swipe of the last reply also removed prepare.md.
        const { "author/prepare.md": _prepare, ...dark } = AREAS["gen-3"];
        await putArea(fixture, CHAT.harness, "gen-3", dark, 4);
      },
      async (data, report) => {
        const notes = await notesOf(data, CHAT.harness);
        expect(notes?.has("author/prepare.md")).toBe(false);
        const mine = versionsOf(data, CHAT.harness).filter((v) => v.path === "author/prepare.md");
        // Written by the first reply's turn, removed by the last reply's shown swipe; nothing else touched it.
        expect(mine.map((v) => [v.before === null, v.after === null])).toEqual([[true, false], [false, true]]);
        expect(mine[0]?.after).toBe(AREAS["gen-1"]["author/prepare.md"]);
        expect(report.carried?.ownFiles?.removals).toBe(1);
      },
    );
  });
});

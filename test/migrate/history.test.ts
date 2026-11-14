// What today's build recorded beside each turn of a chat, carried onto the records it belongs to: each
// character's mind files onto its record in the cast, word for word, as each turn left them, marked
// imported and not yet filed; the story record's beats, strikes, castings and drafts into RPE's story
// record and cast, each on its turn; the Author's notes into the chat's own notes folder, version by
// version. On the migration fixture's harness chat, whose last reply has two swipes that each changed
// its area its own way. A second run duplicates none of it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { dataPaths } from "../../src/app/config";
import { castAt } from "../../src/cast/path";
import { CastRecord, castingInForce, chatLine, findCharacter } from "../../src/cast/record";
import { createRegistry } from "../../src/engine/registry-impl";
import { MIGRATED_NOTICE, MIGRATED_PART, migratedChat } from "../../src/migrate/briefing";
import { migrate } from "../../src/migrate/migrate";
import { reportText, type MigrationReport } from "../../src/migrate/report";
import { ALL_PACKS } from "../../src/packs/index";
import { openStore, type Store, storedWorlds, type UserStore } from "../../src/store";
import { storyBrief, storyRecordParts } from "../../src/story/index";
import { storyAt } from "../../src/story/path";
import { StoryRecord } from "../../src/story/record";
import { NOTES_FOLDER, TreeChats } from "../../src/tree";
import { AREAS, buildFixture, CHAT, PEOPLE, STRAY, USER, type Fixture } from "./fixture";
import { type ShippedParts, shippedParts } from "./parts";
import { readable, TREE as tree } from "./tree";

const registry = createRegistry(ALL_PACKS);

describe("what today's build recorded beside each turn", () => {
  let fixture: Fixture;
  let data: string;
  let report: MigrationReport;
  let parts: ShippedParts;

  /** RPE's database and the user's store in it, its worlds the store's own, for one look. */
  function open<T>(look: (db: Database, s: UserStore, store: Store) => T): T {
    const db = new Database(join(data, "rpe.db"));
    try {
      const store = openStore({ db, registry, worlds: storedWorlds(db) });
      return look(db, store.user(USER), store);
    } finally {
      db.close();
    }
  }

  /** The turn the import made of a swipe of a message, by the record the run kept beside it. */
  function turnOf(db: Database, message: string, swipe: number): string {
    const row = db.query<{ turn: string }, [string, string, string, number]>("SELECT turn FROM imported_record WHERE user = ? AND chat = ? AND message = ? AND swipe = ?").get(USER, CHAT.harness, message, swipe);
    if (row === null) throw new Error(`no turn for swipe ${swipe} of ${message}`);
    return row.turn;
  }

  /** A character's imported mind files at a turn (null: the chat's head), by file: each item's fields as they stand there, those a turn removed left out. */
  function mindAt(db: Database, s: UserStore, name: string, turn: string | null): Record<string, Record<string, unknown>> {
    const character = findCharacter(db, USER, chatLine(s, CHAT.harness), name);
    if (character === null) throw new Error(`no character ${name}`);
    const record = CastRecord.read(db, USER, castAt(s, CHAT.harness, turn));
    return Object.fromEntries(record.of(character.id, "mind").filter((m) => m.fields.kind === "imported").map((m) => [String(m.fields.file), m.fields]));
  }

  /** The harness chat's notes the run wrote, as its own agents read them: each by its path under `imported/`, with its text. */
  async function notes(): Promise<Map<string, string>> {
    const files = dataPaths(data).files;
    const own = open((db) => new TreeChats(db, { run: async (write) => write(db) }, files).folders(USER, CHAT.harness));
    if (own === null) throw new Error("the harness chat has no folders");
    const prefix = `${NOTES_FOLDER}/imported/`;
    return new Map([...(await readable({ files, ...own }))].flatMap(([path, text]) => (path.startsWith(prefix) ? [[path.slice(prefix.length), text] as const] : [])));
  }

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    data = join(fixture.root, "rpe-data");
    const first = await migrate(fixture.sources, { data, tree, now: () => new Date("2026-11-14T09:00:00.000Z") });
    expect(first.ran).toBe(true);
    report = first.report;
    parts = await shippedParts(["story-brief", "story-so-far"]);
  });

  afterAll(async () => {
    parts.remove();
    await fixture.remove();
  });

  test("each character's mind files are on its record in the cast, word for word, as each turn left them, marked imported and not yet filed", () => {
    open((db, s) => {
      const first = turnOf(db, "m-h2", 0);
      const lit = turnOf(db, "m-h6", 0);
      const ada = PEOPLE.ada.name;
      const bo = PEOPLE.bo.name;
      // The first reply's turn: every file its area held, each on the character the world names.
      expect(mindAt(db, s, ada, first)).toEqual({
        "core.md": { kind: "imported", file: "core.md", text: AREAS["gen-1"]["minds/e-ada/core.md"], entity: "e-ada", filed: false },
        "memory.md": { kind: "imported", file: "memory.md", text: AREAS["gen-1"]["minds/e-ada/memory.md"], entity: "e-ada", filed: false },
      });
      expect(mindAt(db, s, bo, first)).toEqual({ "profile.md": { kind: "imported", file: "profile.md", text: AREAS["gen-1"]["minds/e-bo/profile.md"], entity: "e-bo", filed: false } });
      // Each swipe of the last reply as it left them: the one not shown changed Ada's core; the one shown changed it its own way and removed Bo's profile.
      expect(mindAt(db, s, ada, lit)["core.md"]?.text).toBe(AREAS["gen-2"]["minds/e-ada/core.md"]);
      expect(Object.keys(mindAt(db, s, bo, lit))).toEqual(["profile.md"]);
      const head = mindAt(db, s, ada, null);
      expect(new TextEncoder().encode(String(head["core.md"]?.text))).toEqual(new TextEncoder().encode(AREAS["gen-3"]["minds/e-ada/core.md"]));
      expect(head["memory.md"]?.text).toBe(AREAS["gen-1"]["minds/e-ada/memory.md"]);
      expect(mindAt(db, s, bo, null)).toEqual({});
    });
  });

  test("the report counts the mind files where they landed: every version found is on a record, none kept in the backup only", () => {
    const minds = report.carried?.minds;
    expect(minds?.versions).toBe(report.rows.find((r) => r.row === "mind-files")?.inside?.count);
    expect(minds?.untied).toBe(0);
    expect(minds?.characters.map((c) => [c.name, c.entity, c.files])).toEqual([
      [PEOPLE.ada.name, "e-ada", ["core.md", "memory.md"]],
      [PEOPLE.bo.name, "e-bo", ["profile.md"]],
    ]);
    const text = reportText(report);
    const what = report.rows.find((r) => r.row === "mind-files")?.what ?? "";
    expect(text).toContain(`  ${what}: On each character's record in the cast, word for word, per turn, marked imported and not yet filed`);
    const kept = text.slice(text.indexOf("Kept in the backup only"));
    expect(kept).not.toContain(what);
  });

  test("the story record's beats, strikes and drafts are in RPE's story record, each on its turn, so the story so far and the story brief are not empty", () => {
    open((db, s, store) => {
      const at = (turn: string | null) => ({ store, user: USER, chat: CHAT.harness, turn });
      const lit = turnOf(db, "m-h6", 0);
      // At the chat's head: the first reply's beat and the shown swipe's; the draft, open and due, in the brief.
      expect(storyRecordParts(at(null)).beats.map((b) => b.text)).toEqual(["Fog came.", "The lamp stayed dark."]);
      const brief = storyBrief({ ...at(null), layout: parts.template("story-brief") });
      expect(brief.fields.futures?.items.map((f) => f.text)).toEqual(["A ship comes in at dawn."]);
      expect(brief.text).toContain("A ship comes in at dawn.");
      // On the swipe not shown: the beat it struck dropped, its own beat with who and where by name, the draft it settled closed.
      const record = StoryRecord.read(db, USER, storyAt(s, CHAT.harness, lit));
      expect(record.of("beat").map((b) => b.fields.text)).toEqual(["Ada lit the lamp."]);
      expect(record.items.get("b:b1")).toMatchObject({ dropped: true, fields: { text: "Fog came.", why: "The fog came after the lamp was lit." } });
      expect(record.items.get("b:b2")?.fields).toEqual({ text: "Ada lit the lamp.", who: [PEOPLE.ada.name, PEOPLE.bo.name], place: "Home", kind: "do", surface: "The lamp glows." });
      expect(record.items.get("fu:d1")).toMatchObject({ closedBy: lit, fields: { text: "A ship comes in at dawn.", tier: 2, due: 0, who: [PEOPLE.bo.name], place: "Home", state: "settled" } });
      expect(storyBrief({ ...at(lit), layout: parts.template("story-brief") }).fields.futures).toBeUndefined();
      // Each row says the migration wrote it.
      expect(record.items.get("b:b2")?.rows.map((r) => r.by)).toEqual(["migration"]);
    });
  });

  test("each casting is in the cast on its turn, and the casting the player pinned is pinned", () => {
    open((db, s) => {
      const line = chatLine(s, CHAT.harness);
      const ada = findCharacter(db, USER, line, PEOPLE.ada.name);
      const bo = findCharacter(db, USER, line, PEOPLE.bo.name);
      if (ada === null || bo === null) throw new Error("a person of the chat has no character");
      const head = CastRecord.read(db, USER, castAt(s, CHAT.harness, null));
      expect(castingInForce(head, ada)).toEqual({ as: "principal", pinned: true, line: null });
      // Bo was cast on the swipe that doesn't show: there, and only there.
      expect(castingInForce(head, bo)).toBeNull();
      const lit = CastRecord.read(db, USER, castAt(s, CHAT.harness, turnOf(db, "m-h6", 0)));
      expect(castingInForce(lit, bo)).toEqual({ as: "supporting", pinned: false, line: null });
      expect(lit.castingOf(bo.id)).toEqual({ as: "supporting", line: null });
    });
    expect(report.carried?.story).toMatchObject({ beats: 3, struck: 1, futures: 2, castings: 2, pinned: 1, leftOut: 0 });
    expect(report.carried?.story.byChat.find((c) => c.chat === CHAT.harness)).toEqual({ chat: CHAT.harness, beats: 3, struck: 1, futures: 2, castings: 2 });
    const found = report.rows.find((r) => r.row === "story-record")?.inside?.count;
    expect(found).toBe(3 + 1 + 2 + 2);
    expect(reportText(report)).toContain("RPE's story record and cast, each on the turn whose record held it; each swipe's record also kept word for word beside its turn in the migration's imported_record, read-only: 3 beat(s), 1 struck, 2 draft(s) as proposed futures, 2 casting(s) in the cast, 1 pinned as the player pinned them");
  });

  test("the Author's notes are in the chat's own notes folder at every turn: the latest as it stands, each version before it by the turn that wrote it", async () => {
    const files = await notes();
    expect(files.get("notebook.md")).toBe(AREAS["gen-3"]["notebook.md"]);
    expect(files.get("turns/before-any-turn/notebook.md")).toBe(AREAS.root["notebook.md"]);
    expect(files.get("turns/message-1-swipe-0/notebook.md")).toBe(AREAS["gen-1"]["notebook.md"]);
    expect(files.get("turns/message-1-swipe-0/author/prepare.md")).toBe(AREAS["gen-1"]["author/prepare.md"]);
    // The last reply's swipes: the one that changed the notebook keeps its version there; the one that changed nothing of the notes has no folder.
    expect(files.get("turns/message-5-swipe-0/notebook.md")).toBe(AREAS["gen-2"]["notebook.md"]);
    expect([...files.keys()].filter((p) => p.startsWith("turns/message-5-swipe-1/"))).toEqual([]);
    // No mind file among the notes: they are the characters'.
    expect([...files.keys()].filter((p) => p.includes("minds/"))).toEqual([]);
    // Every version found is there, once a turn holds it, and the report counts them where they are.
    const versions = new Set(Object.values(AREAS).flatMap((a) => Object.entries(a).flatMap(([p, t]) => (p.startsWith("minds/") ? [] : [`${p}\u0000${t}`]))));
    const kept = new Set([...files].flatMap(([p, t]) => (p.startsWith("turns/") ? [`${p.replace(/^turns\/[^/]+\//, "")}\u0000${t}`] : [])));
    expect(kept).toEqual(versions);
    expect(report.carried?.ownFiles?.versions).toBe(versions.size);
    expect(report.rows.find((r) => r.row === "author-notes")?.inside?.count).toBe(versions.size);
    expect(report.rows.find((r) => r.row === "author-notes")?.count).toMatchObject({ found: 4, carried: 4, backup: 0 });
  });

  test("a second run duplicates nothing: each character once, the same rows read the same, the same notes", async () => {
    const look = async (): Promise<unknown> => ({
      ...open((db, s, store) => ({
        characters: db.query<{ name: string }, [string]>("SELECT name FROM cast_character WHERE user = ? ORDER BY n").all(USER).map((c) => c.name),
        rows: db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM cast_entry WHERE user = ?").get(USER)?.n,
        story: db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM story_entry WHERE user = ?").get(USER)?.n,
        ada: mindAt(db, s, PEOPLE.ada.name, null),
        bo: mindAt(db, s, PEOPLE.bo.name, turnOf(db, "m-h6", 0)),
        beats: storyRecordParts({ store, user: USER, chat: CHAT.harness, turn: null }).beats,
      })),
      notes: await notes(),
    });
    const before = await look();
    const second = await migrate(fixture.sources, { data, tree, now: () => new Date("2026-11-14T10:00:00.000Z") });
    expect(second.ran).toBe(true);
    expect(second.report.imports?.find((c) => c.chatId === CHAT.harness)?.outcome).toBe("replaced");
    expect(await look()).toEqual(before);
  });

  test("a migrated chat's first briefing says it was migrated and what was carried, laid out by the shipped part; once RPE has played a turn of it, nothing", async () => {
    const shipped = await shippedParts([MIGRATED_PART, "notices"]);
    try {
      const fields = open((db, _s, store) => migratedChat({ db, store, user: USER, chat: CHAT.harness }));
      if (fields === null) throw new Error("the harness chat was migrated");
      const carried = shipped.template(MIGRATED_PART).render(fields).text.trimEnd();
      expect(shipped.lines("notices").line(MIGRATED_NOTICE, { carried })).toBe(`This chat was carried over from the earlier build. Its state, cast and story record are as that build left them. ${carried}`);
      expect(carried.split("\n")).toEqual([
        "It was played by the earlier build's harness engine; 4 of its turns were carried, each with what it changed.",
        "Mind files from the earlier build, on each character's record word for word, not yet filed:",
        `- ${PEOPLE.ada.name}: core.md, memory.md`,
        `- ${PEOPLE.bo.name}: profile.md`,
        "From the earlier build's story record: 3 beat(s) and 1 strike(s) on the timeline, 2 draft(s) as proposed futures, 2 casting(s) in the cast.",
        "The Author's notes from the earlier build are in `persistent-workspace/imported`, as they stood at its last turn; each earlier version is in `persistent-workspace/imported/turns`, by the turn that wrote it; what it had learned is in `persistent-workspace/imported/learned`.",
      ]);
      open((db, s, store) => {
        // A chat no run imported: nothing.
        expect(migratedChat({ db, store, user: USER, chat: CHAT.plain })).toBeNull();
        // A turn RPE played, its reply saved and on the chat's path: the first briefing is behind it.
        const turn = s.beginTurn({ chat: CHAT.harness, kind: "normal" });
        expect(migratedChat({ db, store, user: USER, chat: CHAT.harness })).not.toBeNull();
        s.tieTurn(turn.id, { message: "m-h7", hash: "played-on-rpe", date: 9 });
        expect(migratedChat({ db, store, user: USER, chat: CHAT.harness })).toBeNull();
      });
    } finally {
      shipped.remove();
    }
  });
});

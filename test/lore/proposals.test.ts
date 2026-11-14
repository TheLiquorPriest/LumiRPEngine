// Proposals (plan §9.5): an agent's draft of a new entry or an edit, kept until the user decides. An
// approval is one write, refused when the entry changed meanwhile; a rejection writes nothing; every
// write is kept with the entry before and after, and the entry can be put back. Lumiverse's writes
// are played by a stand-in over the invented books that checks revisions as Lumiverse does.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRef, Scope } from "rp-harness/contract";
import { Lore, type LoreBookEntry, type LoreBookWrites, type LoreEntryFields, LoreProposals } from "../../src/lore/index";
import { ATLAS, CHAT, dbFile, type LoreDb, loreDb, Shelf, startingWorlds, Tags, USER } from "./fixtures";

const SCOPE: Scope = { user: USER, chat: CHAT, session: "session-1", turn: "turn-4" };
const AUTHOR: AgentRef = { id: "author-1", definition: "author" };

/** Lumiverse's writes over the shelf: each refused unless the entry is at the revision given, each raising it. */
class StandInWrites implements LoreBookWrites {
  calls = 0;
  constructor(private readonly shelf: Shelf) {}

  private rows(user: string): LoreBookEntry[] {
    return this.shelf.users.get(user)?.entries ?? [];
  }

  async update(user: string, entry: string, fields: LoreEntryFields, revision: number) {
    this.calls++;
    const row = this.rows(user).find((e) => e.id === entry);
    if (row === undefined || row.revision !== revision) return { refused: row === undefined ? null : { ...row } };
    Object.assign(row, { content: fields.content, comment: fields.comment, keys: [...fields.keys], revision: row.revision + 1 });
    return { written: { ...row } };
  }

  async create(user: string, book: string, fields: LoreEntryFields) {
    this.calls++;
    const row: LoreBookEntry = { id: `entry-new-${this.calls}`, book, comment: fields.comment, content: fields.content, keys: [...fields.keys], secondaryKeys: [], disabled: false, constant: false, vectorized: false, extensions: {}, revision: 1 };
    this.rows(user).push(row);
    return { ...row };
  }

  async remove(user: string, entry: string, revision: number) {
    this.calls++;
    const rows = this.rows(user);
    const at = rows.findIndex((e) => e.id === entry);
    const row = rows[at];
    if (row === undefined || row.revision !== revision) return { refused: row === undefined ? null : { ...row } };
    rows.splice(at, 1);
    return { removed: true as const };
  }
}

describe("lore proposals", () => {
  let dir: string;
  let db: LoreDb;
  let shelf: Shelf;
  let writes: StandInWrites;
  let proposals: LoreProposals;
  let lamp: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "rpe-lore-proposals-"));
    const { file, backups } = dbFile(dir);
    db = loreDb(file, backups);
    shelf = new Shelf();
    writes = new StandInWrites(shelf);
    proposals = new LoreProposals({ db: db.db, writes: db.writes, books: shelf, numbers: db.numbers, write: writes, now: () => 9 });
    // The lamp room has been shown to an agent, so it has an id.
    const lore = new Lore({ books: shelf, worlds: startingWorlds(), turns: new Tags(), numbers: db.numbers });
    lamp = (await lore.catalog({ user: USER, chat: CHAT })).find((e) => e.title === "The lamp room")?.id ?? "";
  });
  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const entry = (id: string) => shelf.users.get(USER)?.entries.find((e) => e.id === id);

  test("a suggestion about a file is not the lore's", async () => {
    expect(await proposals.suggested(SCOPE, AUTHOR, { target: { file: "notes/inn.md" }, text: "x", reason: "y" })).toBeNull();
  });

  test("an approved proposal makes one write, kept with the entry before and after; a rejected one makes none", async () => {
    const edit = await proposals.suggested(SCOPE, AUTHOR, { target: { lore: lamp }, text: "Green glass, cracked in the great storm.", reason: "The storm cracked it on turn 3." });
    const other = await proposals.suggested(SCOPE, AUTHOR, { target: { lore: lamp }, text: "The lamp is gone.", reason: "A guess." });
    if (edit === null || other === null) throw new Error("a suggestion about an entry is a proposal");
    expect([edit.status, edit.target, other.status]).toEqual(["open", lamp, "open"]);

    expect(await proposals.reject(USER, other.id)).toMatchObject({ status: "rejected" });
    expect(writes.calls).toBe(0);

    const approved = await proposals.approve(USER, edit.id, { title: "The lamp room (cracked)" });
    expect(writes.calls).toBe(1);
    expect(approved).toEqual({
      written: {
        id: 1,
        proposal: edit.id,
        kind: "edit",
        entry: "entry-lamp",
        book: ATLAS.id,
        before: { content: "Green glass and whale oil, kept burning by the night watch.", comment: "The lamp room", keys: ["lamp", "lantern"] },
        after: { content: "Green glass, cracked in the great storm.", comment: "The lamp room (cracked)", keys: ["lamp", "lantern"] },
        of: null,
        putBack: null,
        at: 9,
      },
    });
    expect([entry("entry-lamp")?.content, entry("entry-lamp")?.revision]).toEqual(["Green glass, cracked in the great storm.", 2]);
    expect(proposals.proposals(USER, CHAT).map((p) => [p.id, p.status, p.write])).toEqual([
      [other.id, "rejected", null],
      [edit.id, "approved", 1],
    ]);
    // A decided proposal is not decided again.
    expect(await proposals.approve(USER, other.id)).toEqual({ problem: "not_open" });
    expect(writes.calls).toBe(1);
  });

  test("a proposal against an entry that changed meanwhile is refused and says so, and nothing is written", async () => {
    const draft = await proposals.suggested(SCOPE, AUTHOR, { target: { lore: lamp }, text: "The lamp burns blue now.", reason: "A spell." });
    // The user edits the entry in Lumiverse before deciding.
    const row = entry("entry-lamp");
    if (row === undefined) throw new Error("the lamp room is on the shelf");
    Object.assign(row, { content: "Green glass, mended by the glazier.", revision: row.revision + 1 });
    const calls = writes.calls;
    expect(await proposals.approve(USER, draft?.id ?? 0)).toEqual({ refused: "changed" });
    expect(writes.calls).toBe(calls);
    expect(entry("entry-lamp")?.content).toBe("Green glass, mended by the glazier.");
    expect(proposals.proposals(USER).find((p) => p.id === draft?.id)).toMatchObject({ status: "refused", refused: "changed" });
  });

  test("putting an entry back restores it, under the same check; an entry RPE made is taken away again", async () => {
    // The lamp room as it stands, edited once more by an approved proposal, then put back.
    const draft = await proposals.suggested(SCOPE, AUTHOR, { target: { lore: lamp }, text: "Only the frame is left.", reason: "The fire." });
    const approved = await proposals.approve(USER, draft?.id ?? 0);
    if (!("written" in approved)) throw new Error("the approval was not written");
    expect(entry("entry-lamp")?.content).toBe("Only the frame is left.");
    const back = await proposals.putBack(USER, approved.written.id);
    expect(back).toMatchObject({ written: { kind: "put_back", of: approved.written.id, after: { content: "Green glass, mended by the glazier." } } });
    expect(entry("entry-lamp")?.content).toBe("Green glass, mended by the glazier.");
    expect(proposals.writesMade(USER).find((w) => w.id === approved.written.id)?.putBack).toBe("written" in back ? back.written.id : -1);
    expect(await proposals.putBack(USER, approved.written.id)).toEqual({ problem: "put_back_already" });

    // A new entry: it needs a book; once made, putting it back removes it.
    const fresh = await proposals.suggested(SCOPE, AUTHOR, { target: { newLore: true }, text: "A glazier on Quay Street mends lamp glass.", reason: "Introduced on turn 4." });
    expect(await proposals.approve(USER, fresh?.id ?? 0)).toEqual({ problem: "no_book" });
    const made = await proposals.approve(USER, fresh?.id ?? 0, { book: ATLAS.id, title: "The glazier", keys: ["glazier"] });
    if (!("written" in made)) throw new Error("the new entry was not written");
    expect([made.written.kind, made.written.before, entry(made.written.entry)?.comment]).toEqual(["create", null, "The glazier"]);
    // Changed in Lumiverse after RPE made it: not put back.
    const row = entry(made.written.entry);
    if (row === undefined) throw new Error("the new entry is on the shelf");
    row.revision++;
    expect(await proposals.putBack(USER, made.written.id)).toEqual({ refused: "changed" });
    row.revision--;
    expect(await proposals.putBack(USER, made.written.id)).toMatchObject({ written: { kind: "put_back", after: null } });
    expect(entry(made.written.entry)).toBeUndefined();
  });
});

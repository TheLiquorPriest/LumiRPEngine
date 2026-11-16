// What the tree keeps of a chat is bounded (plan §3.2 P10, §5.1): a chat's open suggestions stop at their limit and say so, its decided
// ones are kept to a count, and the versions of notes of turns far back on every path are folded into the notes as they stand. Every
// name and text is invented.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRef } from "rp-harness/contract";
import { KIT_SEED } from "rp-harness/testing/kit";
import { CHATS_FOLDER, NOTES_FOLDER, TreeNotes, TreeSuggestions } from "../../src/tree/index";
import { type LaidTree, layTree } from "./fixtures";

const USER = KIT_SEED.scope.user;
const CHAT = KIT_SEED.scope.chat;
const LEAD: AgentRef = { id: "lead-1", definition: "author" };

let place: string;
let tree: LaidTree;

beforeEach(async () => {
  place = await mkdtemp(join(tmpdir(), "rpe-bounded-"));
  tree = await layTree(KIT_SEED, place);
});

afterEach(async () => {
  await tree.close();
  await rm(place, { recursive: true, force: true });
});

test("a chat's open suggestions stop at their limit and the answer says so; its decided ones are kept to a count, the oldest going, and lore's are not the tree's", async () => {
  let clock = 100;
  const suggestions = new TreeSuggestions({ db: tree.db, writes: tree.writes, now: () => clock++, limits: async () => ({ openMost: 3, decidedKept: 2 }) });
  const scope = { user: USER, chat: CHAT, session: "s-1" };
  const file = (name: string) => suggestions.file(scope, LEAD, { target: { file: name }, text: `# ${name}\n`, reason: "It reads better." });
  const filed = [await file("A.md"), await file("B.md"), await file("C.md")];
  expect(filed.map((f) => f?.kept)).toEqual([true, true, true]);
  expect(await file("D.md")).toEqual({ kept: false, openMost: 3 });
  expect(await suggestions.file(scope, LEAD, { target: { lore: "entry-9" }, text: "x", reason: "y" })).toBeNull();
  expect(suggestions.list(USER, CHAT, "open")).toHaveLength(3);

  const ids = filed.map((f) => (f?.kept === true ? f.id : -1));
  expect(await suggestions.decide(USER, ids[0] ?? -1, "dismissed")).toBe(true);
  expect(await suggestions.decide(USER, ids[1] ?? -1, "accepted")).toBe(true);
  expect(suggestions.list(USER, CHAT, "dismissed")).toHaveLength(1);
  // A fourth decision lets the oldest decided one go; an open one never does.
  expect(await file("D.md")).toMatchObject({ kept: true });
  expect(await suggestions.decide(USER, ids[2] ?? -1, "dismissed")).toBe(true);
  expect(suggestions.list(USER, CHAT).map((s) => [s.path, s.state])).toEqual([
    ["D.md", "open"],
    ["C.md", "dismissed"],
    ["B.md", "accepted"],
  ]);
  // Lowering the limit and pruning on request takes the same way, and says first what it takes.
  expect(suggestions.decidedPast(USER, CHAT, 1)).toEqual({ count: 1, bytes: "# B.md\n".length + "It reads better.".length });
  expect(await suggestions.pruneDecided(USER, CHAT, 1)).toBe(1);
  expect(suggestions.list(USER, CHAT).map((s) => s.path)).toEqual(["D.md", "C.md"]);
});

test("the versions of notes of turns further back than the setting on every path that reaches them are folded into the notes as they stand, and a swipe reaching back leaves them so", async () => {
  await tree.writes.run((db) => {
    db.run("CREATE TABLE IF NOT EXISTS turn (user TEXT NOT NULL, id TEXT NOT NULL, chat TEXT NOT NULL)");
    db.run("CREATE TABLE IF NOT EXISTS path_node (user TEXT NOT NULL, key TEXT NOT NULL, prev TEXT, turn TEXT NOT NULL, depth INTEGER NOT NULL)");
    // Six turns in a row, and a swipe of the last one: both ends are the newest.
    ["t1", "t2", "t3", "t4", "t5", "t6", "t6b"].forEach((t, i) => {
      const depth = t === "t6b" ? 5 : i;
      db.run("INSERT INTO turn (user, id, chat) VALUES (?, ?, ?)", [USER, t, CHAT]);
      db.run("INSERT INTO path_node (user, key, prev, turn, depth) VALUES (?, ?, ?, ?, ?)", [USER, `n-${t}`, depth === 0 ? null : `n-t${depth}`, t, depth]);
    });
  }, "laying a path");
  const turns = ["t1", "t2", "t3", "t4", "t5", "t6", "t6b"];
  const notes = new TreeNotes({ files: tree.files, db: tree.db, writes: tree.writes, chats: tree.chats });
  const at = tree.chats.folders(USER, CHAT);
  if (at === null) throw new Error("the chat is not placed");
  const note = join(tree.files, CHATS_FOLDER, at.character, at.chat, NOTES_FOLDER, "harbour", "fog.md");

  await notes.follow(USER, CHAT, { turns: ["t1"], branchOf: null });
  for (let n = 1; n <= 6; n++) {
    await notes.follow(USER, CHAT, { turns: turns.slice(0, n), branchOf: null });
    const done = await tree.port.write({ user: USER, chat: CHAT, session: "s-1", turn: `t${n}` }, `${NOTES_FOLDER}/harbour/fog.md`, { op: "write", text: `Fog, turn ${n}.\n` }, LEAD);
    expect(done.status).toBe("written");
  }
  // Two turns back: turns 1 to 3 are further back than that on both paths, and turn 4 is not.
  expect(notes.foldable(USER, CHAT, 2).ids).toHaveLength(3);
  expect(notes.foldable(USER, CHAT, 5).ids).toHaveLength(0);
  expect(await notes.fold(USER, CHAT, 2)).toBe(3);
  expect(await readFile(note, "utf8")).toBe("Fog, turn 6.\n");
  // Swiped back over turn 6: its version is taken back; the folded ones are not there to be, and the notes stand as turn 5 left them.
  expect(await notes.follow(USER, CHAT, { turns: ["t1", "t2", "t3", "t4", "t5", "t6b"], branchOf: null })).toMatchObject({ undone: 1, redone: 0 });
  expect(await readFile(note, "utf8")).toBe("Fog, turn 5.\n");
  // The setting folds after each turn by itself.
  await writeFile(join(tree.files, "RPE-global.yml"), "notes:\n  versionsKept: 1\n");
  await notes.follow(USER, CHAT, { turns: ["t1", "t2", "t3", "t4", "t5", "t6b"], branchOf: null });
  expect(notes.foldable(USER, CHAT, 1).ids).toHaveLength(0);
});

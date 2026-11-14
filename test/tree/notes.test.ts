// Notes follow the turn (plan §5.1), on a real tree in a temporary folder, the notes written through the
// file port as agents write them: a swipe takes a turn's notes away and flipping back puts them back; the
// user's edits, their own notes and the notes a migration carried survive; a branch starts with the
// notes of its branch point; and a sub-agent's dropped writes go while the lead's stay. Which turns stand
// at each turn's start is given as the turn lane gives it. Every name and text is invented.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { AgentRef, FileOp } from "rp-harness/contract";
import { KIT_SEED } from "rp-harness/testing/kit";
import { CHATS_FOLDER, NOTES_FOLDER, TreeNotes } from "../../src/tree/index";
import { KIT_NAMES, type LaidTree, layTree } from "./fixtures";

const USER = KIT_SEED.scope.user;
const CHAT = KIT_SEED.scope.chat;
const LEAD: AgentRef = { id: "lead-1", definition: "author" };
const SUB: AgentRef = { id: "gm-1", definition: "gm", parent: "lead-1" };
/** The folder of the notes these tests write, below the notes folder: one the kit's seed does not have. */
const STORY = "harbour";

describe("notes that follow the turn", () => {
  let place: string;
  let tree: LaidTree;
  let notes: TreeNotes;

  beforeEach(async () => {
    place = await mkdtemp(join(tmpdir(), "rpe-notes-"));
    tree = await layTree(KIT_SEED, place);
    notes = new TreeNotes({ files: tree.files, db: tree.db, writes: tree.writes, chats: tree.chats });
  });

  afterEach(async () => {
    await tree.close();
    await rm(place, { recursive: true, force: true });
  });

  /** A chat's notes folder on disk. */
  const folderOf = (chat: string): string => {
    const at = tree.chats.folders(USER, chat);
    if (at === null) throw new Error(`chat ${chat} is not placed`);
    return join(tree.files, CHATS_FOLDER, at.character, at.chat, NOTES_FOLDER);
  };

  /** An agent's change to a note of `STORY`, in a turn, through the port. */
  const agentWrites = async (turn: string, name: string, op: FileOp, by: AgentRef = LEAD, chat = CHAT): Promise<void> => {
    const done = await tree.port.write({ user: USER, chat, session: "s-1", turn }, `${NOTES_FOLDER}/${STORY}/${name}`, op, by);
    expect(done.status).toBe("written");
  };
  const write = (text: string): FileOp => ({ op: "write", text });

  /** The notes of `STORY` on disk, by name. */
  const story = async (chat = CHAT): Promise<Record<string, string>> => {
    const folder = join(folderOf(chat), STORY);
    const found = await readdir(folder, { recursive: true, withFileTypes: true }).catch(() => []);
    const out: Record<string, string> = {};
    for (const d of found.filter((d) => d.isFile()).sort((a, b) => (a.name < b.name ? -1 : 1))) out[relative(folder, join(d.parentPath, d.name))] = await readFile(join(d.parentPath, d.name), "utf8");
    return out;
  };

  /** The chat's notes put at the start of the turn that `turns` ends with. */
  const at = (turns: string[], chat = CHAT, branchOf: string | null = null) => notes.follow(USER, chat, { turns, branchOf });

  test("a note written in turn 3 is gone once turn 3 is swiped, and back when the swipe is flipped back; the swipe's own notes go then", async () => {
    await at(["t1"]);
    await agentWrites("t1", "ada.md", write("Ada distrusts the guard.\n"));
    await at(["t1", "t2"]);
    await at(["t1", "t2", "t3"]);
    await agentWrites("t3", "fog.md", write("The fog came.\n"));
    await agentWrites("t3", "ada.md", { op: "edit", old: "distrusts", new: "trusts" });
    expect(await story()).toEqual({ "ada.md": "Ada trusts the guard.\n", "fog.md": "The fog came.\n" });

    // Turn 3 swiped: its swipe starts where turn 2 left the notes.
    expect(await at(["t1", "t2", "t3b"])).toEqual({ undone: 2, redone: 0, kept: [], started: 0 });
    expect(await story()).toEqual({ "ada.md": "Ada distrusts the guard.\n" });
    await agentWrites("t3b", "rain.md", write("Rain on the sea.\n"));

    // The swipe flipped back to turn 3, and the next turn played on it.
    expect(await at(["t1", "t2", "t3", "t4"])).toEqual({ undone: 1, redone: 2, kept: [], started: 0 });
    expect(await story()).toEqual({ "ada.md": "Ada trusts the guard.\n", "fog.md": "The fog came.\n" });

    // A continue of turn 4 keeps what turn 4 wrote; putting the notes at the same place again changes nothing.
    await agentWrites("t4", "ada.md", { op: "append", text: "She says so twice.\n" });
    expect(await at(["t1", "t2", "t3", "t4"])).toEqual({ undone: 0, redone: 0, kept: [], started: 0 });
    expect((await story())["ada.md"]).toBe("Ada trusts the guard.\nShe says so twice.\n");
  });

  test("the user's edits between turns, their own notes and the notes a migration carried survive a swipe", async () => {
    const imported = join(folderOf(CHAT), "imported", "notebook.md");
    await mkdir(join(folderOf(CHAT), "imported"), { recursive: true });
    await writeFile(imported, "The old notebook: the bell rang at dusk.\n");
    await at(["t1"]);
    await agentWrites("t1", "ada.md", write("Ada distrusts the guard.\n"));
    await at(["t1", "t2"]);
    // Between turns 2 and 3 the user changes a note, and starts one of their own.
    await writeFile(join(folderOf(CHAT), STORY, "ada.md"), "Ada distrusts the guard, and the user says why.\n");
    await writeFile(join(folderOf(CHAT), STORY, "mine.md"), "My own note.\n");
    await at(["t1", "t2", "t3"]);
    await agentWrites("t3", "ada.md", { op: "append", text: "Turn 3 adds a line.\n" });
    await agentWrites("t3", "fog.md", write("The fog came.\n"));
    const done = await tree.port.write({ user: USER, chat: CHAT, session: "s-1", turn: "t3" }, `${NOTES_FOLDER}/imported/notebook.md`, { op: "edit", old: "dusk", new: "dawn" }, LEAD);
    expect(done.status).toBe("written");
    // Between turns 3 and 4 the user changes a note turn 3 wrote.
    await writeFile(join(folderOf(CHAT), STORY, "fog.md"), "The fog came, and the user kept it.\n");

    const swiped = await at(["t1", "t2", "t3b"]);
    expect(swiped).toEqual({ undone: 2, redone: 0, kept: [`${NOTES_FOLDER}/${STORY}/fog.md`], started: 0 });
    expect(await story()).toEqual({ "ada.md": "Ada distrusts the guard, and the user says why.\n", "fog.md": "The fog came, and the user kept it.\n", "mine.md": "My own note.\n" });
    expect(await readFile(imported, "utf8")).toBe("The old notebook: the bell rang at dusk.\n");
  });

  test("a branch starts with the notes of its branch point, and the chat it came from keeps its own", async () => {
    await at(["t1"]);
    await agentWrites("t1", "a.md", write("One.\n"));
    await at(["t1", "t2"]);
    await agentWrites("t2", "a.md", write("Two.\n"));
    await agentWrites("t2", "b.md", write("Bee.\n"));
    await at(["t1", "t2", "t3"]);
    await agentWrites("t3", "c.md", write("Sea.\n"));
    const source = { "a.md": "Two.\n", "b.md": "Bee.\n", "c.md": "Sea.\n" };

    await tree.chats.place(USER, "chat-at-2", { character: KIT_NAMES.character, chat: { name: "The Bell, at turn two" } });
    const moved = await at(["t1", "t2", "b1"], "chat-at-2", CHAT);
    expect(moved).toMatchObject({ undone: 1, redone: 0, kept: [] });
    expect(moved.started).toBeGreaterThanOrEqual(3);
    expect(await story("chat-at-2")).toEqual({ "a.md": "Two.\n", "b.md": "Bee.\n" });

    await tree.chats.place(USER, "chat-at-1", { character: KIT_NAMES.character, chat: { name: "The Bell, at turn one" } });
    await at(["t1", "c1"], "chat-at-1", CHAT);
    expect(await story("chat-at-1")).toEqual({ "a.md": "One.\n" });

    // The branch's own turn writes in the branch alone; started once, it is not started again.
    await agentWrites("b1", "d.md", write("Dee.\n"), LEAD, "chat-at-2");
    expect(await at(["t1", "t2", "b1", "b2"], "chat-at-2", CHAT)).toEqual({ undone: 0, redone: 0, kept: [], started: 0 });
    expect(await story("chat-at-2")).toEqual({ "a.md": "Two.\n", "b.md": "Bee.\n", "d.md": "Dee.\n" });
    expect(await at(["t1", "t2", "t3", "t4"])).toEqual({ undone: 0, redone: 0, kept: [], started: 0 });
    expect(await story()).toEqual(source);
  });

  test("a sub-agent's dropped writes are gone and the lead's stay, and no later turn puts them back", async () => {
    await at(["t1"]);
    await agentWrites("t1", "ada.md", write("Ada distrusts the guard.\n"));
    await at(["t1", "t2"]);
    await agentWrites("t2", "plan.md", write("The lead's plan.\n"));
    await agentWrites("t2", "clue.md", write("The GM's clue.\n"), SUB);
    await agentWrites("t2", "ada.md", write("Ada, as the GM had her.\n"), SUB);

    expect(await notes.drop(USER, CHAT, "t2", SUB.id)).toEqual({ undone: 2, redone: 0, kept: [], started: 0 });
    expect(await story()).toEqual({ "ada.md": "Ada distrusts the guard.\n", "plan.md": "The lead's plan.\n" });
    expect(await at(["t1", "t2", "t3"])).toEqual({ undone: 0, redone: 0, kept: [], started: 0 });
    expect(await story()).toEqual({ "ada.md": "Ada distrusts the guard.\n", "plan.md": "The lead's plan.\n" });
  });
});

// Retention (plan §5.5) on a real tree in a temporary folder, for a chat with more turn folders than its
// setting keeps whole: the newest are kept whole; each older one keeps its `turn.json`, `output/` and
// `transcripts/` and loses the rest; session files, and the folder of a turn going on, are not touched.
// Every name and text is invented.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { KIT_SEED } from "rp-harness/testing/kit";
import { pruneChat, RETENTION_DEFAULTS, retentionOf } from "../../src/tree/index";
import { type LaidTree, layTree } from "./fixtures";

const USER = KIT_SEED.scope.user;
const CHAT = KIT_SEED.scope.chat;

/** A turn folder's files as a turn leaves them. */
const TURN_FILES = ["turn.json", "assembled-preset-prompt.md", "briefing.md", "world-state.md", "cast/ada/base.md", "previous-attempts/1.md", "scratch/scene.md", "queries/q1.md", "output/reply.md", "transcripts/author-1.jsonl"];
const KEPT = ["output/reply.md", "transcripts/author-1.jsonl", "turn.json"];

describe("retention", () => {
  let place: string;
  let tree: LaidTree;

  beforeEach(async () => {
    place = await mkdtemp(join(tmpdir(), "rpe-retention-"));
    tree = await layTree(KIT_SEED, place);
  });

  afterEach(async () => {
    await tree.close();
    await rm(place, { recursive: true, force: true });
  });

  const chatDir = (): string => tree.levelDir("chat");

  async function filesBelow(folder: string): Promise<string[]> {
    const found = await readdir(folder, { recursive: true, withFileTypes: true });
    return found
      .filter((d) => d.isFile())
      .map((d) => relative(folder, join(d.parentPath, d.name)))
      .sort();
  }

  /** Six turn folders in two sessions, begun an hour apart, oldest first; and each session's own files. */
  async function sixTurns(): Promise<string[]> {
    const folders: string[] = [];
    const start = Date.now() - 10 * 3_600_000;
    for (let n = 1; n <= 6; n++) {
      const session = n <= 3 ? "s-1" : "s-2";
      const folder = join(chatDir(), "sessions", session, "turns", `turn-${n}-abc${n}`);
      for (const f of TURN_FILES) {
        await mkdir(dirname(join(folder, f)), { recursive: true });
        await writeFile(join(folder, f), `${f} of turn ${n}\n`);
      }
      const begun = new Date(start + n * 3_600_000);
      await utimes(join(folder, "turn.json"), begun, begun);
      folders.push(folder);
    }
    for (const session of ["s-1", "s-2"]) {
      await writeFile(join(chatDir(), "sessions", session, `${session}.jsonl`), "{}\n");
      await mkdir(join(chatDir(), "sessions", session, "cache"), { recursive: true });
      await writeFile(join(chatDir(), "sessions", session, "cache", "c.json"), "{}\n");
    }
    return folders;
  }

  test("the newest turn folders are kept whole, the older keep their record, output and transcripts, and session files stay", async () => {
    const folders = await sixTurns();
    await writeFile(join(chatDir(), "RPE.yml"), "retention:\n  turnFolders: 3\n");
    expect(await retentionOf({ files: tree.files, character: tree.folders.character, chat: tree.folders.chat })).toEqual({ turnFolders: 3 });

    const pruned = await pruneChat({ files: tree.files, chats: tree.chats }, USER, CHAT);
    expect(pruned.folders).toBe(3);
    expect(pruned.files).toBe(3 * (TURN_FILES.length - KEPT.length));
    for (const folder of folders.slice(0, 3)) expect(await filesBelow(folder)).toEqual(KEPT);
    for (const folder of folders.slice(3)) expect(await filesBelow(folder)).toEqual([...TURN_FILES].sort());
    for (const session of ["s-1", "s-2"]) expect(await filesBelow(join(chatDir(), "sessions", session, "cache"))).toEqual(["c.json"]);
    expect((await readdir(join(chatDir(), "sessions", "s-1"))).sort()).toEqual(["cache", "s-1.jsonl", "turns"]);

    // Again: nothing more to take.
    expect(await pruneChat({ files: tree.files, chats: tree.chats }, USER, CHAT)).toEqual({ folders: 0, files: 0, bytes: 0 });
  });

  test("a turn going on keeps its folder whole however old, and with no setting the plan's number is kept", async () => {
    const folders = await sixTurns();
    expect(await retentionOf({ files: tree.files, character: tree.folders.character, chat: tree.folders.chat })).toEqual({ turnFolders: RETENTION_DEFAULTS.turnFolders });
    expect((await pruneChat({ files: tree.files, chats: tree.chats }, USER, CHAT)).folders).toBe(0);

    await writeFile(join(chatDir(), "RPE.yml"), "retention:\n  turnFolders: 0\n");
    const pruned = await pruneChat({ files: tree.files, chats: tree.chats }, USER, CHAT, new Set(["turn-1-abc1"]));
    expect(pruned.folders).toBe(5);
    expect(await filesBelow(folders[0] ?? "")).toEqual([...TURN_FILES].sort());
    expect(await filesBelow(folders[5] ?? "")).toEqual(KEPT);
  });
});

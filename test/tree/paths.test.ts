// Where RPE's tree differs from the kit's picture: the shipped level is a folder inside the global
// level (`defaults/`), and a chat's folder sits beside its character's other chats, inside the
// character's level, under the global level's `chats/`. From one chat, none of these, nor another
// user's anything, is reached or written by a path spelt in another case, with `..`, through a link,
// or with a letter that folds to another on a disk that ignores case.

import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentRef, FileOp, Scope } from "rp-harness/contract";
import { KIT_SEED } from "rp-harness/testing/kit";
import { CHATS_FOLDER } from "../../src/tree/index";
import { type LaidTree, layTree } from "./fixtures";

const scope = KIT_SEED.scope;
const agent: AgentRef = { id: "kit-agent-1", definition: "kit-scribe", parent: "kit-lead" };
const OPS: FileOp[] = [{ op: "write", text: "overwritten\n" }, { op: "append", text: "added\n" }, { op: "edit", old: "e", new: "E", all: true }, { op: "delete" }];
const SECRET = "The vault opens to the word quillfeather.\n";

/** A name as a disk that ignores case may also find it: upper case, and each `s` and `k` as the letters that fold to them (ſ, the Kelvin sign). */
function spellings(name: string): string[] {
  return [name, name.toUpperCase(), name.replace(/s/g, "\u017F"), name.replace(/k/g, "\u212A")].filter((s, i, all) => all.indexOf(s) === i);
}

describe("RPE's tree keeps a chat to its own view", () => {
  let place: string;
  let tree: LaidTree;
  /** A second chat of the same character, and a chat of another character, each holding a secret note. */
  let sibling: { folder: string; disk: string };
  let stranger: { character: string; folder: string; disk: string };

  beforeEach(async () => {
    place = await mkdtemp(join(tmpdir(), "rpe-tree-"));
    tree = await layTree(KIT_SEED, place);
    const near = await tree.chats.place(scope.user, "kit-chat-2", { character: { id: "kit-wren", name: "Wren Alder" }, chat: { name: "Sea Glass" } });
    const far = await tree.chats.place(scope.user, "kit-chat-3", { character: { id: "kit-orrin", name: "Orrin Vale" }, chat: { name: "Salt Road" } });
    sibling = { folder: near.chat, disk: join(tree.files, CHATS_FOLDER, near.character, near.chat) };
    stranger = { character: far.character, folder: far.chat, disk: join(tree.files, CHATS_FOLDER, far.character, far.chat) };
    for (const disk of [sibling.disk, stranger.disk]) await Bun.write(join(disk, "persistent-workspace", "vault.md"), SECRET);
  });

  afterEach(async () => {
    await tree.close();
    await rm(place, { recursive: true, force: true });
  });

  /** Every way the kit's chat might spell its way into the other two chats' notes. */
  function intoOtherChats(): string[] {
    const own = tree.folders.character;
    const paths: string[] = [];
    for (const chat of spellings(sibling.folder)) {
      paths.push(`@character/${chat}/persistent-workspace/vault.md`);
      for (const chats of spellings(CHATS_FOLDER)) paths.push(`@global/${chats}/${own}/${chat}/persistent-workspace/vault.md`);
    }
    for (const character of spellings(stranger.character)) {
      for (const chats of spellings(CHATS_FOLDER)) paths.push(`@global/${chats}/${character}/${stranger.folder}/persistent-workspace/vault.md`);
      paths.push(`@character/../../${character}/${stranger.folder}/persistent-workspace/vault.md`);
    }
    paths.push(`../${sibling.folder}/persistent-workspace/vault.md`, `persistent-workspace/../../${sibling.folder}/persistent-workspace/vault.md`, `@character/${sibling.folder}/../${sibling.folder}/persistent-workspace/vault.md`);
    return paths;
  }

  test("another chat's notes, by any spelling, are not read, found or written", async () => {
    for (const path of intoOtherChats()) {
      const read = await tree.port.read(scope, path);
      expect({ path, text: read.status === "read" ? read.text : null }).toEqual({ path, text: null });
      for (const op of OPS) {
        const result = await tree.port.write(scope, path, op, agent);
        expect({ path, op: op.op, status: result.status }).toEqual({ path, op: op.op, status: "refused" });
      }
    }
    for (const at of ["@character/", "@global/", ...spellings(CHATS_FOLDER).map((c) => `@global/${c}`), ...spellings(sibling.folder).map((c) => `@character/${c}`)]) {
      for (const query of [{ by: "list", depth: 6 }, { by: "glob", pattern: "**/*" }, { by: "grep", pattern: "quillfeather" }] as const) {
        const found = await tree.port.find(scope, { ...query, path: at });
        const paths = found.status === "found" ? found.hits.map((h) => h.path) : [];
        expect({ at, by: query.by, leaked: paths.filter((p) => p.includes("vault") || p.includes(sibling.folder) || p.includes(stranger.folder)) }).toEqual({ at, by: query.by, leaked: [] });
      }
    }
    // The character's level shows its own files and guidance folders only.
    const character = await tree.port.find(scope, { by: "list", path: "@character/" });
    expect(character.status === "found" ? character.hits.map((h) => h.path) : character).toEqual(["@character/AGENTS.md"]);
    for (const disk of [sibling.disk, stranger.disk]) expect(await readFile(join(disk, "persistent-workspace", "vault.md"), "utf8")).toBe(SECRET);
    // The other chat keeps its secret to itself, and its own scope reads it.
    expect(await tree.port.read({ ...scope, chat: "kit-chat-2" }, "persistent-workspace/vault.md")).toMatchObject({ status: "read", text: SECRET });
    expect(await tree.port.read({ ...scope, chat: "kit-chat-2" }, "persistent-workspace/story/threads.md")).toEqual({ status: "missing", path: "persistent-workspace/story/threads.md" });
  });

  test("a link in the chat's notes to another chat or to the shipped level is not followed, either way", async () => {
    await symlink(sibling.disk, join(tree.levelDir("chat"), "persistent-workspace", "sibling"));
    await symlink(tree.levelDir("shipped"), join(tree.levelDir("chat"), "persistent-workspace", "shipped"));
    await symlink(join(tree.levelDir("shipped"), "TURN.md"), join(tree.levelDir("chat"), "persistent-workspace", "turn.md"));
    for (const path of ["persistent-workspace/sibling/persistent-workspace/vault.md", "persistent-workspace/shipped/TURN.md", "persistent-workspace/turn.md", "persistent-workspace/sibling/planted.md"]) {
      expect({ path, read: await tree.port.read(scope, path) }).toMatchObject({ read: { status: "refused", reason: "link" } });
      for (const op of OPS) expect({ path, op: op.op, write: await tree.port.write(scope, path, op, agent) }).toMatchObject({ write: { status: "refused", reason: "link" } });
    }
    const grep = await tree.port.find(scope, { by: "grep", pattern: "quillfeather|shipped turn" });
    expect(grep).toEqual({ status: "found", hits: [] });
    expect(await stat(join(sibling.disk, "planted.md")).catch(() => null)).toBeNull();
    expect(await readFile(join(tree.levelDir("shipped"), "TURN.md"), "utf8")).toBe("The shipped turn guidance.\n");
  });

  test("the shipped level is read at its mount alone, never written, and its files are read-only on disk", async () => {
    expect(await tree.port.read(scope, "@shipped/TURN.md")).toMatchObject({ status: "read", level: "shipped", text: "The shipped turn guidance.\n" });
    for (const defaults of spellings("defaults")) {
      for (const path of [`@global/${defaults}/TURN.md`, `@global/${defaults}/.agents/narrator.md`]) {
        const read = await tree.port.read(scope, path);
        expect({ path, text: read.status === "read" ? read.text : null }).toEqual({ path, text: null });
        for (const op of OPS) {
          const result = await tree.port.write(scope, path, op, "harness");
          expect({ path, op: op.op, status: result.status }).toEqual({ path, op: op.op, status: "refused" });
        }
      }
    }
    for (const path of ["@shipped/TURN.md", "@shipped/.agents/narrator.md", "@shipped/kit-new.md", "@shipped/.rules/kit-new.md", "@shipped/../@shipped/TURN.md"]) {
      for (const by of [agent, "harness"] as const) {
        for (const op of OPS) expect({ path, op: op.op, write: await tree.port.write(scope, path, op, by) }).toMatchObject({ write: { status: "refused", reason: "mounted" } });
      }
    }
    expect(await readFile(join(tree.levelDir("shipped"), "TURN.md"), "utf8")).toBe("The shipped turn guidance.\n");
    expect(await stat(join(tree.levelDir("shipped"), "kit-new.md")).catch(() => null)).toBeNull();
    expect((await stat(join(tree.levelDir("shipped"), "TURN.md"))).mode & 0o222).toBe(0);
  });

  test("another user's scope, however its name is spelt, reaches nothing", async () => {
    for (const user of ["kit-other-user", "KIT-USER", "Kit-User", "kit-u\u017Fer", "\u212Ait-user", "kit-user ", ""]) {
      const foreign: Scope = { ...scope, user };
      for (const call of [
        () => tree.port.read(foreign, "AGENTS.md"),
        () => tree.port.read(foreign, "persistent-workspace/story/threads.md"),
        () => tree.port.find(foreign, { by: "grep", pattern: "." }),
        () => tree.port.find(foreign, { by: "list", depth: 6 }),
        () => tree.port.write(foreign, "persistent-workspace/planted.md", { op: "write", text: "x" }, agent),
        () => tree.port.places(foreign),
        () => tree.port.layers(foreign),
      ]) {
        await expect(call()).rejects.toThrow(/belongs to the Lumiverse user/);
      }
    }
    expect(await stat(join(tree.levelDir("chat"), "persistent-workspace", "planted.md")).catch(() => null)).toBeNull();
  });
});

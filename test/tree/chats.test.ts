// Which character level a chat sits in: one folder per character, kept when the character is
// renamed, and never shared by two characters whose names and ids' first letters agree (a card
// imported with an id of its own, `character-0001` and `character-0002`, has such ids).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { KIT_SEED } from "rp-harness/testing/kit";
import { type LaidTree, layTree } from "./fixtures";

const user = KIT_SEED.scope.user;
let place: string;
let tree: LaidTree;

beforeEach(async () => {
  place = await mkdtemp(join(tmpdir(), "rpe-chats-"));
  tree = await layTree(KIT_SEED, place);
});

afterEach(async () => {
  await tree.close();
  await rm(place, { recursive: true, force: true });
});

test("a character renamed keeps its level: its next chat sits beside the earlier ones and reads the same character files", async () => {
  const first = await tree.chats.place(user, "chat-a", { character: { id: "character-orrin", name: "Orrin" }, chat: { name: "Harbor" } });
  const renamed = await tree.chats.place(user, "chat-b", { character: { id: "character-orrin", name: "Orrin Vale" }, chat: { name: "Cliffs" } });
  expect(renamed.character).toBe(first.character);
  await Bun.write(join(tree.files, "chats", first.character, "AGENTS.md"), "Orrin keeps the lamp.\n");
  expect(await tree.port.read({ ...KIT_SEED.scope, chat: "chat-b" }, "@character/AGENTS.md")).toMatchObject({ status: "read", text: "Orrin keeps the lamp.\n" });
});

test("two characters of one name whose ids begin alike get a level each, and neither reads the other's files", async () => {
  const one = await tree.chats.place(user, "chat-1", { character: { id: "character-0001", name: "Wren" }, chat: { name: "Tide" } });
  const two = await tree.chats.place(user, "chat-2", { character: { id: "character-0002", name: "Wren" }, chat: { name: "Tide" } });
  expect(two.character).not.toBe(one.character);
  await Bun.write(join(tree.files, "chats", one.character, "AGENTS.md"), "The first Wren's own guidance.\n");
  expect(await tree.port.read({ ...KIT_SEED.scope, chat: "chat-2" }, "@character/AGENTS.md")).toEqual({ status: "missing", path: "@character/AGENTS.md" });
  // Placing again finds the same folders.
  expect(await tree.chats.place(user, "chat-3", { character: { id: "character-0002", name: "Wren" }, chat: { name: "Shore" } })).toMatchObject({ character: two.character });
});

test("a chat with no character is a level of its own, never a character's of the same name and id's first letters", async () => {
  const lone = await tree.chats.place(user, "chat-w", { character: { id: "lone-00011", name: "Lone" }, chat: { name: "Watch" } });
  const alone = await tree.chats.place(user, "lone-00012", { character: null, chat: { name: "Lone" } });
  expect(alone.character).not.toBe(lone.character);
});

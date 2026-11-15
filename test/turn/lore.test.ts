// The lore index in the turn (plan §9.1 to §9.3): an indexing run the Author delegates to is given the
// next batch of the chat's lore by the name its definition lists (`index:batch`), keeps its lines with
// `lore_index_write`, and is answered with the batch after; the Author marks an entry the story has moved
// past with `story_record`'s overlay; and the next turn's briefing holds the lore map in full, each entry
// worded by the lore's lines. Played through the stand-in Lumiverse on the scripted model, on a chat that
// plays an invented world whose player's character is Wren. Every name and text is invented.

import { afterEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRef } from "rp-harness/contract";
import type { RecordedRequest } from "rp-harness/testing/rig";
import { addCharacter } from "../../src/cast";
import { CHATS_FOLDER } from "../../src/tree";
import { world } from "../iface/rig";
import { coastWorld } from "../lore/fixtures";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

let bed: TurnBed | null = null;
afterEach(async () => {
  await bed?.close();
  bed = null;
});

const BOOK = { id: "wb-keep", name: "Keeper's Book" };
const OIL = { id: "wbe-oil", title: "The oil store", keys: ["oil"], content: "Whale oil is kept in the cellar under the lamp room, six barrels." };
const OATH = { id: "wbe-oath", title: "The courier's oath", keys: ["oath"], content: "Every courier of the vale swears to carry a sealed letter unopened." };
const BELL = { id: "wbe-bell", title: "The market bell", keys: ["bell"], content: "The market bell rings at dawn and at curfew, never between." };

/** Every text a request holds, its messages' in order. */
function textsOf(r: RecordedRequest | undefined): string {
  return (r?.messages ?? []).flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])))).join("\n");
}

/** The id and the revision the batch shows an entry by: `### [e-1] The oil store (from Keeper's Book; revision 1; …)`. */
function shownOf(batch: string, title: string): { id: string; revision: string } {
  const shown = new RegExp(`### \\[(e-\\d+)\\] ${title} \\(from [^;]+; revision (\\d+)`).exec(batch);
  if (shown?.[1] === undefined || shown[2] === undefined) throw new Error(`the batch does not show ${title}`);
  return { id: shown[1], revision: shown[2] };
}

/** The player says something and asks for a reply; gives the turn's id once it is settled. */
async function play(b: TurnBed, said: string): Promise<string> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

test("an indexing run is given the next batch by name and answered with the batch after; the next briefing holds the lore map in full", async () => {
  const ids: Record<string, string> = {};
  const b = (bed = await openTurnBed({
    answers: [
      { pieces: [{ text: "<intent>Have the keeper's book indexed first.</intent>" }, { call: "delegate", args: { agent: "indexer", brief: "Index the batch you are given." } }] },
      // The indexer keeps the lines of two of the three entries it was given, each for the revision its batch showed.
      (request) => {
        const given = textsOf(request);
        const [oil, oath, bell] = [OIL, OATH, BELL].map((e) => shownOf(given, e.title));
        ids.oil = oil?.id ?? "";
        ids.oath = oath?.id ?? "";
        ids.bell = bell?.id ?? "";
        const entries = [
          { id: ids.oil, revision: oil?.revision, kind: "place", line: "Where the lamp oil is kept.", defines: [{ what: "the oil store", aspect: "layout" }], related: [] },
          { id: ids.oath, revision: oath?.revision, kind: "rule", line: "What every courier swears.", defines: [{ what: "Wren", aspect: "background" }], related: [] },
        ];
        return { pieces: [{ call: "lore_index_write", args: { entries } }] };
      },
      { pieces: [{ text: "Two entries indexed." }] },
      () => ({ pieces: [{ call: "story_record", args: { operations: [{ op: "overlay", entry: ids.oil ?? "", text: "The flood moved the barrels to the boathouse." }] } }] }),
      replying("Wren points down the stairs."),
      replying("Wren lifts the lamp toward the boathouse."),
    ],
  }));
  await playsWorld(b, world());
  b.db.run("INSERT INTO world_books (id, name, user_id) VALUES (?, ?, ?)", BOOK.id, BOOK.name, USER);
  for (const [i, e] of [OIL, OATH, BELL].entries()) {
    b.db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment) VALUES (?, ?, ?, ?, ?, ?)", e.id, BOOK.id, String(i + 1), JSON.stringify(e.keys), e.content, e.title);
  }
  b.db.run("UPDATE chats SET metadata = ? WHERE id = ?", JSON.stringify({ chat_world_book_ids: [BOOK.id] }), CHAT);

  await play(b, "I ask where the oil is kept.");
  const [author, indexer, answered] = b.model.requests;
  // Nothing was indexed yet: the Author's map shows the oil store by its keys, and counts what no run has indexed.
  expect(textsOf(author)).toContain(`- [${ids.oil}] The oil store (not indexed yet; keys: oil)`);
  expect(textsOf(author)).toContain("3 attached entries are not indexed yet.");
  // The indexer is given every entry with its revision, Lumiverse's own (a new entry's is 1), and its text; the tool answers with what it kept, then the one entry left, with its text.
  expect(textsOf(indexer)).toContain(`### [${ids.oil}] The oil store (from Keeper's Book; revision 1; keys: oil)\n${OIL.content}`);
  const answer = textsOf(answered === undefined ? undefined : { ...answered, messages: answered.messages.slice(-1) });
  expect(answer).toContain("Kept the lines of 2 entries. 1 entries are not indexed yet.");
  expect(answer).toContain(`### [${ids.bell}] The market bell (from Keeper's Book; revision 1; keys: bell)\n${BELL.content}`);
  expect(answer).not.toContain(OIL.content);
  expect(await b.turns.facts.read({ user: USER, chat: CHAT, session: "none" }, ["lore.unindexed"])).toEqual({ "lore.unindexed": { count: 1 } });
  const folders = b.turns.chats.folders(USER, CHAT)!;
  expect(await readFile(join(b.app.paths.files, CHATS_FOLDER, folders.character, folders.chat, "LORE-INDEX.md"), "utf8")).toContain(`- [${ids.oil}] The oil store (Keeper's Book; keyword; 65 characters): place. Where the lamp oil is kept.`);

  await play(b, "I go down to see the oil for myself.");
  const map = textsOf(b.model.requests.at(-1));
  expect(map).toContain(`### In the prompt\n\n- [${ids.oil}] The oil store (place): Where the lamp oil is kept. Defines the oil store (layout).`);
  expect(map).toContain(`### Changed by the story\n\n- [${ids.oil}] The oil store: The flood moved the barrels to the boathouse.`);
  expect(map).toContain(`### Not in the prompt, but bound to who and what is at hand\n\n- [${ids.oath}] The courier's oath (rule): What every courier swears. Bound to Wren.`);
  expect(map).toContain("1 attached entries are not indexed yet.");
});

test("a character's agent started with the cast's id for its character reads the lore that character may know, and no one else's", async () => {
  const b = (bed = await openTurnBed({ answers: [] }));
  // The coast's crown is a secret Orrin holds; the cast knows him by his full name, under an id of its own.
  await playsWorld(b, coastWorld());
  const [orrin, tobin] = await b.app.writes.run((db) => [addCharacter(db, USER, CHAT, "Orrin Pell", 1).id, addCharacter(db, USER, CHAT, "Tobin Reed", 2).id]);
  const scope = { user: USER, chat: CHAT, session: "none" };
  const reader = (plays: string): AgentRef => ({ id: "character-1", definition: "character", plays });
  // A world entry's id is given the first time RPE sees it: the lead reads every entry, so its search finds it.
  const crown = [(await b.turns.env.lore!.search(scope, { text: "crown" }, { id: "lead-1", definition: "lead" })).find((h) => h.title === "The drowned crown")?.id ?? ""];
  // Through the lore RPH reads for an agent: its `lore:` attachment and its lore tools.
  expect((await b.turns.env.lore!.read(scope, crown, reader(orrin))).map((e) => e.id)).toEqual(crown);
  expect((await b.turns.env.lore!.search(scope, { text: "crown" }, reader(orrin))).map((e) => e.id)).toEqual(crown);
  expect(await b.turns.env.lore!.read(scope, crown, reader(tobin))).toEqual([]);
});

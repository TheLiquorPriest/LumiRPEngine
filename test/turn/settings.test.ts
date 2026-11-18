// The areas' settings reach what they limit (plan Appendix D.1): a value a chat's own `RPE.yml` sets
// holds at that chat's next turn, in the world state of its briefing and in the answers of the
// engine's, the cast's and the story's tools; a value the global file sets is read when RPE starts, by
// what is made once for every chat: the store's snapshots, the lore's searches and its index's batches,
// and the story's facts. Played through the stand-in Lumiverse on the scripted model. Every name and
// text is invented.

import { afterEach, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { RecordedRequest } from "rp-harness/testing/rig";
import { NO_SESSION } from "../../src/turn";
import { world } from "../iface/rig";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(options: TurnBedOptions): Promise<TurnBed> {
  // The reminder of writes that name no source would ask for calls these tests do not script.
  const b = await openTurnBed({ off: ["rules/unsourced"], ...options });
  beds.push(b);
  return b;
}

/** The player says something and asks for a reply; gives the turn once it is settled. */
async function play(b: TurnBed, said: string) {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return await settledTurn(b, out.generationId!);
}

/** Sets a setting at the chat's own level through the Settings page's route, as the player would. */
async function setForChat(b: TurnBed, key: string, value: number): Promise<void> {
  const token = (await b.app.auth.mintPageToken(USER, "extension")).token;
  const res = await fetch(`${b.listening.url}/api/v1/settings`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ level: "chat", chat: CHAT, key, value }),
  });
  expect(res.status).toBe(200);
}

/** What each tool answered the calls just before `request`, by the tool's name: its data, and its other lines. */
function answers(request: RecordedRequest | undefined): Record<string, { data: JsonObject; lines: string[] }> {
  const messages = request?.messages ?? [];
  const from = messages.findLastIndex((m) => m.role === "assistant");
  const out: Record<string, { data: JsonObject; lines: string[] }> = {};
  for (const m of messages.slice(from + 1)) {
    if (m.role !== "toolResult") continue;
    const parts = m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n").split("\n");
    const at = parts.findIndex((line) => line.startsWith("{"));
    out[m.toolName] = { data: JSON.parse(parts[at] ?? "{}") as JsonObject, lines: parts.filter((_, i) => i !== at) };
  }
  return out;
}

/** The world state in a request's briefing. */
function worldStateOf(b: TurnBed, n: number): string {
  return b.requests[n]?.briefing.find((block) => block.name === "world-state")?.text ?? "";
}

/** The calls that read what the engine, the cast and the story hold, made at once. */
const READS: { call: string; args: JsonObject }[] = [
  { call: "world_search", args: { words: "Tam Bram" } },
  { call: "cast_query", args: { who: "Wren Hale", part: "history" } },
  { call: "story_query", args: {} },
];

test("what a chat's own RPE.yml sets holds at its next turn: the world state is measured by its budget, and the engine's, the cast's and the story's tools answer with as many as it allows", async () => {
  const b = await bed({
    off: ["rules/unsourced", "rules/turn-unrecorded", "rules/perceptions-missing", "rules/perceptions-owed"],
    answers: [
      {
        pieces: [
          { text: "<intent>Wren keeps the light; the night goes on.</intent>" },
          { call: "cast_update", args: { operations: [{ op: "cast", who: "Wren Hale", as: "principal" }, { op: "history", who: "Wren Hale", text: "She lit the lamp in the great storm." }, { op: "history", who: "Wren Hale", text: "She rowed out for the Mary Bell." }] } },
          { call: "story_record", args: { operations: [{ op: "beat", text: "The lamp is lit." }, { op: "beat", text: "A gull lands on the rail." }] } },
        ],
      },
      { pieces: READS },
      replying("The lamp turns."),
      { pieces: [{ text: "<intent>The watch goes on.</intent>" }, ...READS] },
      replying("Wren trims the wick."),
    ],
  });
  await playsWorld(b, world());
  await play(b, "I climb the stairs.");
  const before = answers(b.model.requests[2]);

  await setForChat(b, "worldState.tokens", 40);
  await setForChat(b, "engine.searchHits", 1);
  await setForChat(b, "cast.queryItems", 1);
  await setForChat(b, "story.queryItems", 1);
  await play(b, "I watch the sea.");
  const after = answers(b.model.requests[4]);

  expect(worldStateOf(b, 1).length).toBeLessThan(worldStateOf(b, 0).length);
  expect(worldStateOf(b, 1)).toContain("left out to keep the world state within its budget");
  expect(worldStateOf(b, 0)).not.toContain("left out to keep the world state within its budget");

  expect((before.world_search?.data.hits as JsonObject[]).map((h) => h.name)).toEqual(["Bram", "Tam"]);
  expect((after.world_search?.data.hits as JsonObject[]).map((h) => h.name)).toEqual(["Bram"]);

  expect((before.cast_query?.data.history as JsonObject[]).map((h) => h.text)).toEqual(["She lit the lamp in the great storm.", "She rowed out for the Mary Bell."]);
  expect((after.cast_query?.data.history as JsonObject[]).map((h) => h.text)).toEqual(["She lit the lamp in the great storm."]);
  expect(after.cast_query?.lines).toEqual(["1 more in history. Ask again with skip 1 to see them."]);

  expect((before.story_query?.data.beat as JsonObject[]).map((h) => h.text)).toEqual(["The lamp is lit.", "A gull lands on the rail."]);
  expect((after.story_query?.data.beat as JsonObject[]).map((h) => h.text)).toEqual(["The lamp is lit."]);
  expect(after.story_query?.lines[0]).toStartWith("1 more match.");
});

const BOOK = { id: "wb-keep", name: "Keeper's Book" };
const ENTRIES = [
  { id: "wbe-oil", title: "The oil store", keys: ["oil"], content: "Whale oil is kept in the cellar under the lamp room, six barrels." },
  { id: "wbe-oath", title: "The courier's oath", keys: ["oath"], content: "Every courier of the vale swears to carry a sealed letter unopened." },
  { id: "wbe-bell", title: "The market bell", keys: ["bell"], content: "The market bell rings at dawn and at curfew, never between." },
];

test("what the global file sets is read when RPE starts, by what is made once for every chat: the store's snapshots, the lore's searches and its index's batches, and the story's facts", async () => {
  const b = await bed({
    global: ["store:", "  snapshotEvery: 1", "lore:", "  search:", "    hits: 1", "  index:", "    entriesPerCall: 1", "story:", "  ahead: 0", "history:", "  window: 1", ""].join("\n"),
    answers: [replying("The lamp turns.")],
  });
  b.db.run("INSERT INTO world_books (id, name, user_id) VALUES (?, ?, ?)", BOOK.id, BOOK.name, USER);
  for (const [i, e] of ENTRIES.entries()) b.db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment) VALUES (?, ?, ?, ?, ?, ?)", e.id, BOOK.id, String(i + 1), JSON.stringify(e.keys), e.content, e.title);
  b.db.run("UPDATE chats SET metadata = ? WHERE id = ?", JSON.stringify({ chat_world_book_ids: [BOOK.id] }), CHAT);
  const turn = await play(b, "I ask about the oil, the oath and the bell.");
  const scope = { user: USER, chat: CHAT, session: NO_SESSION, turn: turn.id };

  // The chat's state is kept at its first turn, which it is not at the shipped 25.
  expect(b.app.db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM snapshot WHERE user = ? AND kind = 'cache'").get(USER)?.n).toBe(1);
  // A search that names no number gives one hit, though all three entries match; an indexing run is given one entry at a time.
  expect(await b.turns.env.lore?.search(scope, { text: "oil oath bell" }, { id: "lead", definition: "author" })).toHaveLength(1);
  expect((await b.turns.loreIndex.batch({ user: USER, chat: CHAT })).entries).toHaveLength(1);
  // With the window at one message and the chat taken to grow by none before the next prompt, nothing is about to leave it.
  expect(await b.turns.facts.read(scope, ["history.leaving.uncovered"])).toEqual({ "history.leaving.uncovered": { count: 0 } });
});

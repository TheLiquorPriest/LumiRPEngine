// The turn's folder (plan §5.3), played through the stand-in Lumiverse: at the start of every turn RPE
// writes what the Author is shown as files for the agents it delegates to, each laid out by its prompt
// part, and an agent cannot write them. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { FileRead, Scope } from "rp-harness/contract";
import { KIT_AGENT } from "rp-harness/testing/kit";
import { TURN_FILES } from "../../src/turn/folder";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  return b;
}

const CARD = "Wren Hale keeps the Gannet Rock light. She is fifty, wiry, and trusts no barometer.";
const PERSONA = "Marlow is the relief keeper, new to the rock and afraid of heights.";

/** The preset as Lumiverse holds it: a block with no marker, the character's description and the persona's, each by Lumiverse's own marker. */
function presetWithCard(b: TurnBed): void {
  const blocks = [
    { id: "b-main", name: "Main", role: "system" as const, content: "You narrate a lighthouse on Gannet Rock, one scene at a time.", marker: null },
    { id: "b-card", name: "Wren's card", role: "system" as const, content: CARD, marker: "char_description" },
    { id: "b-persona", name: "Who you are", role: "system" as const, content: PERSONA, marker: "persona_description" },
  ];
  b.host.presets.set(PRESET, { id: PRESET, name: "Lamp", blocks: blocks.map(({ marker: _, ...block }) => block) });
  b.db.run("INSERT INTO presets (id, name, provider, prompt_order, user_id) VALUES (?, ?, ?, ?, ?)", PRESET, "Lamp", "custom", JSON.stringify(blocks), USER);
}

async function play(b: TurnBed, type: "normal" | "swipe", said?: string): Promise<string> {
  if (said !== undefined) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type });
  expect(out.error).toBeNull();
  return out.generationId!;
}

/** The turn's scope and its folder's path in the agents' view. */
async function folderOf(b: TurnBed, turn: string): Promise<{ scope: Scope & { turn: string }; folder: string }> {
  const session = b.turns.runs.record(USER, turn)?.session ?? "";
  const scope = { user: USER, chat: CHAT, session, turn };
  return { scope, folder: (await b.turns.files.places(scope)).turn ?? "" };
}

async function text(b: TurnBed, scope: Scope, path: string): Promise<string> {
  const read: FileRead = await b.turns.files.read(scope, path);
  if (read.status !== "read") throw new Error(`${path} was not written: ${read.status}`);
  return read.text;
}

function inOrder(whole: string, parts: readonly string[]): void {
  const at = parts.map((p) => whole.indexOf(p));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((x, y) => x - y)).toEqual(at);
}

describe("the turn's folder", () => {
  test("holds the prompt, the history it keeps, the persona and the character as it has them, the briefing and turn.json, none of which an agent may write", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren points at the stairs.")], global: "history:\n  window: 2\n" });
    presetWithCard(b);
    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const turn = await settledTurn(b, await play(b, "normal", "I ask where the oil is kept."));
    const { scope, folder } = await folderOf(b, turn.id);
    const messages = b.host.chats.get(CHAT)!.messages;
    const [greeting, said, reply, asked] = messages;

    // Every message the prompt held, in order, with its role: the preset's blocks, then the history the window kept.
    const prompt = await text(b, scope, `${folder}${TURN_FILES.prompt}`);
    inOrder(prompt, ["Message 1, system", "You narrate a lighthouse", CARD, PERSONA, "The lamp turns.", "I ask where the oil is kept."]);
    expect(prompt).not.toContain("I climb the stairs.");

    // The history in the prompt, by the chat's places, ids and speakers, and the stretch the window left out.
    const history = await text(b, scope, `${folder}${TURN_FILES.history}`);
    expect(history).toContain("Messages 0 to 1 of the chat are not in the prompt.");
    inOrder(history, [`## Message 2 [${reply!.id}], Wren Hale`, "The lamp turns.", `## Message 3 [${asked!.id}], User`, "I ask where the oil is kept."]);
    expect(history).not.toContain(greeting!.id);
    expect(history).not.toContain(said!.id);

    // The card and the persona, found by Lumiverse's own markers where this prompt holds them.
    expect(await text(b, scope, `${folder}${TURN_FILES.character}`)).toBe(`# The character: Wren Hale\n\n## Wren's card\n\n${CARD}\n`);
    expect(await text(b, scope, `${folder}${TURN_FILES.persona}`)).toBe(`# The player's persona\n\n## Who you are\n\n${PERSONA}\n`);

    // The briefing as the Author's template lays out the host's part of it.
    const briefing = await text(b, scope, `${folder}${TURN_FILES.briefing}`);
    expect(briefing).toContain("# Briefing for this turn");
    expect(briefing).toContain("- This turn: new, replying as Wren Hale.");
    // The world state as the store compiles it for the chat's world (the blank one, for a chat that names none), laid out by its own part: in the briefing, and on its own.
    const state = await text(b, scope, `${folder}${TURN_FILES.worldState}`);
    expect(state.trim()).not.toBe("");
    expect(briefing).toContain(`## World state\n\n${state.trimEnd()}\n`);
    expect(JSON.stringify(b.model.requests[1])).toContain(JSON.stringify(`## World state\n\n${state.trimEnd()}`).slice(1, -1));

    const data = JSON.parse(await text(b, scope, `${folder}${TURN_FILES.turn}`)) as { turn: string; kind: string; parent: string | null; files: string[]; prompt: { leftOut: unknown } };
    expect(data).toMatchObject({ turn: turn.id, kind: "new", parent: turn.parent, prompt: { leftOut: [{ from: 0, to: 2 }] } });
    expect(data.files).toEqual([TURN_FILES.prompt, TURN_FILES.history, TURN_FILES.persona, TURN_FILES.character, TURN_FILES.worldState, TURN_FILES.briefing].map((f) => `${folder}${f}`));

    // Generated: an agent's write to any of them is refused, and changes nothing.
    for (const file of [TURN_FILES.prompt, TURN_FILES.briefing, TURN_FILES.turn]) {
      expect(await b.turns.files.write(scope, `${folder}${file}`, { op: "write", text: "overwritten\n" }, KIT_AGENT)).toMatchObject({ status: "refused", reason: "generated" });
    }
    expect(await text(b, scope, `${folder}${TURN_FILES.briefing}`)).toBe(briefing);
  });

  test("a swipe's folder holds each earlier attempt at the reply, with its intent record", async () => {
    const b = await bed({ answers: [replying("The lamp turns.", "Show the light first."), replying("Wren trims the wick.", "Show her hands."), replying("Wren hums at the brass.")] });
    const first = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const second = await settledTurn(b, await play(b, "swipe"));
    const third = await settledTurn(b, await play(b, "swipe"));
    expect([second.message, third.message]).toEqual([first.message, first.message]);

    const { scope, folder } = await folderOf(b, third.id);
    expect(await text(b, scope, `${folder}${TURN_FILES.attempts}attempt-1.md`)).toBe(`# Attempt 1 (turn ${first.id})\n\n## Its intent record\n\nShow the light first.\n\n## Its reply\n\nThe lamp turns.\n`);
    expect(await text(b, scope, `${folder}${TURN_FILES.attempts}attempt-2.md`)).toContain("Show her hands.");
    expect(await text(b, scope, `${folder}${TURN_FILES.attempts}attempt-2.md`)).toContain("Wren trims the wick.");
    // A new turn has none.
    const firstFolder = await folderOf(b, first.id);
    expect(await b.turns.files.read(firstFolder.scope, `${firstFolder.folder}${TURN_FILES.attempts}attempt-1.md`)).toMatchObject({ status: "missing" });
  });

  test("the lore file holds the lore map, then each entry that activated for the prompt, in full", async () => {
    const b = await bed({ answers: [replying("Wren points down the stairs.")] });
    const content = "Whale oil is kept in the cellar under the lamp room, six barrels, the oldest nearest the door.";
    b.host.chats.get(CHAT)!.books = [{ id: "wbe-oil", book: "wb-keep", content, comment: "The oil store", keys: ["oil"] }];
    b.db.run("INSERT INTO world_books (id, name, user_id) VALUES (?, ?, ?)", "wb-keep", "Keeper's Book", USER);
    b.db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment) VALUES (?, ?, ?, ?, ?, ?)", "wbe-oil", "wb-keep", "1", JSON.stringify(["oil"]), content, "The oil store");
    const turn = await settledTurn(b, await play(b, "normal", "I ask where the oil is kept."));

    const { scope, folder } = await folderOf(b, turn.id);
    const lore = await text(b, scope, `${folder}${TURN_FILES.lore}`);
    const id = /^- \[(e-\d+)\] The oil store$/m.exec(lore)?.[1];
    expect(id).toBeDefined();
    inOrder(lore, ["# Lore map", "### In the prompt", `- [${id}] The oil store`, `## [${id}] The oil store, from Keeper's Book, activated by keyword\n\n${content}\n`]);
  });
});

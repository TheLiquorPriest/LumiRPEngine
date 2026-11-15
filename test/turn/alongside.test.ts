// The Author starts at once, and the turn's folder follows it (plan §10.1 step 6; §4.7: "files written after
// the call starts, not before"; §5.3), played through the stand-in Lumiverse with RPE reading its rows from
// the database file, on the scripted model. What came first is told by the order the code records things in
// (the model's requests as they arrive, the folder's writes and RPE's reads of Lumiverse as they are asked
// for), never by a wait or a margin of time. And the one rule for where a generation's turn starts gives the
// point intake begins its turn at, for every kind of generation. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { Scope } from "rp-harness/contract";
import type { LumiverseReads } from "../../src/adapter/lumiverse/reads";
import type { ReplyKind } from "../../src/adapter/lumiverse/wire";
import type { TurnRow } from "../../src/store";
import { generationStart } from "../../src/turn";
import { TURN_FILES } from "../../src/turn/folder";
import { seenOf } from "../../src/turn/start";
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

/** The player says something, when given, and asks for a reply of this kind; gives the generation's id. */
async function play(b: TurnBed, type: "normal" | "swipe" | "regenerate" | "continue" | "impersonate", said?: string, persona?: string): Promise<string> {
  if (said !== undefined) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type, ...(persona !== undefined ? { persona } : {}) });
  expect(out.error).toBeNull();
  return out.generationId!;
}

/** A file of a turn's folder, as it stands. */
async function folderText(b: TurnBed, turn: TurnRow, name: string): Promise<string> {
  const scope: Scope = { user: USER, chat: CHAT, session: b.turns.runs.record(USER, turn.id)?.session ?? "", turn: turn.id };
  const read = await b.turns.files.read(scope, `${(await b.turns.files.places(scope)).turn ?? ""}${name}`);
  if (read.status !== "read") throw new Error(`${name} was not written: ${read.status}`);
  return read.text;
}

/** The files of a turn's folder that only RPE writes: the harness writes its own views of the prompt there too, and `briefing.md`. */
function rpeFolderFile(path: string): boolean {
  return [TURN_FILES.lore, TURN_FILES.worldState, TURN_FILES.turn].some((name) => path.endsWith(`/${name}`)) || path.includes(`/${TURN_FILES.attempts}`);
}

/** RPE's writes of the turn's folder, each held open until `release`: the first one asked for, with how many requests the model had been sent by then. */
function holdFolder(b: TurnBed): { first: Promise<{ path: string; requests: number }>; release(): void } {
  const files = b.turns.files;
  const write = files.write;
  const first = Promise.withResolvers<{ path: string; requests: number }>();
  const open = Promise.withResolvers<void>();
  files.write = async (scope, path, op, by) => {
    if (rpeFolderFile(path)) {
      first.resolve({ path, requests: b.model.requests.length });
      await open.promise;
    }
    return await write(scope, path, op, by);
  };
  return { first: first.promise, release: () => open.resolve() };
}

/** One read RPE made of Lumiverse: what it read, what it named, and how many requests the model had been sent by then. */
interface Read {
  what: "preset" | "persona" | "entry" | "entries" | "book";
  named: string;
  requests: number;
}

/** Every read of these kinds RPE makes of Lumiverse from now on, in order. */
function recordReads(b: TurnBed): Read[] {
  const reads: LumiverseReads = b.composition.door.lumiverse()!.reads;
  const seen: Read[] = [];
  const note = (what: Read["what"], named: string): void => {
    seen.push({ what, named, requests: b.model.requests.length });
  };
  const { preset, persona, entry, entries, book } = reads;
  reads.preset = (id) => (note("preset", id), preset(id));
  reads.persona = (id) => (note("persona", id), persona(id));
  reads.entry = (id) => (note("entry", id), entry(id));
  reads.entries = (id) => (note("entries", id), entries(id));
  reads.book = (id) => (note("book", id), book(id));
  return seen;
}

const CARD = "Wren Hale keeps the Gannet Rock light. She is fifty, wiry, and trusts no barometer.";
const PERSONA_TEXT = "The relief keeper, new to the rock and afraid of heights.";
const PERSONA = "persona-relief";

/** The preset as Lumiverse holds it: a block with no marker, the character's description and the persona's, each by Lumiverse's own marker. */
function presetWithCard(b: TurnBed): void {
  const blocks = [
    { id: "b-main", name: "Main", role: "system" as const, content: "You narrate a lighthouse on Gannet Rock, one scene at a time.", marker: null },
    { id: "b-card", name: "Wren's card", role: "system" as const, content: CARD, marker: "char_description" },
    { id: "b-persona", name: "Who you are", role: "system" as const, content: PERSONA_TEXT, marker: "persona_description" },
  ];
  b.host.presets.set(PRESET, { id: PRESET, name: "Lamp", blocks: [...blocks.map(({ marker: _, ...block }) => block), { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" }] });
  b.db.run("INSERT INTO presets (id, name, provider, prompt_order, user_id) VALUES (?, ?, ?, ?, ?)", PRESET, "Lamp", "custom", JSON.stringify(blocks), USER);
}

describe("the Author starts at once; the turn's folder follows it", () => {
  test("the first model call does not wait for the folder", async () => {
    const b = await bed({ answers: [replying("The lamp turns.")] });
    const held = holdFolder(b);
    b.host.send(CHAT, "I climb the stairs.");
    const generating = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    try {
      // The folder's first write is asked for, and held open: the Author's first request had gone out before it.
      const first = await held.first;
      expect(first.requests).toBeGreaterThanOrEqual(1);
      // With the folder still held, the reply reaches Lumiverse whole and is saved there.
      const out = await generating;
      expect(out.error).toBeNull();
      expect(b.host.chats.get(CHAT)!.messages.at(-1)?.content).toBe("The lamp turns.");
    } finally {
      held.release();
    }
    // Let go, the folder is written, and the run keeps when its writing began and ended, with no error.
    const outs = b.turns.runs.ofChatKept(USER, CHAT, 1);
    const turn = await settledTurn(b, outs[0]!.generation!);
    const run = b.turns.runs.record(USER, turn.id)!;
    expect(run.folder).toMatchObject({ error: null });
    expect(run.folder!.from).toBeGreaterThanOrEqual(run.started!);
    expect(run.folder!.to).not.toBeNull();
    expect((await folderText(b, turn, TURN_FILES.worldState)).trim()).not.toBe("");
  });

  test("a folder that cannot be written is told on the run and in the log, and the turn goes on", async () => {
    const b = await bed({ answers: [replying("The lamp turns.")] });
    const files = b.turns.files;
    const write = files.write;
    files.write = async (scope, path, op, by) => {
      if (path.endsWith(`/${TURN_FILES.worldState}`)) throw new Error("the disk is full");
      return await write(scope, path, op, by);
    };
    const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));

    expect(b.host.chats.get(CHAT)!.messages.at(-1)?.content).toBe("The lamp turns.");
    const run = b.turns.runs.record(USER, turn.id)!;
    expect(run.status).toBe("released");
    expect(run.folder?.error).toContain("the disk is full");
    expect(b.logged.some((l) => l.level === "error" && l.message === "The turn's folder could not be written in full." && l.fields?.turn === turn.id)).toBe(true);
    // The rest of the folder is written all the same, and its turn.json names what was, which is not the file that failed.
    expect(JSON.parse(await folderText(b, turn, TURN_FILES.turn)).files.some((f: string) => f.endsWith(TURN_FILES.worldState))).toBe(false);
  });

  test("nothing read for the folder before the first call", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren points at the stairs.")] });
    presetWithCard(b);
    b.db.run("INSERT INTO personas (id, name, description, user_id) VALUES (?, ?, ?, ?)", PERSONA, "Marlow Venn", PERSONA_TEXT, USER);
    // A first turn, so that Lumiverse holds the breakdown it stores with a saved reply, which names the preset's blocks.
    await settledTurn(b, await play(b, "normal", "I climb the stairs.", PERSONA));
    const reads = recordReads(b);
    const before = b.model.requests.length;
    const turn = await settledTurn(b, await play(b, "normal", "I ask where the oil is kept.", PERSONA));

    // The folder reads nothing of Lumiverse: the persona's and the character's files are the harness's views of the prompt. Nothing
    // reads the preset or the persona once this turn's first request to the Author has gone out (the door may read the preset before,
    // on receipt, for itself).
    expect(b.turns.runs.record(USER, turn.id)?.folder).toMatchObject({ error: null });
    expect(reads.filter((r) => r.requests > before && (r.what === "preset" || r.what === "persona"))).toEqual([]);
    expect(reads.filter((r) => r.requests === before && r.what === "persona")).toEqual([]);
  });

  test("the lore file is written from what intake read: no entry's text is read a second time", async () => {
    const b = await bed({ answers: [replying("Wren points down the stairs.")] });
    const content = "Whale oil is kept in the cellar under the lamp room, six barrels, the oldest nearest the door.";
    b.db.run("INSERT INTO world_books (id, name, user_id) VALUES (?, ?, ?)", "wb-keep", "Keeper's Book", USER);
    b.db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment) VALUES (?, ?, ?, ?, ?, ?)", "wbe-oil", "wb-keep", "1", JSON.stringify(["oil"]), content, "The oil store");
    // Lumiverse activates an entry only from a book the chat reads: here the chat's own.
    b.db.run("UPDATE chats SET metadata = ? WHERE id = ?", JSON.stringify({ chat_world_book_ids: ["wb-keep"] }), CHAT);
    const reads = recordReads(b);
    const turn = await settledTurn(b, await play(b, "normal", "I ask where the oil is kept."));

    // The entry in full, with its lore-map id, its book and how it activated.
    const lore = await folderText(b, turn, TURN_FILES.lore);
    const id = /^- \[(e-\d+)\] The oil store/m.exec(lore)?.[1];
    expect(id).toBeDefined();
    expect(lore).toContain(`## [${id}] The oil store, from Keeper's Book, activated by keyword\n\n${content}\n`);
    // Its text was read of Lumiverse once in the turn, with its book's entries for intake's lore map, and never on its own after.
    expect(reads.filter((r) => r.what === "entries" && r.named === "wb-keep")).toHaveLength(1);
    expect(reads.filter((r) => r.what === "entry")).toEqual([]);
  });
});

describe("where a generation's turn starts", () => {
  test("one start point for each kind", async () => {
    const b = await bed({ answers: ["One.", "Two.", "Three.", "Four.", "Five.", "Six.", "Seven."].map((reply) => replying(reply)) });
    const store = b.turns.store.user(USER);
    const reads = b.composition.door.lumiverse()!.reads;
    /** The rule's answer for a generation of this kind on the chat as it shows now, before it starts: the turn it starts from. */
    const ruled = async (kind: ReplyKind): Promise<string | null> => {
      const path = seenOf((await reads.path(CHAT)) ?? []);
      const target = kind === "swipe" || kind === "regenerate" ? (path.findLast((m) => !m.user)?.id ?? null) : null;
      return generationStart(store, CHAT, path, { kind, target: { message: target } }).at?.turn ?? null;
    };
    /** The request intake gave the harness for the generation just played. */
    const intake = () => b.requests.at(-1)!;

    // A new reply after the path's head: on a chat whose only reply was made without RPE there is no turn before it.
    let expected = await ruled("new");
    const first = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    expect(expected).toBeNull();
    expect(first.parent).toBe(expected);
    expected = await ruled("new");
    const second = await settledTurn(b, await play(b, "normal", "I ask about the oil."));
    expect(expected).toBe(first.id);
    expect(second.parent).toBe(expected);

    // A swipe and a regenerate start from the parent of the attempt they write again.
    for (const kind of ["swipe", "regenerate"] as const) {
      expected = await ruled(kind);
      const again = await settledTurn(b, await play(b, kind));
      expect(expected).toBe(first.id);
      expect(again.parent).toBe(expected);
      expect(again.message).toBe(second.message);
    }

    // A continue plays on a turn of its own, held until its end, begun after the turn of the message it goes on: the attempt now showing.
    expected = await ruled("continue");
    const shown = store.path(CHAT).findLast((e) => !e.user)?.turn ?? null;
    await settledTurn(b, await play(b, "continue"));
    expect(expected).toBe(shown);
    expect(intake().parent).toBe(expected);
    expect(intake().scope.turn).not.toBe(expected);

    // An impersonation starts after the path's head.
    expected = await ruled("impersonate");
    await settledTurn(b, await play(b, "impersonate"));
    expect(intake().parent).toBe(expected);

    // A continue of a reply made without RPE is a turn of its own, after the last turn the path shows before it.
    b.host.send(CHAT, "I wait.");
    b.host.reply(CHAT, "The wind rises, written by hand.");
    expected = await ruled("continue");
    await settledTurn(b, await play(b, "continue"));
    expect(expected).not.toBeNull();
    expect(intake().parent).toBe(expected);
    expect(intake().scope.turn).not.toBe(expected);
  });
});

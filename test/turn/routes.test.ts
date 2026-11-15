// The Turn and World pages' routes (plan §14) answer in the shapes the pages' client is typed by (`src/ui/api.ts`):
// each route's reply is the client's at compile time, and each answer holds exactly the fields the page
// reads, after turns played through the stand-in Lumiverse. Paging, the trace from a record on, a turn's
// runs, its folder's files, the world's tree, and the refusals a page can meet are checked as the page
// would meet them; a token of anyone but the user this RPE belongs to reads nothing. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { insertPageToken } from "../../src/app/auth";
import type { NodeView } from "../../src/store";
import type { ApiRoutes } from "../../src/shared/api";
import type { TurnFileEntry } from "../../src/turn";
import { hashJson } from "../../src/shared/hash";
import { replyProblems } from "../app/call";
import { world } from "../iface/rig";
import { CHARACTER, CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

type ChatList = ApiRoutes["GET /api/v1/chats"]["reply"];
type TurnList = ApiRoutes["GET /api/v1/chats/:chat/turns"]["reply"];
type TurnDetail = ApiRoutes["GET /api/v1/chats/:chat/turns/:turn"]["reply"];
type StopAnswer = ApiRoutes["POST /api/v1/chats/:chat/turns/:turn/stop"]["reply"];

/** Every field of a page's type, once: a field added to the type or left out of here does not compile. */
const CHAT_FIELDS: Record<keyof ChatList["chats"][number], true> = { id: true, name: true, lastTurnAt: true, running: true, played: true, world: true };
const SUMMARY_FIELDS: Record<keyof TurnList["turns"][number], true> = { id: true, kind: true, onPath: true, message: true, status: true, timings: true, usage: true };
const DETAIL_FIELDS: Record<keyof TurnDetail, true> = { ...SUMMARY_FIELDS, chat: true, intent: true, reply: true, error: true, trace: true, lore: true, runs: true };
const RUN_FIELDS: Record<keyof TurnDetail["runs"][number], true> = { id: true, run: true, nth: true, kind: true, status: true, timings: true, usage: true, reply: true, error: true, stoppedBy: true, lastText: true, trace: true, requests: true };
const fields = (shape: object): string[] => Object.keys(shape).sort();

describe("the Turn page's routes", () => {
  test("each route's reply is what its declaration takes, checked at run time, and each answer holds exactly its fields", async () => {
    const b = await openTurnBed({ answers: [replying("The lamp turns."), replying("Wren nods."), replying("Wren points at the sea.")] });
    beds.push(b);
    const played: string[] = [];
    for (const said of ["I climb the stairs.", "I ask about the boat.", "I look at the sea."]) {
      b.host.send(CHAT, said);
      const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
      played.unshift((await settledTurn(b, out.generationId!)).id);
    }

    const chatList = await b.page<ChatList>("GET", "/api/v1/chats");
    expect(replyProblems(b.app, "GET /api/v1/chats", chatList.body)).toEqual([]);
    expect(fields(chatList.body)).toEqual(["chats"]);
    expect(chatList.body.chats.map(fields)).toEqual([fields(CHAT_FIELDS)]);

    // A chat's turns, newest first, a page at a time.
    const first = await b.page<TurnList>("GET", `/api/v1/chats/${CHAT}/turns?limit=2`);
    expect(replyProblems(b.app, "GET /api/v1/chats/:chat/turns", first.body)).toEqual([]);
    expect(fields(first.body)).toEqual(["more", "turns"]);
    expect(first.body.turns.map(fields)).toEqual([fields(SUMMARY_FIELDS), fields(SUMMARY_FIELDS)]);
    expect(first.body).toMatchObject({ more: true, turns: [{ id: played[0] }, { id: played[1] }] });
    const rest = await b.page<TurnList>("GET", `/api/v1/chats/${CHAT}/turns?limit=2&before=${played[1]}`);
    expect(rest.body.more).toBe(false);
    expect(rest.body.turns.map((t) => t.id)).toEqual([played[2]]);

    // One turn, its trace whole and from a record on.
    const detail = await b.page<TurnDetail>("GET", `/api/v1/chats/${CHAT}/turns/${played[0]}`);
    expect(replyProblems(b.app, "GET /api/v1/chats/:chat/turns/:turn", detail.body)).toEqual([]);
    expect(fields(detail.body)).toEqual(fields(DETAIL_FIELDS));
    expect(fields(detail.body.timings)).toEqual(["ended", "firstWord", "intent", "received", "released", "started", "thinking"]);
    expect(fields(detail.body.reply)).toEqual(["progress", "text"]);
    const seqs = detail.body.trace.map((r) => r.seq);
    expect(seqs.length).toBeGreaterThan(2);
    const from = seqs[2]!;
    const later = await b.page<TurnDetail>("GET", `/api/v1/chats/${CHAT}/turns/${played[0]}?from=${from}`);
    expect(later.body.trace.map((r) => r.seq)).toEqual(seqs.filter((s) => s >= from));

    const stopped = await b.page<StopAnswer>("POST", `/api/v1/chats/${CHAT}/turns/${played[0]}/stop`);
    expect(replyProblems(b.app, "POST /api/v1/chats/:chat/turns/:turn/stop", stopped.body)).toEqual([]);
    expect(stopped.body).toEqual({ stopped: false });
  });

  test("a page meets plain refusals: a bad limit, a turn of no such chat, and a call without a page token", async () => {
    const b = await openTurnBed({ answers: [replying("The lamp turns.")] });
    beds.push(b);
    b.host.send(CHAT, "I climb the stairs.");
    const turn = await settledTurn(b, (await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).generationId!);

    expect((await b.page("GET", `/api/v1/chats/${CHAT}/turns?limit=0`)).status).toBe(400);
    expect((await b.page("GET", `/api/v1/chats/chat-elsewhere/turns/${turn.id}`)).status).toBe(404);
    expect((await b.page("POST", `/api/v1/chats/chat-elsewhere/turns/${turn.id}/stop`)).status).toBe(404);
    expect((await b.page("GET", `/api/v1/chats/${CHAT}/turns/turn-none`)).status).toBe(404);
    expect((await fetch(`${b.listening.url}/api/v1/chats/${CHAT}/turns`)).status).toBe(401);
  });

  test("the chats the store holds that RPE never played follow the played ones, by name, each saying it was not played and whether it has a world", async () => {
    const b = await openTurnBed({ answers: [replying("The lamp turns.")] });
    beds.push(b);
    b.host.send(CHAT, "I climb the stairs.");
    await settledTurn(b, (await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).generationId!);
    // Two chats a migration put in the store: one playing a world, one with none. Lumiverse holds both.
    const doc = world();
    const revision = hashJson(doc);
    for (const [id, name] of [["chat-quay", "The quay"], ["chat-attic", "An attic"]] as const) b.host.addChat({ id, user: USER, name, character: CHARACTER, messages: [] });
    await b.app.writes.run(() => {
      const store = b.turns.store.user(USER);
      store.putWorld(revision, doc);
      store.createChat({ id: "chat-quay", world: doc.id, revision });
      store.createChat({ id: "chat-attic" });
    });

    // Each as [id, name, whether a turn of it was played (a time of its newest), running, played, world].
    const listed = await b.page<ChatList>("GET", "/api/v1/chats");
    expect(listed.body.chats.map((c) => [c.id, c.name, typeof c.lastTurnAt === "number", c.running, c.played, c.world])).toEqual([
      [CHAT, "The lighthouse", true, false, true, false],
      ["chat-attic", "An attic", false, false, false, false],
      ["chat-quay", "The quay", false, false, false, true],
    ]);
    expect(listed.body.chats.slice(1).map((c) => c.lastTurnAt)).toEqual([null, null]);
  });

  test("a turn's detail names the lore of its prompt: the entries Lumiverse activated for it, and those the Author's lore map named", async () => {
    const b = await openTurnBed({ answers: [replying("Wren points down the stairs.")] });
    beds.push(b);
    const content = "Whale oil is kept in the cellar under the lamp room, six barrels.";
    b.db.run("INSERT INTO world_books (id, name, user_id) VALUES (?, ?, ?)", "wb-keep", "Keeper's Book", USER);
    b.db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment) VALUES (?, ?, ?, ?, ?, ?)", "wbe-oil", "wb-keep", "1", JSON.stringify(["oil"]), content, "The oil store");
    // Lumiverse activates an entry only from a book the chat reads: here the chat's own.
    b.db.run("UPDATE chats SET metadata = ? WHERE id = ?", JSON.stringify({ chat_world_book_ids: ["wb-keep"] }), CHAT);
    b.host.send(CHAT, "I ask where the oil is kept.");
    const turn = await settledTurn(b, (await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).generationId!);

    const detail = await b.page<TurnDetail>("GET", `/api/v1/chats/${CHAT}/turns/${turn.id}`);
    expect(detail.body.lore.activated).toEqual(["wbe-oil"]);
    // The map names it by the id the Author was shown it by.
    const shown = /\[(e-\d+)\] The oil store/.exec(JSON.stringify(b.model.requests[0]!.messages))?.[1];
    expect(shown).toBeDefined();
    expect(detail.body.lore.map).toEqual([shown!]);
  });
});

/** A turn's detail as the routes give it now: the page's type, and each of its runs. */
type Detail = TurnDetail;

/** A path below a turn's folder, as the file route takes it. */
const filePath = (turn: string, name: string): string => `/api/v1/chats/${CHAT}/turns/${turn}/files/${name.split("/").map(encodeURIComponent).join("/")}`;

/** The player says something and asks for a reply of this kind; gives the turn once its end is recorded. */
async function played(b: TurnBed, said?: string, type: "normal" | "continue" = "normal"): Promise<string> {
  if (said !== undefined) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

describe("a turn's runs, its folder, and the world", () => {
  test("a continued turn shows each of its runs with its own trace and request file, and what they spent together", async () => {
    const b = await openTurnBed({ answers: [replying("The lamp turns."), replying(" Then it stops.")] });
    beds.push(b);
    const turn = await played(b, "I climb the stairs.");
    await played(b, undefined, "continue");
    await b.until("no run of the chat to go on", () => b.turns.runs.ofChat(USER, CHAT).length === 0);

    const detail = (await b.page<Detail>("GET", `/api/v1/chats/${CHAT}/turns/${turn}`)).body;
    expect(detail.runs.map(fields)).toEqual([fields(RUN_FIELDS), fields(RUN_FIELDS)]);
    expect(detail.runs.map((r) => [r.nth, r.kind, r.status, r.reply.text])).toEqual([
      [1, "new", "released", "The lamp turns."],
      [2, "continue", "released", " Then it stops."],
    ]);
    expect(new Set(detail.runs.map((r) => r.id)).size).toBe(2);
    expect(new Set(detail.runs.map((r) => r.requests[0]?.file)).size).toBe(2);
    // Each run's trace is its own, numbered from 1 with no gap, and ends with that run's end.
    for (const run of detail.runs) {
      expect(run.trace.map((t) => t.seq)).toEqual(run.trace.map((_, i) => i + 1));
      expect(run.trace.at(-1)?.event.kind).toBe("run_ended");
    }
    expect(detail.runs[0]!.trace.length + detail.runs[1]!.trace.length).toBe(detail.trace.length);
    // The turn's usage is both runs' together: one model call each.
    expect(detail.usage.calls).toBe(2);
    expect(detail.usage.output).toBe(detail.runs[0]!.usage.output + detail.runs[1]!.usage.output);

    // Each run names the request its lead's first call sent, kept in the turn's folder, and the file route opens it.
    for (const run of detail.runs) {
      expect(run.requests).toEqual([expect.objectContaining({ definition: "author", call: 1, file: expect.stringMatching(/^transcripts\/.+\.call-1\.json$/) })]);
      const kept = await b.page<{ name: string; text: string }>("GET", filePath(turn, run.requests[0]!.file));
      expect(kept.status).toBe(200);
      const request: unknown = JSON.parse(kept.body.text);
      expect(request).toHaveProperty(["messages", 0, "role"], "system");
    }
  });

  test("a turn's folder is listed whole, each file reads as the folder holds it, and no path leaves the folder", async () => {
    const b = await openTurnBed({ answers: [replying("The lamp turns.")] });
    beds.push(b);
    const turn = await played(b, "I climb the stairs.");

    const listing = await b.page<{ files: TurnFileEntry[] }>("GET", `/api/v1/chats/${CHAT}/turns/${turn}/files`);
    expect(listing.status).toBe(200);
    expect(replyProblems(b.app, "GET /api/v1/chats/:chat/turns/:turn/files", listing.body)).toEqual([]);
    const byName = new Map(listing.body.files.map((f) => [f.name, f]));
    expect(byName.get("briefing.md")).toMatchObject({ folder: false });
    expect(byName.get("turn.json")).toMatchObject({ folder: false });
    const inTranscripts = listing.body.files.filter((f) => !f.folder && f.name.startsWith("transcripts/"));
    expect(inTranscripts.some((f) => f.name.endsWith(".jsonl"))).toBe(true);
    expect(byName.get("transcripts")).toEqual({ name: "transcripts", folder: true, bytes: inTranscripts.reduce((n, f) => n + f.bytes, 0) });

    // A file's text is what the turn's folder holds on disk, whole.
    const run = b.turns.runs.record(USER, turn)!;
    const disk = (await b.turns.files.turnDisk({ user: USER, chat: CHAT, session: run.session, turn }))!;
    for (const name of ["briefing.md", inTranscripts[0]!.name]) {
      const file = await b.page<{ name: string; text: string }>("GET", filePath(turn, name));
      expect(replyProblems(b.app, "GET /api/v1/chats/:chat/turns/:turn/files/*", file.body)).toEqual([]);
      expect(file.body).toEqual({ name, text: await Bun.file(join(disk, name)).text() });
      expect(Buffer.byteLength(file.body.text)).toBe(byName.get(name)!.bytes);
    }

    // Nothing outside it: an escaped way up, a folder, a file it does not hold, a turn of another chat.
    expect((await b.page("GET", `/api/v1/chats/${CHAT}/turns/${turn}/files/..%2F..%2Fchat.yml`)).status).toBe(400);
    expect((await b.page("GET", `/api/v1/chats/${CHAT}/turns/${turn}/files/transcripts%2F..%2F..%2Fsession.jsonl`)).status).toBe(400);
    expect((await b.page("GET", filePath(turn, "transcripts"))).status).toBe(404);
    expect((await b.page("GET", filePath(turn, "nothing.md"))).status).toBe(404);
    expect((await b.page("GET", `/api/v1/chats/chat-elsewhere/turns/${turn}/files`)).status).toBe(404);
  });

  test("a transcript line torn by a crash costs that line, not the turn's page: the page still shows every whole record", async () => {
    const b = await openTurnBed({ answers: [replying("The lamp turns.")] });
    beds.push(b);
    const turn = await played(b, "I climb the stairs.");
    await b.until("no run of the chat to go on", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
    const whole = (await b.page<Detail>("GET", `/api/v1/chats/${CHAT}/turns/${turn}`)).body.trace;
    expect(whole.length).toBeGreaterThan(0);

    // A record cut off where the process ended, then a later record whole, as an append after a restart leaves them.
    const run = b.turns.runs.record(USER, turn)!;
    const disk = (await b.turns.files.turnDisk({ user: USER, chat: CHAT, session: run.session, turn }))!;
    const glob = new Bun.Glob("transcripts/*.jsonl");
    const [transcript] = await Array.fromAsync(glob.scan({ cwd: disk }));
    const file = join(disk, transcript!);
    const kept = await Bun.file(file).text();
    const [first, ...rest] = kept.split("\n");
    await Bun.write(file, [first, `${JSON.stringify(whole[0]).slice(0, 40)}`, ...rest].join("\n"));

    const page = await b.page<Detail>("GET", `/api/v1/chats/${CHAT}/turns/${turn}`);
    expect(page.status).toBe(200);
    expect(page.body.trace).toEqual(whole);
  });

  test("the world's tree is read at the chat's head or at a turn, to a depth, with the values asked for", async () => {
    const b = await openTurnBed({
      answers: [
        replying("The lamp turns."),
        { pieces: [{ text: "<intent>The clock strikes half past eight.</intent>" }, { call: "world_apply", args: { operations: [{ op: "pass_time", until: "2026-01-01 08:30", source: { from: "prose" } }] } }] },
        { pieces: [{ text: "<reply>The tide turns.</reply>" }] },
      ],
    });
    beds.push(b);
    const first = await played(b, "I climb the stairs.");
    await played(b, "I wait.");
    type World = { at: string; nodes: NodeView[] };
    const world = async (query: string) => b.page<World>("GET", `/api/v1/chats/${CHAT}/world${query}`);

    // At the head, the world with its own values: the time the second turn set the clock to, kept by the calendar.
    const head = await world("");
    expect(head.status).toBe(200);
    expect(replyProblems(b.app, "GET /api/v1/chats/:chat/world", head.body)).toEqual([]);
    expect(head.body.at).toBe("world");
    expect(head.body.nodes[0]).toMatchObject({ ref: "world", kind: "world" });
    expect(head.body.nodes[0]!.values.find((v) => v.key === "time")).toMatchObject({ from: { system: "calendar" } });
    expect(head.body.nodes.slice(1).map((n) => n.ref)).toEqual(head.body.nodes[0]!.children);
    // At the first turn the clock was not set yet; with no values, none; with no depth, the level alone.
    expect((await world(`?turn=${first}`)).body.nodes[0]!.values.some((v) => v.key === "time")).toBe(false);
    expect((await world("?values=none")).body.nodes.every((n) => n.values.length === 0)).toBe(true);
    expect((await world("?depth=0")).body.nodes.map((n) => n.ref)).toEqual(["world"]);

    expect((await world("?values=some")).status).toBe(400);
    expect((await world("?depth=deep")).status).toBe(400);
    expect((await world("?at=place-nowhere")).status).toBe(404);
    expect((await world("?turn=turn-none")).status).toBe(404);
    expect((await b.page("GET", "/api/v1/chats/chat-elsewhere/world")).status).toBe(404);
  });

  test("a token of anyone but the user this RPE belongs to reads nothing", async () => {
    const b = await openTurnBed({ answers: [replying("The lamp turns.")] });
    beds.push(b);
    const turn = await played(b, "I climb the stairs.");
    // A page token made for another user of the same Lumiverse, as one this RPE once belonged to would have left.
    const other = await b.app.writes.run((db) => insertPageToken(db, "user-other", "extension", 60_000, Date.now()));
    for (const path of [`/api/v1/chats/${CHAT}/turns/${turn}`, `/api/v1/chats/${CHAT}/turns/${turn}/files`, filePath(turn, "briefing.md"), `/api/v1/chats/${CHAT}/world`]) {
      const res = await fetch(`${b.listening.url}${path}`, { headers: { authorization: `Bearer ${other.token}` } });
      expect(res.status).toBe(401);
      const body: unknown = await res.json();
      for (const field of ["runs", "trace", "files", "text", "nodes"]) expect(body).not.toHaveProperty(field);
    }
  });
});

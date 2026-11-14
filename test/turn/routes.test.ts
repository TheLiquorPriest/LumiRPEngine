// The Turn page's routes (plan §14) answer in the shapes the pages' client is typed by (`src/ui/api.ts`):
// each route's reply is the client's at compile time, and each answer holds exactly the fields the page
// reads, after turns played through the stand-in Lumiverse. Paging, the trace from a record on, and the
// refusals a page can meet are checked as the page would meet them. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { RouteReply } from "../../src/app";
import { turnRoutes } from "../../src/turn";
import type { ChatList, ChatSummary, Routes, StopAnswer, TurnDetail, TurnList, TurnSummary } from "../../src/ui/api";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** Every field of a page's type, once: a field added to the type or left out of here does not compile. */
const CHAT_FIELDS: Record<keyof ChatSummary, true> = { id: true, name: true, lastTurnAt: true, running: true };
const SUMMARY_FIELDS: Record<keyof TurnSummary, true> = { id: true, kind: true, onPath: true, message: true, status: true, timings: true, usage: true };
const DETAIL_FIELDS: Record<keyof TurnDetail, true> = { ...SUMMARY_FIELDS, chat: true, intent: true, reply: true, error: true, trace: true, lore: true };
const fields = (shape: object): string[] => Object.keys(shape).sort();

describe("the Turn page's routes", () => {
  test("each route's reply is the type the pages' client is written against, and each answer holds exactly its fields", async () => {
    const b = await openTurnBed({ answers: [replying("The lamp turns."), replying("Wren nods."), replying("Wren points at the sea.")] });
    beds.push(b);
    const [chats, list, one, stop] = turnRoutes({ turns: b.turns, owner: () => USER, chatName: async () => null });
    // The client's shape of each route's reply is what the route gives: these lines do not compile when they part.
    const replies: [Routes["GET /api/v1/chats"]["reply"], Routes["GET /api/v1/chats/:chat/turns"]["reply"], Routes["GET /api/v1/chats/:chat/turns/:turn"]["reply"], Routes["POST /api/v1/chats/:chat/turns/:turn/stop"]["reply"]] = [
      null as unknown as RouteReply<typeof chats>,
      null as unknown as RouteReply<typeof list>,
      null as unknown as RouteReply<typeof one>,
      null as unknown as RouteReply<typeof stop>,
    ];
    expect(replies).toHaveLength(4);
    expect([chats, list, one, stop].map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/v1/chats", "GET /api/v1/chats/:chat/turns", "GET /api/v1/chats/:chat/turns/:turn", "POST /api/v1/chats/:chat/turns/:turn/stop"]);

    const played: string[] = [];
    for (const said of ["I climb the stairs.", "I ask about the boat.", "I look at the sea."]) {
      b.host.send(CHAT, said);
      const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
      played.unshift((await settledTurn(b, out.generationId!)).id);
    }

    const chatList = await b.page<ChatList>("GET", "/api/v1/chats");
    expect(fields(chatList.body)).toEqual(["chats"]);
    expect(chatList.body.chats.map(fields)).toEqual([fields(CHAT_FIELDS)]);

    // A chat's turns, newest first, a page at a time.
    const first = await b.page<TurnList>("GET", `/api/v1/chats/${CHAT}/turns?limit=2`);
    expect(fields(first.body)).toEqual(["more", "turns"]);
    expect(first.body.turns.map(fields)).toEqual([fields(SUMMARY_FIELDS), fields(SUMMARY_FIELDS)]);
    expect(first.body).toMatchObject({ more: true, turns: [{ id: played[0] }, { id: played[1] }] });
    const rest = await b.page<TurnList>("GET", `/api/v1/chats/${CHAT}/turns?limit=2&before=${played[1]}`);
    expect(rest.body.more).toBe(false);
    expect(rest.body.turns.map((t) => t.id)).toEqual([played[2]]);

    // One turn, its trace whole and from a record on.
    const detail = await b.page<TurnDetail>("GET", `/api/v1/chats/${CHAT}/turns/${played[0]}`);
    expect(fields(detail.body)).toEqual(fields(DETAIL_FIELDS));
    expect(fields(detail.body.timings)).toEqual(["ended", "firstWord", "received", "released", "started"]);
    expect(fields(detail.body.reply)).toEqual(["progress", "text"]);
    const seqs = detail.body.trace.map((r) => r.seq);
    expect(seqs.length).toBeGreaterThan(2);
    const from = seqs[2]!;
    const later = await b.page<TurnDetail>("GET", `/api/v1/chats/${CHAT}/turns/${played[0]}?from=${from}`);
    expect(later.body.trace.map((r) => r.seq)).toEqual(seqs.filter((s) => s >= from));

    const stopped = await b.page<StopAnswer>("POST", `/api/v1/chats/${CHAT}/turns/${played[0]}/stop`);
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

  test("a turn's detail names the lore of its prompt: the entries Lumiverse activated for it, and those the Author's lore map named", async () => {
    const b = await openTurnBed({ answers: [replying("Wren points down the stairs.")] });
    beds.push(b);
    const content = "Whale oil is kept in the cellar under the lamp room, six barrels.";
    b.host.chats.get(CHAT)!.books = [{ id: "wbe-oil", book: "wb-keep", content, comment: "The oil store", keys: ["oil"] }];
    b.db.run("INSERT INTO world_books (id, name, user_id) VALUES (?, ?, ?)", "wb-keep", "Keeper's Book", USER);
    b.db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment) VALUES (?, ?, ?, ?, ?, ?)", "wbe-oil", "wb-keep", "1", JSON.stringify(["oil"]), content, "The oil store");
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

// The state route group (plan §4.4 l.309): a chat's export, the head as one document for the command line's sandbox to open a copy from.

import { afterEach, describe, expect, test } from "bun:test";
import type { ApiRoutes } from "../../src/shared/api";
import { ENGINE_VERSION } from "../../src/shared/world";
import { replyProblems } from "../app/call";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

type Export = ApiRoutes["GET /api/v1/chats/:chat/state/export"]["reply"];

describe("the state routes", () => {
  test("a chat's export gives its head's world, state, revision, engine, seed and clock, and is refused outside the GM gate", async () => {
    const b = await openTurnBed({ answers: [replying("The lamp turns.")] });
    beds.push(b);
    b.host.send(CHAT, "I climb the stairs.");
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    await settledTurn(b, out.generationId!);

    const exported = await b.page<Export>("GET", `/api/v1/chats/${CHAT}/state/export`);
    expect(exported.status).toBe(200);
    expect(replyProblems(b.app, "GET /api/v1/chats/:chat/state/export", exported.body)).toEqual([]);
    const store = b.turns.store.user(USER);
    const head = store.headState(CHAT).state.world;
    const row = store.chat(CHAT);
    expect(exported.body).toMatchObject({ chat: CHAT, revision: head.revision, engine: ENGINE_VERSION, seed: row?.seed, clock: head.clock });
    expect(exported.body.state).toEqual(JSON.parse(JSON.stringify(head)));
    const doc = exported.body.worldDoc;
    expect(typeof doc === "object" && doc !== null && "id" in doc ? doc.id : undefined).toBe(row?.world ?? "blank");
    // A chat RPE does not hold reads as an untouched one, and nothing of it is made; a caller that is not the owner's page reads nothing.
    const untouched = await b.page<Export>("GET", "/api/v1/chats/chat-elsewhere/state/export");
    expect(untouched).toMatchObject({ status: 200, body: { chat: "chat-elsewhere", world: null } });
    expect(b.turns.store.user(USER).chat("chat-elsewhere")).toBeNull();
    expect((await fetch(`${b.listening.url}/api/v1/chats/${CHAT}/state/export`)).status).toBe(401);
  });
});

// A turn's one review card and its undo (plan §6.8): the changes the turn made by lane, each with its undo, and his word on a question.

import { afterEach, describe, expect, test } from "bun:test";
import type { ApiRoutes } from "../../src/shared/api";
import { STARTER_WORLDS } from "../../src/packs";
import { CHAT, CONNECTION, openTurnBed, PRESET, playsWorld, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

type Card = ApiRoutes["GET /api/v1/chats/:chat/turns/:turn/card"]["reply"];

describe("the review card", () => {
  test("a turn's change is on its card with an undo, undoing it records the reversal, and a question nobody asked is not there to answer", async () => {
    const b = await openTurnBed({ answers: [replying("The lamp turns.")] });
    beds.push(b);
    b.host.send(CHAT, "I climb the stairs.");
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    const turn = await settledTurn(b, out.generationId!);
    const store = b.turns.store.user(USER);
    await b.turns.writes.run(() => store.addChanges(turn.id, [{ lane: "story", op: "story.write", value: { part: "scene", item: "sc-card", value: { title: "The stairs" } }, by: "author", source: "prose" }]));

    const card = await b.page<Card>("GET", `/api/v1/chats/${CHAT}/turns/${turn.id}/card`);
    expect(card.status).toBe(200);
    const change = card.body.lanes.flatMap((l) => l.changes).find((c) => c.op === "story.write");
    expect(card.body.lanes.map((l) => l.lane)).toContain("story");
    expect(change?.undo.ops.length).toBeGreaterThan(0);
    expect(change?.undoneBy).toEqual([]);

    const undone = await b.page<{ recorded: string[] }>("POST", `/api/v1/chats/${CHAT}/turns/${turn.id}/changes/${change?.id}/undo`);
    expect(undone.status).toBe(200);
    expect(undone.body.recorded.length).toBeGreaterThan(0);
    const after = await b.page<Card>("GET", `/api/v1/chats/${CHAT}/turns/${turn.id}/card`);
    expect(after.body.lanes.flatMap((l) => l.changes).find((c) => c.id === change?.id)?.undoneBy.length).toBeGreaterThan(0);

    const answered = await b.page<{ answered: boolean; state: string }>("POST", `/api/v1/chats/${CHAT}/approvals/ap-none/answer`, { go: true });
    expect(answered.body).toEqual({ answered: false, state: "unknown" });
  });
});

describe("the review card in words", () => {
  test("each change is told as the GM view words it, or by its kind where it is no event of the world, its reports in the engine's answers' words, and what an undo does in a sentence, with the record as written beside", async () => {
    const b = await openTurnBed({ answers: [replying("The lamp turns.")] });
    beds.push(b);
    const doc = STARTER_WORLDS.modern_slice_of_life("w_card", "Port Alder");
    await playsWorld(b, doc);
    b.host.send(CHAT, "I climb the stairs.");
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    const turn = await settledTurn(b, out.generationId!);
    const store = b.turns.store.user(USER);
    await b.turns.writes.run(() =>
      store.addChanges(turn.id, [
        { lane: "engine", op: "set", value: { type: "set", entity: doc.pov, field: "mood", value: "calm" }, by: "gm", source: "prose" },
        { lane: "engine", op: "set", value: { type: "set", entity: "nobody_here", field: "mood", value: "calm" }, by: "gm", source: "prose" },
        { lane: "story", op: "story.write", value: { part: "scene", item: "sc-card", value: { title: "The stairs" } }, by: "author", source: "prose" },
      ]),
    );
    const card = await b.page<Card>("GET", `/api/v1/chats/${CHAT}/turns/${turn.id}/card`);
    const changes = card.body.lanes.flatMap((l) => l.changes);
    const set = changes.find((c) => c.op === "set");
    const written = changes.find((c) => c.op === "story.write");
    expect(set?.words).toContain("calm");
    expect(set?.words).not.toBe("A value");
    expect(set?.value).toMatchObject({ type: "set", field: "mood" });
    expect(written?.words).toBe("A change to the story's record");
    expect(set?.reportWords).toEqual([]);
    const refused = changes.find((c) => c.op === "set" && c.id !== set?.id);
    expect(refused?.applied).toBe(false);
    expect(refused?.reportWords).toEqual(["The engine could not apply this (missing_entity)."]);
    for (const c of [set, written]) expect(c?.undo.words).toBe("Undo takes this change back.");
  });
});

// A branch (plan §10.10 "Branch"): the new chat shares the tree up to the branch point, and its sessions
// start as they stood at that point. Its first turn plays in a session of the branch's own, forked from
// the session its branch point played in, so the Author has what it did there. The branch is made as
// Lumiverse makes one: each message copied in its place under a new id, the chat it came from and the
// message it was made at in its metadata. A continue in it is sent as Lumiverse sends one: the reply it
// goes on with last, with the preset's postfix (here none, as the bed's preset sets none) and the
// continue nudge after it. Played through the stand-in Lumiverse on the scripted model. Every name is
// invented.

import { afterEach, expect, test } from "bun:test";
import { gate } from "rp-harness/testing/rig";
import type { TurnRow } from "../../src/store";
import { sceneSession } from "../../src/story";
import type { TurnList } from "../../src/ui/api";
import { CONTINUE_NUDGE } from "../standin/assembly";
import { CHARACTER, CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

const BRANCH = "chat-gannet-again";

/** Lumiverse's fork of the bed's chat at its last reply (`chats.service.ts:3540-3576`): each message copied in its place under a new id. */
function branchAtLastReply(b: TurnBed): void {
  const rows = b.db.rows("SELECT id, is_user, content FROM messages WHERE chat_id = ? ORDER BY index_in_chat", CHAT);
  const messages = rows.map((m, i) => ({ id: `m-again-${i}`, role: m.is_user === 1 ? ("user" as const) : ("assistant" as const), content: String(m.content) }));
  b.host.addChat({ id: BRANCH, user: USER, name: "The lighthouse, again", character: CHARACTER, messages, metadata: { branched_from: CHAT, branch_at_message: String(rows.at(-1)!.id) } });
}

/** The turn of a generation in the branch, once Lumiverse's end of it is recorded and no run of the branch goes on. */
async function settledInBranch(b: TurnBed, generation: string): Promise<TurnRow> {
  return await b.until(`the branch's turn of generation ${generation} to be settled`, () => {
    const turn = b.turns.store.user(USER).turn(b.turns.runs.byGeneration(USER, generation)?.turn ?? "");
    return turn !== null && turn.status !== "open" && b.turns.runs.ofChat(USER, BRANCH).length === 0 ? turn : null;
  });
}

/** `minutes` passed in the world, recorded on the turn: the Author's call after its intent record. */
const passing = (intent: string, minutes: number) => ({ pieces: [{ text: `<intent>${intent}</intent>` }, { call: "world_apply", args: { operations: [{ op: "pass_time", minutes, source: { from: "prose" } }] } }] });

test("a branch's first turn plays in a session of the branch's own, forked from the one its branch point played in, and the Author has what it did there", async () => {
  const b = await openTurnBed({ answers: [replying("The lamp turns.", "INTENT-ONE Light the lamp."), replying("Wren nods.", "INTENT-TWO Keep the watch."), replying("Wren looks out to sea.")] });
  beds.push(b);
  for (const said of ["I climb the stairs.", "I wait."]) {
    b.host.send(CHAT, said);
    await settledTurn(b, (await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).generationId!);
  }
  const point = b.requests[1]!.scope;

  branchAtLastReply(b);
  b.host.send(BRANCH, "I look out to sea.");
  const generation = (await b.host.generate({ chat: BRANCH, connection: CONNECTION, preset: PRESET })).generationId!;
  await b.until("the branch's turn to be tied", () => b.turns.store.user(USER).turn(b.turns.runs.byGeneration(USER, generation)?.turn ?? "")?.status === "done");

  const asked = b.requests[2]!;
  expect(asked.parent).toBe(point.turn);
  expect(asked.scope.chat).toBe(BRANCH);
  expect(asked.scope.session).not.toBe(point.session);
  expect(await b.turns.harness.sessions!.get({ user: USER, chat: BRANCH, session: asked.scope.session })).toMatchObject({ chat: BRANCH, state: "open", from: { chat: CHAT, session: point.session, turn: point.turn } });
  expect(b.turns.store.user(USER).sessions(BRANCH).map((s) => s.id)).toEqual([asked.scope.session]);
  expect(JSON.stringify(b.model.requests.at(-1)!.messages)).toContain("INTENT-TWO");
});

test("a continue in a branch of the reply it shares with the chat it was made from goes on in a turn of the branch's own, after the shared one: the source keeps its turn as it was, and each chat plays on from its own", async () => {
  const b = await openTurnBed({
    answers: [
      passing("INTENT-ONE Light the lamp.", 30),
      { pieces: [{ text: "<reply>The lamp turns.</reply>" }] },
      passing("Then the storm.", 15),
      { pieces: [{ text: "<reply>And the sea calms.</reply>" }] },
      replying("Wren nods."),
      replying("Wren looks out to sea."),
    ],
  });
  beds.push(b);
  const store = b.turns.store.user(USER);
  b.host.send(CHAT, "I climb the stairs.");
  const shared = await settledTurn(b, (await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).generationId!);
  const point = b.requests[0]!.scope;
  const recorded = store.changes(shared.id);
  expect(recorded).toHaveLength(1);
  const sourcePath = store.path(CHAT);

  branchAtLastReply(b);
  const continuing = await b.host.generate({ chat: BRANCH, connection: CONNECTION, preset: PRESET, type: "continue" });
  // The branch's reply is sent last, out of its history, with no postfix, as the preset sets none, and the nudge after it
  // (`prompt-assembly.service.ts:742-775`, `generate.service.ts:1969-1978`).
  expect((continuing.body!.messages as unknown[]).slice(-2)).toEqual([
    { role: "assistant", content: "The lamp turns." },
    { role: "system", content: CONTINUE_NUDGE },
  ]);
  const continued = await settledInBranch(b, continuing.generationId!);
  const saved = String(b.db.rows("SELECT content FROM messages WHERE id = ?", "m-again-2")[0]!.content);
  expect(saved).toStartWith("The lamp turns.");
  expect(saved).toEndWith("And the sea calms.");
  // The continue is a turn of the branch's own, after the shared one, tied to the branch's message, with what it recorded.
  expect(continued).toMatchObject({ chat: BRANCH, parent: shared.id, kind: "continue", status: "done", message: "m-again-2" });
  expect(store.changes(continued.id).map((c) => c.lane)).toEqual(["engine"]);
  expect(store.path(BRANCH).find((e) => e.message === "m-again-2")).toMatchObject({ turn: continued.id, node: continued.node });
  expect(b.requests[1]).toMatchObject({ kind: "continue", parent: shared.id, scope: { chat: BRANCH, turn: continued.id } });
  // Each chat's Turn page lists the runs played in it: the branch's, its continue, on its path at its message; the source's, the shared turn.
  const listed = async (chat: string) => (await b.page<TurnList>("GET", `/api/v1/chats/${chat}/turns`)).body.turns.map((t) => [t.id, t.kind, t.onPath, t.message]);
  expect(await listed(BRANCH)).toEqual([[continued.id, "continue", true, "m-again-2"]]);
  expect(await listed(CHAT)).toEqual([[shared.id, "new", true, shared.message]]);
  // It plays in a session of the branch's own, as the shared turn left it, so the Author has what it did there.
  expect(await b.turns.harness.sessions!.get({ user: USER, chat: BRANCH, session: b.requests[1]!.scope.session })).toMatchObject({ chat: BRANCH, from: { chat: CHAT, session: point.session, turn: shared.id } });
  expect(JSON.stringify(b.model.requests[2]!.messages)).toContain("INTENT-ONE");
  // The source keeps its turn as it was: its message, its text, what it recorded, its path.
  expect(store.turn(shared.id)).toMatchObject({ chat: CHAT, message: shared.message, hash: shared.hash });
  expect(store.changes(shared.id)).toEqual(recorded);
  expect(store.path(CHAT)).toEqual(sourcePath);
  // The branch's state holds the shared turn's thirty minutes, then its own fifteen.
  expect(store.headState(BRANCH).state.world.clock - store.headState(CHAT).state.world.clock).toBe(15);

  // Each chat plays on from its own: told nothing of the other's, the source after the shared turn, the branch after its own.
  b.host.send(CHAT, "I wait.");
  expect((await settledTurn(b, (await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).generationId!)).parent).toBe(shared.id);
  b.host.send(BRANCH, "I look out to sea.");
  expect((await settledInBranch(b, (await b.host.generate({ chat: BRANCH, connection: CONNECTION, preset: PRESET })).generationId!)).parent).toBe(continued.id);
  for (const asked of b.requests.slice(2)) for (const kind of ["edit", "swiped", "unplayed", "deleted"]) expect(asked.since.map((s) => s.kind)).not.toContain(kind);
});

test("after a continue in a branch of the reply it shares, the branch still holds the shared turn's story and cast: its scene stays open, its session is not closed, and the branch's next turn has both; the source is untouched", async () => {
  const b = await openTurnBed({
    answers: [
      // The source's turn opens the watch scene and casts Wren, then replies.
      {
        pieces: [
          { text: "<intent>Open the watch.</intent>" },
          { call: "story_record", args: { operations: [{ op: "scene", new: true, title: "SCENE-WATCH Night watch", place: "The lamp room" }] } },
          { call: "cast_update", args: { operations: [{ op: "cast", who: "Wren Hale", as: "principal", line: "The keeper of the light." }, { op: "base", who: "Wren Hale", seed: "SEED-WREN She keeps the Gannet Rock light alone." }] } },
        ],
      },
      { pieces: [{ text: "<reply>The lamp turns.</reply>" }] },
      // The branch's continue of that reply.
      { pieces: [{ text: "<intent>Go on.</intent>" }, { text: "<reply>And the sea calms.</reply>" }] },
      // The branch's next turn asks Wren.
      { pieces: [{ text: "<intent>Ask Wren.</intent>" }, { call: "delegate", args: { agent: "character", brief: "BRIEF-CALM Is the sea calm?", plays: "Wren Hale" } }] },
      { pieces: [{ text: "It is calm now." }] },
      replying("Wren nods."),
    ],
  });
  beds.push(b);
  const store = b.turns.store.user(USER);
  b.host.send(CHAT, "I climb the stairs.");
  const shared = await settledTurn(b, (await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).generationId!);
  const scene = sceneSession(b.turns.store, USER, CHAT, shared.id).scene;
  expect(scene).not.toBe("");
  const sourcePath = store.path(CHAT);
  const sourceSessions = store.sessions(CHAT);

  branchAtLastReply(b);
  const continued = await settledInBranch(b, (await b.host.generate({ chat: BRANCH, connection: CONNECTION, preset: PRESET, type: "continue" })).generationId!);
  expect(continued).toMatchObject({ chat: BRANCH, parent: shared.id, kind: "continue" });
  // The scene the shared turn opened is still the branch's, and the session the continue played in is still open.
  expect(store.line(BRANCH).map((l) => l.turn)).toEqual([shared.id, continued.id]);
  expect(sceneSession(b.turns.store, USER, BRANCH, continued.id).scene).toBe(scene);
  expect(store.sessions(BRANCH).map((s) => [s.scene, s.closedBy])).toEqual([[scene, null]]);

  // The branch's next turn: the Author's briefing has the scene, and Wren's agent her base, both from the shared turn.
  b.host.send(BRANCH, "Is the sea calm?");
  const next = await settledInBranch(b, (await b.host.generate({ chat: BRANCH, connection: CONNECTION, preset: PRESET })).generationId!);
  expect(next.parent).toBe(continued.id);
  expect(JSON.stringify(b.model.requests[3]!.messages)).toContain("SCENE-WATCH Night watch");
  const wren = b.model.requests.map((r) => JSON.stringify(r.messages)).find((sent) => sent.includes("BRIEF-CALM"));
  expect(wren).toContain("Seed: SEED-WREN She keeps the Gannet Rock light alone.");

  // The source is untouched: its path, its scene and its sessions.
  expect(store.path(CHAT)).toEqual(sourcePath);
  expect(sceneSession(b.turns.store, USER, CHAT, shared.id).scene).toBe(scene);
  expect(store.sessions(CHAT)).toEqual(sourceSessions);
});

test.each(["swipe", "regenerate"] as const)("a %s in a branch of the reply it shares with the chat it was made from writes a turn of the branch's own beside the shared one: the shared turn, and its run still at work in the source, are left to the source", async (kind) => {
  const held = gate();
  const b = await openTurnBed({
    answers: [
      // The source's turn: its reply goes out, and its run goes on at work after it, held until the branch's attempt is written.
      { pieces: [{ text: "<intent>Light the lamp.</intent>" }, { text: "<reply>The lamp turns.</reply>" }, { call: "file_read", args: { path: "scratch/none.md" } }] },
      { pieces: [{ hold: held }, { text: "The lamp is lit." }] },
      replying("The lamp gutters."),
    ],
  });
  beds.push(b);
  const store = b.turns.store.user(USER);
  b.host.send(CHAT, "I climb the stairs.");
  const generation = (await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).generationId!;
  const shared = await b.until("the source's reply to be tied to its turn", () => {
    const turn = store.turn(b.turns.runs.byGeneration(USER, generation)?.turn ?? "");
    return turn?.status === "done" ? turn : null;
  });
  await b.until("the source's run to be at work after its reply", () => b.model.requests.length === 2);

  branchAtLastReply(b);
  // The branch's path is compared once before, as any earlier request of the branch compares it (here a Settle now, refused): it
  // holds the shared turn at the branch's copy of the reply.
  expect((await b.page("POST", `/api/v1/chats/${BRANCH}/settle`)).status).toBe(409);
  expect(store.path(BRANCH).find((e) => e.message === "m-again-2")?.turn).toBe(shared.id);
  const made = await settledInBranch(b, (await b.host.generate({ chat: BRANCH, connection: CONNECTION, preset: PRESET, type: kind })).generationId!);
  // A turn of the branch's own, beside the shared one, at the branch's copy of the reply.
  expect(made).toMatchObject({ chat: BRANCH, kind, parent: shared.parent, status: "done", message: "m-again-2" });
  expect(store.path(BRANCH).find((e) => e.message === "m-again-2")?.turn).toBe(made.id);
  // The harness is told of no turn of the source's leaving a path, and the source's run goes on to its end, its turn on its path.
  expect(b.left.map((s) => s.turn)).not.toContain(shared.id);
  held.open();
  await b.until("the source's run to end", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
  expect(b.turns.runs.ofTurn(USER, shared.id).map((r) => [r.kind, r.status, r.error])).toEqual([["new", "released", null]]);
  expect(store.path(CHAT).find((e) => e.message === shared.message)?.turn).toBe(shared.id);
});

test("Settle now in a branch whose newest turn is the one it shares with the chat it was made from is refused in the turn-errors part's words, and the shared turn is left as it was", async () => {
  const b = await openTurnBed({ answers: [passing("Light the lamp.", 30), { pieces: [{ text: "<reply>The lamp turns.</reply>" }] }] });
  beds.push(b);
  const store = b.turns.store.user(USER);
  b.host.send(CHAT, "I climb the stairs.");
  const shared = await settledTurn(b, (await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET })).generationId!);
  const recorded = store.changes(shared.id);
  expect(recorded).toHaveLength(1);

  branchAtLastReply(b);
  expect(await b.page("POST", `/api/v1/chats/${BRANCH}/settle`)).toEqual({
    status: 409,
    body: { error: "The newest turn on this chat's path is the one it shares with the chat it was branched from, so what Settle now records would go into that chat's history too. Play a turn in this chat first, then settle it." },
  });
  expect(b.turns.runs.ofTurn(USER, shared.id).map((r) => r.kind)).toEqual(["new"]);
  expect(store.changes(shared.id)).toEqual(recorded);
  // The shared turn stays on both chats' lines.
  expect(store.line(BRANCH).map((l) => l.turn)).toEqual([shared.id]);
  expect(store.line(CHAT).map((l) => l.turn)).toEqual([shared.id]);
  expect(b.model.requests).toHaveLength(2);
});

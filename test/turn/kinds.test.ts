// The other kinds of turn (plan §6.3, §10.10), each played through the stand-in Lumiverse as the player
// would: a swipe and a regenerate are new attempts beside the turn they replace; a delete takes its turn
// off the path, stops its work and tells the harness; a continue extends the same turn; an impersonation
// kept as a draft leaves nothing behind. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { gate } from "rp-harness/testing/rig";
import { textHash } from "../../src/adapter/lumiverse/wire";
import type { TurnsReply } from "../../src/shared/api";
import { textOf } from "../standin/steps";
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

/** The player says something and asks for a reply of this kind; gives the generation's id. */
async function play(b: TurnBed, type: "normal" | "swipe" | "regenerate" | "continue" | "impersonate", said?: string, draft = false): Promise<string> {
  if (said !== undefined) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type, ...(draft ? { impersonateDraft: true } : {}) });
  expect(out.error).toBeNull();
  return out.generationId!;
}

async function turnList(b: TurnBed): Promise<[string, string, boolean][]> {
  return (await b.page<TurnsReply>("GET", `/api/v1/chats/${CHAT}/turns`)).body.turns.map((t) => [t.id, t.kind, t.onPath]);
}

describe("the other kinds of turn", () => {
  test.each(["swipe", "regenerate"] as const)("a %s is a new attempt beside the turn it replaces: a sibling under the same parent, on the path in its place", async (kind) => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren nods at the barometer."), replying("Wren taps the barometer twice.")] });
    const first = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const replaced = await settledTurn(b, await play(b, "normal", "I ask about the weather."));
    const made = await settledTurn(b, await play(b, kind));

    expect(replaced.parent).toBe(first.id);
    expect(made).toMatchObject({ kind, status: "done", parent: first.id, depth: replaced.depth, message: replaced.message, hash: textHash("Wren taps the barometer twice.") });
    expect(made.node).not.toBe(replaced.node);
    const store = b.turns.store.user(USER);
    expect(store.path(CHAT).find((e) => e.message === replaced.message)?.turn).toBe(made.id);
    expect(store.swipes(CHAT, replaced.message!).map((t) => t.id)).toEqual([replaced.id, made.id]);
    // The attempt it replaced left the path, and the harness was told; the Author was not told its own reply was edited.
    expect(b.left.map((s) => s.turn)).toEqual([replaced.id]);
    expect(JSON.stringify(b.model.requests[2]!.messages)).not.toContain("was edited after its turn");
    expect(await turnList(b)).toEqual([
      [made.id, kind, true],
      [replaced.id, "new", false],
      [first.id, "new", true],
    ]);
  });

  test("a delete takes its reply's turn off the path: the work still going on after the reply is stopped, the harness told, and the next turn told", async () => {
    const after = gate();
    const b = await bed({
      answers: [
        // The reply, then work after it that holds until the test lets it go.
        { pieces: [{ text: "<intent>One exchange, then a note.</intent>" }, { text: "<reply>The lamp turns.</reply>" }, { call: "todo", args: { items: [{ text: "note the storm", done: false }] } }] },
        { pieces: [{ hold: after }, { text: "Noted." }] },
        replying("Wren looks up from the brass."),
      ],
    });
    const generation = await play(b, "normal", "I climb the stairs.");
    const store = b.turns.store.user(USER);
    const turn = await b.until("the turn to be tied while its run goes on", () => {
      const run = b.turns.runs.byGeneration(USER, generation);
      const row = run === null ? null : store.turn(run.turn);
      return row?.status === "done" && b.turns.runs.running(USER, row.id) !== undefined ? row : null;
    });
    // Deleted while its work after the reply waits on its call, so the answer held for that call is its own.
    await b.until("the work after the reply to call its model", () => b.model.requests.length >= 2);
    b.host.deleteMessage(CHAT, turn.message!);
    await b.until("the deleted turn's run to stop", () => b.turns.runs.running(USER, turn.id) === undefined);
    expect(after.isOpen).toBe(false);
    expect(b.turns.runs.record(USER, turn.id)?.status).toBe("stopped");
    expect(b.left[0]).toMatchObject({ user: USER, chat: CHAT, turn: turn.id });

    const next = await settledTurn(b, await play(b, "normal", "I climb the stairs again."));
    expect(next.parent).toBeNull();
    expect(store.path(CHAT).map((e) => e.turn).filter((t) => t !== null)).toEqual([next.id]);
    expect(JSON.stringify(b.model.requests[2]!.messages)).toContain("1 turn(s) were deleted since the last one.");
    expect(await turnList(b)).toEqual([
      [next.id, "new", true],
      [turn.id, "new", false],
    ]);
  });

  test("a delete in the middle of the chat leaves a gap in Lumiverse's numbers, and play goes on over it: the window keeps exactly the latest messages and the turn is tied to its reply", async () => {
    // A window of two: the next prompt's history must be exactly the two latest of the chat's messages.
    const b = await bed({ answers: [replying("The lamp turns."), replying("Wren looks up."), replying("Wren waits by the lamp.")], global: "history:\n  window: 2\n" });
    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const second = await settledTurn(b, await play(b, "normal", "I look around."));
    // The first reply is deleted: Lumiverse's numbers keep a gap where it was (`services/chats.service.ts:3236-3240`), and the player's two
    // lines, now neighbours, reach the interceptor as one (`services/prompt-assembly.service.ts:6754-6843`).
    const first = b.host.chats.get(CHAT)!.messages.find((m) => m.content === "The lamp turns.")!;
    b.host.deleteMessage(CHAT, first.id);
    const next = await settledTurn(b, await play(b, "normal", "I wait."));
    expect(next).toMatchObject({ status: "done", hash: textHash("Wren waits by the lamp.") });
    expect(b.db.rows("SELECT index_in_chat AS n FROM messages WHERE chat_id = ? ORDER BY index_in_chat", CHAT).map((r) => r.n)).toEqual([0, 1, 3, 4, 5, 6]);
    const history = JSON.stringify(b.model.requests.at(-1)!.messages);
    for (const kept of ["Wren looks up.", "I wait."]) expect(history).toContain(kept);
    for (const gone of ["I climb the stairs.", "I look around.", "The lamp turns above you"]) expect(history).not.toContain(gone);
    expect(second.message).not.toBe(next.message);
  });

  test("a swipe of the chat's first turn follows no turn: RPH is asked with parent null, and carries nothing of the attempt it replaces", async () => {
    const b = await bed({ answers: [replying("The lamp turns.", "INTENT-FIRST-ATTEMPT"), replying("Wren taps the barometer.")] });
    const first = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const made = await settledTurn(b, await play(b, "swipe"));

    expect([first.parent, made.parent]).toEqual([null, null]);
    expect(b.requests.map((r) => r.parent)).toEqual([null, null]);
    expect(JSON.stringify(b.model.requests[1]!.messages)).not.toContain("INTENT-FIRST-ATTEMPT");
  });

  test("a continue extends the turn its message is tied to: the same turn, tied again to the joined text, its tokens added to the turn's", async () => {
    const reply = (text: string, usage: { input: number; output: number }) => ({ pieces: [{ text: "<intent>One exchange.</intent>" }, { text: `<reply>${text}</reply>` }], usage });
    const b = await bed({ answers: [reply("The lamp turns.", { input: 900, output: 40 }), reply("Then it stops, and Wren swears.", { input: 1100, output: 60 })] });
    const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const generation = await play(b, "continue");

    const joined = String(b.db.rows("SELECT content FROM messages WHERE id = ?", turn.message!)[0]!.content);
    expect(joined).toStartWith("The lamp turns.");
    expect(joined).toEndWith("Then it stops, and Wren swears.");
    const store = b.turns.store.user(USER);
    await b.until("the turn tied again to the joined text", () => store.turn(turn.id)?.hash === textHash(joined));
    expect(b.turns.runs.byGeneration(USER, generation)?.turn).toBe(turn.id);
    expect(store.turn(turn.id)).toMatchObject({ status: "done", message: turn.message, parent: null });
    expect(store.path(CHAT).filter((e) => e.turn !== null).map((e) => [e.message, e.turn])).toEqual([[turn.message, turn.id]]);
    expect(store.swipes(CHAT, turn.message!).map((t) => t.id)).toEqual([turn.id]);

    // What the turn spent is both runs' together, not the continue's alone.
    await b.until("the continue's run to be over", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
    const usages = b.turns.runs.ofTurn(USER, turn.id).map((r) => r.usage!);
    expect(usages).toHaveLength(2);
    expect(usages.map((u) => [u.input, u.output])).toEqual([
      [900, 40],
      [1100, 60],
    ]);
    expect(store.turn(turn.id)).toMatchObject({ tokensIn: 2000, tokensOut: 100 });
  });

  test("an impersonation kept as a draft saves no message, so its attempt is dropped and the chat's path and head are as they were", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("I nod and keep climbing.")] });
    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const store = b.turns.store.user(USER);
    const before = { path: store.path(CHAT), head: store.chat(CHAT)?.head, rows: b.db.rows("SELECT id, content FROM messages WHERE chat_id = ? ORDER BY index_in_chat", CHAT) };

    const attempt = await settledTurn(b, await play(b, "impersonate", undefined, true));
    expect(attempt).toMatchObject({ kind: "impersonate", status: "dropped", message: null });
    expect(store.path(CHAT)).toEqual(before.path);
    expect(store.chat(CHAT)?.head).toBe(before.head);
    expect(b.db.rows("SELECT id, content FROM messages WHERE chat_id = ? ORDER BY index_in_chat", CHAT)).toEqual(before.rows);
    expect((await turnList(b))[0]).toEqual([attempt.id, "impersonate", false]);
  });

  test("an impersonation is sent as Lumiverse ends it: the impersonation prompt before any prefill, a user message last, the player's draft after it, and the Author is handed it", async () => {
    const b = await bed({ answers: [replying("The lamp turns."), replying("I nod and keep climbing.")] });
    await settledTurn(b, await play(b, "normal", "I climb the stairs."));
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type: "impersonate", impersonateDraft: true, impersonateInput: "I nod and" });
    expect(out.error).toBeNull();
    const last = out.prompt.at(-1)!;
    expect(last.role).toBe("user");
    expect(textOf(last)).toMatch(/^\[Write your next reply from the point of view of .+\]\n\nI nod and$/s);
    await settledTurn(b, out.generationId!);
    expect(JSON.stringify(b.model.requests[1]!.messages)).toContain("point of view of");
  });
});

// A continue as Lumiverse makes one (plan §10.8, §10.10 "Continue": the same turn, extended; its changes are added to). Lumiverse
// announces a continue naming the swipe it goes on and no message, sends the prompt with that reply moved to its end, the preset's
// continue postfix on it and the continue nudge after it, and saves the text that swipe held, the postfix, then the new text. RPE plays
// it on a turn of its own that holds what it changes, and when Lumiverse's end names the message, joins it to the turn that message is
// tied to, ties that turn again to the joined text, and tells the next turn nothing of the join; a continue that saved only the join
// saved nothing new. And a continue plays in the session the turn it names played in, even where that turn moved the story on to a
// new scene. Played through the stand-in Lumiverse on the scripted model. The postfix is the preset's own: where a test leans on a
// single space, the bed's preset says it, as Lumiverse's default preset does (`src/auth/default-preset.ts:316`). Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { type Answer, gate } from "rp-harness/testing/rig";
import { textHash } from "../../src/adapter/lumiverse/wire";
import type { StopReply, TurnsReply } from "../../src/shared/api";
import { CONTINUE_NUDGE } from "../standin/assembly";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

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

async function play(b: TurnBed, type: "normal" | "continue", said?: string): Promise<string> {
  if (said !== undefined) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type });
  expect(out.error).toBeNull();
  return out.generationId!;
}

/** The Author's first call in a continue: its intent, then thirty minutes passed in the world, recorded on the turn. */
const PASS_TIME: Answer = { pieces: [{ text: "<intent>Then the storm.</intent>" }, { call: "world_apply", args: { operations: [{ op: "pass_time", minutes: 30, source: { from: "prose" } }] } }] };

/** The kinds of what the harness was told had happened since the last turn, in its `n`th request. */
const toldKinds = (b: TurnBed, n: number): string[] => b.requests[n]!.since.map((s) => s.kind);

/** The thinking Lumiverse kept with a reply RPE wrote: its progress lines. */
const KEPT_THINKING = "Reading the turn.\nWriting.\n";

/** The last `n` messages of the request Lumiverse sent the connection. */
const sentLast = (out: { body: Record<string, unknown> | null }, n: number): unknown[] => (out.body!.messages as unknown[]).slice(-n);

test("a continue as Lumiverse announces and saves it extends the turn its reply is tied to: the same turn, on the path, tied to the joined text, with what it recorded; the next turn is told nothing of the join", async () => {
  const b = await bed({ answers: [replying("The lamp turns."), PASS_TIME, replying("And the sea calms."), replying("Wren nods.")] });
  const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
  b.host.presets.get(PRESET)!.continuePostfix = " ";
  const store = b.turns.store.user(USER);
  const before = store.changes(turn.id);

  const continuing = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type: "continue" });
  expect(continuing.error).toBeNull();
  const generation = continuing.generationId!;
  // The reply it goes on is sent last, out of the history, with the postfix on it and the thinking Lumiverse kept with it (RPE's progress lines, `reasoning_content`,
  // `prompt-assembly.service.ts:3370-3394`), and the nudge after it (`:742-775`).
  expect(sentLast(continuing, 3)).toEqual([
    { role: "user", content: "I climb the stairs." },
    { role: "assistant", content: "The lamp turns. ", reasoning_content: KEPT_THINKING },
    { role: "system", content: CONTINUE_NUDGE },
  ]);
  await b.until("the continue's end to be recorded", () => (b.turns.runs.byGeneration(USER, generation)?.settled ?? null) !== null && b.turns.runs.ofChat(USER, CHAT).length === 0);
  expect(String(b.db.rows("SELECT content FROM messages WHERE id = ?", turn.message!)[0]!.content)).toBe("The lamp turns. And the sea calms.");
  expect(b.turns.runs.byGeneration(USER, generation)).toMatchObject({ turn: turn.id, target: turn.message, saved: null });
  expect(store.turn(turn.id)).toMatchObject({ status: "done", message: turn.message, hash: textHash("The lamp turns. And the sea calms.") });
  expect(store.changes(turn.id).slice(before.length).map((c) => [c.lane, c.applied])).toEqual([["engine", true]]);
  // The same turn, extended (plan §10.10): it stays the kind of the run that made it, its runs a new reply's and the continue's.
  const list = (await b.page<TurnsReply>("GET", `/api/v1/chats/${CHAT}/turns`)).body.turns;
  expect(list.map((t) => [t.id, t.kind, t.onPath, t.runs.map((r) => r.kind)])).toEqual([[turn.id, "new", true, ["new", "continue"]]]);

  const next = await settledTurn(b, await play(b, "normal", "I wait for the dawn."));
  expect(next.parent).toBe(turn.id);
  expect(toldKinds(b, 2)).not.toContain("saved-differs");
});

test.each([
  ["its own postfix", "\n\n"],
  ["no postfix, as the preset sets none", undefined],
] as const)("a continue Lumiverse saved with %s is not told as saved otherwise than released", async (_, postfix) => {
  const b = await bed({ answers: [replying("The lamp turns."), replying("And the sea calms."), replying("Wren nods.")] });
  if (postfix !== undefined) b.host.presets.get(PRESET)!.continuePostfix = postfix;
  const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
  const continuing = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type: "continue" });
  expect(continuing.error).toBeNull();
  // The same postfix, or none, on the reply in the prompt, with its kept thinking, and between the two texts when it is saved (`generate.service.ts:1969-1978`).
  expect(sentLast(continuing, 2)).toEqual([
    { role: "assistant", content: `The lamp turns.${postfix ?? ""}`, reasoning_content: KEPT_THINKING },
    { role: "system", content: CONTINUE_NUDGE },
  ]);
  await settledTurn(b, continuing.generationId!);
  expect(b.turns.store.user(USER).turn(turn.id)).toMatchObject({ status: "done", hash: textHash(`The lamp turns.${postfix ?? ""}And the sea calms.`) });
  await settledTurn(b, await play(b, "normal", "I wait for the dawn."));
  expect(toldKinds(b, 2)).not.toContain("saved-differs");
});

test("a continue stopped before its first word, which Lumiverse saved as the text and the preset's join, saved nothing new: what it recorded is taken back, and the next turn is told nothing of it", async () => {
  const b = await bed({ answers: [replying("The lamp turns."), PASS_TIME, { pieces: [{ hold: gate() }, { text: "<reply> Then it stops.</reply>" }] }, replying("Wren nods.")] });
  const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
  b.host.presets.get(PRESET)!.continuePostfix = " ";
  const store = b.turns.store.user(USER);
  const before = store.changes(turn.id);
  const continuing = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type: "continue" });
  // What it records is held on its own turn while it runs, never on the turn it continues.
  const held = await b.until("the continue to record its change on its own turn", () => {
    const going = b.turns.runs.ofChat(USER, CHAT)[0]?.held ?? null;
    return going !== null && store.changes(going).length > 0 ? going : null;
  });
  expect(store.changes(turn.id)).toEqual(before);
  // Stopped while its second call waits, so the answer held for it is its own, and the next turn is answered by the next.
  await b.until("the continue's second call", () => b.model.requests.length >= 3);
  expect((await b.page<StopReply>("POST", `/api/v1/chats/${CHAT}/turns/${held}/stop`)).body).toEqual({ stopped: true });
  const out = await continuing;
  expect(out.stopped).toBe(true);
  await b.until("the continue's end to be recorded", () => (b.turns.runs.byGeneration(USER, out.generationId!)?.settled ?? null) !== null);
  // Lumiverse kept the stopped continue, its thinking block holding RPE's progress line: the text and its join, nothing more.
  expect(String(b.db.rows("SELECT content FROM messages WHERE id = ?", turn.message!)[0]!.content)).toBe("The lamp turns. ");
  expect(store.changes(turn.id)).toEqual(before);
  expect(store.turn(turn.id)).toMatchObject({ status: "done", message: turn.message, hash: textHash("The lamp turns. ") });

  await settledTurn(b, await play(b, "normal", "I wait for the dawn."));
  const told = toldKinds(b, 2);
  for (const kind of ["cut-short", "saved-differs", "edit"]) expect(told).not.toContain(kind);
});

test("a continue of the turn that moved the story on to a new scene plays in the session that turn played in, with that turn's own work", async () => {
  const b = await bed({
    answers: [
      // The first turn opens the watch with `story_record`, after its intent record; the second closes it and opens the dawn.
      { pieces: [{ text: "<intent>The watch begins.</intent>" }, { call: "story_record", args: { operations: [{ op: "scene", new: true, title: "Night watch", place: "the lamp room", who: ["Wren Hale"] }] } }] },
      { pieces: [{ text: "<reply>Wren trims the wick.</reply>" }] },
      {
        pieces: [
          { text: "<intent>INTENT-MORNING Morning comes.</intent>" },
          {
            call: "story_record",
            args: {
              operations: [
                { op: "scene", close: true, summary: "Wren kept the light burning through the storm." },
                { op: "scene", new: true, title: "Dawn", place: "the gallery", who: ["Wren Hale"] },
              ],
            },
          },
        ],
      },
      { pieces: [{ text: "<reply>The sky greys over the sea.</reply>" }] },
      replying(" The gulls wake."),
    ],
  });
  await settledTurn(b, await play(b, "normal", "I climb the stairs."));
  const moved = await settledTurn(b, await play(b, "normal", "I wait for the light."));
  const played = b.requests[1]!.scope.session;
  // The turn closed the watch's session and opened the dawn's, as its work.
  expect(b.turns.store.user(USER).sessions(CHAT).map((s) => [s.openedBy === moved.id, s.closedBy === moved.id])).toContainEqual([true, false]);

  await settledTurn(b, await play(b, "continue"));
  expect(b.requests[2]).toMatchObject({ kind: "continue", parent: moved.id, scope: { session: played } });
  // Its end named the reply it went on: its run is that turn's, extended.
  expect(b.turns.runs.ofTurn(USER, moved.id).map((r) => r.kind)).toEqual(["new", "continue"]);
  expect(JSON.stringify(b.model.requests.at(-1)!.messages)).toContain("INTENT-MORNING");
});

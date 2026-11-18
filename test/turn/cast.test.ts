// The cast, plugged into the turn (plan §7.1, §7.3, §5.4): the Author writes a character's record with
// `cast_update`, and an agent that plays that character is given its views by the name its definition
// lists (`cast:self(…)`), laid out by their parts; the Author's briefing holds the views of those on
// stage that the briefing's header names; a secret a book attached to the chat marks can be held; the
// cast's facts count who the open scene has on stage; and what a sub-agent the lead drops, or a continue
// that saves nothing, wrote to the cast and the story is taken back with its changes. Played through the
// stand-in Lumiverse on the scripted model, a continue sent as Lumiverse sends one. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { type Answer, gate } from "rp-harness/testing/rig";
import { knowersOf } from "../../src/packs/minds/core/knowledge";
import type { TurnRow } from "../../src/store";
import { world } from "../iface/rig";
import { CONTINUE_NUDGE } from "../standin/assembly";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** The player says something and asks for a reply of this kind; gives the generation's id. */
async function play(b: TurnBed, type: "normal" | "continue", said?: string): Promise<string> {
  if (said !== undefined) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type });
  expect(out.error).toBeNull();
  return out.generationId!;
}

/** A turn's writes to the cast's and the story's records, as `[who wrote it, what]`: the agent's definition, and the item (a job's left out, as the take-back leaves them). */
function rowsOf(b: TurnBed, turn: string): { cast: string[][]; story: string[][] } {
  const of = (op: string): string[][] =>
    b.app.db
      .query<{ by: string | null; item: string }, [string, string, string]>("SELECT by, json_extract(value, '$.item') AS item FROM change WHERE user = ? AND turn = ? AND op = ? AND job IS NULL ORDER BY ord")
      .all(USER, turn, op)
      .map((r) => [r.by ?? "", r.item]);
  return { cast: of("cast.write"), story: of("story.write") };
}

/** One answer that makes one tool call, after the intent record when one is given. */
function calling(call: string, args: JsonObject, intent?: string): Answer {
  return { pieces: [...(intent !== undefined ? [{ text: `<intent>${intent}</intent>` }] : []), { call, args }] };
}

test("the Author casts a character with cast_update, and the agent that plays her is given her base by the name its definition lists", async () => {
  const b = await openTurnBed({
    off: ["rules/unsourced"],
    answers: [
      {
        pieces: [
          { text: "<intent>Wren answers for herself.</intent>" },
          {
            call: "cast_update",
            args: {
              operations: [
                { op: "cast", who: "Wren Hale", as: "principal", line: "The keeper of the light." },
                { op: "base", who: "Wren Hale", seed: "SEED-WREN She keeps the Gannet Rock light alone.", soul: "SOUL-WREN The lamp must never go dark." },
              ],
            },
          },
        ],
      },
      { pieces: [{ call: "delegate", args: { agent: "character", brief: "The player asks whether the boat came.", plays: "Wren Hale" } }] },
      { pieces: [{ text: "I look past him at the sea. It is late." }] },
      { pieces: [{ text: "<reply>Wren looks past you at the sea. \"It's late.\"</reply>" }] },
    ],
  });
  beds.push(b);
  b.host.send(CHAT, "I ask whether the boat came.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  await settledTurn(b, out.generationId!);

  // The Author's own requests hold no view of hers; the request of the agent that plays her (which knows nothing of the Author's
  // call that wrote her) holds her base, as its layout lays it out.
  const sent = b.model.requests.map((r) => JSON.stringify(r.messages));
  expect(sent).toHaveLength(4);
  expect(sent[0]).not.toContain("SEED-WREN");
  expect(sent[2]).not.toContain("Wren answers for herself.");
  expect(sent[2]).toContain("Seed: SEED-WREN She keeps the Gannet Rock light alone.");
  expect(sent[2]).toContain("SOUL-WREN The lamp must never go dark.");
});

test("the cast's facts count who the open scene has on stage with no perception of the turn; a turn with no scene recorded counts nobody", async () => {
  const b = await openTurnBed({
    off: ["rules/unsourced", "rules/perceptions-owed"],
    answers: [
      calling("cast_update", { operations: [{ op: "cast", who: "Wren Hale", as: "principal", line: "The keeper of the light." }] }, "Wren is cast."),
      { pieces: [{ text: "<reply>The lamp turns.</reply>" }] },
      calling("story_record", { operations: [{ op: "scene", new: true, title: "Night watch", place: "the lamp room", who: ["Wren Hale"] }] }, "The watch begins."),
      { pieces: [{ text: "<reply>Wren trims the wick.</reply>" }] },
    ],
  });
  beds.push(b);
  const first = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
  const second = await settledTurn(b, await play(b, "normal", "I watch her work."));
  // The facts as a rule's trigger reads them, through the port the harness is given.
  const facts = async (turn: TurnRow) => b.turns.env.facts.read({ user: USER, chat: CHAT, session: b.turns.runs.record(USER, turn.id)!.session, turn: turn.id }, ["stage.unperceived", "path.unperceived"]);

  // The first turn recorded no scene: nobody was on stage, though Wren is cast.
  expect((await facts(first))["stage.unperceived"]).toMatchObject({ count: 0, names: [] });
  // The second opened one with Wren in it, and nothing she perceived of it is recorded; the turn before it had no stage to count.
  const atSecond = await facts(second);
  expect(atSecond["stage.unperceived"]).toMatchObject({ count: 1, names: ["Wren Hale"], by: { principal: 1, uncast: 0 }, namesBy: { principal: ["Wren Hale"] } });
  expect(atSecond["path.unperceived"]).toMatchObject({ count: 0, names: [] });
});

test("what a sub-agent the Author drops wrote to the cast and to the story is taken back, and what the Author wrote stays", async () => {
  const held = gate();
  const b = await openTurnBed({
    off: ["rules/unsourced"],
    answers: [
      calling("cast_update", { operations: [{ op: "cast", who: "Wren Hale", as: "principal" }] }, "Two helpers, one kept."),
      calling("delegate", { agent: "gm", brief: "Cast the boatman." }),
      calling("cast_update", { operations: [{ op: "cast", who: "Bram Coyle", as: "supporting" }] }),
      { pieces: [{ text: "Bram is cast." }] },
      calling("delegate", { agent: "keeper", brief: "Note the storm." }),
      calling("story_record", { operations: [{ op: "thread", text: "THREAD-DROPPED Will the storm break?", kind: "question" }] }),
      { pieces: [{ text: "Noted." }] },
      { pieces: [{ hold: held }, { call: "tool_use", args: { name: "agent_drop", args: { agent: "gm-1" } } }] },
      calling("tool_use", { name: "agent_drop", args: { agent: "keeper-1" } }),
      { pieces: [{ text: "<reply>The lamp turns.</reply>" }] },
    ],
  });
  beds.push(b);
  b.host.send(CHAT, "I ask about the boat.");
  const playing = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });

  // Before the drops, the turn holds what all three wrote.
  const turn = await b.until("the gm's and the keeper's rows on the turn", () => {
    const run = b.turns.runs.ofChat(USER, CHAT)[0];
    if (run === undefined) return null;
    const rows = rowsOf(b, run.turn);
    return rows.cast.some(([by]) => by === "gm") && rows.story.some(([by]) => by === "keeper") ? run.turn : null;
  });
  expect(rowsOf(b, turn).cast.map(([by]) => by)).toContain("author");
  held.open();
  const out = await playing;
  expect(out.error).toBeNull();
  await settledTurn(b, out.generationId!);

  const after = rowsOf(b, turn);
  expect(after.cast.length).toBeGreaterThan(0);
  expect(after.cast.every(([by]) => by === "author")).toBe(true);
  expect(after.story).toEqual([]);
});

test("a continue that saves nothing new takes back what it wrote to the cast and to the story, and what the turn wrote before stays", async () => {
  const b = await openTurnBed({
    off: ["rules/unsourced"],
    answers: [
      calling("cast_update", { operations: [{ op: "cast", who: "Wren Hale", as: "principal" }] }, "Wren is cast."),
      calling("story_record", { operations: [{ op: "thread", text: "THREAD-KEPT Will the boat come?", kind: "question" }] }),
      { pieces: [{ text: "<reply>The lamp turns.</reply>" }] },
      calling("cast_update", { operations: [{ op: "cast", who: "Bram Coyle", as: "supporting" }] }, "Then the boat."),
      calling("story_record", { operations: [{ op: "thread", text: "THREAD-GONE Who is aboard?", kind: "question" }] }),
      { pieces: [], end: { error: "The provider went away." } },
    ],
  });
  beds.push(b);
  const turn = await settledTurn(b, await play(b, "normal", "I climb the stairs."));
  const before = rowsOf(b, turn.id);
  expect(before.cast.length).toBeGreaterThan(0);
  expect(before.story.length).toBeGreaterThan(0);

  const continuing = b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type: "continue" });
  // What it writes is held on its own turn while it runs: the turn it continues holds none of it at any point.
  const held = await b.until("the continue to write to the story on its own turn", () => {
    const going = b.turns.runs.ofChat(USER, CHAT)[0]?.held ?? null;
    return going !== null && rowsOf(b, going).story.length > 0 ? going : null;
  });
  expect(rowsOf(b, held).cast.length).toBeGreaterThan(0);
  expect(rowsOf(b, turn.id)).toEqual(before);
  const out = await continuing;
  expect(out.error).not.toBeNull();
  // The continue was sent as Lumiverse sends it: the reply it goes on with last, out of the history, with no postfix, as the preset sets
  // none, and the nudge after it (`prompt-assembly.service.ts:742-775`, `generate.service.ts:1969-1978`). The reply carries back, as its
  // thinking, the progress lines RPE streamed for it (`keepInHistory` by default, `prompt-assembly.service.ts:3370-3394`).
  expect((out.body!.messages as unknown[]).slice(-2)).toEqual([
    { role: "assistant", content: "The lamp turns.", reasoning_content: expect.any(String) },
    { role: "system", content: CONTINUE_NUDGE },
  ]);
  await b.until("the continue's end to be recorded", () => (b.turns.runs.byGeneration(USER, out.generationId!)?.settled ?? null) !== null);

  expect(rowsOf(b, turn.id)).toEqual(before);
});

test("the Author's briefing holds the views of those on stage its header names: the history of a principal, not of a supporting character", async () => {
  // The rules that ask for the perceptions of those on stage would ask for calls this test does not script.
  const b = await openTurnBed({
    off: ["rules/unsourced", "rules/turn-unrecorded", "rules/perceptions-missing", "rules/perceptions-owed"],
    answers: [
      calling(
        "cast_update",
        {
          operations: [
            { op: "cast", who: "Wren Hale", as: "principal" },
            { op: "history", who: "Wren Hale", text: "HISTORY-WREN She lit the lamp the night the Mary Bell went down." },
            { op: "cast", who: "Bram Coyle", as: "supporting" },
            { op: "history", who: "Bram Coyle", text: "HISTORY-BRAM He rowed out for the drowned." },
          ],
        },
        "The two at the light are cast.",
      ),
      calling("story_record", { operations: [{ op: "scene", new: true, title: "Night watch", place: "the lamp room", who: ["Wren Hale", "Bram Coyle"] }] }),
      { pieces: [{ text: "<reply>The lamp turns.</reply>" }] },
      replying("Wren trims the wick."),
    ],
  });
  beds.push(b);
  await settledTurn(b, await play(b, "normal", "I climb the stairs."));
  await settledTurn(b, await play(b, "normal", "I watch them work."));

  // The first turn began with no scene open, so nobody was on stage; the second has both, and is given Wren's history alone.
  const onStage = b.requests.map((r) => r.briefing.find((block) => block.name === "on-stage")?.text ?? null);
  expect(onStage[0]).toBeNull();
  expect(onStage[1]).toBe("### Wren Hale's history in the story\n- HISTORY-WREN She lit the lamp the night the Mary Bell went down.");
  const seen = JSON.stringify(b.model.requests.at(-1)?.messages);
  expect(seen).toContain("## On stage");
  expect(seen).toContain("HISTORY-WREN");
});

test("a secret a book attached to the chat marks is held once perceived; one of a book the chat does not have is not", async () => {
  const attached = "wi:wb-vale:wbe-cellar:0";
  const elsewhere = "wi:wb-other:wbe-well:0";
  const b = await openTurnBed({
    answers: [
      calling("cast_update", { operations: [{ op: "cast", who: "Odile", as: "principal" }] }, "Odile goes down to the cellar."),
      calling("perceive", { perceptions: [{ who: "Odile", reach: "whole", content: "She finds the seal in the cellar, and it is wrong.", secrets: [attached, elsewhere] }] }),
      { pieces: [{ text: "<reply>Odile holds the seal to the lamp.</reply>" }] },
    ],
  });
  beds.push(b);
  await playsWorld(b, world());
  b.db.run("INSERT INTO world_books (id, name, user_id) VALUES (?, ?, ?)", "wb-vale", "Vale Book", USER);
  b.db.run("INSERT INTO world_books (id, name, user_id) VALUES (?, ?, ?)", "wb-other", "Other Book", USER);
  b.db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment) VALUES (?, ?, ?, ?, ?, ?)", "wbe-cellar", "wb-vale", "1", "[]", "The cellar runs under the square.\n{{// Secret: The reeve   forged the seal.}}", "The cellar");
  b.db.run("INSERT INTO world_book_entries (id, world_book_id, uid, key, content, comment) VALUES (?, ?, ?, ?, ?, ?)", "wbe-well", "wb-other", "1", "[]", "The well is dry.\n{{// Secret: The well hides the bell.}}", "The well");
  b.db.run("UPDATE chats SET metadata = ? WHERE id = ?", JSON.stringify({ chat_world_book_ids: ["wb-vale"] }), CHAT);
  await settledTurn(b, await play(b, "normal", "I send Odile down to the cellar."));

  const minds = (b.turns.store.user(USER).headState(CHAT).state.world.packs.minds ?? {}) as { knowledge?: { facts: Record<string, JsonObject> } };
  expect(minds.knowledge?.facts[attached]).toMatchObject({ id: attached, kind: "wi", claim: "The reeve forged the seal.", truth: "true" });
  expect(knowersOf(minds as never, attached)).toEqual(["odile"]);
  expect(minds.knowledge?.facts[elsewhere]).toBeUndefined();
  expect(knowersOf(minds as never, elsewhere)).toEqual([]);
});

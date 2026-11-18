// How a Settle now run's end is told (plan §10.10, §14 the Turn page): it owes no reply, so ending with none is it settling, its
// own end with no error; at a limit it ends as itself. Either way the turn keeps the state its reply gave it, on its own route and in
// the chat's list, with the Settle now run listed beside it; a settled run is no warning in RPE's log, sends nothing in place of a
// reply line, and one at a limit is told as the end of a run whose reply had gone out. Played through the stand-in Lumiverse on the
// scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { Answer } from "rp-harness/testing/rig";
import type { TurnReply, TurnsReply } from "../../src/shared/api";
import { world } from "../iface/rig";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed, type TurnBedOptions, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(options: TurnBedOptions): Promise<TurnBed> {
  const b = await openTurnBed(options);
  beds.push(b);
  await playsWorld(b, world());
  return b;
}

const passing = (minutes: number, intent?: string): Answer => ({ pieces: [...(intent !== undefined ? [{ text: `<intent>${intent}</intent>` }] : []), { call: "world_apply", args: { operations: [{ op: "pass_time", minutes, source: { from: "prose" } }] } }] });

/** A turn played and its reply tied, then Settle now pressed and its run over: the turn's id and the Settle now run's. */
async function playedAndSettled(b: TurnBed): Promise<{ turn: string; settle: string }> {
  b.host.send(CHAT, "I climb the stairs.");
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  const turn = await settledTurn(b, out.generationId!);
  b.host.editMessage(CHAT, turn.message!, "The lamp turns, and an hour slips by.");
  const pressed = await b.page<{ turn: string; run: string }>("POST", `/api/v1/chats/${CHAT}/settle`);
  expect(pressed.status).toBe(200);
  await b.until("the Settle now run to end", () => b.turns.runs.ofChat(USER, CHAT).length === 0);
  return { turn: turn.id, settle: pressed.body.run };
}

/** The turn on its own route and in the chat's list: its state and error, and each run's kind, state and error code. */
async function shown(b: TurnBed, turn: string) {
  const read = (await b.page<TurnReply>("GET", `/api/v1/chats/${CHAT}/turns/${turn}`)).body;
  const listed = (await b.page<TurnsReply>("GET", `/api/v1/chats/${CHAT}/turns`)).body.turns.find((t) => t.id === turn);
  return { status: read.status, error: read.error, runs: read.runs.map((r): unknown[] => [r.kind, r.status, r.error?.code ?? null]), listed: listed?.status, listedRuns: listed?.runs.map((r): unknown[] => [r.kind, r.status, r.error?.code ?? null]) };
}

test("a Settle now run that ends with no reply has settled: the turn keeps its reply's state, the run is listed beside it with no error, nothing is warned of, and no last text goes out", async () => {
  const b = await bed({
    off: [],
    // With the last plain text set, a run that owes a reply sends it in place of the line; a Settle now run owes none.
    global: "reply:\n  lastText: true\n",
    answers: [passing(30, "Half an hour at the lamp."), replying("The lamp turns."), passing(60), { pieces: [{ text: "The hour is recorded." }] }],
  });
  const { turn, settle } = await playedAndSettled(b);

  const runs = [
    ["new", "released", null],
    ["settle", "no-reply", null],
  ];
  expect(await shown(b, turn)).toEqual({ status: "released", error: null, runs, listed: "released", listedRuns: runs });
  expect(b.turns.runs.ofTurn(USER, turn).at(-1)).toMatchObject({ id: settle, kind: "settle", status: "no-reply", error: null, released: null, lastText: false, reply: "" });
  expect(b.logged.filter((l) => l.fields?.run === settle && (l.level === "warn" || l.level === "error"))).toEqual([]);
});

test("a Settle now run that reaches a limit ends at it, as itself: the turn keeps its reply's state, and the log tells it as the end of a run whose reply had gone out", async () => {
  // The reply's run spends the turn's two calls; the Settle now run, which goes on with the turn, has none left.
  const b = await bed({ global: "limits:\n  turn:\n    calls: 2\n", answers: [passing(30, "Half an hour at the lamp."), replying("The lamp turns.")] });
  const { turn, settle } = await playedAndSettled(b);

  expect(await shown(b, turn)).toMatchObject({
    status: "released",
    error: null,
    runs: [
      ["new", "released", null],
      ["settle", "limit", "limit"],
    ],
    listed: "released",
  });
  const warned = b.logged.filter((l) => l.fields?.run === settle && l.level === "warn").map((l) => l.message);
  expect(warned).toEqual(["A turn's run ended stopped where it stood: The turn reached its limit of 2 on calls after its reply began to go out, so its record of what the reply says was not finished."]);
});

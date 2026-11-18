// A press from a panel that its turn did not carry out, nor had the world refuse (plan §10.10 "A panel action"): the chat's state
// view, where you play, shows it as not carried out (`notCarried`) until you send it again, which holds it for your next message once
// more, or drop it; it is never silently gone. A swipe shown in its place answers for it. Played through the stand-in Lumiverse on the
// scripted model, on a starter world, with the reminder of a press owed (`press-owed`) off, so the run ends as scripted. Every name is
// invented.

import { afterEach, expect, test } from "bun:test";
import type { Answer } from "rp-harness/testing/rig";
import { STARTER_WORLDS } from "../../src/packs/index";
import { TIMELAPSE_ACTION } from "../../src/play/state/palette";
import type { StateView } from "../../src/shared/state-view";
import { CHAT, CONNECTION, openTurnBed, playsWorld, PRESET, replying, settledTurn, type TurnBed } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

async function bed(answers: Answer[]): Promise<TurnBed> {
  const b = await openTurnBed({ answers, off: ["rules/press-owed"] });
  beds.push(b);
  await playsWorld(b, STARTER_WORLDS.fantasy_town("w-harbour", "Harbour"));
  return b;
}

async function play(b: TurnBed, said: string | null): Promise<string> {
  if (said !== null) b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, ...(said === null ? { type: "swipe" as const } : {}) });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

async function press(b: TurnBed): Promise<string> {
  const held = await b.page<{ request: { id: string } }>("POST", `/api/v1/chats/${CHAT}/requests/panel`, { action: TIMELAPSE_ACTION, values: { label: "Walk here" }, from: "palette" });
  expect(held.status).toBe(200);
  return held.body.request.id;
}

/** What the state view shows of presses: what waits for the next message, and what was not carried out, by request and label. */
async function shown(b: TurnBed): Promise<{ staged: string | null; notCarried: { request: string; label: string }[] }> {
  const view = await b.page<StateView>("GET", `/api/v1/chats/${CHAT}/state`);
  expect(view.status).toBe(200);
  return { staged: view.body.staged?.label ?? null, notCarried: (view.body.notCarried ?? []).map((p) => ({ request: p.request, label: p.label })) };
}

const acting: Answer = { pieces: [{ text: "<intent>The press is the player's move: walk.</intent>" }, { call: "world_apply", args: { operations: [{ op: "act", action: TIMELAPSE_ACTION, params: { label: "Walk here" }, source: "player" }] } }] };

test("a press its turn did not carry out is shown as not carried out, through the turns after, until sent again or dropped", async () => {
  const b = await bed([replying("The square is quiet."), replying("You look about."), replying("Gulls."), acting, replying("You walk across the square."), replying("Dusk.")]);
  await play(b, "I wait in the square.");
  const id = await press(b);
  expect(await shown(b)).toEqual({ staged: "Walk here", notCarried: [] });
  await play(b, "I look about.");
  // The turn told of it did not act: it is not carried out, and waits for nothing.
  expect(await shown(b)).toEqual({ staged: null, notCarried: [{ request: id, label: "Walk here" }] });
  // A turn after it does not take it away.
  await play(b, "I listen.");
  expect((await shown(b)).notCarried).toEqual([{ request: id, label: "Walk here" }]);

  // Send again: it waits for the next message once more, and is no longer shown as not carried out; the turn that acts on it answers it.
  const again = await b.page<{ request: { id: string } }>("POST", `/api/v1/chats/${CHAT}/requests/${id}/again`);
  expect(again.status).toBe(200);
  expect(again.body.request.id).not.toBe(id);
  expect(await shown(b)).toEqual({ staged: "Walk here", notCarried: [] });
  await play(b, "I go.");
  expect(await shown(b)).toEqual({ staged: null, notCarried: [] });

  // A press of it again, not carried out, then dropped: shown no more; and it cannot be dropped or sent again twice.
  const second = await press(b);
  await play(b, "I stay.");
  expect((await shown(b)).notCarried).toEqual([{ request: second, label: "Walk here" }]);
  expect((await b.page("POST", `/api/v1/chats/${CHAT}/requests/${second}/drop`)).status).toBe(200);
  expect(await shown(b)).toEqual({ staged: null, notCarried: [] });
  expect((await b.page("POST", `/api/v1/chats/${CHAT}/requests/${second}/drop`)).status).toBe(404);
  expect((await b.page("POST", `/api/v1/chats/${CHAT}/requests/${second}/again`)).status).toBe(404);
});

test("a swipe that carries the press out answers it for the path; one that waits for the next message cannot be dropped", async () => {
  const b = await bed([replying("The square is quiet."), replying("You look about."), acting, replying("You walk across the square.")]);
  await play(b, "I wait in the square.");
  const id = await press(b);
  expect((await b.page("POST", `/api/v1/chats/${CHAT}/requests/${id}/drop`)).status).toBe(404);
  await play(b, "I look about.");
  expect((await shown(b)).notCarried).toEqual([{ request: id, label: "Walk here" }]);
  await play(b, null);
  expect(await shown(b)).toEqual({ staged: null, notCarried: [] });
});

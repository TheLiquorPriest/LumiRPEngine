// A turn joined to another is answered as a fact (the lead's ruling on PlanStore-19, widened): a
// continue's held turn is joined to the turn it extended, and every route that takes a turn's id
// answers a request for the held turn with status 409 and `{ joined: { turn, joined } }`, never as a
// server error and logging no failure. The check reads the route table, not a list kept here: a route
// added later that takes a turn's id fails it on the day it is added if it does not declare the answer.
// Played through RPE as composed over the stand-in Lumiverse. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { paramsOf } from "../../src/app";
import { pathOf } from "../../src/ui/client";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "../turn/bed";
import { askOf, keyOf } from "./asking";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

/** A bed whose chat has had one turn and has a continue's held turn joined to it: the held turn's id, and the turn it joined. */
async function joinedBed(): Promise<{ b: TurnBed; held: string; first: string }> {
  const b = await openTurnBed({ answers: [replying("The tide turns.")] });
  beds.push(b);
  b.host.send(CHAT, "I watch the harbour.");
  const { generationId, error } = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(error).toBeNull();
  const first = await settledTurn(b, generationId ?? "");
  const store = b.turns.store.user(USER);
  // The player asked the reply to go on: what the continue changed is held on a turn of its own, which joins the turn it extended.
  const held = await b.app.writes.run(() => {
    const turn = store.beginTurn({ chat: CHAT, kind: "continue", on: first.node });
    store.joinTurn(turn.id, first.id);
    return turn.id;
  });
  expect(store.joinedTo(held)).toBe(first.id);
  return { b, held, first: first.id };
}

test("every declared route whose path, query or body holds a turn id declares the joined answer", async () => {
  const { b } = await joinedBed();
  const routes = b.app.routes.list();
  const taking = routes.filter((r) => r.declared.turn);
  // The routes of the turn, the cast, the story and the play panels that take one: more than a handful, found in the table.
  expect(taking.length).toBeGreaterThan(5);
  expect(taking.map(keyOf)).toContain("GET /api/v1/chats/:chat/turns/:turn");
  expect(taking.filter((r) => !r.declared.joined).map(keyOf)).toEqual([]);
  // And the answer is declared by no route that takes none.
  expect(routes.filter((r) => r.declared.joined && !r.declared.turn).map(keyOf)).toEqual([]);
  // A param named turn is a turn's id wherever it stands.
  expect(routes.filter((r) => paramsOf(r.path).includes("turn") && !r.declared.turn).map(keyOf)).toEqual([]);
});

test("each, asked with a joined turn's id, answers 409 naming the turn it joined, and logs no failure", async () => {
  const { b, held, first } = await joinedBed();
  const taking = b.app.routes.list().filter((r) => r.declared.turn);
  const failures = (): number => b.logged.filter((l) => l.level === "error").length;
  const before = failures();
  const answers: { route: string; status: number; body: unknown }[] = [];
  for (const route of taking) {
    if (route.method !== "GET" && route.method !== "POST") throw new Error(`${keyOf(route)} takes a turn's id and is neither a GET nor a POST; the test asks only those.`);
    const { params, query, body } = askOf(route, { chat: CHAT, turn: held });
    const { status, body: answered } = await b.page<unknown>(route.method, pathOf(route.path, params, query), body);
    answers.push({ route: keyOf(route), status, body: answered });
  }
  expect(answers.map(({ route }) => route)).toEqual(taking.map(keyOf));
  expect(answers.filter((a) => a.status !== 409 || JSON.stringify(a.body) !== JSON.stringify({ joined: { turn: held, joined: first } }))).toEqual([]);
  expect(failures()).toBe(before);
});

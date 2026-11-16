// turn_carried: what the earlier build recorded on a migrated turn is read, part by part, word for word, and a turn joined to another is told. Every name is invented.

import { expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import type { CarriedRecord } from "../../../src/iface/kit";
import { CHAT, dataOf, rig, texts, USER } from "../rig";

const LONG = "a".repeat(120);

test("a carried turn's record is listed, read a stretch at a time, and a turn joined to another is told and read no further", async () => {
  const t = await rig({
    settings: { carriedChars: 50 },
    carried: {
      record: (user, turn): CarriedRecord | null =>
        user === USER && turn === t0.turn
          ? { turn, chat: CHAT, message: "m-1", swipe: 0, engine: "agents", fields: [{ name: "session", value: { id: "s-9" } }], texts: [{ part: "session", path: "sessions/s-9/notes.md", text: LONG }, { part: "session", path: "sessions/s-9/old.md", text: null }], unplayed: null, departures: ["it said the gate stayed shut"] }
          : null,
    },
  });
  const t0 = { turn: t.turn.id };
  const ctx = (turn: string) => ({ scope: { user: USER, chat: CHAT, session: "s-1", turn }, agent: { id: "gm-1", definition: "gm" }, run: "run-1", callId: `call-${Math.random()}`, signal: new AbortController().signal, onUpdate: () => undefined });
  const read = (args: JsonObject, turn = t.turn.id) => t.tools.get("turn_carried")!.run(args, ctx(turn));

  const listed = dataOf(await read({}));
  expect(listed).toMatchObject({ engine: "agents", departures: 1 });
  expect(JSON.stringify(listed.texts)).toContain("sessions/s-9/notes.md");

  const first = await read({ part: "sessions/s-9/notes.md" });
  expect(dataOf(first)).toMatchObject({ from: 0, to: 50, of: 120 });
  expect(texts(first).join(" ")).toContain("send from 50 to read on");
  const last = dataOf(await read({ part: "sessions/s-9/notes.md", from: 100 }));
  expect(last).toMatchObject({ from: 100, to: 120, text: "a".repeat(20) });

  expect(texts(await read({ part: "sessions/s-9/old.md" })).join(" ")).toContain("was removed");
  expect((await read({ part: "session" })).error).toBeUndefined();
  expect(texts(await read({ part: "sesion" })).join(" ")).toContain("Near: session");

  // A turn joined to another is told, never followed.
  await t.writes.run(() => t.s.tieTurn(t.turn.id, { message: "m-1", hash: "h-1" }));
  const held = await t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "continue" }));
  await t.writes.run(() => t.s.joinTurn(held.id, t.turn.id));
  const joined = await read({ turn: held.id });
  expect(joined.error).toBe(true);
  expect(texts(joined)[0]).toContain(`was joined to turn ${t.turn.id}`);
});

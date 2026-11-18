// `unsourced.writes` and `turn.recorded` count only what an agent's own call wrote: RPE's own record of the knowledge switch, which
// names no source and no agent, is neither a write a reminder can ask an agent to source nor a thing the turn's agents recorded; and a
// reminder due for one agent counts that agent's writes, never another's it cannot put right. What is left to settle (`unsettledOf`,
// the briefing's "Not yet sure, sourced or applied" and the Turn page's list) leaves out the same, and keeps a person's own changes.

import { describe, expect, test } from "bun:test";
import type { AgentRef } from "rp-harness/contract";
import { KNOWLEDGE_BY, KNOWLEDGE_LANE } from "../../src/lore";
import { MINDS_EVENTS } from "../../src/shared/minds";
import { turnFacts } from "../../src/turn/facts";
import { CHAT, openBench, USER } from "../cast/rig";

const AUTHOR: AgentRef = { id: "author-1", definition: "author" };
const GM: AgentRef = { id: "gm-1", definition: "gm", parent: "author-1" };

describe("unsourced.writes", () => {
  test("counts the reminded agent's own writes with no source, never RPE's own record or another agent's", async () => {
    const b = await openBench();
    const turn = await b.t.begin();
    // RPE records the knowledge switch and threshold at the turn's start, by itself and with no source.
    const value = { type: MINDS_EVENTS.knowledge, data: { on: true, threshold: 0.8 } };
    await b.t.writes.run(() => b.t.store.user(USER).record(b.t.store.user(USER).writeTarget({ chat: CHAT, turn: turn.id }), [{ lane: KNOWLEDGE_LANE, op: MINDS_EVENTS.knowledge, value, by: KNOWLEDGE_BY }]));
    // The Author casts Bram, the GM casts Odile, neither naming a source.
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id, AUTHOR);
    await b.call("cast_update", { operations: [{ op: "cast", who: "Odile", as: "supporting" }] }, turn.id, GM);
    const changes = b.t.store.user(USER).changes(turn.id);
    const unsourced = (handle: string | null) => changes.filter((c) => c.handle === handle && c.source === null).length;
    // Each agent wrote at least one unsourced change, and RPE's own record is one too: the count the reminder showed before.
    expect(unsourced(AUTHOR.id)).toBeGreaterThan(0);
    expect(unsourced(GM.id)).toBeGreaterThan(0);
    expect(unsourced(null)).toBe(1);

    const facts = turnFacts(b.t.store, { runs: () => [], stopped: () => 0, story: async () => ({ from: "lumiverse", newest: "directive" }), told: () => new Set() });
    const scope = { user: USER, chat: CHAT, session: "s-1", turn: turn.id };
    const read = async (agent?: AgentRef) => await facts.read(scope, ["unsourced.writes", "turn.recorded"], agent);
    expect((await read(AUTHOR))["unsourced.writes"]).toEqual({ count: unsourced(AUTHOR.id) });
    expect((await read(GM))["unsourced.writes"]).toEqual({ count: unsourced(GM.id) });
    // Read for no agent, every agent's own; RPE's record is in neither count.
    const whole = await read();
    expect(whole["unsourced.writes"]).toEqual({ count: unsourced(AUTHOR.id) + unsourced(GM.id) });
    expect(whole["turn.recorded"]).toEqual({ count: changes.filter((c) => c.handle !== null).length });
    expect(changes.length).toBeGreaterThan(changes.filter((c) => c.handle !== null).length);
  });

  test("what is left to settle leaves out what the count leaves out, RPE's own record and a migration's row, and keeps a person's change", async () => {
    const b = await openBench();
    const u = b.t.store.user(USER);
    const turn = await b.t.begin();
    const value = { type: MINDS_EVENTS.knowledge, data: { on: true, threshold: 0.8 } };
    await b.t.writes.run(() => u.record(u.writeTarget({ chat: CHAT, turn: turn.id }), [{ lane: KNOWLEDGE_LANE, op: MINDS_EVENTS.knowledge, value, by: KNOWLEDGE_BY }]));
    // A migration's row that names no source (the previous build's carried write): none of anyone's to settle now.
    await b.t.writes.run(() => u.record(u.writeTarget({ chat: CHAT, turn: turn.id }), [{ lane: KNOWLEDGE_LANE, op: MINDS_EVENTS.knowledge, value, by: "migration" }]));
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id, AUTHOR);
    await b.call("cast_update", { operations: [{ op: "cast", who: "Odile", as: "supporting" }] }, turn.id, GM);
    const tied = await b.t.tie(turn);
    // The person's own change after the reply, with no source: his to settle.
    await b.t.writes.run(() => u.record(u.writeTarget({ chat: CHAT, turn: null, job: null }), [{ lane: KNOWLEDGE_LANE, op: MINDS_EVENTS.knowledge, value, by: "player" }]));
    const changes = u.changes(tied.id);
    expect(changes.filter((c) => c.handle === null && c.source === null).map((c) => c.by)).toEqual([KNOWLEDGE_BY, "migration"]);

    const listed = u.unsettledOf(CHAT, tied.id);
    const facts = turnFacts(b.t.store, { runs: () => [], stopped: () => 0, story: async () => ({ from: "lumiverse", newest: "directive" }), told: () => new Set() });
    const counted = (await facts.read({ user: USER, chat: CHAT, session: "s-1", turn: tied.id }, ["unsourced.writes"]))["unsourced.writes"];
    // Of the turn's own changes, the list's unsourced ones are exactly those the count counts.
    const listedOfTurn = listed.filter((l) => l.turn === tied.id);
    expect(listedOfTurn.filter((l) => l.why.includes("unsourced")).length).toBe(counted?.count ?? -1);
    expect(listedOfTurn.every((l) => l.change.handle !== null)).toBe(true);
    expect(listed.some((l) => l.change.by === KNOWLEDGE_BY || l.change.by === "migration")).toBe(false);
    // Between the turns, the person's own.
    expect(listed.filter((l) => l.turn === null).map((l) => [l.change.by, l.why])).toEqual([["player", ["unsourced"]]]);
  });
});

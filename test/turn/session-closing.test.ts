// What closed a closed session and when, from RPE's own records: your close by the change in the story record, a job's end by its record, a
// scene's or a run's by the end of the turn's run that closed it.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { SessionView } from "rp-harness/contract";
import { closingOf } from "../../src/turn/session-routes";

const closed = (over: Partial<SessionView>): SessionView => ({ id: "s", user: "u", chat: "c", kind: "scene", state: "closed", opened: 1, turns: 1, ...over });

describe("what closed a session", () => {
  const db = new Database(":memory:");
  db.run("CREATE TABLE job (user TEXT, id TEXT, ended INTEGER)");
  db.run("CREATE TABLE turn_run (user TEXT, turn TEXT, received INTEGER, ended INTEGER)");
  db.run("CREATE TABLE change (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT, lane TEXT, by TEXT, value TEXT, created INTEGER)");
  db.run("INSERT INTO job VALUES ('u', 'j1', 9000)");
  db.run("INSERT INTO turn_run VALUES ('u', 't1', 1000, 1500), ('u', 't2', 2000, NULL)");
  db.run("INSERT INTO change (user, lane, by, value, created) VALUES ('u', 'story', 'player', ?, 7000)", [JSON.stringify({ part: "scene", item: "sc-1", value: { close: true } })]);

  test("you, a turn's scene change, a run's end and a job's end, each with the time the records hold", () => {
    expect(closingOf(db, "u", closed({ by: "user", closedBy: "t9" }), "sc-1")).toEqual({ by: "you", at: 7000 });
    expect(closingOf(db, "u", closed({ by: "user", closedBy: "t9" }), "sc-other")).toEqual({ by: "you", at: null });
    expect(closingOf(db, "u", closed({ closedBy: "t1" }), "sc-1")).toEqual({ by: "turn", at: 1500 });
    expect(closingOf(db, "u", closed({ closedBy: "t2" }), undefined)).toEqual({ by: "turn", at: 2000 });
    expect(closingOf(db, "u", closed({ kind: "agent", closedBy: "t1" }), undefined)).toEqual({ by: "run", at: 1500 });
    expect(closingOf(db, "u", closed({ kind: "job", closedBy: "j1" }), undefined)).toEqual({ by: "job", at: 9000 });
    expect(closingOf(db, "u", closed({ closedBy: "nothing-holds-this" }), undefined)).toEqual({ by: "turn", at: null });
    expect(closingOf(db, "u", { ...closed({}), state: "open" }, undefined)).toBeUndefined();
  });
});

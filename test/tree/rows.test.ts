// What RPE's database holds of a chat is found by the columns of its tables (plan §5.5), and removed where nothing is lost: a deleted
// chat's rows go from every table that carries it, those that name it through a turn or a path's node first; another chat's rows and
// the tree's own mark of the chat stay. Tables, names and values are invented.

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { chatRows, removeChatRows, rowShares } from "../../src/tree/rows";

function laid(): Database {
  const db = new Database(":memory:");
  db.run("CREATE TABLE chat (user TEXT NOT NULL, id TEXT NOT NULL, deleted INTEGER, PRIMARY KEY (user, id))");
  db.run("CREATE TABLE turn (user TEXT NOT NULL, id TEXT NOT NULL, chat TEXT NOT NULL, PRIMARY KEY (user, id))");
  db.run("CREATE TABLE path_node (user TEXT NOT NULL, key TEXT NOT NULL, turn TEXT NOT NULL, PRIMARY KEY (user, key))");
  db.run("CREATE TABLE snapshot (user TEXT NOT NULL, node TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY (user, node)) WITHOUT ROWID");
  db.run("CREATE TABLE change (user TEXT NOT NULL, turn TEXT NOT NULL, text TEXT NOT NULL)");
  db.run("CREATE TABLE note_version (user TEXT NOT NULL, chat TEXT NOT NULL, text TEXT NOT NULL)");
  db.run("CREATE TABLE tree_chat (user TEXT NOT NULL, chat TEXT NOT NULL, folder TEXT NOT NULL)");
  db.run("CREATE TABLE settings_row (user TEXT NOT NULL, name TEXT NOT NULL)");
  for (const chat of ["c1", "c2"]) {
    db.run("INSERT INTO chat VALUES ('u', ?, NULL)", [chat]);
    db.run("INSERT INTO turn VALUES ('u', ?, ?)", [`${chat}-t1`, chat]);
    db.run("INSERT INTO path_node VALUES ('u', ?, ?)", [`${chat}-n1`, `${chat}-t1`]);
    db.run("INSERT INTO snapshot VALUES ('u', ?, 'the state of the sea')", [`${chat}-n1`]);
    db.run("INSERT INTO change VALUES ('u', ?, 'the tide came in')", [`${chat}-t1`]);
    db.run("INSERT INTO note_version VALUES ('u', ?, 'Fog, turn 1.')", [chat]);
    db.run("INSERT INTO tree_chat VALUES ('u', ?, 'folder')", [chat]);
  }
  db.run("INSERT INTO settings_row VALUES ('u', 'mine')");
  return db;
}

test("a chat's rows are counted in every table that carries it, however each names it, and removed through a turn or a node first, the other chat's, the installation's and the tree's own mark of it left", () => {
  const db = laid();
  const held = chatRows(db, "u", "c1");
  expect(held.map((t) => [t.table, t.rows]).sort()).toEqual([
    ["change", 1],
    ["chat", 1],
    ["note_version", 1],
    ["path_node", 1],
    ["snapshot", 1],
    ["turn", 1],
  ]);
  expect(held.every((t) => t.bytes > 0)).toBe(true);
  expect(chatRows(db, "u", "c1", ["snapshot"]).map((t) => t.table)).toEqual(["snapshot"]);

  expect(removeChatRows(db, "u", "c1")).toBe(6);
  expect(chatRows(db, "u", "c1")).toEqual([]);
  expect(chatRows(db, "u", "c2")).toHaveLength(6);
  expect(db.query("SELECT count(*) AS n FROM tree_chat WHERE chat = 'c1'").get()).toEqual({ n: 1 });
  expect(db.query("SELECT count(*) AS n FROM settings_row").get()).toEqual({ n: 1 });
});

test("what each chat's rows take is shared among the chats by the length of its rows, and with the installation's own they add up to the file", () => {
  const db = laid();
  db.run("INSERT INTO note_version VALUES ('u', 'c1', ?)", ["x".repeat(4000)]);
  const shares = rowShares(db, "u", 1_000_000);
  expect(shares.chats.get("c1") ?? 0).toBeGreaterThan(shares.chats.get("c2") ?? 0);
  expect([...shares.chats.values()].reduce((a, b) => a + b, 0) + shares.rest).toBe(1_000_000);
});

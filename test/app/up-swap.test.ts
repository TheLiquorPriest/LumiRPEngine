import { expect, test } from "bun:test";
import { configOf } from "../../src/app/config";

test("a config.json holding one connection id reads as a list of one, and the list as the list", () => {
  expect(configOf({ v: 1, lumiverse: { connection: "conn-a" } }, {}, "the old config").lumiverse.connections).toEqual(["conn-a"]);
  expect(configOf({ v: 1, lumiverse: { connection: null } }, {}, "the old config").lumiverse.connections).toEqual([]);
  expect(configOf({ v: 1, lumiverse: { connections: ["conn-a", "conn-b"] } }, {}, "the new config").lumiverse.connections).toEqual(["conn-a", "conn-b"]);
  expect(configOf({ v: 1 }, {}, "no config").lumiverse.connections).toEqual([]);
});

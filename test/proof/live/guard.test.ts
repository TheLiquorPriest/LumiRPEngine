// Invented data only (PlanScenarios-3 item 5): a step aimed at a chat not in the instance's record, made as a user
// the step does not name, or aimed at another Lumiverse's address, is refused before anything is sent; a chat the
// driver makes, or a chat file it imports, is the instance's from then on.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHATS_FILE, chatOf, Instance, InstanceLumiverse, OutOfBounds } from "../../../scripts/proof/live/instance";
import { RECORD_FILE } from "../../../scripts/testbed/floor-fixture";
import { type Site, serveSite, TOKEN } from "./site";

let dir: string;
let site: Site;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rpe-instance-"));
  site = serveSite();
  writeFileSync(join(dir, "state.json"), JSON.stringify({ chats: { classic: "chat-kept-1", agents: "chat-kept-2" }, userId: "user-1" }));
  writeFileSync(join(dir, RECORD_FILE), JSON.stringify({ presets: [], personas: [], books: [], cards: [], chats: ["chat-floor-1"] }));
});

afterAll(() => {
  site.stop();
  rmSync(dir, { recursive: true, force: true });
});

const instance = (): Instance => new Instance(site.base, "marlow", dir);

test("the instance's record is its state, the floor's fixture and the driver's own list", () => {
  const held = instance().chats();
  for (const id of ["chat-kept-1", "chat-kept-2", "chat-floor-1"]) expect(held.has(id)).toBe(true);
  expect(held.has("chat-bed-other")).toBe(false);
});

test("a step aimed at a chat the record does not hold is refused, naming it", () => {
  expect(() => instance().check({ address: site.base, user: "marlow", named: "marlow", chat: "chat-bed-other" })).toThrow(OutOfBounds);
  expect(() => instance().check({ address: site.base, user: "marlow", named: "marlow", chat: "chat-bed-other" })).toThrow("chat-bed-other");
  instance().check({ address: site.base, user: "marlow", named: "marlow", chat: "chat-kept-1" });
});

test("a step made as a user it does not name, or as one that is not the instance's, is refused", () => {
  expect(() => instance().check({ address: site.base, user: "someone", named: "marlow" })).toThrow("signed in as someone");
  expect(() => instance().check({ address: site.base, user: "someone", named: "someone" })).toThrow("not the instance's user");
  // The second invented user plays only where a scenario says so.
  expect(() => instance().check({ address: site.base, user: "second", named: "second" })).toThrow(OutOfBounds);
  new Instance(site.base, "marlow", dir, "second").check({ address: site.base, user: "second", named: "second" });
});

test("a step aimed at another Lumiverse's address is refused", () => {
  expect(() => instance().check({ address: "http://127.0.0.1:1", user: "marlow", named: "marlow" })).toThrow("not the instance's Lumiverse");
  instance().check({ address: `${site.base}/`, user: "marlow", named: "marlow" });
});

test("the chat a request is for is the one its path or its body names", () => {
  expect(chatOf("/api/v1/chats/abc/messages?limit=2")).toBe("abc");
  expect(chatOf("/api/v1/generate/status/abc")).toBe("abc");
  expect(chatOf("/api/v1/generate", { chat_id: "abc" })).toBe("abc");
  expect(chatOf("/api/v1/chats?limit=100")).toBeNull();
  expect(chatOf("/api/v1/connections")).toBeNull();
});

test("the REST refuses before sending, and a chat it makes is the instance's, as is one imported", async () => {
  const lumiverse = new InstanceLumiverse(site.base, TOKEN, instance(), "marlow", "marlow");
  await expect(lumiverse.chat("chat-bed-other")).rejects.toThrow(OutOfBounds);
  const made = await lumiverse.createChat("card-1", "Floor test");
  expect(instance().chats().has(made.id)).toBe(true);
  expect((await lumiverse.chat(made.id)).name).toBe("Floor test");
  const driversList = JSON.parse(await Bun.file(join(dir, CHATS_FILE)).text()) as string[];
  expect(driversList).toContain(made.id);
  // A chat file the driver imports is recorded as the instance's, once.
  instance().recordChat("chat-imported");
  instance().recordChat("chat-imported");
  expect(instance().chats().has("chat-imported")).toBe(true);
  expect((JSON.parse(await Bun.file(join(dir, CHATS_FILE)).text()) as string[]).filter((id) => id === "chat-imported")).toHaveLength(1);
});

test("a session signed in as another user than the one it names is refused before sending", async () => {
  const wrong = new InstanceLumiverse(site.base, TOKEN, instance(), "someone", "marlow");
  await expect(wrong.call("GET", "/api/v1/connections")).rejects.toThrow("signed in as someone");
});

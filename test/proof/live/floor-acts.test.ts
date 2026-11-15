// The floor's acts on the bed (PlanScenarios-3 item 9), on the bed's host over a site made up with Lumiverse's markup
// (`site.ts`): the acts give everything the floor plays with; the fresh chat is named "Floor test", is the instance's
// by its record and by the floor's own; and a line is sent in the chat page, the connection chosen by typing its name,
// under the preset and persona, the reply's moments timed by the page itself, in order, with its resolution.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { missingActs } from "../../../scripts/proof/floor/play";
import { openHost } from "../../../scripts/proof/live/host";
import { CHATS_FILE, OutOfBounds } from "../../../scripts/proof/live/instance";
import type { Host } from "../../../scripts/proof/route/host";
import { RECORD_FILE } from "../../../scripts/testbed/floor-fixture";
import { type Site, serveSite, TOKEN } from "./site";

const PROOF = resolve(import.meta.dir, "..", "..", "..", "scripts", "proof");
const NAMES = ["LRE_HOST_URL", "LRE_DATA_DIR", "LRE_INSTANCE_DIR", "LRE_CONNECTION_NAME", "LRE_NEVER_TOUCH", "LRE_OWNER_USERNAME", "LRE_OWNER_PASSWORD", "FLOOR_RPE_URL", "FLOOR_RPE_TOKEN", "FLOOR_PLAIN_CONNECTION", "FLOOR_RPE_CONNECTION"];

let site: Site;
let dir: string;
let host: Host;
const before = new Map<string, string | undefined>();

beforeAll(async () => {
  site = serveSite();
  dir = mkdtempSync(join(tmpdir(), "rpe-live-"));
  // The sign-in the bed's command line saved, in the instance's folder, as the bed scripts find it.
  const saved = join(dir, "instance", "config", "lumirpengine");
  mkdirSync(saved, { recursive: true });
  writeFileSync(join(saved, "credentials.json"), JSON.stringify({ hosts: { [site.base]: { token: TOKEN } } }));
  for (const name of NAMES) before.set(name, process.env[name]);
  Object.assign(process.env, {
    LRE_HOST_URL: site.base,
    LRE_DATA_DIR: join(dir, "data"),
    LRE_INSTANCE_DIR: join(dir, "instance"),
    LRE_CONNECTION_NAME: "Plain lamp",
    LRE_NEVER_TOUCH: "chat-bed-",
    LRE_OWNER_USERNAME: "Marlow",
    LRE_OWNER_PASSWORD: "brass and lamp oil",
    FLOOR_RPE_URL: "http://127.0.0.1:1",
    FLOOR_RPE_TOKEN: "an invented web key",
    FLOOR_PLAIN_CONNECTION: "Plain lamp",
    FLOOR_RPE_CONNECTION: "RPE lamp",
  });
  host = await openHost({ root: PROOF, run: "live-test" });
}, 60_000);

afterAll(async () => {
  await host?.close();
  for (const [name, value] of before) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  site?.stop();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

test("the bed's acts give everything the floor plays with", async () => {
  const play = await host.begin({ form: { id: "floor", kind: "gate", fixtures: [], fixturesDir: "", bed: [] }, play: 1, plays: 1, keep: async () => undefined });
  expect(host.mode).toBe("live");
  expect(missingActs(play.acts)).toEqual([]);
  expect(play.acts).toMatchObject({ connections: { plain: "conn-plain", rpe: "conn-rpe" }, lumiverse: { base: site.base }, rpe: { base: "http://127.0.0.1:1" } });
  await play.close();
});

test("the fresh chat is named Floor test, and the instance's record and the floor's own both list it", async () => {
  const play = await host.begin({ form: { id: "floor", kind: "gate", fixtures: [], fixturesDir: "", bed: [] }, play: 1, plays: 1, keep: async () => undefined });
  const acts = play.acts as { chat(card: string): Promise<string> };
  const chat = await acts.chat("card-1");
  expect(site.chats.get(chat)?.name).toBe("Floor test");
  expect(JSON.parse(readFileSync(join(dir, "instance", CHATS_FILE), "utf8"))).toContain(chat);
  expect(JSON.parse(readFileSync(join(dir, "instance", RECORD_FILE), "utf8")).chats).toContain(chat);
  await play.close();
});

test("a line is sent in the chat page under the preset and the persona on the connection chosen by name, its moments timed by the page", async () => {
  const play = await host.begin({ form: { id: "floor", kind: "gate", fixtures: [], fixturesDir: "", bed: [] }, play: 1, plays: 1, keep: async () => undefined });
  const acts = play.acts as { chat(card: string): Promise<string>; send(chat: string, connection: string, line: string, as: { preset: string; persona: string }): Promise<Record<string, number | null>> };
  const chat = await acts.chat("card-1");
  const as = { preset: "pre-floor", persona: "pers-traveller" };
  const plain = await acts.send(chat, "conn-plain", "The first line.", as);
  const rpe = await acts.send(chat, "conn-rpe", "The second line.", as);
  expect(site.sent.slice(-2)).toEqual([
    { text: "The first line.", connection: "Plain lamp", persona: "The traveller", preset: "Floor preset" },
    { text: "The second line.", connection: "RPE lamp", persona: "The traveller", preset: "Floor preset" },
  ]);
  for (const moments of [plain, rpe]) {
    const [sent, thinking, first, last, ended] = [moments.sent, moments.firstThinking, moments.firstWord, moments.lastWord, moments.ended].map((n) => n ?? Number.NaN) as [number, number, number, number, number];
    expect(sent).toBeLessThan(thinking);
    expect(thinking).toBeLessThan(first);
    expect(first).toBeLessThan(last);
    expect(last).toBeLessThanOrEqual(ended);
    expect(moments.resolution).toBeGreaterThan(0);
  }
  // One sign-in served every window of the run, and the preset and the persona were set once.
  expect(site.signIns).toBe(1);
  await play.close();
});

test("a send aimed at a chat the instance's record does not hold is refused before the page is opened", async () => {
  const play = await host.begin({ form: { id: "floor", kind: "gate", fixtures: [], fixturesDir: "", bed: [] }, play: 1, plays: 1, keep: async () => undefined });
  const acts = play.acts as { send(chat: string, connection: string, line: string, as: { preset: string; persona: string }): Promise<unknown> };
  const sent = site.sent.length;
  await expect(acts.send("chat-bed-other", "conn-plain", "No.", { preset: "pre-floor", persona: "pers-traveller" })).rejects.toThrow(OutOfBounds);
  expect(site.sent).toHaveLength(sent);
  await play.close();
});

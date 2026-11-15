// Repeats on the bed (PlanScenarios-3 item 4): an "as shipped" part is played the set number of times, each play on a fresh chat the run makes on the
// instance's own card and records as the instance's, so no play stands on what an earlier one left; a gate's form makes its own chat and gets none made
// for it. The count of the plays' rate is the runner's (PlanScenarios-1); here is what the host gives each play.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openHost, type LiveActs } from "../../../scripts/proof/live/host";
import { CHATS_FILE } from "../../../scripts/proof/live/instance";
import type { FormBrief, Host } from "../../../scripts/proof/route/host";
import { type Site, serveSite, TOKEN } from "./site";

const PROOF = resolve(import.meta.dir, "..", "..", "..", "scripts", "proof");
const NAMES = ["LRE_HOST_URL", "LRE_DATA_DIR", "LRE_INSTANCE_DIR", "LRE_CONNECTION_NAME", "LRE_NEVER_TOUCH", "LRE_OWNER_USERNAME", "LRE_OWNER_PASSWORD", "FLOOR_RPE_URL", "FLOOR_RPE_TOKEN", "FLOOR_PLAIN_CONNECTION", "FLOOR_RPE_CONNECTION"];

let site: Site;
let dir: string;
let host: Host;
const before = new Map<string, string | undefined>();

const scenario = (id: string): FormBrief => ({ id, kind: "scenario", fixtures: [], fixturesDir: "", bed: [] });
const none = async (): Promise<void> => undefined;

beforeAll(async () => {
  site = serveSite();
  dir = mkdtempSync(join(tmpdir(), "rpe-live-repeat-"));
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
  host = await openHost({ root: PROOF, run: "repeat-test" });
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

test("a play of a scenario begins on a fresh chat of the instance's own card, and a series of plays never shares one", async () => {
  // The instance's own record names its card, as the scripts that made the instance left it.
  writeFileSync(join(dir, "instance", "state.json"), JSON.stringify({ cardId: "card-1" }));
  const made: string[] = [];
  for (let play = 1; play <= 3; play++) {
    const session = await host.begin({ form: scenario("41"), play, plays: 3, keep: none });
    const acts = session.acts as LiveActs;
    expect(acts.chatNow).not.toBeNull();
    made.push(acts.chatNow ?? "");
    expect(site.chats.get(acts.chatNow ?? "")).toMatchObject({ name: `Proof 41 play ${play} of 3`, character_id: "card-1" });
    // The chat is the instance's: a step aimed at it is let through.
    await acts.openChat(acts.chatNow ?? "");
    await session.close();
  }
  expect(new Set(made).size).toBe(3);
  const held: string[] = JSON.parse(readFileSync(join(dir, "instance", CHATS_FILE), "utf8"));
  for (const chat of made) expect(held).toContain(chat);
});

test("a play whose instance's record names no card of its own stops, saying so, and a gate's form is given no chat it did not ask for", async () => {
  writeFileSync(join(dir, "instance", "state.json"), JSON.stringify({}));
  await expect(host.begin({ form: scenario("41"), play: 1, plays: 1, keep: none })).rejects.toThrow("names no card of its own");
  const before = site.chats.size;
  const gate = await host.begin({ form: { id: "floor", kind: "gate", fixtures: [], fixturesDir: "", bed: [] }, play: 1, plays: 1, keep: none });
  expect((gate.acts as LiveActs).chatNow).toBeNull();
  expect(site.chats.size).toBe(before);
  await gate.close();
});

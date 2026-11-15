// The rig's host (PlanScenarios-2 items 5, 6, 9): its facts name the checkout's commits and how the pin was held, from RPE's own
// routes; a play's footing gives the player's acts on the stand-in (a line sent ties an RPE turn, a swipe is a new swipe of its
// reply, an edit changes the row), a 2,000-message chat the web shell can list, and the floor's acts as far as the stand-in serves
// what the chat page needs; what it does not serve is named with the package that gives it.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { missingActs } from "../../../scripts/proof/floor/play";
import type { Host, PlayStart } from "../../../scripts/proof/route/host";
import { factFaults } from "../../../scripts/proof/route/evidence";
import { RIG_CHAT, RIG_PASSWORD } from "../../../scripts/proof/rig/bed";
import { openRig, type RigActs, standInGaps } from "../../../scripts/proof/rig/host";

const ROOT = resolve(import.meta.dir, "../../../scripts/proof");
let host: Host<RigActs>;
const kept = new Map<string, unknown>();
const start: PlayStart = { form: { id: "99", kind: "scenario", fixtures: [], fixturesDir: ROOT, bed: [] }, play: 1, plays: 1, keep: async (name, data) => void kept.set(name, data) };

beforeAll(async () => {
  host = await openRig({ root: ROOT, run: "rig-test", pin: { stage: "before-publishing" } });
}, 120_000);

afterAll(async () => {
  await host?.close();
});

test("the facts name the checkout's commits, how the pin was held, the agents from RPE's own routes, and the guidance RPE serves", async () => {
  const facts = await host.facts();
  expect(factFaults(facts, "rig")).toEqual([]);
  expect(facts.rph.held).toMatchObject({ from: "rph-repository", stage: "before-publishing", bundles: null });
  expect(facts.agents.map((a) => a.agent)).toContain("author");
  expect(facts.agents.every((a) => a.connection === "Scripted")).toBe(true);
  expect(facts.guidance?.served.length).toBeGreaterThan(0);
  expect(facts.guidance?.names).toEqual({ off: [], layered: [], added: [] });
}, 120_000);

test("a play's acts: a line sent ties an RPE turn, a swipe is a new swipe of its reply, an edit and a delete change the rows; a swipe deleted names the package that gives it", async () => {
  const session = await host.begin(start);
  try {
    const acts = session.acts;
    expect(missingActs(acts)).toEqual([]);
    const sent = await acts.player.send(RIG_CHAT, "I climb to the lamp room.");
    expect(sent.error).toBeNull();
    await acts.player.settled(RIG_CHAT);
    const chat = acts.bed.host.chats.get(RIG_CHAT);
    const reply = chat?.messages.at(-1);
    expect(reply?.role).toBe("assistant");
    expect(reply?.content).toContain("The lamp turns above you");
    expect(acts.models.left("author")).toBeLessThan(12);
    const swiped = await acts.player.swipe(RIG_CHAT);
    expect(swiped.error).toBeNull();
    await acts.player.settled(RIG_CHAT);
    expect(chat?.messages.at(-1)?.swipeId).toBe(1);
    acts.player.flipSwipe(RIG_CHAT, reply?.id ?? "", "left");
    expect(chat?.messages.at(-1)?.swipeId).toBe(0);
    acts.player.edit(RIG_CHAT, reply?.id ?? "", "A line the player wrote.");
    expect(acts.bed.db.rows("SELECT content FROM messages WHERE id = ?", reply?.id ?? "")[0]?.content).toBe("A line the player wrote.");
    expect(() => acts.player.deleteSwipe(RIG_CHAT, reply?.id ?? "", 1)).toThrow("PlanAdapter-S10");
    expect(() => acts.player.branch(RIG_CHAT, reply?.id ?? "")).toThrow("PlanAdapter-S10");
    // The stand-in's network door answers as the player, and a card the library lacks is refused naming it.
    const door = await fetch(`${acts.lumiverse.base}/api/v1/chats/${RIG_CHAT}`, { headers: { authorization: `Bearer ${acts.lumiverse.token}` } });
    expect(door.status).toBe(200);
    expect(await acts.chat("char-wren")).toMatch(/^chat-floor-/);
    await expect(acts.chat("no-such-card")).rejects.toThrow("holds no card no-such-card");
  } finally {
    await session.close();
  }
  expect([...kept.keys()]).toEqual(["lumiverse-events", "lumiverse-messages"]);
}, 120_000);

test("a chat of 2,000 messages is loaded through the stand-in and RPE's web shell lists the chats", async () => {
  const session = await host.begin(start);
  try {
    const acts = session.acts;
    acts.fixtures.chat({ id: "chat-long", name: "The long watch", length: 2000, planted: [{ at: 1233, text: "The brass key is under the third stair." }] });
    expect(acts.bed.db.rows("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?", "chat-long")[0]?.n).toBe(2000);
    // RPE lists a chat once it has played a turn in it, as the shell does for any chat: the player sends a line, and RPE's run ends.
    acts.openChat("chat-long");
    expect((await acts.player.send("chat-long", "Where is the brass key?")).error).toBeNull();
    await acts.player.settled("chat-long");
    await session.browser.open("Chats", 1440);
    await session.browser.waitFor({ text: "The long watch" });
    const shot = await session.browser.screen();
    expect(shot.text).toContain("The long watch");
  } finally {
    await session.close();
  }
}, 120_000);

test("the chat page's Send says what the stand-in does not yet serve, naming the package, and is played where it serves it", async () => {
  const session = await host.begin(start);
  try {
    const acts = session.acts;
    const gaps = await standInGaps(acts.lumiverse.base, acts.lumiverse.token, RIG_CHAT);
    expect(RIG_PASSWORD.length).toBeGreaterThan(0);
    const sending = acts.send(RIG_CHAT, acts.connections.rpe, "I climb to the lamp room.", { preset: "preset-lamp", persona: "pers-traveller" });
    if (gaps.length > 0) {
      await expect(sending).rejects.toThrow("waits on");
      return;
    }
    // Served: the moments come from the page, and the stand-in must have streamed them.
    await sending.then(
      (moments) => expect(moments.sent).toBeLessThan(moments.firstWord ?? Infinity),
      (error: unknown) => expect(String(error)).toContain("STREAM_TOKEN_RECEIVED"),
    );
  } finally {
    await session.close();
  }
}, 180_000);

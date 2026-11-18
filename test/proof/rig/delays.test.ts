// The delays of a scripted reply (PlanScenarios-2 item 8), measured by the chat page itself: with `openRig({ delays })`, the moments `acts.send` gives for each
// connection are the delays set, within the page's resolution and what the two requests Send makes and the stand-in's forty-millisecond batching of a stream add.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { Host, PlayStart } from "../../../scripts/proof/route/host";
import { RIG_CHAT } from "../../../scripts/proof/rig/bed";
import { openRig, REPLY_WORDS, type RigActs } from "../../../scripts/proof/rig/host";

const ROOT = resolve(import.meta.dir, "../../../scripts/proof");
const start: PlayStart = { form: { id: "99", kind: "scenario", fixtures: [], fixturesDir: ROOT, bed: [] }, play: 1, plays: 1, keep: async () => undefined };
/** What the page's own clock cannot tell from the requests and the stream's batching around a moment: the two requests Send makes, and one batch of forty milliseconds. */
const SLACK_MS = 250;

let host: Host<RigActs>;

beforeAll(async () => {
  host = await openRig({ root: ROOT, run: "rig-delays-test", pin: { stage: "before-publishing" }, delays: { plain: { firstThinking: 120, firstWord: 300, between: 60, end: 50 }, rpe: { firstWord: 200, between: 80 } } });
}, 120_000);

afterAll(async () => {
  await host?.close();
});

test("the plain connection's reply comes at the delays it was scripted with: thinking, a first word, a word every so often, an end", async () => {
  const session = await host.begin(start);
  try {
    const acts = session.acts;
    const moments = await acts.send(RIG_CHAT, acts.connections.plain, "I climb to the lamp room.", { preset: "preset-lamp", persona: "pers-traveller" });
    expect(moments.firstThinking).not.toBeNull();
    const [sent, thinking, first, last, ended] = [moments.sent, moments.firstThinking, moments.firstWord, moments.lastWord, moments.ended].map((n) => n ?? Number.NaN) as [number, number, number, number, number];
    expect(thinking - sent).toBeGreaterThanOrEqual(120 - moments.resolution);
    expect(thinking - sent).toBeLessThan(120 + SLACK_MS);
    expect(first - sent).toBeGreaterThanOrEqual(300 - moments.resolution);
    expect(first - sent).toBeLessThan(300 + SLACK_MS);
    // A word every 60 ms, one gap fewer than there are words.
    const span = (REPLY_WORDS.length - 1) * 60;
    expect(last - first).toBeGreaterThanOrEqual(span * 0.8);
    expect(last - first).toBeLessThan(span + SLACK_MS);
    expect(ended).toBeGreaterThanOrEqual(last);
    expect(moments.resolution).toBeLessThan(5);
  } finally {
    await session.close();
  }
}, 120_000);

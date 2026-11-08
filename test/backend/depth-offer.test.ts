// The depth offer under an existing chat's last message (DEPTH-PLAN Round 2): Set up the loopback first
// while it isn't ready, then Estimate until the bootstrap has one, then Turn on depth with the estimate
// in its words; Keep off always; none on a chat already on depth.

import { describe, expect, test } from "bun:test";
import { depthOfferChip } from "../../src/backend/bootstrap/depth-offer";
import type { BootstrapEstimate } from "../../src/shared/bootstrap";

const ESTIMATE: BootstrapEstimate = { chatId: "chat1", messages: 820, words: 1_640_000, tokens: 2_200_000, chunks: 74, minds: 9, stages: [], total: { calls: 1240, tokensIn: 3_000_000, tokensOut: 200_000, cost: 14.8, ms: 6 * 3_600_000 }, notes: [], rss: null };

describe("the depth offer", () => {
  test("asks for the estimate first, then offers Turn on depth with it; none on a chat on depth", () => {
    const bare = depthOfferChip({ optedIn: false, remaining: null }, "m9", null);
    expect(bare?.id).toBe("depth_offer:m9");
    expect(bare?.actions.map((a) => [a.id, a.style ?? null])).toEqual([
      ["estimate", "primary"],
      ["off", null],
    ]);
    const priced = depthOfferChip({ optedIn: false, remaining: ESTIMATE }, "m9", null);
    expect(priced?.actions.map((a) => a.id)).toEqual(["on", "estimate", "off"]);
    expect(priced?.detail).toContain("The bootstrap: 820 messages in 74 chunks, 9 minds · 1,240 calls · 3.2M tokens · $14.80 · 6 h.");
    expect(depthOfferChip({ optedIn: true, remaining: ESTIMATE }, "m9", null)).toBeNull();
  });

  test("while the loopback isn't ready it still shows, Set up the loopback first, opening Settings → Loopback, and says why", () => {
    const why = "No relay carries your replies yet: start one with the line in Settings → Loopback.";
    const chip = depthOfferChip({ optedIn: false, remaining: ESTIMATE }, "m9", why);
    expect(chip?.actions.map((a) => [a.id, a.style ?? null])).toEqual([
      ["loopback", "primary"],
      ["on", null],
      ["estimate", null],
      ["off", null],
    ]);
    expect(chip?.actions[0]?.input).toEqual({ type: "settings", label: "Set up the loopback", page: "loopback" });
    expect(chip?.detail).toContain(why);
    expect(depthOfferChip({ optedIn: false, remaining: null }, "m9", why)?.actions.map((a) => a.id)).toEqual(["loopback", "estimate", "off"]);
  });
});

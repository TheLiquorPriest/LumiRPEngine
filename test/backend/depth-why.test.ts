// The author's account of its choice is asked as "why", one or two plain sentences, never as its
// thinking, which a provider may refuse to write out; an answer recorded before still reads by its
// old "reasoning". A call its provider refused (stop reason `refusal`) fails in the provider's own
// words, never as an answer that wasn't the JSON object.

import { describe, expect, test } from "bun:test";
import { depthPort, ProviderRefusal } from "../../src/backend/depth-model-host";
import { answerWhy, askRole } from "../../src/backend/depth/common";
import type { QuietResult } from "../../src/backend/host";
import { defaultSettings } from "../../src/backend/settings-store";
import { PROMPTS } from "../../src/shared/prompts";
import { OLD_WHY_FIELD } from "../../src/shared/scene-prompts";

describe("the author's account", () => {
  test("no shipped prompt asks for the old answer field", () => {
    for (const d of PROMPTS) {
      expect(d.text).not.toContain(OLD_WHY_FIELD);
      expect(d.text).not.toContain("your thinking");
    }
  });

  test("an answer's account is its \"why\", else the \"reasoning\" an answer recorded before gave", () => {
    expect(answerWhy({ why: " It keeps the pace. ", reasoning: "older" })).toBe("It keeps the pace.");
    expect(answerWhy({ reasoning: " Recorded before. " })).toBe("Recorded before.");
    expect(answerWhy({ why: "  ", reasoning: 3 })).toBe("");
  });
});

describe("a refusal stop reason", () => {
  function host(r: Partial<QuietResult>): { calls: number; host: unknown } {
    const out = { calls: 0, host: {} as unknown };
    out.host = {
      models: {
        quiet: async (): Promise<QuietResult> => {
          out.calls += 1;
          return { content: "", finishReason: "stop", tokens: 10, tokensIn: 10, tokensOut: 0, ...r };
        },
      },
      log: () => undefined,
    };
    return out;
  }

  test("the port fails with the provider's own words, once, not as an answer that wasn't the JSON object", async () => {
    const h = host({ finishReason: "refusal", stopDetails: { type: "refusal", category: "reasoning_extraction", explanation: "The request asked for the model's internal reasoning." } });
    const port = depthPort(h.host as never, async () => defaultSettings(), "u1", { day: null });
    const error = await port("author", [{ role: "user", content: "hi" }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderRefusal);
    expect((error as Error).message).toBe("the author's call was refused by its provider (stop reason refusal, category reasoning_extraction): The request asked for the model's internal reasoning.");
    expect((error as Error).message).not.toContain("wasn't the JSON object");
    expect(h.calls).toBe(1);
  });

  test("without stop_details it says the provider gave no reason; a stage asking the role fails with it", async () => {
    const h = host({ finishReason: "refusal" });
    const port = depthPort(h.host as never, async () => defaultSettings(), "u1", { day: null });
    const world = { name: "W" } as never;
    const state = { entities: {} } as never;
    const error = await askRole(port, "author", "depth.author.ask", { world, state, pov: "p" as never, texts: {}, data: "" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderRefusal);
    expect((error as Error).message).toBe("the author's call was refused by its provider (stop reason refusal), with no reason given");
  });

  test("any other stop reason answers as before", async () => {
    const h = host({ content: "{}", finishReason: "stop", stopDetails: { type: "refusal", explanation: "unused" } });
    const port = depthPort(h.host as never, async () => defaultSettings(), "u1", { day: null });
    expect((await port("author", [{ role: "user", content: "hi" }])).finish).toBe("stop");
  });
});

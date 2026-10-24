// GM → This chat → Sections (DESIGN §6.11): a save sends the form's settings whole, so a cap the GM
// switched off is gone from them, and the chat's settings stand in place of the world's.

import { describe, expect, test } from "bun:test";
import { chatFeedOf } from "../../src/frontend/gm/feed";

describe("the GM's section settings form", () => {
  test("a cap switched off is no cap in what is sent; what is set is sent whole", () => {
    expect(chatFeedOf({ maxLines: undefined, maxTokens: undefined, scope: "gm" }, "")).toEqual({ scope: "gm" });
    expect(chatFeedOf({ enabled: false, maxLines: 3 }, " location, weather ")).toEqual({ enabled: false, maxLines: 3, include: ["location", "weather"] });
  });
});

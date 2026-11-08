// R12 (DEPTH-PLAN §10): a reply's reasoning stays out of LumiRPEngine's reads. Lumiverse keeps a
// reply's thinking beside it (`extra.reasoning`); the message as LumiRPEngine reads it, which is what
// its message cache holds, carries the text, the swipes and the extension's metadata only.

import { describe, expect, test } from "bun:test";
import { decodeMessage } from "../../src/backend/spindle-host";

describe("a message as LumiRPEngine reads it", () => {
  test("carries no reasoning: its text, its swipes and its metadata only", () => {
    const raw = { id: "m1", chat_id: "c1", index_in_chat: 3, is_user: false, name: "Narrator", content: "She nods.", swipe_id: 0, swipes: ["She nods."], extra: { reasoning: "THINKING about what the player wants", reasoning_duration: 12, spindle_metadata: { lre: { kept: 1 } } } };
    const read = decodeMessage(raw, "c1");
    expect(read).toMatchObject({ id: "m1", chatId: "c1", index: 3, isUser: false, content: "She nods.", swipes: ["She nods."], metadata: { lre: { kept: 1 } } });
    expect(JSON.stringify(read)).not.toContain("THINKING");
  });
});

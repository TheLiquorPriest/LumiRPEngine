import { describe, expect, test } from "bun:test";
import { spoken } from "../../src/backend/depth/common";

describe("spoken: a model's quoted words", () => {
  test("a list of utterances (as DeepSeek answers) is joined in order", () => {
    expect(spoken(["  \"Get out.\" ", "", 7, "\"Now.\""])).toBe("\"Get out.\" \"Now.\"");
  });
  test("one string is trimmed; anything else is nothing", () => {
    expect(spoken("  \"Hello.\" ")).toBe("\"Hello.\"");
    expect(spoken(undefined)).toBe("");
    expect(spoken({ quotes: "x" })).toBe("");
    expect(spoken([])).toBe("");
  });
});

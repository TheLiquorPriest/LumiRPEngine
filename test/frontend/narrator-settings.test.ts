// Settings → Narrator: a secret's mark wording saves as the user's own only when it differs from the
// shipped text and holds what it needs; blank, the shipped text or Reset leaves the shipped text in force.

import { describe, expect, test } from "bun:test";
import { secretMarkPatch } from "../../src/frontend/settings/narrator";
import { SECRET_MARK_WORDING } from "../../src/shared/secret-marks";
import { SECRET_MARK_NEEDS } from "../../src/shared/settings";

type Part = keyof typeof SECRET_MARK_WORDING;
const reset = (part: Part) => ({ narrator: { marks: { [part]: null } } });

describe("a secret's mark wording", () => {
  test("blank, the shipped text and Reset all go back to the shipped text", () => {
    for (const part of Object.keys(SECRET_MARK_NEEDS) as Part[]) {
      expect(secretMarkPatch(part, null)).toEqual(reset(part));
      expect(secretMarkPatch(part, "  ")).toEqual(reset(part));
      expect(secretMarkPatch(part, SECRET_MARK_WORDING[part])).toEqual(reset(part));
    }
  });

  test("an own wording holding every placeholder it needs is kept as typed; one missing any can't be saved", () => {
    const own = `Note: ${SECRET_MARK_NEEDS.both.join(" / ")}`;
    expect(secretMarkPatch("both", own)).toEqual({ narrator: { marks: { both: own } } });
    for (const missing of SECRET_MARK_NEEDS.both) expect(secretMarkPatch("both", own.replace(missing, ""))).toBeNull();
    expect(secretMarkPatch("everyone", "all of them")).toEqual({ narrator: { marks: { everyone: "all of them" } } });
  });

  test("the narrator's rule on marks is the user's to rewrite: it needs the forms it explains, and may name the word for everyone", () => {
    const rule = "A line written {{forms}} is a secret; {{everyone}} means all who don't know it.";
    expect(secretMarkPatch("rule", rule)).toEqual({ narrator: { marks: { rule } } });
    expect(secretMarkPatch("rule", rule.replace("{{everyone}}", "everyone"))).toEqual({ narrator: { marks: { rule: rule.replace("{{everyone}}", "everyone") } } });
    expect(secretMarkPatch("rule", rule.replace("{{forms}}", "like this"))).toBeNull();
    expect(secretMarkPatch("rule", null)).toEqual(reset("rule"));
  });
});

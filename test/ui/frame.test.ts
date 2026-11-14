// What the frame both shells put the pages in says above every page: why chats on RPE's connection are
// not being played (its extension does not hold RPE's registration, or lacks permissions), in RPE's
// words or the extension's own; and nothing while all is well.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { ExtensionStatus, MissingPermission } from "../../src/ui/api";
import { ExtensionNotice, type ExtensionWord } from "../../src/ui/frame";
import { expand, press, textOf } from "./vnodes";

const NOT_HEARD = "RPE has not heard from its extension in Lumiverse since it started.";
const INTERCEPTOR: MissingPermission = { permission: "interceptor", why: "to tag each reply RPE plays with its chat and its turn" };
const PROXY: MissingPermission = { permission: "cors_proxy", why: "to carry this page's requests when it cannot reach RPE itself" };

function notice(word: Partial<ExtensionWord>): { text: string; tree: unknown; checks: number } {
  const out = { text: "", tree: null as unknown, checks: 0 };
  out.tree = expand(h(ExtensionNotice, { word: { rpe: null, own: null, problem: null, ...word }, onCheck: () => out.checks++ }));
  out.text = textOf(out.tree);
  return out;
}

const held = (missing: MissingPermission[] | null): ExtensionStatus => ({ registered: true, why: null, missing });

describe("the notice of RPE's extension in Lumiverse", () => {
  test("when the extension does not hold RPE's registration, the page says chats are not played, and why, in RPE's words", () => {
    const shown = notice({ rpe: { registered: false, why: NOT_HEARD, missing: null } });
    expect(shown.text).toContain("Chats on RPE's connection are not being played");
    expect(shown.text).toContain(NOT_HEARD);
    press(shown.tree, "Check again");
    expect(shown.checks).toBe(1);
  });

  test("in the web shell, RPE's word names each permission the extension lacks, with why it needs it", () => {
    const { text } = notice({ rpe: held([INTERCEPTOR, PROXY]) });
    expect(text).toContain("RPE's extension is missing permissions");
    for (const m of [INTERCEPTOR, PROXY]) expect(text).toContain(`${m.permission}: ${m.why}`);
  });

  test("in the drawer, the extension's own word on what it lacks is the one shown, even where RPE's is older", () => {
    expect(notice({ rpe: held([INTERCEPTOR]), own: [PROXY] }).text).not.toContain(INTERCEPTOR.why);
    expect(notice({ rpe: held([INTERCEPTOR]), own: [PROXY] }).text).toContain(PROXY.why);
    expect(notice({ rpe: held([INTERCEPTOR]), own: [] }).text).toBe("");
  });

  test("with the registration held and nothing lacking, it shows nothing; a word RPE could not give is said", () => {
    expect(notice({ rpe: held([]) }).text).toBe("");
    expect(notice({ rpe: held(null) }).text).toBe("");
    expect(notice({}).text).toBe("");
    expect(notice({ problem: "RPE has no GET /api/v1/status/extension." }).text).toContain("RPE has no GET /api/v1/status/extension.");
  });
});

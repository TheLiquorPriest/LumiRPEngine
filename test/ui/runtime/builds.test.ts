// The builds line on Runtime: which build RPE runs, which is on disk, which the extension is, in the
// status's own words; "Update now" only where the build on disk is another one and nothing else will
// restart RPE onto it; its answer shown; refusals in RPE's words. And the line that says when the web
// key ends, read from the session route: nothing for a key with no end.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { BuildsStatus, RestartState } from "../../../src/shared/api";
import { type BuildsShown, BuildsView, canUpdate, NO_BUILDS, readBuilds, readSession } from "../../../src/ui/pages/runtime/builds";
import { RuntimeView } from "../../../src/ui/pages/runtime";
import { when } from "../../../src/ui/words";
import { askingClient, settle } from "../asking";
import { AGREE, buildsReply as reply, NEWER } from "../bootstrap-recorded";
import { banners, elements, expand, press, textOf } from "../vnodes";

function view(shown: Partial<BuildsShown>) {
  let pressed = 0;
  const tree = expand(h(BuildsView, { shown: { ...NO_BUILDS, loading: false, ...shown }, onUpdate: () => pressed++ }));
  return { tree, text: textOf(tree), pressed: () => pressed };
}

const updateButton = (tree: unknown) => elements(tree).find((e) => e.type === "button" && textOf(e.props.children) === "Update now");

describe("the builds line", () => {
  test("which build RPE runs, which is on disk and which the extension is, with the status's own words", () => {
    const { text, tree } = view({ reply: reply(AGREE) });
    expect(text).toContain(AGREE.words);
    expect(text).toMatch(/RPE runssince .+a1b2c3d4Its app file on diska1b2c3d4/);
    expect(text).toContain("The extension in Lumiversea1b2c3d4");
    expect(updateButton(tree)).toBeUndefined();
    expect(view({ reply: reply({ ...AGREE, disk: null, broken: "The app file does not start." }) }).text).toContain("Its app file on diskThe app file does not start.");
    expect(view({ reply: reply({ ...AGREE, extension: null }) }).text).toContain("has not said yet");
  });

  test("Update now only where the build on disk is another one and the restart is off or none", () => {
    const cases: [RestartState, boolean][] = [
      ["off", true],
      ["none", true],
      ["waiting", false],
      ["restarting", false],
      ["by hand", false],
    ];
    for (const [restart, offered] of cases) expect([restart, canUpdate({ ...NEWER, restart })]).toEqual([restart, offered]);
    expect(canUpdate({ ...NEWER, disk: NEWER.running })).toBe(false);
    expect(canUpdate({ ...NEWER, disk: null })).toBe(false);
    const offered = view({ reply: reply(NEWER) });
    press(offered.tree, "Update now");
    expect(offered.pressed()).toBe(1);
  });

  test("it reads the builds route once; Update now posts, and its answer is shown in its words; a refusal is shown in RPE's", async () => {
    const { client, asked } = askingClient();
    const shown: BuildsShown[] = [];
    const reader = readBuilds(client, (s) => shown.push(s));
    expect(asked.map((a) => a.key)).toEqual(["GET /api/v1/status/builds"]);
    asked[0]?.answer(reply(NEWER));
    await settle();
    reader.update();
    expect(asked[1]?.key).toBe("POST /api/v1/update");
    const answer: BuildsStatus = { ...NEWER, restart: "waiting", words: "RPE restarts onto build e5f6a7b8 once the turn running ends." };
    asked[1]?.answer(answer);
    await settle();
    const after = view(shown.at(-1) ?? {});
    expect(banners(after.tree)).toEqual([{ title: "Update now", text: `Update now${answer.words}` }]);
    // Said once, in the banner: the builds line below it does not repeat the answer's words.
    expect(after.text.split(answer.words)).toHaveLength(2);
    expect(updateButton(after.tree)).toBeUndefined();
    reader.update();
    asked[2]?.fail(new Error("This needs a page token or the web UI's token."));
    await settle();
    expect(banners(view(shown.at(-1) ?? {}).tree)[0]).toEqual({ title: "Not updated", text: "Not updatedThis needs a page token or the web UI's token." });
  });

  test("the web key's end is said on Runtime with its date and how to make a new key; a key with no end, or one not read, says nothing; the route is read once, and its answer let go once the page left", async () => {
    const ENDS = 1_800_000_000_000;
    const runtimeWith = (sessionEnds: number | null) => {
      const tree = expand(h(RuntimeView, { builds: { ...NO_BUILDS, loading: false }, onUpdate: () => undefined, sessionEnds }));
      return elements(tree).filter((e) => e.props["data-session"] !== undefined).map((e) => textOf(e.props.children));
    };
    expect(runtimeWith(ENDS)).toEqual([`This browser's web key ends on ${when(ENDS)}. Make a new one with rpe key web on the machine RPE runs on before then.`]);
    expect(runtimeWith(null)).toEqual([]);

    const { client, asked } = askingClient();
    const heard: (number | null)[] = [];
    readSession(client, (ends) => heard.push(ends));
    expect(asked.map((a) => a.key)).toEqual(["GET /api/v1/status/session"]);
    asked[0]?.answer({ user: "user-1", ends: ENDS });
    const forget = readSession(client, (ends) => heard.push(ends));
    asked[1]?.answer({ user: "user-1", ends: null });
    await settle();
    expect(heard).toEqual([ENDS, null]);
    forget();
    readSession(client, (ends) => heard.push(ends));
    const late = readSession(client, (ends) => heard.push(ends));
    late();
    asked[3]?.answer({ user: "user-1", ends: ENDS });
    asked[2]?.fail(new Error("This needs a page token or the web UI's token."));
    await settle();
    expect(heard).toEqual([ENDS, null]);
  });
});

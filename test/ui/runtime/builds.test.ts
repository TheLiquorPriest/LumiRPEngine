// The builds line on Runtime: which build RPE runs, which is on disk, which the extension is, in the
// status's own words; "Update now" always there, its answer shown (the restart, none to take, or why the
// last one was refused); refusals in RPE's words. And the lines that say what this browser signs in with, read from the session
// route: the session it holds and when it ends, and the web key, which has no end unless a setting gives it one.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { BuildsStatus } from "../../../src/shared/api";
import { type BuildsShown, BuildsView, NO_BUILDS, readBuilds, readSession, updateAnswer } from "../../../src/ui/pages/runtime/builds";
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
    expect(updateButton(tree)).toBeDefined();
    expect(view({ reply: reply({ ...AGREE, disk: null, broken: "The app file does not start." }) }).text).toContain("Its app file on diskThe app file does not start.");
    expect(view({ reply: reply({ ...AGREE, extension: null }) }).text).toContain("has not said yet");
  });

  test("Update now is always there: its answer is the restart onto a build that passed, or that there is none, or why the last one was refused", () => {
    expect(updateAnswer(NEWER)).toBe(NEWER.words);
    expect(updateAnswer(AGREE)).toBe("There is no new build that has passed its checks: RPE runs build a1b2c3d4.");
    const refused: BuildsStatus = { ...AGREE, broken: "a file does not match the hash stated for it", update: { build: null, stages: [{ stage: "arrived", state: "done", at: 1, why: null }, { stage: "checked", state: "refused", at: 2, why: "a file does not match the hash stated for it" }] } };
    expect(updateAnswer(refused)).toBe("There is no new build to take: the last one was refused at its check (a file does not match the hash stated for it). RPE runs build a1b2c3d4, as it did.");
    const offered = view({ reply: reply(refused) });
    expect(offered.text).toContain("The refused file changed nothing: RPE goes on running build a1b2c3d4.");
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
    expect(updateButton(after.tree)).toBeDefined();
    reader.update();
    asked[2]?.fail(new Error("This needs a page token or the web UI's token."));
    await settle();
    expect(banners(view(shown.at(-1) ?? {}).tree)[0]).toEqual({ title: "Not updated", text: "Not updatedThis needs a page token or the web UI's token." });
  });

  test("Runtime says the session this browser holds and the web key each as what it is: the session ends and is renewed while the page is open, the web key has no end unless a setting gives it one; nothing before the route has answered; the route is read once, and its answer let go once the page left", async () => {
    const ENDS = 1_800_000_000_000;
    const KEY_ENDS = 1_900_000_000_000;
    const reply = (holds: "session" | "web key", ends: number | null, key: number | null | "none") => ({ user: "user-1", holds, ends, webKey: key === "none" ? null : { made: 1, ends: key } });
    const runtimeWith = (session: ReturnType<typeof reply> | null) => {
      const tree = expand(h(RuntimeView, { builds: { ...NO_BUILDS, loading: false }, onUpdate: () => undefined, session, names: { session: "A web session holds", webKey: "The web app's key holds" } }));
      return elements(tree).filter((e) => e.props["data-session"] !== undefined).map((e) => textOf(e.props.children));
    };
    const [held, key] = runtimeWith(reply("session", ENDS, null));
    expect(held).toContain(`This browser holds a session, which ends on ${when(ENDS)}. It is renewed while this page is open; once it has ended you sign in again with the web key or your Lumiverse account.`);
    expect(key).toContain("The web key has no end");
    expect(runtimeWith(reply("session", ENDS, KEY_ENDS))[1]).toBe(`The web key ends on ${when(KEY_ENDS)}. Make a new one with rpe key web on the machine RPE runs on before then.`);
    expect(runtimeWith(reply("web key", null, "none"))).toEqual(["This browser holds the web key itself."]);
    expect(runtimeWith(null)).toEqual([]);

    const { client, asked } = askingClient();
    const heard: (number | null)[] = [];
    readSession(client, (s) => heard.push(s.ends));
    expect(asked.map((a) => a.key)).toEqual(["GET /api/v1/status/session"]);
    asked[0]?.answer(reply("session", ENDS, null));
    const forget = readSession(client, (s) => heard.push(s.ends));
    asked[1]?.answer(reply("web key", null, null));
    await settle();
    expect(heard).toEqual([ENDS, null]);
    forget();
    readSession(client, (s) => heard.push(s.ends));
    const late = readSession(client, (s) => heard.push(s.ends));
    late();
    asked[3]?.answer(reply("session", ENDS, null));
    asked[2]?.fail(new Error("This needs a page token or the web UI's token."));
    await settle();
    expect(heard).toEqual([ENDS, null]);
  });
});

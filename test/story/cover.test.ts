import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Guidance, loadGuidance } from "rp-harness";
import type { FactValue } from "rp-harness/contract";
import { createFolderHost } from "rp-harness/hosts/folder";
import { STORY_FACT_DEFS, storyCoverage, storyFacts } from "../../src/story/index";
import { historyWindow, WINDOW_DEFAULTS, type WindowSettings } from "../../src/story/window/index";
import { CHAT, openTable, type Table, USER } from "./rig";

const GUIDANCE = resolve(import.meta.dir, "../../guidance");
const SCOPE = { user: USER, chat: CHAT, session: "s-1" };
const NAMES = ["history.leaving.uncovered", "history.unsummarized"];

let dir = "";
let guidance: Guidance;

beforeAll(async () => {
  // The shipped rule and the file it needs, as the shipped level of a folder host.
  dir = mkdtempSync(join(tmpdir(), "rpe-story-cover-"));
  mkdirSync(join(dir, "files", "defaults", ".rules"), { recursive: true });
  copyFileSync(join(GUIDANCE, ".rules", "history-leaving.md"), join(dir, "files", "defaults", ".rules", "history-leaving.md"));
  copyFileSync(join(GUIDANCE, "chat-defaults", "TURN.md"), join(dir, "files", "defaults", "TURN.md"));
  mkdirSync(join(dir, "files", "chats", "hero", CHAT), { recursive: true });
  mkdirSync(join(dir, "host", "chats", CHAT), { recursive: true });
  await Bun.write(join(dir, "host", "chats", CHAT, "chat.json"), JSON.stringify({ character: "hero" }));
  const host = await createFolderHost({ dir, user: USER });
  guidance = loadGuidance(host.files, SCOPE);
  expect(await guidance.problems()).toEqual([]);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Ten messages: 0 and 1 with nothing recorded; a beat at 3 (its turn's reply) and none at 2; the
 * scene "The ford" from 4 to 7, with a beat at 5, closed with its summary; 8 and 9 with nothing.
 */
async function tenMessages(): Promise<Table> {
  const t = await openTable();
  await t.play();
  await t.play([{ part: "beat", item: null, value: { text: "Wren pays the toll." } }]);
  await t.play([
    { part: "scene", item: null, value: { title: "The ford" } },
    { part: "beat", item: null, value: { text: "Wren fords the river." } },
  ]);
  const ford = t.record().of("scene")[0]?.id ?? "";
  await t.play([{ part: "scene", item: ford, value: { close: true, summary: "Wren crosses the ford, soaked." } }]);
  await t.play();
  return t;
}

const settings = (over: Partial<WindowSettings>): WindowSettings => ({ ...WINDOW_DEFAULTS, ...over });

async function factsAt(t: Table, window: WindowSettings): Promise<Record<string, FactValue>> {
  return storyFacts({ store: t.store, window: async () => window }).read(SCOPE, NAMES);
}

const range = (from: number, to: number) => ({ range: { ".": [from, to], from, to } });

describe("what the story record covers", () => {
  test("a stretch with no beats is not covered; one with beats and no summary is unsummarized; a scene with its summary covers all it spans", async () => {
    const t = await tenMessages();
    const point = { store: t.store, user: USER, chat: CHAT, turn: null };
    const now = storyCoverage(point);
    expect([...now.covered].sort()).toEqual(["m3", "m4", "m5", "m6", "m7"]);
    expect([...now.unsummarized]).toEqual(["m3"]);

    // Told from the records on the path: deleting the turn that summarized the scene takes its covering with it.
    await t.remove(4);
    const after = storyCoverage(point);
    expect([...after.covered].sort()).toEqual(["m3", "m5"]);
    expect([...after.unsummarized].sort()).toEqual(["m3", "m5"]);
  });

  test("history.leaving.uncovered counts what is about to leave the prompt uncovered, and history.unsummarized what has left with beats and no summary, each with its range", async () => {
    const t = await tenMessages();
    expect(STORY_FACT_DEFS.map((d) => [d.name, d.fields])).toEqual([
      ["history.leaving.uncovered", ["range"]],
      ["history.unsummarized", ["range"]],
    ]);

    // The latest 9 in the prompt: 1 to 9. One exchange on, the latest 9 are 3 to 11, so 1 and 2 leave, neither covered.
    expect(await factsAt(t, settings({ size: 9 }))).toEqual({
      "history.leaving.uncovered": { count: 2, fields: range(1, 2) },
      "history.unsummarized": { count: 0 },
    });
    // The latest 6: 4 to 9 in the prompt; 0 to 3 left out, of which 3 has a beat and no summary. 4 and 5 leave next, covered.
    expect(await factsAt(t, settings({ size: 6 }))).toEqual({
      "history.leaving.uncovered": { count: 0 },
      "history.unsummarized": { count: 1, fields: range(3, 3) },
    });
    // With a step, nothing leaves until the window has grown to the size and the step: then the step's worth leaves at once.
    expect((await factsAt(t, settings({ size: 6, step: 4 })))["history.leaving.uncovered"]).toEqual({ count: 0 });
    expect((await factsAt(t, settings({ size: 7, step: 4 })))["history.leaving.uncovered"]).toEqual({ count: 3, fields: range(0, 2) });
  });

  test("the window's hold keeps what the record does not cover, up to its cap, and what passes the cap is counted as leaving", async () => {
    const t = await tenMessages();
    const path = t.s.path(CHAT).map((m, index) => ({ id: m.message, index }));
    const { covered } = storyCoverage({ store: t.store, user: USER, chat: CHAT, turn: null });

    // The latest 6, held back as far as 40 more: 0 is not covered, so the prompt keeps everything.
    const held = settings({ size: 6, hold: { on: true, cap: 40 } });
    expect(historyWindow(path, held, covered).first).toBeNull();
    expect(await factsAt(t, held)).toEqual({ "history.leaving.uncovered": { count: 0 }, "history.unsummarized": { count: 0 } });

    // Held back at most 2 more: the prompt keeps 2 to 9. One exchange on, 4 and 5 are covered and let go, and 2 passes the cap.
    const capped = settings({ size: 6, hold: { on: true, cap: 2 } });
    expect(historyWindow(path, capped, covered).first).toEqual({ id: "m2", index: 2 });
    expect((await factsAt(t, capped))["history.leaving.uncovered"]).toEqual({ count: 1, fields: range(2, 2) });
  });

  test("the shipped rule history-leaving fires at a turn's start with the count and the range, and not when nothing leaves uncovered", async () => {
    const t = await tenMessages();
    const fired = async (window: WindowSettings): Promise<string[]> => {
      const facts = storyFacts({ store: t.store, window: async () => window });
      const run = await guidance.ruleRun({ facts: { defs: () => [...facts.defs], read: (scope, _agent, names) => facts.read(scope, names) } });
      expect(run.problems).toEqual([]);
      return (await run.turnStart({ id: "author-1", definition: "author" })).map((f) => f.text);
    };
    const [text] = await fired(settings({ size: 9 }));
    expect(text).toStartWith("2 messages (1, 2) are about to leave the prompt");
    expect(await fired(settings({ size: 6 }))).toEqual([]);
  });
});

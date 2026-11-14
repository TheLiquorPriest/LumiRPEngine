import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadGuidance, type TemplatePart } from "rp-harness";
import { createFolderHost } from "rp-harness/hosts/folder";
import { type StoryBrief, storyBrief, storyRecordParts } from "../../src/story/index";
import { storyClock } from "../../src/story/kit";
import { keyedItemId } from "../../src/story/record";
import { STORY_SO_FAR_DEFAULTS, storySoFar } from "../../src/story/sofar/index";
import { CHAT, openTable, USER } from "./rig";

const PROMPTS = resolve(import.meta.dir, "../../guidance/.prompts");

let dir = "";
const layouts: Record<string, TemplatePart> = {};

beforeAll(async () => {
  // The shipped layouts, loaded the way the agents' guidance is: as the shipped level of a folder host.
  dir = mkdtempSync(join(tmpdir(), "rpe-story-brief-"));
  mkdirSync(join(dir, "files", "defaults", ".prompts"), { recursive: true });
  for (const name of ["story-brief", "story-so-far"]) copyFileSync(join(PROMPTS, `${name}.md`), join(dir, "files", "defaults", ".prompts", `${name}.md`));
  mkdirSync(join(dir, "files", "chats", "hero", "c1"), { recursive: true });
  mkdirSync(join(dir, "host", "chats", "c1"), { recursive: true });
  writeFileSync(join(dir, "host", "chats", "c1", "chat.json"), JSON.stringify({ character: "hero" }));
  const host = await createFolderHost({ dir, user: "u1" });
  const guidance = loadGuidance(host.files, { user: "u1", chat: "c1", session: "s1" });
  expect(await guidance.problems()).toEqual([]);
  for (const name of ["story-brief", "story-so-far"]) {
    const part = await guidance.part(name);
    if (part?.format !== "template") throw new Error(`The shipped ${name} part did not load as a template.`);
    layouts[name] = part;
  }
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the story brief", () => {
  test("holds exactly the open scene, the hot threads, the arcs of who the scene has on stage, the futures due, and the player model", async () => {
    const t = await openTable();
    const clock = storyClock(t.store, USER, CHAT, null);
    if (clock === null) throw new Error("the invented world keeps a clock");
    const at = (text: string): number => clock.read(text) ?? Number.NaN;
    await t.play([{ part: "scene", item: null, value: { title: "The ford", who: ["Corvin"] } }]);
    const ford = t.record().of("scene")[0]?.id ?? "";
    await t.play([
      { part: "scene", item: ford, value: { close: true, summary: "Corvin is left at the ford." } },
      { part: "scene", item: null, value: { title: "The mill", who: ["Mira", "Tobin"], purpose: "Find the ledger.", tension: "Tobin lies about the key.", wants: "Mira wants the ledger.", ends: "The ledger is found." } },
      { part: "thread", item: null, value: { text: "Where is the mill's ledger?", hot: true, stakes: "Mira's inheritance." } },
      { part: "thread", item: null, value: { text: "Who broke the wheel?", hot: true, close: true } },
      { part: "thread", item: null, value: { text: "The miller's debts." } },
      { part: "arc", item: keyedItemId("arc", "Mira"), value: { who: "Mira", stands: "Trusts no one at the mill." } },
      { part: "arc", item: keyedItemId("arc", "tobin"), value: { who: "Tobin", stands: "Hiding the key." } },
      { part: "arc", item: keyedItemId("arc", "Corvin"), value: { who: "Corvin", stands: "Waiting at the ford." } },
      { part: "arc", item: keyedItemId("arc", "plot"), value: { who: "plot", stands: "The inheritance is contested." } },
      { part: "future", item: null, value: { text: "The bailiff arrives.", due: at("2031-03-01 07:00"), tier: 3 } },
      { part: "future", item: null, value: { text: "The spring flood.", due: at("2031-04-01 07:00") } },
      { part: "future", item: null, value: { text: "The baker's cart.", due: at("2031-03-01 06:00"), close: true } },
      { part: "future", item: null, value: { text: "Someday, a wedding." } },
      { part: "player", item: null, value: { text: "Likes riddles.", kind: "enjoys" } },
      { part: "player", item: null, value: { text: "A dropped note.", drop: true } },
    ]);
    const turn = await t.begin();
    const brief = storyBrief({ store: t.store, user: USER, chat: CHAT, turn: turn.id, layout: layouts["story-brief"] as TemplatePart });
    const f = brief.fields;
    expect(f.scene).toMatchObject({ title: "The mill", who: { ".": ["Mira", "Tobin"] }, from: 2, to: 4 });
    expect(f.threads?.items.map((x) => x.text)).toEqual(["Where is the mill's ledger?"]);
    expect(f.arcs?.items.map((x) => x.who)).toEqual(["Mira", "Tobin"]);
    expect(f.futures?.items.map((x) => x.text)).toEqual(["The bailiff arrives."]);
    expect(f.player?.items.map((x) => x.text)).toEqual(["Likes riddles."]);
    expect(f.now).toBe("Sat 1 Mar 2031, 8:00 AM");

    // Laid out by the shipped part, with the record's own words and ids.
    const text = brief.text;
    expect(text).toContain(`### The scene [${String(f.scene?.id)}]: The mill`);
    expect(text.split("\n").filter((line) => line.startsWith("- On stage:"))).toEqual(["- On stage: Mira, Tobin"]);
    expect(text).toContain(`- [${String(f.threads?.items[0]?.id)}] Where is the mill's ledger?\n  Stakes: Mira's inheritance.`);
    expect(text).toContain("- Mira\n  Stands: Trusts no one at the mill.");
    expect(text).toContain("- [");
    expect(text).toContain("The bailiff arrives.\n  Due: Sat 1 Mar 2031, 7:00 AM\n  Tier: 3");
    expect(text).toContain("enjoys: Likes riddles.");
    for (const absent of ["The ford", "Who broke the wheel?", "The miller's debts.", "Corvin", "contested", "spring flood", "baker", "wedding", "dropped note"]) expect(text).not.toContain(absent);
  });

  test("with the scene closed, it holds no scene and so no one's arc", async () => {
    const t = await openTable();
    await t.play([
      { part: "scene", item: null, value: { title: "The mill", who: ["Mira"] } },
      { part: "arc", item: keyedItemId("arc", "Mira"), value: { who: "Mira", stands: "Wary." } },
    ]);
    const mill = t.record().of("scene")[0]?.id ?? "";
    await t.play([{ part: "scene", item: mill, value: { close: true } }]);
    const brief = storyBrief({ store: t.store, user: USER, chat: CHAT, turn: null, layout: layouts["story-brief"] as TemplatePart });
    expect(brief).toEqual({ text: "", fields: {} });
  });

  test("deleting the first message, which a past scene names, leaves the open scene current and in the brief", async () => {
    const t = await openTable();
    await t.play();
    await t.play([
      { part: "scene", item: null, value: { title: "The mill", who: ["Mira"] } },
      { part: "arc", item: keyedItemId("arc", "Mira"), value: { who: "Mira", stands: "Wary." } },
      // A past scene the Author placed by the messages it names, closed as it was written.
      { part: "scene", item: null, value: { title: "Recalled", first: "m0", last: "m1", close: true, summary: "Mira's father sold the mill." } },
    ]);
    const layout = layouts["story-brief"] as TemplatePart;
    const brief = (): StoryBrief => storyBrief({ store: t.store, user: USER, chat: CHAT, turn: null, layout });
    expect(brief().fields.scene).toMatchObject({ title: "The mill" });

    await t.removeIds(["m0"]);
    expect(t.record().current("scene")?.fields.title).toBe("The mill");
    const after = brief();
    expect(after.fields.scene).toMatchObject({ title: "The mill" });
    expect(after.fields.arcs?.items.map((x) => x.who)).toEqual(["Mira"]);
    expect(after.text).not.toContain("Recalled");
  });
});

describe("the record's parts for the story so far", () => {
  test("gives the written chapter and scene summaries with their messages, and every beat at its message", async () => {
    const t = await openTable();
    await t.play([
      { part: "chapter", item: null, value: { title: "The thaw" } },
      { part: "scene", item: null, value: { title: "The ford" } },
      { part: "beat", item: null, value: { text: "Wren fords the river." } },
    ]);
    const ford = t.record().of("scene")[0]?.id ?? "";
    await t.play([
      { part: "beat", item: null, value: { text: "Wren's boots fill with water." } },
      { part: "scene", item: ford, value: { summary: "Wren crosses the ford, soaked.", close: true } },
    ]);
    // The historian's beats for a stretch played without the Author, placed at their own messages.
    await t.play([
      { part: "scene", item: null, value: { title: "The road" } },
      { part: "beat", item: null, value: { text: "A carter offers a ride.", message: "m4" } },
    ]);
    const open = await t.begin();
    await t.write(open, [{ part: "beat", item: null, value: { text: "Not saved yet." } }]);

    const parts = storyRecordParts({ store: t.store, user: USER, chat: CHAT, turn: open.id });
    expect(parts).toEqual({
      chapters: [],
      scenes: [{ from: 0, to: 3, text: "Wren crosses the ford, soaked." }],
      beats: [
        { at: 1, text: "Wren fords the river." },
        { at: 3, text: "Wren's boots fill with water." },
        { at: 4, text: "A carter offers a ride." },
      ],
    });

    // The shape the story so far takes: the summary stands for its beats, the later beat is printed.
    const shown = storySoFar({ record: parts, keptFrom: 6, contextWindow: 1_000_000, settings: STORY_SO_FAR_DEFAULTS, tokens: (s) => Math.ceil(s.length / 4), layout: layouts["story-so-far"] as TemplatePart });
    expect(shown.text).toContain("Scene summary, messages 0 to 3:\nWren crosses the ford, soaked.");
    expect(shown.text).toContain("- Message 4: A carter offers a ride.");
    expect(shown.text).not.toContain("boots");

    // Once the chapter has its summary, the parts carry it.
    const chapter = t.record(open).of("chapter")[0]?.id ?? "";
    await t.write(open, [{ part: "chapter", item: chapter, value: { summary: "Wren reaches the road.", close: true } }]);
    await t.tie(open);
    expect(storyRecordParts({ store: t.store, user: USER, chat: CHAT, turn: null }).chapters).toEqual([{ from: 0, to: 7, text: "Wren reaches the road." }]);
  });
});

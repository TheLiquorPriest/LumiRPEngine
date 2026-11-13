// Reads a reader gets whole (the tuning build's whole reads): what one call of `beats_read`,
// `feed_read` and `mind_seed` gives stays within what the harness states it gives whole (its
// `wholeChars`), with text that JSON escapes and at the longest the settings allow; what one read
// can't hold is read on with nothing lost or given twice, and what the reader reads on with comes
// first. A lore entry, or a grep's lines, longer than one answer come in pages on the harness,
// in a turn or out of one, by a cursor that notices a change between two pages; the old engines'
// lore reads are as they were. Each harness tool is called as the bridge calls it (`runHarnessTool`).

import { describe, expect, test } from "bun:test";
import { harnessTools } from "../../src/backend/agents/tools/harness";
import { LORE_TOOLS } from "../../src/backend/agents/tools/lore";
import { toolsFor } from "../../src/backend/agents/tools/registry";
import { defaultSettings } from "../../src/backend/settings-store";
import { mindPath } from "../../src/backend/story/minds";
import type { HostBookEntryInput } from "../../src/backend/host";
import { LOOP_DEFS } from "../../src/shared/agent-settings";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { MINDS_NOTE } from "../../src/shared/harness-texts-minds";
import { RECORD_TOOL } from "../../src/shared/harness-texts-record";
import type { JsonObject } from "../../src/shared/json";
import type { Beat, RecStory } from "../../src/shared/ledger";
import { MIND_FILE_IDS, STORY_LIMIT_LABELS, type StoryLimits, type UserSettings } from "../../src/shared/settings";
import { renderPrompt } from "../../src/backend/prompts";
import type { Rig } from "../support/rig";
import { stateOf } from "../support/mind-chat";
import { alderChat, HOME, toolEnv } from "../support/tools";
import { call, castChat, castEnv, castTurn, JOSS, MARA, memoryFiles, memoryStory } from "./harness-cast-kit";

/** Text `n` characters long, one character in five one that JSON escapes: a quote mark or a line break. */
const prose = (n: number): string => 'lamp"tide\n'.repeat(Math.ceil(n / 10)).slice(0, n);

/** What the harness states it gives whole of `tool` in `chatId` under `settings`; absent, it states nothing. */
async function wholeOf(rig: Rig, chatId: string, settings: UserSettings, tool: string): Promise<number | undefined> {
  const { world } = await stateOf(rig, chatId);
  return harnessTools({ world, registry: rig.rt.registry, settings }).find((t) => t.name === tool)?.wholeChars;
}

/** Beat `i` at the longest `limits` let one be written, every text `fill`: every person it may name named, each but Mara told of it with what they got. */
function longestBeat(limits: StoryLimits, i: number, fill: (n: number) => string = prose): Beat {
  const people = [MARA, ...Array.from({ length: limits.people - 1 }, (_, k) => `harbor_regular_${k}`)];
  return {
    id: `beat_${String(i).padStart(3, "0")}`,
    turn: "turn-held",
    at: 1000 + i,
    where: HOME,
    by: JOSS,
    kind: "say",
    what: fill(limits.beatChars),
    surface: fill(limits.beatChars),
    quotes: Array.from({ length: limits.quotes }, () => fill(limits.quoteChars)),
    to: people,
    exposure: people.map((who, k) => (k === 0 ? { who, reach: "whole" as const } : { who, reach: "told" as const, got: fill(limits.beatChars), from: JOSS })),
    decidedBy: { agent: HARNESS_AGENT.character, as: JOSS },
    settles: "draft_harbor_lamps",
  };
}

/** A cast chat under the record's limits changed by `over`, whose record holds `count` beats at their longest, with Mara a principal. */
async function longRecord(over: Partial<StoryLimits>, count: number, fill?: (n: number) => string) {
  const { rig, chatId } = await castChat();
  const shipped = await rig.rt.settings.get(rig.host.userId);
  const settings: UserSettings = { ...shipped, story: { ...shipped.story, limits: { ...shipped.story.limits, ...over } } };
  const beats = Array.from({ length: count }, (_, i) => longestBeat(settings.story.limits, i, fill));
  const held: RecStory = { beats, cast: [{ entity: MARA, standing: "principal" }] };
  const turn = await castTurn(rig, chatId, { main: false, settings, story: memoryStory(held, false) });
  return { rig, chatId, settings, turn, beats, whole: (await wholeOf(rig, chatId, settings, RECORD_TOOL.beatsRead)) ?? 0, fed: (await wholeOf(rig, chatId, settings, RECORD_TOOL.feedRead)) ?? 0 };
}

/** A call's answer, which must be within `whole`, read back from its JSON with its keys in order. */
async function within(env: Parameters<typeof call>[0], tool: string, args: JsonObject, whole: number): Promise<{ read: Record<string, unknown>; keys: string[] }> {
  const out = await call(env, tool, args);
  expect(out.error).toBeUndefined();
  expect({ tool, within: out.text.length <= whole }).toEqual({ tool, within: true });
  const read = JSON.parse(out.text) as Record<string, unknown>;
  return { read, keys: Object.keys(read) };
}

describe("a read of the story record stays within what it states, and reads on with nothing lost", () => {
  test("beats_read with every text at its limit's maximum: each read within its size, the way on first, every beat read whole by before", async () => {
    const { rig, chatId, settings, turn, beats, whole } = await longRecord({ beatChars: 4000, quoteChars: 2000, quotes: 40, whyChars: 2000, people: 1, beatsRead: 3 }, 4);
    const gm = castEnv(rig, chatId, turn, HARNESS_AGENT.gm);
    const got: JsonObject[] = [];
    let before: string | undefined;
    for (;;) {
      const { read, keys } = await within(gm, RECORD_TOOL.beatsRead, before !== undefined ? { before } : {}, whole);
      got.unshift(...(read.beats as JsonObject[]));
      if (read.earlier === undefined) break;
      // What it reads on with comes before the beats, so a clip can't take it; it names the setting.
      expect(keys.indexOf("note")).toBeLessThan(keys.indexOf("beats"));
      expect(String(read.note)).toContain(STORY_LIMIT_LABELS.beatsRead);
      before = String((read.beats as JsonObject[])[0]?.id);
    }
    expect(got.map((b) => b.id)).toEqual(beats.map((b) => b.id));
    expect(got.map((b) => [b.what, b.quotes])).toEqual(beats.map((b) => [b.what, b.quotes ?? []]));
    expect(settings.story.limits.beatsRead).toBe(3);
  });

  test("beats_read states a true bound: the setting's number of beats, every text one JSON escapes, come back whole from one read", async () => {
    const { rig, chatId, turn, beats, whole } = await longRecord({ people: 1, beatsRead: 3 }, 3, (n) => '"'.repeat(n));
    const { read } = await within(castEnv(rig, chatId, turn, HARNESS_AGENT.gm), RECORD_TOOL.beatsRead, {}, whole);
    expect((read.beats as JsonObject[]).map((b) => b.id)).toEqual(beats.map((b) => b.id));
    expect(read.earlier).toBeUndefined();
  });

  test("feed_read with quotes at their limit: a read holds back what its size can't, last is the last item given, more counts what waits, and after gives each held item once", async () => {
    // One item is about 97,000 characters as JSON writes it, so one read holds one, though the setting allows four.
    const { rig, chatId, turn, beats, fed, settings } = await longRecord({ quotes: 40, quoteChars: 2000, feedItems: 4 }, 5);
    const mara = castEnv(rig, chatId, turn, HARNESS_AGENT.character, null, MARA);
    const items: JsonObject[] = [];
    let after: string | undefined;
    let heldBySize = false;
    for (;;) {
      const { read, keys } = await within(mara, RECORD_TOOL.feedRead, after !== undefined ? { after } : {}, fed);
      const given = read.items as JsonObject[];
      items.push(...given);
      for (const key of ["last", "note"]) if (keys.includes(key)) expect({ key, first: keys.indexOf(key) < keys.indexOf("items") }).toEqual({ key, first: true });
      // last is the beat of the last item given, never one past it; more is every beat still waiting.
      expect(read.last).toBe(given.at(-1)?.beat);
      const waiting = beats.length - items.length;
      expect(read.more).toBe(waiting > 0 ? waiting : undefined);
      if (waiting > 0 && given.length < settings.story.limits.feedItems) heldBySize = true;
      if (read.more === undefined) break;
      expect(String(read.note)).toContain(STORY_LIMIT_LABELS.feedItems);
      after = String(read.last);
    }
    expect(heldBySize).toBe(true);
    // Each beat once, in order, whole.
    expect(items.map((i) => i.beat)).toEqual(beats.map((b) => b.id));
    expect(items.map((i) => [i.surface, i.quotes])).toEqual(beats.map((b) => [b.surface, b.quotes ?? []]));
  });
});

describe("mind_seed gives the mind's files first", () => {
  test("with every file of the mind at its longest, the files come before the record, whole within what the harness says reaches the author whole", async () => {
    const { rig, chatId } = await castChat();
    const settings = await rig.rt.settings.get(rig.host.userId);
    const turn = await castTurn(rig, chatId, { story: memoryStory({ cast: [{ entity: MARA, standing: "principal" }] }) });
    const files = memoryFiles();
    const max = settings.story.minds.chars;
    for (const id of MIND_FILE_IDS) await files.write(mindPath(MARA, id), prose(max[id]), null);
    const out = await call({ ...castEnv(rig, chatId, turn, HARNESS_AGENT.author), files }, "mind_seed", { who: "Mara" });
    expect(out.error).toBeUndefined();
    const shown = out.text.slice(0, (await wholeOf(rig, chatId, settings, "mind_seed")) ?? 0);
    for (const id of MIND_FILE_IDS) expect({ id, whole: shown.includes(prose(max[id])) }).toEqual({ id, whole: true });
    // The record, which nothing bounds, comes after them: a clip takes its end, never a file.
    expect(out.text.indexOf(renderPrompt(MINDS_NOTE.seedFiles, {}, {}))).toBeLessThan(out.text.indexOf(renderPrompt(MINDS_NOTE.seedSheet, {}, {})));
  });
});

/** Every page of `tool` with `args` read through `env`, each within `whole`, the page notes' cursors followed to the end. */
async function allPages(env: Parameters<typeof call>[0], tool: string, args: JsonObject, whole: number): Promise<Record<string, unknown>[]> {
  const pages: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (;;) {
    const { read } = await within(env, tool, { ...args, ...(cursor !== undefined ? { cursor } : {}) }, whole);
    pages.push(read);
    const next = /cursor (\d+:\d+)/.exec(String(read.page ?? ""))?.[1];
    if (next === undefined) return pages;
    // A page that goes on names the setting that bounds it.
    expect(String(read.page)).toContain(LOOP_DEFS.clipChars.label);
    cursor = next;
  }
}

describe("a lore read longer than one answer comes in pages on the harness", () => {
  /** A Port Alder chat whose lore holds `text` as one entry. */
  async function loreChat(text: string) {
    const entry = { id: "harbor_history", title: "The harbor's history", content: text, keys: ["harbor"], links: [] };
    const { rig, chatId } = await alderChat({ put: { lore: { harbor_history: entry } } });
    const settings = await rig.rt.settings.get(rig.host.userId);
    return { rig, chatId, settings, whole: (await wholeOf(rig, chatId, settings, "lore_read")) ?? 0 };
  }

  /** Long-form lore with what JSON escapes and characters of two code units, past three pages. */
  const long = (): string => `${prose(defaultSettings().agents.clipChars * 3)}\n🌊 The tide keeps its own calendar. 🌊\n${prose(defaultSettings().agents.clipChars)}`;

  test("an entry longer than a page is read whole across cursors, in a turn and in a conversation tied to none, nothing lost or repeated", async () => {
    const text = long();
    const { rig, chatId, settings, whole } = await loreChat(text);
    expect(whole).toBe(settings.agents.clipChars);
    // In a turn, and in the GM assistant's conversation or any other with an agent, which carries no turn.
    for (const env of [castEnv(rig, chatId, await castTurn(rig, chatId)), castEnv(rig, chatId, null, HARNESS_AGENT.assistant)]) {
      const pages = await allPages(env, "lore_read", { id: "harbor_history" }, whole);
      expect(pages.length).toBeGreaterThan(3);
      expect(pages.map((p) => p.text).join("")).toBe(text);
    }
    const env = castEnv(rig, chatId, null);
    expect((await call(env, "lore_read", { id: "harbor_history", cursor: "not-a-cursor" })).error).toBe(true);
  });

  test("an entry edited between two pages is noticed, and the next page says to read it again from the first", async () => {
    const { rig, chatId } = await alderChat();
    const user = rig.host.userId;
    const bookId = await rig.host.books.create("Harbor notes", "", user);
    const entry: HostBookEntryInput = { comment: "Harbor", content: long(), keys: ["harbor"], secondaryKeys: [], disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {} };
    const entryId = await rig.host.books.createEntry(bookId, entry, user);
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [bookId] }, user);
    const env = castEnv(rig, chatId, null);
    const first = JSON.parse((await call(env, "lore_read", { id: `${bookId}/${entryId}` })).text) as { page: string };
    const cursor = /cursor (\d+:\d+)/.exec(first.page)?.[1] ?? "";
    // The same length, other words: a bare place in the text would read on into it unnoticed.
    rig.host.editEntry(entryId, { content: long().replaceAll("lamp", "LAMP") });
    const next = await call(env, "lore_read", { id: `${bookId}/${entryId}`, cursor });
    expect(next.error).toBe(true);
    expect(next.text).toContain("from the first page");
  });

  test("lore_grep pages its lines the same way, and a line too long for a page of its own says what is left out and how to read it", async () => {
    // The entry's own word, which no other lore of Port Alder's holds.
    const short = Array.from({ length: 400 }, (_, i) => `Pier ${i}: the quaymaster logs a boat.`);
    const line = `The quaymaster ${prose(defaultSettings().agents.clipChars * 2).replaceAll("\n", " ")}`;
    const { rig, chatId, settings } = await loreChat([...short, line].join("\n"));
    const pages = await allPages(castEnv(rig, chatId, null), "lore_grep", { text: "quaymaster" }, (await wholeOf(rig, chatId, settings, "lore_grep")) ?? 0);
    const matches = pages.flatMap((p) => p.matches as JsonObject[]);
    expect(matches.map((m) => Number(m.line))).toEqual(Array.from({ length: 401 }, (_, i) => i + 1));
    const cut = matches.find((m) => m.cut !== undefined);
    expect(String(cut?.cut)).toContain(LOOP_DEFS.clipChars.label);
    expect(String(cut?.cut)).toContain("lore_read");
    expect(line.startsWith(String(cut?.text))).toBe(true);
  });

  test("the old engines' lore reads promise no pages, take no cursor, and answer whole as they did", async () => {
    const text = long();
    const { rig, chatId } = await loreChat(text);
    const { world } = await stateOf(rig, chatId);
    const env = toolEnv(rig, chatId, "gm");
    const old = toolsFor({ world, tiers: ["read"], families: ["lore"], texts: {}, env });
    const harness = harnessTools({ world, registry: rig.rt.registry, settings: defaultSettings() });
    for (const name of ["lore_index", "lore_search", "lore_grep", "lore_read"]) {
      const was = old.find((t) => t.name === name);
      const now = harness.find((t) => t.name === name);
      expect({ name, old: was?.description.includes("pages"), cursor: Object.keys((was?.parameters.properties ?? {}) as JsonObject).includes("cursor") }).toEqual({ name, old: false, cursor: false });
      expect({ name, harness: now?.description.includes("pages"), cursor: Object.keys((now?.parameters.properties ?? {}) as JsonObject).includes("cursor") }).toEqual({ name, harness: true, cursor: true });
    }
    const out = await LORE_TOOLS.find((t) => t.name === "lore_read")?.run({ id: "harbor_history" }, env);
    expect((JSON.parse(out?.text ?? "{}") as { text: string }).text).toBe(text);
  });
});

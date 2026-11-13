// Reads a reader gets whole (the tuning build's whole reads): what one call of `beats_read`,
// `feed_read` and `mind_seed` may give at the longest the player's settings allow comes back within
// what the harness states it gives whole (its `wholeChars`), and a lore entry, or a grep's lines,
// longer than one answer come in pages that read on by cursor with nothing lost or given twice.
// Each tool is called as the bridge calls it (`runHarnessTool`), on a real chat.

import { describe, expect, test } from "bun:test";
import { harnessTools } from "../../src/backend/agents/tools/harness";
import { defaultSettings } from "../../src/backend/settings-store";
import { mindPath } from "../../src/backend/story/minds";
import { LOOP_DEFS } from "../../src/shared/agent-settings";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { RECORD_TOOL } from "../../src/shared/harness-texts-record";
import type { JsonObject } from "../../src/shared/json";
import type { Beat, RecStory } from "../../src/shared/ledger";
import { MIND_FILE_IDS, STORY_LIMIT_LABELS, type UserSettings } from "../../src/shared/settings";
import type { Rig } from "../support/rig";
import { stateOf } from "../support/mind-chat";
import { alderChat, HOME } from "../support/tools";
import { answer, call, castChat, castEnv, castTurn, JOSS, MARA, memoryFiles, memoryStory } from "./harness-cast-kit";

/** Text `n` characters long that JSON has to escape in places: quote marks and line breaks, as prose has. */
const prose = (n: number): string => 'She said "not tonight".\nThe harbor lamps went out one by one. '.repeat(Math.ceil(n / 60) + 1).slice(0, n);

/** What the harness states it gives whole of `tool` in `chatId` under `settings`; absent, it states nothing. */
async function wholeOf(rig: Rig, chatId: string, settings: UserSettings, tool: string): Promise<number | undefined> {
  const { world } = await stateOf(rig, chatId);
  return harnessTools({ world, registry: rig.rt.registry, settings }).find((t) => t.name === tool)?.wholeChars;
}

/** Beat `i` at the longest the record's limits let one be written: every text full, every person it may name named, each but Mara told of it with what they got. */
function longestBeat(settings: UserSettings, i: number): Beat {
  const { limits } = settings.story;
  const people = [MARA, ...Array.from({ length: limits.people - 1 }, (_, k) => `harbor_regular_${k}`)];
  return {
    id: `beat_${String(i).padStart(3, "0")}`,
    turn: "turn-held",
    at: 1000 + i,
    where: HOME,
    by: JOSS,
    kind: "say",
    what: prose(limits.beatChars),
    surface: prose(limits.beatChars),
    quotes: Array.from({ length: limits.quotes }, () => prose(limits.quoteChars)),
    to: people,
    exposure: people.map((who, k) => (k === 0 ? { who, reach: "whole" as const } : { who, reach: "told" as const, got: prose(limits.beatChars), from: JOSS })),
    decidedBy: { agent: HARNESS_AGENT.character, as: JOSS },
    settles: "draft_harbor_lamps",
  };
}

/** A cast chat whose story record holds one beat more than one read gives, each at its longest, with Mara a principal. */
async function longRecord() {
  const { rig, chatId } = await castChat();
  const settings = await rig.rt.settings.get(rig.host.userId);
  const count = settings.story.limits.beatsRead + 1;
  const held: RecStory = { beats: Array.from({ length: count }, (_, i) => longestBeat(settings, i)), cast: [{ entity: MARA, standing: "principal" }] };
  const turn = await castTurn(rig, chatId, { main: false, story: memoryStory(held, false) });
  return { rig, chatId, settings, turn, count };
}

/** The ids of what a list answer gives at `key`, each item's own at `id`. */
const ids = (out: Record<string, unknown>, key: string, id: string): string[] => (out[key] as JsonObject[]).map((item) => String(item[id]));

describe("a read of the story record comes back whole", () => {
  test("Beats in one read's beats at their longest come back whole from one beats_read, and the earlier ones by before, none lost or given twice", async () => {
    const { rig, chatId, settings, turn, count } = await longRecord();
    const gm = castEnv(rig, chatId, turn, HARNESS_AGENT.gm);
    const whole = await wholeOf(rig, chatId, settings, RECORD_TOOL.beatsRead);
    const out = await call(gm, RECORD_TOOL.beatsRead, {});
    expect(out.error).toBeUndefined();
    // Far past what LumiAH clips a result at, and within what the harness says reaches the reader whole.
    expect(out.text.length).toBeGreaterThan(24_000);
    expect(out.text.length).toBeLessThanOrEqual(whole ?? 0);
    const read = JSON.parse(out.text) as Record<string, unknown>;
    const beats = read.beats as JsonObject[];
    expect(beats.length).toBe(settings.story.limits.beatsRead);
    for (const beat of beats) expect([beat.what, (beat.quotes as string[]).length, (beat.exposure as JsonObject[]).length]).toEqual([prose(settings.story.limits.beatChars), settings.story.limits.quotes, settings.story.limits.people]);
    // What was left out is said, with the setting that bounds a read, and read on from the oldest given.
    expect(read.earlier).toBe(1);
    expect(String(read.note)).toContain(STORY_LIMIT_LABELS.beatsRead);
    const first = String(beats[0]?.id);
    expect(String(read.note)).toContain(first);
    const before = await answer(gm, RECORD_TOOL.beatsRead, { before: first });
    expect(before.earlier).toBeUndefined();
    const all = [...ids(before, "beats", "id"), ...ids(read, "beats", "id")];
    expect(all).toEqual(Array.from({ length: count }, (_, i) => longestBeat(settings, i).id));
  });

  test("Beats taken in at once's beats at their longest come back whole from one feed_read, and the rest after last", async () => {
    const { rig, chatId, settings, turn, count } = await longRecord();
    const mara = castEnv(rig, chatId, turn, HARNESS_AGENT.character, null, MARA);
    const whole = await wholeOf(rig, chatId, settings, RECORD_TOOL.feedRead);
    const out = await call(mara, RECORD_TOOL.feedRead, {});
    expect(out.error).toBeUndefined();
    expect(out.text.length).toBeGreaterThan(24_000);
    expect(out.text.length).toBeLessThanOrEqual(whole ?? 0);
    const fed = JSON.parse(out.text) as Record<string, unknown>;
    const items = fed.items as JsonObject[];
    expect(items.length).toBe(settings.story.limits.feedItems);
    for (const item of items) expect([item.reach, item.surface, (item.quotes as string[]).length]).toEqual(["whole", prose(settings.story.limits.beatChars), settings.story.limits.quotes]);
    expect(fed.more).toBe(1);
    expect(String(fed.note)).toContain(STORY_LIMIT_LABELS.feedItems);
    const rest = await answer(mara, RECORD_TOOL.feedRead, { after: String(fed.last) });
    expect([...ids(fed, "items", "beat"), ...ids(rest, "items", "beat")]).toEqual(Array.from({ length: count }, (_, i) => longestBeat(settings, i).id));
  });
});

describe("mind_seed comes back whole", () => {
  test("with every file of the mind at its longest, the whole of it is within what the harness says reaches the author whole", async () => {
    const { rig, chatId } = await castChat();
    const settings = await rig.rt.settings.get(rig.host.userId);
    const turn = await castTurn(rig, chatId, { story: memoryStory({ cast: [{ entity: MARA, standing: "principal" }] }) });
    const files = memoryFiles();
    const max = settings.story.minds.chars;
    for (const id of MIND_FILE_IDS) await files.write(mindPath(MARA, id), prose(max[id]), null);
    const out = await call({ ...castEnv(rig, chatId, turn, HARNESS_AGENT.author), files }, "mind_seed", { who: "Mara" });
    expect(out.error).toBeUndefined();
    for (const id of MIND_FILE_IDS) expect({ id, whole: out.text.includes(prose(max[id])) }).toEqual({ id, whole: true });
    expect(out.text.length).toBeGreaterThan(24_000);
    expect(out.text.length).toBeLessThanOrEqual((await wholeOf(rig, chatId, settings, "mind_seed")) ?? 0);
  });
});

describe("a lore read longer than one answer comes in pages", () => {
  /** A Port Alder chat whose lore holds `entry`, and the author's env in a turn on it. */
  async function loreChat(text: string) {
    const entry = { id: "harbor_history", title: "The harbor's history", content: text, keys: ["harbor"], links: [] };
    const { rig, chatId } = await alderChat({ put: { lore: { harbor_history: entry } } });
    const settings = await rig.rt.settings.get(rig.host.userId);
    const env = castEnv(rig, chatId, await castTurn(rig, chatId));
    return { rig, chatId, settings, env };
  }

  test("an entry longer than a page is read whole across cursors, nothing lost or repeated, each page within what the harness gives whole", async () => {
    // Long-form lore with what JSON escapes and characters of two code units, past three pages.
    const page = defaultSettings().agents.clipChars;
    const text = `${prose(page * 3)}\n🌊 The tide keeps its own calendar. 🌊\n${prose(page)}`;
    const { rig, chatId, settings, env } = await loreChat(text);
    const whole = (await wholeOf(rig, chatId, settings, "lore_read")) ?? 0;
    expect(whole).toBe(settings.agents.clipChars);
    let read = "";
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const out = await call(env, "lore_read", { id: "harbor_history", ...(cursor !== undefined ? { cursor } : {}) });
      expect(out.error).toBeUndefined();
      expect(out.text.length).toBeLessThanOrEqual(whole);
      const got = JSON.parse(out.text) as { text: string; page?: string; title: string };
      expect(got.title).toBe("The harbor's history");
      read += got.text;
      pages++;
      const next = /cursor (\d+)/.exec(got.page ?? "")?.[1];
      if (next === undefined) break;
      // A page that goes on names the setting that bounds it.
      expect(got.page).toContain(LOOP_DEFS.clipChars.label);
      cursor = next;
    }
    expect(pages).toBeGreaterThan(3);
    expect(read).toBe(text);
    // A cursor no answer gave is refused, and says how to start again.
    expect((await call(env, "lore_read", { id: "harbor_history", cursor: "not-a-cursor" })).error).toBe(true);
    expect((await call(env, "lore_read", { id: "harbor_history", cursor: String(text.length + 1) })).error).toBe(true);
  });

  test("lore_grep pages its lines the same way, and a line too long for a page of its own says what is left out and how to read it", async () => {
    // The entry's own word, which no other lore of Port Alder's holds.
    const short = Array.from({ length: 400 }, (_, i) => `Pier ${i}: the quaymaster logs a boat.`);
    const long = `The quaymaster ${prose(defaultSettings().agents.clipChars * 2).replaceAll("\n", " ")}`;
    const { rig, chatId, settings, env } = await loreChat([...short, long].join("\n"));
    const whole = (await wholeOf(rig, chatId, settings, "lore_grep")) ?? 0;
    const lines: number[] = [];
    let cut: JsonObject | undefined;
    let cursor: string | undefined;
    for (;;) {
      const out = await call(env, "lore_grep", { text: "quaymaster", ...(cursor !== undefined ? { cursor } : {}) });
      expect(out.error).toBeUndefined();
      expect(out.text.length).toBeLessThanOrEqual(whole);
      const got = JSON.parse(out.text) as { matches: JsonObject[]; page?: string };
      for (const m of got.matches) {
        lines.push(Number(m.line));
        if (m.cut !== undefined) cut = m;
      }
      const next = /cursor (\d+)/.exec(got.page ?? "")?.[1];
      if (next === undefined) break;
      cursor = next;
    }
    expect(lines).toEqual(Array.from({ length: 401 }, (_, i) => i + 1));
    expect(String(cut?.cut)).toContain(LOOP_DEFS.clipChars.label);
    expect(String(cut?.cut)).toContain("lore_read");
    expect(long.startsWith(String(cut?.text))).toBe(true);
  });
});

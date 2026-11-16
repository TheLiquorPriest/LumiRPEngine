import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadGuidance, type TemplatePart } from "../../src/app/guidance";
import type { JsonObject } from "rp-harness/contract";
import { createFolderHost } from "rp-harness/hosts/folder";
import { addCharacter, bindSource, castingItemId, charactersOf, type CastWrite, relationshipItemId, sourceKey, writeBase, writeCast } from "../../src/cast/record";
import { CAST_VIEWS, type CastViewInput, type CastViewName, castViews } from "../../src/cast/views";
import { CAST_SETTINGS } from "../../src/cast/kit";
import { type Bench, CHAT, dataOf, openBench, openTable, type Table, tokensOf, USER } from "./rig";
import { settingClock } from "../../src/store/blank";
import { engine, tick } from "../store/fixtures";

const PROMPTS = resolve(import.meta.dir, "../../guidance/.prompts");

let dir = "";
const layouts: Partial<Record<CastViewName, TemplatePart>> = {};

beforeAll(async () => {
  // The shipped layouts, loaded the way the agents' guidance is: as the shipped level of a folder host.
  dir = mkdtempSync(join(tmpdir(), "rpe-cast-views-"));
  mkdirSync(join(dir, "files", "defaults", ".prompts"), { recursive: true });
  for (const part of Object.values(CAST_VIEWS)) copyFileSync(join(PROMPTS, `${part}.md`), join(dir, "files", "defaults", ".prompts", `${part}.md`));
  mkdirSync(join(dir, "files", "chats", "hero", "c1"), { recursive: true });
  mkdirSync(join(dir, "host", "chats", "c1"), { recursive: true });
  writeFileSync(join(dir, "host", "chats", "c1", "chat.json"), JSON.stringify({ character: "hero" }));
  const host = await createFolderHost({ dir, user: "u1" });
  const guidance = loadGuidance(host.files, { user: "u1", chat: "c1", session: "s1" });
  for (const [view, part] of Object.entries(CAST_VIEWS)) {
    const loaded = await guidance.part(part);
    if (loaded?.format !== "template") throw new Error(`The shipped ${part} part did not load as a template.`);
    layouts[view as CastViewName] = loaded;
  }
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Bram, an invented innkeeper: cast, bound, drawn, and grown in one played turn. */
async function bram(t: Table, more: (id: string) => CastWrite[] = () => []): Promise<string> {
  t.shelf.put("card", "card-bram", "Bram Holloway", "c1");
  t.shelf.put("entry", "e-112", "The Gilded Hart", "r1");
  const id = (await t.writes.run((db) => addCharacter(db, USER, CHAT, "Bram", 1))).id;
  await t.writes.run((db) => {
    bindSource(db, USER, id, { kind: "card", ref: "card-bram", defines: null }, 2);
    bindSource(db, USER, id, { kind: "entry", ref: "e-112", defines: "background" }, 3);
    writeBase(
      db,
      { user: USER, turn: null, by: "author", agent: "author-1", now: 4 },
      id,
      { seed: "An innkeeper who keeps his head down.", soul: "Wants a quiet life.", inner_voice: "Counts things when nervous.", background: "Born in the inn's cellar." },
      { [sourceKey("card", "card-bram")]: "c1", [sourceKey("entry", "e-112")]: "r1" },
    );
  });
  await t.play([
    { character: id, part: "casting", item: castingItemId(id), value: { as: "supporting", line: "The innkeeper of the Gilded Hart." } },
    { character: id, part: "growth", item: null, value: { text: "No longer trusts a sealed letter.", cause: "The forged seal." } },
    ...more(id),
  ]);
  return id;
}

function input(t: Table, present: string[] = [], only?: CastViewName[]): CastViewInput {
  const given = only === undefined ? layouts : Object.fromEntries(only.map((v) => [v, layouts[v]]));
  return { store: t.store, user: USER, chat: CHAT, turn: null, character: "bram", present, sources: t.shelf.reader, layouts: given, tokens: tokensOf };
}

const BASE = [
  "### Bram (supporting)",
  "",
  "The innkeeper of the Gilded Hart.",
  "",
  "Seed: An innkeeper who keeps his head down.",
  "",
  "Soul: Wants a quiet life.",
  "",
  "Inner Voice: Counts things when nervous.",
  "",
  "Background: Born in the inn's cellar.",
  "",
  "How they have changed since:",
  "- No longer trusts a sealed letter. Because: The forged seal.",
  "",
  "Drawn from:",
  "- card card-bram: Bram Holloway",
  "- entry e-112: The Gilded Hart, for background",
].join("\n");

describe("the views a definition's given list names", () => {
  test("the base is shown with growth laid over it and the sources it was drawn from; growth beside it adds nothing, and alone shows growth", async () => {
    const t = await openTable();
    await bram(t);
    expect((await castViews(["base", "growth"], input(t))).map(({ name, text }) => ({ name, text }))).toEqual([
      { name: "base", text: BASE },
      { name: "growth", text: "" },
    ]);
    expect(await castViews(["growth"], input(t))).toEqual([{ name: "growth", text: "### How Bram has changed\n\n- No longer trusts a sealed letter. Because: The forged seal." }]);
  });

  test("the mind is laid out by kind, with what each is about; with nothing on it, there is no text", async () => {
    const t = await openTable();
    await bram(t);
    expect(await castViews(["mind"], input(t))).toEqual([{ name: "mind", text: "" }]);
    const t2 = await openTable();
    await bram(t2, (id): CastWrite[] => [
      { character: id, part: "mind", item: null, value: { kind: "attention", text: "The door, every time it opens." } },
      { character: id, part: "mind", item: null, value: { kind: "hiding", text: "He read the letter.", about: ["Wren", "the reeve"] } },
      { character: id, part: "mind", item: null, value: { kind: "feeling", text: "Cornered." } },
    ]);
    const [mind] = await castViews(["mind"], input(t2));
    expect(mind?.text).toBe(
      ["### On Bram's mind", "", "Attention:", "- The door, every time it opens.", "", "Feeling:", "- Cornered.", "", "What they hide:", "- He read the letter. (about Wren, the reeve)"].join("\n"),
    );
  });

  test("relationships are those toward whoever is on stage, the character itself left out, a dimension of 0 shown", async () => {
    const t = await openTable();
    await bram(t, (id): CastWrite[] => [
      { character: id, part: "relationship", item: relationshipItemId(id, "Wren"), value: { with: "Wren", text: "She pays on time.", trust: 40, fear: 0 } },
      { character: id, part: "relationship", item: relationshipItemId(id, "Hale"), value: { with: "Hale", text: "A cheat with a badge." } },
      { character: id, part: "relationship", item: relationshipItemId(id, "Bram"), value: { with: "Bram", text: "Tired of himself." } },
    ]);
    const [rel] = await castViews(["relationships:present"], input(t, ["wren", "Bram", "Odile"]));
    expect(rel?.text).toBe("### How Bram feels about those here\n\n- Wren: She pays on time. Trust 40. Fear 0.");
    expect(await castViews(["relationships:present"], input(t, ["Odile"]))).toEqual([{ name: "relationships:present", text: "" }]);
  });

  test("a view whose part is switched off gives no text; names that are not the cast's are left to others; someone not in the cast gives empty views", async () => {
    const t = await openTable();
    await bram(t);
    expect((await castViews(["base", "what-comes-to-mind", "lore:known-to-self"], input(t, [], ["growth"]))).map(({ name, text }) => ({ name, text }))).toEqual([
      { name: "base", text: "" },
      { name: "what-comes-to-mind", text: "" },
    ]);
    expect(await castViews(["story:brief"], input(t))).toEqual([]);
    expect(await castViews(["base", "mind"], { ...input(t), character: "Odile" })).toEqual([
      { name: "base", text: "" },
      { name: "mind", text: "" },
    ]);
  });

  test("views read the path: a growth written in a swiped turn is gone from the base, and back with the swipe", async () => {
    const t = await openTable();
    const id = await bram(t);
    const played = await t.play([{ character: id, part: "growth", item: null, value: { text: "Learned to say no.", cause: "Wren's example." } }]);
    expect((await castViews(["base"], input(t)))[0]?.text).toContain("- Learned to say no. Because: Wren's example.");
    const again = await t.swipe();
    await t.tie(again, "another reply");
    expect((await castViews(["base"], input(t)))[0]?.text).toBe(BASE);
    await t.showSwipe(played);
    expect((await castViews(["base"], input(t)))[0]?.text).toContain("Learned to say no.");
  });

  test("in a chat with no world, a history line carries no date until play has set the clock to a date and time: a move alone gives none", async () => {
    const b = await openBench({}, null);
    const first = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }, { op: "history", who: "Bram", text: "Took the inn over from his aunt." }] }, first.id);
    await b.t.tie(first);
    const undated = [{ name: "history" as const, text: "### Bram's history in the story\n- Took the inn over from his aunt." }];
    expect(await castViews(["history"], input(b.t))).toEqual(undated);

    const moved = await b.t.begin();
    await b.t.writes.run(() => b.t.s.addChanges(moved.id, engine(tick(60))));
    await b.t.tie(moved);
    expect(await castViews(["history"], input(b.t))).toEqual(undated);

    const set = await b.t.begin();
    await b.t.writes.run(() => b.t.s.addChanges(set.id, engine(settingClock(tick(60)))));
    await b.t.tie(set);
    expect((await castViews(["history"], input(b.t)))[0]?.text).toMatch(/^### Bram's history in the story\n- Took the inn over from his aunt\. \(.+\)$/);
  });
});

describe("perceptions not yet taken in", () => {
  test("a supporting character's kept perceptions are given in full to its first run once recast as a principal; one a memory names is taken in", async () => {
    const b = await openBench();
    const first = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Odile", as: "supporting" }] }, first.id);
    await b.call("perceive", { perceptions: [{ who: "Odile", moment: "The cellar door", reach: "part", content: "Boots on the stairs, then the bolt.", missed: "Who it was." }] }, first.id);
    await b.t.tie(first);
    const second = await b.t.begin();
    await b.call("perceive", { perceptions: [{ who: "Odile", reach: "told", content: "Bram says the reeve came by.", told_by: "Bram", reliability: "He was there.", knows: ["The reeve came by the inn."] }] }, second.id);
    await b.t.tie(second);

    const third = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Odile", as: "principal", why: "The player keeps seeking her out." }] }, third.id);
    const given = async () => (await castViews(["unprocessed-perceptions"], { ...input(b.t), turn: third.id, character: "Odile" }))[0]?.text ?? "";
    const ids = (dataOf(await b.call("cast_query", { who: "Odile", part: "perceptions" }, third.id))["perceptions"] as JsonObject[]).map((p) => String(p.id));
    expect(await given()).toBe(
      [
        "### What Odile has perceived and not yet taken in",
        "",
        `[${ids[0]}] The cellar door (Sat 1 Mar 2031, 8:00 AM), message 1`,
        "- How much reached them: part",
        "- What reached them: Boots on the stairs, then the bolt.",
        "",
        `[${ids[1]}] (Sat 1 Mar 2031, 8:00 AM), message 3`,
        "- How much reached them: told",
        "- What reached them: Bram says the reeve came by.",
        "- What they now know: The reeve came by the inn.",
        "- Told by Bram",
      ].join("\n"),
    );

    // Her own agent turns the first into a memory: only the second is still given.
    const odile = charactersOf(b.t.db, USER, [CHAT]).find((c) => c.name === "Odile")?.id ?? "";
    await b.t.write(third, [{ character: odile, part: "memory", item: null, value: { text: "Someone bolted me in.", gist: "Bolted in the cellar.", from: [ids[0] ?? ""] } }], "character");
    expect(await given()).not.toContain(ids[0] ?? "");
    expect(await given()).toContain(`[${ids[1]}]`);
  });

  test("a character's own view of what it perceived leaves out what it missed and the verdict on whoever told it; the Author reads both with cast_query", async () => {
    const b = await openBench();
    const turn = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id);
    const missed = "The letter says the reeve will seize the inn at dawn.";
    const verdict = "Odile is lying to him to cover her own debt.";
    const r = await b.call("perceive", { perceptions: [{ who: "Bram", reach: "told", content: "Odile says the letter is only a bill.", missed, told_by: "Odile", reliability: verdict, knows: ["Wren got a letter."] }] }, turn.id);
    expect(r.error).toBeUndefined();
    await b.t.tie(turn);

    const [own] = await castViews(["unprocessed-perceptions"], input(b.t));
    expect(own?.text).toContain("- What reached them: Odile says the letter is only a bill.");
    expect(own?.text).toContain("- What they now know: Wren got a letter.");
    expect(own?.text).toContain("- Told by Odile");
    expect(own?.text).not.toContain(missed);
    expect(own?.text).not.toContain(verdict);
    expect(dataOf(await b.call("cast_query", { who: "Bram", part: "perceptions" }, null))["perceptions"]).toEqual([expect.objectContaining({ missed, told_by: "Odile", reliability: verdict })]);
  });
});

describe("what comes to mind", () => {
  const BRAM = { id: "bram-1", definition: "character", plays: "Bram" };
  const undated = (text: string): string => text.replace(/ \([^()]*\d{4}[^()]*\)/g, "");

  /** Bram's memories: one at the top of his mind, two about the stage that have aged ten story days (one light, one heavy), one about nothing here, and a fresh one about Wren. */
  async function remembered(): Promise<{ b: Bench; ids: Record<string, string> }> {
    const b = await openBench();
    const first = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, first.id);
    const r = await b.call(
      "remember",
      {
        memories: [
          { text: "The forged seal on the letter.", gist: "The forged seal.", top: true },
          { text: "Wren paid in old coin.", gist: "Old coin.", who: ["Wren"] },
          { text: "Odile keeps the key on a string.", gist: "The key on a string.", weight: 3, about: ["the cellar"] },
          { text: "The harbour smelled of tar.", gist: "Tar." },
        ],
      },
      first.id,
      BRAM,
    );
    await b.t.tie(first);
    const later = await b.t.begin();
    await b.t.writes.run(() => b.t.s.addChanges(later.id, [{ lane: "engine", op: "clock", value: { type: "clock", minutes: 10 * 24 * 60, cause: "tick" } }]));
    const fresh = await b.call("remember", { memories: [{ text: "Wren laughed when the market bell cracked.", gist: "Wren laughed at the bell." }] }, later.id, BRAM);
    await b.t.tie(later);
    const made = [...(dataOf(r).memories as JsonObject[]), ...(dataOf(fresh).memories as JsonObject[])];
    return { b, ids: Object.fromEntries(made.map((m) => [String(m.gist), String(m.id)])) };
  }

  test("top of mind in full, then recent memories that touch who and what is here, then the strongest older ones, a faded one by its gist; nothing about anything else", async () => {
    const { b, ids } = await remembered();
    const [view] = await castViews(["what-comes-to-mind"], { ...input(b.t, ["Wren", "Bram"]), cues: ["the cellar"] });
    expect(undated(view?.text ?? "")).toBe(
      [
        "### What comes to Bram's mind",
        "",
        "At the top of their mind:",
        `- [${ids["The forged seal."]}] The forged seal on the letter.`,
        "",
        "Lately:",
        `- [${ids["Wren laughed at the bell."]}] Wren laughed when the market bell cracked.`,
        "",
        "From longer ago:",
        `- [${ids["The key on a string."]}] Odile keeps the key on a string.`,
        `- [${ids["Old coin."]}] (faint) Old coin.`,
      ].join("\n"),
    );
    // Matched by words as well as by tags: the harbour, once it is a cue; aged and light, it has faded to its gist.
    expect(undated((await castViews(["what-comes-to-mind"], { ...input(b.t, []), cues: ["harbour"] }))[0]?.text ?? "")).toContain(`- [${ids["Tar."]}] (faint) Tar.`);
  });

  test("it fits its budget after the top of mind, which stands whole whatever the budget, and says how many it left out", async () => {
    const { b } = await remembered();
    const shown = (text: string): number => text.split("\n").filter((l) => l.startsWith("- [")).length;
    for (const budget of [52, 56]) {
      const [view] = await castViews(["what-comes-to-mind"], { ...input(b.t, ["Wren"]), cues: ["the cellar"], settings: { comesToMindTokens: budget } });
      const text = view?.text ?? "";
      expect(tokensOf(text)).toBeLessThanOrEqual(budget);
      expect(shown(text)).toBeLessThan(4);
      expect(text).toEndWith(`${4 - shown(text)} more memories touch who and what is here, and were left out for room.`);
    }
    // A budget smaller than the top of mind alone does not cut it.
    const [tiny] = await castViews(["what-comes-to-mind"], { ...input(b.t, ["Wren"]), settings: { comesToMindTokens: 1 } });
    expect(tiny?.text).toContain("- [");
    expect(tiny?.text).toContain("The forged seal on the letter.");
  });

  test("its budget is counted by the count the turn passes: a changed count changes how many fit, and the settings list holds no cast.charsPerToken", async () => {
    const { b } = await remembered();
    const shown = (text: string): number => text.split("\n").filter((l) => l.startsWith("- [")).length;
    const at = async (tokens: (text: string) => number): Promise<string> => (await castViews(["what-comes-to-mind"], { ...input(b.t, ["Wren"]), cues: ["the cellar"], settings: { comesToMindTokens: 60 }, tokens }))[0]?.text ?? "";
    expect(shown(await at((text) => Math.ceil(text.length / 20)))).toBe(4);
    expect(shown(await at((text) => Math.ceil(text.length / 2)))).toBeLessThan(4);
    expect(CAST_SETTINGS.map((s) => s.key)).not.toContain("cast.charsPerToken");
  });

  test("the tone is printed; a two-word name touches a memory tagged by its first word, a long place a memory about its house", async () => {
    const b = await openBench();
    const turn = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id);
    await b.call(
      "remember",
      {
        memories: [
          { text: "Wren paid in old coin.", gist: "Old coin.", who: ["Wren"], tone: "wary" },
          { text: "The Gilded Hart was loud.", gist: "Loud.", about: ["the Gilded Hart"] },
          { text: "The harbour smelled of tar.", gist: "Tar." },
        ],
      },
      turn.id,
      BRAM,
    );
    await b.t.tie(turn);
    const text = (await castViews(["what-comes-to-mind"], { ...input(b.t, []), cues: ["Wren Hale", "the taproom of the Gilded Hart"] }))[0]?.text ?? "";
    expect(undated(text)).toContain("Wren paid in old coin. (felt wary)");
    expect(text).toContain("The Gilded Hart was loud.");
    expect(text).not.toContain("tar.");
  });
});

describe("what a character has taken in", () => {
  const BRAM = { id: "bram-1", definition: "character", plays: "Bram" };

  test("a perception named by a mind entry is no longer given; one taken in with nothing to remember is not given again; a struck memory's perceptions are given again", async () => {
    const b = await openBench();
    const turn = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Bram", as: "principal" }] }, turn.id);
    const r = await b.call(
      "perceive",
      {
        perceptions: [
          { who: "Bram", reach: "whole", content: "Wren breaks the seal." },
          { who: "Bram", reach: "part", content: "The bell rings.", missed: "Who rang it." },
          { who: "Bram", reach: "none", content: "Nothing happens at the door." },
        ],
      },
      turn.id,
    );
    const [seal, bell, door] = (dataOf(r).perceptions as JsonObject[]).map((p) => String(p.id));
    await b.t.tie(turn);
    const given = async (): Promise<string> => (await castViews(["unprocessed-perceptions"], { store: b.t.store, user: USER, chat: CHAT, turn: null, character: "Bram", present: [], sources: b.t.shelf.reader, layouts, tokens: tokensOf }))[0]?.text ?? "";
    expect(await given()).toContain("Wren breaks the seal.");

    const next = await b.t.begin();
    await b.call("mind_set", { entries: [{ kind: "belief", text: "The seal was forged.", from: [seal] }] }, next.id, BRAM);
    await b.call("remember", { memories: [{ taken: [door] }] }, next.id, BRAM);
    const made = await b.call("remember", { memories: [{ text: "The bell rang.", gist: "The bell.", from: [bell] }] }, next.id, BRAM);
    await b.t.tie(next);
    expect(await given()).toBe("");

    // The player strikes the memory as wrong: what it came from is given again.
    const character = b.t.record().items.values().find((i) => i.part === "casting")?.character ?? "";
    const memory = String(((dataOf(made).memories as JsonObject[])[0] as JsonObject).id);
    await b.t.writes.run(() => writeCast(b.t.store, { user: USER, turn: null, chat: CHAT, by: "player", agent: null, job: null, at: null, now: 9 }, [{ character, part: "memory", item: memory, value: { drop: true } }]));
    const again = await given();
    expect(again).toContain("The bell rings.");
    expect(again).not.toContain("Wren breaks the seal.");
    expect(again).not.toContain("Nothing happens at the door.");
  });
});

describe("the base's versions", () => {
  test("the base view names the version of each part it shows, and a redraw of her soul raises it", async () => {
    const t = await openTable();
    const id = await bram(t);
    const named = async (): Promise<{ parts: Record<string, number>; newest: number } | undefined> => (await castViews(["base"], input(t)))[0]?.version;
    expect(await named()).toEqual({ parts: { seed: 1, soul: 1, inner_voice: 1, background: 1 }, newest: 4 });
    await t.writes.run((db) => writeBase(db, { user: USER, turn: null, by: "author", agent: "author-1", now: 5 }, id, { soul: "Wants a quiet life, and a locked cellar." }, {}));
    expect(await named()).toEqual({ parts: { seed: 1, soul: 2, inner_voice: 1, background: 1 }, newest: 5 });
  });
});

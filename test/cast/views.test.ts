import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadGuidance, type TemplatePart } from "rp-harness";
import { createFolderHost } from "rp-harness/hosts/folder";
import { addCharacter, bindSource, castingItemId, type CastWrite, relationshipItemId, sourceKey, writeBase } from "../../src/cast/record";
import { CAST_VIEWS, type CastViewInput, type CastViewName, castViews } from "../../src/cast/views";
import { CHAT, openTable, type Table, USER } from "./rig";

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
  expect(await guidance.problems()).toEqual([]);
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
  return { store: t.store, user: USER, chat: CHAT, turn: null, character: "bram", present, sources: t.shelf.reader, layouts: given };
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
    expect(await castViews(["base", "growth"], input(t))).toEqual([
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
    expect(await castViews(["base", "what-comes-to-mind", "game-side"], input(t, [], ["growth"]))).toEqual([{ name: "base", text: "" }]);
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
});

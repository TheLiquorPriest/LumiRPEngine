// The lore map in full (plan §9.2): what activated with what the index says of it; those of them the
// story has outdated, with the overlays' notes; the world's entries whose keys come up; and the
// entries bound to who and what is on the horizon, the player's character's first, up to the limit
// with a count of what is left out; and how much is not indexed yet. Laid out by the shipped part.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lore, LoreIndex, loreLines, loreMapFields, type LoreWorlds } from "../../src/lore/index";
import type { TurnLoreMap } from "../../src/lore/indexing";
import { ATLAS, CHAT, coastWorld, dbFile, type LoreDb, loreDb, scanned, Shelf, startingWorlds, Tags, USER, W } from "./fixtures";
import { type LoreGuidance, shippedGuidance } from "./shipped";

const AT = { user: USER, chat: CHAT };
const GULL = "Gulls nest on the harbor wall every spring…";

describe("the lore map in full", () => {
  let dir: string;
  let db: LoreDb;
  let files: LoreGuidance;
  let index: LoreIndex;
  let worlds: LoreWorlds;
  let horizon: string[] = [];
  let map: TurnLoreMap;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "rpe-lore-full-map-"));
    const { file, backups } = dbFile(dir);
    db = loreDb(file, backups);
    files = await shippedGuidance(join(dir, "tree"), [CHAT]);
    // The coast at its start, with the Author's horizon as each test sets it.
    const start = startingWorlds(coastWorld());
    worlds = { registry: start.registry, at: (user, chat) => { const at = start.at(user, chat); return at === null ? null : { ...at, horizon }; } };
    const tags = new Tags();
    tags.set(USER, CHAT, "turn-1", [
      { id: "entry-lamp", book: ATLAS.id, title: "The lamp room", how: "keyword" },
      { id: "entry-gull", book: ATLAS.id, title: "", how: "keyword" },
    ]);
    const lore = new Lore({ books: new Shelf(), worlds, turns: tags, numbers: db.numbers });
    // The chat's path as the store folded it: two turns' overlays. A third turn, swiped away, is on no path and has none here.
    const overlays = [
      { id: 1, entry: "e-2", note: "The lamp was relit after the wreck.", turn: "turn-0", number: 1, by: "author", agent: null },
      { id: 2, entry: "e-2", note: "Its glass cracked in the storm.", turn: "turn-1", number: 2, by: "author", agent: null },
    ];
    index = new LoreIndex({ lore, db: db.db, writes: db.writes, path: { overlays: () => overlays }, settings: { bound: 3 } });
    // The books' entries are numbered as the index first reads them: the shanty e-1, the lamp room e-2, the gulls e-3, the tide bell e-4, the switched-off rumor e-5, the card's twin of the lamp room e-6.
    const read = await index.entries(AT);
    expect(read.filter((e) => e.book !== null).map((e) => e.id)).toEqual(["e-1", "e-2", "e-3", "e-4", "e-5", "e-6"]);
    // A run hands back each entry's revision as its batch showed it.
    const revision = (id: string): string => read.find((e) => e.id === id)?.revision ?? "";
    await index.write(
      AT,
      [
        { id: "e-1", revision: revision("e-1"), kind: "style", line: "A song of the lamp room.", defines: [{ what: "nell", aspect: "voice" }], related: [] },
        { id: "e-2", revision: revision("e-2"), kind: "place", line: "The lighthouse's lamp room.", defines: [{ what: "The Lighthouse", aspect: "layout" }], related: [] },
        { id: "e-4", revision: revision("e-4"), kind: "item", line: "The bell on the market quay.", defines: [{ what: "the  FISHMARKET", aspect: "sound" }], related: [] },
        { id: W.tithe_law, revision: revision(W.tithe_law), kind: "rule", line: "A tenth of every catch.", defines: [{ what: "Orrin Pell", aspect: "" }], related: [] },
        { id: W.cove_route, revision: revision(W.cove_route), kind: "rule", line: "Sefa's brandy run.", defines: [{ what: "entity:sefa", aspect: "" }], related: [] },
        { id: W.ferry_draft, revision: revision(W.ferry_draft), kind: "place", line: "The estuary ferry.", defines: [{ what: "Tobin Reed", aspect: "" }], related: [] },
        { id: W.keeper_log, revision: revision(W.keeper_log), kind: "item", line: "Forty winters of weather.", defines: [{ what: "Orrin Pell", aspect: "history" }], related: [] },
      ],
      "indexer",
    );
    horizon = ["fishmarket", "lighthouse", "sefa"];
    map = await index.loreMap({ ...AT, turn: "turn-1", ...scanned(["Nell counts out the TITHE on the harbor steps."]) });
  });
  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("lists what activated, what the story changed of it, the world's entries the chat names, and what is bound to the horizon", () => {
    expect(map).toEqual({
      inPrompt: [
        // Every part that shows an entry shows the notes on it, each with the turn it was written on (its place on the path, from 1).
        { id: "e-2", title: "The lamp room", source: "Reed Coast Atlas", how: "keyword", kind: "place", line: "The lighthouse's lamp room.", defines: [{ what: "The Lighthouse", aspect: "layout" }], notes: [{ note: "The lamp was relit after the wreck.", turn: 1 }, { note: "Its glass cracked in the storm.", turn: 2 }] },
        // No run has indexed it: its keys stand in.
        { id: "e-3", title: GULL, source: "Reed Coast Atlas", how: "keyword", keys: ["gull"] },
      ],
      // Part 2: those of part 1 with notes, on the turns on the path, oldest first.
      changed: [{ id: "e-2", title: "The lamp room", source: "Reed Coast Atlas", how: "keyword", kind: "place", line: "The lighthouse's lamp room.", defines: [{ what: "The Lighthouse", aspect: "layout" }], notes: [{ note: "The lamp was relit after the wreck.", turn: 1 }, { note: "Its glass cracked in the storm.", turn: 2 }] }],
      world: [{ id: W.tithe_law, title: "The harbor tithe", kind: "rule", line: "A tenth of every catch.", defines: [{ what: "Orrin Pell", aspect: "" }] }],
      // The player's character's first, then each character present, then the places; none that is in the parts above.
      // The tide bell, bound to the fishmarket, is past the limit; the ferry is bound to nobody on the horizon.
      bound: [
        // Each binding reads as the name its record has now: the run said "nell", and the record is Nell Harrow.
        { id: "e-1", title: "The Lamplighter's Shanty", kind: "style", line: "A song of the lamp room.", defines: [{ what: "Nell Harrow", aspect: "voice" }], bound: ["Nell Harrow"] },
        { id: W.keeper_log, title: "The lighthouse keeper's log", kind: "item", line: "Forty winters of weather.", defines: [{ what: "Orrin Pell", aspect: "history" }], bound: ["Orrin Pell"] },
        { id: W.cove_route, title: "The cove route", kind: "rule", line: "Sefa's brandy run.", defines: [{ what: "Sefa Moor", aspect: "" }], bound: ["Sefa Moor"] },
      ],
      leftOut: 1,
      // The gulls, the drowned crown, the switched-off rumor and the card's twin.
      notIndexed: 4,
      // What activated, as the map read it, text and all: the turn's folder lays its lore file out from this, reading nothing again.
      activated: [
        { id: "e-2", title: "The lamp room", source: "Reed Coast Atlas", how: "keyword", text: "Green glass and whale oil, kept burning by the night watch." },
        { id: "e-3", title: GULL, source: "Reed Coast Atlas", how: "keyword", text: "Gulls nest on the harbor wall every spring and fight over the fish scraps." },
      ],
    });
  });

  test("lore_read carries the notes of the entry too, in the path's order", async () => {
    const [read] = await index.read({ ...AT, turn: "turn-1" }, ["e-2"]);
    expect(read?.text.split("\n\n").slice(1)).toEqual(["The lamp was relit after the wreck.", "Its glass cracked in the storm."]);
  });

  // The shipped layout and lines word how each entry came into the prompt, that it changed since it was indexed and the turn a note was written on (c7ce1232f, 557dbe620).
  test("is laid out by the shipped part, each entry worded by the lore's lines", async () => {
    const guidance = files.guidance(CHAT);
    const part = await guidance.part("lore-map");
    if (part?.format !== "template") throw new Error("the shipped lore map part did not load as a template");
    const text = part.render({ ...loreMapFields(map, await loreLines(guidance)) }).text.trim();
    expect(text.split("\n")).toEqual([
      "### In the prompt, each in full, as its text alone with no title or id",
      "",
      "- [e-2] The lamp room (place): The lighthouse's lamp room. Defines The Lighthouse (layout). The lamp was relit after the wreck. (on turn 1). Its glass cracked in the storm. (on turn 2). (by a key)",
      `- [e-3] ${GULL} (by a key) (not indexed yet; keys: gull)`,
      "",
      "### Changed by the story",
      "",
      "- [e-2] The lamp room: The lamp was relit after the wreck. (on turn 1) Its glass cracked in the storm. (on turn 2)",
      "",
      "### From the world's own lore, not in the prompt",
      "",
      `- [${W.tithe_law}] The harbor tithe (rule): A tenth of every catch.`,
      "",
      "### Not in the prompt, but bound to who and what is at hand",
      "",
      "- [e-1] The Lamplighter's Shanty (style): A song of the lamp room. Bound to Nell Harrow.",
      `- [${W.keeper_log}] The lighthouse keeper's log (item): Forty winters of weather. Bound to Orrin Pell.`,
      `- [${W.cove_route}] The cove route (rule): Sefa's brandy run. Bound to Sefa Moor.`,
      "- and 1 more",
      "",
      "4 attached entries are not indexed yet. Where one is listed here, it shows by title and keys only.",
    ]);
  });

  test("follows the horizon as the Author moves it; the player's character is always at hand", async () => {
    horizon = [];
    const none = await index.loreMap({ ...AT, turn: "turn-1", ...scanned([]) });
    expect(none.bound?.map((l) => [l.id, l.bound])).toEqual([["e-1", ["Nell Harrow"]]]);
    horizon = ["net_lofts"];
    const lofts = await index.loreMap({ ...AT, turn: "turn-1", ...scanned([]) });
    // Nell's song, then the ferry bound to Tobin, who is in the lofts; the tithe, out of the world part now, is bound to Orrin, who is not.
    expect(lofts.bound?.map((l) => [l.id, l.bound])).toEqual([
      ["e-1", ["Nell Harrow"]],
      [W.ferry_draft, ["Tobin Reed"]],
    ]);
  });
});

// The Cast page, read from its view as drawn and from its reads: every character with its casting and
// counts; one opened shows its whole record, struck entries marked struck, memories with their tier,
// strength and fading, and the mind files a migration carried word for word with whether each is
// filed; the record, the Author's casting lines and what a strike let go stay behind the spoiler gate
// until it is opened; a strike posts to the route, shows what the cast did, and reads the record again;
// a refusal is shown in RPE's words. And the page has its place in both shells and in the web address.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { CastStrikeReply, CharacterReply, EntryRow, PerceptionRecordReply } from "../../src/shared/api";
import { PAGES } from "../../src/ui/page-list";
import { type CastShown, CastView, NO_CAST, readCast } from "../../src/ui/pages/cast";
import { hashOf, routeOfHash } from "../../src/ui/web";
import { askingClient, settle } from "./asking";
import { CARRIED_FILE, CAST, CHAT, MARKUP, ODILE, ODILE_RECORD } from "./records-recorded";
import { banners, elements, expand, press, textOf } from "./vnodes";

function view(shown: Partial<CastShown>, gateOpen = false) {
  const pressed: unknown[] = [];
  const tree = expand(
    h(CastView, {
      shown: { ...NO_CAST, loading: false, ...shown },
      gateOpen,
      onOpenGate: () => pressed.push("open gate"),
      onCloseGate: () => pressed.push("close gate"),
      onOpen: (id, at) => pressed.push(at === undefined ? ["open", id] : ["open", id, at]),
      onClose: () => pressed.push("close"),
      onStrike: (ask) => pressed.push(ask),
      onEdit: (edit) => pressed.push(edit),
      onMore: (list, skip) => pressed.push(["more", list, skip]),
      onNewest: () => pressed.push("newest"),
      onDraft: (name, value) => pressed.push(["draft", name, value]),
    }),
  );
  return { tree, text: textOf(tree), pressed };
}

const section = (tree: unknown, id: string): string => textOf(elements(tree).find((e) => e.props["data-section"] === id)?.props.children);
const entry = (tree: unknown, id: string) => elements(tree).find((e) => e.props["data-entry"] === id);

/** An entry of a record, to stand for what an away principal holds. */
const WHEREABOUTS: EntryRow = { ...(ODILE_RECORD.knowledge.items[0] as EntryRow), id: "away:odile", part: "away", fields: { whereabouts: "At the toll house.", intention: "Wait for the reeve to leave." } };

/** Odile's record with what the base, the sources, the Author's castings, an away principal, the game side and a long list add. */
const RICH: CharacterReply = {
  ...ODILE_RECORD,
  now: { parts: ODILE_RECORD.now.parts, growth: [{ id: "g-1", text: "Distrusts the reeve.", cause: "The toll.", date: "5 Thawmonth" }] },
  sources: [
    { kind: "card", ref: "card-odile", defines: "her looks", created: 1, title: "Odile Holt", state: "changed" },
    { kind: "entry", ref: "e-9", defines: null, created: 2, title: null, state: "gone" },
  ],
  castings: [{ turn: "turn-2", message: 3, imported: false, by: "player", wrote: { as: "principal", pinned: true, line: "Runs the ferry.", why: "She was asked to." } }],
  away: WHEREABOUTS,
  game: { ref: "entity:odile", where: { ".": ["The Ferry", "Thornbury"] }, holds: { items: [{ name: "a ferry pole" }] }, values: { items: [{ key: "coin", value: "12" }] } },
  memories: {
    items: ODILE_RECORD.memories.items.map((m) => (m.id === "mem-1" ? { ...m, fields: { ...m.fields, gist: "The rope." } } : m)),
    total: 60,
    before: 40,
    after: 0,
  },
};

describe("the Cast page", () => {
  test("lists every character with its casting, where its record came from and what it holds, struck counted apart", () => {
    const { tree, text, pressed } = view({ list: CAST }, true);
    expect(text).toContain("Odile Holt");
    expect(text).toContain("principal, pinned by you");
    expect(text).toContain("Runs the ferry, owes nobody.");
    expect(text).toContain("carried by the migration, and played on RPE · mind 1 (1 struck) · memories 2 · knowledge 1 · perceptions 1 · carried mind files 2 (1 filed)");
    expect(text).toContain("Tobin Reede");
    expect(text).toContain("not cast");
    expect(text).toContain("nothing written yet");
    const hit = elements(tree).find((e) => e.props["data-character"] === ODILE.id);
    (hit?.props.onClick as () => void)();
    expect(pressed).toEqual([["open", ODILE.id]]);
  });

  test("one character opened shows its whole record: the base in force and its earlier versions, memories with tier, strength and fading, struck entries as struck, and every carried mind file word for word with its filed mark", () => {
    const { tree, text } = view({ list: CAST, open: ODILE.id, character: ODILE_RECORD }, true);
    expect(section(tree, "base")).toContain("A ferrywoman who keeps the crossing open, toll or no toll.");
    expect(section(tree, "base")).toContain("Earlier versions (1)");
    const memories = section(tree, "memories");
    expect(memories).toContain("long term");
    expect(memories).toContain("strength 0.21");
    expect(memories).toContain("faint");
    expect(memories).toContain("top of mind");
    expect(memories).toContain("3 Thawmonth");
    // The struck entry is there, marked, with the way to take its strike back; the standing one can be struck.
    const struck = entry(tree, "mind-2");
    expect(struck?.props["data-struck"]).toBe("true");
    expect(textOf(struck?.props.children)).toContain("Tired of the reeve.");
    expect(textOf(struck?.props.children)).toContain("Take back the strike");
    expect(textOf(entry(tree, "mind-1")?.props.children)).toContain("Strike");
    // Words that look like markup are the text they are.
    expect(text).toContain(MARKUP);
    expect(elements(tree).some((e) => e.type === "b")).toBe(false);
    const files = section(tree, "files");
    expect(files).toContain("Mind files the migration carried (2)");
    expect(files).toContain("core.md");
    expect(files).toContain("not filed yet");
    expect(elements(entry(tree, "file-1")?.props.children).find((e) => e.type === "pre")?.props.children).toBe(CARRIED_FILE);
    expect(textOf(entry(tree, "file-1")?.props.children)).toContain("filed");
    expect(section(tree, "perceptions")).toContain("Of turn turn-6, message 10");
    expect(section(tree, "castings")).toContain("turn turn-2, message 3 · by migration · carried by the migration");
    expect(section(tree, "sources")).toContain("Odile Holt");
    expect(elements(tree).some((e) => e.type === "input" && e.props.value === "her looks and her trade")).toBe(true);
  });

  test("Strike sends the entry and which; what the cast did comes back in its own terms, and a refusal in RPE's words", () => {
    const opened = view({ list: CAST, open: ODILE.id, character: ODILE_RECORD }, true);
    press(entry(opened.tree, "mind-1"), "Strike");
    press(entry(opened.tree, "mind-2"), "Take back the strike");
    expect(opened.pressed).toEqual([
      { id: "mind-1", struck: true },
      { id: "mind-2", struck: false },
    ]);
    const answer: CastStrikeReply = { changed: true, entry: ODILE_RECORD.perceptions.items[0] as CastStrikeReply["entry"], alsoStruck: ["know-1"], letGo: ["fact-toll"], alsoStood: [], heldAgain: [], notes: ["No one else holds it."] };
    expect(banners(view({ open: ODILE.id, character: ODILE_RECORD, struck: { ask: { id: "perc-1", struck: true }, answer } }, true).tree)).toEqual([
      { title: "Struck", text: "StruckStruck with it, the knowledge it gave: know-1.Secrets it no longer holds: fact-toll.No one else holds it." },
    ]);
    // Its strike taken back: the knowledge it struck stands again, and the secrets it gives are held again.
    const back: CastStrikeReply = { ...answer, alsoStruck: [], letGo: [], alsoStood: ["know-1"], heldAgain: ["fact-toll"], notes: [] };
    expect(banners(view({ open: ODILE.id, character: ODILE_RECORD, struck: { ask: { id: "perc-1", struck: false }, answer: back } }, true).tree)).toEqual([
      { title: "Its strike was taken back", text: "Its strike was taken backStanding again with it, the knowledge its strike struck: know-1.Secrets it holds again: fact-toll." },
    ]);
    expect(banners(view({ open: ODILE.id, character: ODILE_RECORD, struck: { ask: { id: "perc-1", struck: false }, answer: { ...back, changed: false, alsoStood: [], heldAgain: [] } } }, true).tree)[0]?.title).toBe("Nothing changed: it already stood so");
    expect(banners(view({ open: ODILE.id, character: ODILE_RECORD, strikeProblem: "A turn of this chat is running; strike it once it ends." }, true).tree)).toEqual([
      { title: "Not done", text: "Not doneA turn of this chat is running; strike it once it ends." },
    ]);
  });

  test("with the spoiler gate shut the cast shows names and counts and nothing of a record: no casting line, no opened record, no strike's answer; Show them opens it", () => {
    const list = view({ list: CAST });
    expect(list.text).toContain("Odile Holt");
    expect(list.text).toContain("Tobin Reede");
    expect(list.text).not.toContain("Runs the ferry, owes nobody.");
    expect(list.text).toContain("hold its secrets and what the Author has in mind for it");
    press(list.tree, "Show them for this chat");
    expect(list.pressed).toEqual(["open gate"]);

    const answer: CastStrikeReply = { changed: true, entry: ODILE_RECORD.perceptions.items[0] as CastStrikeReply["entry"], alsoStruck: ["know-1"], letGo: ["fact-toll"], alsoStood: [], heldAgain: [], notes: [] };
    const opened = view({ list: CAST, open: ODILE.id, character: ODILE_RECORD, struck: { ask: { id: "perc-1", struck: true }, answer } });
    expect(opened.text).toContain("Odile Holt");
    for (const id of ["base", "castings", "memories", "mind", "knowledge", "relationships", "perceptions", "files", "sources"]) expect(section(opened.tree, id)).toBe("");
    expect(opened.text).not.toContain("Tired of the reeve.");
    expect(opened.text).not.toContain(CARRIED_FILE);
    expect(opened.text).not.toContain("fact-toll");
    expect(banners(opened.tree).map((b) => b.title)).toEqual(["Spoilers are hidden"]);
    // Open, what it shows is what it showed, and the gate can be shut again.
    const shown = view({ list: CAST, open: ODILE.id, character: ODILE_RECORD, struck: { ask: { id: "perc-1", struck: true }, answer } }, true);
    expect(shown.text).toContain("Tired of the reeve.");
    expect(shown.text).toContain("Secrets it no longer holds: fact-toll.");
    press(shown.tree, "Hide them");
    expect(shown.pressed).toEqual(["close gate"]);
  });

  test("it reads the cast, then the character opened; a strike posts to the route and reads both again; a refusal is kept apart; what comes back once the page has left is let go", async () => {
    const { client, asked } = askingClient();
    const shown: CastShown[] = [];
    const reader = readCast(client, CHAT, (s) => shown.push(s));
    expect(asked.map((a) => a.key)).toEqual(["GET /api/v1/chats/:chat/cast"]);
    asked[0]?.answer(CAST);
    await settle();
    reader.open(ODILE.id);
    expect(asked[1]).toMatchObject({ key: "GET /api/v1/chats/:chat/cast/:character", params: { chat: CHAT, character: ODILE.id } });
    asked[1]?.answer(ODILE_RECORD);
    await settle();
    expect(shown.at(-1)).toMatchObject({ list: CAST, open: ODILE.id, character: ODILE_RECORD });

    reader.strike({ id: "perc-1", struck: true });
    expect(shown.at(-1)?.striking).toBe("perc-1");
    // The character's open also asked who was on stage in the latest turns, for a perception to be written.
    expect(asked[2]).toMatchObject({ key: "GET /api/v1/chats/:chat/perceptions", query: { count: 12 } });
    expect(asked[3]).toMatchObject({ key: "POST /api/v1/chats/:chat/cast/:character/strike", params: { chat: CHAT, character: ODILE.id }, body: { id: "perc-1", struck: true } });
    const answer: CastStrikeReply = { changed: true, entry: { ...(ODILE_RECORD.perceptions.items[0] as CastStrikeReply["entry"]), struck: true }, alsoStruck: ["know-1"], letGo: [], alsoStood: [], heldAgain: [], notes: [] };
    asked[3]?.answer(answer);
    await settle();
    expect(shown.at(-1)).toMatchObject({ striking: null, struck: { ask: { id: "perc-1", struck: true }, answer } });
    expect(asked.slice(4).map((a) => a.key)).toEqual(["GET /api/v1/chats/:chat/cast", "GET /api/v1/chats/:chat/cast/:character"]);

    reader.strike({ id: "mind-1", struck: true });
    asked[6]?.fail(new Error("A turn of this chat is running; strike it once it ends."));
    await settle();
    expect(shown.at(-1)).toMatchObject({ striking: null, strikeProblem: "A turn of this chat is running; strike it once it ends." });

    const count = shown.length;
    reader.stop();
    asked[4]?.answer(CAST);
    await settle();
    expect(shown.length).toBe(count);
  });

  test("a character's record that comes back after another was opened is let go", async () => {
    const { client, asked } = askingClient();
    const shown: CastShown[] = [];
    const reader = readCast(client, CHAT, (s) => shown.push(s));
    reader.open(ODILE.id);
    reader.open("char-tobin");
    asked[1]?.answer(ODILE_RECORD);
    await settle();
    expect(shown.at(-1)).toMatchObject({ open: "char-tobin", character: null });
  });

  test("the base shows the growth laid over it, each source its title and how it stands against the base, an away principal where it is and what it means to do, its game side, its castings in words, its memories by tier and its mind by kind", () => {
    const { tree, text } = view({ list: CAST, open: ODILE.id, character: RICH }, true);
    expect(section(tree, "base")).toContain("Growth laid over it");
    expect(section(tree, "base")).toContain("Distrusts the reeve.");
    expect(section(tree, "base")).toContain("because The toll.");
    const sources = elements(tree).filter((e) => typeof e.props["data-source"] === "string");
    expect(sources.map((s) => [s.props["data-source"], s.props["data-state"]])).toEqual([
      ["card:card-odile", "changed"],
      ["entry:e-9", "gone"],
    ]);
    expect(section(tree, "sources")).toContain("changed since the base was drawn");
    expect(section(tree, "sources")).toContain("gone from Lumiverse");
    expect(section(tree, "away")).toContain("At the toll house.");
    expect(section(tree, "away")).toContain("Wait for the reeve to leave.");
    expect(section(tree, "game")).toContain("The Ferry › Thornbury");
    expect(section(tree, "game")).toContain("a ferry pole");
    expect(section(tree, "who")).toContain("principal, pinned by you, “Runs the ferry.”, because She was asked to.");
    expect(elements(tree).some((e) => e.props["data-tier"] === "top")).toBe(true);
    expect(elements(tree).some((e) => e.props["data-kind"] === "want")).toBe(true);
    // A faint memory is shown as its gist.
    expect(text).toContain("The rope.");
  });

  test("a list the record holds more of is read further back a page at a time", () => {
    const { tree, pressed } = view({ list: CAST, open: ODILE.id, character: RICH, skips: { memories: 20 } }, true);
    expect(section(tree, "memories")).toContain("40 entries of the 60 the record holds are not shown here.");
    press(tree, "Earlier ones");
    press(tree, "Later ones");
    expect(pressed).toEqual([
      ["more", "memories", 40],
      ["more", "memories", 0],
    ]);
  });

  test("setting a casting, redrawing the base, binding a source, naming the person and writing a perception each send their edit with what is typed", () => {
    const stage: PerceptionRecordReply = { chat: CHAT, turns: [{ turn: "turn-9", message: 12, read: "scene", people: [{ name: "Odile Holt", character: ODILE.id, casting: "principal", perceptions: [] }] }] };
    const drafts = { "casting.as": "extra", "casting.pin": true, "base.part": "soul", "base.text.soul": "Wants the crossing quiet.", "source.kind": "entry", "source.ref": "e-1", "source.defines": "her voice", person: "Tam", "perception.turn-9": "She saw him pay in copper." };
    const { tree, pressed } = view({ list: CAST, open: ODILE.id, character: RICH, stage, drafts }, true);
    for (const words of ["Set casting", "Save as the next version", "Bind it", "Say who", "Write it"]) press(tree, words);
    expect(pressed).toEqual([
      { what: "casting", body: { as: "extra", pin: true, line: "Runs the ferry, owes nobody." } },
      { what: "base", body: { soul: "Wants the crossing quiet." } },
      { what: "sources", body: { kind: "entry", ref: "e-1", defines: "her voice" } },
      { what: "person", body: { person: "Tam" } },
      { what: "perception", body: { turn: "turn-9", content: "She saw him pay in copper." } },
    ]);
    // The turn it has no perception of is listed, and the character can be seen as it stood then.
    expect(section(tree, "perceptions")).toContain("Message 12");
    press(tree, "See it as it stood then");
    expect(pressed.at(-1)).toEqual(["open", ODILE.id, "turn-9"]);
  });

  test("a turn joined to another is shown at the turn it joined, and said so, with the way back to the newest", () => {
    const { tree, text, pressed } = view({ list: CAST, open: ODILE.id, character: RICH, at: "turn-9", joined: { turn: "turn-8", joined: "turn-9" } }, true);
    expect(text).toContain("Turn turn-8 was joined to turn turn-9, so the record is shown at turn turn-9.");
    press(tree, "Back to the newest");
    expect(pressed).toEqual(["newest"]);
  });

  test("an edit posts to its route and reads the record again, and what comes of it is said; a turn asked for that was joined is read as the turn it joined; a list read further back stays there", async () => {
    const { client, asked } = askingClient();
    const shown: CastShown[] = [];
    const reader = readCast(client, CHAT, (s) => shown.push(s));
    asked[0]?.answer(CAST);
    await settle();
    reader.open(ODILE.id, "turn-8");
    expect(asked[1]).toMatchObject({ key: "GET /api/v1/chats/:chat/cast/:character", query: { turn: "turn-8" } });
    asked[1]?.answer({ joined: { turn: "turn-8", joined: "turn-9" } });
    await settle();
    expect(shown.at(-1)).toMatchObject({ at: "turn-9", joined: { turn: "turn-8", joined: "turn-9" } });
    expect(asked[3]).toMatchObject({ key: "GET /api/v1/chats/:chat/cast/:character", query: { turn: "turn-9" } });
    asked[3]?.answer(RICH);
    await settle();
    expect(shown.at(-1)?.character).toEqual(RICH);

    reader.more("memories", 20);
    expect(asked[4]).toMatchObject({ key: "GET /api/v1/chats/:chat/cast/:character", query: { turn: "turn-9", part: "memories", skip: 20 } });
    asked[4]?.answer({ ...RICH, memories: { ...RICH.memories, before: 20, after: 20 } });
    await settle();
    expect(shown.at(-1)?.character?.memories).toMatchObject({ before: 20, after: 20 });

    reader.draft("person", "Tam");
    expect(shown.at(-1)?.drafts).toEqual({ person: "Tam" });
    reader.edit({ what: "person", body: { person: "Tam" } });
    expect(shown.at(-1)?.editing).toBe("person");
    expect(asked[5]).toMatchObject({ key: "POST /api/v1/chats/:chat/cast/:character/person", params: { chat: CHAT, character: ODILE.id }, body: { person: "Tam" } });
    asked[5]?.answer({ changed: true, character: ODILE, notes: [] });
    await settle();
    expect(shown.at(-1)).toMatchObject({ editing: null, edited: { edit: "person", changed: true, notes: [] }, drafts: {} });
    // The cast, the character (still at turn-9 and still read further back) and who was on stage, read again.
    expect(asked.slice(6).map((a) => a.key)).toEqual(["GET /api/v1/chats/:chat/cast", "GET /api/v1/chats/:chat/cast/:character", "GET /api/v1/chats/:chat/perceptions"]);

    reader.edit({ what: "casting", body: { as: "extra", pin: false } });
    asked[9]?.fail(new Error("Odile has no casting to pin."));
    await settle();
    expect(shown.at(-1)).toMatchObject({ editing: null, editProblem: "Odile has no casting to pin." });
  });

  test("Cast is a chat's page in both shells, behind More on a narrow bar, with its own address", () => {
    const cast = PAGES.find((n) => n.id === "cast");
    expect(cast).toMatchObject({ shells: ["web", "drawer"], needsChat: true, often: false });
    expect(routeOfHash(hashOf({ page: "cast", chat: CHAT }))).toEqual({ page: "cast", chat: CHAT });
  });
});

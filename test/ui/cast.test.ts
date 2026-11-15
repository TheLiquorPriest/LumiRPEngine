// The Cast page, read from its view as drawn and from its reads: every character with its casting and
// counts; one opened shows its whole record, struck entries marked struck, memories with their tier,
// strength and fading, and the mind files a migration carried word for word with whether each is
// filed; the record, the Author's casting lines and what a strike let go stay behind the spoiler gate
// until it is opened; a strike posts to the route, shows what the cast did, and reads the record again;
// a refusal is shown in RPE's words. And the page has its place in both shells and in the web address.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { CastStruck } from "../../src/ui/api";
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
      onOpen: (id) => pressed.push(["open", id]),
      onClose: () => pressed.push("close"),
      onStrike: (ask) => pressed.push(ask),
    }),
  );
  return { tree, text: textOf(tree), pressed };
}

const section = (tree: unknown, id: string): string => textOf(elements(tree).find((e) => e.props["data-section"] === id)?.props.children);
const entry = (tree: unknown, id: string) => elements(tree).find((e) => e.props["data-entry"] === id);

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
    expect(section(tree, "sources")).toContain("her looks and her trade");
  });

  test("Strike sends the entry and which; what the cast did comes back in its own terms, and a refusal in RPE's words", () => {
    const opened = view({ list: CAST, open: ODILE.id, character: ODILE_RECORD }, true);
    press(entry(opened.tree, "mind-1"), "Strike");
    press(entry(opened.tree, "mind-2"), "Take back the strike");
    expect(opened.pressed).toEqual([
      { id: "mind-1", struck: true },
      { id: "mind-2", struck: false },
    ]);
    const answer: CastStruck = { changed: true, entry: ODILE_RECORD.perceptions[0] as CastStruck["entry"], alsoStruck: ["know-1"], letGo: ["fact-toll"], alsoStood: [], heldAgain: [], notes: ["No one else holds it."] };
    expect(banners(view({ open: ODILE.id, character: ODILE_RECORD, struck: { ask: { id: "perc-1", struck: true }, answer } }, true).tree)).toEqual([
      { title: "Struck", text: "StruckStruck with it, the knowledge it gave: know-1.Secrets it no longer holds: fact-toll.No one else holds it." },
    ]);
    // Its strike taken back: the knowledge it struck stands again, and the secrets it gives are held again.
    const back: CastStruck = { ...answer, alsoStruck: [], letGo: [], alsoStood: ["know-1"], heldAgain: ["fact-toll"], notes: [] };
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

    const answer: CastStruck = { changed: true, entry: ODILE_RECORD.perceptions[0] as CastStruck["entry"], alsoStruck: ["know-1"], letGo: ["fact-toll"], alsoStood: [], heldAgain: [], notes: [] };
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
    expect(asked[2]).toMatchObject({ key: "POST /api/v1/chats/:chat/cast/:character/strike", params: { chat: CHAT, character: ODILE.id }, body: { id: "perc-1", struck: true } });
    const answer: CastStruck = { changed: true, entry: { ...(ODILE_RECORD.perceptions[0] as CastStruck["entry"]), struck: true }, alsoStruck: ["know-1"], letGo: [], alsoStood: [], heldAgain: [], notes: [] };
    asked[2]?.answer(answer);
    await settle();
    expect(shown.at(-1)).toMatchObject({ striking: null, struck: { ask: { id: "perc-1", struck: true }, answer } });
    expect(asked.slice(3).map((a) => a.key)).toEqual(["GET /api/v1/chats/:chat/cast", "GET /api/v1/chats/:chat/cast/:character"]);

    reader.strike({ id: "mind-1", struck: true });
    asked[5]?.fail(new Error("A turn of this chat is running; strike it once it ends."));
    await settle();
    expect(shown.at(-1)).toMatchObject({ striking: null, strikeProblem: "A turn of this chat is running; strike it once it ends." });

    const count = shown.length;
    reader.stop();
    asked[3]?.answer(CAST);
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

  test("Cast is a chat's page in both shells, behind More on a narrow bar, with its own address", () => {
    const cast = PAGES.find((n) => n.id === "cast");
    expect(cast).toMatchObject({ shells: ["web", "drawer"], needsChat: true, often: false });
    expect(routeOfHash(hashOf({ page: "cast", chat: CHAT }))).toEqual({ page: "cast", chat: CHAT });
  });
});

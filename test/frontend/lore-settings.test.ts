// Settings → Lore (DESIGN §4.2): which World Info books LumiRPEngine reads (Auto, every book a chat
// reads, or the books ticked, with Default back to Auto) and the lore index's settings: the tag
// pattern and id prefix sent only once they can be what they set, the numbers and the prompts switch,
// the user's own index entry picked by book then entry (Clear takes it off), and the built entry's
// Stop. What the page sends lands in the real settings store and reads back; Reset reads back every
// index default but the built entry, which only Stop lets go; and Settings home's line for the page.

import { describe, expect, test } from "bun:test";
import { Button, HostSelect, HostSwitch, NumberStepper, Seg } from "../../src/frontend/components";
import { CheckField } from "../../src/frontend/build/form-kit";
import { type LoreSettingsProps, LoreSettingsBody, type LoreTextField, loreIndexResetPatch, loreSummary } from "../../src/frontend/settings/lore";
import type { JsonObject } from "../../src/shared/json";
import type { LoreBookEntryView, LoreBookView } from "../../src/shared/protocol";
import { LORE_INDEX_BOUNDS, LORE_INDEX_DEFAULTS, type LoreBooks, type LoreIndexSettings } from "../../src/shared/settings";
import { Rig } from "../support/rig";
import { labelled, press, propsOf, type Props } from "../support/tree";

const BOOKS: LoreBookView[] = [
  { id: "book_harbor", name: "Harbor notes", attached: true, character: false, added: null },
  { id: "book_town", name: "Town lore", attached: false, character: false, added: null },
];
const ENTRIES: LoreBookEntryView[] = [
  { id: "e_index", title: "LORE INDEX", disabled: false, chars: 120 },
  { id: "e_ferry", title: "Ferry", disabled: false, chars: 60 },
];

const BOOKS_SEG = "Which World Info books LumiRPEngine reads";
const BOOKS_DEFAULT = "Reset the books LumiRPEngine reads to its default, every book a chat reads";
const RESET = "Reset the lore index settings to their defaults";

let sent: JsonObject | null = null;
let picked: string | null = null;
let typed: Record<LoreTextField, string | null> = { tagPattern: null, idPrefix: null };

/** The page for these settings, with the user's books loaded and `ownBook`'s entries; what its controls send waits for `take`. */
function page(loreBooks: LoreBooks, loreIndex: LoreIndexSettings, over: Partial<LoreSettingsProps> = {}): unknown {
  return LoreSettingsBody({
    loreBooks,
    loreIndex,
    books: BOOKS,
    ownBook: loreIndex.own?.bookId ?? "",
    ownEntries: loreIndex.own ? ENTRIES : null,
    pickOwnBook: (id) => void (picked = id),
    typed,
    type: (field, value) => void (typed = { ...typed, [field]: value }),
    patch: (p) => void (sent = p),
    busy: false,
    ...over,
  });
}

/** The patch the last control pressed sent. */
function take(): JsonObject {
  const patch = sent;
  sent = null;
  if (!patch) throw new Error("nothing sent");
  return patch;
}

function click(button: Props): void {
  const onClick = button.onClick;
  if (typeof onClick !== "function") throw new Error("not a button");
  onClick();
}

/** A text field's input, by its label. */
function input(tree: unknown, label: string): Props {
  const found = propsOf(tree, "input").filter((p) => p["aria-label"] === label);
  if (found.length !== 1) throw new Error(`${found.length} inputs labelled ${label}`);
  return found[0] ?? {};
}

function typeInto(field: Props, value: string, event: "onInput" | "onChange"): void {
  const handler = field[event];
  if (typeof handler !== "function") throw new Error(`no ${event}`);
  handler({ currentTarget: { value } });
}

const checked = (tree: unknown): unknown[] => propsOf(tree, CheckField).map((p) => [p.label, p.checked]);
const labels = (tree: unknown): unknown[] => propsOf(tree, Button).map((p) => p.label);
const DEFAULTS: LoreIndexSettings = { ...LORE_INDEX_DEFAULTS };

describe("Settings → Lore patches", () => {
  test("books: Auto lists none; the books I tick starts with every book ticked, each tick sends the list, and Default goes back to Auto", () => {
    const auto = page("auto", DEFAULTS);
    expect(labelled(auto, Seg, BOOKS_SEG).value).toBe("auto");
    expect(propsOf(auto, CheckField)).toEqual([]);
    expect(labels(auto)).not.toContain(BOOKS_DEFAULT);
    press(labelled(auto, Seg, BOOKS_SEG), "list");
    expect(take()).toEqual({ loreBooks: ["book_harbor", "book_town"] });

    const one = page(["book_harbor"], DEFAULTS);
    expect(labelled(one, Seg, BOOKS_SEG).value).toBe("list");
    expect(checked(one)).toEqual([
      ["Harbor notes (in this chat)", true],
      ["Town lore", false],
    ]);
    press(propsOf(one, CheckField)[1] ?? {}, true);
    expect(take()).toEqual({ loreBooks: ["book_harbor", "book_town"] });
    press(propsOf(one, CheckField)[0] ?? {}, false);
    expect(take()).toEqual({ loreBooks: [] });
    click(labelled(one, Button, BOOKS_DEFAULT));
    expect(take()).toEqual({ loreBooks: null });
    press(labelled(one, Seg, BOOKS_SEG), "auto");
    expect(take()).toEqual({ loreBooks: null });

    // A listed book that is no longer one shows ticked, so it can be unticked.
    const gone = page(["book_gone"], DEFAULTS);
    expect(checked(gone)).toEqual([
      ["Harbor notes (in this chat)", false],
      ["Town lore", false],
      ["book_gone (no longer one of your books)", true],
    ]);
    press(propsOf(gone, CheckField)[2] ?? {}, false);
    expect(take()).toEqual({ loreBooks: [] });
  });

  test("the tag pattern and id prefix send only a value they can be, and say what is wrong with one they can't", () => {
    const tag = input(page("auto", DEFAULTS), "Tag pattern");
    expect(tag.value).toBe(LORE_INDEX_DEFAULTS.tagPattern);
    typeInto(tag, "^lr(\\d{4}$", "onInput");
    const bad = page("auto", DEFAULTS);
    expect(input(bad, "Tag pattern")["aria-invalid"]).toBe(true);
    expect(propsOf(bad, "span").some((p) => p.role === "alert" && String(p.children).includes("isn't a regular expression"))).toBe(true);
    typeInto(input(bad, "Tag pattern"), "^lr(\\d{4}$", "onChange");
    expect(sent).toBeNull();
    typeInto(input(bad, "Tag pattern"), "^tag-\\d+$", "onChange");
    expect(take()).toEqual({ loreIndex: { tagPattern: "^tag-\\d+$" } });
    expect(typed.tagPattern).toBeNull();

    const prefix = input(page("auto", DEFAULTS), "Id prefix");
    typeInto(prefix, "no/slash", "onChange");
    expect(sent).toBeNull();
    typeInto(prefix, "x".repeat(LORE_INDEX_BOUNDS.idPrefix + 1), "onChange");
    expect(sent).toBeNull();
    typeInto(prefix, "lore", "onChange");
    expect(take()).toEqual({ loreIndex: { idPrefix: "lore" } });
    // The value it has sends nothing.
    typeInto(prefix, LORE_INDEX_DEFAULTS.idPrefix, "onChange");
    expect(sent).toBeNull();
  });

  test("the numbers and the prompts switch send themselves; the index tokens show only with the switch on", () => {
    const plain = page("auto", DEFAULTS);
    press(labelled(plain, NumberStepper, "Id digits"), 6);
    expect(take()).toEqual({ loreIndex: { idDigits: 6 } });
    press(labelled(plain, NumberStepper, "Holds line (characters)"), 0);
    expect(take()).toEqual({ loreIndex: { holdsChars: 0 } });
    expect(propsOf(plain, NumberStepper).map((p) => p.label)).not.toContain("Index tokens");
    press(labelled(plain, HostSwitch, "Every role's prompt carries the lore index"), true);
    expect(take()).toEqual({ loreIndex: { inPrompts: true } });
    const on = page("auto", { ...DEFAULTS, inPrompts: true });
    const tokens = labelled(on, NumberStepper, "Index tokens");
    expect([tokens.value, tokens.min, tokens.max]).toEqual([LORE_INDEX_DEFAULTS.promptTokens, ...LORE_INDEX_BOUNDS.promptTokens]);
    press(tokens, 800);
    expect(take()).toEqual({ loreIndex: { promptTokens: 800 } });
  });

  test("the own index entry is picked by book, then entry; Clear takes it off", () => {
    picked = null;
    const none = page("auto", DEFAULTS);
    const book = labelled(none, HostSelect, "Book of your index entry");
    expect(book.options).toEqual([
      { value: "book_harbor", label: "Harbor notes (in this chat)" },
      { value: "book_town", label: "Town lore" },
    ]);
    expect(propsOf(none, HostSelect).map((p) => p.label)).toEqual(["Book of your index entry"]);
    press(book, "book_town");
    expect<string | null>(picked).toBe("book_town");
    expect(sent).toBeNull();

    const listing = page("auto", DEFAULTS, { ownBook: "book_town", ownEntries: ENTRIES });
    const entry = labelled(listing, HostSelect, "Your index entry");
    expect(entry.options).toEqual(ENTRIES.map((e) => ({ value: e.id, label: e.title })));
    press(entry, "e_index");
    expect(take()).toEqual({ loreIndex: { own: { bookId: "book_town", entryId: "e_index" } } });

    const set = page("auto", { ...DEFAULTS, own: { bookId: "book_town", entryId: "e_index" } });
    expect(labelled(set, HostSelect, "Your index entry").value).toBe("e_index");
    click(labelled(set, Button, "Clear your own index entry"));
    expect(take()).toEqual({ loreIndex: { own: null } });
  });

  test("the built entry shows where it is with Stop; with none, the page says where Build makes one", () => {
    expect(labels(page("auto", DEFAULTS))).not.toContain("Stop keeping the index entry in sync");
    const built = page("auto", { ...DEFAULTS, built: { bookId: "book_town", entryId: "e_built", worldId: "alder" } });
    click(labelled(built, Button, "Stop keeping the index entry in sync"));
    expect(take()).toEqual({ loreIndex: { built: null } });
  });

  test("Reset shows only while an index setting differs from its default, and sends every one null but the built entry", () => {
    expect(labels(page("auto", DEFAULTS))).not.toContain(RESET);
    // The built entry alone isn't something Reset covers.
    expect(labels(page("auto", { ...DEFAULTS, built: { bookId: "b", entryId: "e", worldId: "w" } }))).not.toContain(RESET);
    click(labelled(page("auto", { ...DEFAULTS, holdsChars: 0 }), Button, RESET));
    const reset = take();
    expect(reset).toEqual(loreIndexResetPatch());
    expect(reset).toEqual({ loreIndex: { tagPattern: null, idPrefix: null, idDigits: null, holdsChars: null, inPrompts: null, promptTokens: null, own: null } });
  });
});

describe("Settings → Lore in the settings store", () => {
  test("what the page sends reads back; Reset and Default read back the defaults, and the built entry stays until Stop", async () => {
    const rig = new Rig();
    const read = async () => {
      const s = await rig.rt.settings.get(rig.host.userId);
      return { books: s.loreBooks, index: s.loreIndex };
    };
    const save = async (patch: JsonObject) => {
      rig.body(await rig.send({ type: "lre.settings.set", patch }));
      return read();
    };
    let now = await read();
    expect(now).toEqual({ books: "auto", index: DEFAULTS });

    press(labelled(page(now.books, now.index), Seg, BOOKS_SEG), "list");
    now = await save(take());
    expect(now.books).toEqual(["book_harbor", "book_town"]);
    press(propsOf(page(now.books, now.index), CheckField)[0] ?? {}, false);
    now = await save(take());
    expect(now.books).toEqual(["book_town"]);

    typeInto(input(page(now.books, now.index), "Tag pattern"), "^tag-\\d+$", "onChange");
    now = await save(take());
    typeInto(input(page(now.books, now.index), "Id prefix"), "lore", "onChange");
    now = await save(take());
    press(labelled(page(now.books, now.index), NumberStepper, "Id digits"), 6);
    now = await save(take());
    press(labelled(page(now.books, now.index), NumberStepper, "Holds line (characters)"), 0);
    now = await save(take());
    press(labelled(page(now.books, now.index), HostSwitch, "Every role's prompt carries the lore index"), true);
    now = await save(take());
    press(labelled(page(now.books, now.index), NumberStepper, "Index tokens"), 800);
    now = await save(take());
    press(labelled(page(now.books, now.index, { ownBook: "book_town", ownEntries: ENTRIES }), HostSelect, "Your index entry"), "e_index");
    now = await save(take());
    // Build → Lore's press sets the built entry; the page only stops it.
    now = await save({ loreIndex: { built: { bookId: "book_town", entryId: "e_built", worldId: "alder" } } });
    expect(now.index).toEqual({ tagPattern: "^tag-\\d+$", idPrefix: "lore", idDigits: 6, holdsChars: 0, inPrompts: true, promptTokens: 800, own: { bookId: "book_town", entryId: "e_index" }, built: { bookId: "book_town", entryId: "e_built", worldId: "alder" } });
    // The page shows what was saved.
    const shown = page(now.books, now.index);
    expect([input(shown, "Tag pattern").value, input(shown, "Id prefix").value, labelled(shown, NumberStepper, "Id digits").value, labelled(shown, HostSwitch, "Every role's prompt carries the lore index").checked]).toEqual(["^tag-\\d+$", "lore", 6, true]);

    click(labelled(page(now.books, now.index), Button, RESET));
    now = await save(take());
    expect(now.index).toEqual({ ...DEFAULTS, built: { bookId: "book_town", entryId: "e_built", worldId: "alder" } });
    click(labelled(page(now.books, now.index), Button, "Stop keeping the index entry in sync"));
    now = await save(take());
    click(labelled(page(now.books, now.index), Button, BOOKS_DEFAULT));
    now = await save(take());
    expect(now).toEqual({ books: "auto", index: DEFAULTS });
    expect(labels(page(now.books, now.index))).toEqual([]);
  });
});

describe("Settings home's line for the Lore page", () => {
  test("says which books, and what of the index is on", () => {
    expect(loreSummary("auto", DEFAULTS)).toBe("Every book a chat reads");
    expect(loreSummary(["a"], { ...DEFAULTS, inPrompts: true })).toBe("1 book ticked · index in every role's prompt");
    expect(loreSummary(["a", "b"], { ...DEFAULTS, inPrompts: true, own: { bookId: "a", entryId: "e" }, built: { bookId: "a", entryId: "i", worldId: "w" } })).toBe("2 books ticked · your own index entry · an index entry kept in sync");
  });
});

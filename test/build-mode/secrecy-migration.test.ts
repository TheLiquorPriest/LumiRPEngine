// Moving a World Info book from LumiRPEngine's old secrecy to secret marks (DESIGN §4.2; PlanChatUI-B3 item 5), on the user's go, as Build's secrecy
// page does it, over his books as the door gives them and the lore's one recorded writer: a preview that writes nothing; Apply, which writes each
// secret's mark and each twin as the same mark and leaves the entries LRE switched off still off; Confirm, which only then takes the old fields off;
// and Restore secrecy as it was, which puts the book back byte for byte.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { LEDGER_NAMESPACE as NS } from "../../src/shared/ledger";
import { parseSecretMarks } from "../../src/shared/secret-marks";
import { writeCarriedSecrecy } from "../../src/build/lore/carried";
import { SecrecyError } from "../../src/build/lore/secrecy";
import { FakeBooks, loreOn } from "./books-bed";
import { makeBed, USER } from "./bed";

const DEBT = "Marcus owes the bank four thousand dollars on the shop, and Danny knows it.";
const GATE = "stage.shop_debt == 'out'";
const CODE = "Jordan Ellis wrote the safe's code on the board: {{getvar::code}}.";
const debtFields = { secret: true, gate: GATE, holders: ["marcus", "danny"], audience: ["judge"] };

/** A book as LRE's old secrecy left it: a secret stored off; its twin LRE kept off, which was on before; an entry with old fields that keep nothing secret; a secret whose text can't be a mark; and an entry of the user's own and one the engine wrote, which the move leaves alone. */
function oldBook(books: FakeBooks) {
  const book = books.add("Port Alder notes");
  const debt = books.put(book, { comment: "The shop debt", content: `${DEBT}\n`, disabled: true, extensions: { other_extension: { kept: true }, [NS]: { lore: debtFields } } });
  const code = books.put(book, { comment: "The safe's code", content: CODE, disabled: true, extensions: { [NS]: { lore: { secret: true, gate: GATE } } } });
  const copy = books.put(book, { comment: "The shop debt (card copy)", content: DEBT, disabled: true, extensions: { [NS]: { lore: debtFields, secretCopyOf: { entry: `${book}/${debt}`, off: false, fields: null } } } });
  const harbor = books.put(book, { comment: "The harbor", content: "Boats tie up at the north pier.", extensions: { [NS]: { lore: { secret: false, gate: GATE, links: ["harbor"], aliases: ["the pier"] } } } });
  const plain = books.put(book, { comment: "Opening hours", content: "The shop opens at nine." });
  const engine = books.put(book, { comment: "Scene", content: "", disabled: true, extensions: { [NS]: { slot: "scene" } } });
  return { book, debt, code, copy, harbor, plain, engine };
}

const listed = (plan: { entries: { title: string }[] }) => Object.fromEntries(plan.entries.map((e) => [e.title, e]));

describe("moving a book's secrecy to marks", () => {
  test("the preview lists each secret with the mark it becomes, the twins and the entries LRE switched off, and writes nothing; the books list says where each move stands", async () => {
    const bed = makeBed();
    const books = new FakeBooks();
    const { book, debt } = oldBook(books);
    const { lore } = loreOn(bed, books);
    const before = books.stored(book);
    const plan = await lore.secrecy.preview(book, USER);
    expect(plan.state).toBe("legacy");
    const at = listed(plan) as Record<string, (typeof plan.entries)[number]>;
    expect(Object.keys(at).sort()).toEqual(["The harbor", "The safe's code", "The shop debt", "The shop debt (card copy)"]);
    const marks = parseSecretMarks(at["The shop debt"]?.mark ?? "");
    expect(marks.map((m) => [m.text, m.knownTo])).toEqual([[DEBT, ["marcus", "danny"]]]);
    expect([at["The shop debt"]?.kind, at["The shop debt"]?.gate, at["The shop debt"]?.audience]).toEqual(["mark", GATE, ["judge"]]);
    expect([at["The shop debt (card copy)"]?.kind, at["The shop debt (card copy)"]?.original]).toEqual(["twin", { bookId: book, entryId: debt }]);
    expect([at["The harbor"]?.kind, at["The harbor"]?.removes]).toEqual(["fields", ["secret", "gate"]]);
    expect(at["The safe's code"]?.kind).toBe("refused");
    expect(plan.entries.filter((e) => e.switchedOff).map((e) => e.title)).toEqual(["The shop debt"]);
    expect(books.stored(book)).toBe(before);
    expect((await lore.secrecy.books(USER)).map((b) => [b.name, b.state])).toEqual([["Port Alder notes", "legacy"]]);
  });

  test("Apply turns each secret and each twin into its mark with the old fields left on; a second Apply is refused; Confirm takes the old fields off; Restore puts the book back byte for byte, after Confirm too, and it can be moved again", async () => {
    const bed = makeBed();
    const books = new FakeBooks();
    const { book, debt, copy, harbor, plain, engine } = oldBook(books);
    const { lore } = loreOn(bed, books);
    const original = books.stored(book);
    const untouched = JSON.stringify([books.at(plain), books.at(engine)]);

    const applied = await lore.secrecy.apply(book, (await lore.secrecy.preview(book, USER)).version, USER);
    expect(applied.state).toBe("applied");
    expect(parseSecretMarks(books.at(debt).content).map((m) => [m.text, m.knownTo])).toEqual([[DEBT, ["marcus", "danny"]]]);
    expect(books.at(debt).disabled).toBe(true);
    expect(parseSecretMarks(books.at(copy).content).map((m) => m.text)).toEqual([DEBT]);
    expect(books.at(copy).disabled).toBe(false);
    // The old fields stay until Confirm.
    expect(books.at(debt).extensions[NS]).toEqual({ lore: debtFields });
    expect(JSON.stringify([books.at(plain), books.at(engine)])).toBe(untouched);
    await expect(lore.secrecy.apply(book, applied.version, USER)).rejects.toBeInstanceOf(SecrecyError);

    const confirmed = await lore.secrecy.confirm(book, applied.version, USER);
    expect(confirmed.state).toBe("confirmed");
    expect(books.at(debt).extensions[NS]).toBeUndefined();
    expect(books.at(debt).extensions.other_extension).toEqual({ kept: true });
    expect(books.at(harbor).extensions[NS]).toEqual({ lore: { links: ["harbor"], aliases: ["the pier"] } });

    const restored = await lore.secrecy.restore(book, confirmed.version, USER);
    expect(restored.state).toBe("legacy");
    expect(books.stored(book)).toBe(original);
    // Put back, it can be moved again.
    expect((await lore.secrecy.preview(book, USER)).entries.length).toBe(4);
    expect((await lore.secrecy.apply(book, (await lore.secrecy.preview(book, USER)).version, USER)).state).toBe("applied");
  });

  test("a book that changed in Lumiverse since the preview is a conflict, and an entry that changed while Apply ran is listed with its error and left as it stands", async () => {
    const bed = makeBed();
    const books = new FakeBooks();
    const { book, debt, harbor } = oldBook(books);
    const { lore } = loreOn(bed, books);
    const seen = await lore.secrecy.preview(book, USER);
    books.elsewhere(harbor, { keys: ["harbor", "pier"] });
    await expect(lore.secrecy.apply(book, seen.version, USER)).rejects.toMatchObject({ code: "conflict" });
    // Read afresh, a write refused for a revision that moved after the read is the entry's own error.
    const fresh = await lore.secrecy.preview(book, USER);
    const edit = books.edit.bind(books);
    books.edit = async (user, entry, fields, revision) => {
      if (entry === debt) books.elsewhere(debt, { keys: ["shop", "debt"] });
      return edit(user, entry, fields, revision);
    };
    const plan = await lore.secrecy.apply(book, fresh.version, USER);
    expect(plan.entries.find((e) => e.id === debt)?.error?.step).toBe("apply");
    expect(plan.entries.find((e) => e.id === debt)?.error?.message).toContain("changed in Lumiverse");
    expect(parseSecretMarks(books.at(debt).content)).toEqual([]);
  });

  test("a carried undo copy reads back as the move it was, and Restore puts the book back from it", async () => {
    const bed = makeBed();
    const books = new FakeBooks();
    const { book, debt } = oldBook(books);
    const { lore } = loreOn(bed, books);
    // The file of an earlier build as it kept a move: the debt's entry as it stood, and as the move left it.
    const parts = (content: string, disabled: boolean, extensions: JsonObject) => ({ content, keys: ["shop"], disabled, extensions });
    const stood = parts(`${DEBT}\n`, true, books.at(debt).extensions);
    const file = { v: 1, bookId: book, name: "Port Alder notes", moves: [{ applied: 1, confirmed: null, restored: null, restoring: false, entries: [{ id: debt, title: "The shop debt", kind: "mark", switchedOff: true, before: stood, after: parts("{{// Secret (known to marcus, danny): x}}", true, books.at(debt).extensions), applied: true, confirmed: false }] }] };
    await bed.writes.run((db) => writeCarriedSecrecy(db, USER, JSON.stringify(file)), "a carried undo copy");
    books.elsewhere(debt, { content: "{{// Secret (known to marcus, danny): x}}" });
    const plan = await lore.secrecy.preview(book, USER);
    expect(plan.state).toBe("applied");
    expect(plan.entries.map((e) => [e.id, e.now])).toEqual([[debt, "moved"]]);
    const back = await lore.secrecy.restore(book, plan.version, USER);
    expect(back.state).toBe("legacy");
    expect(books.at(debt).content).toBe(`${DEBT}\n`);
  });
});

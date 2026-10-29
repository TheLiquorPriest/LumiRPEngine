// Moving a World Info book from LumiRPEngine's old secrecy to secret marks (DESIGN §4.2), on the
// user's go, as Build's secrecy page does it: a preview that writes nothing; Apply, which writes each
// secret's mark, writes each twin as the same mark and switches it as its note says, and leaves the
// entries LRE switched off still off; Confirm, which only then takes the old fields off; and Restore
// secrecy as it was, which puts the book back byte for byte. The book is a fake host book in the
// backend rig.

import { describe, expect, test } from "bun:test";
import type { HostBookEntryInput, QuietRequest } from "../../src/backend/host";
import type { JsonObject } from "../../src/shared/json";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import type { SecrecyBookPlan, SecrecyBookView, SecrecyEntryView } from "../../src/shared/protocol";
import { parseSecretMarks } from "../../src/shared/secret-marks";
import { Rig } from "../support/rig";

const NS = LEDGER_NAMESPACE;
const DEBT = "Marcus owes the bank four thousand dollars on the shop, and Danny knows it.";
const GATE = "stage.shop_debt == 'out'";
const KEY = "Helen keeps the spare key to the shop under the mat.";
const CODE = "Jordan Ellis wrote the safe's code on the board: {{getvar::code}}.";
const SHIFT = "Priya runs the night shift. {{// Secret (known to priya): She sleeps in the back room.}}";
const INTERPRET = "You map a player's typed input";

const entry = (comment: string, content: string, over: Partial<HostBookEntryInput> = {}): HostBookEntryInput => ({ comment, content, keys: ["shop"], disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {}, ...over });

/** The fields LRE stored on a secret it kept: switched off, its gate, its holders and the helper it let read it early. */
const debtFields = { secret: true, gate: GATE, holders: ["marcus", "danny"], audience: ["judge"] };

/**
 * A book of the user's as LRE's old secrecy left it: a secret stored off; its twin LRE kept off, which
 * was on before; a twin that was off before, with fields of its own; an entry with old fields that keep
 * nothing secret; a secret whose text can't be a mark, and its twin; a secret the user switched back
 * on; a secret whose text holds a mark already; and an entry of the user's own and one the engine
 * wrote, which the move leaves alone.
 */
async function oldBook(rig: Rig): Promise<{ bookId: string; id: Record<string, string> }> {
  const user = rig.host.userId;
  const bookId = await rig.host.books.create("Port Alder notes", "", user);
  const add = (e: HostBookEntryInput): Promise<string> => rig.host.books.createEntry(bookId, e, user);
  const debt = await add(entry("The shop debt", `${DEBT}\n`, { disabled: true, extensions: { other_extension: { kept: true }, [NS]: { lore: debtFields } } }));
  const code = await add(entry("The safe's code", CODE, { disabled: true, extensions: { [NS]: { lore: { secret: true, gate: GATE } } } }));
  const id: Record<string, string> = {
    debt,
    code,
    copy: await add(entry("The shop debt (card copy)", DEBT, { disabled: true, extensions: { [NS]: { lore: debtFields, secretCopyOf: { entry: `${bookId}/${debt}`, off: false, fields: null } } } })),
    draft: await add(entry("Debt, an old draft", DEBT, { disabled: true, keys: ["draft"], extensions: { [NS]: { lore: debtFields, secretCopyOf: { entry: `${bookId}/${debt}`, off: true, fields: { links: ["harbor"], aliases: ["the loan"] } } } } })),
    codeCopy: await add(entry("The safe's code (card copy)", CODE, { disabled: true, extensions: { [NS]: { lore: { secret: true, gate: GATE }, secretCopyOf: { entry: `${bookId}/${code}`, off: false, fields: null } } } })),
    harbor: await add(entry("The harbor", "Boats tie up at the north pier.", { extensions: { [NS]: { lore: { secret: false, gate: GATE, links: ["harbor"], aliases: ["the pier"] } } } })),
    key: await add(entry("The spare key", KEY, { extensions: { [NS]: { lore: { secret: true, gate: GATE } } } })),
    shift: await add(entry("The night shift", SHIFT, { disabled: true, extensions: { [NS]: { lore: { secret: true, gate: GATE, holders: ["priya"] } } } })),
    plain: await add(entry("Opening hours", "The shop opens at nine.")),
    engine: await add(entry("Scene", "", { disabled: true, extensions: { [NS]: { slot: "scene" } } })),
  };
  return { bookId, id };
}

/** The book's entries as the host gives them back: what byte for byte means here. */
async function stored(rig: Rig, bookId: string): Promise<string> {
  return JSON.stringify(await rig.host.books.entries(bookId, rig.host.userId));
}

async function entryOf(rig: Rig, id: string) {
  const e = await rig.host.books.entry(id, rig.host.userId);
  if (!e) throw new Error(`no entry ${id}`);
  return e;
}

async function step(rig: Rig, request: Record<string, unknown>): Promise<SecrecyBookPlan> {
  const book = rig.body(await rig.send({ type: "lre.secrecy", ...request })).book as SecrecyBookPlan | undefined;
  if (!book) throw new Error("no book in the answer");
  return book;
}

const preview = (rig: Rig, bookId: string): Promise<SecrecyBookPlan> => step(rig, { op: "preview", bookId });
const take = (rig: Rig, op: "apply" | "confirm" | "restore", plan: SecrecyBookPlan): Promise<SecrecyBookPlan> => step(rig, { op, bookId: plan.bookId, version: plan.version });

function listed(plan: SecrecyBookPlan): Record<string, SecrecyEntryView> {
  return Object.fromEntries(plan.entries.map((e) => [e.title, e]));
}

/** LRE's namespace in an entry's extension data, or undefined when it has none. */
const lre = (extensions: JsonObject): unknown => extensions[NS];

describe("previewing a book's move", () => {
  test("it lists each secret with the mark it becomes, the twins with how they stood, and the entries LRE switched off, and writes nothing", async () => {
    const rig = new Rig();
    const { bookId, id } = await oldBook(rig);
    const before = await stored(rig, bookId);
    const plan = await preview(rig, bookId);
    expect(plan.state).toBe("legacy");
    const at = listed(plan);
    expect(Object.keys(at).sort()).toEqual(["Debt, an old draft", "The harbor", "The night shift", "The safe's code", "The safe's code (card copy)", "The shop debt", "The shop debt (card copy)", "The spare key"]);
    // The secret's whole text becomes one mark, known to its holders.
    const debt = at["The shop debt"];
    expect(debt?.kind).toBe("mark");
    const marks = parseSecretMarks(debt?.mark ?? "");
    expect(marks.length).toBe(1);
    expect([marks[0]?.start, marks[0]?.end, marks[0]?.text, marks[0]?.knownTo]).toEqual([0, (debt?.mark ?? "").length, DEBT, ["marcus", "danny"]]);
    // What a mark doesn't carry is said: its gate, and the helper that read it early.
    expect([debt?.gate, debt?.audience]).toEqual([GATE, ["judge"]]);
    // Each twin becomes the same mark as its secret, known to its holders, and goes back as its note says: one was on, one was off with fields of its own.
    const card = at["The shop debt (card copy)"];
    expect([card?.kind, card?.was, card?.original, parseSecretMarks(card?.mark ?? "").map((m) => [m.text, m.knownTo])]).toEqual(["twin", { off: false, fields: false }, { bookId, entryId: id.debt ?? "" }, [[DEBT, ["marcus", "danny"]]]]);
    expect([at["Debt, an old draft"]?.kind, at["Debt, an old draft"]?.was, parseSecretMarks(at["Debt, an old draft"]?.mark ?? "").map((m) => m.text)]).toEqual(["twin", { off: true, fields: true }, [DEBT]]);
    expect([at["The harbor"]?.kind, at["The harbor"]?.removes]).toEqual(["fields", ["secret", "gate"]]);
    expect(at["The safe's code"]?.kind).toBe("refused");
    expect((at["The safe's code"]?.reason ?? "").length).toBeGreaterThan(0);
    // So is a twin whose text can't be a mark: it keeps its old secrecy, off, listed with why beside its secret.
    const codeCopy = at["The safe's code (card copy)"];
    expect([codeCopy?.kind, codeCopy?.original, (codeCopy?.reason ?? "").length > 0]).toEqual(["refused", { bookId, entryId: id.code ?? "" }, true]);
    expect(at["The night shift"]?.kind).toBe("marked");
    // LRE switched these off and nothing says how they stood: listed, to stay off. The one the user switched on isn't.
    expect(plan.entries.filter((e) => e.switchedOff).map((e) => e.title)).toEqual(["The shop debt", "The night shift"]);
    expect(at["The spare key"]?.switchedOff).toBeUndefined();
    expect(await stored(rig, bookId)).toBe(before);
  });

  test("the list of books says where each move stands and writes nothing", async () => {
    const rig = new Rig();
    const { bookId } = await oldBook(rig);
    const before = await stored(rig, bookId);
    const books = rig.body(await rig.send({ type: "lre.secrecy", op: "books" })).books as SecrecyBookView[];
    expect(books.find((b) => b.id === bookId)?.state).toBe("legacy");
    expect(await stored(rig, bookId)).toBe(before);
    await take(rig, "apply", await preview(rig, bookId));
    const moved = await stored(rig, bookId);
    const after = rig.body(await rig.send({ type: "lre.secrecy", op: "books" })).books as SecrecyBookView[];
    expect(after.find((b) => b.id === bookId)?.state).toBe("applied");
    expect(await stored(rig, bookId)).toBe(moved);
  });
});

describe("applying a book's move", () => {
  test("each secret's text becomes its mark, each twin becomes the same mark and stands as its note says, and entries LRE switched off stay off, listed", async () => {
    const rig = new Rig();
    const { bookId, id } = await oldBook(rig);
    const plain = JSON.stringify(await entryOf(rig, id.plain ?? ""));
    const engine = JSON.stringify(await entryOf(rig, id.engine ?? ""));
    const plan = await take(rig, "apply", await preview(rig, bookId));
    expect(plan.state).toBe("applied");
    const debt = await entryOf(rig, id.debt ?? "");
    expect(parseSecretMarks(debt.content).map((m) => [m.start, m.end, m.text, m.knownTo])).toEqual([[0, debt.content.length, DEBT, ["marcus", "danny"]]]);
    expect(debt.disabled).toBe(true);
    const key = await entryOf(rig, id.key ?? "");
    expect(parseSecretMarks(key.content).map((m) => m.text)).toEqual([KEY]);
    expect(key.disabled).toBe(false);
    // Each twin's text becomes the same mark as its secret's; then the one that was on is on again with no LRE fields, and the one that was off has its own fields back, as their notes say.
    const copy = await entryOf(rig, id.copy ?? "");
    expect([parseSecretMarks(copy.content).map((m) => [m.start, m.end, m.text, m.knownTo]), copy.disabled, lre(copy.extensions)]).toEqual([[[0, copy.content.length, DEBT, ["marcus", "danny"]]], false, undefined]);
    const draft = await entryOf(rig, id.draft ?? "");
    expect([parseSecretMarks(draft.content).map((m) => m.text), draft.disabled, lre(draft.extensions)]).toEqual([[DEBT], true, { lore: { links: ["harbor"], aliases: ["the loan"] } }]);
    // A secret whose text can't be a mark, its twin (still off, as LRE kept it), and a secret marked already keep their text.
    const codeCopy = await entryOf(rig, id.codeCopy ?? "");
    expect([codeCopy.content, codeCopy.disabled]).toEqual([CODE, true]);
    expect((await entryOf(rig, id.code ?? "")).content).toBe(CODE);
    expect((await entryOf(rig, id.shift ?? "")).content).toBe(SHIFT);
    expect(plan.entries.filter((e) => e.switchedOff && e.off).map((e) => e.title)).toEqual(["The shop debt", "The night shift"]);
    // The user's own entry and the engine's are untouched.
    expect([JSON.stringify(await entryOf(rig, id.plain ?? "")), JSON.stringify(await entryOf(rig, id.engine ?? ""))]).toEqual([plain, engine]);
  });

  test("the old fields stay until the user confirms the book reads right, and only the secrecy ones come off then", async () => {
    const rig = new Rig();
    const { bookId, id } = await oldBook(rig);
    const applied = await take(rig, "apply", await preview(rig, bookId));
    expect(lre((await entryOf(rig, id.debt ?? "")).extensions)).toEqual({ lore: debtFields });
    expect(lre((await entryOf(rig, id.harbor ?? "")).extensions)).toEqual({ lore: { secret: false, gate: GATE, links: ["harbor"], aliases: ["the pier"] } });
    const confirmed = await take(rig, "confirm", applied);
    expect(confirmed.state).toBe("confirmed");
    const debt = await entryOf(rig, id.debt ?? "");
    expect(debt.extensions).toEqual({ other_extension: { kept: true } });
    expect(lre((await entryOf(rig, id.harbor ?? "")).extensions)).toEqual({ lore: { links: ["harbor"], aliases: ["the pier"] } });
    expect(lre((await entryOf(rig, id.key ?? "")).extensions)).toBeUndefined();
    expect(lre((await entryOf(rig, id.shift ?? "")).extensions)).toBeUndefined();
    // A secret that couldn't become a mark keeps its old secrecy, fields and all, and so does its twin, note and all.
    expect(lre((await entryOf(rig, id.code ?? "")).extensions)).toEqual({ lore: { secret: true, gate: GATE } });
    expect((await entryOf(rig, id.code ?? "")).disabled).toBe(true);
    expect(lre((await entryOf(rig, id.codeCopy ?? "")).extensions)).toEqual({ lore: { secret: true, gate: GATE }, secretCopyOf: { entry: `${bookId}/${id.code ?? ""}`, off: false, fields: null } });
  });

  test("a second Apply is refused while the move is under way, and changes nothing", async () => {
    const rig = new Rig();
    const { bookId } = await oldBook(rig);
    const applied = await take(rig, "apply", await preview(rig, bookId));
    const moved = await stored(rig, bookId);
    const again = await rig.send({ type: "lre.secrecy", op: "apply", bookId, version: applied.version });
    expect(again.type).toBe("lre.error");
    expect(await stored(rig, bookId)).toBe(moved);
  });
});

describe("restoring secrecy as it was", () => {
  test("preview, Apply and Restore round-trip the book byte for byte", async () => {
    const rig = new Rig();
    const { bookId } = await oldBook(rig);
    const before = await stored(rig, bookId);
    const applied = await take(rig, "apply", await preview(rig, bookId));
    expect(await stored(rig, bookId)).not.toBe(before);
    const restored = await take(rig, "restore", applied);
    expect(restored.state).toBe("legacy");
    expect(restored.restored).not.toBeNull();
    expect(await stored(rig, bookId)).toBe(before);
  });

  test("after Confirm too, the book comes back byte for byte, and can be moved again", async () => {
    const rig = new Rig();
    const { bookId } = await oldBook(rig);
    const before = await stored(rig, bookId);
    const confirmed = await take(rig, "confirm", await take(rig, "apply", await preview(rig, bookId)));
    await take(rig, "restore", confirmed);
    expect(await stored(rig, bookId)).toBe(before);
    const again = await preview(rig, bookId);
    expect([again.state, again.entries.length]).toEqual(["legacy", 8]);
    await take(rig, "restore", await take(rig, "apply", again));
    expect(await stored(rig, bookId)).toBe(before);
  });

  test("an entry the user changed since the move is put back as it stood before it, and one switched on since goes back off", async () => {
    const rig = new Rig();
    const { bookId, id } = await oldBook(rig);
    const before = await stored(rig, bookId);
    await take(rig, "apply", await preview(rig, bookId));
    rig.host.editEntry(id.debt ?? "", { content: "Marcus paid it all back." });
    rig.host.editEntry(id.shift ?? "", { disabled: false });
    const now = await preview(rig, bookId);
    expect(now.entries.filter((e) => e.now === "changed").map((e) => e.title).sort()).toEqual(["The night shift", "The shop debt"]);
    expect(listed(now)["The shop debt"]?.marked).toBe(false);
    await take(rig, "restore", now);
    expect(await stored(rig, bookId)).toBe(before);
  });
});

describe("each step acts only on the book as the page read it", () => {
  test("a book changed since the preview refuses Apply, and nothing of the move is written", async () => {
    const rig = new Rig();
    const { bookId, id } = await oldBook(rig);
    const plan = await preview(rig, bookId);
    rig.host.editEntry(id.key ?? "", { content: `${KEY} It is brass.` });
    const changed = await stored(rig, bookId);
    const refused = await rig.send({ type: "lre.secrecy", op: "apply", bookId, version: plan.version });
    expect(refused.type === "lre.error" ? refused.code : null).toBe("conflict");
    expect(await stored(rig, bookId)).toBe(changed);
    // Read again, the book moves as it stands now.
    await take(rig, "apply", await preview(rig, bookId));
    expect(parseSecretMarks((await entryOf(rig, id.key ?? "")).content).map((m) => m.text)).toEqual([`${KEY} It is brass.`]);
  });

  test("an entry the host won't write keeps its old secrecy through Confirm, and Restore still puts the book back", async () => {
    const rig = new Rig();
    const { bookId, id } = await oldBook(rig);
    const before = await stored(rig, bookId);
    rig.host.refusedWrites.add(id.key ?? "");
    const applied = await take(rig, "apply", await preview(rig, bookId));
    expect(listed(applied)["The spare key"]?.error?.step).toBe("apply");
    rig.host.refusedWrites.clear();
    await take(rig, "confirm", applied);
    const key = await entryOf(rig, id.key ?? "");
    expect([key.content, lre(key.extensions)]).toEqual([KEY, { lore: { secret: true, gate: GATE } }]);
    await take(rig, "restore", await preview(rig, bookId));
    expect(await stored(rig, bookId)).toBe(before);
  });
});

describe("a twin once moved", () => {
  test("its secret reaches no narrator's prompt that LRE's interceptor misses, in a chat that reads the twin's book and not its secret's", async () => {
    const rig = new Rig();
    rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET) ? JSON.stringify({ action: null, params: {}, confidence: 0.9 }) : JSON.stringify({ proposals: [] }));
    const chatId = await rig.worldChat();
    const user = rig.host.userId;
    const own = await rig.host.books.create("Port Alder notes", "", user);
    const debt = await rig.host.books.createEntry(own, entry("The shop debt", DEBT, { disabled: true, constant: true, extensions: { [NS]: { lore: debtFields } } }), user);
    // A character card's copy of the book, whose twin of the secret LRE kept off; it was on before.
    const card = await rig.host.books.create("Port Alder notes", "", user);
    const copy = await rig.host.books.createEntry(card, entry("The shop debt", DEBT, { disabled: true, constant: true, extensions: { [NS]: { lore: debtFields, secretCopyOf: { entry: `${own}/${debt}`, off: false, fields: null } } } }), user);
    await rig.host.books.createEntry(card, entry("Opening hours", "OPEN-MARK: the shop opens at nine.", { constant: true }), user);
    const meta = await rig.host.chats.chatMetadata(chatId, user);
    const attached = Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : [];
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...attached, card] }, user);
    await take(rig, "apply", await preview(rig, card));
    expect((await entryOf(rig, copy)).disabled).toBe(false);
    // The host stops waiting for LRE's interceptor, and assembles the entries as stored.
    rig.host.worldInfoInterceptor = async () => {
      throw new Error("the host stopped waiting");
    };
    await rig.turn(chatId, "I wait by the counter.", "The radio hums.");
    const prompt = rig.host.assembled.map((e) => e.content).join("\n");
    expect(prompt).toContain("OPEN-MARK");
    expect(prompt).not.toContain("four thousand dollars");
  });
});

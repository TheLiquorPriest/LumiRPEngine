// Secret marks in World Info entries (DESIGN §4.2, §6.1; `shared/secret-marks.ts`): what LRE reads as
// a mark in an entry's text, ending where the host's macro pass ends it, and what it leaves out as
// unreadable, so an author's broken mark fails closed; the names a mark gives, as Port Alder's people;
// the mark as the narrator is told it; and an entry's text as each reader is handed it. A mark LRE
// writes reads back as given, and what the host couldn't strip whole is refused before it is written.

import { describe, expect, test } from "bun:test";
import {
  applyMarks,
  markNameIssues,
  parseSecretMarks,
  publicText,
  renderMark,
  resolveMarkNames,
  SECRET_MARK_WORDING,
  SecretMarkError,
  secretMarkProblem,
  secretMarkText,
  unreadableMarks,
  wholeEntrySecret,
  writeSecretMark,
  type MarkNamesSource,
  type SecretMarkInput,
} from "../../src/shared/secret-marks";

/** Port Alder's people as its world names them; Helen and Jess share a surname. */
const ALDER: MarkNamesSource = {
  entities: {
    pov: { name: "Jordan Ellis" },
    marcus_delgado: { name: "Marcus Delgado" },
    danny_okafor: { name: "Danny Okafor" },
    priya_nair: { name: "Priya Nair" },
    helen_kowalczyk: { name: "Helen Kowalczyk" },
    jess_kowalczyk: { name: "Jess Kowalczyk" },
  },
};

/** The marks an entry's text holds, each as Build shows it: its text and its names as written. */
const read = (content: string) => parseSecretMarks(content).map(({ text, knownTo, keptFrom }) => ({ text, knownTo, keptFrom }));

describe("reading a secret mark", () => {
  test("each of the four forms, everyone alone after kept from, and the brackets' two parts in either order", () => {
    expect(read("{{// Secret: The deed to the shop is forged.}}")).toEqual([{ text: "The deed to the shop is forged.", knownTo: [], keptFrom: "everyone" }]);
    expect(read("{{// Secret (known to Marcus, Danny Okafor): The shop owes the bank three months.}}")).toEqual([{ text: "The shop owes the bank three months.", knownTo: ["Marcus", "Danny Okafor"], keptFrom: "everyone" }]);
    expect(read("{{// Secret (kept from Jordan Ellis): The shop is for sale.}}")).toEqual([{ text: "The shop is for sale.", knownTo: [], keptFrom: ["Jordan Ellis"] }]);
    expect(read("{{// Secret (known to Priya Nair; kept from Jordan): The books don't balance.}}")).toEqual([{ text: "The books don't balance.", knownTo: ["Priya Nair"], keptFrom: ["Jordan"] }]);
    expect(read("{{// Secret (kept from Jordan; known to Priya Nair): The books don't balance.}}")).toEqual(read("{{// Secret (known to Priya Nair; kept from Jordan): The books don't balance.}}"));
    expect(read("{{// Secret (kept from everyone): The deed to the shop is forged.}}")).toEqual(read("{{// Secret: The deed to the shop is forged.}}"));
  });

  test("each mark where it stands in the entry, as written, in order", () => {
    const first = "{{// Secret (known to Marcus): Marcus owes the bank.}}";
    const second = "{{// Secret: The spare key is under the mat.}}";
    const content = `The garage opens at eight.\n${first}\nIt shuts at six. ${second}`;
    const marks = parseSecretMarks(content);
    expect(marks.map((m) => m.raw)).toEqual([first, second]);
    expect(marks.map((m) => content.slice(m.start, m.end))).toEqual([first, second]);
    expect(marks.map((m) => m.text)).toEqual(["Marcus owes the bank.", "The spare key is under the mat."]);
  });

  test("Secret, known to and kept from read in any case, and Secret only as a whole word", () => {
    expect(read("{{// sEcReT (KNOWN TO Marcus; Kept From Jordan): x}}")).toEqual([{ text: "x", knownTo: ["Marcus"], keptFrom: ["Jordan"] }]);
    expect(read("{{//SECRET: x}}")).toEqual([{ text: "x", knownTo: [], keptFrom: "everyone" }]);
    // Another comment, a word that only starts with Secret, a macro of that name: no mark, and nothing unreadable.
    for (const other of ["{{// The shop opens at eight.}}", "{{// Secrets: x}}", "{{// Secret_note: x}}", "{{secret}}x{{/secret}}"]) {
      expect(parseSecretMarks(other)).toEqual([]);
      expect(unreadableMarks(other)).toEqual([]);
    }
  });

  test("a mark's text may run over lines, CRLF ones too, and spaces and tabs may stand around each of its parts", () => {
    expect(read("{{// Secret: Marcus owes the bank.\nThree months now.}}")[0]?.text).toBe("Marcus owes the bank.\nThree months now.");
    expect(read("{{// Secret: Marcus owes the bank.\r\nThree months now.}}")[0]?.text).toBe("Marcus owes the bank.\r\nThree months now.");
    expect(read("{{ \t//\t Secret \t( known  to \tMarcus ,  Danny   Okafor ;\tkept from Jordan )\t:\t Marcus owes the bank. \t}}")).toEqual([{ text: "Marcus owes the bank.", knownTo: ["Marcus", "Danny Okafor"], keptFrom: ["Jordan"] }]);
  });

  test("a mark ends at its first }}, as the host ends it: what follows reaches every reader", () => {
    const content = "{{// Secret: Marcus owes the bank}} three months}}";
    expect(read(content)).toEqual([{ text: "Marcus owes the bank", knownTo: [], keptFrom: "everyone" }]);
    expect(publicText(content)).toBe(" three months}}");
    // A text that ends in } ends its mark a brace early.
    expect(read("{{// Secret: a set {x}}}")[0]?.text).toBe("a set {x");
    expect(publicText("{{// Secret: a set {x}}}")).toBe("}");
  });
});

describe("what starts like a mark but can't be read", () => {
  test("is never read as a secret, and every reader is handed the text without it, as far as the host's lexing could take it", () => {
    const cases: { content: string; raw: string; left: string }[] = [
      // A nested macro: the host lexes it on its own terms, and may end the mark elsewhere.
      { content: "Before. {{// Secret: Marcus {{user}} owes the bank.}} After.", raw: "{{// Secret: Marcus {{user}} owes the bank.}}", left: "Before.  After." },
      // A backslash before a brace: an escape, which runs the mark on.
      { content: "Before. {{// Secret: Marcus owes \\} the bank.}} After.", raw: "{{// Secret: Marcus owes \\} the bank.}}", left: "Before.  After." },
      // No closing }}: the host hides the rest of the entry with it.
      { content: "Before. {{// Secret: Marcus owes the bank.\nThe garage opens at eight.", raw: "{{// Secret: Marcus owes the bank.\nThe garage opens at eight.", left: "Before. " },
      // A line break between {{ and //, which leaves it in every prompt; one between // and Secret; one before the colon.
      { content: "Before. {{\n// Secret: Marcus owes the bank.}} After.", raw: "{{\n// Secret: Marcus owes the bank.}}", left: "Before.  After." },
      { content: "Before. {{//\nSecret: Marcus owes the bank.}} After.", raw: "{{//\nSecret: Marcus owes the bank.}}", left: "Before.  After." },
      { content: "Before. {{// Secret (known to\nMarcus): Marcus owes the bank.}} After.", raw: "{{// Secret (known to\nMarcus): Marcus owes the bank.}}", left: "Before.  After." },
      // Inside another macro's arguments, which the host drops it from.
      { content: "{{random::Before.,{{// Secret: Marcus owes the bank.}}}} After.", raw: "{{// Secret: Marcus owes the bank.}}", left: "{{random::Before.,}} After." },
    ];
    // Brackets that don't read: not closed before the colon, a part that isn't "known to" or "kept from", a name on both sides,
    // everyone knowing it, everyone beside a name, a missing name, a part given twice, three parts, no colon, no text.
    for (const raw of [
      "{{// Secret (known to Marcus: Marcus owes the bank.}}",
      "{{// Secret (told to Marcus): Marcus owes the bank.}}",
      "{{// Secret (known to Marcus; kept from marcus): Marcus owes the bank.}}",
      "{{// Secret (known to everyone): Marcus owes the bank.}}",
      "{{// Secret (kept from everyone, Jordan): Marcus owes the bank.}}",
      "{{// Secret (known to Marcus,): Marcus owes the bank.}}",
      "{{// Secret (known to Marcus; known to Danny): Marcus owes the bank.}}",
      "{{// Secret (known to Marcus; kept from Jordan; kept from Danny): Marcus owes the bank.}}",
      "{{// Secret (known to Marcus) Marcus owes the bank.}}",
      "{{// Secret: }}",
    ]) cases.push({ content: `Before. ${raw} After.`, raw, left: "Before.  After." });
    for (const c of cases) {
      expect(parseSecretMarks(c.content)).toEqual([]);
      // Each as far as the host's lexing takes it, with why for Build to show.
      expect(unreadableMarks(c.content).map((u) => u.raw)).toEqual([c.raw]);
      expect(unreadableMarks(c.content)[0]?.problem).toBeTruthy();
      expect(publicText(c.content)).toBe(c.left);
    }
  });
});

describe("a whole-entry secret", () => {
  test("is an entry whose whole text is one mark, blank lines around it aside", () => {
    expect(wholeEntrySecret("\n  {{// Secret (known to Marcus): The deed to the shop is forged.}}\n\n")).toMatchObject({ text: "The deed to the shop is forged.", knownTo: ["Marcus"], keptFrom: "everyone" });
    for (const not of [
      "The garage opens at eight. {{// Secret: The deed is forged.}}",
      "{{// Secret: The deed is forged.}}\n{{// Secret: The spare key is under the mat.}}",
      "{{// Secret: The deed is forged.}} {{// Secret: Helen {{user}} saw it.}}",
      "{{// Secret: Helen {{user}} saw it.}}",
      "The garage opens at eight.",
    ]) expect(wholeEntrySecret(not)).toBeNull();
  });
});

describe("writing a secret mark", () => {
  test("reads back as given: its text trimmed, its names each once as written, kept from everyone when none is named", () => {
    const cases: { input: SecretMarkInput; reads: { text: string; knownTo: string[]; keptFrom: string[] | "everyone" } }[] = [
      { input: { text: "The deed to the shop is forged.", knownTo: [], keptFrom: "everyone" }, reads: { text: "The deed to the shop is forged.", knownTo: [], keptFrom: "everyone" } },
      { input: { text: "  Marcus owes the bank.\nThree months now.  ", knownTo: ["Marcus", " Danny  Okafor "], keptFrom: "everyone" }, reads: { text: "Marcus owes the bank.\nThree months now.", knownTo: ["Marcus", "Danny Okafor"], keptFrom: "everyone" } },
      { input: { text: "RUMOR: the harbor master takes bribes (or so they say).", knownTo: [], keptFrom: ["Jordan Ellis"] }, reads: { text: "RUMOR: the harbor master takes bribes (or so they say).", knownTo: [], keptFrom: ["Jordan Ellis"] } },
      { input: { text: "(Priya) found the second ledger.", knownTo: ["Priya Nair"], keptFrom: ["Jordan", "Helen Kowalczyk"] }, reads: { text: "(Priya) found the second ledger.", knownTo: ["Priya Nair"], keptFrom: ["Jordan", "Helen Kowalczyk"] } },
      { input: { text: "A single { or } is fine.", knownTo: ["Marcus", "marcus"], keptFrom: ["everyone"] }, reads: { text: "A single { or } is fine.", knownTo: ["Marcus"], keptFrom: "everyone" } },
      { input: { text: "Nothing named.", knownTo: [], keptFrom: [] }, reads: { text: "Nothing named.", knownTo: [], keptFrom: "everyone" } },
    ];
    for (const { input, reads } of cases) {
      expect(secretMarkProblem(input)).toBeNull();
      const written = writeSecretMark(input);
      expect(unreadableMarks(written)).toEqual([]);
      expect(wholeEntrySecret(written)).not.toBeNull();
      expect(read(written)).toEqual([reads]);
      // Added to a longer text, it reads the same, and the rest of the text is what anyone reads.
      const entry = `The garage opens at eight.\n${written}\nIt shuts at six.`;
      expect(read(entry)).toEqual([reads]);
      expect(publicText(entry)).toBe("The garage opens at eight.\n\nIt shuts at six.");
    }
  });

  test("refuses what the host couldn't strip whole, and names that wouldn't read back as given", () => {
    const named = (knownTo: string[], keptFrom: string[] | "everyone" = "everyone"): SecretMarkInput => ({ text: "Marcus owes the bank.", knownTo, keptFrom });
    const refused: SecretMarkInput[] = [
      { text: "", knownTo: [], keptFrom: "everyone" },
      { text: "  \n ", knownTo: [], keptFrom: "everyone" },
      { text: "Marcus {{user}} owes the bank.", knownTo: [], keptFrom: "everyone" },
      { text: "Marcus owes the bank}} and more.", knownTo: [], keptFrom: "everyone" },
      { text: "Marcus owes \\{ the bank.", knownTo: [], keptFrom: "everyone" },
      { text: "Marcus owes the bank }", knownTo: [], keptFrom: "everyone" },
      { text: "Marcus owes the bank \\", knownTo: [], keptFrom: "everyone" },
      named([""]),
      named(["  "]),
      named(["Marcus, Danny"]),
      named(["Marcus; Danny"]),
      named(["Marcus (the owner)"]),
      named(["Marcus: the owner"]),
      named(["Danny\nOkafor"]),
      named(["{{user}}"]),
      named(["everyone"]),
      named([], ["everyone", "Jordan"]),
      named(["Marcus"], ["marcus "]),
    ];
    for (const input of refused) {
      expect(typeof secretMarkProblem(input)).toBe("string");
      expect(() => writeSecretMark(input)).toThrow(SecretMarkError);
    }
  });
});

describe("a mark's names", () => {
  const names = (knownTo: string[], keptFrom: string[] | "everyone" = "everyone") => resolveMarkNames(ALDER, null, { knownTo, keptFrom });

  test("name people by id, by whole name, or by a word of a name that is no one else's, case and spacing aside", () => {
    expect(names(["danny_okafor", "Priya_Nair", "pov"]).knownTo).toEqual(["danny_okafor", "priya_nair", "pov"]);
    expect(names(["marcus delgado", "Helen   Kowalczyk"]).knownTo).toEqual(["marcus_delgado", "helen_kowalczyk"]);
    expect(names(["Jordan", "Okafor"])).toEqual({ knownTo: ["pov", "danny_okafor"], keptFrom: "everyone", unresolved: [] });
    // Each person once, in the mark's order.
    expect(names(["Marcus", "Marcus Delgado", "marcus_delgado", "Danny"]).knownTo).toEqual(["marcus_delgado", "danny_okafor"]);
  });

  test("a word two names share, or a name of no one, names nobody and is kept as written", () => {
    expect(names(["Kowalczyk", "the harbor master"], ["Jordan"])).toEqual({ knownTo: [], keptFrom: ["pov"], unresolved: ["Kowalczyk", "the harbor master"] });
    // The chat's own people count too: Helen's surname is hers alone until the chat's Jess shares it.
    const helen: MarkNamesSource = { entities: { helen_kowalczyk: { name: "Helen Kowalczyk" } } };
    const jess: MarkNamesSource = { entities: { jess_kowalczyk: { name: "Jess Kowalczyk" } } };
    expect(resolveMarkNames(helen, null, { knownTo: ["Kowalczyk"], keptFrom: "everyone" }).knownTo).toEqual(["helen_kowalczyk"]);
    expect(resolveMarkNames(helen, jess, { knownTo: ["Kowalczyk"], keptFrom: "everyone" })).toEqual({ knownTo: [], keptFrom: "everyone", unresolved: ["Kowalczyk"] });
  });

  test('"you" and "the player character" name the player character, as the knowledge step reads them, when the world has one', () => {
    const world: MarkNamesSource = { ...ALDER, pov: "pov" };
    expect(resolveMarkNames(world, null, { knownTo: ["You"], keptFrom: ["the player character", "Player character"] })).toEqual({ knownTo: ["pov"], keptFrom: ["pov"], unresolved: [] });
    // With no player character to name, the words name no one.
    expect(names(["you"]).unresolved).toEqual(["you"]);
  });

  test("Build and the lint warn of each name that names no one or more than one person, saying whom it could be, and of no other", () => {
    const world: MarkNamesSource = { ...ALDER, pov: "pov" };
    const issues = markNameIssues(world, null, { knownTo: ["Marcus", "Kowalczyk"], keptFrom: ["you", "Jordan Elis"] }, "mark.0");
    expect(issues.map((i) => [i.severity, i.code, i.path])).toEqual([
      ["warning", "mark_name_ambiguous", "mark.0"],
      ["warning", "mark_name_unresolved", "mark.0"],
    ]);
    for (const who of ["Helen Kowalczyk", "Jess Kowalczyk"]) expect(issues[0]?.message).toContain(who);
    expect(issues[1]?.message).toContain("Jordan Elis");
    expect(markNameIssues(world, null, { knownTo: ["Marcus Delgado", "danny_okafor"], keptFrom: "everyone" }, "mark.0")).toEqual([]);
  });
});

describe("a mark as the narrator is told it", () => {
  test("the shipped wording: its text, then whom it is known to and kept from", () => {
    expect(secretMarkText("The shop owes the bank.", ["Marcus Delgado", "Danny Okafor"], "everyone")).toBe("The shop owes the bank. [secret; known to Marcus Delgado, Danny Okafor]");
    expect(secretMarkText("The shop is for sale.", [], ["Jordan Ellis"])).toBe("The shop is for sale. [secret; kept from Jordan Ellis]");
    expect(secretMarkText("The books don't balance.", ["Priya Nair"], ["Jordan Ellis", "Helen Kowalczyk"])).toBe("The books don't balance. [secret; known to Priya Nair; kept from Jordan Ellis, Helen Kowalczyk]");
    // Kept from everyone, no one named either way.
    expect(secretMarkText("The deed is forged.", [], "everyone")).toBe("The deed is forged. [secret; kept from everyone]");
    expect(secretMarkText("The deed is forged.", [], [])).toBe("The deed is forged. [secret; kept from everyone]");
    // A text that holds a placeholder's words is told as it is.
    expect(secretMarkText("Marcus wrote {{known}} on the ledger.", ["Marcus Delgado"], "everyone")).toBe("Marcus wrote {{known}} on the ledger. [secret; known to Marcus Delgado]");
  });

  test("the user's own wording, part by part", () => {
    const wording = { ...SECRET_MARK_WORDING, known: "(only {{known}} knows) {{text}}", everyone: "all but its holders" };
    expect(secretMarkText("The deed is forged.", ["Marcus Delgado"], "everyone", wording)).toBe("(only Marcus Delgado knows) The deed is forged.");
    expect(secretMarkText("The deed is forged.", [], "everyone", wording)).toBe("The deed is forged. [secret; kept from all but its holders]");
  });

  test("names each person by name, and a name that names nobody as written; left out, it is nothing", () => {
    const mark = { text: "Marcus owes the bank.", knownTo: ["Marcus", "the harbor master"], keptFrom: ["Jordan"] };
    const resolved = resolveMarkNames(ALDER, null, mark);
    const nameOf = (id: string): string => ALDER.entities[id]?.name ?? id;
    expect(renderMark(mark, resolved, nameOf, "marked")).toBe("Marcus owes the bank. [secret; known to Marcus Delgado, the harbor master; kept from Jordan Ellis]");
    expect(renderMark(mark, resolved, nameOf, "omit")).toBe("");
  });
});

describe("an entry's text as each reader is handed it", () => {
  const TEXT = "The garage opens at eight.\n{{// Secret (known to Marcus): Marcus owes the bank.}}\n{{// Secret (known to Danny; kept from Jordan): Danny took the spare key.}}\n{{// Secret: Helen {{user}} saw it.}}";
  const reader = { world: ALDER, state: null };
  const owes = secretMarkText("Marcus owes the bank.", ["Marcus Delgado"], "everyone");
  const key = secretMarkText("Danny took the spare key.", ["Danny Okafor"], ["Jordan Ellis"]);

  test("marked: every mark told as the narrator is told it; what can't be read left out", () => {
    expect(applyMarks(TEXT, reader, "marked")).toBe(`The garage opens at eight.\n${owes}\n${key}\n`);
    expect(applyMarks(TEXT, { ...reader, wording: { ...SECRET_MARK_WORDING, known: "{{text}} (only {{known}} knows)" } }, "marked")).toBe(`The garage opens at eight.\nMarcus owes the bank. (only Marcus Delgado knows)\n${key}\n`);
    // A text with no mark is handed on as it is.
    expect(applyMarks("The garage opens at eight.", reader, "marked")).toBe("The garage opens at eight.");
  });

  test("omit: every mark left out, as anyone may read the text", () => {
    expect(applyMarks(TEXT, reader, "omit")).toBe("The garage opens at eight.\n\n\n");
    expect(applyMarks(TEXT, reader, "omit")).toBe(publicText(TEXT));
  });

  test("as one character holds them: each mark they know marked, every other one left out", () => {
    expect(applyMarks(TEXT, reader, "holder:marcus_delgado")).toBe(`The garage opens at eight.\n${owes}\n\n`);
    expect(applyMarks(TEXT, reader, "holder:danny_okafor")).toBe(`The garage opens at eight.\n\n${key}\n`);
    // Jordan knows neither; a secret kept from everyone is no one's to hold.
    expect(applyMarks(TEXT, reader, "holder:pov")).toBe(publicText(TEXT));
    expect(applyMarks("{{// Secret: The deed to the shop is forged.}}", reader, "holder:marcus_delgado")).toBe("");
  });
});

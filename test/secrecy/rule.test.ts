// The secrecy half of the World Info gate (DESIGN §4.2, §6.1, §9.6), run on `src/secrecy/` alone: what
// holds a World Info entry back from the narrator's prompt and from the helpers' and minds' reading of
// lore, and how each reader is handed an entry's marks. What is secret in an entry is in its own text,
// as secret marks (`shared/secret-marks.ts`); an earlier build's secrecy fields are read as they stand
// and never written. Each check says what reached the prompt (the verdict applied as the host applies
// it) or what a reader may read of the lore made of the books, and that the books are as they were.

import { describe, expect, test } from "bun:test";
import { blankWorld } from "../../src/engine/authoring";
import { loreReadable } from "../../src/engine/lore";
import { STARTER_WORLDS } from "../../src/packs/index";
import type { HostBookEntry, WorldInfoCandidate, WorldInfoVerdict } from "../../src/shared/host";
import type { JsonObject } from "../../src/shared/json";
import { LEDGER_NAMESPACE, type LedgerEvent } from "../../src/shared/ledger";
import { bookTextHash } from "../../src/shared/lore";
import { factId, MINDS_EVENTS } from "../../src/shared/minds";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import { type NarratorView, NARRATOR_DEFAULTS } from "../../src/shared/narrator-view";
import type { WorldDoc } from "../../src/shared/world";
import type { WorldState } from "../../src/engine/state";
import { blind } from "../../src/secrecy/blind";
import { booksAsLore, bookLoreEntries, entriesRead } from "../../src/secrecy/book-lore";
import { bookSecrecy, copiedOriginals, secrecyParts, secretTexts } from "../../src/secrecy/lore-secrets";
import { type WorldInfoGate, worldInfoVerdict } from "../../src/secrecy/verdict";
import { fold, startState } from "../packs/support";
import { bookEntry, candidateOf, DEBT, DOCK, FERRY, lreFields, PLAIN, registry, SEEN, USER, WRECK } from "./fixture";

const SECRET = "The ferryman scuttled the old boat for the insurance money";
const HARBOR_MASTER = "self.occupation == 'harbor_master'";
const YOU = "YOU-MARK: the harbor master keeps a second set of keys.";
const PC = "PC-MARK: a page is torn out of the ferry's logbook.";
const TYPO = "TYPO-MARK: Danny sold the old outboard for cash.";
const OTHERS = "OTHERS-MARK: Jordan paid the slip fees twice.";
const OLD = "OLD-MARK: the ferryman sank his own boat for the insurance money.";
const WALL = "WALL-MARK: the harbor wall is older than the town.";
const TUNNEL = "TUNNEL-MARK: Danny found a smugglers' tunnel behind the wall.";
const BROKEN = "{{// Secret: BROKEN-A {{user}} BROKEN-B}}";
const DEBT_NOTE = "DEBT-MARK: the ferryman owes the harbor master money.";

/** The views a chat may choose for itself, and the default: everyone in the scene, secrets marked. */
const DEFAULT_VIEW: NarratorView = { ...NARRATOR_DEFAULTS };
const PLAYER_VIEW: NarratorView = { knowledge: "pov", secrets: "omit" };
const VIEWS: [string, NarratorView][] = [
  ["everyone in the scene with secrets left out", { knowledge: "scene", secrets: "omit" }],
  ["the player character's, secrets marked", { knowledge: "pov", secrets: "marked" }],
];

/** Port Alder at its start: Jordan Ellis is the player character (`pov`), Marcus Delgado and Danny Okafor are among its people. */
function portAlder(): { world: WorldDoc; state: WorldState } {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  return { world, state: startState(world, registry) };
}

const gateOn = (world: WorldDoc, state: WorldState, view: NarratorView = DEFAULT_VIEW): WorldInfoGate => ({ registry, playsWorld: () => true, head: async () => ({ world, state }), narrator: async () => ({ view, wording: SECRET_MARK_WORDING }), log: () => undefined });
const input = (entries: WorldInfoCandidate[]) => ({ chatId: "c", userId: USER, chatMetadata: {}, entries });

/** A reading of the books as the verdict is applied: an off vote wins, an on vote switches on an entry stored off, a text of the prompt's own stands in for the entry's. */
function prompted(entries: readonly WorldInfoCandidate[], verdict: WorldInfoVerdict): Map<string, string> {
  const off = new Set(verdict.disabled);
  const on = new Set(verdict.enabled);
  const text = new Map((verdict.mutated ?? []).map((m) => [m.id, m.content]));
  return new Map(entries.filter((e) => !off.has(e.id) && (!e.disabled || on.has(e.id))).map((e) => [e.id, text.get(e.id) ?? e.content]));
}

/** What a prompt holds after the verdict of the gate on `entries`. */
async function promptOf(entries: readonly HostBookEntry[], gate: WorldInfoGate): Promise<Map<string, string>> {
  const candidates = entries.map(candidateOf);
  return prompted(candidates, await worldInfoVerdict(gate, input(candidates)));
}
const joined = (prompt: ReadonlyMap<string, string>): string => [...prompt.values()].join("\n");

/** The entries three authors wrote with marks: Marcus's, kept from everyone else; a whole entry kept from everyone; one Jordan, the player character, knows. */
const MARKED = [
  bookEntry("b1", "ferry", `${FERRY}\n{{// Secret (known to Marcus): ${DEBT}}}`),
  bookEntry("b1", "wreck", `{{// Secret: ${WRECK}}}`),
  bookEntry("b1", "dock", `${DOCK}\n{{// Secret (known to Jordan): ${SEEN}}}`),
];

/** The lore of the books alone, `entries`, that a reader that is no one's mind may read (the helpers, `brief`), by text. */
function readByHelpers(world: WorldDoc, state: WorldState, entries: readonly HostBookEntry[], originals: readonly HostBookEntry[] = []): string[] {
  const made = booksAsLore(world, entriesRead(entries), originals);
  return Object.values(made.world.lore)
    .filter((entry) => entry.id.startsWith("book:") && loreReadable(registry, made.world, state, entry, "brief"))
    .map((entry) => (typeof entry.content === "string" ? entry.content : ""));
}

describe("an earlier build's secrecy fields, read as they stand", () => {
  test("an entry stored off with a gate stays out of the prompt until the gate holds, then it is switched on; nothing is written", async () => {
    const { world, state } = portAlder();
    const old = bookEntry("b1", "wreck", `${SECRET}.`, { disabled: true, extensions: lreFields({ secret: true, gate: HARBOR_MASTER }) });
    const entries = [bookEntry("b1", "ferry", FERRY), old];
    const stood = structuredClone(entries);
    const shut = await promptOf(entries, gateOn(world, state));
    expect(shut.has("ferry")).toBe(true);
    expect(joined(shut)).not.toContain(SECRET);
    // The gate holds: the entry is on for this prompt, and as stored it is as it was.
    const open = structuredClone(state) as WorldState;
    const pov = open.entities.pov;
    if (!pov) throw new Error("no player character");
    pov.fields.occupation = "harbor_master";
    expect(joined(await promptOf(entries, gateOn(world, open)))).toContain(SECRET);
    expect(entries).toEqual(stood);
  });

  test("an entry kept secret on both sides, by its own fields and by the world entry indexed from it, opens only once both gates hold", async () => {
    const world = blankWorld("w_both", "Both");
    const entries = [bookEntry("b", "e", `${SECRET}.`, { disabled: true, extensions: lreFields({ secret: true, gate: "true" }) })];
    for (const [gate, opens] of [["false", false], ["true", true]] as const) {
      world.lore.wreck = { id: "wreck", title: "The wreck", content: `${SECRET}.`, keys: [], links: [], secret: true, gate, source: { kind: "book", bookId: "b", entryId: "e", hash: bookTextHash(`${SECRET}.`) } };
      expect(joined(await promptOf(entries, gateOn(world, startState(world, registry)))).includes(SECRET)).toBe(opens);
    }
  });

  test("a twin an earlier build switched off as the copy of a secret world entry's source opens only once the world entry's gate holds too", async () => {
    const world = blankWorld("w_twin", "Twin");
    // Its text as the book has it since the world entry was indexed: the note alone ties it to the world entry.
    const twin = bookEntry("b2", "t", "WRECK-NOW: the boat went down.", { disabled: true, extensions: { [LEDGER_NAMESPACE]: { lore: { secret: true, gate: "true" }, secretCopyOf: { entry: "b/e", off: false, fields: null } } } });
    for (const [gate, opens] of [["false", false], ["true", true]] as const) {
      world.lore.wreck = { id: "wreck", title: "The wreck", content: `${SECRET}.`, keys: [], links: [], secret: true, gate, source: { kind: "book", bookId: "b", entryId: "e", hash: bookTextHash(`${SECRET}.`) } };
      expect(joined(await promptOf([twin], gateOn(world, startState(world, registry)))).includes("WRECK-NOW: the boat went down.")).toBe(opens);
    }
  });
});

describe("secret marks in the narrator's prompt", () => {
  test("under the default view, everyone in the scene with secrets marked, each mark is told marked with whom it is known to, beside the entry's public text", async () => {
    const { world, state } = portAlder();
    const stood = structuredClone(MARKED);
    const prompt = await promptOf(MARKED, gateOn(world, state));
    // The author wrote "Marcus" and "Jordan": the narrator is told whose secret each is by their names.
    for (const told of [FERRY, DEBT, "Marcus Delgado"]) expect(prompt.get("ferry")).toContain(told);
    for (const told of [DOCK, SEEN, "Jordan Ellis"]) expect(prompt.get("dock")).toContain(told);
    // A whole-entry secret is that one secret, marked.
    expect(prompt.get("wreck")).toBe(secretMarkText(WRECK, [], "everyone"));
    expect(MARKED).toEqual(stood);
  });

  for (const [label, narrator] of VIEWS) {
    test(`under a chat's own view, ${label}, a mark kept from the player character is left out, a whole-entry one switched off, and one Jordan knows stays, marked`, async () => {
      const { world, state } = portAlder();
      const prompt = await promptOf(MARKED, gateOn(world, state, narrator));
      expect(prompt.get("ferry")).toContain(FERRY);
      expect(joined(prompt)).not.toContain(DEBT);
      expect(prompt.has("wreck")).toBe(false);
      expect(joined(prompt)).not.toContain(WRECK);
      for (const told of [DOCK, SEEN, "Jordan Ellis"]) expect(prompt.get("dock")).toContain(told);
    });
  }

  test("a mark the player character holds by now goes in under their view, they among the people who know it; one they don't hold stays out", async () => {
    const { world, state } = portAlder();
    // Marcus told Jordan about the slip fees in play, as the knowledge step records a telling (DESIGN §24.11).
    const debt = factId({ kind: "wi", book: "b1", entry: "ferry", mark: 0 });
    const told: LedgerEvent[] = [
      { type: MINDS_EVENTS.fact, data: { fact: { id: debt, kind: "wi", claim: DEBT, about: [], truth: "true" } } },
      { type: MINDS_EVENTS.learn, data: { who: [world.pov], fact: debt, how: "told", by: "marcus_delgado", evidence: [], belief: "true", confidence: 1, msg: null, at: 0 } },
    ];
    const prompt = await promptOf(MARKED, gateOn(world, fold(registry, world, state, told), PLAYER_VIEW));
    for (const shown of [FERRY, DEBT, "Marcus Delgado", "Jordan Ellis"]) expect(prompt.get("ferry")).toContain(shown);
    expect(prompt.has("wreck")).toBe(false);
    expect(joined(prompt)).not.toContain(WRECK);
  });

  /** Marks kept from the player character as an author may write them: in words, and with a name misspelled. */
  const NAMED = [bookEntry("b1", "harbor", `${DOCK}\n{{// Secret (kept from you): ${YOU}}}\n{{// Secret (kept from the player character): ${PC}}}\n{{// Secret (kept from Jordan Elis): ${TYPO}}}\n{{// Secret (kept from Marcus): ${OTHERS}}}`)];
  for (const [label, narrator] of VIEWS) {
    test(`under a chat's own view, ${label}, a mark kept from "you", from "the player character", or from a name that names no one is left out; one kept from Marcus alone stays`, async () => {
      const { world, state } = portAlder();
      const prompt = await promptOf(NAMED, gateOn(world, state, narrator));
      for (const shown of [DOCK, OTHERS]) expect(prompt.get("harbor")).toContain(shown);
      for (const kept of [YOU, PC, TYPO]) expect(joined(prompt)).not.toContain(kept);
    });
  }

  test("under the default view, the marks kept from \"you\" and \"the player character\" are told kept from Jordan; one kept from a misspelled name is told kept from Jordan too, and one kept from Marcus alone from him", async () => {
    const { world, state } = portAlder();
    const told = (await promptOf(NAMED, gateOn(world, state))).get("harbor") ?? "";
    expect(told).toContain(DOCK);
    for (const kept of [YOU, PC]) expect(told).toContain(secretMarkText(kept, [], ["Jordan Ellis"]));
    // The narrator can't tell whom "Jordan Elis" means, so it is told the player character may be one of them.
    expect(told).toContain(secretMarkText(TYPO, [], ["Jordan Ellis", "Jordan Elis"]));
    expect(told).toContain(secretMarkText(OTHERS, [], ["Marcus Delgado"]));
  });

  const WITH_OLD = [...MARKED, bookEntry("b1", "old", `${SECRET}.`, { disabled: true, extensions: lreFields({ secret: true, gate: "true" }) }), bookEntry("b1", "plain", PLAIN)];
  /** What the host strips by itself and what the verdict adds: no secret reaches a prompt that gets no verdict. */
  const secretsOut = (prompt: ReadonlyMap<string, string>): void => {
    for (const shown of [FERRY, DOCK, PLAIN]) expect(joined(prompt)).toContain(shown);
    for (const kept of [DEBT, WRECK, SEEN, SECRET]) expect(joined(prompt)).not.toContain(kept);
  };

  test("when the interceptor fails, no secret reaches the prompt, an earlier build's with its gate holding included: the same answer as when the state can't be read", async () => {
    const { world, state } = portAlder();
    const candidates = WITH_OLD.map(candidateOf);
    const broken: WorldInfoGate = { ...gateOn(world, state), narrator: async () => Promise.reject(new Error("the interceptor broke")) };
    const unread: WorldInfoGate = { ...gateOn(world, state), head: async () => Promise.reject(new Error("no state")) };
    const verdict = await worldInfoVerdict(broken, input(candidates));
    expect(verdict).toEqual(await worldInfoVerdict(unread, input(candidates)));
    expect(verdict).toEqual(blind(candidates));
    secretsOut(prompted(candidates, verdict));
  });

  test("when the chat's state can't be read, no secret reaches the prompt: every mark is left out, and a whole-entry secret, a mark's twin and an earlier build's secret stored on are all off", async () => {
    const entries = [...MARKED, bookEntry("b2", "copy", DEBT), bookEntry("b1", "old", `${SECRET}.`, { extensions: lreFields({ secret: true, gate: "true" }) }), bookEntry("b1", "plain", PLAIN)];
    const unread: WorldInfoGate = { ...gateOn(blankWorld("w", "W"), startState(blankWorld("w", "W"), registry)), head: async () => Promise.reject(new Error("no state")) };
    secretsOut(await promptOf(entries, unread));
  });

  test("a mark that can't be read reaches no prompt and no helper, while the entry's other text does", async () => {
    const { world, state } = portAlder();
    const ferry = bookEntry("b1", "ferry", `${FERRY}\n${BROKEN}`);
    const prompt = await promptOf([ferry], gateOn(world, state));
    expect(prompt.get("ferry")).toContain(FERRY);
    for (const words of ["BROKEN-A", "BROKEN-B"]) {
      expect(joined(prompt)).not.toContain(words);
      expect(readByHelpers(world, state, [ferry]).join("\n")).not.toContain(words);
    }
    expect(readByHelpers(world, state, [ferry]).join("\n")).toContain(FERRY);
  });

  /** The ferry's mark, and a book a character's card brought holding a copy of the mark's words: both read by the chat. */
  const TWINNED = [bookEntry("b1", "ferry", `${FERRY}\n{{// Secret (known to Marcus): ${DEBT}}}`), bookEntry("b2", "twin", `  ${DEBT}\n`, { comment: "Marina gossip" })];

  test("a twin, an entry whose whole text is a mark's text, reads as the mark: told as the mark is told, and read by no helper", async () => {
    const { world, state } = portAlder();
    const prompt = await promptOf(TWINNED, gateOn(world, state));
    expect(prompt.get("twin")).toContain(DEBT);
    expect(prompt.get("twin")).toContain("Marcus Delgado");
    expect(prompt.get("ferry")).toContain(prompt.get("twin") ?? "never");
    expect(readByHelpers(world, state, TWINNED).join("\n")).not.toContain(DEBT);
  });

  test("a twin is left out with its mark where the view leaves the mark out", async () => {
    const { world, state } = portAlder();
    const prompt = await promptOf(TWINNED, gateOn(world, state, PLAYER_VIEW));
    expect(prompt.has("twin")).toBe(false);
    expect(joined(prompt)).not.toContain(DEBT);
  });
});

describe("what each reader is handed of an entry's marks", () => {
  test("helpers read an entry's public text and never a mark's; the mark is the lore of its holders alone", () => {
    const { world, state } = portAlder();
    const TIPS = "TIPS-MARK: Danny skims the shop's tip jar on Fridays.";
    const ferry = bookEntry("b1", "ferry", `${FERRY}\n{{// Secret (known to Danny Okafor): ${TIPS}}}`);
    expect(readByHelpers(world, state, [ferry]).join("\n")).toBe(`${FERRY}\n`);
    const made = booksAsLore(world, [ferry], []);
    const mark = made.world.lore["book:b1/ferry#1"];
    expect(mark).toMatchObject({ content: TIPS, secret: true, holders: ["danny_okafor"] });
    // A mind of the one who holds it reads it; no other's does.
    expect(loreReadable(registry, made.world, state, mark ?? ({} as never), "brief", false, undefined, "danny_okafor")).toBe(true);
    expect(loreReadable(registry, made.world, state, mark ?? ({} as never), "brief", false, undefined, "priya_nair")).toBe(false);
  });

  /** An earlier build's secret moved to a mark: its whole text wrapped as one mark kept from everyone, its old fields kept beside it (their gate holding), switched on again; and a place entry whose text holds one of Danny's secrets. */
  const migrated = (here: string): HostBookEntry[] => [bookEntry("b1", "boat", `{{// Secret: ${OLD}}}`, { extensions: lreFields({ secret: true, gate: "true", links: [here] }) }), bookEntry("b1", "wall", `${WALL}\n{{// Secret (known to Danny Okafor): ${TUNNEL}}}`, { extensions: lreFields({ links: [here] }) })];

  test("a migrated secret reaches no prompt and no helper under a view that leaves secrets out", async () => {
    const { world, state } = portAlder();
    const entries = migrated(world.start.place);
    const prompt = await promptOf(entries, gateOn(world, state, { knowledge: "scene", secrets: "omit" }));
    expect(prompt.get("wall")).toContain(WALL);
    for (const leak of ["{{//", "｛｛", OLD, TUNNEL]) expect(joined(prompt)).not.toContain(leak);
    expect(prompt.has("boat")).toBe(false);
    const read = readByHelpers(world, state, entries).join("\n");
    expect(read).toContain(WALL);
    for (const leak of [OLD, TUNNEL]) expect(read).not.toContain(leak);
  });

  test("under the default view a migrated secret reaches the narrator marked, still no helper", async () => {
    const { world, state } = portAlder();
    const entries = migrated(world.start.place);
    const prompt = await promptOf(entries, gateOn(world, state));
    expect(prompt.get("boat")).toBe(secretMarkText(OLD, [], "everyone"));
    expect(prompt.get("wall")).toContain(WALL);
    expect(readByHelpers(world, state, entries).join("\n")).not.toContain(OLD);
  });
});

describe("World Info secrecy wherever the entry is read", () => {
  const unreadBy = (world: WorldDoc, state: WorldState, lore: WorldDoc["lore"], text: string): boolean => !Object.values(lore).some((entry) => typeof entry.content === "string" && entry.content.includes(text) && loreReadable(registry, world, state, entry, "brief"));

  test("a world entry with a visibility no reader knows stays unread by every call, whatever its links", () => {
    const { world, state } = portAlder();
    world.lore.rumor = { id: "rumor", title: "Harbor rumor", content: "RUMOR-MARK: the harbor master takes bribes.", keys: ["ferry"], links: [world.start.place], visibility: "secret" } as unknown as WorldDoc["lore"][string];
    const made = booksAsLore(world, [], []);
    expect(unreadBy(made.world, state, made.world.lore, "RUMOR-MARK")).toBe(true);
  });

  test("a Known-by world entry that links nothing stays unread when a book entry of its text links what the player character knows", () => {
    const { world, state } = portAlder();
    world.lore.debt = { id: "debt", title: "The debt", content: DEBT_NOTE, keys: ["ferry"], links: [], visibility: "known_by" };
    const book = bookEntry("b1", "debt", DEBT_NOTE, { extensions: lreFields({ visibility: "known_by", links: [world.start.place] }) });
    const made = booksAsLore(world, [book], []);
    expect(unreadBy(made.world, state, made.world.lore, "DEBT-MARK")).toBe(true);
  });

  test("a Known-by world entry that links nothing stays unread though the book entry it was indexed from links what the player character knows; so does a book entry pinned where the player character is", () => {
    const { world, state } = portAlder();
    world.lore.debt = { id: "debt", title: "The debt", content: DEBT_NOTE, keys: ["ferry"], links: [], visibility: "known_by", source: { kind: "book", bookId: "b1", entryId: "debt", hash: bookTextHash(DEBT_NOTE) } };
    world.lorePins = { characters: {}, places: { [world.start.place]: [{ lore: "debt" }] }, steps: {} };
    const book = bookEntry("b1", "debt", DEBT_NOTE, { extensions: lreFields({ visibility: "known_by", links: [world.start.place] }) });
    const made = booksAsLore(world, [book], []);
    expect(unreadBy(made.world, state, made.world.lore, "DEBT-MARK")).toBe(true);
    // The pin of the copy now names the book entry itself, which reads as Known by too.
    expect(made.world.lorePins?.places[world.start.place]).toEqual([{ book: "b1", entry: "debt" }]);
  });

  test("a World Info entry made secret in Build, whole, reads as secret: no reader has it", () => {
    const { world, state } = portAlder();
    const entry = bookEntry("b1", "wreck", `{{// Secret: ${SECRET}.}}`);
    const made = booksAsLore(world, [entry], []);
    expect(unreadBy(made.world, state, made.world.lore, SECRET)).toBe(true);
  });

  test("a public world entry over a book entry made secret in Build reads as secret", () => {
    const { world, state } = portAlder();
    world.lore.wall = { id: "wall", title: "The harbor wall", content: `${SECRET}.`, keys: [], links: [world.start.place], source: { kind: "book", bookId: "b1", entryId: "wreck", hash: bookTextHash(`${SECRET}.`) } };
    const made = booksAsLore(world, [bookEntry("b1", "wreck", `{{// Secret: ${SECRET}.}}`)], []);
    expect(unreadBy(made.world, state, made.world.lore, SECRET)).toBe(true);
  });

  /** A copy note as an earlier build left it on a twin it switched off: the original it names, the twin on before, no fields of its own. */
  const copyNote = (original: string): JsonObject => ({ [LEDGER_NAMESPACE]: { secretCopyOf: { entry: original, off: false, fields: null } } });

  test("a card's copy of a secret is as secret as its original, wherever the original is: read for it by id; where the original is gone or can't be read, the copy stays secret", async () => {
    const { world, state } = portAlder();
    const original = bookEntry("saga", "wreck", `${SECRET}.`, { disabled: true, extensions: lreFields({ secret: true, gate: "false" }) });
    const copy = bookEntry("card", "copy", `${SECRET}.`, { disabled: true, extensions: copyNote("saga/wreck") });
    const lost = bookEntry("card", "lost", "LOST-COPY: the original is gone.", { disabled: true, extensions: copyNote("gone-book/gone-entry") });
    const third = bookEntry("card", "third", "UNREAD-COPY: the original can't be read.", { disabled: true, extensions: copyNote("saga/unread") });
    const warned: string[] = [];
    const found = await copiedOriginals(
      async (id) => {
        if (id === "unread") throw new Error("the host would not say");
        return id === "wreck" ? original : null;
      },
      [copy, lost, third],
      (message) => warned.push(message),
    );
    expect(found).toEqual([original]);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain("saga/unread");
    const made = booksAsLore(world, [copy, lost, third], found);
    for (const text of [SECRET, "LOST-COPY", "UNREAD-COPY"]) expect(unreadBy(made.world, state, made.world.lore, text)).toBe(true);
    // Without the original read, the copy is a secret no gate opens; with it, the copy holds the original's gate.
    const held = (originals: readonly HostBookEntry[]) => bookSecrecy(copy, secretTexts({ world, entries: [copy, ...originals] }));
    expect(held([])).toEqual({ secret: true, gate: "" });
    expect(held([original])).toEqual({ secret: true, gate: "false" });
    expect(held([{ ...original, extensions: lreFields({ secret: true, gate: "true" }) }])).toEqual({ secret: true, gate: "true" });
  });

  test("an entry holds exactly what its own fields hold: a book entry's lore, held back by its parts", () => {
    const { world } = portAlder();
    const entry = bookEntry("b1", "wreck", `${SECRET}.`, { extensions: lreFields({ secret: true, gate: "false", links: ["somewhere"] }) });
    const [lore] = bookLoreEntries(entry, secrecyParts(entry, secretTexts({ world, entries: [entry] })), world);
    expect(lore).toMatchObject({ id: "book:b1/wreck", content: `${SECRET}.`, secret: true, gate: "false", links: ["somewhere"] });
  });
});

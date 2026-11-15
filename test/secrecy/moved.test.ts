// The secrecy half of the World Info gate gives the answers it gave before it moved (§17.5). What
// `before-the-move.json` holds was recorded from today's code in its old homes (`src/backend/book-lore.ts`,
// `lore-secrets.ts`, `wi-interceptor.ts`, `minds.ts`) on the fixture of this folder, a world's lore and
// books that hold marked text, whole-entry secrets, an earlier build's secret, a twin of a mark and
// copies, one of whose originals is gone and one that can't be read; nothing of it was worked out here.

import { describe, expect, test } from "bun:test";
import type { WorldState } from "../../src/engine/state";
import { SECRET_MARK_WORDING } from "../../src/shared/secret-marks";
import { NARRATOR_DEFAULTS } from "../../src/shared/settings";
import { booksAsLore, entriesRead } from "../../src/secrecy/book-lore";
import { copiedOriginals } from "../../src/secrecy/lore-secrets";
import { knowledgeSwitch } from "../../src/secrecy/knowledge-switch";
import { worldInfoVerdict } from "../../src/secrecy/verdict";
import { startState } from "../packs/support";
import recorded from "./before-the-move.json";
import { books, candidateOf, harbor, readEntry, registry, USER } from "./fixture";

/** The lore and pins of the world as the recorded answer lists them: its entries by id, in id order. */
const sorted = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) as T;

describe("what the books give the world, before and after the move", () => {
  test("booksLore's answer on the fixture: the lore of every entry and mark, the pins of its copies, the entries read, and what was told of an original that couldn't be read", async () => {
    const logs: string[] = [];
    const all = books();
    const read = ["b1", "b2"].flatMap((bookId) => all.filter((e) => e.bookId === bookId));
    const live = entriesRead(read);
    const originals = await copiedOriginals(readEntry, live, (message) => logs.push(message));
    const made = booksAsLore(harbor(), live, originals);
    expect({ lore: sorted(made.world.lore), lorePins: made.world.lorePins, entries: made.entries.map((e) => `${e.bookId}/${e.id}`) }).toEqual({ lore: recorded.booksLore.lore, lorePins: recorded.booksLore.lorePins, entries: recorded.booksLore.entries } as never);
    expect(logs).toEqual([recorded.booksLore.logs[1]]);
  });

  test("copiedOriginals' answer: the original of a copy, wherever it is, read once; one that is gone or can't be read is left out", async () => {
    const warned: string[] = [];
    const found = await copiedOriginals(readEntry, entriesRead(books().filter((e) => e.bookId !== "b3")), (message) => warned.push(message));
    expect(found.map((e) => `${e.bookId}/${e.id}`)).toEqual(recorded.copiedOriginals);
    expect(warned).toEqual([recorded.booksLore.logs[1]]);
  });
});

describe("the verdict on a prompt, before and after the move", () => {
  const candidates = books().map(candidateOf);
  const input = { chatId: "c", userId: USER, chatMetadata: {}, entries: candidates };

  test("with the chat's state unreadable: every marked passage out, every whole-entry secret, twin, copy and earlier build's secret off", async () => {
    const unreadable = { registry, playsWorld: () => true, head: async () => Promise.reject(new Error("no state")), narrator: async () => Promise.reject(new Error("not reached")), log: () => undefined };
    expect(await worldInfoVerdict(unreadable, input)).toEqual(recorded.blind as never);
  });

  test("with the state read, under the default view: each mark told marked, the earlier build's secret and the copies held by their gates", async () => {
    const world = harbor();
    const state: WorldState = startState(world, registry);
    const gate = { registry, playsWorld: () => true, head: async () => ({ world, state }), narrator: async () => ({ view: { ...NARRATOR_DEFAULTS }, wording: SECRET_MARK_WORDING }), log: () => undefined };
    expect(await worldInfoVerdict(gate, input)).toEqual(recorded.open as never);
  });
});

describe("the knowledge switch a turn records, before and after the move", () => {
  const world = harbor();
  /** The chat's state with the minds pack's slice as a chat holds it: no knowledge part (a chat that never held any), or the part a chat that switched it off or set a threshold left. */
  const slice = (knowledge?: Record<string, unknown>): WorldState => ({ ...startState(world, registry), packs: { minds: { round: 0, on: false, chars: {}, presence: [], ...(knowledge === undefined ? {} : { knowledge }) } } }) as unknown as WorldState;

  test("records nothing in a chat that never held knowledge, and nothing while the switch and the threshold stand", () => {
    expect(knowledgeSwitch(slice(), true, 0.7)).toEqual(recorded.knowledgeSwitch.noSlice);
    expect(knowledgeSwitch(slice({}), true, 0.7)).toEqual(recorded.knowledgeSwitch.trackedStays);
    expect(knowledgeSwitch(slice({ off: true }), false, 0.7)).toEqual(recorded.knowledgeSwitch.stillOff);
    expect(knowledgeSwitch(slice({ threshold: 0.7 }), true, 0.7)).toEqual(recorded.knowledgeSwitch.thresholdSame);
    expect(knowledgeSwitch(slice({ off: true, threshold: 0.5 }), false, 0.7)).toEqual(recorded.knowledgeSwitch.thresholdWhileOff);
  });

  test("records the switch turned off, the switch turned on, and its threshold changed", () => {
    expect(knowledgeSwitch(slice({}), false, 0.7)).toEqual(recorded.knowledgeSwitch.turnedOff as never);
    expect(knowledgeSwitch(slice({ off: true }), true, 0.7)).toEqual(recorded.knowledgeSwitch.turnedOn as never);
    expect(knowledgeSwitch(slice({ threshold: 0.5 }), true, 0.7)).toEqual(recorded.knowledgeSwitch.thresholdChanged as never);
    // The three are events of the minds pack's knowledge switch, as before.
    for (const event of [recorded.knowledgeSwitch.turnedOff, recorded.knowledgeSwitch.turnedOn, recorded.knowledgeSwitch.thresholdChanged]) expect(event?.type).toBe("minds.knowledge");
  });
});

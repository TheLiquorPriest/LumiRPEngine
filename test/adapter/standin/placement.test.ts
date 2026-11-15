// Where the stand-in Lumiverse puts lore, what it names it and how it counts it, held to Lumiverse's own source (staging at
// a70f4ed2; paths are Lumiverse's `src/`): every position an entry can take, pinned beside the block of a marker or reached through an
// outlet, an entry an interceptor placed in the history, the label of an entry, and the `{{wi_marker}}` pool and its tokens. Every name is invented.

import { describe, expect, test } from "bun:test";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import type { Entry } from "../../standin/lore";
import { StandIn, type ChatMessage, type Outcome, type Preset } from "../../standin/lumiverse";
import { textOf } from "../../standin/steps";

const USER = "user-weir";
const CHAT = "chat-weir";
const MODEL = "http://127.0.0.1:7896";
const CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };

const HISTORY: ChatMessage[] = [
  { id: "m0", role: "assistant", content: "GREET The weir roars." },
  { id: "m1", role: "user", content: "USER-1 I cross the footbridge." },
  { id: "m2", role: "assistant", content: "REPLY-1 The keeper waves." },
  { id: "m3", role: "user", content: "USER-2 I wave back." },
];

/** A stand-in Lumiverse with the weir's chat and the entries as the character's own book, on a model that answers every request with one line. */
async function weir(blocks: Preset["blocks"], entries: Entry[]): Promise<Outcome> {
  const lv = new StandIn();
  lv.servers.set(MODEL, async (request) => streamedReply(async (out) => out.content("NEW-TEXT the keeper nods."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, keepAlive: null }));
  lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
  lv.presets.set("preset-weir", { id: "preset-weir", name: "Weir", blocks });
  lv.library.addBook({ id: "book-weir", name: "Weir lore", user: USER, entries });
  lv.addChat({ id: CHAT, user: USER, character: { id: "char-keeper", name: "Keeper", extensions: { world_book_ids: ["book-weir"] } }, messages: structuredClone(HISTORY) });
  const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-weir" });
  expect(out.error).toBeNull();
  return out;
}

/** A constant entry named by its id, whose text begins with it. */
const lore = (id: string, extra: Partial<Entry> = {}): Entry => ({ id, book: "book-weir", comment: id, constant: true, content: `${id.toUpperCase()} the lore of ${id}.`, ...extra });
const firstWords = (out: Outcome): string[] => out.prompt.map((m) => textOf(m).split(" ")[0]!);
const worldInfoNames = (out: Outcome): string[] => out.stored!.entries.filter((e) => e.type === "world_info").map((e) => e.name);

const MAIN = { id: "b-main", name: "Main", role: "system" as const, content: "MAIN You narrate a weir." };
const HISTORY_MARKER = { id: "b-history", name: "Chat History", role: "system" as const, content: "", marker: "chat_history" as const };

describe("lore at each of Lumiverse's positions (`services/prompt-assembly.service.ts:3149-3156`, `:3700-3836`; `services/world-info-activation.service.ts:952-1022`)", () => {
  test("lore at each of Lumiverse's positions, pinned beside its marker and through an outlet, placed and named as Lumiverse places and names it", async () => {
    const out = await weir(
      [MAIN, { id: "b-persona", name: "Persona", role: "system", content: "PERSONA-BLOCK who the keeper is.", marker: "persona_description" }, HISTORY_MARKER, { id: "b-post", name: "Post", role: "system", content: "POST {{outlet::Weather}} END" }],
      [
        lore("before", { position: 0 }),
        lore("after", { position: 1 }),
        lore("anbefore", { position: 2 }),
        lore("anafter", { position: 3 }),
        lore("depth", { position: 4, depth: 2 }),
        lore("embefore", { position: 5 }),
        lore("emafter", { position: 6 }),
        lore("pool", { position: 7 }),
        lore("pinbefore", { position: 7, wi_marker: "persona_description", wi_marker_side: "before" }),
        lore("pinafter", { position: 7, wi_marker: "persona_description" }),
        // Reached only through its outlet; another of the same outlet, which sits at its own position as well, joins it by a blank line.
        lore("rain", { position: 8, outlet_name: "weather" }),
        lore("wind", { position: 0, outlet_name: " Weather " }),
        // Position 8 with no outlet is reached by nothing.
        lore("lost", { position: 8 }),
      ],
    );
    // "Before" before the history (the keyword-free outlet entry among them), "AN before" and "EM before" and "EM after" as Lumiverse's quirk of
    // not moving the history's first place after them leaves them, "AN after" after the first history message, the depth entry two from the end
    // of the prompt as it stands, "after" after the history, and the pinned before and after the block that is their marker.
    expect(firstWords(out)).toEqual(["MAIN", "PINBEFORE", "PERSONA-BLOCK", "PINAFTER", "BEFORE", "WIND", "ANBEFORE", "EMBEFORE", "EMAFTER", "GREET", "ANAFTER", "USER-1", "REPLY-1", "USER-2", "DEPTH", "AFTER", "POST"]);
    expect(textOf(out.prompt.at(-1)!)).toBe("POST RAIN the lore of rain.\n\nWIND the lore of wind. END");
    expect(out.prompt.filter((m) => m.__worldInfoSource === true).map((m) => textOf(m).split(" ")[0])).toEqual(["PINBEFORE", "PINAFTER", "BEFORE", "WIND", "ANBEFORE", "EMBEFORE", "EMAFTER", "ANAFTER", "DEPTH", "AFTER"]);
    // Named by the position and the entry's label, in the order the assembly put them in; the pool's entry has no block that asks for it.
    expect(worldInfoNames(out)).toEqual([
      "WI @ persona_description: pinbefore",
      "WI @ persona_description: pinafter",
      "World Info Before (auto): before",
      "World Info Before (auto): wind",
      "World Info After (auto): after",
      "WI AN Before: anbefore",
      "WI AN After: anafter",
      "WI EM Before: embefore",
      "WI EM After: emafter",
      "WI Depth 2: depth",
      "WI At Marker: pool",
    ]);
    // The pool is in no block, so its row is not counted in the total, and the lore sent is counted by its own row.
    const rows = out.stored!.entries;
    expect(out.stored!.totalTokens).toBe(out.stored!.chatHistoryTokens + rows.filter((e) => e.name !== "WI At Marker: pool").reduce((n, e) => n + e.tokens, 0));
  });

  test("a position-7 entry pinned to a marker is spliced beside that block, before or after it, in whatever place the block takes; the markers are the twelve Lumiverse names", async () => {
    const out = await weir(
      [MAIN, { id: "b-hist", name: "History", role: "system", content: "", marker: "chat_history" }, { id: "b-jb", name: "Jailbreak", role: "system", content: "JB Stay in scene.", marker: "jailbreak" }],
      [
        lore("overhistory", { position: 7, wi_marker: "chat_history", wi_marker_side: "before" }),
        lore("underhistory", { position: 7, wi_marker: "chat_history" }),
        lore("beforejb", { position: 7, wi_marker: "jailbreak", wi_marker_side: "before" }),
        lore("afterjb", { position: 7, wi_marker: "jailbreak" }),
        // A marker that is not one of the twelve is no pin: it joins the pool.
        lore("nowhere", { position: 7, wi_marker: "not_a_marker" }),
      ],
    );
    expect(firstWords(out)).toEqual(["MAIN", "OVERHISTORY", "GREET", "USER-1", "REPLY-1", "USER-2", "UNDERHISTORY", "BEFOREJB", "JB", "AFTERJB"]);
    expect(worldInfoNames(out)).toEqual(["WI @ chat_history: overhistory", "WI @ chat_history: underhistory", "WI @ jailbreak: beforejb", "WI @ jailbreak: afterjb", "WI At Marker: nowhere"]);
  });

  test("an entry an interceptor placed in the history leaves its position, counted from the start or the end of the history, named by its keys, primary then secondary", async () => {
    const lv = new StandIn();
    lv.servers.set(MODEL, async (request) => streamedReply(async (out) => out.content("NEW-TEXT the keeper nods."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, keepAlive: null }));
    lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
    lv.presets.set("preset-weir", { id: "preset-weir", name: "Weir", blocks: [MAIN, HISTORY_MARKER] });
    lv.library.addBook({ id: "book-weir", name: "Weir lore", user: USER, entries: [lore("start", { position: 1, keys: [" gate "], keysecondary: ["lock"], comment: "" }), lore("end", { position: 0 })] });
    lv.addChat({ id: CHAT, user: USER, character: { id: "char-keeper", name: "Keeper", extensions: { world_book_ids: ["book-weir"] } }, messages: structuredClone(HISTORY) });
    lv.install(["generation"]).registerWorldInfoInterceptor(async () => ({
      mutated: [
        { id: "start", placement: { type: "chat_depth", role: "assistant", depth: 1, direction: "from_start" } },
        { id: "end", placement: { type: "chat_depth", role: "user", depth: 0, direction: "from_end" } },
      ],
    }), 10);
    const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-weir" });
    expect(out.error).toBeNull();
    // One in from the start (after the greeting), none from the end (after the last message): neither at its own position.
    expect(firstWords(out)).toEqual(["MAIN", "GREET", "START", "USER-1", "REPLY-1", "USER-2", "END"]);
    expect(out.prompt[2]).toMatchObject({ role: "assistant", __worldInfoSource: true });
    expect(out.prompt[6]).toMatchObject({ role: "user", __worldInfoSource: true });
    // The label of a placed entry takes every key, the secondary ones after the primary, each trimmed; placed in the order Lumiverse reverses (an equal order value runs last first).
    expect(worldInfoNames(out)).toEqual(["WI Chat Depth from_end 0: end", "WI Chat Depth from_start 1: gate, lock"]);
  });
});

describe("the label of an entry (`services/world-info-activation.service.ts:1036-1047`)", () => {
  test("an entry with no comment and no primary keys is named by its secondary keys, trimmed", async () => {
    const out = await weir(
      [MAIN, HISTORY_MARKER],
      [
        { id: "e-secondary", book: "book-weir", constant: true, keys: [], keysecondary: ["  moss ", "", "fern  "], content: "SECONDARY the moss and the fern." },
        { id: "e-primary", book: "book-weir", constant: true, keys: [" gate ", "  ", "lock"], keysecondary: ["ignored"], content: "PRIMARY the gate." },
        { id: "e-commented", book: "book-weir", constant: true, comment: "  The keeper  ", keys: ["gate"], content: "COMMENTED the keeper." },
        { id: "e-nothing-at-all", book: "book-weir", constant: true, keys: ["  "], keysecondary: [], content: "NOTHING nothing names it." },
      ],
    );
    expect(worldInfoNames(out)).toEqual(["World Info Before (auto): moss, fern", "World Info Before (auto): gate, lock", "World Info Before (auto): The keeper", "World Info Before (auto): (unnamed entry e-nothin)"]);
  });
});

describe("the `{{wi_marker}}` pool (`macros/definitions/primitives.ts:159-171`; `services/prompt-assembly.service.ts:1500-1533`, `:3600-3615`, `:4241`; `services/tokenizer.service.ts:540-552`)", () => {
  const pooled = (extra: Partial<Entry> = {}): Entry[] => [lore("mist", { position: 7, ...extra }), lore("bell", { position: 7 })];

  test("{{WI_MARKER}} and {{wi_marker::}} expand the pool, and the breakdown counts its rows and the block's wrapper", async () => {
    for (const macro of ["{{wi_marker}}", "{{WI_MARKER}}", "{{wiMarker}}", "{{ wi_marker }}", "{{wi_marker::}}", "{{WI_Marker::ignored}}"]) {
      const out = await weir([MAIN, { id: "b-pool", name: "Pool", role: "system", content: `NOTES what the weir holds:\n${macro}` }, HISTORY_MARKER], pooled());
      const block = out.prompt.find((m) => textOf(m).startsWith("NOTES"))!;
      expect(textOf(block)).toBe("NOTES what the weir holds:\nMIST the lore of mist.\n\nBELL the lore of bell.");
      // The block counts its wrapper alone and each pool row counts, so the total is every row's.
      const rows = out.stored!.entries;
      expect(rows.find((e) => e.blockId === "b-pool")!.tokens).toBe(Math.ceil("NOTES what the weir holds:".length / 4));
      expect(rows.filter((e) => e.name.startsWith("WI At Marker")).map((e) => e.tokens)).toEqual([Math.ceil("MIST the lore of mist.".length / 4), Math.ceil("BELL the lore of bell.".length / 4)]);
      expect(out.stored!.totalTokens).toBe(out.stored!.chatHistoryTokens + rows.reduce((n, e) => n + e.tokens, 0));
    }
  });

  test("with no block that expands the pool its rows are not counted, and a block that holds the macro in a form it does not match is sent as it is", async () => {
    const out = await weir([MAIN, { id: "b-pool", name: "Pool", role: "system", content: "NOTES {{wi-marker}} {{ wi_marker_x }}" }, HISTORY_MARKER], pooled());
    expect(textOf(out.prompt.find((m) => textOf(m).startsWith("NOTES"))!)).toBe("NOTES {{wi-marker}} {{ wi_marker_x }}");
    const rows = out.stored!.entries;
    expect(out.stored!.totalTokens).toBe(out.stored!.chatHistoryTokens + rows.filter((e) => !e.name.startsWith("WI At Marker")).reduce((n, e) => n + e.tokens, 0));
  });

  test("a block placed in the history that expands the pool counts only its wrapper too", async () => {
    const out = await weir([MAIN, HISTORY_MARKER, { id: "b-depth", name: "Depth", role: "system", content: "NOTE {{wi_marker}}", depth: 1 }], pooled());
    const rows = out.stored!.entries;
    expect(rows.find((e) => e.blockId === "b-depth")!.tokens).toBe(Math.ceil("NOTE".length / 4));
    expect(out.stored!.totalTokens).toBe(out.stored!.chatHistoryTokens + rows.reduce((n, e) => n + e.tokens, 0));
  });
});

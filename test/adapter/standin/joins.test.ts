// What Lumiverse joins and places inside its assembly, before any interceptor sees the prompt, held to
// Lumiverse's own source (staging at a70f4ed2; paths are Lumiverse's `src/`): queued sends joined into
// one message, the preset's squash of system messages, system turned into user and names written into
// the text, lore where Lumiverse puts it and inside a block, the numbers Lumiverse stored for each
// message, and a dry run's breakdown. Every name is invented.

import { describe, expect, test } from "bun:test";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import type { PromptMessageDTO } from "../../../src/ext/spindle";
import type { Entry } from "../../standin/lore";
import { StandIn, type ChatMessage, type Outcome, type Preset } from "../../standin/lumiverse";

const USER = "user-saltmarsh";
const CHAT = "chat-saltmarsh";
const MODEL = "http://127.0.0.1:7880";
const CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };

/** The chat so far: Tamsin's greeting, an exchange, then the player's lines from `queued` on, each sent before any reply. */
function marshLines(queued: readonly string[]): ChatMessage[] {
  const lines: ChatMessage[] = [
    { id: "m0", role: "assistant", content: "GREET The ferry bell rings over the marsh." },
    { id: "m1", role: "user", content: "USER-1 I step onto the ferry." },
    { id: "m2", role: "assistant", content: "REPLY-1 Tamsin pushes off from the bank." },
  ];
  queued.forEach((content, k) => lines.push({ id: `m${3 + k}`, role: "user", content }));
  return lines;
}

/** A stand-in Lumiverse with the marsh's chat, its book's entries, on a model that answers every request with one line. */
function marsh(messages: ChatMessage[], preset: Partial<Preset> = {}, books: Entry[] = []): StandIn {
  const lv = new StandIn();
  lv.servers.set(MODEL, async (request) => streamedReply(async (out) => out.content("NEW-TEXT she poles on."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, keepAlive: null }));
  lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
  lv.presets.set("preset-marsh", { id: "preset-marsh", name: "Marsh", blocks: [{ id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a ferry crossing a marsh." }], ...preset });
  lv.addChat({ id: CHAT, user: USER, character: { id: "char-tamsin", name: "Tamsin" }, messages, books });
  return lv;
}

async function generate(lv: StandIn, extra: { dryRun?: boolean } = {}): Promise<Outcome> {
  const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-marsh", ...extra });
  expect(out.error).toBeNull();
  return out;
}

/** What each prompt interceptor call was handed: an extension's interceptor that keeps it and changes nothing. */
function handed(lv: StandIn): PromptMessageDTO[][] {
  const seen: PromptMessageDTO[][] = [];
  lv.install(["interceptor"]).registerInterceptor(async (messages) => {
    seen.push(messages);
    return messages;
  }, {});
  return seen;
}

/** A handed message's text: its text parts run together, as Lumiverse's `getTextContent` reads it (`llm/types.ts:109-115`). */
function textOf(m: { content: unknown }): string {
  if (typeof m.content === "string") return m.content;
  return Array.isArray(m.content) ? m.content.map((p: unknown) => (typeof p === "object" && p !== null && "text" in p ? String(p.text) : "")).join("") : "";
}

/** The chat history the interceptor was handed: each message's source id, its number, and its text. */
function historyHanded(messages: PromptMessageDTO[]): [string | undefined, number | undefined, string][] {
  return messages.filter((m) => m.__isChatHistory === true).map((m) => [m.sourceMessageId, m.sourceIndexInChat, textOf(m)]);
}

describe("queued sends (`services/prompt-assembly.service.ts:3456-3461`, `:6754-6843`)", () => {
  test("two user messages in a row reach the interceptor as one", async () => {
    const lines = marshLines(["QUEUED-1 I ask where we are going.", "QUEUED-2 I ask how long it takes."]);
    // The second queued line carries a picture: Lumiverse puts the pictures of both after the joined text.
    lines[4] = { ...lines[4]!, images: [{ data: "bWFyc2g=", mime_type: "image/png" }] };
    const lv = marsh(lines);
    const seen = handed(lv);
    await generate(lv);
    const history = seen[0]!.filter((m) => m.__isChatHistory === true);
    expect(historyHanded(seen[0]!)).toEqual([
      ["m0", 0, "GREET The ferry bell rings over the marsh."],
      ["m1", 1, "USER-1 I step onto the ferry."],
      ["m2", 2, "REPLY-1 Tamsin pushes off from the bank."],
      ["m3", 3, "QUEUED-1 I ask where we are going.\n\nQUEUED-2 I ask how long it takes."],
    ]);
    expect(history.at(-1)).toMatchObject({ role: "user", content: [{ type: "text", text: "QUEUED-1 I ask where we are going.\n\nQUEUED-2 I ask how long it takes." }, { type: "image", data: "bWFyc2g=", mime_type: "image/png" }] });
    // The second id is gone before any interceptor runs.
    expect(JSON.stringify(seen[0])).not.toContain('"m4"');
  });

  test("a hidden reply between two of the player's lines leaves them joined, the hidden one in neither; a reply shown between them keeps them apart", async () => {
    const asides = (hidden: boolean): ChatMessage[] => {
      const lines = marshLines(["QUEUED-1 I ask where we are going."]);
      lines.push({ id: "m4", role: "assistant", content: "ASIDE Tamsin hums to herself.", ...(hidden ? { hidden } : {}) }, { id: "m5", role: "user", content: "QUEUED-3 I sit on the bench." });
      return lines;
    };
    const hidden = marsh(asides(true));
    const seenHidden = handed(hidden);
    await generate(hidden);
    // Lumiverse skips a hidden message when it builds the history (`:3252`), so the two lines around it are neighbours when it joins.
    expect(historyHanded(seenHidden[0]!).slice(3)).toEqual([["m3", 3, "QUEUED-1 I ask where we are going.\n\nQUEUED-3 I sit on the bench."]]);
    expect(JSON.stringify(seenHidden[0])).not.toContain("ASIDE");

    const shown = marsh(asides(false));
    const seenShown = handed(shown);
    await generate(shown);
    expect(historyHanded(seenShown[0]!).slice(3)).toEqual([
      ["m3", 3, "QUEUED-1 I ask where we are going."],
      ["m4", 4, "ASIDE Tamsin hums to herself."],
      ["m5", 5, "QUEUED-3 I sit on the bench."],
    ]);
  });
});

describe("the preset's completion settings, inside the assembly (`services/prompt-assembly.service.ts:4210`, `:7129-7231`)", () => {
  /** A preset of two system blocks and a note one message into the history, with a prefill, over two queued lines. */
  const COMPLETION: Partial<Preset> = {
    blocks: [
      { id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a ferry crossing a marsh." },
      { id: "b-style", name: "Style", role: "system", content: "STYLE Keep replies short." },
      { id: "b-depth", name: "Fog", role: "system", content: "DEPTH-NOTE The fog thickens.", depth: 1 },
    ],
    assistantPrefill: "PREFILL Tamsin",
  };
  const QUEUED = ["QUEUED-1 I ask where we are going.", "QUEUED-2 I ask how long it takes."];

  /** What the interceptor was handed, as each message's role and text. */
  async function handedWith(settings: Partial<Preset>): Promise<PromptMessageDTO[]> {
    const lv = marsh(marshLines(QUEUED), { ...COMPLETION, ...settings });
    const seen = handed(lv);
    await generate(lv);
    return seen[0]!;
  }
  const shape = (messages: PromptMessageDTO[]): [string, string][] => messages.map((m) => [m.role, textOf(m)]);

  test("squashed system messages, names in content, system as user", async () => {
    // Squashed: the second block joins the first; the note does not, as the history before it began as no system message.
    expect(shape(await handedWith({ squashSystemMessages: true }))).toEqual([
      ["system", "MAIN You narrate a ferry crossing a marsh.\n\nSTYLE Keep replies short."],
      ["assistant", "GREET The ferry bell rings over the marsh."],
      ["user", "USER-1 I step onto the ferry."],
      ["assistant", "REPLY-1 Tamsin pushes off from the bank."],
      ["system", "DEPTH-NOTE The fog thickens."],
      ["user", `${QUEUED[0]}\n\n${QUEUED[1]}`],
      ["assistant", "PREFILL Tamsin"],
    ]);

    // All three: system goes as the user's, each user and assistant message starts with its speaker's name (the prefill too, and
    // the joined queued lines once), and a block that joins another brings no name of its own.
    const all = await handedWith({ squashSystemMessages: true, useSystemPrompt: false, namesBehavior: 2 });
    expect(shape(all)).toEqual([
      ["user", "User: MAIN You narrate a ferry crossing a marsh.\n\nSTYLE Keep replies short."],
      ["assistant", "Tamsin: GREET The ferry bell rings over the marsh."],
      ["user", "User: USER-1 I step onto the ferry."],
      ["assistant", "Tamsin: REPLY-1 Tamsin pushes off from the bank."],
      ["user", "User: DEPTH-NOTE The fog thickens."],
      ["user", `User: ${QUEUED[0]}\n\n${QUEUED[1]}`],
      ["assistant", "Tamsin: PREFILL Tamsin"],
    ]);
    // The history keeps its flags and sources under its names.
    expect(historyHanded(all).map(([id, index]) => [id, index])).toEqual([["m0", 0], ["m1", 1], ["m2", 2], ["m3", 3]]);

    // Names beside the message (1) leave its text as it is.
    const beside = await handedWith({ namesBehavior: 1 });
    expect(beside.filter((m) => m.role !== "system").map((m) => [m.role, m.name, textOf(m)])).toEqual([
      ["assistant", "Tamsin", "GREET The ferry bell rings over the marsh."],
      ["user", "User", "USER-1 I step onto the ferry."],
      ["assistant", "Tamsin", "REPLY-1 Tamsin pushes off from the bank."],
      ["user", "User", `${QUEUED[0]}\n\n${QUEUED[1]}`],
      ["assistant", "Tamsin", "PREFILL Tamsin"],
    ]);
  });

  test("every system message, the continue nudge and lore among them, reaches the interceptor with _fromSystem true", async () => {
    // Lumiverse tags each system message inside `applyCompletionSettings` (`:7187`), whatever the preset sets, and hands a message that is
    // not history to the interceptor as it is (`spindle/worker-host.ts:3188`). A continue brings its nudge; a constant entry its lore.
    const ferry: Entry = { id: "e-ferry", book: "book-marsh", comment: "The ferry", constant: true, content: "FERRY-LORE The ferry runs at dawn." };
    for (const settings of [{}, { useSystemPrompt: false }] satisfies Partial<Preset>[]) {
      const lv = marsh(marshLines([]), settings, [ferry]);
      const seen = handed(lv);
      const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-marsh", type: "continue" });
      expect(out.error).toBeNull();
      const tagged = seen[0]!.map((m) => [textOf(m).split(" ")[0], "_fromSystem" in m && m._fromSystem === true]);
      // Sent as the user's or not, a message that began as a system message keeps the tag; the history never has it.
      expect(tagged).toEqual([["MAIN", true], ["FERRY-LORE", true], ["GREET", false], ["USER-1", false], ["REPLY-1", false], ["[Continue", true]]);
    }
  });
});

describe("lore where Lumiverse puts it (`services/prompt-assembly.service.ts:3491-3561`, `:3728-3756`, `:3838-3847`)", () => {
  const MAIN = { id: "b-main", name: "Main", role: "system" as const, content: "MAIN You narrate a ferry crossing a marsh." };
  const POST = { id: "b-post", name: "Post", role: "system" as const, content: "POST Stay in the scene." };
  /** A "before" marker, a block that takes the "at marker" lore, the history's own marker, and a block after the history. */
  const MARKED: Partial<Preset> = {
    blocks: [
      MAIN,
      { id: "b-wib", name: "World Info (before)", role: "system", content: "", marker: "world_info_before" },
      { id: "b-lore", name: "Marsh lore", role: "system", content: "LORE-NOTES What the marsh holds:\n{{wi_marker}}" },
      { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" },
      POST,
    ],
  };
  /** The book: one entry of each position, the "at marker" two (one activated by its key, named by it, as it has no title). */
  function book(marks = false): Entry[] {
    const mark = (secret: string): string => (marks ? `\n{{// Secret: ${secret}}}` : "");
    return [
      { id: "e-ferry", book: "book-marsh", comment: "The ferry", constant: true, content: `FERRY-LORE The ferry runs at dawn.${mark("FERRY-SECRET Tamsin smuggles eels.")}` },
      { id: "e-reeds", book: "book-marsh", comment: "Reeds", constant: true, position: 1, content: `REEDS-LORE The reeds hide the channel.${mark("REEDS-SECRET The channel is staked.")}` },
      { id: "e-bell", book: "book-marsh", keys: ["bell"], position: 7, content: `BELL-LORE The bell rings at the tide.${mark("BELL-SECRET The bell is cracked.")}` },
      { id: "e-mist", book: "book-marsh", comment: "Mist", constant: true, position: 7, content: "MIST-LORE Mist rolls in at dusk." },
    ];
  }

  /** The prompt the interceptor was handed: each message's first word, and whether it is flagged as lore. */
  async function placed(preset: Partial<Preset>, entries: Entry[]): Promise<{ handed: [string, boolean][]; out: Outcome; texts: string[] }> {
    const lv = marsh(marshLines([]), preset, entries);
    const seen = handed(lv);
    const out = await generate(lv);
    return { handed: seen[0]!.map((m) => [textOf(m).split(" ")[0]!, m.__isWorldInfoEntry === true]), out, texts: seen[0]!.map((m) => textOf(m)) };
  }
  const HISTORY: [string, boolean][] = [["GREET", false], ["USER-1", false], ["REPLY-1", false]];

  test("lore at its markers, after the history, and inside a block", async () => {
    const marked = await placed(MARKED, book());
    // "Before" at its marker, the "at marker" pool inside the block that asks for it with no flag of its own, "after" (no marker for
    // it) just after the history.
    expect(marked.handed).toEqual([["MAIN", false], ["FERRY-LORE", true], ["LORE-NOTES", false], ...HISTORY, ["REEDS-LORE", true], ["POST", false]]);
    expect(marked.texts[2]).toBe("LORE-NOTES What the marsh holds:\nBELL-LORE The bell rings at the tide.\n\nMIST-LORE Mist rolls in at dusk.");
    // Named as Lumiverse names them, the block with its id and the lore by position and label with none; the pool's tokens are the block's.
    const stored = marked.out.stored!;
    expect(stored.entries.map((e) => [e.type, e.name, e.blockId ?? null])).toEqual([
      ["block", "Main", "b-main"],
      ["world_info", "World Info Before: The ferry", null],
      ["block", "Marsh lore", "b-lore"],
      ["block", "Post", "b-post"],
      ["world_info", "World Info After (auto): Reeds", null],
      ["world_info", "WI At Marker: bell", null],
      ["world_info", "WI At Marker: Mist", null],
    ]);
    expect(stored.totalTokens).toBe(stored.chatHistoryTokens + stored.entries.filter((e) => !e.name.startsWith("WI At Marker")).reduce((n, e) => n + e.tokens, 0));

    // No markers: "before" just before the history, "after" just after it.
    const unmarked = await placed({ blocks: [MAIN, POST] }, book());
    expect(unmarked.handed).toEqual([["MAIN", false], ["POST", false], ["FERRY-LORE", true], ...HISTORY, ["REEDS-LORE", true]]);
    expect(unmarked.out.stored!.entries.filter((e) => e.type === "world_info").map((e) => e.name)).toEqual(["World Info Before (auto): The ferry", "World Info After (auto): Reeds", "WI At Marker: bell", "WI At Marker: Mist"]);

    // An "after" marker placed in the history: its lore spliced one history message from the end, still flagged.
    const inHistory = await placed({ blocks: [MAIN, { id: "b-wia", name: "World Info (after)", role: "system", content: "", marker: "world_info_after", depth: 1 }] }, book());
    expect(inHistory.handed).toEqual([["MAIN", false], ["FERRY-LORE", true], ["GREET", false], ["USER-1", false], ["REEDS-LORE", true], ["REPLY-1", false]]);
    expect(inHistory.out.stored!.entries.filter((e) => e.type === "world_info").map((e) => [e.name, e.blockId ?? null])).toContainEqual(["World Info After: Reeds", null]);
  });

  test("a lone secret mark is stripped wherever lore is placed, and its words still activate the entry", async () => {
    // An entry that is nothing but a mark, activated by a word the player wrote: Lumiverse's scan reads the chat's raw text.
    const wreck: Entry = { id: "e-wreck", book: "book-marsh", keys: ["wreck"], content: "{{// Secret: WRECK-SECRET The wreck holds the mayor's letters.}}" };
    const lines = marshLines(["USER-2 I point at the wreck."]);
    for (const preset of [MARKED, { blocks: [MAIN, { id: "b-wia", name: "World Info (after)", role: "system" as const, content: "", marker: "world_info_after" as const, depth: 1 }] }]) {
      const lv = marsh(structuredClone(lines), preset, [...book(true), wreck]);
      const contexts: unknown[] = [];
      const seen: PromptMessageDTO[][] = [];
      lv.install(["interceptor"]).registerInterceptor(async (messages, context) => {
        seen.push(messages);
        contexts.push(context);
        return messages;
      }, {});
      const out = await generate(lv);
      const handedText = seen[0]!.map((m) => textOf(m)).join("\n");
      const sentText = out.prompt.map((m) => (typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "")).join(""))).join("\n");
      for (const text of [handedText, sentText]) {
        for (const kept of ["FERRY-LORE", "REEDS-LORE"]) expect(text).toContain(kept);
        expect(text).not.toContain("SECRET");
        expect(text).not.toContain("{{//");
      }
      // Placed nowhere, as its text is empty once the mark is stripped, and activated all the same.
      expect(contexts[0]).toMatchObject({ activatedWorldInfo: expect.arrayContaining([expect.objectContaining({ id: "e-wreck" })]) });
    }
  });
});

describe("the numbers Lumiverse stored (`services/prompt-assembly.service.ts:229-231`, `:2304`; `services/chats.service.ts:2642-2647`, `:3236-3240`)", () => {
  test("a delete leaves a gap in the numbers", async () => {
    const lv = marsh(marshLines([]));
    lv.deleteMessage(CHAT, "m1");
    const asked = lv.send(CHAT, "USER-2 I hold on to the rail.");
    const contexts: unknown[] = [];
    const seen: PromptMessageDTO[][] = [];
    const ext = lv.install(["interceptor", "generation"]);
    ext.registerWorldInfoInterceptor(async (ctx) => {
      contexts.push(ctx);
      return { disabled: [], enabled: [], mutated: [] };
    });
    ext.registerInterceptor(async (messages) => {
      seen.push(messages);
      return messages;
    }, {});
    await generate(lv);
    // The message made after the delete is numbered one past the highest; nothing is numbered again.
    const expected: [string, number][] = [["m0", 0], ["m2", 2], [asked, 3]];
    expect(historyHanded(seen[0]!).map(([id, index]) => [id, index])).toEqual(expected);
    expect(contexts[0]).toMatchObject({ messages: expected.map(([id, index]) => ({ id, index_in_chat: index })) });

    // The reply was made as number 4; deleted, it leaves the chat's highest at 3, so the next message made takes 4 again.
    const reply = lv.chats.get(CHAT)!.messages.at(-1)!;
    expect(reply.index).toBe(4);
    lv.deleteMessage(CHAT, reply.id);
    const again = lv.send(CHAT, "USER-3 I let go of the rail.");
    expect(lv.rowsOf(CHAT)).toEqual([
      { id: "m0", index: 0, hidden: false },
      { id: "m2", index: 2, hidden: false },
      { id: asked, index: 3, hidden: false },
      { id: again, index: 4, hidden: false },
    ]);
  });
});

describe("a dry run (`services/generate.service.ts:3080-3274`)", () => {
  test("a dry run gives the breakdown its assembly made", async () => {
    const preset: Partial<Preset> = {
      blocks: [
        { id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a ferry crossing a marsh." },
        { id: "b-wib", name: "World Info (before)", role: "system", content: "", marker: "world_info_before" },
        { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" },
        { id: "b-depth", name: "Fog", role: "system", content: "DEPTH-NOTE The fog thickens.", depth: 1 },
      ],
      assistantPrefill: "PREFILL Tamsin",
    };
    const ferry: Entry = { id: "e-ferry", book: "book-marsh", comment: "The ferry", constant: true, content: "FERRY-LORE The ferry runs at dawn." };
    const lv = marsh(marshLines([]), preset, [ferry]);
    const dry = await generate(lv, { dryRun: true });
    // Its entries as the assembly made them, the chat history's left out; and nothing saved or stored.
    expect(dry.breakdown!.map((e) => [e.type, e.name, e.blockId ?? null, e.content ?? null])).toEqual([
      ["block", "Main", "b-main", "MAIN You narrate a ferry crossing a marsh."],
      ["world_info", "World Info Before: The ferry", null, "FERRY-LORE The ferry runs at dawn."],
      ["block", "Fog", "b-depth", "DEPTH-NOTE The fog thickens."],
      ["utility", "Assistant Prefill", null, "PREFILL Tamsin"],
    ]);
    expect([dry.generationId, dry.stored, lv.stored.size, lv.chats.get(CHAT)!.messages.length]).toEqual([null, null, 0, 3]);
    // The same entries a generation of the same prompt stores beside its reply.
    const out = await generate(lv);
    expect(out.breakdown).toBeUndefined();
    expect(out.stored!.entries.map((e) => [e.type, e.name])).toEqual(dry.breakdown!.map((e) => [e.type, e.name]));
  });
});

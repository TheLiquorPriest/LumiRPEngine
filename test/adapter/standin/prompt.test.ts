// The end of the prompt as the stand-in Lumiverse sends it, held to Lumiverse's own source (staging at
// a70f4ed2; paths are Lumiverse's `src/`): the prefill, which message a continue goes on, how its message
// is moved and joined, and how a continue is announced and handed to the interceptors. Every name is
// invented.

import { describe, expect, test } from "bun:test";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import type { PromptMessageDTO } from "../../../src/ext/spindle";
import type { Block } from "../../standin/assembly";
import { StandIn, type ChatMessage, type GenerateInput, type Outcome, type Preset } from "../../standin/lumiverse";
import { textOf } from "../../standin/steps";

const USER = "user-quay";
const CHAT = "chat-quay";
const MODEL = "http://127.0.0.1:7870";
const CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };

/** The chat so far: ending on Oona's reply, or with `asked` on the player's line after it. */
function quayLines(asked = false): ChatMessage[] {
  const lines: ChatMessage[] = [
    { id: "m0", role: "assistant", content: "GREET The lamps along the quay are lit." },
    { id: "m1", role: "user", content: "USER-1 I walk to the end of the quay." },
    { id: "m2", role: "assistant", content: "REPLY-1 Oona is coiling rope." },
  ];
  if (asked) lines.push({ id: "m3", role: "user", content: "USER-2 I ask her about the boat." });
  return lines;
}

/** A stand-in Lumiverse with the quay's chat on a model that answers every request with one line. */
function quay(messages: ChatMessage[], preset: Partial<Preset> = {}, metadata: Record<string, unknown> = {}): StandIn {
  const lv = new StandIn();
  lv.servers.set(MODEL, async (request) => streamedReply(async (out) => out.content("NEW-TEXT she says."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, turn: false }));
  lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
  lv.presets.set("preset-quay", { id: "preset-quay", name: "Quay", blocks: [{ id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a quay at dusk." }, { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" }], ...preset });
  lv.addChat({ id: CHAT, user: USER, character: { id: "char-oona", name: "Oona" }, messages, metadata });
  return lv;
}

async function generate(lv: StandIn, type: "normal" | "swipe" | "regenerate" | "continue" | "impersonate", message?: string): Promise<Outcome> {
  const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-quay", type, ...(message !== undefined ? { message } : {}) });
  expect(out.error).toBeNull();
  return out;
}

/** A message's text in the chat now. */
const textNow = (lv: StandIn, id: string): string | undefined => lv.chats.get(CHAT)!.messages.find((m) => m.id === id)?.content;

/** What each prompt interceptor call was handed: an extension's interceptor that keeps it and changes nothing. */
function handed(lv: StandIn): PromptMessageDTO[][] {
  const seen: PromptMessageDTO[][] = [];
  lv.install(["interceptor"]).registerInterceptor(async (messages) => {
    seen.push(messages);
    return messages;
  }, {});
  return seen;
}

/** The last `n` messages of the prompt as Lumiverse finished it: role, text, and whether it is a partial reply. */
function ending(out: Outcome, n: number): [string, string, boolean][] {
  return out.prompt.slice(-n).map((m) => [m.role, textOf(m), m.partial === true]);
}

/** The utility entries of what Lumiverse stored beside the reply (`services/prompt-assembly.service.ts:4193-4198`, `:4330-4335`). */
function utilities(out: Outcome): [string, string | undefined, string | undefined][] {
  return out.stored!.entries.filter((e) => e.type === "utility").map((e) => [e.name, e.role, e.content]);
}

const PREFILL = "PREFILL Oona looks up and";

describe("the prefill as Lumiverse sends it (`services/prompt-assembly.service.ts:4120-4198`)", () => {
  test.each(["normal", "swipe", "regenerate"] as const)("a %s ends on the preset's prefill, one partial assistant message, recorded as the Assistant Prefill", async (kind) => {
    const out = await generate(quay(quayLines(kind === "normal"), { assistantPrefill: PREFILL }), kind);
    // A swipe and a regenerate leave out the reply they replace; a new reply follows the player's line.
    expect(ending(out, 2)).toEqual([kind === "normal" ? ["user", "USER-2 I ask her about the boat.", false] : ["user", "USER-1 I walk to the end of the quay.", false], ["assistant", PREFILL, true]]);
    expect(utilities(out)).toEqual([["Assistant Prefill", "assistant", PREFILL]]);
  });

  test("a continue has none: the message it goes on is its start (`:4140`, `:4154`)", async () => {
    const out = await generate(quay(quayLines(), { assistantPrefill: PREFILL }), "continue");
    expect(out.prompt.some((m) => textOf(m).includes("PREFILL"))).toBe(false);
    expect(utilities(out).map(([name]) => name)).not.toContain("Assistant Prefill");
  });

  test("an impersonation has one only with Continue prefill on, and then the preset's impersonation start where it sets one (`:4126-4128`, `:4153-4158`)", async () => {
    const off = await generate(quay(quayLines(), { assistantPrefill: PREFILL, assistantImpersonation: "IMPERSONATE I lean on the rail and" }), "impersonate");
    expect(off.prompt.some((m) => m.partial === true)).toBe(false);
    expect(utilities(off)).toEqual([["Impersonation Prompt", "user", IMPERSONATION]]);

    const prefilled = await generate(quay(quayLines(), { assistantPrefill: PREFILL, continuePrefill: true }), "impersonate");
    expect(ending(prefilled, 2)).toEqual([["system", IMPERSONATION, false], ["assistant", PREFILL, true]]);

    const own = await generate(quay(quayLines(), { assistantPrefill: PREFILL, assistantImpersonation: "IMPERSONATE I lean on the rail and", continuePrefill: true }), "impersonate");
    expect(ending(own, 1)).toEqual([["assistant", "IMPERSONATE I lean on the rail and", true]]);
    expect(utilities(own)).toEqual([["Impersonation Prompt", "system", IMPERSONATION], ["Assistant Prefill", "assistant", "IMPERSONATE I lean on the rail and"]]);
  });

  test("the user's Start Reply With comes first and the preset's prefill after it, in one message; a connection's own takes its place, an empty one too (`:4130-4151`)", async () => {
    const lv = quay(quayLines(true), { assistantPrefill: PREFILL });
    lv.promptBias = "BIAS Softly, ";
    expect(ending(await generate(lv, "normal"), 1)).toEqual([["assistant", `BIAS Softly, ${PREFILL}`, true]]);

    lv.connections.set("conn-model", { ...lv.connections.get("conn-model")!, metadata: { reasoningBindings: { promptBias: "BOUND Quietly, " } } });
    expect(ending(await generate(lv, "normal"), 1)).toEqual([["assistant", `BOUND Quietly, ${PREFILL}`, true]]);

    lv.connections.set("conn-model", { ...lv.connections.get("conn-model")!, metadata: { reasoningBindings: { promptBias: "" } } });
    expect(ending(await generate(lv, "normal"), 1)).toEqual([["assistant", PREFILL, true]]);
  });

  test("with both empty, nothing is sent: no partial message ends the prompt, and none is recorded (`:4159-4162`, `:4183`)", async () => {
    const lv = quay(quayLines(true), { assistantPrefill: "" });
    // Only blank, the user's setting is not used either (`:4141-4143`).
    lv.promptBias = "   ";
    const out = await generate(lv, "normal");
    expect(ending(out, 1)).toEqual([["user", "USER-2 I ask her about the boat.", false]]);
    expect(out.prompt.some((m) => m.partial === true)).toBe(false);
    expect((out.body!.messages as { role: string }[]).at(-1)!.role).toBe("user");
    expect(utilities(out)).toEqual([]);
  });
});

/** Lumiverse's own continue nudge (`services/prompt-behavior.ts:10`). */
const NUDGE = "[Continue your last message without repeating its original content.]";

describe("a continue, as Lumiverse picks its message and makes its prompt", () => {
  test("a continue goes on the message named or the last non-user message, never a user's (`services/generate.service.ts:1809-1814`)", async () => {
    // Ending on Oona's reply: the page names it.
    const own = quay(quayLines(), { continuePostfix: " " });
    await generate(own, "continue");
    expect(textNow(own, "m2")).toBe("REPLY-1 Oona is coiling rope. NEW-TEXT she says.");
    expect(own.events.find((e) => e.event === "GENERATION_ENDED")!.payload).toMatchObject({ messageId: "m2" });

    // Ending on the player's line: the page names nothing, and Lumiverse goes on with the last message that is not the user's.
    const asked = quay(quayLines(true), { continuePostfix: " " });
    await generate(asked, "continue");
    expect([textNow(asked, "m2"), textNow(asked, "m3")]).toEqual(["REPLY-1 Oona is coiling rope. NEW-TEXT she says.", "USER-2 I ask her about the boat."]);

    // A hidden one is that message all the same (`services/chats.service.ts:2066-2072`), though no prompt holds its text: nothing is moved.
    const hidden = quay([...quayLines().slice(0, 2), { id: "m2", role: "assistant", content: "ASIDE Oona mutters to herself.", hidden: true }, { id: "m3", role: "user", content: "USER-2 I ask her about the boat." }], { continuePostfix: " " });
    const unmoved = await generate(hidden, "continue");
    expect(textNow(hidden, "m2")).toBe("ASIDE Oona mutters to herself. NEW-TEXT she says.");
    expect(ending(unmoved, 2)).toEqual([["user", "USER-1 I walk to the end of the quay.\n\nUSER-2 I ask her about the boat.", false], ["system", NUDGE, false]]);
    expect(utilities(unmoved).map(([name]) => name)).not.toContain("Continue Target");

    // A message the caller names: an earlier reply of Oona's.
    const earlier = quay(quayLines(), { continuePostfix: " " });
    await generate(earlier, "continue", "m0");
    expect([textNow(earlier, "m0"), textNow(earlier, "m2")]).toEqual(["GREET The lamps along the quay are lit. NEW-TEXT she says.", "REPLY-1 Oona is coiling rope."]);

    // A user's message named: Lumiverse goes on with no message. Its prompt still ends on the newest reply, moved, with no postfix, and
    // the reply is saved as a message of its own (`services/prompt-assembly.service.ts:752`, `services/generate.service.ts:4172-4194`).
    const users = quay(quayLines(), { continuePostfix: " " });
    const none = await generate(users, "continue", "m1");
    expect(textNow(users, "m1")).toBe("USER-1 I walk to the end of the quay.");
    expect(textNow(users, "m2")).toBe("REPLY-1 Oona is coiling rope.");
    expect(users.chats.get(CHAT)!.messages.slice(3).map((m) => [m.role, m.content])).toEqual([["assistant", "NEW-TEXT she says."]]);
    expect(ending(none, 2)).toEqual([["assistant", "REPLY-1 Oona is coiling rope.", false], ["system", NUDGE, false]]);
  });

  test("a continue moves its message to the end, with no source key: out of the history, its postfix on it, the nudge after it (`services/prompt-assembly.service.ts:742-775`, `spindle/source-message-metadata.ts:77-106`)", async () => {
    const lv = quay(quayLines(true), { continuePostfix: " " });
    const seen = handed(lv);
    const out = await generate(lv, "continue");
    const given = seen[0]!;
    expect(given.slice(-2).map((m) => [m.role, m.content])).toEqual([
      ["assistant", "REPLY-1 Oona is coiling rope. "],
      ["system", NUDGE],
    ]);
    // The interceptor is handed the moved message with neither the history mark nor any source key: Lumiverse puts them back only on
    // history before each interceptor (`spindle/interceptor-pipeline.ts:110`, `:149`).
    const moved = given.at(-2)! as unknown as Record<string, unknown>;
    for (const key of ["__isChatHistory", "sourceMessageId", "sourceIndexInChat", "__chatHistorySource", "__sourceMessageId", "__sourceIndexInChat"]) expect(moved).not.toHaveProperty(key);
    expect(given.filter((m) => m.__isChatHistory === true).map((m) => m.sourceMessageId)).toEqual(["m0", "m1", "m3"]);
    expect(ending(out, 2)).toEqual([
      ["assistant", "REPLY-1 Oona is coiling rope. ", false],
      ["system", NUDGE, false],
    ]);
    expect(utilities(out)).toEqual([
      ["Continue Nudge", "system", NUDGE],
      ["Continue Target", "assistant", "REPLY-1 Oona is coiling rope. "],
    ]);

    // With "Continue prefill" on, the moved message is the reply to go on with: partial, last, and no nudge.
    const prefilled = await generate(quay(quayLines(true), { continuePostfix: " ", continuePrefill: true }), "continue");
    expect(ending(prefilled, 2)).toEqual([
      ["user", "USER-2 I ask her about the boat.", false],
      ["assistant", "REPLY-1 Oona is coiling rope. ", true],
    ]);
    expect(utilities(prefilled)).toEqual([["Continue Target", "assistant", "REPLY-1 Oona is coiling rope. "]]);

    // The preset's own nudge, or none where it sets an empty one.
    expect(ending(await generate(quay(quayLines(true), { continuePostfix: " ", continueNudge: "NUDGE Go on from there." }), "continue"), 1)).toEqual([["system", "NUDGE Go on from there.", false]]);
    expect(ending(await generate(quay(quayLines(true), { continuePostfix: " ", continueNudge: "" }), "continue"), 1)).toEqual([["assistant", "REPLY-1 Oona is coiling rope. ", false]]);
  });

  test("no postfix unless the preset has one: the same in the prompt and in the saved join (`services/generate.service.ts:1969-1978`, `services/prompt-assembly.service.ts:662-670`)", async () => {
    // A preset that sets none: nothing between the text and the new text, and nothing after the moved message.
    const bare = quay(quayLines());
    const none = await generate(bare, "continue");
    expect(ending(none, 2)[0]).toEqual(["assistant", "REPLY-1 Oona is coiling rope.", false]);
    expect(textNow(bare, "m2")).toBe("REPLY-1 Oona is coiling rope.NEW-TEXT she says.");

    // A preset's own postfix, on both.
    const parted = quay(quayLines(), { continuePostfix: "\n\n" });
    const own = await generate(parted, "continue");
    expect(ending(own, 2)[0]).toEqual(["assistant", "REPLY-1 Oona is coiling rope.\n\n", false]);
    expect(textNow(parted, "m2")).toBe("REPLY-1 Oona is coiling rope.\n\nNEW-TEXT she says.");

    // A text that already ends with it gets it on neither.
    const spaced = quay([...quayLines().slice(0, 2), { id: "m2", role: "assistant", content: "REPLY-1 Oona is coiling rope. " }], { continuePostfix: " " });
    const ended = await generate(spaced, "continue");
    expect(ending(ended, 2)[0]).toEqual(["assistant", "REPLY-1 Oona is coiling rope. ", false]);
    expect(textNow(spaced, "m2")).toBe("REPLY-1 Oona is coiling rope. NEW-TEXT she says.");
  });
});

/** The source keys a prompt interceptor could name a message by (`spindle/worker-host.ts:3189-3197`, `spindle/source-message-metadata.ts:1-4`). */
const SOURCE_KEYS = ["__isChatHistory", "sourceMessageId", "sourceIndexInChat", "__chatHistorySource", "__sourceMessageId", "__sourceIndexInChat"];

describe("a continue, as Lumiverse announces it and hands it to the extensions", () => {
  test("an interceptor is handed a continue's moved message with no source key to name it by (`spindle/worker-host.ts:3189-3197`, `spindle/source-message-metadata.ts:1-4`); its start event names only its swipe, the page sends the last non-user message", async () => {
    // The greeting is the chat's first message, and Oona's reply shows its second swipe.
    const lines: ChatMessage[] = [{ ...quayLines()[0]!, greeting: 0 }, quayLines()[1]!, { ...quayLines()[2]!, swipeId: 1 }];
    const lv = quay(lines);
    const seen = handed(lv);
    const told: unknown[] = [];
    lv.install(["generation"]).registerWorldInfoInterceptor(async (ctx) => {
      told.push(ctx);
      return {};
    });
    // Nothing named: the page names the chat's last message, which is not the player's, and Lumiverse goes on with it.
    await generate(lv, "continue");
    expect(textNow(lv, "m2")).toBe("REPLY-1 Oona is coiling rope.NEW-TEXT she says.");
    const started = lv.events.find((e) => e.event === "GENERATION_STARTED")!.payload as Record<string, unknown>;
    expect(started).toMatchObject({ generationType: "continue", targetSwipeId: 1, characterId: "char-oona", characterName: "Oona" });
    expect(started.targetMessageId).toBeUndefined();
    // Nothing the prompt interceptor is handed names the moved message: its text alone, last but the nudge.
    const moved = seen[0]!.at(-2)! as unknown as Record<string, unknown>;
    expect([moved.role, moved.content]).toEqual(["assistant", "REPLY-1 Oona is coiling rope."]);
    for (const key of SOURCE_KEYS) expect(moved).not.toHaveProperty(key);
    // The World Info interceptor is told the chat's messages as Lumiverse tells them, each with its text, its place and the swipe it
    // shows, the greeting marked (`services/prompt-assembly.service.ts:2289-2305`).
    expect((told[0] as { messages: unknown[] }).messages).toEqual([
      { id: "m0", role: "assistant", content: "GREET The lamps along the quay are lit.", is_user: false, is_greeting: true, greeting_index: 0, swipe_id: 0, index_in_chat: 0 },
      { id: "m1", role: "user", content: "USER-1 I walk to the end of the quay.", is_user: true, is_greeting: false, swipe_id: 0, index_in_chat: 1 },
      { id: "m2", role: "assistant", content: "REPLY-1 Oona is coiling rope.", is_user: false, is_greeting: false, swipe_id: 1, index_in_chat: 2 },
    ]);

    // A message another caller names: its swipe is the one announced, and still no message.
    const named = quay([{ ...quayLines()[0]!, swipeId: 2 }, ...quayLines().slice(1)]);
    await generate(named, "continue", "m0");
    const announced = named.events.find((e) => e.event === "GENERATION_STARTED")!.payload as Record<string, unknown>;
    expect([announced.targetMessageId, announced.targetSwipeId]).toEqual([undefined, 2]);
    expect(textNow(named, "m0")).toBe("GREET The lamps along the quay are lit.NEW-TEXT she says.");

    // An impersonation is announced with neither (`:2040-2055`: nothing sets them for it).
    const impersonated = quay(quayLines());
    await generate(impersonated, "impersonate");
    const its = impersonated.events.find((e) => e.event === "GENERATION_STARTED")!.payload as Record<string, unknown>;
    expect([its.targetMessageId, its.targetSwipeId]).toEqual([undefined, undefined]);
  });
});

/** The generation with the inputs only some kinds carry. */
async function generateWith(lv: StandIn, type: "normal" | "swipe" | "regenerate" | "continue" | "impersonate", more: Partial<GenerateInput>): Promise<Outcome> {
  const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-quay", type, ...more });
  expect(out.error).toBeNull();
  return out;
}

/** Lumiverse's own lines, as its defaults resolve them for Oona's chat with no persona (`services/prompt-behavior.ts:10-17`). */
const IMPERSONATION = "[Write your next reply from the point of view of User, using the chat history so far as a guideline for the writing style of User. Don't write as Oona or system. Don't describe actions of Oona.]";
const EMPTY_SEND = "[Write the next reply only as Oona.]";

describe("the impersonation prompt (`services/prompt-assembly.service.ts:4010-4040`)", () => {
  test("an impersonation ends with the impersonation prompt before the prefill, what the player typed after it, and it is recorded as the Impersonation Prompt", async () => {
    // Without the prefill: a user message, last. Nothing typed, the preset's line alone.
    const plain = await generate(quay(quayLines()), "impersonate");
    expect(ending(plain, 1)).toEqual([["user", IMPERSONATION, false]]);
    expect(utilities(plain)).toEqual([["Impersonation Prompt", "user", IMPERSONATION]]);

    // What he typed follows the line after a blank line.
    const typed = await generateWith(quay(quayLines()), "impersonate", { impersonateInput: "  TYPED I tie the boat up and  " });
    expect(ending(typed, 1)).toEqual([["user", `${IMPERSONATION}\n\nTYPED I tie the boat up and`, false]]);

    // With "Continue prefill" on, the line is a system message and the prefill stands after it.
    const prefilled = await generate(quay(quayLines(), { continuePrefill: true, assistantPrefill: PREFILL }), "impersonate");
    expect(ending(prefilled, 2)).toEqual([["system", IMPERSONATION, false], ["assistant", PREFILL, true]]);
    expect(utilities(prefilled)).toEqual([["Impersonation Prompt", "system", IMPERSONATION], ["Assistant Prefill", "assistant", PREFILL]]);
  });

  test("the preset's own line stands in its place, with its macros resolved; an empty one leaves only what was typed, and no line and nothing typed, nothing", async () => {
    const own = await generate(quay(quayLines(), { impersonationPrompt: "OWN Speak as {{user}}, not {{char}}." }), "impersonate");
    expect(ending(own, 1)).toEqual([["user", "OWN Speak as User, not Oona.", false]]);

    const onlyTyped = await generateWith(quay(quayLines(), { impersonationPrompt: "" }), "impersonate", { impersonateInput: "TYPED I tie the boat up and" });
    expect(ending(onlyTyped, 1)).toEqual([["user", "TYPED I tie the boat up and", false]]);

    const none = await generate(quay(quayLines(), { impersonationPrompt: "" }), "impersonate");
    expect(ending(none, 1)).toEqual([["assistant", "REPLY-1 Oona is coiling rope.", false]]);
    expect(utilities(none)).toEqual([]);
  });

  test("the one-liner mode sends the chat's history and the prompt alone: no preset block, no lore (`:2771-2790`, `onelinerImpersonation`)", async () => {
    /** The quay with a book of its own on the character, a fresh stand-in each time: an impersonation saves the player's reply. */
    const withLore = (): StandIn => {
      const lv = quay(quayLines(true));
      lv.library.addBook({ id: "book-quay", name: "Quay", user: USER, entries: [{ id: "e-lamp", book: "book-quay", comment: "Lamps", constant: true, content: "LAMP-LORE the lamps burn oil." }] });
      lv.library.addCharacter(USER, { id: "char-oona", name: "Oona", extensions: { world_book_ids: ["book-quay"] } });
      return lv;
    };
    const full = await generate(withLore(), "impersonate");
    expect(full.prompt.some((m) => textOf(m).includes("MAIN"))).toBe(true);
    expect(full.prompt.some((m) => textOf(m).includes("LAMP-LORE"))).toBe(true);

    const one = await generateWith(withLore(), "impersonate", { impersonateMode: "oneliner", impersonateInput: "TYPED I nod." });
    expect(one.prompt.map((m) => [m.role, textOf(m)])).toEqual([
      ["assistant", "GREET The lamps along the quay are lit."],
      ["user", "USER-1 I walk to the end of the quay."],
      ["assistant", "REPLY-1 Oona is coiling rope."],
      ["user", "USER-2 I ask her about the boat."],
      ["user", `${IMPERSONATION}\n\nTYPED I nod.`],
    ]);
  });
});

describe("a send with nothing typed after a reply, and the nudges (`:4066-4118`; `services/prompt-behavior.ts:92-117`)", () => {
  test("a normal generation of a chat whose last message is not the player's gets the empty-send nudge as a user message before the prefill", async () => {
    const out = await generate(quay(quayLines(), { assistantPrefill: PREFILL }), "normal");
    expect(ending(out, 3)).toEqual([["assistant", "REPLY-1 Oona is coiling rope.", false], ["user", EMPTY_SEND, false], ["assistant", PREFILL, true]]);
    expect(utilities(out)).toEqual([["Empty Send Nudge", "user", EMPTY_SEND], ["Assistant Prefill", "assistant", PREFILL]]);
  });

  test("and nowhere else: not after the player's line, not on a swipe, a regenerate, a continue or an impersonation, and not where the preset's is empty or a hidden message ends the chat", async () => {
    expect(ending(await generate(quay(quayLines(true)), "normal"), 1)).toEqual([["user", "USER-2 I ask her about the boat.", false]]);
    for (const kind of ["swipe", "regenerate", "continue"] as const) {
      const out = await generate(quay(quayLines()), kind);
      expect(utilities(out).map(([name]) => name)).not.toContain("Empty Send Nudge");
    }
    expect(utilities(await generate(quay(quayLines()), "impersonate")).map(([name]) => name)).not.toContain("Empty Send Nudge");
    expect(utilities(await generate(quay(quayLines(), { emptySendNudge: "" }), "normal"))).toEqual([]);
    // A hidden line of the player's after the reply: the last visible message is still the reply's.
    const hidden = await generate(quay([...quayLines(), { id: "m3", role: "user", content: "USER-2 I ask her about the boat.", hidden: true }]), "normal");
    expect(ending(hidden, 1)).toEqual([["user", EMPTY_SEND, false]]);
    // The preset's own line, its macros resolved.
    expect(ending(await generate(quay(quayLines(), { emptySendNudge: "OWN Go on as {{char}}." }), "normal"), 1)).toEqual([["user", "OWN Go on as Oona.", false]]);
  });

  test("a group chat's reply for one of its members gets the preset's group nudge naming the speaker, and not the empty-send nudge", async () => {
    const lv = quay(quayLines(), {}, { group: true, character_ids: ["char-oona", "char-wick"] });
    lv.library.addCharacter(USER, { id: "char-oona", name: "Oona" });
    lv.library.addCharacter(USER, { id: "char-wick", name: "Wick" });
    const named = await generateWith(lv, "normal", { targetCharacter: "char-wick" });
    expect(ending(named, 1)).toEqual([["user", "[Write the next reply only as Wick.]", false]]);
    expect(utilities(named)).toEqual([["Group Nudge", "user", "[Write the next reply only as Wick.]"]]);
    // Aimed at no member the group's own nudge is not sent, and the chat after a reply is nudged as any other.
    const unaimed = await generate(lv, "normal");
    expect(utilities(unaimed).map(([name]) => name)).toEqual(["Empty Send Nudge"]);
    // A member that is not in the group is no target; the preset's own line and its empty one.
    expect(ending(await generateWith(lv, "normal", { targetCharacter: "char-nobody" }), 1)).toEqual([["user", EMPTY_SEND, false]]);
    lv.presets.get("preset-quay")!.groupNudge = "";
    expect(utilities(await generateWith(lv, "normal", { targetCharacter: "char-wick" }))).toEqual([]);
  });

  test("send if empty is sent where Lumiverse sends it, and nowhere else (`:4042-4064`)", async () => {
    const blankLines = (): ChatMessage[] => [...quayLines(true), { id: "m4", role: "assistant", content: "" }];
    // The prompt ends on an assistant message with no text: the preset's line follows as a user message. Lumiverse leaves the blank message itself out of what it sends, after
    // the interceptors (`:1414-1423`).
    const sent = await generate(quay(blankLines(), { sendIfEmpty: "SEND {{char}} has gone quiet.", emptySendNudge: "" }), "normal");
    expect(ending(sent, 2)).toEqual([["user", "USER-2 I ask her about the boat.", false], ["user", "SEND Oona has gone quiet.", false]]);
    expect(utilities(sent)).toEqual([["Send If Empty", "user", "SEND Oona has gone quiet."]]);
    // The preset's line is empty by default, and a prompt that ends on text, or on the player's line, sends none.
    expect(utilities(await generate(quay(blankLines(), { emptySendNudge: "" }), "normal"))).toEqual([]);
    expect(utilities(await generate(quay(quayLines(), { sendIfEmpty: "SEND Go on.", emptySendNudge: "" }), "normal"))).toEqual([]);
    expect(utilities(await generate(quay(quayLines(true), { sendIfEmpty: "SEND Go on." }), "normal"))).toEqual([]);
  });
});

describe("the reasoning prefill on DeepSeek and Moonshot (`:4164-4181`)", () => {
  const REASONING = "REASON Oona's rope is the thing to start from, so {{char}} reaches for it.";
  const RESOLVED = "REASON Oona's rope is the thing to start from, so Oona reaches for it.";

  function deepseek(provider: string | undefined, preset: Partial<Preset> = {}): StandIn {
    const lv = quay(quayLines(true), { assistantPrefill: PREFILL, reasoningPrefill: REASONING, ...preset });
    lv.connections.set("conn-model", { ...lv.connections.get("conn-model")!, ...(provider !== undefined ? { provider } : {}) });
    return lv;
  }

  test.each(["deepseek", "moonshot"])("a %s connection is sent it as the prefill's reasoning_content, apart from the visible prefix, and it is recorded as the Reasoning Prefill", async (provider) => {
    const out = await generate(deepseek(provider), "normal");
    const last = out.prompt.at(-1)!;
    expect([last.role, textOf(last), last.partial, last.reasoning_content]).toEqual(["assistant", PREFILL, true, RESOLVED]);
    expect(utilities(out)).toEqual([["Assistant Prefill", "assistant", PREFILL], ["Reasoning Prefill", "assistant", RESOLVED]]);
    expect((out.body!.messages as Record<string, unknown>[]).at(-1)).toEqual({ role: "assistant", content: PREFILL, reasoning_content: RESOLVED });
  });

  test("with no visible prefill the message is empty and holds only the reasoning; another provider, a connection of none and a continue are sent none", async () => {
    const only = await generate(deepseek("deepseek", { assistantPrefill: "" }), "normal");
    expect(ending(only, 1)).toEqual([["assistant", "", true]]);
    expect(only.prompt.at(-1)!.reasoning_content).toBe(RESOLVED);

    for (const other of ["openai", undefined]) {
      const out = await generate(deepseek(other), "normal");
      expect(out.prompt.at(-1)!.reasoning_content).toBeUndefined();
      expect(utilities(out)).toEqual([["Assistant Prefill", "assistant", PREFILL]]);
    }
    const lv = quay(quayLines(), { reasoningPrefill: REASONING });
    lv.connections.set("conn-model", { ...lv.connections.get("conn-model")!, provider: "deepseek" });
    const goesOn = await generate(lv, "continue");
    expect(goesOn.prompt.some((m) => m.reasoning_content !== undefined && m.role === "assistant" && m.partial === true && textOf(m).includes("Oona's rope"))).toBe(false);
    expect(utilities(goesOn).map(([name]) => name)).not.toContain("Reasoning Prefill");
  });
});

describe("the regeneration feedback (`:3920-3985`)", () => {
  const FEEDBACK = { text: "FEEDBACK make it darker", position: "user" as const };

  test("sent as the user's: after a line in the last user message of the history, whose marks it keeps, and recorded as the Regen Feedback", async () => {
    const lv = quay(quayLines());
    const seen = handed(lv);
    const out = await generateWith(lv, "regenerate", { regenFeedback: FEEDBACK });
    expect(ending(out, 1)).toEqual([["user", "USER-1 I walk to the end of the quay.\n[OOC: FEEDBACK make it darker]", false]]);
    expect(utilities(out)).toEqual([["Regen Feedback", "user", "[OOC: FEEDBACK make it darker]"]]);
    // It stayed the history message it was: the interceptor is told which message it came from.
    expect(seen[0]!.filter((m) => m.__isChatHistory === true).map((m) => m.sourceMessageId)).toEqual(["m0", "m1"]);
  });

  test("sent as the system's: a system message at the end; the player's own format stands in place of Lumiverse's, its macros resolved", async () => {
    const out = await generateWith(quay(quayLines()), "regenerate", { regenFeedback: { text: "FEEDBACK make it darker", position: "system", format: "NOTE {{user}} asks: {{$regenInput}}!" } });
    expect(ending(out, 2)).toEqual([["user", "USER-1 I walk to the end of the quay.", false], ["system", "NOTE User asks: FEEDBACK make it darker!", false]]);
    expect(utilities(out)).toEqual([["Regen Feedback", "system", "NOTE User asks: FEEDBACK make it darker!"]]);
  });

  test("none is sent without it, and the feedback goes before the prefill", async () => {
    expect(utilities(await generate(quay(quayLines()), "regenerate"))).toEqual([]);
    const out = await generateWith(quay(quayLines(), { assistantPrefill: PREFILL }), "regenerate", { regenFeedback: { ...FEEDBACK, position: "system" } });
    expect(ending(out, 2)).toEqual([["system", "[OOC: FEEDBACK make it darker]", false], ["assistant", PREFILL, true]]);
  });
});

describe("the last reply of the history, trimmed (`rtrimLastHistoryAssistant`, `:672-707`)", () => {
  const lines = (): ChatMessage[] => [
    { id: "m0", role: "assistant", content: "GREET The lamps along the quay are lit.  " },
    { id: "m1", role: "user", content: "USER-1 I walk to the end of the quay.  " },
    { id: "m2", role: "assistant", content: "REPLY-1 Oona is coiling rope.  \n " },
  ];

  test("the last reply in history ends with no trailing spaces; a continued message and a prefill keep theirs", async () => {
    const out = await generate(quay(lines()), "normal");
    // Only the newest assistant message is trimmed: an earlier one, and the player's, are sent as they are.
    expect(out.prompt.map((m) => textOf(m)).filter((t) => t.startsWith("GREET") || t.startsWith("USER-1") || t.startsWith("REPLY-1"))).toEqual([
      "GREET The lamps along the quay are lit.  ",
      "USER-1 I walk to the end of the quay.  ",
      "REPLY-1 Oona is coiling rope.",
    ]);
    // A continue goes on the message as it is, its own postfix after it.
    const goesOn = await generate(quay(lines(), { continuePostfix: " " }), "continue");
    expect(ending(goesOn, 2)[0]).toEqual(["assistant", "REPLY-1 Oona is coiling rope.  \n ", false]);
    // A prefill the preset wrote is no history: it keeps its trailing space.
    const spaced = await generate(quay(lines(), { assistantPrefill: "PREFILL Oona looks up and " }), "normal");
    expect(ending(spaced, 1)).toEqual([["assistant", "PREFILL Oona looks up and ", true]]);
  });
});

describe("a block's text as Lumiverse sends it (`normalizePromptBlockText`, `services/prompt-assembly.service.ts:6999-7001`; `:3638-3663`, `:4305-4312`)", () => {
  test("a block whose text is only whitespace is trimmed and left out, as is one whose only text is an empty pool; every block's text is trimmed and its runs of newlines folded", async () => {
    const blocks: Block[] = [
      { id: "b-main", name: "Main", role: "system", content: "  \n MAIN You narrate a quay at dusk.\n\n\n\n  Lamps are lit.  \n" },
      { id: "b-blank", name: "Spacer", role: "system", content: "   \n " },
      { id: "b-pool", name: "Pool", role: "system", content: "{{wi_marker}}" },
      { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" },
    ];
    const out = await generate(quay(quayLines(true), { blocks }), "normal");
    // The prompt before the history is the one block, trimmed and folded; the other two are not sent.
    expect(out.prompt.filter((m) => m.__chatHistorySource !== true).map((m) => [m.role, textOf(m)])).toEqual([["system", "MAIN You narrate a quay at dusk.\n\n  Lamps are lit."]]);
    // Nor do they stand in the breakdown stored beside the reply.
    expect(out.stored!.entries.filter((e) => e.type === "block").map((e) => e.name)).toEqual(["Main"]);
  });
});

describe("the names written into content (`services/prompt-assembly.service.ts:7186-7195`)", () => {
  const NAMED: Partial<Preset> = { namesBehavior: 2 };
  const historyTexts = (out: Outcome): string[] => out.prompt.filter((m) => m.__chatHistorySource === true).map((m) => textOf(m));

  test("with names written into content, his lines carry his persona's name, and the character's an alternate name", async () => {
    // With no persona and no alternate name: Lumiverse's own "User", and the character's name.
    expect(historyTexts(await generate(quay(quayLines(true), NAMED), "normal"))).toEqual([
      "Oona: GREET The lamps along the quay are lit.",
      "User: USER-1 I walk to the end of the quay.",
      "Oona: REPLY-1 Oona is coiling rope.",
      "User: USER-2 I ask her about the boat.",
    ]);
    // The user's persona, and a card that gives the character another name.
    const lv = quay(quayLines(true), { ...NAMED, emptySendNudge: "" });
    lv.library.addPersona({ id: "persona-quill", user: USER, name: "Quill", is_default: true });
    lv.library.addCharacter(USER, { id: "char-oona", name: "Oona", extensions: { alternate_character_name: "Oona the Wary" } });
    const out = await generate(lv, "normal");
    expect(historyTexts(out)).toEqual([
      "Oona the Wary: GREET The lamps along the quay are lit.",
      "Quill: USER-1 I walk to the end of the quay.",
      "Oona the Wary: REPLY-1 Oona is coiling rope.",
      "Quill: USER-2 I ask her about the boat.",
    ]);
    // His name is the one `{{user}}` stands for in the lines Lumiverse adds, too.
    const impersonated = await generate(lv, "impersonate");
    expect(textOf(impersonated.prompt.find((m) => textOf(m).includes("point of view of"))!)).toContain("point of view of Quill");
  });
});

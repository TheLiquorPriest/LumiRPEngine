// The end of the prompt as the stand-in Lumiverse sends it, held to Lumiverse's own source (staging at
// a70f4ed2; paths are Lumiverse's `src/`): the prefill, which message a continue goes on, how its message
// is moved and joined, and how a continue is announced and handed to the interceptors. Every name is
// invented.

import { describe, expect, test } from "bun:test";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import type { PromptMessageDTO } from "../../../src/ext/spindle";
import { StandIn, type ChatMessage, type Outcome, type Preset } from "../../standin/lumiverse";
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
function quay(messages: ChatMessage[], preset: Partial<Preset> = {}): StandIn {
  const lv = new StandIn();
  lv.servers.set(MODEL, async (request) => streamedReply(async (out) => out.content("NEW-TEXT she says."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, turn: false }));
  lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
  lv.presets.set("preset-quay", { id: "preset-quay", name: "Quay", blocks: [{ id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a quay at dusk." }, { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" }], ...preset });
  lv.addChat({ id: CHAT, user: USER, character: { id: "char-oona", name: "Oona" }, messages });
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
    expect(utilities(off)).toEqual([]);

    const prefilled = await generate(quay(quayLines(), { assistantPrefill: PREFILL, continuePrefill: true }), "impersonate");
    expect(ending(prefilled, 1)).toEqual([["assistant", PREFILL, true]]);

    const own = await generate(quay(quayLines(), { assistantPrefill: PREFILL, assistantImpersonation: "IMPERSONATE I lean on the rail and", continuePrefill: true }), "impersonate");
    expect(ending(own, 1)).toEqual([["assistant", "IMPERSONATE I lean on the rail and", true]]);
    expect(utilities(own)).toEqual([["Assistant Prefill", "assistant", "IMPERSONATE I lean on the rail and"]]);
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
  test("a continue's start event names only its swipe, its moved message carries no source key, and the page sends the last non-user message (`services/generate.service.ts:1962-1968`, `:2040-2055`; `frontend/src/components/chat/InputArea.tsx:2238-2250`)", async () => {
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

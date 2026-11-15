// Who speaks in a generation of the stand-in Lumiverse, held to Lumiverse's own source (staging at a70f4ed2; paths are Lumiverse's `src/`): a group
// chat's generation names the character it is for, a regenerate, a swipe or a continue is for the one who spoke the message it is on, only a member of
// the group is taken, and what the speaker is shows in the start event, the staged and the saved reply, the lore read and the names written into the
// prompt. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import { streamedReply } from "../../../src/adapter/lumiverse/stream";
import type { PromptMessageDTO } from "../../../src/ext/spindle";
import type { Block } from "../../standin/assembly";
import { StandInDb } from "../../standin/db";
import { StandIn, type ChatMessage, type Outcome, type Preset } from "../../standin/lumiverse";

const USER = "user-ridge";
const CHAT = "chat-ridge";
const MODEL = "http://127.0.0.1:7882";
const CLOCK = { now: (): number => Date.now(), setTimeout: (run: () => void, ms: number): unknown => setTimeout(run, ms), clearTimeout: (handle: unknown): void => clearTimeout(handle as Timer) };

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

const MAIN: Block = { id: "b-main", name: "Main", role: "system", content: "MAIN You narrate a ridge in the hills." };
const HISTORY: Block = { id: "b-history", name: "Chat History", role: "system", content: "", marker: "chat_history" };

/** The ridge's chat: Tamsin's greeting, the player's line, a reply of Odo's, the player's line, a reply of Tamsin's. */
function ridgeLines(): ChatMessage[] {
  return [
    { id: "m0", role: "assistant", content: "GREET Tamsin waves from the ridge.", characterId: "char-tamsin" },
    { id: "m1", role: "user", content: "USER-1 I climb toward them." },
    { id: "m2", role: "assistant", content: "REPLY-ODO Odo whistles down the slope.", characterId: "char-odo" },
    { id: "m3", role: "user", content: "USER-2 I wave back." },
    { id: "m4", role: "assistant", content: "REPLY-TAMSIN Tamsin ties off the rope.", characterId: "char-tamsin" },
  ];
}

interface Ridge {
  group?: boolean | Record<string, unknown>;
  messages?: ChatMessage[];
  preset?: Partial<Preset>;
  withDb?: boolean;
}

/** A stand-in Lumiverse with a group chat of Tamsin (the chat's own character), Odo and Ines (who is not in it), each with a book of their own. */
function ridge(options: Ridge = {}): StandIn {
  const lv = new StandIn();
  if (options.withDb === true) {
    const db = new StandInDb();
    closing.push(() => db.close());
    db.write({ user: [{ id: USER, name: "Oona", email: "oona@example.invalid", username: "oona" }], characters: [], chats: [], messages: [], world_books: [], world_book_entries: [], personas: [], presets: [], settings: [], message_breakdowns: [] });
    lv.db = db;
  }
  lv.servers.set(MODEL, async (request) => streamedReply(async (out) => out.content("NEW-TEXT she says."), { id: "reply", model: "model", created: 0 }, request.signal, { clock: CLOCK, turn: false }));
  lv.connections.set("conn-model", { id: "conn-model", base: `${MODEL}/v1`, key: "model-key", model: "model" });
  lv.presets.set("preset-ridge", { id: "preset-ridge", name: "Ridge", blocks: [MAIN, HISTORY], ...options.preset });
  for (const [id, who] of [["char-tamsin", "Tamsin"], ["char-odo", "Odo"], ["char-ines", "Ines"]] as const) {
    lv.library.addBook({ id: `book-${who.toLowerCase()}`, name: `${who}'s book`, user: USER, entries: [{ id: `e-${who.toLowerCase()}`, book: `book-${who.toLowerCase()}`, comment: who, constant: true, content: `${who.toUpperCase()}-LORE what ${who} knows.` }] });
    // Odo's card gives him another name in the prompt (`getEffectiveCharacterName`).
    lv.library.addCharacter(USER, { id, name: who, extensions: { world_book_ids: [`book-${who.toLowerCase()}`], ...(who === "Odo" ? { alternate_character_name: "  Odo the Younger " } : {}) } });
  }
  const metadata = options.group === undefined || options.group === true ? { group: true, character_ids: ["char-tamsin", "char-odo"] } : options.group === false ? {} : options.group;
  lv.addChat({ id: CHAT, user: USER, character: { id: "char-tamsin", name: "Tamsin" }, messages: options.messages ?? ridgeLines(), metadata });
  return lv;
}

type Kind = "normal" | "swipe" | "regenerate" | "continue" | "impersonate";

async function generate(lv: StandIn, type: Kind = "normal", extra: { targetCharacter?: string; dryRun?: boolean; message?: string } = {}): Promise<Outcome> {
  const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-ridge", type, ...extra });
  expect(out.error).toBeNull();
  return out;
}

/** What the generation announced of its speaker. */
function announced(lv: StandIn): [unknown, unknown] {
  const started = lv.events.find((e) => e.event === "GENERATION_STARTED")!.payload as { characterId?: unknown; characterName?: unknown };
  return [started.characterId, started.characterName];
}

/** The lore each speaker's books gave the prompt, by the first word of each line. */
const loreOf = (out: Outcome): string[] => out.prompt.map((m) => (typeof m.content === "string" ? m.content : "").split(" ")[0]!).filter((w) => w.endsWith("-LORE"));

describe("each generation of a group chat names its speaker (`services/generate.service.ts:1795-1860`, `:1988-1991`, `:2049-2050`; `services/prompt-assembly.service.ts:1922`, `:2287`)", () => {
  test("each generation of a group chat names its speaker", async () => {
    // A new reply for the member named: announced under his name as his card gives it, staged as his, read with his books alone, and his the reply it saves.
    const odo = ridge({ withDb: true });
    const worldInfo: Record<string, unknown>[] = [];
    const contexts: Record<string, unknown>[] = [];
    const ext = odo.install(["generation", "interceptor"]);
    ext.registerWorldInfoInterceptor(async (ctx) => {
      worldInfo.push(ctx as Record<string, unknown>);
      return {};
    }, 10);
    ext.registerInterceptor(async (messages, context) => {
      contexts.push(context as Record<string, unknown>);
      return messages;
    }, {});
    const out = await generate(odo, "normal", { targetCharacter: "char-odo" });
    expect(announced(odo)).toEqual(["char-odo", "Odo the Younger"]);
    expect(loreOf(out)).toEqual(["ODO-LORE"]);
    // The World Info chain is told the character the prompt is assembled for; the interceptor's context names none (`generate.service.ts:1064-1072`).
    expect(worldInfo[0]).toMatchObject({ characterId: "char-odo" });
    expect(Object.keys(contexts[0]!)).not.toContain("characterId");
    const reply = odo.chats.get(CHAT)!.messages.at(-1)!;
    expect(reply).toMatchObject({ role: "assistant", content: "NEW-TEXT she says.", characterId: "char-odo" });
    expect(odo.db!.rows("SELECT name, extra FROM messages WHERE id = ?", reply.id)).toEqual([{ name: "Odo the Younger", extra: JSON.stringify({ character_id: "char-odo" }) }]);
    // The speaker is named in the prompt where the preset writes names.
    const named = ridge({ preset: { namesBehavior: 1 } });
    const namedOut = await generate(named, "normal", { targetCharacter: "char-odo" });
    expect(namedOut.prompt.filter((m) => m.role === "assistant").map((m) => m.name)).toEqual(["Odo the Younger", "Odo the Younger", "Odo the Younger"]);

    // Tamsin the same way, and the chat's own character where none is named.
    const tamsin = ridge();
    const tamsinOut = await generate(tamsin, "normal", { targetCharacter: "char-tamsin" });
    expect(announced(tamsin)).toEqual(["char-tamsin", "Tamsin"]);
    expect(loreOf(tamsinOut)).toEqual(["TAMSIN-LORE"]);
    const unnamed = ridge();
    expect((await generate(unnamed), announced(unnamed))).toEqual(["char-tamsin", "Tamsin"]);

    // Only a member of the group is taken, and only in a group chat.
    const stranger = ridge();
    const strangerOut = await generate(stranger, "normal", { targetCharacter: "char-ines" });
    expect(announced(stranger)).toEqual(["char-tamsin", "Tamsin"]);
    expect(loreOf(strangerOut)).toEqual(["TAMSIN-LORE"]);
    const single = ridge({ group: false });
    const singleOut = await generate(single, "normal", { targetCharacter: "char-odo" });
    expect(announced(single)).toEqual(["char-tamsin", "Tamsin"]);
    expect(loreOf(singleOut)).toEqual(["TAMSIN-LORE"]);
  });

  test("a regenerate, a swipe or a continue is for the one who spoke the message it is on; a dry run asks no message, and an impersonation is no one's", async () => {
    // The newest reply is Odo's: the chat's own character, the preset's first, the one the caller names are all passed over for him.
    const lines = (): ChatMessage[] => [...ridgeLines().slice(0, 4), { id: "m4", role: "assistant", content: "REPLY-ODO-2 Odo calls the climbers up.", characterId: "char-odo" }];
    for (const kind of ["regenerate", "swipe", "continue"] as const) {
      const lv = ridge({ messages: lines() });
      const out = await generate(lv, kind, { targetCharacter: "char-tamsin" });
      expect(announced(lv)).toEqual(["char-odo", "Odo the Younger"]);
      expect(loreOf(out)).toEqual(["ODO-LORE"]);
    }
    // A message that has no speaker of its own, or one who left the group, is for the one the caller names, else the chat's.
    const unspoken = ridge({ messages: ridgeLines().map((m) => ({ ...m, characterId: undefined })) });
    await generate(unspoken, "regenerate", { targetCharacter: "char-odo" });
    expect(announced(unspoken)).toEqual(["char-odo", "Odo the Younger"]);
    const left = ridge({ messages: [...ridgeLines().slice(0, 4), { id: "m4", role: "assistant", content: "REPLY-INES Ines is gone.", characterId: "char-ines" }] });
    await generate(left, "regenerate");
    expect(announced(left)).toEqual(["char-tamsin", "Tamsin"]);
    // A new reply is for the one named before the one the last message names.
    const fresh = ridge({ messages: lines() });
    await generate(fresh, "normal", { targetCharacter: "char-tamsin" });
    expect(announced(fresh)).toEqual(["char-tamsin", "Tamsin"]);

    // A dry run is told no message: it is for the one named, else the chat's own.
    const dry = ridge({ messages: lines() });
    const dryOut = await generate(dry, "regenerate", { dryRun: true });
    expect(loreOf(dryOut)).toEqual(["TAMSIN-LORE"]);
    const dryOdo = await generate(ridge({ messages: lines() }), "normal", { dryRun: true, targetCharacter: "char-odo" });
    expect(loreOf(dryOdo)).toEqual(["ODO-LORE"]);

    // An impersonation names the speaker as a new reply does; the message it saves is the player's, with no character.
    const impersonated = ridge();
    await generate(impersonated, "impersonate", { targetCharacter: "char-odo" });
    expect(announced(impersonated)).toEqual(["char-odo", "Odo the Younger"]);
    expect(impersonated.chats.get(CHAT)!.messages.at(-1)).toMatchObject({ role: "user", content: "NEW-TEXT she says." });
    expect(impersonated.chats.get(CHAT)!.messages.at(-1)!.characterId).toBeUndefined();
  });

  test("a speaker whose card Lumiverse does not hold ends the generation, and the reply staged for it is removed", async () => {
    const lv = ridge({ group: { group: true, character_ids: ["char-tamsin", "char-gone"] } });
    const out = await lv.generate({ chat: CHAT, connection: "conn-model", preset: "preset-ridge", targetCharacter: "char-gone" });
    expect(out.error).toBe("Character not found");
    expect(lv.chats.get(CHAT)!.messages).toHaveLength(5);
    // The start was announced before the assembly found there was no card, under the name Lumiverse gives a speaker it cannot read.
    expect(announced(lv)).toEqual(["char-gone", "Assistant"]);
  });

  test("the group's other members' lines are as the chat holds them: each reply is named for the character who spoke it", async () => {
    const lv = ridge({ withDb: true });
    const names = lv.db!.rows("SELECT id, name, extra FROM messages WHERE chat_id = ? AND is_user = 0 ORDER BY index_in_chat", CHAT).map((r) => [r.id, r.name, JSON.parse(String(r.extra))]);
    expect(names).toEqual([["m0", "Tamsin", { character_id: "char-tamsin" }], ["m2", "Odo", { character_id: "char-odo" }], ["m4", "Tamsin", { character_id: "char-tamsin" }]]);
    const history: PromptMessageDTO[][] = [];
    lv.install(["interceptor"]).registerInterceptor(async (messages) => {
      history.push(messages);
      return messages;
    }, {});
    await generate(lv, "normal", { targetCharacter: "char-odo" });
    expect(history[0]!.filter((m) => m.__isChatHistory === true).map((m) => m.sourceMessageId)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
  });
});

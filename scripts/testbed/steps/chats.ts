// Item 3's chats: an invented character card in Lumiverse, and one chat on each of the engine's three
// engines, each given the test world (the CLI's `attach`, which also sets a new world chat to the
// harness) and then its engine (GM → This chat → Engine, `lre.chat.knowledge {engine}`, which the CLI
// doesn't offer).

import type { Ctx, Step } from "../lib/context";
import { guard } from "../lib/env";
import { say } from "../lib/record";
import { worldIdOf } from "./world";

export const CARD_NAME = "Port Alder (test instance)";
/** The player's name on their own messages. */
export const PLAYER = "Jordan";

export type Engine = "classic" | "agents" | "harness";
export const CHATS: { key: Engine; name: string }[] = [
  { key: "classic", name: "Port Alder test · classic" },
  { key: "agents", name: "Port Alder test · agents" },
  { key: "harness", name: "Port Alder test · harness" },
];

const CARD = {
  name: CARD_NAME,
  description: "The narrator of Port Alder, a small lake town in the last good weeks of boating season. Tells what Jordan Ellis, a young mechanic, sees, hears and does, and what the town's people say and do around them.",
  personality: "Plain, warm, observant.",
  scenario: "Port Alder, a Monday in mid-September, early morning.",
  first_mes: "Monday comes in grey and cool off the lake. Out the window of 2B on Harbor Street the gulls are already working the marina, and your shift at Alder Automotive starts at seven.",
};

export async function cardOf(ctx: Ctx): Promise<string> {
  const remembered = ctx.log.get<string>("cardId");
  const cards = await ctx.host.characters();
  const found = cards.find((c) => c.id === remembered) ?? cards.find((c) => c.name === CARD_NAME);
  if (found) {
    ctx.log.set("cardId", found.id);
    return found.id;
  }
  const made = await ctx.host.createCharacter(CARD);
  ctx.log.set("cardId", made.id);
  ctx.log.log({ step: "chats", action: "created", kind: "character card", id: made.id, name: CARD_NAME });
  return made.id;
}

/** A chat of the test instance by its key, the one an earlier run made; null when there is none yet. */
export async function chatOf(ctx: Ctx, key: string): Promise<string | null> {
  const id = ctx.log.get<string>(`chat:${key}`);
  if (id === undefined) return null;
  try {
    await ctx.host.chat(guard(ctx.env, id));
    return id;
  } catch {
    return null;
  }
}

/** Makes a chat on the card with the test world attached, and remembers it under `key`. */
export async function newWorldChat(ctx: Ctx, key: string, name: string): Promise<string> {
  const known = await chatOf(ctx, key);
  if (known !== null) return known;
  const cardId = await cardOf(ctx);
  const worldId = await worldIdOf(ctx, false);
  const chat = await ctx.host.createChat(cardId, name);
  ctx.log.set(`chat:${key}`, chat.id);
  ctx.log.log({ step: "chats", action: "created", kind: "chat", id: chat.id, name, detail: { cardId } });
  await ctx.cli.run(["attach", worldId, chat.id]);
  ctx.log.log({ step: "chats", action: "changed", kind: "chat run (world attached)", id: chat.id, detail: { worldId } });
  return chat.id;
}

export const chats: Step = {
  name: "chats",
  makes: "a character card and a world chat on each of the three engines",
  async run(ctx) {
    for (const { key, name } of CHATS) {
      const chatId = await newWorldChat(ctx, key, name);
      const asked = await ctx.socket.lre<{ engine?: string; harnessBlocked?: string }>("lre.chat.knowledge", { chatId, engines: true });
      const now = asked.engine ?? "classic";
      if (now !== key) {
        const set = await ctx.socket.lre<{ engine?: string }>("lre.chat.knowledge", { chatId, engine: key === "classic" ? null : key });
        ctx.log.log({ step: "chats", action: "changed", kind: "chat engine (chat metadata prefs.engine)", id: chatId, detail: { engine: set.engine ?? "classic" } });
      }
      const chat = await ctx.host.chat(chatId);
      say(`${name} (${chatId}): engine ${key}, connection ${String(chat.metadata?.connection_profile_id ?? "the active one")}${asked.harnessBlocked ? `; harness blocked: ${asked.harnessBlocked}` : ""}`);
    }
  },
};

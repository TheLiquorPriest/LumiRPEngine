// What the end-to-end tests of a harness chat share (`harness-e2e*.test.ts`): a new world chat in a
// Lumiverse where LumiAH's backend is mounted in the engine and its runtime is linked
// (`support/runtime-bed.ts`), the player's message that starts a reply, and the lines an author's
// part is mostly made of.

import { type Answer, toolCall } from "../support/lumiah-bed";
import { Rig } from "../support/rig";
import { type Replied, type RuntimeBed, runtimeBed } from "../support/runtime-bed";
import { PEOPLE } from "./harness-driver";

/** A rig with LumiAH's backend mounted in its engine and a runtime linked to it, as a player sets one up: nothing switched by hand. */
export async function linked(): Promise<{ bed: RuntimeBed; rig: Rig }> {
  const rig = new Rig({ shipped: true, minds: true });
  return { bed: await runtimeBed(rig), rig };
}

/** A new Port Alder world with the tests' people, committed: its id. */
export async function alderWorld(rig: Rig): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  for (const [id, value] of Object.entries(PEOPLE)) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id, value }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  return worldId;
}

/** A new chat given a world, as the player does it: with LumiAH mounted it plays on the harness from here on, with nothing else chosen. */
export async function chatOn(rig: Rig, worldId: string): Promise<string> {
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

/** The engine's own helper model throws from now on: on a chat the harness plays it must never be reached. */
export function guard(rig: Rig): void {
  rig.host.quietReply = () => {
    throw new Error("the harness path reached one of the engine's own model calls");
  };
}

/**
 * A new Port Alder chat with the tests' people, on the harness in a linked runtime, once LumiAH has
 * set it to play there. `guarded`: the engine's own helper model throws if reached, as it must never
 * be on a chat the harness plays.
 */
export async function worldChat(guarded = true): Promise<{ bed: RuntimeBed; rig: Rig; chatId: string; worldId: string }> {
  const { bed, rig } = await linked();
  const worldId = await alderWorld(rig);
  const chatId = await chatOn(rig, worldId);
  await bed.until(async () => (await bed.page<{ chat: { place: string } }>("lah.chat.get", { chatId })).chat.place === "runtime", "the chat set to play in the runtime");
  if (guarded) guard(rig);
  return { bed, rig, chatId, worldId };
}

/** Which engine plays a chat, as GM → This chat → Engine reads it. */
export const engineOf = async (rig: Rig, chatId: string): Promise<unknown> => rig.body(await rig.send({ type: "lre.chat.knowledge", chatId })).engine ?? "classic";

/** The player says something, and Lumiverse runs the reply through the runtime to its end. */
export async function say(bed: RuntimeBed, rig: Rig, chatId: string, text: string): Promise<Replied> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  return bed.reply(chatId);
}

/** The author releases this as the reply. */
export const release = (text: string): Answer => ({ toolCalls: [toolCall("reply_write", { text })] });

/** One answer that calls one tool. */
export const calls = (name: string, args: Record<string, unknown> = {}): Answer => ({ toolCalls: [toolCall(name, args as never)] });

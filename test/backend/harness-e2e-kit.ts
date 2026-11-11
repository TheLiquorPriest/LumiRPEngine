// What the end-to-end tests of a harness chat share (`harness-e2e*.test.ts`): a new world chat in a
// Lumiverse where LumiAH is built into the engine, the player's message that starts a reply, and the
// lines an author's part is mostly made of.

import type { Generation } from "../support/fake-host";
import { type Answer, type Bed, lumiahBed, toolCall } from "../support/lumiah-bed";
import { Rig } from "../support/rig";
import { PEOPLE } from "./harness-driver";

/** The player character's wallet in the shipped world. */
export const CASH = "acct_pov_cash";

/** A rig with LumiAH built into its engine, as the extension starts: nothing switched or set up by hand. */
export function builtIn(): { bed: Bed; rig: Rig } {
  const rig = new Rig({ shipped: true, minds: true });
  return { bed: lumiahBed(rig), rig };
}

/** A new Port Alder world with the tests' people, committed: its id. */
export async function alderWorld(rig: Rig): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  for (const [id, value] of Object.entries(PEOPLE)) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id, value }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  return worldId;
}

/** A new chat given a world, as the player does it: with LumiAH built in it plays on the harness from here on, with nothing else chosen. */
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
 * A new Port Alder chat with the tests' people, in a Lumiverse where LumiAH is built into the
 * engine. `guarded`: the engine's own helper model throws if reached, as it must never be on a chat
 * the harness plays.
 */
export async function worldChat(guarded = true): Promise<{ bed: Bed; rig: Rig; chatId: string; worldId: string }> {
  const { bed, rig } = builtIn();
  const worldId = await alderWorld(rig);
  const chatId = await chatOn(rig, worldId);
  if (guarded) guard(rig);
  return { bed, rig, chatId, worldId };
}

/** Which engine plays a chat, as GM → This chat → Engine reads it. */
export const engineOf = async (rig: Rig, chatId: string): Promise<unknown> => rig.body(await rig.send({ type: "lre.chat.knowledge", chatId })).engine ?? "classic";

/** The player says something and Lumiverse starts the reply: its prompt is assembled and its interceptors have answered when this resolves. */
export async function say(rig: Rig, chatId: string, text: string): Promise<Generation> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  return rig.host.begin(chatId, { type: "normal" });
}

/** The author hands the reply over with this brief. */
export const brief = (text: string): Answer => ({ toolCalls: [toolCall("write_reply", { brief: text })] });

/** One answer that calls one tool. */
export const calls = (name: string, args: Record<string, unknown> = {}): Answer => ({ toolCalls: [toolCall(name, args as never)] });

// A short replay of turn kinds on a test instance, for checking a build after fixes: one line, a
// continue of its reply, and two swipes, each through Lumiverse as a player would start them, with
// what Lumiverse saved and what RPE recorded printed side by side. It plays only the chat it is given
// and refuses the chats the environment names as never to be touched.
//
//   bun recheck.ts edit <chat>              before a cutover: edits the newest reply's text in Lumiverse
//   bun recheck.ts play <chat> [line]       on RPE: a line, a continue, two swipes
//
// The environment is the other scripts' (README.md), with RPE's address and a page token as the floor
// test takes them (FLOOR_RPE_URL, FLOOR_RPE_TOKEN) and the connection RPE answers on by its name in
// Lumiverse (FLOOR_RPE_CONNECTION).

import { guard, readEnv } from "./lib/env";
import { Lumiverse, type Message, savedToken } from "./lib/lumiverse";
import { RpeApi } from "./lib/rpe";

/** How long one generation may take before the replay gives up on it. */
const TURN_MS = 5 * 60_000;
/** How long RPE is given to tie a turn to the message Lumiverse saved. */
const TIE_MS = 60_000;
const EDIT_MARK = " (The clock on the wall said a quarter past.)";

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

/** Waits until no generation runs in the chat, then gives its messages. */
async function settled(host: Lumiverse, chat: string): Promise<Message[]> {
  const began = Date.now();
  let calm = 0;
  while (calm < 2) {
    if (Date.now() - began > TURN_MS) throw new Error("the generation did not end in time");
    await Bun.sleep(1500);
    calm = (await host.generationStatus(chat)).active === true ? 0 : calm + 1;
  }
  return host.messages(chat);
}

/** RPE's newest turns of the chat, one line each. */
async function turnsLine(api: RpeApi, chat: string, count: number): Promise<string> {
  const { turns } = await api.turns(chat, count);
  return turns.map((t) => `${t.id.slice(0, 8)} ${t.kind} ${t.status}${t.onPath ? "" : " OFF-PATH"} msg ${t.message === null ? "none" : t.message.slice(0, 8)} calls ${t.usage.calls}`).join("\n    ");
}

async function edit(chat: string): Promise<void> {
  const env = readEnv();
  const host = new Lumiverse(env.hostUrl, savedToken(env));
  const reply = (await host.messages(guard(env, chat))).filter((m) => !m.is_user).at(-1);
  if (reply === undefined) throw new Error("the chat has no reply to edit");
  await host.edit(chat, reply.id, `${reply.content}${EDIT_MARK}`);
  console.log(`edited message ${reply.id} (index ${reply.index_in_chat}): appended "${EDIT_MARK.trim()}"`);
}

async function play(chat: string, line: string): Promise<void> {
  const env = readEnv();
  const host = new Lumiverse(env.hostUrl, savedToken(env));
  const api = new RpeApi(need("FLOOR_RPE_URL").replace(/\/+$/, ""), need("FLOOR_RPE_TOKEN"));
  const wanted = need("FLOOR_RPE_CONNECTION");
  const connection = (await host.connections()).find((c) => c.name === wanted)?.id;
  if (connection === undefined) throw new Error(`Lumiverse has no connection named "${wanted}"`);
  guard(env, chat);
  const before = await host.messages(chat);
  const name = before.filter((m) => m.is_user).at(-1)?.name ?? "Player";

  // 1. A line.
  await host.send(chat, name, line);
  await host.generate(chat, "normal", connection);
  let messages = await settled(host, chat);
  let reply = messages.at(-1);
  if (reply === undefined || reply.is_user) throw new Error("the line got no reply message");
  const first = await api.tiedTo(chat, reply.id, TIE_MS);
  console.log(`line: message ${reply.id.slice(0, 8)}, ${reply.content.length} characters; RPE turn ${first === null ? "NOT TIED" : `${first.id.slice(0, 8)} ${first.status}`}`);
  if (first !== null) await api.ended(chat, first.id, TURN_MS);
  console.log(`    ${await turnsLine(api, chat, 3)}`);

  // 2. A continue of that reply.
  const lengthBefore = reply.content.length;
  await host.generate(chat, "continue", connection);
  messages = await settled(host, chat);
  reply = messages.at(-1) as Message;
  console.log(`continue: the same message ${reply.id.slice(0, 8)} grew from ${lengthBefore} to ${reply.content.length} characters`);
  await Bun.sleep(3000);
  console.log(`    ${await turnsLine(api, chat, 3)}`);

  // 3. Two swipes.
  for (const nth of [1, 2]) {
    await host.generate(chat, "regenerate", connection);
    messages = await settled(host, chat);
    reply = messages.at(-1) as Message;
    const shown = reply.swipes[reply.swipe_id] ?? reply.content;
    console.log(`swipe ${nth}: message ${reply.id.slice(0, 8)} has ${reply.swipes.length} swipes; the one shown has ${shown.length} characters${shown.length === 0 ? " (EMPTY)" : ""}`);
    await Bun.sleep(3000);
    console.log(`    ${await turnsLine(api, chat, 4)}`);
  }
}

const [command, chat, ...rest] = process.argv.slice(2);
try {
  if (command === "edit" && chat !== undefined) await edit(chat);
  else if (command === "play" && chat !== undefined) await play(chat, rest.join(" ") || "I look around the room and say what I see, in a sentence or two.");
  else {
    console.error("usage: bun recheck.ts edit <chat> | play <chat> [line]");
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

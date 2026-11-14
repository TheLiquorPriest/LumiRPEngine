// The floor test, as the player's screen sees it: the same chat, the same preset and the same
// model, played turn about on a plain connection and on RPE's, each turn sent after the one before
// has finished. For every turn it records when the request left, when the first thinking and the
// first word of the reply reached the page, when the last word did, and how many tokens Lumiverse
// counted in the reply. From those: time to the first word, thinking time, and time per output
// token, as medians per connection and side by side.
//
//   bun scripts/testbed/floor.ts setup                  make the invented card and chat; prints their ids
//   bun scripts/testbed/floor.ts run [--pairs 10] [--only plain|rpe]
//
// Environment (besides what scripts/testbed/README.md lists for every script):
//   FLOOR_CHAT              the chat to play in (printed by `setup`)
//   FLOOR_PLAIN_CONNECTION  the name of the Lumiverse connection that calls the model directly
//   FLOOR_RPE_CONNECTION    the name of the Lumiverse connection that points at RPE
//   FLOOR_OUT               where the measurements are written as JSON (optional)
//
// What only RPE knows about its own turns (model calls before the reply, the intent record's time,
// what the model was sent) is read from RPE's turn record by the proof that calls this script; this
// file measures what the player sees, the same way for both connections.

import { guard, readEnv, type TestbedEnv } from "./lib/env";
import { Lumiverse, savedToken } from "./lib/lumiverse";
import { EngineSocket, type HostEvent } from "./lib/socket";

/** The player's lines: short, ordinary turns in one place, none of which needs a ruling or a roll. */
const LINES: readonly string[] = [
  "I set my pack down by the door and ask how long the storm is likely to last.",
  "I hang my coat near the stove and look around the room while she answers.",
  "I ask whether the lamp upstairs has ever gone out on her watch.",
  "I take the cup she offers and thank her.",
  "I ask what she does out here when the weather keeps the boats away.",
  "I walk to the window and watch the waves for a moment.",
  "I ask if anyone else has come by this week.",
  "I sit down at the table and stretch my legs.",
  "I ask her what the logbook on the shelf is for.",
  "I tell her the tea is good and ask where she gets it.",
  "I ask whether she ever thinks of leaving the rock.",
  "I pick up the brass spyglass from the sill and turn it over in my hands.",
  "I ask how she came to keep the light.",
  "I offer to carry the oil up the stairs for her.",
  "I ask what the worst night she remembers here was like.",
  "I move my chair a little closer to the stove.",
  "I ask if the gulls always make that much noise.",
  "I look at the charts pinned to the wall and ask about the marked shoals.",
  "I ask whether she would like a hand with supper.",
  "I say I should check on my boat once the wind drops, and ask if the path down is safe.",
];

const CARD = {
  name: "Marta Venn",
  description:
    "Marta Venn keeps the light on Skerry Rock, a day's sail from the nearest harbor. She is in her fifties, spare and weathered, slow to speak and exact when she does. She has kept the lamp for nineteen years and knows the water around the rock by sound.",
  personality: "Dry, patient, observant. She answers what is asked and notices what is not.",
  scenario: "A traveller's boat has put in at Skerry Rock ahead of a storm. Marta has let them into the keeper's kitchen at the foot of the tower.",
  first_mes:
    "The kitchen is small and warm, and smells of lamp oil and peat. Marta shuts the door against the wind and nods at the bench by the stove.\n\n\"You'll not be leaving tonight,\" she says. \"Sit. There's tea.\"",
};

interface Measured {
  pair: number;
  arm: "plain" | "rpe";
  line: string;
  messageId: string | null;
  /** Milliseconds from the request leaving to each moment; null when it never came. */
  toStarted: number | null;
  toFirstThinking: number | null;
  toFirstWord: number | null;
  toLastWord: number | null;
  toEnded: number | null;
  /** Characters of thinking and of reply text the page was streamed. */
  thinkingChars: number;
  replyChars: number;
  /** Lumiverse's own count of the reply's tokens, when it reported one. */
  tokens: number | null;
  error: string | null;
}

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`set ${name}`);
  return value.trim();
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const seconds = (ms: number | null): string => (ms === null ? "—" : (ms / 1000).toFixed(2));

async function connectionId(host: Lumiverse, name: string): Promise<string> {
  const found = (await host.connections()).filter((c) => c.name === name);
  if (found.length !== 1) throw new Error(`${found.length} connections are named "${name}"; the floor test needs exactly one`);
  return (found[0] as { id: string }).id;
}

/** One turn: the player's line, then Send on the given connection, timed from the page's side. */
async function turn(host: Lumiverse, socket: EngineSocket, chatId: string, connection: string, pair: number, arm: Measured["arm"], line: string, persona: string): Promise<Measured> {
  const out: Measured = { pair, arm, line, messageId: null, toStarted: null, toFirstThinking: null, toFirstWord: null, toLastWord: null, toEnded: null, thinkingChars: 0, replyChars: 0, tokens: null, error: null };
  await host.send(chatId, persona, line);
  let sent = 0;
  const { promise: ended, resolve } = Promise.withResolvers<void>();
  let endedAt: number | null = null;
  const stop = socket.onEvent((event: HostEvent) => {
    if (event.payload.chatId !== chatId || sent === 0) return;
    const since = event.at - sent;
    if (event.event === "GENERATION_STARTED" && out.toStarted === null) out.toStarted = since;
    else if (event.event === "STREAM_TOKEN_RECEIVED" && typeof event.payload.token === "string") {
      if (event.payload.type === "reasoning") {
        if (out.toFirstThinking === null) out.toFirstThinking = since;
        out.thinkingChars += event.payload.token.length;
      } else if (event.payload.token !== "") {
        if (out.toFirstWord === null) out.toFirstWord = since;
        out.toLastWord = since;
        out.replyChars += event.payload.token.length;
      }
    } else if (event.event === "GENERATION_ENDED" && endedAt === null) {
      endedAt = event.at;
      out.toEnded = since;
      if (typeof event.payload.messageId === "string") out.messageId = event.payload.messageId;
      if (event.payload.error) out.error = String(event.payload.error);
      // The token count comes a moment after the end, or with it when there is none to wait for.
      setTimeout(resolve, 4000);
    } else if (event.event === "GENERATION_METRICS_READY" && typeof event.payload.tokenCount === "number") {
      out.tokens = event.payload.tokenCount;
      if (endedAt !== null) resolve();
    }
  });
  const limit = setTimeout(() => {
    out.error = out.error ?? "no end within 15 minutes";
    resolve();
  }, 15 * 60_000);
  try {
    sent = Date.now();
    await host.generate(chatId, "normal", connection);
    await ended;
  } catch (error) {
    out.error = error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(limit);
    stop();
  }
  // A following turn starts only once nothing runs in the chat any more (RPE may work on after its reply).
  for (let calm = 0, tries = 0; calm < 2 && tries < 450; tries++) {
    await Bun.sleep(2000);
    const status = await host.generationStatus(chatId);
    calm = status.active === true ? 0 : calm + 1;
  }
  return out;
}

function perToken(m: Measured): number | null {
  if (m.tokens === null || m.tokens < 2 || m.toFirstWord === null || m.toLastWord === null) return null;
  return (m.toLastWord - m.toFirstWord) / (m.tokens - 1);
}

function report(all: readonly Measured[]): void {
  const rows: { arm: Measured["arm"]; n: number; failed: number; firstWord: number | null; thinking: number | null; perToken: number | null; whole: number | null }[] = [];
  for (const arm of ["plain", "rpe"] as const) {
    const of = all.filter((m) => m.arm === arm);
    if (of.length === 0) continue;
    const good = of.filter((m) => m.error === null && m.toFirstWord !== null);
    rows.push({
      arm,
      n: of.length,
      failed: of.length - good.length,
      firstWord: median(good.map((m) => m.toFirstWord as number)),
      thinking: median(good.filter((m) => m.toFirstThinking !== null).map((m) => (m.toFirstWord as number) - (m.toFirstThinking as number))),
      perToken: median(good.map(perToken).filter((v): v is number => v !== null)),
      whole: median(good.filter((m) => m.toEnded !== null).map((m) => m.toEnded as number)),
    });
  }
  console.log("\narm    turns  failed  first word (s)  thinking before it (s)  ms per token  whole reply (s)");
  for (const r of rows) {
    console.log(`${r.arm.padEnd(6)} ${String(r.n).padStart(5)}  ${String(r.failed).padStart(6)}  ${seconds(r.firstWord).padStart(14)}  ${seconds(r.thinking).padStart(22)}  ${(r.perToken === null ? "—" : r.perToken.toFixed(1)).padStart(12)}  ${seconds(r.whole).padStart(15)}`);
  }
  const plain = rows.find((r) => r.arm === "plain");
  const rpe = rows.find((r) => r.arm === "rpe");
  if (plain?.firstWord != null && rpe?.firstWord != null) {
    console.log(`\nfirst word, RPE less plain: ${seconds(rpe.firstWord - plain.firstWord)} s (the intent record's own time is taken off this by the proof, from RPE's turn record)`);
  }
  if (plain?.perToken != null && rpe?.perToken != null) {
    console.log(`time per token, RPE over plain: ${((rpe.perToken / plain.perToken - 1) * 100).toFixed(1)}% (pass: within 15%)`);
  }
}

async function open(env: TestbedEnv): Promise<Lumiverse> {
  return new Lumiverse(env.hostUrl, savedToken(env));
}

async function setup(env: TestbedEnv): Promise<void> {
  const host = await open(env);
  const existing = (await host.characters()).find((c) => c.name === CARD.name);
  const character = existing ?? (await host.createCharacter(CARD));
  const chat = await host.createChat(character.id, "Floor test");
  console.log(`character ${character.id}${existing ? " (already there)" : ""}\nchat ${chat.id}\nexport FLOOR_CHAT=${chat.id}`);
}

async function run(env: TestbedEnv, pairs: number, only: Measured["arm"] | null): Promise<void> {
  const host = await open(env);
  const chatId = guard(env, need("FLOOR_CHAT"));
  const arms: { arm: Measured["arm"]; connection: string }[] = [];
  if (only !== "rpe") arms.push({ arm: "plain", connection: await connectionId(host, need("FLOOR_PLAIN_CONNECTION")) });
  if (only !== "plain") arms.push({ arm: "rpe", connection: await connectionId(host, need("FLOOR_RPE_CONNECTION")) });
  if (pairs * arms.length > LINES.length) throw new Error(`${pairs} pairs need ${pairs * arms.length} lines and the script has ${LINES.length}`);
  const socket = await EngineSocket.open(host, "", { page: false });
  const persona = process.env.FLOOR_PERSONA?.trim() || "Traveller";
  const all: Measured[] = [];
  try {
    let next = 0;
    for (let pair = 1; pair <= pairs; pair++) {
      for (const { arm, connection } of arms) {
        const line = LINES[next++] as string;
        const measured = await turn(host, socket, chatId, connection, pair, arm, line, persona);
        all.push(measured);
        console.log(`pair ${pair} ${arm}: first word ${seconds(measured.toFirstWord)} s, whole ${seconds(measured.toEnded)} s, ${measured.tokens ?? "?"} tokens${measured.error ? `, FAILED: ${measured.error}` : ""}`);
      }
    }
  } finally {
    socket.close();
  }
  report(all);
  const out = process.env.FLOOR_OUT?.trim();
  if (out) await Bun.write(out, `${JSON.stringify({ at: new Date().toISOString(), chat: chatId, turns: all }, null, 2)}\n`);
}

const [command, ...rest] = process.argv.slice(2);
const env = readEnv();
if (command === "setup") await setup(env);
else if (command === "run") {
  const pairsAt = rest.indexOf("--pairs");
  const onlyAt = rest.indexOf("--only");
  const pairs = pairsAt >= 0 ? Number(rest[pairsAt + 1]) : 10;
  const only = onlyAt >= 0 ? rest[onlyAt + 1] : null;
  if (!Number.isInteger(pairs) || pairs < 1) throw new Error("--pairs takes a whole number, 1 or more");
  if (only !== null && only !== "plain" && only !== "rpe") throw new Error("--only takes plain or rpe");
  await run(env, pairs, only);
} else {
  console.error("usage: floor.ts setup | run [--pairs N] [--only plain|rpe]");
  process.exit(2);
}

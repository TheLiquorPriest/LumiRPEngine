// The floor test (STANDALONE-PLAN §17.1): the same chat, the same preset and the same model, played
// turn about on a plain connection and on RPE's, each turn sent after the one before has finished
// (on RPE, after its run has ended too, which can be after its reply). For every turn it records, as
// the player's screen sees it, when the request left, when the first thinking and the first word of
// the reply reached the page, when the last word did, and how many tokens Lumiverse counted. For an
// RPE turn it then reads RPE's own record of the turn (`floor-measure.ts` says what is taken from
// it). It prints the §17.1 table and writes every turn's raw numbers to FLOOR_OUT. Both connections
// play under the floor's own preset and persona (`floor-fixture.ts`), named on every generation.

import { findFixture, type Fixture, removeFixture, setupFixture } from "./floor-fixture";
import { type Form, floorTable, type Measured, median, perToken, printRpeTurns, printTable, rpeSide } from "./floor-measure";
import { guard, readEnv, type TestbedEnv } from "./lib/env";
import { Lumiverse, savedToken } from "./lib/lumiverse";
import { RpeApi, RpeLive } from "./lib/rpe";
import { EngineSocket, type HostEvent } from "./lib/socket";

const USAGE = `usage:
  floor.ts setup
      make the floor's invented card, persona and preset (what is missing of them) and a new chat;
      prints what it set and the chat's id
  floor.ts remove
      delete the floor chats, the card, the persona and the preset that setup made
  floor.ts run [--pairs N] [--only plain|rpe] [--form tag|two-step]
      play N pairs (default 10), plain then RPE, and print the §17.1 table;
      --form names the form RPE's connection replies in (required unless --only plain)
  floor.ts table <file> [--form tag|two-step]
      the table again from a run's FLOOR_OUT file (its own form unless --form is given)

environment, besides what scripts/testbed/README.md lists for every script:
  FLOOR_CHAT              the chat to play in (printed by setup)
  FLOOR_PLAIN_CONNECTION  the Lumiverse connection that calls the model directly, by name
  FLOOR_RPE_CONNECTION    the Lumiverse connection that points at RPE, by name
  FLOOR_RPE_URL           RPE's address, as its server listens (rpe status prints it)
  FLOOR_RPE_TOKEN         a token RPE's pages are let in with (rpe key web)
  FLOOR_OUT               where every turn's numbers and the table are written as JSON (optional)`;

/** How long RPE may take to tie a reply to its turn after Lumiverse saved it, and to end its run after the reply. */
const TIE_MS = 60_000;
const RUN_END_MS = 15 * 60_000;

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

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`set ${name}`);
  return value.trim();
}

const seconds = (ms: number | null): string => (ms === null ? "—" : (ms / 1000).toFixed(2));

async function connectionId(host: Lumiverse, name: string): Promise<string> {
  const found = (await host.connections()).filter((c) => c.name === name);
  if (found.length !== 1) throw new Error(`${found.length} connections are named "${name}"; the floor test needs exactly one`);
  return (found[0] as { id: string }).id;
}

/** One turn: the player's line, then Send on the given connection, timed from the page's side. */
async function turn(host: Lumiverse, socket: EngineSocket, chatId: string, connection: string, pair: number, arm: Measured["arm"], line: string, fixture: Fixture): Promise<Measured> {
  const out: Measured = { pair, arm, line, messageId: null, toStarted: null, toFirstThinking: null, toFirstWord: null, toLastWord: null, toEnded: null, thinkingChars: 0, replyChars: 0, tokens: null, error: null, rpe: null, rpeError: null };
  await host.send(chatId, fixture.persona.name, line);
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
    // The floor's own preset and persona, forced, on both connections alike (floor-fixture.ts).
    await host.call("POST", "/api/v1/generate", { chat_id: chatId, connection_id: connection, preset_id: fixture.preset.id, force_preset_id: true, persona_id: fixture.persona.id });
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

/** The page's side of every turn, as medians per connection. */
function report(all: readonly Measured[]): void {
  console.log("\narm    turns  failed  first word (s)  thinking before it (s)  ms per token  whole reply (s)");
  for (const arm of ["plain", "rpe"] as const) {
    const of = all.filter((m) => m.arm === arm);
    if (of.length === 0) continue;
    const good = of.filter((m) => m.error === null && m.toFirstWord !== null);
    const firstWord = median(good.map((m) => m.toFirstWord as number));
    const thinking = median(good.filter((m) => m.toFirstThinking !== null).map((m) => (m.toFirstWord as number) - (m.toFirstThinking as number)));
    const tokenMs = median(good.map(perToken).filter((v): v is number => v !== null));
    const whole = median(good.filter((m) => m.toEnded !== null).map((m) => m.toEnded as number));
    console.log(`${arm.padEnd(6)} ${String(of.length).padStart(5)}  ${String(of.length - good.length).padStart(6)}  ${seconds(firstWord).padStart(14)}  ${seconds(thinking).padStart(22)}  ${(tokenMs === null ? "—" : tokenMs.toFixed(1)).padStart(12)}  ${seconds(whole).padStart(15)}`);
  }
}

function printAll(all: readonly Measured[], form: Form | null): void {
  report(all);
  printRpeTurns(all);
  if (form !== null) printTable(floorTable(all, form));
}

async function open(env: TestbedEnv): Promise<Lumiverse> {
  return new Lumiverse(env.hostUrl, savedToken(env));
}

/** RPE's side of an RPE turn: the turn tied to the reply's message, read once its run has ended. */
async function readRpe(api: RpeApi, live: RpeLive, chatId: string, measured: Measured, missedBefore: number): Promise<void> {
  if (measured.messageId === null) {
    measured.rpeError = "the generation named no message to match an RPE turn by";
    return;
  }
  try {
    const tied = await api.tiedTo(chatId, measured.messageId, TIE_MS);
    if (tied === null) {
      measured.rpeError = `no RPE turn of this chat was tied to message ${measured.messageId} within ${TIE_MS / 1000} s`;
      return;
    }
    const detail = await api.ended(chatId, tied.id, RUN_END_MS);
    if (detail.status === "running") measured.rpeError = `RPE's run was still going ${RUN_END_MS / 60_000} min after the reply`;
    measured.rpe = rpeSide(detail, live.deltas, live.missed.length > missedBefore || live.closed);
  } catch (error) {
    measured.rpeError = error instanceof Error ? error.message : String(error);
  }
}

async function run(env: TestbedEnv, pairs: number, only: Measured["arm"] | null, form: Form | null): Promise<void> {
  const host = await open(env);
  const chatId = guard(env, need("FLOOR_CHAT"));
  const fixture = await findFixture(host);
  const arms: { arm: Measured["arm"]; connection: string }[] = [];
  if (only !== "rpe") arms.push({ arm: "plain", connection: await connectionId(host, need("FLOOR_PLAIN_CONNECTION")) });
  if (only !== "plain") arms.push({ arm: "rpe", connection: await connectionId(host, need("FLOOR_RPE_CONNECTION")) });
  if (pairs * arms.length > LINES.length) throw new Error(`${pairs} pairs need ${pairs * arms.length} lines and the script has ${LINES.length}`);
  const api = only === "plain" ? null : new RpeApi(need("FLOOR_RPE_URL").replace(/\/+$/, ""), need("FLOOR_RPE_TOKEN"));
  // Followed before the first turn: the live socket is the only place the start of a call's text is told.
  const live = api === null ? null : await RpeLive.follow(api, chatId);
  const socket = await EngineSocket.open(host, "", { page: false });
  // Reply text is streamed only to a socket that says it is showing this chat.
  socket.focus(chatId);
  const all: Measured[] = [];
  try {
    let next = 0;
    for (let pair = 1; pair <= pairs; pair++) {
      for (const { arm, connection } of arms) {
        const line = LINES[next++] as string;
        const missedBefore = live?.missed.length ?? 0;
        const measured = await turn(host, socket, chatId, connection, pair, arm, line, fixture);
        if (arm === "rpe" && api !== null && live !== null) await readRpe(api, live, chatId, measured, missedBefore);
        all.push(measured);
        const r = measured.rpe;
        const rpeWords = arm !== "rpe" ? "" : r !== null ? `; RPE: ${r.callsOnPath ?? "?"} call(s) before the reply, run went on ${seconds(r.afterReplyMs)} s after it` : "";
        const failed = [measured.error, measured.rpeError].filter((e) => e !== null).join("; ");
        console.log(`pair ${pair} ${arm}: first word ${seconds(measured.toFirstWord)} s, whole ${seconds(measured.toEnded)} s, ${measured.tokens ?? "?"} tokens${rpeWords}${failed !== "" ? `, FAILED: ${failed}` : ""}`);
      }
    }
  } finally {
    socket.close();
    live?.close();
  }
  printAll(all, form);
  const out = process.env.FLOOR_OUT?.trim();
  if (out) {
    const table = form === null ? null : floorTable(all, form);
    await Bun.write(out, `${JSON.stringify({ at: new Date().toISOString(), chat: chatId, pairs, only, form, turns: all, table }, null, 2)}\n`);
    console.log(`\nwritten to ${out}`);
  }
}

async function table(file: string, form: Form | null): Promise<void> {
  const saved = (await Bun.file(file).json()) as { form?: Form | null; turns?: Measured[] };
  if (!Array.isArray(saved.turns)) throw new Error(`${file} holds no turns: is it a floor run's FLOOR_OUT file?`);
  const use = form ?? saved.form ?? null;
  if (use === null) throw new Error(`${file} names no form (it was an --only plain run): give --form`);
  printAll(saved.turns, use);
}

type Command = { command: "help" } | { command: "setup" } | { command: "remove" } | { command: "run"; pairs: number; only: Measured["arm"] | null; form: Form | null } | { command: "table"; file: string; form: Form | null };

class UsageError extends Error {}

/** The command line, checked before anything is read from the environment or the network. */
function parse(argv: readonly string[]): Command {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") return { command: "help" };
  const allowed: Readonly<Record<string, readonly string[]>> = { setup: [], remove: [], run: ["--pairs", "--only", "--form"], table: ["--form"] };
  const flags = allowed[command];
  if (flags === undefined) throw new UsageError(`no command "${command}"`);
  const given = new Map<string, string>();
  const words: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i] as string;
    if (!word.startsWith("--")) {
      words.push(word);
      continue;
    }
    if (word === "--help" || word === "-h") return { command: "help" };
    if (!flags.includes(word)) throw new UsageError(`${command} takes no ${word}`);
    if (given.has(word)) throw new UsageError(`${word} is given twice`);
    const value = rest[++i];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${word} needs a value`);
    given.set(word, value);
  }
  const form = given.get("--form") ?? null;
  if (form !== null && form !== "tag" && form !== "two-step") throw new UsageError("--form takes tag or two-step");
  if (command === "setup" || command === "remove") {
    if (words.length > 0) throw new UsageError(`${command} takes nothing more`);
    return command === "setup" ? { command: "setup" } : { command: "remove" };
  }
  if (command === "table") {
    if (words.length !== 1) throw new UsageError("table takes one file: a run's FLOOR_OUT");
    return { command: "table", file: words[0] as string, form };
  }
  if (words.length > 0) throw new UsageError(`run takes no "${words[0]}"`);
  const pairs = given.has("--pairs") ? Number(given.get("--pairs")) : 10;
  if (!Number.isInteger(pairs) || pairs < 1) throw new UsageError("--pairs takes a whole number, 1 or more");
  const only = given.get("--only") ?? null;
  if (only !== null && only !== "plain" && only !== "rpe") throw new UsageError("--only takes plain or rpe");
  if (only !== "plain" && form === null) throw new UsageError("--form tag or --form two-step: say which form RPE's connection replies in");
  if (only === "plain" && form !== null) throw new UsageError("--form names RPE's form, and --only plain plays no RPE turn");
  return { command: "run", pairs, only, form };
}

let asked: Command;
try {
  asked = parse(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(`floor.ts: ${error.message}\n\n${USAGE}`);
  process.exit(2);
}
if (asked.command === "help") console.log(USAGE);
else if (asked.command === "table") await table(asked.file, asked.form);
else if (asked.command === "setup") await setupFixture(await open(readEnv()));
else if (asked.command === "remove") {
  const env = readEnv();
  await removeFixture(await open(env), env);
} else await run(readEnv(), asked.pairs, asked.only, asked.form);

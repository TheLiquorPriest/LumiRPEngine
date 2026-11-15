// How the floor is played (PlanGates-4 item 9, PlanGates-4-fix1; plan §17.1 l.1757): the same chat, preset
// and model; ten pairs, plain then RPE, each line sent through Lumiverse's chat page with the arm's
// connection chosen, each turn sent once the one before has ended, and on RPE once its run has ended too.
// A run still going at the floor's limit (`LIMITS.runEnd`) stops the floor: no pair is sent over a
// running run. The first word and the message's end are timed in the page by the host's browser driver;
// Lumiverse's socket events are kept as support, its `WORLD_INFO_ACTIVATED` as its own account of the
// lore; RPE's side is read from its routes and live socket once the run has ended, each read on its own.
//
// What the run stood on is `run.json`'s (`play.run`): the runner's standing, the Author's reply form and
// whether its connection streams (`agents[].replyForm`, `agents[].streams`). The floor adds only its
// own reasons for a trial, found before the first pair (`floorTrials`): with any of them every measured
// part goes to the runner as not judged, "trial: " and the reason, and the table prints the trial first
// and no verdict. A row the floor measures and cannot judge goes to the runner as not judged with why
// (`play.notJudged`, PlanScenarios-8 item 5), so the runner's report says why; a reported row goes with
// its figures, and one with no figure is not judged, never met.
//
// What the floor needs of a host, `FloorActs`, is what neither host's plan names in so many words: the
// moments of a reply timed in the page. The rig's host (PlanScenarios-2) and the bed's (PlanScenarios-3)
// give it in their acts; a host that does not makes the play stop, saying what is missing. What the play
// reads it reads through a `FloorReader`: `liveReader` over the acts' HTTP routes and sockets, or a
// recorded run in the floor's tests.
//
// The owner's connections, as an option (PlanGates-4-fix1 item 13; N-15): `FLOOR_OWNER_PLAIN` names a
// Lumiverse connection the plain arm plays on, and `FLOOR_OWNER_AUTHOR` the RPE connection the Author
// must run on, by the name its trace gives, both made beforehand through the pages by whoever holds the
// key. The script never takes a key. Without them only the floor's own connections are called.

import { resolve } from "node:path";
import { isRecord } from "../../../src/shared/json";
import type { Check, Play } from "../route/form";
import { standingOfRun, type RunRecord } from "../route/evidence";
import { findFixture, LINES } from "../../testbed/floor-fixture";
import { floorHead, floorTable, intentCrossCheck, LIMITS, PASS, pathCalls, tableText, type Arm, type FloorRun, type FloorTurn, type Form, type PageTimes, type RpeSide, type Row, type SocketTimes } from "../../testbed/floor-measure";
import { Lumiverse } from "../../testbed/lib/lumiverse";
import { RpeApi, RpeLive } from "../../testbed/lib/rpe";
import { EngineSocket, type HostEvent } from "../../testbed/lib/socket";
import type { ActivatedEntry, BookDesign } from "../lib/lore";
import { noteOf, renderFrame } from "../lib/frame";
import { LumiverseReader, RpeReader } from "../lib/read";
import { buildFrom, floorTrials, installedRph, standingLines, type BuildReader, type Observed } from "../lib/record";
import { keptRequest, leadOf, leadStart, recordTimes } from "../lib/turn";

/** What the floor plays with, from the host's acts. */
export interface FloorActs {
  /** Lumiverse's REST and event socket, as the run's user. */
  lumiverse: { base: string; token: string };
  /** RPE's routes and live socket, with a page token. */
  rpe: { base: string; token: string };
  /** The two Lumiverse connections, by id: plain generation calling the model directly, and RPE's. */
  connections: { plain: string; rpe: string };
  /** A fresh chat of the run's user on this card (on the bed, one the instance's record holds). */
  chat(card: string): Promise<string>;
  /** In the chat page: the connection chosen in the composer, the line typed, Send pressed under the floor's preset and persona; the reply's moments timed in the page. Resolves once its generation has ended. */
  send(chat: string, connection: string, line: string, as: { preset: string; persona: string }): Promise<PageTimes>;
}

/** The members of `FloorActs` a host's acts lack; empty when they give all. */
export function missingActs(acts: unknown): string[] {
  if (!isRecord(acts)) return ["every member (the host's acts are not an object)"];
  const out: string[] = [];
  for (const side of ["lumiverse", "rpe"] as const) {
    const v = acts[side];
    if (!isRecord(v) || typeof v.base !== "string" || typeof v.token !== "string") out.push(`${side}: its address and token`);
  }
  if (!isRecord(acts.connections) || typeof acts.connections.plain !== "string" || typeof acts.connections.rpe !== "string") out.push("connections: plain's and RPE's ids");
  if (typeof acts.chat !== "function") out.push("chat(card): a fresh chat");
  if (typeof acts.send !== "function") out.push("send(chat, connection, line, as): a line sent through the chat page, its reply timed in the page");
  return out;
}

/** The acts give all the floor plays with; `missingActs` says what they lack. */
export function isFloorActs(acts: unknown): acts is FloorActs {
  return missingActs(acts).length === 0;
}

export const CHAT_PAGE = "Lumiverse chat";
export const FILES_PAGE = "Files";

/** What the chat page check looks for, set by the play before it asks the runner to look: RPE's last reply, and every other message of the chat. */
const shown: { reply: string; others: string[] } = { reply: "", others: [] };

/** A text as a page's text gives it (the host's contract, `host.ts`): every run of white space one space. */
const spaced = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The first words of a reply, as the check names them in its screen: enough to be its own, few enough to show in a narrow window. */
const opening = (text: string): string => spaced(text).split(" ").slice(0, 6).join(" ");

/** Whether a page's text shows `reply` whole as its last message: the reply's whole text is there, and no other message of the chat comes after it. */
export function replyIsLast(page: string, reply: string, others: readonly string[]): boolean {
  const text = spaced(page);
  const whole = spaced(reply);
  if (whole === "") return false;
  const at = text.lastIndexOf(whole);
  if (at === -1) return false;
  const end = at + whole.length;
  return others.every((other) => {
    const words = spaced(other);
    return words === "" || words === whole || text.indexOf(words, end) === -1;
  });
}

/**
 * The chat page shows the last turn's reply, RPE's, as its last message, by its whole text. A shot counts
 * only the text visible in its image, and a chat page opens on its newest message, so the check names
 * that message's first words as what the screen shows.
 */
export const seeReplies: Check = async (look) => {
  if (shown.reply === "") throw new Error("the play reached the chat page with no reply to look for");
  const page = await look.read();
  return replyIsLast(page, shown.reply, shown.others) ? { found: true, shows: [opening(shown.reply)], what: "the last turn's reply, RPE's, whole, as the chat page's last message" } : { found: false, what: `RPE's last reply, whole, is not the chat page's last message (it begins "${opening(shown.reply)}")` };
};

/** The Files page's stack view of the floor's chat names the Author's parts that sit in the opening block (RPE `src/ui/pages/files.tsx:640-676`). */
export const seeStack: Check = async (look) => {
  await look.type({ label: "Agent" }, "author");
  await look.waitFor({ text: "in the opening block" });
  const section = await look.read("An agent's stack");
  return section.includes("in the opening block") ? { found: true, shows: ["in the opening block"], what: "the Author's stack, its parts in the opening block" } : { found: false, what: "the stack view shows no part of the Author's opening block" };
};

/** What the floor found of its chat before the first pair. */
export interface Ground {
  observed: Observed;
  /** The plain arm's connection, as Lumiverse holds it. */
  plain: Arm;
  history: RpeSide["history"];
  /** `limits.previousRun` as RPE's settings give it for the chat, in seconds. */
  previousRun: number | null;
}

/** One turn as read back: what the page timed, Lumiverse told, Lumiverse counted, and RPE's side. */
export type TurnRead = Pick<FloorTurn, "page" | "socket" | "visible" | "visibleWhy" | "rpe" | "error">;

/** What the play reads, and how one line is sent and read back. */
export interface FloorReader {
  /** The fixture setup made: its preset, persona, card and book. */
  fixture(): Promise<{ preset: { id: string }; persona: { id: string }; card: { id: string }; book: BookDesign }>;
  /** The chat's ground before the first pair, and whatever must listen from then on. */
  ground(chat: string, plainConnection: string, preset: string): Promise<Ground>;
  /** One line: sent by `send`; Lumiverse's end heard (at most `LIMITS.afterEnd` after the page's); its shown text counted for `model`; on RPE, its side once its run has ended (at most `LIMITS.runEnd`). */
  turn(chat: string, arm: "plain" | "rpe", send: () => Promise<PageTimes>, history: RpeSide["history"], model: string | null): Promise<TurnRead>;
  /** The chat's messages, for the page check. */
  messages(chat: string): Promise<{ id: string; content: string }[]>;
  close(): void;
}

/** The owner's connections given by option, or null; refused when only one is named. */
export function optionOf(env: Record<string, string | undefined>): { plain: string; rpe: string } | null {
  const plain = env.FLOOR_OWNER_PLAIN?.trim() || null;
  const rpe = env.FLOOR_OWNER_AUTHOR?.trim() || null;
  if (plain === null && rpe === null) return null;
  if (plain === null || rpe === null) throw new Error("the owner's connections are an option of both arms: set FLOOR_OWNER_PLAIN (Lumiverse's connection for plain generation) and FLOOR_OWNER_AUTHOR (RPE's connection the Author runs on) together, or neither");
  return { plain, rpe };
}

/** The Author's reply form and streaming as `run.json` gives them (`agents[].replyForm`, `agents[].streams`); a form it does not give is named. */
export function authorOf(run: RunRecord): { form: Form; formWhy: string | null; streams: boolean } {
  const author = run.agents.find((a) => a.agent === "author");
  if (author === undefined) return { form: "tag", formWhy: "run.json names no Author among its agents, so its reply form is not known", streams: false };
  if (author.replyForm === "two-step") return { form: "two-step", formWhy: null, streams: author.streams };
  if (author.replyForm === "tags") return { form: "tag", formWhy: null, streams: author.streams };
  return { form: "tag", formWhy: `run.json gives the Author's reply form as "${author.replyForm}", which is neither the tags nor the two-step form`, streams: author.streams };
}

/** RPE's repository: the build's shipped tree is laid from it where `run.json` gives no account of it. */
const RPE_ROOT = resolve(import.meta.dir, "..", "..", "..");

/** Plays the floor's ten pairs and judges its rows (both forms: the host decides where they are played). */
export async function playFloor(play: Play): Promise<void> {
  if (!isFloorActs(play.acts)) throw new Error(`the host's acts do not give what the floor plays with (PlanScenarios-2's rig host, PlanScenarios-3's bed host): ${missingActs(play.acts).join("; ")}`);
  const option = optionOf(process.env);
  const reader = liveReader(play.acts);
  try {
    await playWith(play, play.acts, reader, option, buildFrom(RPE_ROOT, installedRph(RPE_ROOT)));
  } finally {
    reader.close();
  }
}

/** The floor's play over a reader: the pairs, the table kept, every part to the runner. Gives the run as the table read it. */
export async function playWith(play: Play, acts: FloorActs, reader: FloorReader, option: { plain: string; rpe: string } | null, build: BuildReader | null): Promise<FloorRun> {
  const fixture = await reader.fixture();
  const chat = await acts.chat(fixture.card.id);
  const plainConnection = option?.plain ?? acts.connections.plain;
  const ground = await reader.ground(chat, plainConnection, fixture.preset.id);
  await play.keep("observed", { ...ground.observed });
  const trials = floorTrials(play.run, ground.observed, build);
  const author = authorOf(play.run);
  const turns: FloorTurn[] = [];
  let stopped: string | null = null;
  let next = 0;
  for (let pair = 1; pair <= PASS.pairs && stopped === null; pair++) {
    for (const arm of ["plain", "rpe"] as const) {
      const line = LINES[next++];
      if (line === undefined) throw new Error(`the fixture has ${LINES.length} lines and ${PASS.pairs} pairs need ${PASS.pairs * 2}`);
      const connection = arm === "plain" ? plainConnection : acts.connections.rpe;
      const read = await reader.turn(chat, arm, () => acts.send(chat, connection, line, { preset: fixture.preset.id, persona: fixture.persona.id }), ground.history, ground.plain.model);
      turns.push({ pair, arm, line, ...read });
      if (read.rpe?.status === "running") stopped = `pair ${pair}: RPE's run was still going ${LIMITS.runEnd / 60_000} min after the reply (LIMITS.runEnd), so no later pair was sent over it`;
    }
  }
  const lead = turns.find((t) => t.rpe !== null)?.rpe;
  const start = lead ? leadStart(lead.trace) : null;
  const run: FloorRun = {
    ...author,
    plain: ground.observed.plain === null ? null : { ...ground.observed.plain, model: ground.plain.model ?? "" },
    arms: { plain: ground.plain, rpe: { connection: start?.connection ?? acts.connections.rpe, provider: null, model: start?.model ?? null } },
    option,
    previousRun: ground.previousRun,
    book: fixture.book,
    trials,
    stopped,
    turns,
  };
  await play.keep("turns", { ...run });
  const rows = floorTable(run);
  const trial = trials.length > 0 || standingOfRun(play.run).is === "trial";
  await play.keep("table.txt", tableText(rows, [...standingLines(play.run), ...floorHead(run)], trial, intentCrossCheck(run)));
  await judge(play, run, rows);
  const messages = await reader.messages(chat);
  const last = turns.filter((t) => t.arm === "rpe").at(-1);
  const reply = last?.socket.messageId === undefined || last.socket.messageId === null ? undefined : messages.find((m) => m.id === last.socket.messageId);
  shown.reply = reply?.content ?? "";
  shown.others = messages.filter((m) => m !== reply).map((m) => m.content);
  await play.see("replies-shown");
  await play.see("stack-shown");
  return run;
}

/** A row's figures and what they stand on, as the runner's report carries them. */
const figures = (row: Row): string => `${row.measured}; stands on ${row.stands}`;

/**
 * Each row to the runner: with the floor's own trial, every measured part not judged, "trial: " and why;
 * else pass or fail as judged, a reported row met with its figures, a row not judged with why. Calls are
 * judged turn by turn, as the plan's share is counted.
 */
export async function judge(play: Pick<Play, "judge" | "notJudged">, run: FloorRun, rows: readonly Row[]): Promise<void> {
  if (run.trials.length > 0) {
    for (const row of rows) await play.notJudged(row.id, `trial: ${run.trials.join("; ")}; figures: ${figures(row)}`);
    return;
  }
  for (const row of rows) {
    if (row.verdict === "not judged") {
      await play.notJudged(row.id, `${row.why.join("; ")}; figures: ${figures(row)}`);
      continue;
    }
    if (row.id === "calls") continue;
    await play.judge(row.id, { pass: row.verdict !== "fail", what: `${row.verdict}: ${figures(row)}` });
  }
  const calls = rows.find((r) => r.id === "calls");
  if (calls === undefined || calls.verdict === "not judged") return;
  const want = PASS.calls[run.form];
  for (const t of run.turns.filter((x) => x.arm === "rpe")) {
    const counted = pathCalls(run, t);
    await play.judge("calls", { pass: "calls" in counted && counted.calls === want, what: `pair ${t.pair}: ${"calls" in counted ? `${counted.calls} call(s) on the reply's path` : counted.none}` });
  }
}

/** Lumiverse's socket events of one generation, kept as support, with its own account of the lore it activated. */
function listen(socket: EngineSocket, chat: string): { times: SocketTimes; done: Promise<void>; stop: () => void } {
  const times: SocketTimes = { started: null, firstReasoning: null, firstToken: null, lastToken: null, ended: null, tokens: null, messageId: null, error: null, lore: null };
  let counted = false;
  let stored = false;
  const { promise, resolve: settle } = Promise.withResolvers<void>();
  const check = () => {
    if (times.ended !== null && counted && stored) settle();
  };
  const stop = socket.onEvent((e: HostEvent) => {
    if (e.payload.chatId !== chat) return;
    if (e.event === "GENERATION_STARTED") times.started ??= e.at;
    else if (e.event === "STREAM_TOKEN_RECEIVED" && typeof e.payload.token === "string" && e.payload.token !== "") {
      if (e.payload.type === "reasoning") times.firstReasoning ??= e.at;
      else {
        times.firstToken ??= e.at;
        times.lastToken = e.at;
      }
    } else if (e.event === "WORLD_INFO_ACTIVATED" && Array.isArray(e.payload.entries)) {
      times.lore = e.payload.entries.flatMap((entry): ActivatedEntry[] => (isRecord(entry) && typeof entry.id === "string" ? [{ id: entry.id, book: typeof entry.bookId === "string" ? entry.bookId : null, title: typeof entry.comment === "string" ? entry.comment : "", source: entry.source === "vector" ? "vector" : "keyword" }] : []));
    } else if (e.event === "GENERATION_ENDED") {
      times.ended ??= e.at;
      if (typeof e.payload.messageId === "string") times.messageId = e.payload.messageId;
      if (e.payload.error) {
        times.error = String(e.payload.error);
        counted = stored = true;
      }
    } else if (e.event === "GENERATION_METRICS_READY") {
      if (typeof e.payload.tokenCount === "number") times.tokens = e.payload.tokenCount;
      counted = true;
    } else if (e.event === "GENERATION_BREAKDOWN_READY") stored = true;
    check();
  });
  return { times, done: promise, stop };
}

const words = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** RPE's side of a turn once its run has ended, from its routes and the live socket's pieces, each read on its own. */
async function rpeSide(api: RpeApi, reader: RpeReader, lumiverse: LumiverseReader, live: RpeLive, chat: string, messageId: string | null, missedBefore: number, history: RpeSide["history"]): Promise<{ side: RpeSide | null; error: string | null }> {
  if (messageId === null) return { side: null, error: "the generation named no message to match an RPE turn by" };
  const tied = await api.tiedTo(chat, messageId, LIMITS.tie);
  if (tied === null) return { side: null, error: `no RPE turn of this chat was tied to message ${messageId} within ${LIMITS.tie / 1000} s (LIMITS.tie)` };
  // The route's own answer: `timings` carries `intent` and `thinking` where RPE serves them (read by `recordTimes`).
  const detail = await api.ended(chat, tied.id, LIMITS.runEnd);
  const missing: RpeSide["missing"] = {};
  const lead = leadOf(detail.trace);
  let request = null;
  try {
    const kept = detail.runs?.[0]?.requests.find((r) => r.agent === lead?.id && r.call === 1);
    if (kept === undefined) missing.request = "RPE kept no first request of the lead (its trace.requests setting, or an older turn shape)";
    else request = keptRequest(await reader.turnFile(chat, tied.id, kept.file));
  } catch (error) {
    missing.request = `the lead's kept request could not be read: ${words(error)}`;
  }
  let stored = null;
  try {
    stored = await lumiverse.stored(messageId);
    if (stored === null) missing.stored = `Lumiverse stored no prompt with message ${messageId}`;
  } catch (error) {
    missing.stored = `Lumiverse's stored prompt could not be read: ${words(error)}`;
  }
  let rows = null;
  try {
    rows = await lumiverse.rows(chat);
  } catch (error) {
    missing.rows = `the chat's rows could not be read: ${words(error)}`;
  }
  let entries = null;
  try {
    const got = await reader.lore(chat, tied.id);
    if (got === "not served") missing.lore = "RPE's lore route is not served (PlanLore-13)";
    else entries = got;
  } catch (error) {
    missing.lore = `RPE's lore route could not be read: ${words(error)}`;
  }
  const map = Array.isArray(detail.lore?.map) ? detail.lore.map : null;
  if (map === null) missing.lore ??= "the turn route gives no lore map (an older turn shape)";
  return {
    side: { turn: tied.id, status: detail.status, timings: detail.timings, record: recordTimes(detail.timings), trace: detail.trace, deltas: live.deltas.filter((d) => d.run === tied.id), deltasMissed: live.missed.length > missedBefore || live.closed, request, stored, rows, history, lore: { map: map ?? [], entries }, missing },
    error: null,
  };
}

/** The reader over the acts' routes and sockets: Lumiverse's REST and event socket, RPE's routes and live socket. */
export function liveReader(acts: FloorActs): FloorReader {
  const host = new Lumiverse(acts.lumiverse.base, acts.lumiverse.token);
  const lumiverse = new LumiverseReader(host);
  const reader = new RpeReader(acts.rpe.base, acts.rpe.token);
  const api = new RpeApi(acts.rpe.base, acts.rpe.token);
  let socket: EngineSocket | null = null;
  let live: RpeLive | null = null;
  return {
    fixture: () => findFixture(host),
    async ground(chat, plainConnection, preset) {
      const trees = await reader.trees(chat);
      const plain = await lumiverse.plain(plainConnection, preset);
      const arm = await lumiverse.connection(plainConnection);
      const settings = await reader.settings(chat);
      const setting = (key: string) => settings.settings.find((s) => s.key === key)?.value;
      const whole = (value: unknown) => (typeof value === "number" ? value : null);
      // The framing line RPH sends immediately before the prompt (plan §10.2 l.1160): the chat's own file where it has one, as RPH renders it.
      const file = (await reader.view(chat)).find((f) => f.applies && f.path.endsWith(".prompts/prompt-frame.md"));
      let framing: string | null = null;
      let framingNote: string | null = null;
      let framingWhy: string | null = null;
      if (file === undefined) framingWhy = "the chat's view holds no prompt-frame.md in force";
      else {
        const rendered = await renderFrame(await reader.viewFile(chat, file.path));
        if ("none" in rendered) framingWhy = rendered.none;
        else {
          framing = rendered.text;
          const note = await noteOf(rendered.text);
          if ("none" in note) framingWhy = `the frame sent as a note is not known: ${note.none}`;
          else framingNote = note.text;
        }
      }
      live = await RpeLive.follow(api, chat);
      socket = await EngineSocket.open(host, "", { page: false });
      // Reply text is streamed only to a socket that says it is showing this chat.
      socket.focus(chat);
      return {
        observed: { plain, shipped: trees.shipped, layers: trees.layers, off: trees.off },
        plain: { connection: plainConnection, provider: arm.provider, model: arm.model },
        history: { keep: whole(setting("history.window")), step: whole(setting("history.step")), hold: setting("history.hold.on") === true ? whole(setting("history.hold.cap")) : null, framing, framingNote, framingWhy },
        previousRun: whole(setting("limits.previousRun")),
      };
    },
    async turn(chat, arm, send, history, model) {
      if (socket === null || live === null) throw new Error("the floor's sockets are not open: its ground was not read first");
      const missedBefore = live.missed.length;
      const heard = listen(socket, chat);
      const out: TurnRead = { page: null, socket: heard.times, visible: null, visibleWhy: null, rpe: null, error: null };
      try {
        out.page = await send();
        await Promise.race([heard.done, Bun.sleep(LIMITS.afterEnd)]);
        if (heard.times.error !== null) out.error = heard.times.error;
        else if (heard.times.ended === null) out.error = `Lumiverse told no end of the generation within ${LIMITS.afterEnd / 1000} s after the page's end (LIMITS.afterEnd)`;
        else {
          const id = heard.times.messageId;
          const text = id === null ? undefined : (await host.messages(chat)).find((m) => m.id === id)?.content;
          if (model === null) out.visibleWhy = "the plain arm's connection names no model, so the shown reply is counted by none";
          else if (text === undefined) out.visibleWhy = "the reply's saved message was not found, so its shown text was not counted";
          else {
            try {
              out.visible = await lumiverse.visibleTokens(model, text);
            } catch (error) {
              out.visibleWhy = `Lumiverse's count of the shown reply failed: ${words(error)}`;
            }
          }
          if (arm === "rpe") {
            const got = await rpeSide(api, reader, lumiverse, live, chat, id, missedBefore, history);
            out.rpe = got.side;
            out.error = got.error;
          }
        }
      } catch (error) {
        out.error = words(error);
      } finally {
        heard.stop();
      }
      return out;
    },
    messages: (chat) => host.messages(chat),
    close() {
      socket?.close();
      live?.close();
    },
  };
}

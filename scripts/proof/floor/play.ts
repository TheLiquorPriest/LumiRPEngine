// How the floor is played (PlanGates-4 item 9; plan §17.1 l.1757): the same chat, preset and model; ten
// pairs, plain then RPE, each line sent through Lumiverse's chat page with the arm's connection chosen,
// each turn sent once the one before has ended (on RPE, once its run has ended too). The first word and the
// message's end are timed in the page by the host's browser driver; Lumiverse's socket events are kept as
// support; RPE's side is read from its routes and live socket once the run has ended. Then the table.
//
// What the floor needs of a host, `FloorActs`, is what neither host's plan names in so many words: the
// moments of a reply timed in the page. The rig's host (PlanScenarios-2) and the bed's (PlanScenarios-3)
// give it in their acts; a host that does not makes the play stop, saying what is missing.

import { isRecord } from "../../../src/shared/json";
import type { Check, Play } from "../route/form";
import { findFixture, LINES } from "../../testbed/floor-fixture";
import { floorTable, intentCrossCheck, PASS, pathCalls, tableText, type FloorRun, type FloorTurn, type PageTimes, type RpeSide, type Row, type SocketTimes } from "../../testbed/floor-measure";
import { Lumiverse } from "../../testbed/lib/lumiverse";
import { RpeApi, RpeLive } from "../../testbed/lib/rpe";
import { EngineSocket, type HostEvent } from "../../testbed/lib/socket";
import { LumiverseReader, RpeReader } from "../lib/read";
import { guidanceOf, type Observed } from "../lib/record";
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

/** What the seen parts look for, set by the play before it asks the runner to look. */
const shown: { replies: string[] } = { replies: [] };

/** The first words of a reply, as a check names them: enough to be its own, few enough to show in a narrow window. */
const opening = (text: string): string => text.trim().split(/\s+/).slice(0, 6).join(" ");

/**
 * The chat page shows the last turn's reply, RPE's, by its first words. A shot counts only the text visible
 * in its image, and a chat page opens on its newest message, so the check names that one: the plain reply
 * before it may sit above the fold at a phone's width.
 */
export const seeReplies: Check = async (look) => {
  const words = shown.replies.slice(-1).map(opening).filter((w) => w !== "");
  if (words.length === 0) throw new Error("the play reached the chat page with no reply to look for");
  const page = await look.read();
  const missing = words.filter((w) => !page.includes(w));
  return missing.length === 0 ? { found: true, shows: words, what: "the last turn's reply, RPE's, on the chat page" } : { found: false, what: `not on the chat page: ${missing.map((w) => `"${w}"`).join(", ")}` };
};

/** The Files page's stack view of the floor's chat names the Author's parts that sit in the opening block (RPE `src/ui/pages/files.tsx:640-676`). */
export const seeStack: Check = async (look) => {
  await look.type({ label: "Agent" }, "author");
  await look.waitFor({ text: "in the opening block" });
  const section = await look.read("An agent's stack");
  return section.includes("in the opening block") ? { found: true, shows: ["in the opening block"], what: "the Author's stack, its parts in the opening block" } : { found: false, what: "the stack view shows no part of the Author's opening block" };
};

/** How long the floor waits for what a turn leaves behind it, at most (a limit of the proof script, not of the product): Lumiverse's count and stored prompt after the end, RPE tying the reply, RPE's run ending. */
const LIMITS = { afterEnd: 30_000, tie: 60_000, runEnd: 15 * 60_000 } as const;

/** Lumiverse's socket events of one generation, kept as support. */
function listen(socket: EngineSocket, chat: string): { times: SocketTimes; done: Promise<void>; stop: () => void } {
  const times: SocketTimes = { started: null, firstReasoning: null, firstToken: null, lastToken: null, ended: null, tokens: null, messageId: null, error: null };
  let counted = false;
  let stored = false;
  const { promise, resolve } = Promise.withResolvers<void>();
  const settle = () => {
    if (times.ended !== null && counted && stored) resolve();
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
    settle();
  });
  return { times, done: promise, stop };
}

/** RPE's side of a turn once its run has ended, from its routes and the live socket's pieces. */
async function rpeSide(api: RpeApi, reader: RpeReader, lumiverse: LumiverseReader, live: RpeLive, chat: string, messageId: string | null, missedBefore: number, history: RpeSide["history"]): Promise<{ side: RpeSide | null; error: string | null }> {
  if (messageId === null) return { side: null, error: "the generation named no message to match an RPE turn by" };
  const tied = await api.tiedTo(chat, messageId, LIMITS.tie);
  if (tied === null) return { side: null, error: `no RPE turn of this chat was tied to message ${messageId} within ${LIMITS.tie / 1000} s` };
  // The route's own answer: `timings` carries `intent` and `thinking` where RPE serves them (read by `recordTimes`).
  const detail = await api.ended(chat, tied.id, LIMITS.runEnd);
  const problems: string[] = [];
  if (detail.status === "running") problems.push(`RPE's run was still going ${LIMITS.runEnd / 60_000} min after the reply`);
  const lead = leadOf(detail.trace);
  const kept = detail.runs[0]?.requests.find((r) => r.agent === lead?.id && r.call === 1);
  let request = null;
  if (kept === undefined) problems.push("RPE kept no first request of the lead (its trace.requests setting)");
  else request = keptRequest(await reader.turnFile(chat, tied.id, kept.file));
  const stored = await lumiverse.stored(messageId);
  if (stored === null) problems.push(`Lumiverse stored no prompt with message ${messageId}`);
  const entries = await reader.lore(chat, tied.id);
  return {
    side: {
      turn: tied.id,
      status: detail.status,
      timings: detail.timings,
      record: recordTimes(detail.timings),
      trace: detail.trace,
      deltas: live.deltas.filter((d) => d.run === tied.id),
      deltasMissed: live.missed.length > missedBefore || live.closed,
      request,
      stored,
      rows: await lumiverse.rows(chat),
      history,
      lore: { activated: detail.lore.activated, map: detail.lore.map, entries },
      problems,
    },
    error: null,
  };
}

/** Plays the floor's ten pairs and judges its rows (both forms: the host decides where they are played). */
export async function playFloor(play: Play): Promise<void> {
  if (!isFloorActs(play.acts)) throw new Error(`the host's acts do not give what the floor plays with (PlanScenarios-2's rig host, PlanScenarios-3's bed host): ${missingActs(play.acts).join("; ")}`);
  const acts = play.acts;
  const host = new Lumiverse(acts.lumiverse.base, acts.lumiverse.token);
  const lumiverse = new LumiverseReader(host);
  const reader = new RpeReader(acts.rpe.base, acts.rpe.token);
  const api = new RpeApi(acts.rpe.base, acts.rpe.token);
  const fixture = await findFixture(host);
  const chat = await acts.chat(fixture.card.id);
  const trees = await reader.trees(chat);
  const plain = await lumiverse.plain(acts.connections.plain, fixture.preset.id);
  const observed: Observed = { shipped: trees.shipped, layers: trees.layers, plain };
  // The record's addition is written from this after the run (`scripts/proof/lib/record.ts`).
  await play.keep("observed", { ...observed });
  const settings = await reader.settings(chat);
  const setting = (key: string) => settings.settings.find((s) => s.key === key)?.value;
  const streamAnyway = setting("reply.streamAnyway");
  const previousRun = setting("limits.previousRun");
  const whole = (value: unknown) => (typeof value === "number" ? value : null);
  // The framing line RPH sends between the opening block and Lumiverse's first message (plan §10.2 l.1160): the chat's own file where it has one.
  const frame = (await reader.view(chat)).find((f) => f.applies && f.path.endsWith(".prompts/prompt-frame.md"));
  const history: RpeSide["history"] = { keep: whole(setting("history.window")), step: whole(setting("history.step")), hold: setting("history.hold.on") === true ? whole(setting("history.hold.cap")) : null, framing: frame ? await reader.viewFile(chat, frame.path) : null };
  const live = await RpeLive.follow(api, chat);
  const socket = await EngineSocket.open(host, "", { page: false });
  // Reply text is streamed only to a socket that says it is showing this chat.
  socket.focus(chat);
  const turns: FloorTurn[] = [];
  try {
    let next = 0;
    for (let pair = 1; pair <= PASS.pairs; pair++) {
      for (const arm of ["plain", "rpe"] as const) {
        const line = LINES[next++];
        if (line === undefined) throw new Error(`the fixture has ${LINES.length} lines and ${PASS.pairs} pairs need ${PASS.pairs * 2}`);
        const missedBefore = live.missed.length;
        const heard = listen(socket, chat);
        const turn: FloorTurn = { pair, arm, line, page: null, socket: heard.times, rpe: null, error: null };
        try {
          turn.page = await acts.send(chat, acts.connections[arm], line, { preset: fixture.preset.id, persona: fixture.persona.id });
          await Promise.race([heard.done, Bun.sleep(LIMITS.afterEnd)]);
          if (heard.times.error !== null) turn.error = heard.times.error;
          else if (arm === "rpe") {
            const got = await rpeSide(api, reader, lumiverse, live, chat, heard.times.messageId, missedBefore, history);
            turn.rpe = got.side;
            turn.error = got.error;
          }
        } catch (error) {
          turn.error = error instanceof Error ? error.message : String(error);
        } finally {
          heard.stop();
        }
        turns.push(turn);
      }
    }
  } finally {
    socket.close();
    live.close();
  }
  const author = turns.find((t) => t.rpe !== null)?.rpe;
  const form = author ? (author.trace.find((r) => r.event.kind === "released" && r.event.release.form === "message") ? "two-step" : "tag") : "tag";
  const connection = author ? leadStart(author.trace)?.connection : undefined;
  const run: FloorRun = { form, streamed: Array.isArray(streamAnyway) && connection !== undefined && streamAnyway.includes(connection), plain, previousRun: typeof previousRun === "number" ? previousRun : null, book: fixture.book, turns };
  await play.keep("turns", { ...run });
  const rows = floorTable(run);
  const guidance = observed.layers.flatMap(guidanceOf);
  await play.keep("table.txt", tableText(rows, guidance.length > 0 ? [`TRIAL: no verdict. A layer of the user's own holds guidance: ${guidance.join(", ")}.`] : ["The run's standing is written beside run.json after the run (scripts/proof/lib/record.ts)."], guidance.length > 0, intentCrossCheck(run)));
  // A run whose agents did not run under the shipped guidance judges nothing (record.ts writes why).
  if (guidance.length > 0) return;
  await judge(play, run, rows);
  const lastPair = turns.filter((t) => t.pair === PASS.pairs);
  shown.replies = await Promise.all(lastPair.map(async (t) => (t.socket.messageId === null ? "" : ((await host.messages(chat)).find((m) => m.id === t.socket.messageId)?.content ?? ""))));
  await play.see("replies-shown");
  await play.see("stack-shown");
}

/** Each row's verdict to the runner: pass or fail as judged; a reported row met with its figures; a row not judged left unjudged. Calls are judged turn by turn, as the plan's share is counted. */
async function judge(play: Play, run: FloorRun, rows: readonly Row[]): Promise<void> {
  for (const row of rows) {
    if (row.id === "intake" || row.id === "calls") continue;
    if (row.verdict === "not judged") continue;
    await play.judge(row.id, { pass: row.verdict !== "fail", what: `${row.verdict === "reported" ? "reported" : row.verdict}: ${row.measured}` });
  }
  const want = PASS.calls[run.form];
  for (const t of run.turns.filter((x) => x.arm === "rpe")) {
    const counted = pathCalls(run, t);
    await play.judge("calls", { pass: "calls" in counted && counted.calls === want, what: `pair ${t.pair}: ${"calls" in counted ? `${counted.calls} call(s) on the reply's path` : counted.none}` });
  }
}

// The Sessions page's routes (plan §11, §4.4 "sessions"): a chat's sessions, a page at a time; one session with what its next turn
// would carry and its compactions; the Author's scene closed by him, and that taken back; a compaction asked for, and one undone; and
// the session measurement's reports (§11: the script that plays one scene in each carry mode and counts what each costs and buys),
// which the test-bed script sends and the page shows beside the mode in force. A report is kept whole as it came, and every one is kept.
// Every route is a page's: it answers only for the user this RPE belongs to.
//
// Closing a scene is his change (§6.3 l.632, §10.10): the close is written in the story record as his own, placed after the chat's
// newest turn, and then RPH is told with that turn (`sessions.close` by the user), so the turn's Undo, a swipe or a delete of that
// turn takes the closing back. Nothing is closed while a turn of the chat runs, since that turn reads the record the close changes.

import type { Database } from "bun:sqlite";
import type { Carry, CompactionView, Log, SessionView } from "rp-harness/contract";
import { type Exactly, type Holds, type Infer, route, RouteError, shape } from "../app";
import type { WriteQueue } from "../app/database";
import { portTexts, readConfig } from "../app/config-read";
import { harnessSettings } from "../app/setting-list";
import { SETTINGS as RPH_SETTINGS } from "rp-harness/helpers";
import { closeOpenScene } from "../story";
import type { UserStore } from "../store";
import type { Turns } from "./lane";
import { globalConfig } from "./settings";

const T = shape.text();
const N = shape.number();
const opt = shape.optional;
const nullable = shape.nullable;

/** A session's fields as RPH gives them (`SessionView`); the page's `SessionShown` adds the scene a scene's session was opened for. */
const sessionFields = {
  id: T,
  user: T,
  chat: T,
  kind: shape.oneOf("scene", "agent", "job", "talk"),
  parent: opt(shape.union(shape.object({ session: opt(T), turn: opt(T), agent: T, call: T }), shape.object({ owner: shape.literal(true) }))),
  agent: opt(T),
  offPath: opt(shape.literal(true)),
  state: shape.oneOf("open", "closed"),
  opened: N,
  closedBy: opt(T),
  by: opt(shape.literal("user")),
  from: opt(shape.object({ chat: T, session: T, turn: T })),
  turns: N,
  compactAsked: opt(shape.literal(true)),
  held: opt(shape.object({ hook: T, reason: T })),
  hooked: opt(T),
};
const sessionBase = shape.object(sessionFields);
type SessionMirrored = Holds<Exactly<Infer<typeof sessionBase>, SessionView>>;

const sessionClosing = shape.named(
  "SessionClosing",
  "What closed a closed session and when: you (your own close), a turn (a scene changing at it), the end of an agent's or a talk's run, or the end of a job; and the time, in milliseconds since 1970, null where RPE holds none (a session its own record does not date).",
  shape.object({ by: shape.oneOf("you", "turn", "run", "job"), at: nullable(N) }),
);

const sessionShown = shape.named(
  "SessionShown",
  "A session as the Sessions page shows it: a scene's, a sub-agent's run, a job's run or a talk thread; open or closed, the turn that closed it (for his own close, the chat's newest turn when he closed it), what closed it and when, a compaction asked for that waits for its next turn, and, for a scene's, the id of the story record's scene it was opened for.",
  shape.object({ ...sessionFields, scene: opt(T), closing: opt(sessionClosing) }),
);

/**
 * What closed a closed session and when, from RPE's own records, since RPH's view has no time of closing: your own close is dated by the change that
 * closed the scene in the story record; a job's end by the job's record; a turn's or a run's by the end of the turn's run that closed it (its start
 * where it has no end). Nothing for an open session. A session no record dates is given without a time.
 */
export function closingOf(db: Database, user: string, view: SessionView, scene: string | undefined): Infer<typeof sessionClosing> | undefined {
  if (view.state !== "closed") return undefined;
  if (view.by === "user") {
    const change = scene === undefined || scene === "" ? null : db.query<{ created: number }, [string, string]>("SELECT created FROM change WHERE user = ? AND lane = 'story' AND by = 'player' AND json_extract(value, '$.item') = ? AND json_extract(value, '$.value.close') = 1 ORDER BY id DESC LIMIT 1").get(user, scene);
    return { by: "you", at: change?.created ?? null };
  }
  if (view.closedBy === undefined) return { by: view.kind === "scene" ? "turn" : "run", at: null };
  const job = db.query<{ ended: number | null }, [string, string]>("SELECT ended FROM job WHERE user = ? AND id = ?").get(user, view.closedBy);
  if (job !== null) return { by: "job", at: job.ended };
  const run = db.query<{ at: number | null }, [string, string]>("SELECT COALESCE(ended, received) AS at FROM turn_run WHERE user = ? AND turn = ? ORDER BY received DESC LIMIT 1").get(user, view.closedBy);
  return { by: view.kind === "scene" ? "turn" : "run", at: run?.at ?? null };
}

const compactionShown = shape.named(
  "CompactionShown",
  "A compaction of a session: its summary, the turn whose work it was, what it stands for, why it was made, its size before and after in tokens, and whether it still stands; one he undid is marked.",
  shape.object({
    id: T,
    turn: T,
    summary: T,
    at: N,
    of: shape.oneOf("turns", "run"),
    turns: shape.list(T),
    reason: opt(shape.oneOf("would-not-fit", "refused", "asked", "fold")),
    before: opt(N),
    after: opt(N),
    stands: shape.yesNo(),
    undone: opt(shape.literal(true)),
  }),
);
type CompactionMirrored = Holds<Exactly<Infer<typeof compactionShown>, CompactionView>>;

const carryMode = shape.named("CarryMode", "How much of a scene's earlier turns its next turn carries: what the Author did in them (continuing), its record of each (records), or only the summary the scene opened with (nothing).", shape.oneOf("continuing", "records", "nothing"));
type CarryMirrored = Holds<Exactly<Infer<typeof carryMode>, Carry>>;

const sessionRead = shape.named(
  "SessionRead",
  "One session with what its next turn would carry in the mode asked for (block 3 as it would go; empty where it would carry nothing) and each of its compactions in the order written.",
  shape.object({ session: sessionShown, carry: carryMode, carried: T, compactions: shape.list(compactionShown) }),
);
const sessionClosed = shape.named(
  "SessionClosed",
  "A session he closed: the session as it now stands, the scene of the story record closed with it, and the id of his change that closed the scene, which his Undo takes (both null where the record held no scene open).",
  shape.object({ session: sessionShown, scene: nullable(T), change: nullable(shape.whole({ least: 1 })) }),
);
const reopenAsk = shape.named("SessionReopenAsk", "His Undo of a close: the change the close answered with, taken back, so the scene stands open again with its session.", shape.object({ change: opt(shape.whole({ least: 1 })) }));
const sessionOne = shape.named("SessionOne", "A session as it now stands.", shape.object({ session: sessionShown }));
const uncompactAsk = shape.named("SessionUncompactAsk", "A compaction to undo, by its id.", shape.object({ id: shape.text({ blank: false }) }));
const compactionsReply = shape.named("SessionCompactions", "A session's compactions after one was undone, in the order written.", shape.object({ compactions: shape.list(compactionShown) }));
const sessionTurnRow = shape.named(
  "SessionTurnRow",
  "A turn played in a session: its number on the chat's path (none where it left the path), when RPE received it, and the runs of RPE's that ran in this session on it, oldest first.",
  shape.object({ turn: shape.turnId(), n: nullable(shape.whole({ least: 1 })), at: N, runs: shape.list(T) }),
);

const compactAnswer = shape.named(
  "SessionCompactAnswer",
  "What asking for a compaction came to: the session as it now stands, whether a compaction is now waiting for its next turn (no when the session holds too few turns without a summary), the session's turns, how many of its newest turns a summary never stands for, and the answer in words, which says what is so: that it is asked for, was asked for already, or that there is nothing to compact yet and why.",
  shape.object({ session: sessionShown, asked: shape.yesNo(), turns: shape.whole({ least: 0 }), kept: shape.whole({ least: 0 }), words: T }),
);

/** RPH's `compaction.keepTurns`, the newest turns a summary never stands for: what a compaction that found nothing to fold names. */
const KEEP_TURNS =
  RPH_SETTINGS.find((s) => s.key === "compaction.keepTurns") ??
  (() => {
    throw new Error("rp-harness declares no compaction.keepTurns setting.");
  })();

const measureFigures = shape.named(
  "MeasureFigures",
  "What a stretch of turns cost, as the measurement counts it from RPE's own record of each turn: tokens in, out and cached, the time to the reply's end and to the run's end (ms), and the model calls made.",
  shape.object({ tokensIn: shape.whole({ least: 0 }), tokensOut: shape.whole({ least: 0 }), cached: shape.whole({ least: 0 }), replyMs: shape.whole({ least: 0 }), runMs: shape.whole({ least: 0 }), calls: shape.whole({ least: 0 }) }),
);
const measureTurn = shape.named(
  "MeasureTurn",
  "One turn of the measurement's script as played in a mode: its number in the script, and what it cost.",
  shape.object({ n: shape.whole({ least: 1 }), figures: measureFigures }),
);
const measureDecision = shape.named(
  "MeasureDecision",
  "One decision the script plants in the scene, with the check of whether the scene honoured it: what was planted and in which turn, the question put to the judging connection and the turn it tested, the excerpt of the reply and of the Author's records it judged, whether it found the decision honoured, and the judge's own answer.",
  shape.object({ name: T, planted: shape.whole({ least: 1 }), check: T, tested: shape.whole({ least: 1 }), evidence: T, honoured: shape.yesNo(), answer: T }),
);
const measureRepeat = shape.named(
  "MeasureRepeat",
  "A look-up an agent made again: the tool and its arguments as they were made, the turn that repeated it and the turn that made it first.",
  shape.object({ tool: T, args: T, turn: shape.whole({ least: 1 }), first: shape.whole({ least: 1 }) }),
);
const measureMode = shape.named(
  "MeasureMode",
  "The script played in one carry mode: each turn's figures, their totals and medians, each planted decision with its check, and the look-ups made (calls of read tools) and the ones that repeated an earlier turn's, each named.",
  shape.object({
    mode: carryMode,
    turns: shape.list(measureTurn),
    totals: measureFigures,
    medians: measureFigures,
    decisions: shape.list(measureDecision),
    lookups: shape.object({ total: shape.whole({ least: 0 }), repeated: shape.list(measureRepeat) }),
  }),
);
const measurementReport = shape.named(
  "MeasurementReport",
  "A run of the session measurement: when it ran, the Author's connection and model, the judging connection and model, the script's hash, the three carry modes as played, and the recommendation of whoever ran it (blank until they write it; a report with none is kept and the page marks it as waiting for one).",
  shape.object({
    ran: shape.whole({ least: 0 }),
    connection: T,
    model: T,
    judge: shape.object({ connection: T, model: T }),
    script: T,
    modes: shape.list(measureMode),
    recommendation: T,
  }),
);
const measurementKept = shape.named("MeasurementKept", "A report kept: the id RPE gave it and when it received it (ms).", shape.object({ id: T, at: shape.whole({ least: 0 }) }));
const measurementRow = shape.named(
  "MeasurementRow",
  "A kept report in the list: its id, when RPE received it, when it ran, the connection and model it ran on, the judging connection, and whether its recommendation is written.",
  shape.object({ id: T, at: shape.whole({ least: 0 }), ran: shape.whole({ least: 0 }), connection: T, model: T, judge: T, recommended: shape.yesNo() }),
);
const measurementRead = shape.named("MeasurementRead", "A kept report whole, as it was sent, with its id and when RPE received it.", shape.object({ id: T, at: shape.whole({ least: 0 }), report: measurementReport }));

export const SESSIONS_PATH = "/api/v1/chats/:chat/sessions";
export const SESSION_PATH = "/api/v1/chats/:chat/sessions/:session";
export const MEASUREMENTS_PATH = "/api/v1/sessions/measurements";
export const MEASUREMENT_PATH = "/api/v1/sessions/measurements/:id";

export interface SessionRoutesDeps {
  turns: Turns;
  /** The application's write queue: his close of a scene is written through it. */
  writes: WriteQueue;
  /** The files folder and the log, for the page size the Sessions page's lists take (`sessions.page`, RPH's setting). */
  files: string;
  log: Log;
}

/** The turn the chat's path ends at, the one his close hangs after; null where the chat has played none. */
function newestTurn(s: UserStore, chat: string): string | null {
  const row = s.chat(chat);
  if (row === null || row.head === null) return null;
  return s.path(chat).findLast((e) => e.node === row.head)?.turn ?? null;
}

export function sessionRoutes(deps: SessionRoutesDeps) {
  const { turns, writes } = deps;
  const sessions = turns.harness.sessions;
  /** A chat RPE holds is there; any other is not (plan §6.1). */
  const held = (user: string, chat: string): UserStore => {
    const s = turns.store.user(user);
    if (s.chat(chat) === null) throw new RouteError(404, `RPE holds no chat ${chat} of yours.`);
    return s;
  };
  /** The session the path names, one of the chat's. */
  const found = async (user: string, chat: string, id: string): Promise<SessionView> => {
    held(user, chat);
    const view = await sessions.get({ user, chat, session: id });
    if (view === undefined || view.chat !== chat) throw new RouteError(404, `Chat ${chat} has no session ${id}.`);
    return view;
  };
  /** What RPH refuses of a call (a session it cannot close or open again) is a conflict with where the session stands, in its own words. */
  const asked = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      throw new RouteError(409, error instanceof Error ? error.message : String(error));
    }
  };
  /** A session as the page shows it: RPH's view, for a scene's session the id of the scene it was opened for, and for a closed one what closed it and when. */
  const shown = (user: string, view: SessionView): Infer<typeof sessionShown> => {
    const scene = view.kind === "scene" ? turns.store.user(user).session(view.id)?.scene : undefined;
    const closing = closingOf(turns.store.db, user, view, scene);
    return { ...view, ...(scene === undefined || scene === "" ? {} : { scene }), ...(closing === undefined ? {} : { closing }) };
  };
  /** The page size the turns of a session are listed in: RPH's `sessions.page`, at the global level. */
  const pageDef = harnessSettings().find((s) => s.key === "sessions.page");
  const pageSize = (): number => (pageDef === undefined ? 50 : Number(globalConfig(deps.files, deps.log).value(pageDef)));

  return [
    route({
      method: "GET",
      path: SESSIONS_PATH,
      access: "page",
      group: "sessions",
      does: "A chat's sessions in the order they were opened, a page at a time: scenes, and the sessions of its sub-agents, jobs and talks, each with where it stands. Listed from the chat's index; no session file is read.",
      reply: shape.page(sessionShown),
      paged: {},
      handle: async ({ user, params, query }) => {
        held(user, params.chat);
        const page = await sessions.list(user, params.chat, { ...(query.after === undefined ? {} : { after: query.after }), ...(query.limit === undefined ? {} : { limit: query.limit }) });
        return { items: page.sessions.map((s) => shown(user, s)), next: page.next ?? null };
      },
    }),
    route({
      method: "GET",
      path: SESSION_PATH,
      access: "page",
      group: "sessions",
      does: "One session with what its next turn would carry in the mode asked for (continuing when none is) and each of its compactions, whether it still stands or was undone.",
      query: { carry: opt(carryMode, "Which carry mode to show: continuing, records or nothing; continuing when left out.") },
      reply: sessionRead,
      handle: async ({ user, params, query }) => {
        const view = await found(user, params.chat, params.session);
        const scope = { user, chat: params.chat, session: view.id };
        const carry: Carry = query.carry ?? "continuing";
        const [carried, compactions] = await Promise.all([sessions.carried(scope, carry), sessions.compactions(scope)]);
        return { session: shown(user, view), carry, carried, compactions };
      },
    }),
    route({
      method: "POST",
      path: `${SESSION_PATH}/close`,
      access: "page",
      group: "sessions",
      does: "Closes the Author's open scene as his own change, placed after the chat's newest turn: the close is written in the story record, and the scene's session closes with it, hung after that turn so that its Undo, a swipe or a delete of that turn takes the closing back. Refused while a turn of the chat runs, for a session that is not a scene's, or one closed already.",
      reply: sessionClosed,
      handle: async ({ user, params }) => {
        const s = held(user, params.chat);
        const view = await found(user, params.chat, params.session);
        if (view.kind !== "scene") throw new RouteError(409, `Session ${view.id} is not a scene's: only a scene is closed by hand.`);
        if (view.state !== "open") throw new RouteError(409, `Session ${view.id} is closed already.`);
        if (turns.runs.chatsGoing().includes(params.chat)) throw new RouteError(409, `A turn of chat ${params.chat} is running: close the scene when it has ended.`);
        const turn = newestTurn(s, params.chat);
        if (turn === null) throw new RouteError(409, `Chat ${params.chat} has played no turn, so a close has no turn to hang after.`);
        if (s.turn(turn)?.chat !== params.chat) throw new RouteError(409, `The newest turn on chat ${params.chat}'s path is another chat's, which a close would change as well: play a turn here first.`);
        const closed = await writes.run(() => closeOpenScene(turns.store, user, params.chat), "your close of a scene");
        let after: SessionView;
        try {
          after = await asked(() => sessions.close({ user, chat: params.chat, session: view.id, turn }, { by: "user" }));
        } catch (error) {
          // The session could not be closed: the record's close is taken back, so the two stand together.
          if (closed !== null) await writes.run(() => turns.store.user(user).undo(closed.change, "player"), "taking back your close of a scene");
          throw error;
        }
        return { session: shown(user, after), scene: closed?.scene ?? null, change: closed?.change ?? null };
      },
    }),
    route({
      method: "POST",
      path: `${SESSION_PATH}/reopen`,
      access: "page",
      group: "sessions",
      does: "His Undo of a close: takes back the change the close answered with, so the scene stands open in the story record, and opens the session again.",
      body: reopenAsk,
      reply: sessionOne,
      handle: async ({ user, params, body }) => {
        const view = await found(user, params.chat, params.session);
        if (view.state !== "closed") throw new RouteError(409, `Session ${view.id} is open.`);
        if (turns.runs.chatsGoing().includes(params.chat)) throw new RouteError(409, `A turn of chat ${params.chat} is running: take the close back when it has ended.`);
        const change = body.change;
        if (change !== undefined) await writes.run(() => turns.store.user(user).undo(change, "player"), "taking back your close of a scene");
        return { session: shown(user, await asked(() => sessions.reopen({ user, chat: params.chat, session: view.id }))) };
      },
    }),
    route({
      method: "POST",
      path: `${SESSION_PATH}/compact`,
      access: "page",
      group: "sessions",
      does: "Asks for the open session to be compacted: it runs at the session's next turn, the Author first given its chance to save what it wants kept.",
      reply: compactAnswer,
      handle: async ({ user, params }) => {
        const view = await found(user, params.chat, params.session);
        if (view.state !== "open") throw new RouteError(409, `Session ${view.id} is closed: only an open session is compacted.`);
        const scope = { user, chat: params.chat, session: view.id };
        // RPH marks the session only when it finds turns to summarize (all but the newest `compaction.keepTurns` it holds without a summary); a session it does not mark is told as it is.
        const after = await asked(() => sessions.compact(scope));
        const kept = Number(readConfig(await portTexts(turns.files, scope), deps.log, [KEEP_TURNS]).value(KEEP_TURNS));
        const name = harnessSettings().find((s) => s.key === KEEP_TURNS.key)?.name ?? KEEP_TURNS.key;
        if (after.compactAsked === true) {
          const words = view.compactAsked === true ? "Compaction was asked for already: it runs at the session's next turn." : "Compaction is asked for: it runs at the session's next turn, the Author first given its chance to save what it wants kept.";
          return { session: shown(user, after), asked: true, turns: after.turns, kept, words };
        }
        const summarized = (await sessions.compactions(scope)).reduce((sum, c) => (c.stands && c.of === "turns" ? sum + c.turns.length : sum), 0);
        const played = `This session has played ${after.turns} ${after.turns === 1 ? "turn" : "turns"}${summarized > 0 ? `, ${summarized} of them under a summary already` : ""}`;
        const words = `There is nothing to compact yet. ${played}, and the newest ${kept} are always kept as they were, so a compaction waits until more than ${kept} of its turns have no summary. You can change that number on the Settings page, under "${name}".`;
        return { session: shown(user, after), asked: false, turns: after.turns, kept, words };
      },
    }),
    route({
      method: "POST",
      path: `${SESSION_PATH}/uncompact`,
      access: "page",
      group: "sessions",
      does: "Undoes one compaction of a session by its id: from its next turn the turns the summary stood for are carried whole again, until a later compaction; the file keeps both. Answers the session's compactions.",
      body: uncompactAsk,
      reply: compactionsReply,
      handle: async ({ user, params, body }) => {
        const view = await found(user, params.chat, params.session);
        return { compactions: await asked(() => sessions.uncompact({ user, chat: params.chat, session: view.id }, body.id)) };
      },
    }),
    route({
      method: "GET",
      path: `${SESSION_PATH}/turns`,
      access: "page",
      group: "sessions",
      does: "The turns played in a session, newest first, a page at a time: each with its number on the chat's path (none where it left the path), when RPE received it and the runs of RPE's that ran in this session on it.",
      reply: shape.page(sessionTurnRow),
      // The page's size is RPH's `sessions.page`, the global level's; the most the caller may name is ten pages.
      paged: { sizes: () => ({ default: pageSize(), most: pageSize() * 10 }) },
      handle: async ({ user, params, query }) => {
        const s = held(user, params.chat);
        const view = await found(user, params.chat, params.session);
        const byTurn = new Map<string, { at: number; runs: string[] }>();
        for (const r of turns.store.db.query<{ id: string; turn: string; received: number }, [string, string, string]>("SELECT id, turn, received FROM turn_run WHERE user = ? AND chat = ? AND session = ? ORDER BY received, rowid").all(user, params.chat, view.id)) {
          const held = byTurn.get(r.turn);
          if (held === undefined) byTurn.set(r.turn, { at: r.received, runs: [r.id] });
          else held.runs.push(r.id);
        }
        const onPath = new Map(s.path(params.chat).flatMap((e) => (e.turn === null ? [] : [e.turn])).map((turn, i) => [turn, i + 1]));
        const all = [...byTurn].map(([turn, w]) => ({ turn, n: onPath.get(turn) ?? null, at: w.at, runs: w.runs })).sort((a, b) => b.at - a.at || (a.turn < b.turn ? 1 : -1));
        const from = query.after === undefined ? 0 : all.findIndex((r) => r.turn === query.after) + 1;
        const items = all.slice(from, from + query.limit);
        return { items, next: from + items.length < all.length ? (items[items.length - 1]?.turn ?? null) : null };
      },
    }),
    route({
      method: "POST",
      path: MEASUREMENTS_PATH,
      access: "page",
      group: "sessions",
      does: "Keeps a report of the session measurement, whole as it was sent: the three carry modes as played (each turn's tokens, time and calls, totals and medians, each planted decision with its check and the judge's answer, the look-ups and the repeated ones), when and on what it ran, and the recommendation of whoever ran it (blank until they write it). Every report is kept; one that does not fit its type is refused. Nothing here changes a setting: the default carry mode changes only when he presses it on the Sessions page.",
      body: measurementReport,
      reply: measurementKept,
      handle: async ({ user, body }) => {
        const id = crypto.randomUUID();
        const at = Date.now();
        await writes.run(() => turns.store.db.query("INSERT INTO measurement (user, id, at, report) VALUES (?, ?, ?, ?)").run(user, id, at, JSON.stringify(body)), "a session measurement's report");
        return { id, at };
      },
    }),
    route({
      method: "GET",
      path: MEASUREMENTS_PATH,
      access: "page",
      group: "sessions",
      does: "The kept reports of the session measurement, newest received first, a page at a time: each with when it ran, the connection and model it ran on, the judging connection and whether its recommendation is written. One report whole is read by its id.",
      reply: shape.page(measurementRow),
      paged: { sizes: () => ({ default: pageSize(), most: pageSize() * 10 }) },
      handle: async ({ user, query }) => {
        const rows = turns.store.db
          .query<{ id: string; at: number; ran: number; connection: string; model: string; judge: string; recommendation: string }, [string]>(
            "SELECT id, at, json_extract(report, '$.ran') AS ran, json_extract(report, '$.connection') AS connection, json_extract(report, '$.model') AS model, json_extract(report, '$.judge.connection') AS judge, json_extract(report, '$.recommendation') AS recommendation FROM measurement WHERE user = ? ORDER BY at DESC, id DESC",
          )
          .all(user);
        const from = query.after === undefined ? 0 : rows.findIndex((r) => r.id === query.after) + 1;
        const items = rows.slice(from, from + query.limit).map((r) => ({ id: r.id, at: r.at, ran: r.ran, connection: r.connection, model: r.model, judge: r.judge, recommended: r.recommendation.trim() !== "" }));
        return { items, next: from + items.length < rows.length ? (items[items.length - 1]?.id ?? null) : null };
      },
    }),
    route({
      method: "GET",
      path: MEASUREMENT_PATH,
      access: "page",
      group: "sessions",
      does: "One kept report of the session measurement, whole as it was sent, with when RPE received it.",
      reply: measurementRead,
      handle: async ({ user, params }) => {
        const row = turns.store.db.query<{ id: string; at: number; report: string }, [string, string]>("SELECT id, at, report FROM measurement WHERE user = ? AND id = ?").get(user, params.id);
        if (row === null) throw new RouteError(404, `RPE holds no report ${params.id} of the session measurement.`);
        return { id: row.id, at: row.at, report: JSON.parse(row.report) as Infer<typeof measurementReport> };
      },
    }),
  ] as const;
}

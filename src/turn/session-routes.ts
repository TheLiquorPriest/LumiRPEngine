// The Sessions page's routes (plan §11, §4.4 "sessions"): a chat's sessions, a page at a time; one session with what its next turn
// would carry and its compactions; the Author's scene closed by him, and that taken back; and a compaction asked for, and one undone.
// Every route is a page's: it answers only for the user this RPE belongs to.
//
// Closing a scene is his change (§6.3 l.632, §10.10): the close is written in the story record as his own, placed after the chat's
// newest turn, and then RPH is told with that turn (`sessions.close` by the user), so the turn's Undo, a swipe or a delete of that
// turn takes the closing back. Nothing is closed while a turn of the chat runs, since that turn reads the record the close changes.

import type { Carry, CompactionView, SessionView } from "rp-harness/contract";
import { type Exactly, type Holds, type Infer, route, RouteError, shape } from "../app";
import type { WriteQueue } from "../app/database";
import { closeOpenScene } from "../story";
import type { UserStore } from "../store";
import type { Turns } from "./lane";

const T = shape.text();
const N = shape.number();
const opt = shape.optional;
const nullable = shape.nullable;

const sessionShown = shape.named(
  "SessionShown",
  "A session as the Sessions page shows it: a scene's, a sub-agent's run, a job's run or a talk thread; open or closed, the turn that closed it (for his own close, the chat's newest turn when he closed it), and a compaction asked for that waits for its next turn.",
  shape.object({
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
  }),
);
type SessionMirrored = Holds<Exactly<Infer<typeof sessionShown>, SessionView>>;

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

export const SESSIONS_PATH = "/api/v1/chats/:chat/sessions";
export const SESSION_PATH = "/api/v1/chats/:chat/sessions/:session";

export interface SessionRoutesDeps {
  turns: Turns;
  /** The application's write queue: his close of a scene is written through it. */
  writes: WriteQueue;
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
        return { items: page.sessions, next: page.next ?? null };
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
        return { session: view, carry, carried, compactions };
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
        const closed = await writes.run(() => closeOpenScene(turns.store, user, params.chat), "his close of a scene");
        let after: SessionView;
        try {
          after = await asked(() => sessions.close({ user, chat: params.chat, session: view.id, turn }, { by: "user" }));
        } catch (error) {
          // The session could not be closed: the record's close is taken back, so the two stand together.
          if (closed !== null) await writes.run(() => turns.store.user(user).undo(closed.change, "player"), "taking back his close of a scene");
          throw error;
        }
        return { session: after, scene: closed?.scene ?? null, change: closed?.change ?? null };
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
        if (change !== undefined) await writes.run(() => turns.store.user(user).undo(change, "player"), "taking back his close of a scene");
        return { session: await asked(() => sessions.reopen({ user, chat: params.chat, session: view.id })) };
      },
    }),
    route({
      method: "POST",
      path: `${SESSION_PATH}/compact`,
      access: "page",
      group: "sessions",
      does: "Asks for the open session to be compacted: it runs at the session's next turn, the Author first given its chance to save what it wants kept.",
      reply: sessionOne,
      handle: async ({ user, params }) => {
        const view = await found(user, params.chat, params.session);
        if (view.state !== "open") throw new RouteError(409, `Session ${view.id} is closed: only an open session is compacted.`);
        return { session: await asked(() => sessions.compact({ user, chat: params.chat, session: view.id })) };
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
  ] as const;
}

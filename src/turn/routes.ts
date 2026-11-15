// The routes the Turn and World pages read (plan §14), declared in the route form (`src/app/routes.ts`)
// with the shapes of `./shapes.ts`, so that the pages' types and the API reference are written from them:
// the chats RPE played, then those its store holds that it has not (a migration's);
// a chat's turns newest first, each with what its runs spent
// together; one turn with its intent record, what went to the chat, the lore of its prompt, its trace,
// and each of its runs (the first, each continue, each Settle now) with its own trace and the request
// files the harness kept for it; the Stop of a turn going on now; Settle now, a run on the chat's newest
// turn that writes nothing into the chat; the files of a turn's folder, listed and read, none outside it;
// the world's tree for a chat, at its head or at a turn, from the store's own view; a panel's request,
// held as part of the player's next message; and the jobs (plan §13.5), of the user or of one chat, each
// as RPH last kept it (how it stands, what started it, what it spent), and the cancel of one. Every
// route is a page's: it answers only for the user this RPE belongs to. A route that is handed a turn's
// id answers a turn joined to another (a continue's held turn) as a fact: the turn it joined (`joined`).

import type { JobView, Scope, TraceRecord, Usage } from "rp-harness/contract";
import { route, RouteError, shape } from "../app";
import { isRecord } from "../shared/json";
import { JoinedTurnError, type NodeView, type ValuesShown } from "../store";
import { TURN_FILES } from "./folder";
import type { Turns } from "./lane";
import type { RunRecord } from "./runs";
import { chatsReply, fileReply, folderReply, jobCancelReply, jobsReply, panelRequestBody, panelRequestReply, type RunView, settleReply, stopReply, type TurnFileEntry, turnReply, turnsReply, valuesShown, worldReply } from "./shapes";

/** Fixed: turns a chat's list gives when the page names no limit, and the most it gives. */
export const TURN_LIST = { limit: 50, most: 500 } as const;

/** What the world's tree shows when the page names nothing: the world, one level in, each level with its own values. */
export const WORLD_VIEW = { at: "world", depth: 1, values: "own" } as const satisfies { at: string; depth: number; values: ValuesShown };

const NO_USAGE: Usage = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

export interface TurnRoutesDeps {
  turns: Turns;
  /** A chat's name in Lumiverse; null when it cannot be read. */
  chatName(chat: string): Promise<string | null>;
}

/** Strings among a value's items; none when it is no list. */
function idsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/** What a turn's runs spent together. */
function spent(runs: readonly RunRecord[]): Usage {
  const sum = { ...NO_USAGE };
  for (const { usage } of runs) {
    if (usage === null) continue;
    sum.calls += usage.calls;
    sum.input += usage.input;
    sum.cacheRead += usage.cacheRead;
    sum.cacheWrite += usage.cacheWrite;
    sum.output += usage.output;
  }
  return sum;
}

/** A turn's trace records by the run that made them, by RPH's own id for each (`record.run`): the runs in the order each began, each run's records in order. */
function byRun(records: readonly TraceRecord[]): Map<string, TraceRecord[]> {
  const runs = new Map<string, TraceRecord[]>();
  for (const record of records) {
    const of = runs.get(record.run);
    if (of === undefined) runs.set(record.run, [record]);
    else of.push(record);
  }
  return runs;
}

/**
 * Which of a turn's records a read gives, going on from where a page has read to: of the run `run` names (the turn's first when
 * none), those numbered `from` on; and every record of each run that began after it. A run the turn's records do not hold is a 404.
 */
function readFrom(turn: string, runs: ReadonlyMap<string, readonly TraceRecord[]>, run: string | undefined, from: number): (record: TraceRecord) => boolean {
  const order = [...runs.keys()];
  const at = run === undefined ? 0 : order.indexOf(run);
  if (at < 0) throw new RouteError(404, `Turn ${turn} has no run ${run}.`);
  const asked = order[at];
  const later = new Set(order.slice(at + 1));
  return (record) => later.has(record.run) || (record.run === asked && record.seq >= from);
}

/** The path below a turn's folder a file route names, its segments as the server decoded them: none may be empty, `.` or `..`, or hold a backslash. */
function fileName(rest: string): string {
  const names = rest.split("/");
  if (names.length === 0 || names.some((n) => n === "" || n === "." || n === ".." || n.includes("\\"))) throw new RouteError(400, "A file is named by its path inside the turn's folder, and no path leaves it.");
  return names.join("/");
}

export function turnRoutes(deps: TurnRoutesDeps) {
  const { turns } = deps;

  /**
   * A turn of the chat asked for by id that was joined to another (a continue's held turn) is answered as a fact, naming the turn
   * it joined: thrown as the store throws it, for the server to answer in its one place. A turn the chat does not hold is for
   * the route's own 404.
   */
  const notJoined = (user: string, chat: string, turn: string): void => {
    const row = turns.store.user(user).turn(turn);
    if (row !== null && row.chat === chat && row.joined !== null) throw new JoinedTurnError(turn, row.joined);
  };

  /** The turn of the chat as kept (its latest run); a 404 for a turn the chat does not have. */
  const turnOf = (user: string, chat: string, turn: string): RunRecord => {
    notJoined(user, chat, turn);
    const r = turns.runs.record(user, turn);
    if (r === null || r.chat !== chat) throw new RouteError(404, `Chat ${chat} has no turn ${turn}.`);
    return r;
  };

  /** The scope a turn's folder is read in, and the folder in the agents' view; null for a turn that has none. */
  const folderOf = async (r: RunRecord): Promise<{ scope: Scope & { turn: string }; folder: string | null }> => {
    const scope = { user: r.user, chat: r.chat, session: r.session, turn: r.turn };
    return { scope, folder: (await turns.files.places(scope)).turn ?? null };
  };

  /** The user's jobs as RPH last kept each, of one chat or of every chat, the newest started first. */
  const jobsOf = async (user: string, chat?: string): Promise<{ jobs: JobView[] }> => ({
    jobs: (await turns.harness.jobs.list({ user, ...(chat !== undefined ? { chat } : {}) })).jobs,
  });

  /**
   * The lore of a turn's prompt as its intake kept it in the turn's folder (`turn.json`): the ids of the entries Lumiverse activated
   * for it, and of those the Author's lore map named. None where the folder holds no such file, or one that cannot be read.
   */
  const keptLore = async (r: RunRecord): Promise<{ activated: string[]; map: string[] }> => {
    const { scope, folder } = await folderOf(r);
    const read = folder === null ? null : await turns.files.read(scope, `${folder}${TURN_FILES.turn}`);
    let data: unknown = null;
    try {
      data = read?.status === "read" ? JSON.parse(read.text) : null;
    } catch {
      // A file that does not parse holds nothing the page can show.
    }
    return isRecord(data) ? { activated: idsOf(data.lore), map: idsOf(data.loreMap) } : { activated: [], map: [] };
  };

  /** Each of a turn's runs, oldest first, with its own records as far as the read reaches and the request files named in all of them. */
  const runsOf = async (r: RunRecord, runs: ReadonlyMap<string, readonly TraceRecord[]>, within: (record: TraceRecord) => boolean): Promise<RunView[]> => {
    const { folder } = await folderOf(r);
    return turns.runs.ofTurn(r.user, r.turn).map((run, i) => {
      const trace = run.traceRun === null ? [] : (runs.get(run.traceRun) ?? []);
      const requests = trace.flatMap((t) =>
        t.event.kind === "call_started" && t.event.request !== undefined
          ? [{ agent: t.agent.id, definition: t.agent.definition, call: t.event.call, file: folder !== null && t.event.request.startsWith(folder) ? t.event.request.slice(folder.length) : t.event.request }]
          : [],
      );
      return {
        id: run.id,
        run: run.traceRun,
        nth: i + 1,
        kind: run.kind,
        status: run.status,
        timings: { received: run.received, started: run.started, firstWord: run.firstWord, released: run.released, ended: run.ended, intent: run.intent, thinking: run.thinking },
        usage: run.usage ?? NO_USAGE,
        reply: { text: run.reply, progress: [...run.progress] },
        error: run.error,
        stoppedBy: run.stoppedBy,
        lastText: run.lastText,
        trace: trace.filter(within),
        requests,
      };
    });
  };

  const summary = (user: string, chat: string, r: RunRecord) => {
    const store = turns.store.user(user);
    const row = store.turn(r.turn);
    const onPath = r.status === "running" || store.path(chat).some((e) => e.turn === r.turn);
    return {
      id: r.turn,
      kind: r.kind,
      onPath,
      message: row?.message ?? null,
      status: r.status,
      timings: { received: r.received, started: r.started, firstWord: r.firstWord, released: r.released, ended: r.ended, intent: r.intent, thinking: r.thinking },
      usage: spent(turns.runs.ofTurn(user, r.turn)),
    };
  };

  return [
    route({
      method: "GET",
      path: "/api/v1/chats",
      access: "page",
      group: "chats",
      does: "The chats RPE played, the most recently played first, then the chats its store holds that it has not played (a migration's), by name.",
      reply: chatsReply,
      handle: async ({ user }) => {
        // The chats played on RPE, newest first; then each chat the store holds with no run yet (one a migration imported), by name.
        // Each says whether it was played, and whether the store has a world for it, so a page offers a world's panels only there.
        const store = turns.store.user(user);
        const played = turns.runs.chats(user);
        const ran = new Set(played.map((c) => c.chat));
        const row = async (chat: string, last: number | null) => ({
          id: chat,
          name: (await deps.chatName(chat)) ?? "",
          lastTurnAt: last,
          running: turns.runs.ofChat(user, chat).length > 0,
          played: last !== null,
          world: (store.chat(chat)?.revision ?? null) !== null,
        });
        const unplayed = await Promise.all(store.chats().flatMap((c) => (ran.has(c.id) ? [] : [row(c.id, null)])));
        unplayed.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return { chats: [...(await Promise.all(played.map((c) => row(c.chat, c.last)))), ...unplayed] };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/turns",
      access: "page",
      group: "turns",
      does: "A chat's turns, newest first, each with what its runs spent together; `before` is a turn's id, and older ones follow it.",
      query: {
        limit: shape.optional(shape.whole({ least: 1 }), `How many turns to give: ${TURN_LIST.limit} when left out, and at most ${TURN_LIST.most}.`),
        before: shape.optional(shape.turnId(), "A turn's id: the turns older than it are given."),
      },
      reply: turnsReply,
      joined: true,
      handle: ({ user, params, query }) => {
        const limit = Math.min(query.limit ?? TURN_LIST.limit, TURN_LIST.most);
        if (query.before !== undefined) notJoined(user, params.chat, query.before);
        const kept = turns.runs.ofChatKept(user, params.chat, limit + 1, query.before);
        return { turns: kept.slice(0, limit).map((r) => summary(user, params.chat, r)), more: kept.length > limit };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/turns/:turn",
      access: "page",
      group: "turns",
      does: "One turn, read on from where a page has read to: its intent record, what went to the chat, the lore of its prompt, its runs' records from the record numbered `from` of the run named, and each of its runs.",
      query: {
        run: shape.optional(shape.text(), "One of the turn's runs, by RPH's own id for it (its records' `run`), that `from` counts in; the turn's first when left out. Every record of each run that began after it is given whole."),
        from: shape.optional(shape.whole({ least: 1 }), "The named run's records are given from the one with this number; 1 when left out."),
      },
      reply: turnReply,
      joined: true,
      handle: async ({ user, params, query }) => {
        const r = turnOf(user, params.chat, params.turn);
        const records = await turns.trace.records({ user, chat: r.chat, session: r.session, turn: r.turn });
        const runs = byRun(records);
        const within = readFrom(r.turn, runs, query.run, query.from ?? 1);
        return {
          ...summary(user, params.chat, r),
          chat: r.chat,
          intent: turns.store.user(user).turn(r.turn)?.intent ?? null,
          reply: { text: r.reply, progress: [...r.progress] },
          error: r.error,
          trace: records.filter(within),
          lore: await keptLore(r),
          runs: await runsOf(r, runs, within),
        };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/turns/:turn/stop",
      access: "page",
      group: "turns",
      does: "Stops a turn going on now; says whether it was running.",
      reply: stopReply,
      joined: true,
      handle: async ({ user, params }) => {
        turnOf(user, params.chat, params.turn);
        return { stopped: await turns.lane.stop(user, params.turn) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/requests",
      access: "page",
      group: "chats",
      does: "Holds a panel's request as part of the player's next message, for the turn that answers it.",
      body: panelRequestBody,
      reply: panelRequestReply,
      handle: async ({ user, params, body }) => {
        // A panel acts on a chat RPE plays: a request for one RPE does not hold is refused, and nothing of it is kept.
        if (turns.store.user(user).chat(params.chat) === null) throw new RouteError(404, `RPE holds no chat ${params.chat}.`);
        const ask = { what: body.what, on: typeof body.on === "string" && body.on.trim() !== "" ? body.on : null };
        return { request: await turns.player.hold(user, params.chat, ask, Date.now()) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/settle",
      access: "page",
      group: "turns",
      does: "Settle now: a run on the chat's newest turn that writes nothing into the chat; answers the turn and the run begun, or a refusal in the turn-errors part's words.",
      reply: settleReply,
      // The run begins and goes on after the answer, which names it; a refusal is told in the turn-errors part's words.
      handle: async ({ user, params }) => {
        const settling = await turns.lane.settle(user, params.chat);
        if ("refused" in settling) throw new RouteError(409, settling.refused);
        return settling;
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/turns/:turn/files",
      access: "page",
      group: "turns",
      does: "The whole of a turn's folder, every level down, each entry with its size; none for a turn that has no folder.",
      reply: folderReply,
      joined: true,
      handle: async ({ user, params }) => {
        const { scope, folder } = await folderOf(turnOf(user, params.chat, params.turn));
        if (folder === null) return { files: [] as TurnFileEntry[] };
        // The whole folder, every level down: it holds what one turn wrote. Where the file host stopped short of it, what it found is
        // listed and how it stopped is said.
        const found = await turns.files.find(scope, { by: "list", path: folder, depth: Number.POSITIVE_INFINITY, limit: Number.POSITIVE_INFINITY });
        const listed = (found.status === "found" ? found.hits : [])
          .filter((hit) => hit.path.startsWith(folder) && hit.path.length > folder.length)
          .map((hit) => ({ name: hit.path.slice(folder.length).replace(/\/$/, ""), bytes: hit.bytes ?? 0, folder: hit.type === "folder" }));
        const files: TurnFileEntry[] = listed.map((e) => (e.folder ? { ...e, bytes: listed.filter((f) => !f.folder && f.name.startsWith(`${e.name}/`)).reduce((n, f) => n + f.bytes, 0) } : e));
        return { files, ...(found.status === "found" && found.stopped !== undefined ? { stopped: found.stopped } : {}) };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/turns/:turn/files/*",
      access: "page",
      group: "turns",
      does: "One file of a turn's folder, by its path below the folder, as text; no path leaves the folder.",
      reply: fileReply,
      joined: true,
      handle: async ({ user, params }) => {
        const { scope, folder } = await folderOf(turnOf(user, params.chat, params.turn));
        const name = fileName(params["*"]);
        const read = folder === null ? null : await turns.files.read(scope, `${folder}${name}`);
        if (folder === null || read?.status !== "read" || !read.path.startsWith(folder)) throw new RouteError(404, `Turn ${params.turn}'s folder has no file ${name}.`);
        return { name, text: read.text };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/world",
      access: "page",
      group: "state",
      does: "The world's tree for a chat: the level asked for, then each level below it to the depth asked for, at the chat's head or as it stood at a turn.",
      query: {
        at: shape.optional(shape.text(), `The level to start at, by its ref; \`${WORLD_VIEW.at}\` when left out.`),
        depth: shape.optional(shape.whole({ least: 0 }), `How many levels below it to give; ${WORLD_VIEW.depth} when left out.`),
        values: shape.optional(valuesShown, `Which values each level carries: none, its own, or all; \`${WORLD_VIEW.values}\` when left out.`),
        turn: shape.optional(shape.turnId(), "A turn's id: the world as it stood at that turn; left out, at the chat's head."),
      },
      reply: worldReply,
      joined: true,
      handle: ({ user, params, query }) => {
        const store = turns.store.user(user);
        if (store.chat(params.chat) === null) throw new RouteError(404, `RPE has played no chat ${params.chat}.`);
        const turn = query.turn ?? null;
        if (turn !== null && store.turn(turn)?.chat !== params.chat) throw new RouteError(404, `Chat ${params.chat} has no turn ${turn}.`);
        if (turn !== null) notJoined(user, params.chat, turn);
        const values: ValuesShown = query.values ?? WORLD_VIEW.values;
        const depth = query.depth ?? WORLD_VIEW.depth;
        const view = turn === null ? store.view(params.chat) : store.viewAt(turn);
        const at = query.at ?? WORLD_VIEW.at;
        const ref = view.resolve(at);
        if (ref === null) throw new RouteError(404, `Nothing in the world of chat ${params.chat} is called ${at}.`);
        // The level asked for, then each level below it to the depth asked for, each with the values asked for.
        const nodes: NodeView[] = [];
        const walk = (level: string, down: number): void => {
          const node = view.node(level);
          if (node === null) return;
          nodes.push({ ...node, values: values === "none" ? [] : view.values(level, values === "all") });
          if (down < depth) for (const child of node.children) walk(child, down + 1);
        };
        walk(ref, 0);
        return { at: ref, nodes };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/jobs",
      access: "page",
      group: "jobs",
      does: "The user's jobs, of every chat, as RPH last kept each, the newest started first.",
      reply: jobsReply,
      handle: ({ user }) => jobsOf(user),
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/jobs",
      access: "page",
      group: "jobs",
      does: "The user's jobs of one chat, as RPH last kept each, the newest started first.",
      reply: jobsReply,
      handle: ({ user, params }) => jobsOf(user, params.chat),
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/:job/cancel",
      access: "page",
      group: "jobs",
      does: "Cancels a job; one that has ended already is given as it ended.",
      reply: jobCancelReply,
      // A job that has ended already is given as it ended: nothing of it is cancelled. Another user's job is no job of his.
      handle: async ({ user, params }) => {
        const jobs = turns.harness.jobs;
        const job = await jobs.get(user, params.job);
        if (job === undefined) throw new RouteError(404, `There is no job ${params.job}.`);
        return { job: (await jobs.cancel(user, job.id)) ?? job };
      },
    }),
  ] as const;
}

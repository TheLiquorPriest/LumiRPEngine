// The routes the Turn and World pages read (plan §14), in the shapes the pages' client is typed by
// (`src/ui/api.ts`): the chats RPE played, then those its store holds that it has not (a migration's);
// a chat's turns newest first, each with what its runs spent
// together; one turn with its intent record, what went to the chat, the lore of its prompt, its trace,
// and each of its runs (the first, each continue, each Settle now) with its own trace and the request
// files the harness kept for it; the Stop of a turn going on now; Settle now, a run on the chat's newest
// turn that writes nothing into the chat; the files of a turn's folder, listed and read, none outside it;
// the world's tree for a chat, at its head or at a turn, from the store's own view; a panel's request,
// held as part of the player's next message; and the jobs (plan §13.5), of the user or of one chat, each
// as RPH last kept it (how it stands, what started it, what it spent), and the cancel of one. Every
// route is a page's: it answers only for the user this RPE belongs to.

import type { JobsApi, JobView, ReplyError, Scope, TraceRecord, Usage } from "rp-harness/contract";
import { rawRoute, route, RouteError } from "../app";
import { isRecord } from "../shared/json";
import type { NodeView, ValuesShown } from "../store";
import { TURN_FILES } from "./folder";
import type { Turns } from "./lane";
import type { RunKind, RunRecord, RunState } from "./runs";

/** Fixed: turns a chat's list gives when the page names no limit, and the most it gives. */
export const TURN_LIST = { limit: 50, most: 500 } as const;

/** What the world's tree shows when the page names nothing: the world, one level in, each level with its own values. */
export const WORLD_VIEW = { at: "world", depth: 1, values: "own" } as const satisfies { at: string; depth: number; values: ValuesShown };

const VALUES: readonly ValuesShown[] = ["none", "own", "all"];

const NO_USAGE: Usage = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

/** The route that reads one file of a turn's folder: the path below the folder follows `files/`. */
const FILE_PATH = "/api/v1/chats/:chat/turns/:turn/files/*";
/** How many of a request path's segments come before the file's own. */
const BEFORE_FILE = FILE_PATH.split("/").length - 1;

export interface TurnRoutesDeps {
  turns: Turns;
  /** A chat's name in Lumiverse; null when it cannot be read. */
  chatName(chat: string): Promise<string | null>;
}

/** A turn's run as the Turn page shows it: its first, a continue of it, or a Settle now run on it. */
export interface RunView {
  id: string;
  /** Its place among the turn's runs, from 1. */
  nth: number;
  kind: RunKind;
  status: RunState;
  timings: { received: number; started: number | null; firstWord: number | null; released: number | null; ended: number | null };
  usage: Usage;
  reply: { text: string; progress: string[] };
  error: ReplyError | null;
  /** Its own trace records, numbered from 1 within the run; from the record numbered `from` when the page names one. */
  trace: TraceRecord[];
  /** The files of the turn's folder that hold its model calls' requests as sent, where the harness kept them: by agent and call. */
  requests: { agent: string; definition: string; call: number; file: string }[];
}

/** One entry of a turn's folder: its path below the folder, its size (a folder's, what its files hold), and whether it is a folder. */
export interface TurnFileEntry {
  name: string;
  bytes: number;
  folder: boolean;
}

function count(value: string | null, name: string, fallback: number, most: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new RouteError(400, `${name} is a whole number from 1.`);
  return Math.min(Number(value), most);
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

/**
 * A turn's trace records split by the run that made them, in order: each run numbers its records from 1 with no gap, and a turn's
 * runs go one after another, so a record joins the newest run whose last record is the one numbered just before it.
 */
function byRun(records: readonly TraceRecord[]): TraceRecord[][] {
  const groups: TraceRecord[][] = [];
  for (const record of records) {
    const into = record.seq === 1 ? undefined : groups.findLast((group) => group.at(-1)?.seq === record.seq - 1);
    if (into !== undefined) into.push(record);
    else groups.push([record]);
  }
  return groups;
}

/** The path below a turn's folder a file route names, its segments decoded: none may be empty, `.` or `..`, or hold a slash. */
function fileName(pathname: string): string {
  const names = pathname
    .split("/")
    .slice(BEFORE_FILE)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        throw new RouteError(400, "A file's path is not written as a path.");
      }
    });
  if (names.length === 0 || names.some((n) => n === "" || n === "." || n === ".." || n.includes("/") || n.includes("\\"))) throw new RouteError(400, "A file is named by its path inside the turn's folder, and no path leaves it.");
  return names.join("/");
}

/** A panel's request as the page sends it: what was pressed, and what it was pressed on, where it was pressed on something. */
function panelAsk(value: unknown): { what: string; on: string | null } {
  if (!isRecord(value) || typeof value.what !== "string" || value.what.trim() === "") throw new RouteError(400, "A request from a panel names what was pressed, as `what`.");
  if (value.on !== undefined && value.on !== null && typeof value.on !== "string") throw new RouteError(400, "`on`, where given, is what was pressed on, as text.");
  return { what: value.what, on: typeof value.on === "string" && value.on.trim() !== "" ? value.on : null };
}

export function turnRoutes(deps: TurnRoutesDeps) {
  const { turns } = deps;

  /** The turn of the chat as kept (its latest run); a 404 for a turn the chat does not have. */
  const turnOf = (user: string, chat: string, turn: string): RunRecord => {
    const r = turns.runs.record(user, turn);
    if (r === null || r.chat !== chat) throw new RouteError(404, `Chat ${chat} has no turn ${turn}.`);
    return r;
  };

  /** The scope a turn's folder is read in, and the folder in the agents' view; null for a turn that has none. */
  const folderOf = async (r: RunRecord): Promise<{ scope: Scope & { turn: string }; folder: string | null }> => {
    const scope = { user: r.user, chat: r.chat, session: r.session, turn: r.turn };
    return { scope, folder: (await turns.files.places(scope)).turn ?? null };
  };

  /** RPH's jobs; a 503 where this RPE runs none. */
  const jobsApi = (): JobsApi => {
    if (turns.harness.jobs === undefined) throw new RouteError(503, "This RPE runs no jobs.");
    return turns.harness.jobs;
  };

  /** The user's jobs as RPH last kept each, of one chat or of every chat, the newest started first. */
  const jobsOf = async (user: string, chat?: string): Promise<{ jobs: JobView[] }> => {
    const jobs = await jobsApi().list({ user, ...(chat !== undefined ? { chat } : {}) });
    return { jobs: jobs.sort((a, b) => b.started - a.started || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)) };
  };

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

  /** Each of a turn's runs, oldest first, with its own trace from `from` on and the request files named in it. */
  const runsOf = async (r: RunRecord, from: number): Promise<RunView[]> => {
    const all = turns.runs.ofTurn(r.user, r.turn);
    const { folder } = await folderOf(r);
    const records = await turns.trace.records({ user: r.user, chat: r.chat, session: r.session, turn: r.turn });
    // A run's records begin once it has started: each group of them is the newest run's that had started by its first record.
    const started = all.filter((run) => run.started !== null);
    const traceOf = new Map<string, TraceRecord[]>();
    for (const group of byRun(records)) {
      const at = group[0]?.at ?? 0;
      const run = started.findLast((s) => (s.started ?? 0) <= at) ?? started[0];
      if (run !== undefined) traceOf.set(run.id, [...(traceOf.get(run.id) ?? []), ...group]);
    }
    return all.map((run, i) => {
      const trace = traceOf.get(run.id) ?? [];
      const requests = trace.flatMap((t) =>
        t.event.kind === "call_started" && t.event.request !== undefined
          ? [{ agent: t.agent.id, definition: t.agent.definition, call: t.event.call, file: folder !== null && t.event.request.startsWith(folder) ? t.event.request.slice(folder.length) : t.event.request }]
          : [],
      );
      return {
        id: run.id,
        nth: i + 1,
        kind: run.kind,
        status: run.status,
        timings: { received: run.received, started: run.started, firstWord: run.firstWord, released: run.released, ended: run.ended },
        usage: run.usage ?? NO_USAGE,
        reply: { text: run.reply, progress: [...run.progress] },
        error: run.error,
        trace: trace.filter((t) => t.seq >= from),
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
      timings: { received: r.received, started: r.started, firstWord: r.firstWord, released: r.released, ended: r.ended },
      usage: spent(turns.runs.ofTurn(user, r.turn)),
    };
  };

  return [
    route({
      method: "GET",
      path: "/api/v1/chats",
      access: "page",
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
      handle: ({ user, params, query }) => {
        const limit = count(query.get("limit"), "limit", TURN_LIST.limit, TURN_LIST.most);
        const before = query.get("before") ?? undefined;
        const kept = turns.runs.ofChatKept(user, params.chat, limit + 1, before);
        return { turns: kept.slice(0, limit).map((r) => summary(user, params.chat, r)), more: kept.length > limit };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/turns/:turn",
      access: "page",
      handle: async ({ user, params, query }) => {
        const r = turnOf(user, params.chat, params.turn);
        const from = count(query.get("from"), "from", 1, Number.MAX_SAFE_INTEGER);
        const trace = (await turns.trace.records({ user, chat: r.chat, session: r.session, turn: r.turn })).filter((t) => t.seq >= from);
        return {
          ...summary(user, params.chat, r),
          chat: r.chat,
          intent: turns.store.user(user).turn(r.turn)?.intent ?? null,
          reply: { text: r.reply, progress: [...r.progress] },
          error: r.error,
          trace,
          lore: await keptLore(r),
          runs: await runsOf(r, from),
        };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/turns/:turn/stop",
      access: "page",
      handle: async ({ user, params }) => {
        turnOf(user, params.chat, params.turn);
        return { stopped: await turns.lane.stop(user, params.turn) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/requests",
      access: "page",
      body: panelAsk,
      handle: async ({ user, params, body }) => {
        // A panel acts on a chat RPE plays: a request for one RPE does not hold is refused, and nothing of it is kept.
        if (turns.store.user(user).chat(params.chat) === null) throw new RouteError(404, `RPE holds no chat ${params.chat}.`);
        return { request: await turns.player.hold(user, params.chat, body, Date.now()) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/settle",
      access: "page",
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
      handle: async ({ user, params }) => {
        const { scope, folder } = await folderOf(turnOf(user, params.chat, params.turn));
        if (folder === null) return { files: [] as TurnFileEntry[] };
        // The whole folder, every level down: it holds what one turn wrote.
        const found = await turns.files.find(scope, { by: "list", path: folder, depth: Number.POSITIVE_INFINITY, limit: Number.POSITIVE_INFINITY });
        const listed = (Array.isArray(found) ? found : [])
          .filter((hit) => hit.path.startsWith(folder) && hit.path.length > folder.length)
          .map((hit) => ({ name: hit.path.slice(folder.length).replace(/\/$/, ""), bytes: hit.bytes ?? 0, folder: hit.type === "folder" }));
        const files: TurnFileEntry[] = listed.map((e) => (e.folder ? { ...e, bytes: listed.filter((f) => !f.folder && f.name.startsWith(`${e.name}/`)).reduce((n, f) => n + f.bytes, 0) } : e));
        return { files };
      },
    }),
    rawRoute({
      method: "GET",
      path: FILE_PATH,
      access: "page",
      raw: async (request, { user, params }) => {
        const { scope, folder } = await folderOf(turnOf(user, params.chat, params.turn));
        const name = fileName(new URL(request.url).pathname);
        const read = folder === null ? null : await turns.files.read(scope, `${folder}${name}`);
        if (folder === null || read?.status !== "read" || !read.path.startsWith(folder)) throw new RouteError(404, `Turn ${params.turn}'s folder has no file ${name}.`);
        return Response.json({ name, text: read.text }, { headers: { "cache-control": "no-store" } });
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/world",
      access: "page",
      handle: ({ user, params, query }) => {
        const store = turns.store.user(user);
        if (store.chat(params.chat) === null) throw new RouteError(404, `RPE has played no chat ${params.chat}.`);
        const turn = query.get("turn");
        if (turn !== null && store.turn(turn)?.chat !== params.chat) throw new RouteError(404, `Chat ${params.chat} has no turn ${turn}.`);
        const values = (query.get("values") ?? WORLD_VIEW.values) as ValuesShown;
        if (!VALUES.includes(values)) throw new RouteError(400, `values is one of ${VALUES.join(", ")}.`);
        const asked = query.get("depth");
        if (asked !== null && !/^\d+$/.test(asked)) throw new RouteError(400, "depth is a whole number from 0.");
        const depth = asked === null ? WORLD_VIEW.depth : Number(asked);
        const view = turn === null ? store.view(params.chat) : store.viewAt(turn);
        const at = query.get("at") ?? WORLD_VIEW.at;
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
      handle: ({ user }) => jobsOf(user),
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/jobs",
      access: "page",
      handle: ({ user, params }) => jobsOf(user, params.chat),
    }),
    route({
      method: "POST",
      path: "/api/v1/jobs/:job/cancel",
      access: "page",
      // A job that has ended already is given as it ended: nothing of it is cancelled. Another user's job is no job of his.
      handle: async ({ user, params }) => {
        const jobs = jobsApi();
        const job = await jobs.get(user, params.job);
        if (job === undefined) throw new RouteError(404, `There is no job ${params.job}.`);
        return { job: (await jobs.cancel(user, job.id)) ?? job };
      },
    }),
  ] as const;
}

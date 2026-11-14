// The routes the Turn page reads (plan §14), in the shapes the pages' client is typed by
// (`src/ui/api.ts`): the chats RPE plays, a chat's turns newest first, one turn with its intent record,
// its timings, its usage, what went to the chat and the trace of its run, and the Stop of a turn going
// on now.

import type { Usage } from "rp-harness/contract";
import { route, RouteError } from "../app";
import type { RunRecord } from "./runs";
import type { Turns } from "./lane";

/** Fixed: turns a chat's list gives when the page names no limit, and the most it gives. */
export const TURN_LIST = { limit: 50, most: 500 } as const;

const NO_USAGE: Usage = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

export interface TurnRoutesDeps {
  turns: Turns;
  /** The Lumiverse user this RPE plays for. */
  owner(): string;
  /** A chat's name in Lumiverse; null when it cannot be read. */
  chatName(chat: string): Promise<string | null>;
}

function count(value: string | null, name: string, fallback: number, most: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new RouteError(400, `${name} is a whole number from 1.`);
  return Math.min(Number(value), most);
}

export function turnRoutes(deps: TurnRoutesDeps) {
  const { turns } = deps;
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
      usage: r.usage ?? NO_USAGE,
    };
  };
  return [
    route({
      method: "GET",
      path: "/api/v1/chats",
      access: "page",
      handle: async ({ user }) => ({
        chats: await Promise.all(
          turns.runs.chats(user).map(async (c) => ({ id: c.chat, name: (await deps.chatName(c.chat)) ?? "", lastTurnAt: c.last, running: turns.runs.ofChat(user, c.chat).length > 0 })),
        ),
      }),
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
        const r = turns.runs.record(user, params.turn);
        if (r === null || r.chat !== params.chat) throw new RouteError(404, `Chat ${params.chat} has no turn ${params.turn}.`);
        const from = count(query.get("from"), "from", 1, Number.MAX_SAFE_INTEGER);
        const trace = (await turns.trace.records({ user, chat: r.chat, session: r.session, turn: r.turn })).filter((t) => t.seq >= from);
        return {
          ...summary(user, params.chat, r),
          chat: r.chat,
          intent: turns.store.user(user).turn(r.turn)?.intent ?? null,
          reply: { text: r.reply, progress: [...r.progress] },
          error: r.error,
          trace,
        };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/turns/:turn/stop",
      access: "page",
      handle: async ({ user, params }) => {
        const r = turns.runs.record(user, params.turn);
        if (r === null || r.chat !== params.chat) throw new RouteError(404, `Chat ${params.chat} has no turn ${params.turn}.`);
        return { stopped: await turns.lane.stop(user, params.turn) };
      },
    }),
  ] as const;
}

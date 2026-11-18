// The Prompt page's routes (plan §4.8, §14): the preset's prompt map as found in a turn's prompt (the
// newest kept on the chat's path, or one named, read in the session it played in), with whether its text could be told apart, Lumiverse's own clipping
// inside the window and the old engines' blocks the preset still holds; each turn's notices and front,
// newest first, a page as long as the turn list's settings say; and his edits to the map. Showing and
// editing are RPH's (`promptMap.show`, `promptMap.edit`): nothing here touches the stored map, and each
// edit is kept as his. A refusal is RPH's, in the words of `.prompts/prompt-map.md`.

import type { RawLayout, Scope } from "rp-harness/contract";
import { type PageSizes, route, RouteError, shape } from "../app";
import { PLAYER } from "../play/owner-edits";
import { isRecord } from "../shared/json";
import { JoinedTurnError } from "../store";
import type { Turns } from "./lane";
import { turnSettings } from "./settings";
import { promptEditAsk, promptShownReply, promptTurnShown } from "./shapes";
import { NO_SESSION } from "./turns";

/** A preset block of the old engines', by its name: `RPEngine · <step>`. */
const OLD_BLOCK = /^RPEngine\s*·\s*(.+)$/;
/** An old engine's outlet reference left in a block's text. */
const OLD_OUTLET = /\{\{\s*outlet::(lre_[^}\s]+)\s*\}\}/g;

/** Lumiverse's own clipping inside the window, as the receipt kept it on the turn's cut; null where it left nothing out. */
function clippedOf(cut: unknown): { count: number; by: "memory" | "message-limit" | "context-size" | null } | null {
  if (!isRecord(cut) || !isRecord(cut.clipped)) return null;
  const { count, by } = cut.clipped;
  if (typeof count !== "number" || count <= 0) return null;
  return { count, by: by === "memory" || by === "message-limit" || by === "context-size" ? by : null };
}

/** The old engines' blocks the preset still held in a turn's breakdown: blocks by their name, outlets by a reference left in a block's text. */
function oldBlocks(layout: RawLayout | null): { kind: "block" | "outlet"; name: string; in: string }[] {
  if (layout === null) return [];
  return layout.blocks.flatMap((b) => {
    const named = OLD_BLOCK.exec(b.name.trim());
    const outlets = [...b.text.matchAll(OLD_OUTLET)].map((m) => ({ kind: "outlet" as const, name: m[1] ?? "", in: b.name }));
    return [...(named?.[1] !== undefined ? [{ kind: "block" as const, name: named[1].trim(), in: b.name }] : []), ...outlets];
  });
}

export function promptRoutes(turns: Turns) {
  /**
   * The scope RPH reads a turn's kept prompt in: the turn named, or where none is, the newest turn on the chat's path whose prompt RPH
   * found its slices in; each with the session it played in. A turn of another chat is not there; a joined one named is answered as a fact.
   */
  const scopeOf = (user: string, chat: string, turn: string | undefined): Scope & { turn: string } => {
    const store = turns.store.user(user);
    if (turn === undefined) {
      const path = store.chat(chat) === null ? [] : store.path(chat);
      for (let at = path.length - 1; at >= 0; at--) {
        const newest = path[at]?.turn ?? null;
        const run = newest === null || store.turn(newest)?.joined !== null || turns.prompts.located(user, newest) === null ? null : turns.runs.record(user, newest);
        if (newest !== null && run !== null) return { user, chat, session: run.session, turn: newest };
      }
      throw new RouteError(404, `RPE keeps no turn's prompt for chat ${chat}.`);
    }
    const row = store.turn(turn);
    if (row !== null && row.chat === chat && row.joined !== null) throw new JoinedTurnError(turn, row.joined);
    const run = turns.runs.record(user, turn);
    if (row === null || row.chat !== chat || run === null) throw new RouteError(404, `Chat ${chat} has no turn ${turn}.`);
    return { user, chat, session: run.session, turn };
  };

  /** The map as found in the turn's prompt, with what RPE kept of its request beside it. */
  const shown = async (scope: Scope & { turn: string }) => {
    const map = await turns.harness.promptMap.show(scope);
    if (map === undefined) throw new RouteError(404, `RPE no longer keeps the prompt of turn ${scope.turn}.`);
    const carried = turns.prompts.carried(scope.user, map.turn);
    return {
      turn: map.turn,
      preset: map.preset,
      mapped: map.mapped,
      complete: carried?.layout.complete ?? true,
      slices: map.slices,
      unclaimed: map.unclaimed,
      notices: map.notices,
      front: map.front,
      clipped: clippedOf(carried?.cut),
      old: oldBlocks(carried?.layout ?? null),
    };
  };

  const turnQuery = { turn: shape.optional(shape.turnId(), "The turn whose prompt is read; the chat's newest whose prompt RPE still keeps when left out.") };
  /** A history page's sizes: the turn list's own settings for the chat (a page's call always has its user and its chat). */
  const historySizes = async (at: { readonly params: { readonly [name: string]: string }; readonly user: string | null }): Promise<PageSizes> => {
    const { turnsPage } = await turnSettings(turns.files, { user: at.user ?? "", chat: at.params.chat ?? "", session: NO_SESSION }, turns.env.log);
    return { default: turnsPage.size, most: turnsPage.most };
  };

  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/prompt",
      access: "page",
      group: "turns",
      does: "The prompt map of the chat's preset as found in a turn's prompt: each slice's marker, kind, line, behaviour, text, where and how it was found and what the breakdown said; the text no slice claims; the turn's notices and front; Lumiverse's clipping; and the old engines' blocks still in the preset.",
      query: turnQuery,
      reply: promptShownReply,
      joined: true,
      handle: ({ user, params, query }) => shown(scopeOf(user, params.chat, query.turn)),
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/prompt/history",
      access: "page",
      group: "turns",
      does: "Each turn's prompt notices and front, newest first, with its number on the chat's path and Lumiverse's clipping, for the turns whose prompt RPE still keeps. The settings `turns.page` and `turns.maxPage` give a page's length.",
      reply: shape.page(promptTurnShown),
      paged: { sizes: historySizes },
      handle: ({ user, params, query }) => {
        const rows = turns.prompts.locatedPage(user, params.chat, query.limit + 1, query.after);
        const numbers = new Map(turns.store.user(user).path(params.chat).map((e, i) => [e.turn, i + 1]));
        const page = rows.slice(0, query.limit);
        const last = page.at(-1);
        return {
          items: page.map((r) => ({ turn: r.turn, n: numbers.get(r.turn) ?? null, at: r.received, notices: r.located.notices, front: r.located.front, clipped: clippedOf(r.cut) })),
          next: rows.length > query.limit && last !== undefined ? `${last.received}~${last.turn}` : null,
        };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/prompt/edit",
      access: "page",
      group: "turns",
      does: "Makes one of his edits to the prompt map as found in a turn's prompt (rename a marker, merge slices, split one, correct a line, change a kind), kept as his for every chat on the preset, and answers the map as found again; a refusal is said in the prompt map's words.",
      query: turnQuery,
      body: promptEditAsk,
      reply: promptShownReply,
      joined: true,
      handle: async ({ user, params, query, body }) => {
        const scope = scopeOf(user, params.chat, query.turn);
        const edited = await turns.harness.promptMap.edit(scope, body, { id: PLAYER, definition: PLAYER });
        if (edited.status === "refused") throw new RouteError(400, edited.words);
        return shown(scope);
      },
    }),
  ] as const;
}

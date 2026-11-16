// The Files page's routes over the agents' suggestions (plan §5.1, §5.2): each listed with what it would
// change and where accepting it writes, accepted as it is or edited (written as the user), or dismissed.
// Nothing here is an agent's: an agent files a suggestion through RPH and never decides one.

import type { LayerLevel } from "rp-harness/contract";
import { route, RouteError, shape } from "../app";
import { placeAt, userMayWrite } from "./catalog";
import { lineDiff } from "./defaults";
import { chatOf, LEVELS, levelOf, type RouteKit } from "./route-kit";
import { readText } from "../app/disk";
import { treeSettingsOf } from "./settings";
import { chatQuery, suggestionAcceptBody, suggestionAcceptedReply, suggestionDismissedReply, suggestionState, suggestionsReply, type TreeSuggestionView } from "./shapes";
import type { TreeSuggestion } from "./suggestions";
import { kindOf, levelBase, locate } from "./view";

/** The levels a suggestion's file may be taken in place of at: the user's own, never the shipped one. */
const OWN_LEVELS: readonly LayerLevel[] = ["global", "character", "chat"];

export function suggestionRoutes(kit: RouteKit) {
  const { deps, own } = kit;

  /**
   * Where accepting a suggestion may write: the levels that have a place for its file (and a folder, for a chat not played yet),
   * and the one it writes at when none is named: the file's own level, or for a shipped file the chat's, which the suggestion came from.
   */
  const placesOf = async (user: string, s: TreeSuggestion): Promise<{ level?: LayerLevel; levels: LayerLevel[] }> => {
    const loc = own.locationOf(user, s.chat);
    const lookup = await locate(loc, s.path);
    if (!lookup.ok) return { levels: [] };
    const at = lookup.at;
    const levels = OWN_LEVELS.filter((l) => {
      const place = levelBase(loc, l) === null ? null : placeAt(at.level, at.rest, l);
      return place !== null && userMayWrite(l, place, kindOf(l, place));
    });
    const level = at.level === "shipped" ? (levels.includes("chat") ? "chat" : levels[0]) : at.level;
    return level === undefined ? { levels } : { level, levels };
  };

  /** A suggestion of the user's, as the page shows it: with the difference from its file as it is now to the text proposed, and where accepting it writes. */
  const shownSuggestion = async (user: string, s: TreeSuggestion): Promise<TreeSuggestionView> => {
    const loc = own.locationOf(user, s.chat);
    const lookup = await locate(loc, s.path);
    const now = lookup.ok && lookup.at.is === "file" && lookup.at.disk !== null ? await readText(lookup.at.disk) : null;
    const where = await placesOf(user, s);
    return { ...s, lines: lineDiff(now ?? "", s.text, (await treeSettingsOf(loc)).diffCells), levels: where.levels, ...(where.level === undefined ? {} : { level: where.level }) };
  };

  /** An open suggestion of the user's; a 404 for none, a 409 for one decided already. */
  const openSuggestion = (user: string, id: string): TreeSuggestion => {
    const s = /^\d+$/.test(id) ? deps.suggestions.one(user, Number(id)) : null;
    if (s === null) throw new RouteError(404, `There is no suggestion ${id}.`);
    if (s.state !== "open") throw new RouteError(409, `Suggestion ${id} was ${s.state} already.`);
    return s;
  };

  return [
    route({
      method: "GET",
      path: "/api/v1/suggestions",
      access: "page",
      group: "files",
      does: "A chat's suggestions from the agents (every chat's when none is named), newest first, each with what it would change and the level accepting it writes at.",
      query: { chat: chatQuery, state: shape.optional(suggestionState, "Only the suggestions in this state.") },
      reply: suggestionsReply,
      handle: async ({ user, query }) => {
        const listed = deps.suggestions.list(user, chatOf(query.chat), query.state);
        return { suggestions: await Promise.all(listed.map((s) => shownSuggestion(user, s))) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/suggestions/:id/accept",
      access: "page",
      group: "files",
      does: "Accepts a suggestion as it is or edited, writing it as the user at the level named, or where the suggestion says it writes; says the suggestion as it now stands and the file.",
      body: suggestionAcceptBody,
      reply: suggestionAcceptedReply,
      handle: async ({ user, params, body }) => {
        const s = openSuggestion(user, params.id);
        const loc = own.locationOf(user, s.chat);
        const level = body.level === undefined ? (await placesOf(user, s)).level : levelOf(body.level, LEVELS, s.chat);
        if (level === undefined) throw new RouteError(400, `No level of this chat has a place for ${s.path}: name the level your own is written at, as \`level\`.`);
        if (!(await deps.suggestions.decide(user, s.id, "accepted"))) throw new RouteError(409, `Suggestion ${s.id} was decided already.`);
        let written: string;
        try {
          written = await own.writeAsUser(user, loc, s.path, level, body.text ?? s.text);
        } catch (error) {
          await deps.suggestions.reopen(user, s.id);
          throw error;
        }
        await kit.written(user, s.chat, written, level);
        return { suggestion: deps.suggestions.one(user, s.id), file: await kit.entryOf(user, loc, written) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/suggestions/:id/dismiss",
      access: "page",
      group: "files",
      does: "Dismisses a suggestion; says the suggestion as it now stands.",
      reply: suggestionDismissedReply,
      handle: async ({ user, params }) => {
        const s = openSuggestion(user, params.id);
        if (!(await deps.suggestions.decide(user, s.id, "dismissed"))) throw new RouteError(409, `Suggestion ${s.id} was decided already.`);
        return { suggestion: deps.suggestions.one(user, s.id) };
      },
    }),
  ] as const;
}

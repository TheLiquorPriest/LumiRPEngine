// The author's and the GM's archive tools (DEPTH-PLAN §4.3): search the chat's own prose by words,
// person, place or story time, and quote any of it, over the raw archive index (`shared/archive.ts`,
// `backend/archive-index.ts`). Both roles work out of world, so they read the whole chat; a
// character never gets these tools (its recall is its own mind and the points of view it received).
// A tool that reads for a job bounds its reads at the job's basis (`upTo`), so a reflection anchored
// at a message never reads a reply written after it.

import type { ArchiveHit, ArchiveQuery, ArchiveQuote, ArchiveQuoteRequest, ArchiveResult } from "../../shared/archive";
import { ARCHIVE_QUOTE_MAX } from "../../shared/archive";
import { DEPTH_TOOL_TEXT } from "../../shared/depth-prompts";
import type { MessageId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import type { PromptTexts } from "../../shared/prompts";
import type { WorldDoc } from "../../shared/world";
import { calendarOf, clockOfPhrase, clockOfStamp, formatClock } from "../../engine/calendar";
import { own } from "../../engine/pack-kit";
import type { WorldState } from "../../engine/state";
import { renderPrompt } from "../prompts";
import type { AgentTool, ToolOutcome } from "../agents/runtime";
import { bareId, personNamed, placeNamed } from "./common";

/** The archive of one chat, as its index answers (`ArchiveIndex` bound to the chat and its user). */
export interface ArchiveSource {
  search(q: ArchiveQuery): Promise<ArchiveResult>;
  quote(r: ArchiveQuoteRequest): Promise<ArchiveQuote | null>;
}

export const ARCHIVE_TOOLS = { search: "archive_search", quote: "archive_quote" } as const;

/** A whole number as the arguments give it, or written as text; null for anything else. */
export function wholeArg(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : null;
}

/**
 * `archive_search` and `archive_quote` for the author or the GM, reading `source`; `world` and `state`
 * name its people and places and word its story times; `upTo` bounds what it reads at a job's basis.
 */
export function archiveTools(input: { texts: PromptTexts; world: WorldDoc; state: Readonly<WorldState>; source: ArchiveSource; upTo?: MessageId }): AgentTool[] {
  const { world, state, texts } = input;
  const cal = calendarOf(world);
  const text = (id: string): string => renderPrompt(id, texts, {});
  // A person or a place as the arguments name it: an id, or a name the world has.
  const idOf = (v: unknown, kind: "person" | "place"): string | null | undefined => {
    if (typeof v !== "string" || v.trim() === "") return undefined;
    return kind === "person" ? personNamed(state, v) : placeNamed(world, v);
  };
  // A story time as the arguments write it: a stamp as the archive words them, or a phrase read from the chat's clock now.
  const timeOf = (v: unknown): number | null | undefined => (typeof v !== "string" || v.trim() === "" ? undefined : (clockOfStamp(cal, v.trim()) ?? clockOfPhrase(cal, state.clock, v.trim())));
  const nameOf = (id: string): string => own(state.entities, id)?.name ?? own(world.places, id)?.name ?? id;
  const hitLine = (h: ArchiveHit): string =>
    `- message ${h.index + 1} [${h.messageId}] (${h.isUser ? "the player" : "a reply"}${h.storyTime !== null ? `, ${formatClock(cal, h.storyTime)}` : ""}${h.places.length > 0 ? `, at ${h.places.map(nameOf).join(", ")}` : ""}${h.people.length > 0 ? `; ${h.people.map(nameOf).join(", ")}` : ""}${h.beats.length > 0 ? `; ${h.beats.length} beat${h.beats.length === 1 ? "" : "s"}` : ""}) chars ${h.span[0]}–${h.span[1]}: ${h.snippet}`;
  const search: AgentTool = {
    name: ARCHIVE_TOOLS.search,
    description: text(DEPTH_TOOL_TEXT.search),
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: text(DEPTH_TOOL_TEXT.searchText) },
        who: { type: "string", description: text(DEPTH_TOOL_TEXT.searchWho) },
        place: { type: "string", description: text(DEPTH_TOOL_TEXT.searchPlace) },
        from: { type: "string", description: text(DEPTH_TOOL_TEXT.searchFrom) },
        to: { type: "string", description: text(DEPTH_TOOL_TEXT.searchTo) },
        offset: { type: "integer", description: text(DEPTH_TOOL_TEXT.searchOffset) },
      },
    },
    async run(args: JsonObject): Promise<ToolOutcome> {
      const who = idOf(args.who, "person");
      const place = idOf(args.place, "place");
      const from = timeOf(args.from);
      const to = timeOf(args.to);
      if (who === null || place === null) return { text: `No ${who === null ? `person called "${String(args.who)}"` : `place called "${String(args.place)}"`} in this world.`, error: true };
      if (from === null || to === null) return { text: `"${String(from === null ? args.from : args.to)}" isn't a story time this tool reads: give one as the archive words them ("${formatClock(cal, state.clock)}"), or a phrase like "yesterday morning".`, error: true };
      const offset = Math.max(0, wholeArg(args.offset) ?? 0);
      const q: ArchiveQuery = {
        ...(typeof args.text === "string" && args.text.trim() !== "" ? { text: args.text.trim() } : {}),
        ...(who ? { who } : {}),
        ...(place ? { place } : {}),
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
        ...(input.upTo ? { upTo: input.upTo } : {}),
        offset,
      };
      const found = await input.source.search(q);
      if (found.hits.length === 0) return { text: offset > 0 ? `No more: ${found.total} found in all.` : "Nothing in the chat matches." };
      const next = offset + found.hits.length < found.total ? ` More with offset ${offset + found.hits.length}.` : "";
      return { text: `${found.total} found; ${offset + 1}–${offset + found.hits.length}:\n${found.hits.map(hitLine).join("\n")}\n${next}`.trim() };
    },
  };
  const quote: AgentTool = {
    name: ARCHIVE_TOOLS.quote,
    description: text(DEPTH_TOOL_TEXT.quote),
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: text(DEPTH_TOOL_TEXT.quoteMessage) },
        from: { type: "integer", description: text(DEPTH_TOOL_TEXT.quoteFrom) },
        to: { type: "integer", description: text(DEPTH_TOOL_TEXT.quoteTo) },
      },
      required: ["message"],
    },
    async run(args: JsonObject): Promise<ToolOutcome> {
      const messageId = typeof args.message === "string" ? bareId(args.message) : "";
      if (messageId === "") return { text: "Name the message to quote by its id, as archive_search gives it.", error: true };
      const start = wholeArg(args.from);
      const end = wholeArg(args.to);
      const got = await input.source.quote({ messageId, ...(start !== null && end !== null && end > start ? { span: [Math.max(0, start), end] as [number, number] } : {}) });
      if (!got) return { text: `No message ${messageId} on this chat's story.`, error: true };
      const cut = got.truncated ? ` (cut at ${ARCHIVE_QUOTE_MAX} characters; quote from ${got.span[1]} for more)` : "";
      return { text: `Message ${got.index + 1} [${got.messageId}] (${got.isUser ? "the player" : "a reply"}${got.storyTime !== null ? `, ${formatClock(cal, got.storyTime)}` : ""}), chars ${got.span[0]}–${got.span[1]}${cut}:\n${got.text}` };
    },
  };
  return [search, quote];
}

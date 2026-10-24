// The engine feed (DESIGN §6.11): what goes into each section and whose knowledge it comes from.
// A section's feed is its world defaults (`SectionTemplate`'s `enabled`, `maxTokens`, `maxLines`,
// `include`, `scope`), or the GM's settings for it in this chat in their place, held in the
// engine's state slice by an `engine.feed` event, so the override is a GM edit with its own Undo. Pure.

import type { SlotId } from "../shared/ids";
import { isRecord, type JsonObject } from "../shared/json";
import type { PackEvent } from "../shared/ledger";
import { readSectionFeed, SECTION_FEED_KEYS, type FeedScope, type SectionFeed, type SectionTemplate } from "../shared/world";
import type { EventTypeDef, FeedLine, ReadContext, SectionRenderer } from "./registry";
import type { WorldState } from "./state";
import { engineSlice } from "./scope";

/** The engine's state-slice key for the GM's per-chat section overrides. */
const FEED_KEY = "feed";

export const FEED_EVENT = "engine.feed";

/** The GM's overrides in this chat, by section; none in a chat that never had one. */
export function chatFeed(state: Readonly<WorldState>): Record<SlotId, SectionFeed> {
  const raw = engineSlice(state)[FEED_KEY];
  const out: Record<SlotId, SectionFeed> = {};
  if (!isRecord(raw)) return out;
  for (const [slot, v] of Object.entries(raw)) {
    const feed = readSectionFeed(v);
    if (feed) out[slot] = feed;
  }
  return out;
}

/** A section's feed as the world sets it: none when malformed, which the lint flags. */
export function worldFeed(section: SectionTemplate): SectionFeed {
  const authored: Record<string, unknown> = {};
  for (const key of SECTION_FEED_KEYS) if (section[key] !== undefined) authored[key] = section[key];
  return readSectionFeed(authored) ?? {};
}

/**
 * A section's feed in this chat: the GM's settings for it when it has any, whole, else the world's.
 * Whole, so the GM can lift a cap or a source list the world set, which a merge couldn't.
 */
export function feedOf(section: SectionTemplate, state: Readonly<WorldState>): SectionFeed {
  return chatFeed(state)[section.id] ?? worldFeed(section);
}

/** A renderer's name for `include`. */
export function sourceOf(r: SectionRenderer): string {
  return r.source ?? r.slot;
}

/** The renderers that fill a section: its `include`'s sources, else every renderer of its slot. */
export function renderersOf(renderers: readonly SectionRenderer[], section: SectionTemplate, feed: SectionFeed): SectionRenderer[] {
  const include = feed.include;
  return include ? renderers.filter((r) => include.includes(sourceOf(r))) : renderers.filter((r) => r.slot === section.id);
}

/** A renderer's lines in a scope: its own scoped lines, else its player lines, which every scope keeps. */
export function linesOf(r: SectionRenderer, ctx: ReadContext, scope: FeedScope): FeedLine[] {
  if (r.feed) return r.feed(ctx, scope);
  return r.render(ctx).map((text) => ({ text, known: "pov" }));
}

/** The note a fact beyond the player character's carries for the narrator (DESIGN §6.11). */
export function markedText(line: FeedLine): string {
  if (line.known === "pov") return line.text;
  return line.known === "scene" ? `${line.text} [unknown to you; known to ${line.who ?? "others here"}]` : `${line.text} [unknown to you; GM only]`;
}

/** The narrator rule that goes with marked facts (DESIGN §6.11). */
export const MARKED_FACTS_RULE =
  "Facts marked [unknown to you] are not known to the player character. Use them only to steer the story and the people in it; never reveal them, narrate them as known, or let the player character act on them.";

/** The `engine.feed` event: one section's override in this chat, replaced whole (`to: null` clears it). */
export const feedEvent: EventTypeDef<PackEvent> = {
  type: FEED_EVENT,
  validate: (e) => {
    if (typeof e.data.section !== "string" || e.data.section.trim() === "") return { code: "bad_event", reason: "a section override names its section" };
    return e.data.to === null || readSectionFeed(e.data.to) ? null : { code: "bad_event", reason: "a section override is enabled, maxTokens, maxLines, include or scope" };
  },
  apply: (e, state) => {
    const section = typeof e.data.section === "string" ? e.data.section : "";
    const s = state.packs.engine ?? {};
    state.packs.engine = s;
    const current: JsonObject = isRecord(s[FEED_KEY]) ? { ...(s[FEED_KEY] as JsonObject) } : {};
    const to = e.data.to === null ? null : readSectionFeed(e.data.to);
    // An empty override still stands: it is the plain section in place of the world's settings.
    if (to) current[section] = to as JsonObject;
    else delete current[section];
    s[FEED_KEY] = current;
  },
  // A GM setting, not a fact of the story: the player's Journal has no line for it.
  describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : `the ${typeof e.data.section === "string" ? e.data.section : "?"} section's settings in this chat`),
};

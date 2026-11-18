// The engine feed (DESIGN §6.11): what goes into each section and whose knowledge it comes from.
// A section's feed is its world defaults (`SectionTemplate`'s `enabled`, `maxTokens`, `maxLines`,
// `include`, `scope`), or the GM's settings for it in this chat in their place, held in the
// engine's state slice by an `engine.feed` event, so the override is a GM edit with its own Undo.
// A section that sets no scope reads in the narrator's knowledge (`sectionScope`). Pure.

import type { EntityId, SlotId } from "../shared/ids";
import { isRecord, type JsonObject } from "../shared/json";
import type { PackEvent } from "../shared/ledger";
import { secretMarkText, type SecretMarkWording } from "../shared/secret-marks";
import type { NarratorView } from "../shared/narrator-view";
import { readSectionFeed, SECTION_FEED_KEYS, type FeedScope, type SectionFeed, type SectionTemplate } from "../shared/world";
import type { EventTypeDef, FeedLine, ReadContext, SectionRenderer } from "./registry";
import type { WorldState } from "./state";
import { own } from "./pack-kit";
import { engineSlice } from "./scope";
import { listOf, say } from "../shared/lines";

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

/** The scope a narrator's knowledge stands for (DESIGN §6.11): everyone in the scene's is everything, each fact beyond the player character's marked (`gm`); the player character's is `player`. */
export function viewScope(view: NarratorView): FeedScope {
  return view.knowledge === "scene" ? "gm" : "player";
}

/**
 * A section's scope in this chat (DESIGN §6.11): the nearest choice, in the order the narrator's
 * knowledge falls back (this chat, its world, the user), the section's own before the narrator's at
 * each level. The GM's settings for the section in this chat stand whole: their scope, else the
 * narrator's knowledge in force. Without them, this chat's own narrator knowledge comes before a
 * scope the world set on its section, and that scope before the world's or the user's narrator
 * knowledge. `narrator.chat` is the chat's own choice (null when it follows), `narrator.view` the
 * knowledge in force.
 */
export function sectionScope(section: SectionTemplate, state: Readonly<WorldState>, narrator: { chat: NarratorView | null; view: NarratorView }): FeedScope {
  const gm = chatFeed(state)[section.id];
  if (gm) return gm.scope ?? viewScope(narrator.view);
  if (narrator.chat) return viewScope(narrator.chat);
  return worldFeed(section).scope ?? viewScope(narrator.view);
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

/** A renderer's lines in a scope: its own scoped lines, else its player lines, which every scope keeps. A line the history lines have no words for (the user deleted it) is said as nothing, so it is no line. */
export function linesOf(r: SectionRenderer, ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const lines = r.feed ? r.feed(ctx, scope) : r.render(ctx).map((text): FeedLine => ({ text, known: "pov" }));
  return lines.filter((l) => l.text !== "");
}

/** The note a fact beyond the player character's carries for the narrator (DESIGN §6.11), worded by the lines `feed_marked_scene` and `feed_marked_gm`; the narrator rules' marked-facts text says what it means (`MARKED_FACTS_RULE`, `shared/prompts.ts`). */
export function markedText(line: FeedLine): string {
  if (line.known === "pov") return line.text;
  return line.known === "scene" ? say("feed_marked_scene", { text: line.text, ...(line.who !== undefined ? { who: line.who } : {}) }) : say("feed_marked_gm", { text: line.text });
}

/**
 * A secret line (`FeedLine.secret`, DESIGN §24.11) as the narrator's knowledge gives it: under
 * "marked", its text with whom it is known to and kept from, by name, in the secret mark's wording
 * (the prompt registry's Secret marks texts, as the turn resolves them); under "omit", nothing. Null
 * for a line that isn't a secret.
 */
export function secretLineText(line: FeedLine, secrets: "marked" | "omit", wording: SecretMarkWording, nameOf: (id: EntityId) => string): string | null {
  if (!line.secret || secrets === "omit") return null;
  const kept = line.secret.keptFrom;
  return secretMarkText(line.text, (line.secret.known ?? []).map(nameOf), kept === "everyone" ? "everyone" : kept.map(nameOf), wording);
}

/** The `engine.feed` event: one section's override in this chat, replaced whole (`to: null` clears it). */
export const feedEvent: EventTypeDef<PackEvent> = {
  type: FEED_EVENT,
  validate: (e) => {
    if (typeof e.data.section !== "string" || e.data.section.trim() === "") return { code: "bad_event", reason: say("why_a_section_override_names_its_section") };
    return e.data.to === null || readSectionFeed(e.data.to) ? null : { code: "bad_event", reason: say("why_a_section_override_is_enabled_maxtokens_maxlines") };
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
  describe: (e, ctx, viewer) => {
    if (viewer !== undefined) return "";
    const section = typeof e.data.section === "string" ? e.data.section : "";
    // The world's own sections carry their labels; a default one is named by its id ("montage" reads "Montage").
    const label = own(ctx.world.sections, section)?.label ?? `${section.charAt(0).toUpperCase()}${section.slice(1).replace(/_/g, " ")}`;
    return feedSentence(label, e.data.to === null ? null : readSectionFeed(e.data.to));
  },
};

/**
 * A section's settings in a chat as one sentence (`lre.edit` `feed`, DESIGN §6.11): out of the prompt, back to the world's, or
 * what this chat sets for it (whose knowledge it tells, its caps, the sources picked), the notice the save leaves and the GM's
 * Edits log alike, worded by the lines `feedset_*`. A section that sets no scope follows the narrator's knowledge (`sectionScope`).
 */
function feedSentence(label: string, to: SectionFeed | null): string {
  if (to === null) return say("feedset_world", { label });
  if (to.enabled === false) return say("feedset_off", { label });
  const caps = [to.maxLines !== undefined ? say("feedset_lines", { n: to.maxLines, one: to.maxLines === 1 }) : "", to.maxTokens !== undefined ? say("feedset_tokens", { n: to.maxTokens }) : ""].filter((c) => c !== "");
  const parts = [
    to.scope ? say(`feedset_scope_${to.scope}`) : say("feedset_scope_narrator"),
    caps.length > 0 ? say("feedset_cut", { caps: listOf(caps) }) : say("feedset_uncapped"),
    to.include ? say("feedset_sources", { n: to.include.length, one: to.include.length === 1 }) : "",
  ].filter((p) => p !== "");
  return say("feedset", { label, parts: parts.join(", ") });
}

// Settings → Agents → Context (DESIGN §4.6, "A role's context"): what each role of an agent turn starts
// with, and how the main agent is to brief it. A config steers; it never screens. Every role's tools
// read everything, secrets marked in the user's wording, as their tool settings give them; a role's
// perspective is a hint in its prompt; and the main agent, the governor of every role's context, is
// given this config as its guidance for what to tell each role (`main.context`). In the fixed
// pipeline, and under the main agent alike, a role's prompt starts with its `start` sources and its
// pinned files, so no role gets less than its config gives. Kept in `UserSettings.agents.context`;
// a role's old `knowledge` setting is read and ignored.

import { ROLE_IDS, type RoleId } from "./agent-roles";
import { hasOwn, isRecord, safeKey } from "./json";
import { MINDS_SLOT } from "./minds";
import { DEFAULT_SECTIONS } from "./sections";

/**
 * Whose perspective a role works from (the role's system prompt fills `{{knowledge}}` with the Every
 * role page's text for it): the player character's, everyone's (secrets marked), the GM's, or the
 * character a task is about (`own`). A hint, never a screen: its tools read the same either way.
 */
export type RolePerspective = "pov" | "everyone" | "gm" | "own";
export const ROLE_PERSPECTIVES: readonly RolePerspective[] = ["pov", "everyone", "gm", "own"];

/** What a role's prompt may start with: the lore index, or one of the narrator's built-in sections by its slot, as the narrator gets it then. */
export const LORE_INDEX_SOURCE = "lore_index";
export const CONTEXT_SOURCES: readonly string[] = [LORE_INDEX_SOURCE, ...Object.values(DEFAULT_SECTIONS).sort((a, b) => a.rank - b.rank).map((s) => s.id)];

/** How a role gets a source: in its prompt from the start, from the main agent when its task needs it, or never. */
export type SourceUse = "start" | "ask" | "never";
export const SOURCE_USES: readonly SourceUse[] = ["start", "ask", "never"];

/** One role's context: its perspective, the sources its prompt starts with, those it is never given, and the workspace files pinned for it. */
export interface RoleContext {
  perspective: RolePerspective;
  start: string[];
  never: string[];
  /** Workspace paths, read whole within its pins budget, before `.pins.json`'s and those pinned in GM → Workspace; a path the chat has no file at is passed over. */
  pins: string[];
}

export interface ContextSettings {
  roles: Record<RoleId, RoleContext>;
}

/** §5's perspective for each role: the intent the player character's, a mind and memory their own character's, the Curator the GM's (every secret marked, ITEMS-SPEC §7.2), the rest everyone's. */
const PERSPECTIVE: Readonly<Record<RoleId, RolePerspective>> = { intent: "pov", scene: "everyone", minds: "own", knowledge: "everyone", director: "everyone", read: "everyone", curator: "gm", memory: "own", skip: "everyone", world: "everyone" };

/** What each role starts with by default: the director, which briefs and outlines the reply, the Minds and the Scene (with the scene role's lore and notes); the Curator the Place, Gear, People, Vehicles and Property sections (a bought car or house lands among what it knows); every other role its task alone. */
const START: Readonly<Partial<Record<RoleId, readonly string[]>>> = { director: [MINDS_SLOT, "scene"], curator: ["place", "gear", "people", "vehicles", "property"] };

/** What a role is never given by default: the Curator keeps to the world's fabric, never the minds (ITEMS-SPEC §7.2). */
const NEVER: Readonly<Partial<Record<RoleId, readonly string[]>>> = { curator: [MINDS_SLOT] };

/** A new user's context config. */
export function defaultContextSettings(): ContextSettings {
  const roles = {} as Record<RoleId, RoleContext>;
  for (const id of ROLE_IDS) roles[id] = { perspective: PERSPECTIVE[id], start: CONTEXT_SOURCES.filter((s) => START[id]?.includes(s) === true), never: CONTEXT_SOURCES.filter((s) => NEVER[id]?.includes(s) === true), pins: [] };
  return { roles };
}

/** How a role whose context is `context` gets `source`. */
export function sourceUse(context: Readonly<RoleContext>, source: string): SourceUse {
  return context.start.includes(source) ? "start" : context.never.includes(source) ? "never" : "ask";
}

/** The lists of `context` with `source` used as `use`: a source is in one list at most, each in `CONTEXT_SOURCES`' order. */
export function withSourceUse(context: Readonly<RoleContext>, source: string, use: SourceUse): Pick<RoleContext, "start" | "never"> {
  const start = context.start.filter((s) => s !== source);
  const never = context.never.filter((s) => s !== source);
  if (use === "start") start.push(source);
  if (use === "never") never.push(source);
  return { start: CONTEXT_SOURCES.filter((s) => start.includes(s)), never: CONTEXT_SOURCES.filter((s) => never.includes(s)) };
}

function roleContextOf(v: unknown, d: Readonly<RoleContext>): RoleContext {
  const r = isRecord(v) ? v : {};
  const { start: rawStart, never: rawNever, pins } = r;
  const start = Array.isArray(rawStart) ? CONTEXT_SOURCES.filter((s) => rawStart.includes(s)) : [...d.start];
  // A source the role starts with is never also one it is never given.
  const never = (Array.isArray(rawNever) ? CONTEXT_SOURCES.filter((s) => rawNever.includes(s)) : [...d.never]).filter((s) => !start.includes(s));
  return {
    perspective: typeof r.perspective === "string" && (ROLE_PERSPECTIVES as readonly string[]).includes(r.perspective) ? (r.perspective as RolePerspective) : d.perspective,
    start,
    never,
    pins: Array.isArray(pins) ? [...new Set(pins.flatMap((p) => (typeof p === "string" && safeKey(p.trim()) ? [p.trim()] : [])))] : [...d.pins],
  };
}

/** `UserSettings.agents.context` as the runtime reads it: each role's own, else `d`'s. */
export function contextSettingsOf(raw: unknown, d: Readonly<ContextSettings> = defaultContextSettings()): ContextSettings {
  const roles = isRecord(raw) && isRecord(raw.roles) ? raw.roles : {};
  const out = {} as Record<RoleId, RoleContext>;
  for (const id of ROLE_IDS) out[id] = roleContextOf(hasOwn(roles, id) ? roles[id] : undefined, d.roles[id]);
  return { roles: out };
}

// ---------------------------------------------------------------- the page's words

export const PERSPECTIVE_LABEL: Readonly<Record<RolePerspective, string>> = { pov: "Your character's", everyone: "Everyone's, secrets marked", gm: "The GM's", own: "Its character's own" };

export const SOURCE_USE_LABEL: Readonly<Record<SourceUse, string>> = { start: "Starts with", ask: "When needed", never: "Never" };

/** What Settings → Agents → Context, and the main agent's guidance, call each source. */
export function sourceLabel(source: string): string {
  if (source === LORE_INDEX_SOURCE) return "Lore index";
  return Object.values(DEFAULT_SECTIONS).find((s) => s.id === source)?.label ?? source;
}

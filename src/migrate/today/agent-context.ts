// What today's agent settings read of Settings → Agents → Context (DESIGN §4.6, "A role's context"):
// what each role of an agent turn starts with, and how the main agent is to brief it. Today's code,
// carried for the migration's settings store (PlanSwap-15 item 3) without the page's words (the
// perspectives', the uses' and the sources' labels), which stay with the agents engine that
// PlanSwap-10 removes. Kept in `UserSettings.agents.context`; a role's old `knowledge` setting is
// read and ignored.

import { hasOwn, isRecord, safeKey } from "../../shared/json";
import { MINDS_SLOT } from "../../shared/minds";
import { DEFAULT_SECTIONS } from "../../shared/sections";
import { ROLE_IDS, type RoleId } from "./agent-roles";

/**
 * Whose perspective a role works from: the player character's, everyone's (secrets marked), the
 * GM's, or the character a task is about (`own`). A hint, never a screen: its tools read the same
 * either way.
 */
export type RolePerspective = "pov" | "everyone" | "gm" | "own";
export const ROLE_PERSPECTIVES: readonly RolePerspective[] = ["pov", "everyone", "gm", "own"];

/** What a role's prompt may start with: the lore index, or one of the narrator's built-in sections by its slot, as the narrator gets it then. */
export const LORE_INDEX_SOURCE = "lore_index";
export const CONTEXT_SOURCES: readonly string[] = [LORE_INDEX_SOURCE, ...Object.values(DEFAULT_SECTIONS).sort((a, b) => a.rank - b.rank).map((s) => s.id)];

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

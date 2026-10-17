// Identifier aliases and the closed enumerations every module shares (DESIGN §3, §9.1).
// Ids are plain strings; the aliases document intent at call sites.

export type WorldId = string;
/** A world revision: `hashJson` of the revision document (32 hex digits). */
export type RevisionId = string;
export type KindId = string;
export type FieldId = string;
export type RelationTypeId = string;
export type EntityId = string;
export type PlaceId = string;
export type RouteId = string;
export type GridId = string;
export type RuleId = string;
export type ActionId = string;
export type CheckId = string;
export type ScheduleId = string;
export type TrackId = string;
export type StageId = string;
export type TableId = string;
/** A progression in a world's ruleset (`WorldDoc.ruleset.progression`). */
export type ProgressionId = string;
export type GeneratorId = string;
export type SlotId = string;
export type StepTemplateId = string;
export type PackId = string;
export type SceneTypeId = string;
export type ChatId = string;
export type MessageId = string;
export type GenerationId = string;
export type UserId = string;
export type ChipId = string;
export type PanelId = string;
/** A registered event type: a core type (`set`, `add`, …) or `<packId>.<name>`. */
export type EventType = string;

/** Ids that may name a storage path segment: no dots, slashes or empties (`..` would reach everything). */
const PATH_SAFE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function pathSafe(id: unknown): id is string {
  return typeof id === "string" && PATH_SAFE.test(id);
}

/** A chat's run directory in user storage; a chat id that could escape it is refused. */
export function runDir(chatId: ChatId): string {
  if (!pathSafe(chatId)) throw new Error("invalid chat id");
  return `runs/${chatId}/`;
}

/** Realism domains (DESIGN §9.1). */
export const DOMAINS = ["money", "gear", "vehicles", "castlife", "relationships", "space", "calendar", "weather", "sheets"] as const;
export type DomainId = (typeof DOMAINS)[number];

/** Realism level per domain: 0 off … 4 simulation. */
export type Level = 0 | 1 | 2 | 3 | 4;

/**
 * The three fixed detail bands (DESIGN §9.1), each with a cap per domain. A world's own tiers
 * (`WorldDoc.tiers`) map onto them; the ids are the original tier ids, so settings, `resolve`
 * markers and stored ledgers read unchanged.
 */
export const BANDS = ["principal", "supporting", "background"] as const;
export type Band = (typeof BANDS)[number];

/** A tier the world defines (`WorldDoc.tiers`); an entity names one. */
export type TierId = string;

export type RealismPresetId = "story" | "grounded" | "simulation" | "custom";
export type ModelUsePresetId = "lean" | "standard" | "full" | "custom";

/** Knowledge visibility (DESIGN §7). `known_by` is resolved through `knows` relations. */
export type Visibility = "public" | "known_by" | "secret";

export type TravelMode = "walk" | "road" | "offroad" | "water";

/** Activity types that Speed through handles (DESIGN §9.2). Worlds may add more. */
export type ActivityType = "sleep" | "work_shift" | "travel" | "waiting" | (string & {});

/** Timelapse interrupt classes (DESIGN §9.2). */
export const INTERRUPT_CLASSES = ["invitation", "bill", "decline", "incident", "quest", "rule", "arrival", "overdue", "needs", "weather"] as const;
export type InterruptClass = (typeof INTERRUPT_CLASSES)[number];
export type InterruptPolicy = "stop" | "note" | "ignore";

/** Bound modes for model-proposed changes (DESIGN §11; per-type extraction defaults: D4). */
export type BoundMode = "auto" | "confirm" | "never";

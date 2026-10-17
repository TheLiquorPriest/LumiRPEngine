// World tiers and the three detail bands (DESIGN §9.1). A world names, adds and orders its own tiers;
// each maps to one of three fixed bands, and a band's caps limit how deeply its people are simulated.
// Pure lookups over the world document, shared by the engine (levels, spawns, lint, migration), the
// backend and the UI.

import type { Band, TierId } from "./ids";
import { BANDS } from "./ids";
import { hasOwn, isRecord } from "./json";
import type { EntityDef, TierDef, WorldDoc } from "./world";

/** What players see for each band. */
export const BAND_LABEL: Readonly<Record<Band, string>> = { principal: "Leads", supporting: "Supporting", background: "Background" };

/** The tiers a world gets when it defines none: one per band, with the band's own id. */
export function defaultTiers(): Record<TierId, TierDef> {
  return {
    principal: { label: BAND_LABEL.principal, band: "principal", order: 0 },
    supporting: { label: BAND_LABEL.supporting, band: "supporting", order: 1 },
    background: { label: BAND_LABEL.background, band: "background", order: 2 },
  };
}

export function isBand(value: unknown): value is Band {
  return BANDS.some((b) => b === value);
}

/** A tier the world defines with a valid band. The document is outside data, so nothing else counts. */
export function tierOf(world: Pick<WorldDoc, "tiers">, tier: TierId): TierDef | undefined {
  const t: unknown = isRecord(world.tiers) && hasOwn(world.tiers, tier) ? world.tiers[tier] : undefined;
  return isRecord(t) && isBand(t.band) ? (t as unknown as TierDef) : undefined;
}

/**
 * The band whose caps apply to a tier: the world's tier's band, else the band of that id (entities
 * spawned before a world renamed its tiers carry one), else none: an unknown tier, the legacy `pov`
 * among them, runs at the domain level, as it always did.
 */
export function tierBand(world: Pick<WorldDoc, "tiers">, tier: TierId): Band | null {
  return tierOf(world, tier)?.band ?? (isBand(tier) ? tier : null);
}

/** The world's tiers, lowest order first (ties by id; a tier without a usable order goes last). */
export function tiersInOrder(world: Pick<WorldDoc, "tiers">): [TierId, TierDef][] {
  if (!isRecord(world.tiers)) return [];
  return Object.keys(world.tiers)
    .flatMap((id): { id: TierId; t: TierDef; order: number }[] => {
      const t = tierOf(world, id);
      return t ? [{ id, t, order: typeof t.order === "number" && Number.isFinite(t.order) ? t.order : Number.MAX_SAFE_INTEGER }] : [];
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(({ id, t }) => [id, t]);
}

function firstIn(world: Pick<WorldDoc, "tiers">, bands: readonly Band[]): TierId | undefined {
  const ordered = tiersInOrder(world);
  for (const band of bands) {
    const hit = ordered.find(([, t]) => t.band === band);
    if (hit) return hit[0];
  }
  return undefined;
}

/** The tier a spawned entity gets when it names none: the world's `spawnTier`, else its lowest-order Background tier (else the next band up). */
export function spawnTierOf(world: Pick<WorldDoc, "tiers" | "spawnTier">): TierId {
  if (typeof world.spawnTier === "string" && tierOf(world, world.spawnTier)) return world.spawnTier;
  return firstIn(world, ["background", "supporting", "principal"]) ?? "background";
}

/** The lowest-order Leads tier (else the next band down): what a POV's legacy `pov` tier becomes. */
export function leadTierOf(world: Pick<WorldDoc, "tiers">): TierId {
  return firstIn(world, ["principal", "supporting", "background"]) ?? "principal";
}

/** Whether an entity is a LOD1 agent: its own flag when it sets one, else its tier's default. The POV never takes the default. */
export function agentOf(world: Pick<WorldDoc, "tiers" | "pov">, e: Pick<EntityDef, "id" | "tier" | "agent">): boolean {
  if (typeof e.agent === "boolean") return e.agent;
  return e.id !== world.pov && tierOf(world, e.tier)?.agentDefault === true;
}

/** A tier as players see it: the world's label, else the band's, else the id. */
export function tierLabel(world: Pick<WorldDoc, "tiers">, tier: TierId): string {
  return tierOf(world, tier)?.label ?? (isBand(tier) ? BAND_LABEL[tier] : tier);
}

/** The labels of the world's tiers in each band, in order: who a band's caps reach. */
export function bandTiers(world: Pick<WorldDoc, "tiers">): Record<Band, string[]> {
  const out: Record<Band, string[]> = { principal: [], supporting: [], background: [] };
  for (const [, t] of tiersInOrder(world)) out[t.band].push(t.label);
  return out;
}

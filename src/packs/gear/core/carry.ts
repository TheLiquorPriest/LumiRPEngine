// Everyday carry (ITEMS-SPEC §4.4): the catalog types the world's carry rules (`packs.gear.config.carry`)
// give a person, made the first time they are observed, at Gear 1 and above, as the gear pack's
// materialization (its generator 2). Each type they don't have yet becomes a thing of that type,
// theirs, on them and not notable; an everyday thing rests on its owner (`restOf`), so nothing is
// written for that. A type they own or carry already, by its catalog id or by its name (a "Wallet"
// is a wallet, "Keys" are a key set), is skipped. Pure.

import type { EntityId } from "../../../shared/ids";
import { hasOwn, isRecord } from "../../../shared/json";
import type { LintIssue } from "../../../shared/protocol";
import type { TableRow } from "../../../shared/tables";
import { thingsConfigOf } from "../../../shared/things";
import type { WorldDoc } from "../../../shared/world";
import { own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { isGone } from "../../../engine/scope";
import { selectorMatches } from "../../../engine/selector";
import { thingIndex, typeRowOf } from "../../../engine/thing-index";
import { namesThing } from "../../../engine/thing-resolve";
import { carriedBy } from "./model";

/** The name a thing of a type row is made with: the row's name before its qualifier ("Key set (house, car fob, keyring)" makes a Key set). */
export function carryName(row: TableRow, type: string): string {
  const name = typeof row.name === "string" ? row.name.split(/[,(]/)[0]?.trim() : "";
  return name !== undefined && name !== "" ? name : type;
}

/** A type someone is due to carry: its catalog id, the name a thing of it takes, and its row's price category when the row is the price catalog's. */
export interface CarryDue {
  type: string;
  name: string;
  category?: string;
}

/**
 * The types the world's carry rules give `who` (each rule whose selector matches them) that they
 * have no thing of yet, owned or on them, in the order the rules list them, each once. A type no
 * table of the world has makes nothing (the lint `gear.carry` says so).
 */
export function carryDue(ctx: ReadContext, who: EntityId): CarryDue[] {
  const rules = thingsConfigOf(ctx.world).carry.filter((rule) => selectorMatches(ctx.registry, ctx.world, ctx.state, rule.who, who));
  if (rules.length === 0) return [];
  const theirs = [...new Set([...(thingIndex(ctx).owned.get(who) ?? []), ...carriedBy(ctx.state, who)])].filter((id) => !isGone(ctx.state, id));
  const out: CarryDue[] = [];
  for (const type of rules.flatMap((rule) => rule.types)) {
    if (out.some((d) => d.type === type)) continue;
    const found = typeRowOf(ctx, { catalog: type });
    if (!found) continue;
    const name = carryName(found.row, type);
    if (theirs.some((id) => own(ctx.state.entities, id)?.fields.catalog === type || namesThing(ctx, id, name))) continue;
    out.push({ type, name, ...(found.table === "economy.catalog" && typeof found.row.category === "string" ? { category: found.row.category } : {}) });
  }
  return out;
}

const CARRY_TABLES = ["gear.items", "gear.containers", "economy.catalog"] as const;

/** The lint `gear.carry`: a type the world's own carry rules name that no catalog of the world has, so no one is ever made one. */
export function carryProblems(world: WorldDoc): LintIssue[] {
  const config = hasOwn(world.packs, "gear") ? world.packs.gear?.config : undefined;
  const rules = isRecord(config) && Array.isArray(config.carry) ? config.carry : [];
  const issues: LintIssue[] = [];
  for (const [i, rule] of rules.entries()) {
    for (const type of isRecord(rule) && Array.isArray(rule.types) ? rule.types : []) {
      if (typeof type !== "string" || CARRY_TABLES.some((table) => own(world.tables[table]?.rows ?? {}, type) !== undefined)) continue;
      issues.push({ severity: "warning", code: "gear.carry", path: `packs.gear.config.carry.${i}.types`, message: `Everyday carry names ${type}, which no catalog of this world has (gear items, containers or the price catalog), so no one is made one.` });
    }
  }
  return issues;
}

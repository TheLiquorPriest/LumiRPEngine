// The Upgrade preview (DESIGN §4.3 `migrate`): what an Upgrade with picks would bring into the
// chat, entity by entity and part by part, each with the pick it defaults to and why, worded for
// the world's owner. It words the very plan the fold applies (`planUpgrade`), so the defaults shown
// are the fold's. An Upgrade is the owner's tool, like the GM view, so secret entities are listed.

import type { EntityUpgradePick, UpgradeAspect } from "../shared/ledger";
import { UPGRADE_ASPECTS } from "../shared/ledger";
import { isRecord } from "../shared/json";
import type { UpgradeChange, UpgradeEntityRow, UpgradePreview, UpgradeTarget } from "../shared/protocol";
import { tierLabel } from "../shared/tiers";
import type { FieldDef, RelationInstance, WorldDoc } from "../shared/world";
import { formatMoney } from "../shared/world";
import { own } from "../engine/pack-kit";
import type { Registry } from "../engine/registry-impl";
import { relationDef } from "../engine/relations";
import { fieldDef, kindDef } from "../engine/scope";
import type { WorldState } from "../engine/state";
import type { PartDiff, RelationDiff, UpgradePlan } from "../engine/upgrade";

const ASPECT_LABEL: Record<UpgradeAspect, string> = { kind: "Kind", name: "Name", tier: "Tier", agent: "Lives off-screen", levels: "Level overrides", class: "Classes and tags" };

/** How much of a long value (a list of appointments) a row shows. */
const MAX_TEXT = 140;

const STATUS_ORDER: Record<UpgradeEntityRow["status"], number> = { new: 0, changed: 1, removed: 2 };

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/** The default pick of a part, and why: take what play never touched, keep what it did. */
function byDefault(touched: boolean): Pick<UpgradeChange, "pick" | "why" | "options"> {
  return { pick: touched ? "keep" : "take", why: touched ? "changed in play" : "unchanged", options: ["take", "keep"] };
}

export function upgradePreview(reg: Registry, plan: UpgradePlan, state: Readonly<WorldState>, after: WorldDoc, inForce: WorldDoc): UpgradePreview {
  /** An entity's or place's name, for an id a value holds; undefined for anything else. */
  const nameOf = (id: string): string | undefined => own(state.entities, id)?.name ?? own(after.entities, id)?.name ?? own(after.places, id)?.name ?? own(inForce.places, id)?.name;
  const valueText = (v: unknown, def?: FieldDef): string => {
    if (v === undefined || v === null) return "—";
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (typeof v === "number") return def?.type === "money" ? formatMoney(v, after.currency) : String(v);
    if (typeof v === "string") return clip(nameOf(v) ?? v);
    if (Array.isArray(v)) return v.length === 0 ? "none" : clip(`${v.length} × ${JSON.stringify(v)}`);
    return clip(JSON.stringify(v));
  };
  const aspectText = (aspect: UpgradeAspect, v: unknown): string => {
    if (aspect === "kind" && typeof v === "string") return kindDef(reg, after, v)?.label ?? kindDef(reg, inForce, v)?.label ?? v;
    if (aspect === "tier" && typeof v === "string") return tierLabel(after, v);
    if (aspect === "levels" && isRecord(v)) return Object.entries(v).map(([domain, level]) => `${domain} ${String(level)}`).join(", ") || "none";
    if (aspect === "class" && isRecord(v)) {
      const classes = isRecord(v.class) ? Object.entries(v.class).map(([facet, values]) => `${own(after.classifications, facet)?.label ?? facet}: ${Array.isArray(values) ? values.join(", ") : ""}`) : [];
      const tags = Array.isArray(v.tags) && v.tags.length > 0 ? [`tags: ${v.tags.join(", ")}`] : [];
      return [...classes, ...tags].join("; ") || "none";
    }
    return valueText(v);
  };
  const linkText = (r: RelationInstance | null): string => (r ? (r.fields && Object.keys(r.fields).length > 0 ? clip(`linked, ${Object.entries(r.fields).map(([k, x]) => `${k.replace(/_/g, " ")} ${valueText(x)}`).join(", ")}`) : "linked") : "not linked");

  const rows: UpgradeEntityRow[] = [];
  const shown = new Set<string>();
  for (const d of plan.entities) {
    const held = own(state.entities, d.id);
    const kind = kindDef(reg, after, d.def.kind)?.label ?? kindDef(reg, inForce, d.def.kind)?.label ?? d.def.kind;
    const row: UpgradeEntityRow = { entity: d.id, name: held?.name ?? d.def.name, kind, status: d.status, changes: [] };
    const whole: UpgradeTarget[] = [{ entity: d.id, part: "entity" }];
    if (d.status === "new") {
      const place = typeof d.def.fields.place === "string" ? nameOf(d.def.fields.place) : undefined;
      row.changes.push({ id: `${d.id}:entity`, label: "New in this revision", from: "not in the chat", to: place ? `${kind}, at ${place}` : kind, pick: "take", options: ["take", "keep"], why: "new", targets: whole });
    } else if (d.status === "removed") {
      const removal: EntityUpgradePick[] = ["keep", "remove"];
      row.changes.push({ id: `${d.id}:entity`, label: "Gone from this revision", from: "in the chat", to: "out of the world", pick: "keep", options: removal, why: "removed", targets: whole });
    } else {
      for (const aspect of UPGRADE_ASPECTS) {
        const diff: PartDiff | undefined = d.aspects[aspect];
        if (diff) row.changes.push({ id: `${d.id}:${aspect}`, label: ASPECT_LABEL[aspect], from: aspectText(aspect, diff.now), to: aspectText(aspect, diff.next), ...byDefault(diff.touched), targets: [{ entity: d.id, part: aspect }] });
      }
      for (const [field, diff] of Object.entries(d.fields)) {
        const def = fieldDef(reg, after, d.def.kind, field);
        row.changes.push({ id: `${d.id}:field:${field}`, label: def?.label ?? field.replace(/_/g, " "), from: valueText(diff.now, def), to: valueText(diff.next, def), ...byDefault(diff.touched), targets: [{ entity: d.id, part: "field", field }] });
      }
      for (const r of d.relations) {
        const key = `${d.id}\u0000${r.rel}\u0000${r.to}`;
        if (shown.has(key)) continue;
        // The other side of a pair changes with it: one row, picked for both.
        const other: RelationDiff | undefined = r.partner ? plan.entities.find((x) => x.id === r.partner?.holder)?.relations.find((x) => x.rel === r.partner?.rel && x.to === d.id) : undefined;
        const targets: UpgradeTarget[] = [{ entity: d.id, part: "relation", rel: r.rel, to: r.to }];
        if (r.partner && other) {
          targets.push({ entity: r.partner.holder, part: "relation", rel: other.rel, to: other.to });
          shown.add(`${r.partner.holder}\u0000${other.rel}\u0000${other.to}`);
        }
        const label = `${relationDef(reg, after, r.rel)?.label ?? relationDef(reg, inForce, r.rel)?.label ?? r.rel.replace(/_/g, " ")}: ${nameOf(r.to) ?? r.to}`;
        row.changes.push({ id: `${d.id}:rel:${r.rel}:${r.to}`, label, from: linkText(r.now), to: linkText(r.next), ...byDefault(r.touched || other?.touched === true), targets });
      }
    }
    if (row.changes.length > 0) rows.push(row);
  }
  rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const tracks = plan.tracks.map((t) => {
    const def = own(after.tracks, t.track);
    const was = own(own(inForce.tracks, t.track)?.stages ?? {}, t.stage)?.label ?? t.stage;
    return `${def?.label ?? t.track}: back to ${(def ? own(def.stages, t.start)?.label : undefined) ?? t.start}; this revision has no stage “${was}”`;
  });
  return { from: plan.from, to: plan.to, entities: rows, tracks };
}

// Play → People (DESIGN §12): everyone the POV knows and anyone here, people here
// first. Each row shows who they are, what they're doing or where and when the POV last saw them,
// and how they regard the POV; tapping one opens their person sheet (person.tsx) with today's
// plan, regard per axis, agendas, groups and classes. The list can be grouped by a classification
// facet players can see, by group membership or by tier, and filtered by those facets' values
// (nested values included) and by groups: within one kind of chip any will do, across kinds all
// must hold, as in a selector; both sit in a disclosure. The POV's own groups, with its role in
// each, close the panel. Hidden facets and tags never reach this view.

import { useState } from "preact/hooks";
import { withinValue } from "../../../shared/classes";
import { isRecord } from "../../../shared/json";
import { pushSheet, useApp } from "../../../frontend/app";
import { Avatar, Badge, Button, Disclosure, Empty, Field, JsonView, List, ListRow, Section } from "../../../frontend/components";
import { list, oneOf, optNum, optStr, str, strings } from "../../../frontend/decode";
import { Icon } from "../../../frontend/icons";
import type { PanelProps } from "../../../frontend/registry";

export const SLOT_KINDS = ["work", "sleep", "free", "travel", "other"] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

export interface CastPerson {
  id: string;
  name: string;
  role: string;
  here: boolean;
  activity?: string;
  place?: string;
  lastSeen?: { place?: string; at: string };
  /** Their life state as the POV knows it, when that isn't alive. */
  life?: string;
  regard: { axis: string; band: string; value?: number }[];
  timeline: { start: string; end: string; label: string; kind: SlotKind; reasons: string[] }[];
  agenda: { label: string; stage: string }[];
  next?: { at: string; label: string };
  tier: string;
  classes: Record<string, string[]>;
  groups: { id: string; role?: string }[];
}

export interface CastFacet {
  id: string;
  label: string;
  multiple: boolean;
  values: { id: string; label: string; parent?: string }[];
}

export interface CastGroup {
  id: string;
  name: string;
  kind: string;
  role?: string;
  rank?: number;
  since?: string;
}

export interface CastView {
  level: number;
  people: CastPerson[];
  facets: CastFacet[];
  tiers: { id: string; label: string }[];
  groups: CastGroup[];
  mine: CastGroup[];
}

function decodeGroup(g: Record<string, unknown>): CastGroup | null {
  return typeof g.id === "string" ? { id: g.id, name: str(g.name, g.id), kind: str(g.kind), role: optStr(g.role), rank: optNum(g.rank), since: optStr(g.since) } : null;
}

export function decodeCastView(value: unknown): CastView | null {
  if (!isRecord(value) || !Array.isArray(value.people)) return null;
  return {
    level: typeof value.level === "number" ? value.level : 1,
    people: list(value.people, (p) =>
      typeof p.id === "string"
        ? {
            id: p.id,
            name: str(p.name, p.id),
            role: str(p.role),
            here: p.here === true,
            activity: optStr(p.activity),
            place: optStr(p.place),
            lastSeen: isRecord(p.lastSeen) ? { place: optStr(p.lastSeen.place), at: str(p.lastSeen.at) } : undefined,
            life: optStr(p.life),
            regard: list(p.regard, (r) => ({ axis: str(r.axis), band: str(r.band), value: optNum(r.value) })),
            timeline: list(p.timeline, (s) => ({ start: str(s.start), end: str(s.end), label: str(s.label), kind: oneOf(s.kind, SLOT_KINDS, "other"), reasons: strings(s.reasons) })),
            agenda: list(p.agenda, (a) => ({ label: str(a.label), stage: str(a.stage) })),
            next: isRecord(p.next) ? { at: str(p.next.at), label: str(p.next.label) } : undefined,
            tier: str(p.tier),
            classes: isRecord(p.classes) ? Object.fromEntries(Object.entries(p.classes).map(([facet, values]) => [facet, strings(values)])) : {},
            groups: list(p.groups, (g) => (typeof g.id === "string" ? { id: g.id, role: optStr(g.role) } : null)),
          }
        : null,
    ),
    facets: list(value.facets, (f) =>
      typeof f.id === "string" ? { id: f.id, label: str(f.label, f.id), multiple: f.multiple === true, values: list(f.values, (v) => (typeof v.id === "string" ? { id: v.id, label: str(v.label, v.id), parent: optStr(v.parent) } : null)) } : null,
    ),
    tiers: list(value.tiers, (t) => (typeof t.id === "string" ? { id: t.id, label: str(t.label, t.id) } : null)),
    groups: list(value.groups, decodeGroup),
    mine: list(value.mine, decodeGroup),
  };
}

/** Filter chips in force: facet → values, and groups. */
export interface CastFilters {
  classes: Record<string, string[]>;
  groups: string[];
}

const NO_FILTERS: CastFilters = { classes: {}, groups: [] };

function parentsOf(facet: CastFacet): Record<string, { parent?: string }> {
  return Object.fromEntries(facet.values.map((v) => [v.id, { parent: v.parent }]));
}

/** Whether a person passes the chips: each kind of chip must hold, any chip of a kind will do; a facet chip takes nested values too. */
export function passes(person: CastPerson, filters: CastFilters, facets: readonly CastFacet[]): boolean {
  for (const [facetId, accepted] of Object.entries(filters.classes)) {
    if (accepted.length === 0) continue;
    const facet = facets.find((f) => f.id === facetId);
    const tree = facet ? parentsOf(facet) : {};
    if (!(person.classes[facetId] ?? []).some((v) => accepted.some((a) => withinValue(tree, v, a)))) return false;
  }
  if (filters.groups.length > 0 && !person.groups.some((g) => filters.groups.includes(g.id))) return false;
  return true;
}

/** "none", "tier", "groups" or `facet:<id>`. */
export type GroupBy = string;

/** People in sections, in the facet's, the groups' or the tiers' order, else here first and then the rest; someone in several groups or values appears in each; empty sections are left out. */
export function castSections(view: CastView, people: readonly CastPerson[], by: GroupBy): { key: string; label: string; people: CastPerson[] }[] {
  const ordered = [...people].sort((a, b) => Number(b.here) - Number(a.here));
  const sections = (keys: { key: string; label: string }[], of: (p: CastPerson) => string[], none: string): { key: string; label: string; people: CastPerson[] }[] => {
    const out = [...keys, { key: "", label: none }].map((k) => ({ ...k, people: ordered.filter((p) => (k.key === "" ? of(p).length === 0 : of(p).includes(k.key))) }));
    return out.filter((s) => s.people.length > 0);
  };
  if (by === "tier") return sections(view.tiers.map((t) => ({ key: t.id, label: t.label })), (p) => (p.tier ? [p.tier] : []), "No tier");
  if (by === "groups") return sections(view.groups.map((g) => ({ key: g.id, label: g.name })), (p) => p.groups.map((g) => g.id), "In no group");
  const facet = by.startsWith("facet:") ? view.facets.find((f) => f.id === by.slice(6)) : undefined;
  if (facet) {
    const label = (id: string): string => {
      const parts: string[] = [];
      for (let v = facet.values.find((x) => x.id === id), guard = 0; v && guard < 16; v = facet.values.find((x) => x.id === v?.parent), guard++) parts.unshift(v.label);
      return parts.join(" › ") || id;
    };
    return sections(facet.values.map((v) => ({ key: v.id, label: label(v.id) })), (p) => p.classes[facet.id] ?? [], `No ${facet.label.toLowerCase()}`);
  }
  return [
    { key: "here", label: "Here", people: ordered.filter((p) => p.here) },
    { key: "known", label: "People you know", people: ordered.filter((p) => !p.here) },
  ].filter((s) => s.people.length > 0);
}

/** One row of filter chips; a chip is pressed while it filters. */
function Chips(props: { label: string; options: readonly { id: string; label: string }[]; on: readonly string[]; onChange(next: string[]): void }) {
  if (props.options.length === 0) return null;
  return (
    <div class="lre-world-chips" role="group" aria-label={props.label}>
      <span class="lre-world-chips-label">{props.label}</span>
      {props.options.map((o) => {
        const pressed = props.on.includes(o.id);
        return (
          <button key={o.id} type="button" class="lre-world-chip" aria-pressed={pressed} onClick={() => props.onChange(pressed ? props.on.filter((x) => x !== o.id) : [...props.on, o.id])}>
            {pressed ? <Icon name="check" size={16} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** What a person is up to as the POV knows it: what they're doing here, or where and when it last saw them. */
export function whereabouts(p: CastPerson): string | undefined {
  if (p.here) return p.activity;
  if (p.lastSeen) return `Last seen ${p.lastSeen.at}${p.lastSeen.place ? ` at ${p.lastSeen.place}` : ""}`;
  return p.place;
}

export function CastPanel(props: PanelProps) {
  const app = useApp();
  const [by, setBy] = useState<GroupBy>("none");
  const [filters, setFilters] = useState<CastFilters>(NO_FILTERS);
  const view = decodeCastView(props.view);
  if (props.view === null || props.view === undefined) return <Empty icon="users">No cast yet.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  if (view.people.length === 0 && view.mine.length === 0) return <Empty icon="users">You don't know anyone yet.</Empty>;
  const shown = view.people.filter((p) => passes(p, filters, view.facets));
  const active = Object.values(filters.classes).reduce((n, v) => n + v.length, 0) + filters.groups.length;
  const held = (facet: CastFacet): { id: string; label: string }[] => {
    // A value anyone holds, and the broader values it nests under (a broader chip takes the nested ones too).
    const tree = parentsOf(facet);
    return facet.values.filter((v) => view.people.some((p) => (p.classes[facet.id] ?? []).some((x) => withinValue(tree, x, v.id)))).map((v) => ({ id: v.id, label: v.label }));
  };
  const row = (p: CastPerson) => {
    const pending = props.state.pending.some((mark) => mark.entity === p.id);
    const regard = p.regard[0];
    // Grouped by here, the section says who is here; grouped otherwise, the row does.
    const badges = [
      p.life ? <Badge key="life" tone="neg">{p.life}</Badge> : null,
      p.here && by !== "none" ? <Badge key="here" tone="pos">here</Badge> : null,
      pending ? <Badge key="pending" tone="warn">pending</Badge> : null,
      regard ? (
        <Badge key="regard">
          <Icon name="heart" size={12} label={regard.axis ? `${regard.axis}:` : "Regard:"} />
          {regard.band}
        </Badge>
      ) : null,
    ].filter((b) => b !== null);
    return (
      <ListRow
        key={p.id}
        id={p.id}
        leading={<Avatar name={p.name} size={36} />}
        title={p.name}
        subtitle={[p.role, whereabouts(p)].filter((part) => part).join(" · ") || undefined}
        badge={badges.length > 0 ? <span class="lre-world-badges">{badges}</span> : undefined}
        chevron
        onClick={() => app.ui.update((ui) => pushSheet(ui, { kind: "person", id: p.id }))}
      />
    );
  };
  return (
    <div class="lre-stack lre-world" data-lre-panel="castlife.cast">
      {view.people.length > 0 ? (
        <div class="lre-world-filters" data-lre-cast-filters>
          <Disclosure
            summary={
              <span class="lre-world-filters-summary">
                <Icon name="filter" size={16} />
                Filter and group
                {active > 0 ? (
                  <Badge tone="accent">
                    {shown.length} of {view.people.length}
                  </Badge>
                ) : null}
              </span>
            }
          >
            <Field label="Group by" for="lre-cast-group-by">
              <select id="lre-cast-group-by" class="lre-input" value={by} onChange={(event) => setBy(event.currentTarget.value)}>
                <option value="none">Here, then everyone else</option>
                {view.facets.map((f) => (
                  <option key={f.id} value={`facet:${f.id}`}>
                    {f.label}
                  </option>
                ))}
                {view.groups.length > 0 ? <option value="groups">Groups</option> : null}
                <option value="tier">Tier</option>
              </select>
            </Field>
            {view.facets.map((f) => (
              <Chips key={f.id} label={f.label} options={held(f)} on={filters.classes[f.id] ?? []} onChange={(on) => setFilters({ ...filters, classes: { ...filters.classes, [f.id]: on } })} />
            ))}
            <Chips label="Groups" options={view.groups.map((g) => ({ id: g.id, label: g.name }))} on={filters.groups} onChange={(groups) => setFilters({ ...filters, groups })} />
            {active > 0 ? (
              <Button variant="ghost" size="sm" icon="close" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters ({shown.length} of {view.people.length} shown)
              </Button>
            ) : null}
          </Disclosure>
        </div>
      ) : null}
      {shown.length === 0 && view.people.length > 0 ? <Empty icon="filter">No one matches these filters.</Empty> : null}
      {castSections(view, shown, by).map((s) => (
        <div key={s.key || "rest"} data-lre-cast-section={s.key}>
          <Section title={s.label || undefined} aside={s.label ? <Badge>{s.people.length}</Badge> : undefined} flush>
            <List>{s.people.map(row)}</List>
          </Section>
        </div>
      ))}
      {view.mine.length > 0 ? (
        <Section title="Your groups" flush>
          <List>
            {view.mine.map((g) => (
              <ListRow key={g.id} id={g.id} icon="users" title={g.name} subtitle={[g.kind, g.since ? `since ${g.since}` : ""].filter((part) => part).join(" · ") || undefined} value={g.role ?? "member"} />
            ))}
          </List>
        </Section>
      ) : null}
    </div>
  );
}

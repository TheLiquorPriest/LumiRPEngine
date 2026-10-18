// Play → Cast (DESIGN §12): everyone the POV knows and anyone here. Someone here shows what they
// are doing, today's timeline and their next commitment; someone away shows where and when the POV
// last saw them. Also agendas the POV knows about and regard (one band per pair at Relationships 1,
// axes above). People present in the scene come first. The list can be grouped by a classification facet players
// can see, by group membership or by tier, and filtered by those facets' values (nested values
// included) and by groups: within one kind of chip any will do, across kinds all must hold, as in a
// selector. The POV's own groups, with its role in each, head the panel. Hidden facets and tags
// never reach this view.

import { useState } from "preact/hooks";
import { withinValue } from "../../../shared/classes";
import { isRecord } from "../../../shared/json";
import { Card, Empty, JsonView, Row } from "../../../frontend/components";
import { list, oneOf, optNum, optStr, str, strings } from "../../../frontend/decode";
import type { PanelProps } from "../../../frontend/registry";

const SLOT_KINDS = ["work", "sleep", "free", "travel", "other"] as const;
type SlotKind = (typeof SLOT_KINDS)[number];

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

/** People in sections, in the facet's, the groups' or the tiers' order; someone in several groups or values appears in each; empty sections are left out. */
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
  return [{ key: "", label: "", people: ordered }];
}

/** `HH:MM` → minutes after midnight; unparsable times sort to 0. */
function clockMinutes(text: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

/** Today's plan as a strip, with each block's reasons (why the planner chose it) one tap away. */
function Timeline(props: { slots: CastPerson["timeline"] }) {
  const [why, setWhy] = useState(false);
  const spans = props.slots.map((slot) => {
    const start = clockMinutes(slot.start);
    const endRaw = clockMinutes(slot.end);
    const end = endRaw <= start ? 1440 : endRaw;
    return { ...slot, width: ((end - start) / 1440) * 100 };
  });
  return (
    <div>
      <div class="lre-timeline" role="img" aria-label={props.slots.map((s) => `${s.start}–${s.end} ${s.label}`).join(", ")}>
        {spans.map((s, i) => (
          <span key={i} class={`lre-tl-${s.kind}`} style={{ width: `${s.width}%` }} title={`${s.start}–${s.end} ${s.label}`} />
        ))}
      </div>
      <div class="lre-sched-axis" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      {props.slots.some((s) => s.reasons.length > 0) ? (
        <button type="button" class="lre-btn small ghost" aria-expanded={why} onClick={() => setWhy(!why)}>
          {why ? "Hide reasons" : "Why this plan?"}
        </button>
      ) : null}
      {why
        ? props.slots.map((s, i) => (
            <div key={i} class="lre-small" data-lre-plan-block>
              <span class="lre-num">
                {s.start}–{s.end}
              </span>{" "}
              {s.label}
              {s.reasons.length > 0 ? <span class="lre-muted"> · {s.reasons.join(", ")}</span> : null}
            </div>
          ))
        : null}
    </div>
  );
}

/** One row of filter chips; a chip is pressed while it filters. */
function Chips(props: { label: string; options: readonly { id: string; label: string }[]; on: readonly string[]; onChange(next: string[]): void }) {
  if (props.options.length === 0) return null;
  return (
    <div class="lre-inline" role="group" aria-label={props.label}>
      <span class="lre-small lre-muted">{props.label}</span>
      {props.options.map((o) => {
        const pressed = props.on.includes(o.id);
        return (
          <button key={o.id} type="button" class={pressed ? "lre-btn small primary" : "lre-btn small"} aria-pressed={pressed} onClick={() => props.onChange(pressed ? props.on.filter((x) => x !== o.id) : [...props.on, o.id])}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function CastPanel(props: PanelProps) {
  const [by, setBy] = useState<GroupBy>("none");
  const [filters, setFilters] = useState<CastFilters>(NO_FILTERS);
  const view = decodeCastView(props.view);
  if (props.view === null || props.view === undefined) return <Empty>No cast yet.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  if (view.people.length === 0 && view.mine.length === 0) return <Empty>You don't know anyone yet.</Empty>;
  const shown = view.people.filter((p) => passes(p, filters, view.facets));
  const filtering = Object.values(filters.classes).some((v) => v.length > 0) || filters.groups.length > 0;
  const held = (facet: CastFacet): { id: string; label: string }[] => {
    // A value anyone holds, and the broader values it nests under (a broader chip takes the nested ones too).
    const tree = parentsOf(facet);
    return facet.values.filter((v) => view.people.some((p) => (p.classes[facet.id] ?? []).some((x) => withinValue(tree, x, v.id)))).map((v) => ({ id: v.id, label: v.label }));
  };
  const card = (p: CastPerson) => {
    const pending = props.state.pending.some((mark) => mark.entity === p.id);
    return (
      <Card key={p.id} title={p.name} aside={<span class="lre-inline">{p.life ? <span class="lre-badge neg">{p.life}</span> : null}{p.here ? <span class="lre-badge pos">here</span> : null}{pending ? <span class="lre-badge warn">pending</span> : null}</span>}>
        <div class="lre-muted lre-small">{[p.role, p.activity, p.place].filter((part) => part).join(" · ")}</div>
        {p.timeline.length > 0 ? <Timeline slots={p.timeline} /> : null}
        {p.regard.map((r) => (
          <Row key={r.axis} k={r.axis} v={r.value !== undefined ? `${r.band} (${r.value})` : r.band} />
        ))}
        {p.agenda.map((a) => (
          <Row key={a.label} k={a.label} v={a.stage} sub="agenda" />
        ))}
        {p.next ? <Row k="Next" v={p.next.at} sub={p.next.label} /> : null}
        {p.lastSeen ? <Row k="Last seen" v={p.lastSeen.at} sub={p.lastSeen.place} /> : null}
      </Card>
    );
  };
  return (
    <div class="lre-stack" data-lre-panel="castlife.cast">
      {view.mine.length > 0 ? (
        <Card title="Your groups">
          {view.mine.map((g) => (
            <Row key={g.id} k={g.name} v={g.role ?? "member"} sub={[g.kind, g.since ? `since ${g.since}` : ""].filter((part) => part).join(" · ")} />
          ))}
        </Card>
      ) : null}
      {view.people.length > 0 ? (
        <>
          <label class="lre-field">
            <span class="label">Group by</span>
            <select class="lre-input" value={by} onChange={(event) => setBy(event.currentTarget.value)}>
              <option value="none">None</option>
              {view.facets.map((f) => (
                <option key={f.id} value={`facet:${f.id}`}>
                  {f.label}
                </option>
              ))}
              {view.groups.length > 0 ? <option value="groups">Groups</option> : null}
              <option value="tier">Tier</option>
            </select>
          </label>
          <div class="lre-stack" data-lre-cast-filters>
            {view.facets.map((f) => (
              <Chips key={f.id} label={f.label} options={held(f)} on={filters.classes[f.id] ?? []} onChange={(on) => setFilters({ ...filters, classes: { ...filters.classes, [f.id]: on } })} />
            ))}
            <Chips label="Groups" options={view.groups.map((g) => ({ id: g.id, label: g.name }))} on={filters.groups} onChange={(groups) => setFilters({ ...filters, groups })} />
            {filtering ? (
              <button type="button" class="lre-btn small ghost" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters ({shown.length} of {view.people.length} shown)
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {shown.length === 0 && view.people.length > 0 ? <Empty>No one matches these filters.</Empty> : null}
      {castSections(view, shown, by).map((s) => (
        <section key={s.key || "rest"} class="lre-stack" data-lre-cast-section={s.key}>
          {s.label ? (
            <div class="lre-h">
              <span>{s.label}</span>
              <span class="lre-badge">{s.people.length}</span>
            </div>
          ) : null}
          {s.people.map(card)}
        </section>
      ))}
    </div>
  );
}

// The person sheet (contract §4.3): someone from the cast, as the POV knows them: who they are,
// whether they're here (what they're doing) or where and when the POV last saw them, today's plan
// with "Why this plan?", how they regard the POV per axis, the agendas the POV knows about, their
// next commitment, their groups, the classes players may see, and a life state other than alive.
// Opening it is a player-facing observation of that person (DESIGN §9.2), sent once on mount;
// nothing here is GM data, the cast view is already POV-filtered.

import { useEffect, useState } from "preact/hooks";
import { useApp } from "../../../frontend/app";
import { Avatar, Badge, Button, Empty, IdText, List, ListRow, PageHeader, Section } from "../../../frontend/components";
import { Icon } from "../../../frontend/icons";
import type { SheetProps } from "../../../frontend/registry";
import { decodeCastView, SLOT_KINDS, whereabouts, type CastPerson, type CastView, type SlotKind } from "./panel";

/** Each kind of plan block in words, and its categorical fill (contract §5.1 `--lre-series-*`). */
const SLOT_LABEL: Record<SlotKind, string> = { work: "Work", sleep: "Sleep", free: "Free time", travel: "Travel", other: "Other" };
const SLOT_SERIES: Record<SlotKind, number> = { work: 2, sleep: 6, free: 1, travel: 3, other: 5 };

/** `HH:MM` → minutes after midnight; unparsable times sort to 0. */
function clockMinutes(text: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

/** Today's plan as a strip, with a legend, and each block's reasons (why the planner chose it) one tap away. */
export function Timeline(props: { slots: CastPerson["timeline"] }) {
  const [why, setWhy] = useState(false);
  const spans = props.slots.map((slot) => {
    const start = clockMinutes(slot.start);
    const endRaw = clockMinutes(slot.end);
    const end = endRaw <= start ? 1440 : endRaw;
    return { ...slot, width: ((end - start) / 1440) * 100 };
  });
  const kinds = SLOT_KINDS.filter((kind) => props.slots.some((s) => s.kind === kind));
  return (
    <div class="lre-stack">
      <div class="lre-world-timeline" role="img" aria-label={props.slots.map((s) => `${s.start}–${s.end} ${s.label}`).join(", ")}>
        {spans.map((s, i) => (
          <span key={i} style={{ width: `${s.width}%`, background: `var(--lre-series-${SLOT_SERIES[s.kind]})` }} title={`${s.start}–${s.end} ${s.label}`} />
        ))}
      </div>
      <div class="lre-world-axis" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <div class="lre-world-legend" aria-hidden="true">
        {kinds.map((kind) => (
          <span key={kind}>
            <i style={{ background: `var(--lre-series-${SLOT_SERIES[kind]})` }} />
            {SLOT_LABEL[kind]}
          </span>
        ))}
      </div>
      <List>
        {props.slots.map((s, i) => {
          const kind = SLOT_LABEL[s.kind];
          // With reasons shown, each block says why; else what kind of block it is, unless its name already does.
          const sub = why && s.reasons.length > 0 ? s.reasons.join(", ") : s.label.toLowerCase() === kind.toLowerCase() ? undefined : kind;
          return <ListRow key={i} title={s.label} subtitle={sub} value={`${s.start}–${s.end}`} valueTone="muted" />;
        })}
      </List>
      {props.slots.some((s) => s.reasons.length > 0) ? (
        <div>
          <Button variant="ghost" size="sm" icon="help" onClick={() => setWhy(!why)}>
            {why ? "Hide reasons" : "Why this plan?"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** A facet value's label, and the broader values it nests under: "Ally › Mentor". */
function classLabel(view: CastView, facetId: string, valueId: string): string {
  const facet = view.facets.find((f) => f.id === facetId);
  if (!facet) return valueId;
  const parts: string[] = [];
  for (let v = facet.values.find((x) => x.id === valueId), guard = 0; v && guard < 16; v = facet.values.find((x) => x.id === v?.parent), guard++) parts.unshift(v.label);
  return parts.join(" › ") || valueId;
}

export function PersonSheet(props: SheetProps) {
  const app = useApp();
  useEffect(() => {
    void app.request({ type: "lre.view.open", chatId: props.chatId, panel: "castlife.cast", entity: props.id }).then((result) => {
      if (result?.pending) app.toast("Details appear when the reply finishes.", "info");
    });
  }, [props.chatId, props.id]);
  const view = decodeCastView(props.state.panels["castlife.cast"]);
  const person = view?.people.find((p) => p.id === props.id);
  if (!view || !person) {
    // Someone here the cast doesn't list (the POV doesn't know them yet): what the scene shows.
    const present = props.state.scene?.present.find((p) => p.id === props.id);
    return (
      <div class="lre-stack lre-world">
        <PageHeader title={present?.name ?? "Person"} subtitle={present?.label || undefined} onBack={props.close} />
        {present?.life ? (
          <div>
            <Badge tone="neg">{present.life}</Badge>
          </div>
        ) : null}
        <Empty icon="user">{present ? "You don't know much about them yet." : "They aren't among the people you know any more."}</Empty>
      </div>
    );
  }
  const pending = props.state.pending.some((mark) => mark.entity === person.id);
  const groups = person.groups.map((g) => ({ ...g, def: view.groups.find((d) => d.id === g.id) }));
  const classes = Object.entries(person.classes).flatMap(([facet, values]) => values.map((value) => ({ facet, value })));
  const facetLabel = (id: string): string => view.facets.find((f) => f.id === id)?.label ?? id;
  const where = whereabouts(person);
  return (
    <div class="lre-stack lre-world" data-lre-sheet-person={person.id}>
      <PageHeader title={person.name} subtitle={person.role || undefined} onBack={props.close} />
      <IdText id={person.id} />
      <div class="lre-world-person-head">
        <Avatar name={person.name} size={48} />
        <div class="lre-world-person-status">
          <span class="lre-world-status">
            <Icon name={person.here ? "pin" : "clock"} size={16} />
            <span>{person.here ? (person.activity ? `Here · ${person.activity}` : "Here") : (where ?? "Away")}</span>
          </span>
          <span class="lre-world-badges">
            {person.life ? <Badge tone="neg">{person.life}</Badge> : null}
            {pending ? <Badge tone="warn">pending</Badge> : null}
          </span>
        </div>
      </div>
      {person.next ? (
        <Section title="Next" flush>
          <List>
            <ListRow icon="calendar" title={person.next.label} value={person.next.at} valueTone="muted" />
          </List>
        </Section>
      ) : null}
      {person.timeline.length > 0 ? (
        <Section title="Today">
          <Timeline slots={person.timeline} />
        </Section>
      ) : null}
      {person.regard.length > 0 ? (
        <Section title="How they see you" flush>
          <List>
            {person.regard.map((r) => (
              <ListRow key={r.axis} icon="heart" title={r.axis || "Regard"} value={<Badge>{r.band}</Badge>} />
            ))}
          </List>
        </Section>
      ) : null}
      {person.agenda.length > 0 ? (
        <Section title="What they're after" flush>
          <List>
            {person.agenda.map((a) => (
              <ListRow key={a.label} icon="flag" title={a.label} subtitle={a.stage || undefined} />
            ))}
          </List>
        </Section>
      ) : null}
      {groups.length > 0 ? (
        <Section title="Groups" flush>
          <List>
            {groups.map((g) => (
              <ListRow key={g.id} id={g.id} icon="users" title={g.def?.name ?? g.id} subtitle={g.def?.kind || undefined} value={g.role} valueTone="muted" />
            ))}
          </List>
        </Section>
      ) : null}
      {classes.length > 0 ? (
        <Section title="Known as" flush>
          <List>
            {classes.map((c) => (
              <ListRow key={`${c.facet}:${c.value}`} title={classLabel(view, c.facet, c.value)} subtitle={facetLabel(c.facet)} />
            ))}
          </List>
        </Section>
      ) : null}
    </div>
  );
}

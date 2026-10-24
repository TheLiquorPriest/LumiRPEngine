// The person sheet: someone from the cast, as the POV knows them: who they are,
// whether they're here (what they're doing) or where and when the POV last saw them, today's plan
// with "Why this plan?" and their usual day with where each block comes from, how they regard the
// POV per axis, the agendas the POV knows about, their next commitment, their groups, the classes
// players may see, and a life state other than alive.
// Opening it is a player-facing observation of that person (DESIGN §9.2), sent once on mount;
// nothing here is GM data: the cast view is already POV-filtered, and the usual day is the player's
// projection of their routine (`lre.routine`, view "player"), asked only where Cast shows a day.

import { useEffect, useState } from "preact/hooks";
import { useApp } from "../../../frontend/app";
import { Avatar, Badge, Button, Disclosure, Empty, IdText, List, ListRow, PageHeader, Section } from "../../../frontend/components";
import { FixEditor } from "../../../frontend/fix-editor";
import { Icon } from "../../../frontend/icons";
import type { SheetProps } from "../../../frontend/registry";
import { whereFixTarget } from "../../../frontend/requests";
import type { ChatId, EntityId } from "../../../shared/ids";
import type { PlayerBlock, RoutinePlayerView } from "../../../shared/routines";
import { decodeCastView, SLOT_KINDS, whereabouts, type CastPerson, type CastView, type SlotKind } from "./panel";

/** Each kind of plan block in words, and its categorical fill (a `--lre-series-*` token). */
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

/**
 * Why a block of someone's usual day is there, in the player's words. Only what the player's
 * projection gives: a lore entry the POV may read comes with its title, anything else it hides
 * reads as their routine. Routine blocks read as what they usually do, never as what they do now.
 */
const SOURCE_WORDS: Record<PlayerBlock["source"]["type"], string> = {
  routine: "Usually · their routine",
  lore: "Usually · from lore",
  commitment: "A commitment",
  story: "As the story has it",
  plan: "A plan of theirs",
  free: "Free time",
};

export interface UsualRow {
  from: string;
  to: string;
  label: string;
  /** Why it's there, in words. */
  source: string;
  reasons: string[];
}

/**
 * Someone's usual day as Cast shows it: each block the player's projection gives (DESIGN §7), in its
 * order, with why in words; null when it gives none, so the sheet shows nothing. Nothing is added
 * here: no place, company or lore title the projection left out.
 */
export function usualDay(view: RoutinePlayerView | null | undefined): { label: string; rows: UsualRow[] } | null {
  const day = view?.day;
  if (!day || day.blocks.length === 0) return null;
  return {
    label: day.label,
    rows: day.blocks.map((b) => ({ from: b.from, to: b.to, label: b.label, source: b.source.type === "lore" ? `${SOURCE_WORDS.lore}: ${b.source.title}` : SOURCE_WORDS[b.source.type], reasons: b.reasons })),
  };
}

/**
 * Their usual day, under Today: where each block of their day comes from, as far as the POV may
 * know, framed as what they usually do. It's asked again whenever Cast's day for them changes, and
 * shows nothing until the answer has blocks.
 */
function UsualDay(props: { chatId: ChatId; entity: EntityId; dayKey: string }) {
  const app = useApp();
  const [view, setView] = useState<RoutinePlayerView | null>(null);
  const [why, setWhy] = useState(false);
  useEffect(() => {
    let current = true;
    void app.request({ type: "lre.routine", chatId: props.chatId, op: "day", entity: props.entity, view: "player" }).then((result) => {
      if (current) setView(result?.player ?? null);
    });
    return () => {
      current = false;
    };
  }, [props.chatId, props.entity, props.dayKey]);
  const day = usualDay(view);
  if (!day) return null;
  return (
    <Disclosure summary="Their usual day">
      <div class="lre-stack" data-lre-usual-day={props.entity}>
        <span class="lre-small lre-muted">What they'd usually do on a day like this, as far as you know. What happens in the story always comes first.</span>
        <List>
          {day.rows.map((r, i) => (
            <ListRow key={i} title={r.label} subtitle={why && r.reasons.length > 0 ? `${r.source} · ${r.reasons.join(", ")}` : r.source} value={`${r.from}–${r.to}`} valueTone="muted" />
          ))}
        </List>
        {day.rows.some((r) => r.reasons.length > 0) ? (
          <div>
            <Button variant="ghost" size="sm" icon="help" onClick={() => setWhy(!why)}>
              {why ? "Hide reasons" : "Why?"}
            </Button>
          </div>
        ) : null}
      </div>
    </Disclosure>
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
  const [fixingWhere, setFixingWhere] = useState(false);
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
  // "Where are they?": a ✎ that moves them through the one move path, with the fix's own Undo.
  const whereFix = whereFixTarget(props.state.hud, person.id, person.here);
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
      {whereFix ? (
        fixingWhere ? (
          <div class="lre-play-fix" onKeyDown={(event) => event.key === "Escape" && (event.stopPropagation(), setFixingWhere(false))}>
            <FixEditor label="Where are they?" title={`Where is ${person.name}?`} target={whereFix} onDone={() => setFixingWhere(false)} />
          </div>
        ) : (
          <div>
            <Button size="sm" icon="edit" onClick={() => setFixingWhere(true)}>
              Where are they?
            </Button>
          </div>
        )
      ) : null}
      {person.next ? (
        <Section title="Next" flush>
          <List>
            <ListRow icon="calendar" title={person.next.label} value={person.next.at} valueTone="muted" />
          </List>
        </Section>
      ) : null}
      {person.timeline.length > 0 ? (
        <Section title="Today">
          <div class="lre-stack">
            <Timeline slots={person.timeline} />
            <UsualDay chatId={props.chatId} entity={person.id} dayKey={JSON.stringify(person.timeline)} />
          </div>
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

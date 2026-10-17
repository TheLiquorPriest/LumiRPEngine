// Play → Cast (DESIGN §12): everyone the POV knows, with today's timeline, agendas the POV knows
// about, regard (one band per pair at Relationships 1, axes above) and their next commitment.
// People present in the scene come first.

import { useState } from "preact/hooks";
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
  regard: { axis: string; band: string; value?: number }[];
  timeline: { start: string; end: string; label: string; kind: SlotKind; reasons: string[] }[];
  agenda: { label: string; stage: string }[];
  next?: { at: string; label: string };
}

export interface CastView {
  level: number;
  people: CastPerson[];
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
            regard: list(p.regard, (r) => ({ axis: str(r.axis), band: str(r.band), value: optNum(r.value) })),
            timeline: list(p.timeline, (s) => ({ start: str(s.start), end: str(s.end), label: str(s.label), kind: oneOf(s.kind, SLOT_KINDS, "other"), reasons: strings(s.reasons) })),
            agenda: list(p.agenda, (a) => ({ label: str(a.label), stage: str(a.stage) })),
            next: isRecord(p.next) ? { at: str(p.next.at), label: str(p.next.label) } : undefined,
          }
        : null,
    ),
  };
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

export function CastPanel(props: PanelProps) {
  const view = decodeCastView(props.view);
  if (props.view === null || props.view === undefined) return <Empty>No cast yet.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  if (view.people.length === 0) return <Empty>You don't know anyone yet.</Empty>;
  const people = [...view.people].sort((a, b) => Number(b.here) - Number(a.here));
  return (
    <div class="lre-stack" data-lre-panel="castlife.cast">
      {people.map((p) => {
        const pending = props.state.pending.some((mark) => mark.entity === p.id);
        return (
          <Card key={p.id} title={p.name} aside={<span class="lre-inline">{p.here ? <span class="lre-badge pos">here</span> : null}{pending ? <span class="lre-badge warn">pending</span> : null}</span>}>
            <div class="lre-muted lre-small">{[p.role, p.activity, p.place].filter((part) => part).join(" · ")}</div>
            {p.timeline.length > 0 ? <Timeline slots={p.timeline} /> : null}
            {p.regard.map((r) => (
              <Row key={r.axis} k={r.axis} v={r.value !== undefined ? `${r.band} (${r.value})` : r.band} />
            ))}
            {p.agenda.map((a) => (
              <Row key={a.label} k={a.label} v={a.stage} sub="agenda" />
            ))}
            {p.next ? <Row k="Next" v={p.next.at} sub={p.next.label} /> : null}
          </Card>
        );
      })}
    </div>
  );
}

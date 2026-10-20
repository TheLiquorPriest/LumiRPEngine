// Build's schedule editor (DESIGN §13): who a schedule applies to and what it sets,
// when it repeats, and its day as a 24-hour bar of slots. Tap a slot, on the bar or in the list, to
// edit it in a sheet; drag a handle on the bar (or step it with the arrow keys) to move where one
// slot hands over to the next. Slots are fixed values, weighted choices, or choices given the
// previous slot. The owner is an entity, a group, a kind or a selector: the most specific one wins
// a field (DESIGN §8).

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JsonValue } from "../../../shared/json";
import { nameOfId } from "../../../shared/maps";
import { isRecord } from "../../../shared/json";
import type { LintIssue } from "../../../shared/protocol";
import type { Recurrence, ScheduleDef, ScheduleSlot } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { deleteItem, go, ItemHeader } from "../../../frontend/build/chrome";
import { Chip, FormGroup, FormSheet, Issues, ItemRow, RefPicker, type RefOption } from "../../../frontend/build/form-kit";
import { useHeld } from "../../../frontend/build/held";
import { FieldInput, lintAt } from "../../../frontend/build/schema-form";
import { kindIs, SelectorEditor, selectorOf } from "../../../frontend/build/selector-editor";
import { Button, Disclosure, Field, IconButton, NumberStepper, SaveBar, Section, Seg, useBusy } from "../../../frontend/components";
import type { EditorProps } from "../../../frontend/registry";
import { useSelect } from "../../../frontend/store";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = 1440;
/** Handles move in quarter hours. */
const STEP = 15;
const EVERY: Record<Recurrence["every"], string> = { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" };

export function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Minutes past midnight as HH:MM; the day's end (1440) is midnight, 00:00. */
export function timeOf(minutes: number): string {
  const m = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A problem with a slot table, and the slots it's about (by index). */
export interface SlotIssue {
  slots: number[];
  message: string;
}

/** Plain-language problems with a slot table: bad times, overlaps (an end at or before the start runs past midnight), missing values and weights. */
export function slotIssues(slots: readonly ScheduleSlot[]): SlotIssue[] {
  const out: SlotIssue[] = [];
  const spans: { start: number; end: number; index: number }[] = [];
  slots.forEach((slot, index) => {
    if (!TIME.test(slot.start) || !TIME.test(slot.end)) {
      out.push({ slots: [index], message: `Slot ${index + 1}: times must be HH:MM` });
      return;
    }
    const start = minutesOf(slot.start);
    const end = minutesOf(slot.end);
    if (end > start) spans.push({ start, end, index });
    else {
      spans.push({ start, end: DAY, index });
      if (end > 0) spans.push({ start: 0, end, index });
    }
    if (slot.value === undefined && !slot.weighted && !slot.given) out.push({ slots: [index], message: `Slot ${index + 1}: no value` });
    if (slot.weighted && slot.weighted.reduce((sum, w) => sum + w.weight, 0) <= 0) out.push({ slots: [index], message: `Slot ${index + 1}: weights must add up to more than 0` });
  });
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i += 1) {
    const prev = spans[i - 1];
    const cur = spans[i];
    if (prev && cur && cur.start < prev.end && prev.index !== cur.index) out.push({ slots: [prev.index, cur.index], message: `Slots ${prev.index + 1} and ${cur.index + 1} overlap` });
  }
  return out;
}

export function slotProblems(slots: readonly ScheduleSlot[]): string[] {
  return [...new Set(slotIssues(slots).map((issue) => issue.message))];
}

/** Where a slot shows on the day bar, in minutes: one span, or two for a slot that runs past midnight. Bad times show nothing. */
export function slotSpans(slots: readonly ScheduleSlot[]): { index: number; start: number; end: number }[] {
  return slots.flatMap((slot, index) => {
    if (!TIME.test(slot.start) || !TIME.test(slot.end)) return [];
    const start = minutesOf(slot.start);
    const end = minutesOf(slot.end);
    if (end > start) return [{ index, start, end }];
    return end > 0 ? [{ index, start, end: DAY }, { index, start: 0, end }] : [{ index, start, end: DAY }];
  });
}

/** One end of a slot. */
export interface SlotEdge {
  index: number;
  side: "start" | "end";
}

/** A handle on the day bar: a time (0–1440; an end at midnight sits at 1440) and the slot ends that meet there, which move together. */
export interface DayHandle {
  at: number;
  edges: SlotEdge[];
}

export function dayHandles(slots: readonly ScheduleSlot[]): DayHandle[] {
  const byAt = new Map<number, SlotEdge[]>();
  slots.forEach((slot, index) => {
    if (!TIME.test(slot.start) || !TIME.test(slot.end)) return;
    const start = minutesOf(slot.start);
    const end = minutesOf(slot.end);
    byAt.set(start, [...(byAt.get(start) ?? []), { index, side: "start" }]);
    // A slot ending at midnight ends at the bar's right edge, not its left.
    const endAt = end === 0 ? DAY : end;
    byAt.set(endAt, [...(byAt.get(endAt) ?? []), { index, side: "end" }]);
  });
  return [...byAt].map(([at, edges]) => ({ at, edges })).sort((a, b) => a.at - b.at);
}

/** How far a handle may move: up to a step short of its neighbours, within the day; one at either end of the day stays there. */
export function handleRange(handles: readonly DayHandle[], i: number): [number, number] {
  const h = handles[i];
  if (!h || h.at === 0 || h.at === DAY) return [h?.at ?? 0, h?.at ?? 0];
  return [(handles[i - 1]?.at ?? 0) + STEP, (handles[i + 1]?.at ?? DAY) - STEP];
}

/** The slots with every end at a handle moved to `to` minutes. */
export function moveHandle(slots: readonly ScheduleSlot[], edges: readonly SlotEdge[], to: number): ScheduleSlot[] {
  const time = timeOf(to);
  return slots.map((slot, index) => {
    const mine = edges.filter((e) => e.index === index);
    if (mine.length === 0) return slot;
    return { ...slot, ...(mine.some((e) => e.side === "start") ? { start: time } : {}), ...(mine.some((e) => e.side === "end") ? { end: time } : {}) };
  });
}

function valueText(value: JsonValue | undefined): string {
  return value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
}

function slotLabel(slot: ScheduleSlot): string {
  if (slot.value !== undefined) return valueText(slot.value) || "(empty)";
  if (slot.weighted) return slot.weighted.map((w) => valueText(w.value)).join(" / ");
  return "given the slot before";
}

/** A value typed as JSON; a bare word is a string, and empty is no value. */
function JsonField(props: { label: string; help?: string; value: JsonValue | undefined; onChange(value: JsonValue | undefined): void }) {
  const [text, setText] = useState(props.value === undefined ? "" : valueText(props.value));
  useEffect(() => setText(props.value === undefined ? "" : valueText(props.value)), [JSON.stringify(props.value)]);
  return (
    <Field label={props.label} help={props.help}>
      <input
        class="lre-input"
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
        onBlur={() => {
          if (text.trim() === "") return props.onChange(undefined);
          try {
            props.onChange(JSON.parse(text) as JsonValue);
          } catch {
            props.onChange(text.trim());
          }
        }}
      />
    </Field>
  );
}

/** The day as a bar: slots by value colour, each opening its sheet; handles where a slot starts or ends. */
function DayBar(props: { slots: readonly ScheduleSlot[]; current: number | null; colour(slot: ScheduleSlot): string; onOpen(index: number): void; onMove(slots: ScheduleSlot[]): void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const handles = dayHandles(props.slots);
  const minuteAt = (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return Math.round((((clientX - rect.left) / rect.width) * DAY) / STEP) * STEP;
  };
  const moveTo = (i: number, to: number) => {
    const h = handles[i];
    if (!h) return;
    const [min, max] = handleRange(handles, i);
    const at = Math.min(max, Math.max(min, to));
    if (at !== h.at) props.onMove(moveHandle(props.slots, h.edges, at));
  };
  const name = (h: DayHandle) => {
    const ends = h.edges.filter((e) => e.side === "end").map((e) => e.index + 1);
    const starts = h.edges.filter((e) => e.side === "start").map((e) => e.index + 1);
    return ends.length > 0 && starts.length > 0 ? `Slot ${ends.join(", ")} ends and slot ${starts.join(", ")} starts` : ends.length > 0 ? `End of slot ${ends.join(", ")}` : `Start of slot ${starts.join(", ")}`;
  };
  return (
    <>
      <div ref={bar} class="lre-ve-day" data-lre-day-bar>
        <div class="lre-ve-day-track">
          {slotSpans(props.slots).map((span, i) => {
            const slot = props.slots[span.index];
            if (!slot) return null;
            return (
              // The list below is the slots' accessible target; the bar is the picture and the drag surface.
              <button
                key={`${span.index}:${i}`}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                class="lre-ve-day-slot"
                aria-current={span.index === props.current}
                style={{ left: `${(span.start / DAY) * 100}%`, width: `${((span.end - span.start) / DAY) * 100}%`, "--slot": props.colour(slot) }}
                title={`${slot.start}–${slot.end} ${slotLabel(slot)}`}
                onClick={() => props.onOpen(span.index)}
              >
                {slotLabel(slot)}
              </button>
            );
          })}
        </div>
        {handles.map((h, i) => {
          const [min, max] = handleRange(handles, i);
          if (min === max) return null;
          return (
            // Keyed by its slot edges, not its time: a drag moves the time, and a new element would drop the pointer capture.
            <div
              key={h.edges.map((e) => `${e.index}${e.side}`).join()}
              class="lre-ve-handle"
              role="slider"
              tabIndex={0}
              aria-label={name(h)}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={h.at}
              aria-valuetext={timeOf(h.at)}
              data-dragging={dragging === i ? "" : undefined}
              style={{ left: `${(h.at / DAY) * 100}%` }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                event.preventDefault();
                setDragging(i);
              }}
              onPointerMove={(event) => {
                if (dragging !== i) return;
                const to = minuteAt(event.clientX);
                if (to !== null) moveTo(i, to);
              }}
              onPointerUp={() => setDragging(null)}
              onPointerCancel={() => setDragging(null)}
              onKeyDown={(event) => {
                const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -STEP : event.key === "ArrowRight" || event.key === "ArrowUp" ? STEP : event.key === "PageDown" ? -60 : event.key === "PageUp" ? 60 : 0;
                const to = event.key === "Home" ? min : event.key === "End" ? max : delta !== 0 ? h.at + delta : null;
                if (to === null) return;
                event.preventDefault();
                moveTo(i, to);
              }}
            >
              <span />
            </div>
          );
        })}
      </div>
      <div class="lre-ve-day-axis" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </>
  );
}

/** One slot as a sheet: its times, its value (fixed or weighted), the choices given the slot before, and Remove. */
function SlotSheet(props: { slot: ScheduleSlot; index: number; issues: readonly string[]; onChange(slot: ScheduleSlot): void; onRemove(): void; onClose(): void }) {
  const { slot } = props;
  const weighted = slot.weighted !== undefined;
  const total = (slot.weighted ?? []).reduce((sum, w) => sum + Math.max(0, w.weight), 0);
  const lint: LintIssue[] = props.issues.map((message) => ({ severity: "error", path: `slots.${props.index}`, code: "slot", message }));
  return (
    <FormSheet title={`Slot ${props.index + 1}`} subtitle={`${slot.start}–${slot.end} · ${slotLabel(slot)}`} backLabel="Schedule" onClose={props.onClose}>
      <Issues issues={lint} />
      <div class="lre-ve-times">
        <Field label="Starts">
          <input class="lre-input" type="time" step={900} value={slot.start} onChange={(event) => props.onChange({ ...slot, start: event.currentTarget.value })} />
        </Field>
        <Field label="Ends" help="At or before the start: it runs past midnight.">
          <input class="lre-input" type="time" step={900} value={slot.end} onChange={(event) => props.onChange({ ...slot, end: event.currentTarget.value })} />
        </Field>
      </div>
      <Field label="Its value">
        <Seg<"value" | "weighted">
          label="Its value"
          value={weighted ? "weighted" : "value"}
          options={[
            { value: "value", label: "Fixed" },
            { value: "weighted", label: "Weighted choice" },
          ]}
          onChange={(mode) => props.onChange(mode === "value" ? { start: slot.start, end: slot.end, value: slot.weighted?.[0]?.value ?? "", ...(slot.given ? { given: slot.given } : {}) } : { start: slot.start, end: slot.end, weighted: [{ value: slot.value ?? "", weight: 1 }], ...(slot.given ? { given: slot.given } : {}) })}
        />
      </Field>
      {weighted ? (
        <FormGroup title="Choices" aside={<Button size="sm" icon="plus" onClick={() => props.onChange({ ...slot, weighted: [...(slot.weighted ?? []), { value: "", weight: 1 }] })}>Choice</Button>}>
          {(slot.weighted ?? []).map((w, i) => (
            <div key={i} class="lre-ve-weight">
              <JsonField label={`Choice ${i + 1}`} value={w.value} onChange={(value) => props.onChange({ ...slot, weighted: slot.weighted?.map((x, j) => (j === i ? { ...x, value: value ?? "" } : x)) })} />
              <IconButton icon="trash" label={`Remove choice ${i + 1}`} onClick={() => props.onChange({ ...slot, weighted: slot.weighted?.filter((_, j) => j !== i) })} />
              <NumberStepper label={`Weight${total > 0 ? ` (${Math.round((Math.max(0, w.weight) / total) * 100)}%)` : ""}`} value={w.weight} min={0} onChange={(weight) => props.onChange({ ...slot, weighted: slot.weighted?.map((x, j) => (j === i ? { ...x, weight } : x)) })} />
            </div>
          ))}
        </FormGroup>
      ) : (
        <JsonField label="Value" help="A word (diner, clear) or JSON (a number, a list)." value={slot.value} onChange={(value) => props.onChange({ ...slot, value })} />
      )}
      <Disclosure summary="Given the slot before (Advanced)" defaultOpen={slot.given !== undefined}>
        <JsonField
          label="Choices by the value of the slot before, as JSON"
          help={'{"clear": [{"value": "clear", "weight": 4}]}'}
          value={slot.given as JsonValue | undefined}
          onChange={(value) => props.onChange({ ...slot, given: isRecord(value) ? (value as unknown as ScheduleSlot["given"]) : undefined })}
        />
      </Disclosure>
      <div class="lre-inline">
        <Button variant="danger" icon="trash" onClick={props.onRemove}>
          Remove slot
        </Button>
      </div>
    </FormSheet>
  );
}

export function ScheduleEditor(props: EditorProps) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : props.id;
  const stored = id ? props.world.schedules[id] : undefined;
  const blank: ScheduleDef = { id: id ?? "", target: "place", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: "work" }] };
  const [schedule, setSchedule] = useState<ScheduleDef>(stored ? structuredClone(stored) : blank);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, run] = useBusy();
  const [jsonProblem, setJsonProblem] = useState<string | null>(null);
  useHeld(schedule, setSchedule, stored ?? blank, `${props.world.id}/schedules/${props.id ?? ""}`, JSON.stringify(stored ?? null));
  const issues = useMemo(() => slotIssues(schedule.slots), [schedule.slots]);
  // Owners and selectors see the packs' kinds too (groups among them); the world's own win.
  const doc = useMemo(() => ({ ...props.world, kinds: { ...draft?.packKinds, ...props.world.kinds } }), [props.world, draft?.packKinds]);
  if (!id) return <span class="lre-muted">Choose a schedule.</span>;
  const rec = schedule.recurrence;
  const setRec = (next: Recurrence) => setSchedule({ ...schedule, recurrence: next });
  const changed = JSON.stringify(schedule) !== JSON.stringify(stored ?? null);
  const owners: RefOption[] = [
    ...Object.values(doc.entities).map((e) => ({ value: e.id, label: e.name, ...(kindIs(doc, e.kind, "group") ? { sublabel: "a group: its members" } : {}) })),
    ...Object.entries(doc.kinds).map(([kid, k]) => ({ value: kid, label: `Every ${k.label}`, sublabel: "a kind" })),
  ];
  const bySelector = isRecord(schedule.owner);
  const values = [...new Set(schedule.slots.map(slotLabel))];
  const colour = (slot: ScheduleSlot) => `var(--lre-series-${(values.indexOf(slotLabel(slot)) % 5) + 1})`;
  const lint = lintAt(draft?.lint ?? [], `schedules.${id}`);
  const slot = open !== null ? schedule.slots[open] : undefined;
  const addSlot = () => {
    const last = schedule.slots.at(-1);
    const start = last && TIME.test(last.end) ? last.end : "00:00";
    const end = timeOf(Math.min(DAY - 1, minutesOf(start) + 60));
    setSchedule({ ...schedule, slots: [...schedule.slots, { start, end, value: "" }] });
    setOpen(schedule.slots.length);
  };
  const save = () =>
    run(async () => {
      const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "schedules", id, value: { ...schedule, id } as unknown as JsonValue });
      if (message.type === "lre.result" && isNew) go(app, { view: "item", worldId: props.world.id, collection: "schedules", id });
    });
  const remove = () =>
    run(async () => {
      await deleteItem(app, props.send, { worldId: props.world.id, collection: "schedules", id });
    });
  return (
    <div class="lre-build-page" data-lre-editor="schedules">
      <ItemHeader title={nameOfId(id)} id={id} subtitle={`Sets ${schedule.target || "nothing yet"} · ${EVERY[rec.every]}`} onDelete={isNew ? undefined : remove} busy={busy} />
      <Issues issues={lint.filter((issue) => !issue.path.includes(".slots"))} />
      <Section title="Who and what">
        <div class="lre-stack">
          <Field label="It applies to">
            <Seg<"id" | "selector">
              label="It applies to"
              value={bySelector ? "selector" : "id"}
              options={[
                { value: "id", label: "Someone, a group or a kind" },
                { value: "selector", label: "A selector" },
              ]}
              onChange={(mode) => setSchedule({ ...schedule, owner: mode === "selector" ? {} : undefined })}
            />
          </Field>
          {bySelector ? (
            <SelectorEditor label="Applies to" value={selectorOf(schedule.owner)} doc={doc} onChange={(owner) => setSchedule({ ...schedule, owner: owner ?? {} })} />
          ) : (
            <RefPicker label="Owner" value={typeof schedule.owner === "string" ? schedule.owner : ""} options={owners} none="No one: a world process (weather, prices)" onChange={(owner) => setSchedule({ ...schedule, owner: owner || undefined })} />
          )}
          <span class="lre-small lre-muted">When schedules set the same field of the same person, the most specific owner wins: their own, then a group's, then their kind's, then a selector's.</span>
          <Field label="It sets" help="The field or relation each slot's value sets: place, activity, weather, price…">
            <input class="lre-input" value={schedule.target} onChange={(event) => setSchedule({ ...schedule, target: event.currentTarget.value })} />
          </Field>
        </div>
      </Section>
      <Section title="Repeats">
        <div class="lre-stack">
          <Seg<Recurrence["every"]> label="Repeats" value={rec.every} options={(Object.keys(EVERY) as Recurrence["every"][]).map((every) => ({ value: every, label: EVERY[every] }))} onChange={(every) => setRec({ ...rec, every })} />
          {rec.every === "week" ? (
            <Field label="On">
              <div class="lre-ve-days" role="group" aria-label="Weekdays">
                {WEEKDAYS.map((day, i) => {
                  const on = rec.weekdays?.includes(i) ?? false;
                  return (
                    <button key={day} type="button" aria-pressed={on} onClick={() => setRec({ ...rec, weekdays: on ? (rec.weekdays ?? []).filter((d) => d !== i) : [...(rec.weekdays ?? []), i].sort() })}>
                      {day}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : null}
          {rec.every === "month" ? (
            <Field label="On these days of the month">
              <div class="lre-ve-days" role="group" aria-label="Days of the month">
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
                  const on = rec.days?.includes(day) ?? false;
                  return (
                    <button key={day} type="button" aria-pressed={on} onClick={() => setRec({ ...rec, days: on ? (rec.days ?? []).filter((d) => d !== day) : [...(rec.days ?? []), day].sort((a, b) => a - b) })}>
                      {day}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : null}
          {props.world.calendar.holidays.length > 0 ? (
            <Field label="Not on">
              <div class="lre-form-chips" role="group" aria-label="Not on these holidays">
                {props.world.calendar.holidays.map((h) => {
                  const on = rec.except?.includes(h.id) ?? false;
                  return (
                    <Chip key={h.id} pressed={on} onToggle={() => setRec({ ...rec, except: on ? (rec.except ?? []).filter((e) => e !== h.id) : [...(rec.except ?? []), h.id] })}>
                      {h.label}
                    </Chip>
                  );
                })}
              </div>
            </Field>
          ) : null}
          <div class="lre-ve-times">
            <Field label="From">
              <input class="lre-input" type="date" value={rec.from ?? ""} onChange={(event) => setRec({ ...rec, from: event.currentTarget.value || undefined })} />
            </Field>
            <Field label="Until">
              <input class="lre-input" type="date" value={rec.until ?? ""} onChange={(event) => setRec({ ...rec, until: event.currentTarget.value || undefined })} />
            </Field>
          </div>
        </div>
      </Section>
      <Section title="The day" aside={<Button size="sm" icon="plus" onClick={addSlot}>Slot</Button>}>
        <div class="lre-stack">
          <DayBar slots={schedule.slots} current={open} colour={colour} onOpen={setOpen} onMove={(slots) => setSchedule({ ...schedule, slots })} />
          <span class="lre-small lre-muted">Tap a slot to edit it. Drag a handle to move where one slot ends or the next starts.</span>
          <Issues issues={[...new Set(issues.map((issue) => issue.message))].map((message) => ({ severity: "error", path: `schedules.${id}.slots`, code: "slot", message }))} />
          {schedule.slots.length === 0 ? (
            <span class="lre-small lre-muted">No slots: the schedule sets nothing.</span>
          ) : (
            <div class="lre-form-items" data-lre-slots>
              {schedule.slots.map((s, i) => {
                const flagged = issues.some((issue) => issue.slots.includes(i));
                return (
                  <ItemRow
                    key={i}
                    title={
                      <span class="lre-ve-brush">
                        <span class="lre-ve-dot" style={{ "--slot": colour(s) }} aria-hidden="true" />
                        {s.start}–{s.end}
                      </span>
                    }
                    subtitle={slotLabel(s)}
                    badge={flagged ? <span class="lre-badge neg">Fix</span> : undefined}
                    openLabel={`Edit slot ${i + 1}, ${s.start} to ${s.end}`}
                    onOpen={() => setOpen(i)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </Section>
      <Disclosure summary="JSON (Advanced)">
        <FieldInput
          spec={{ kind: "json", key: "", label: "The schedule as JSON", hint: "Every field as the world file keeps it. A change applies when you leave the box." }}
          value={schedule as unknown as JsonValue}
          ctx={{ doc, lint: [], path: `schedules.${id}`, identifiers: [], functions: [] }}
          path={`schedules.${id}`}
          parent={{}}
          onChange={(next) => {
            if (!isRecord(next) || typeof next.target !== "string" || !isRecord(next.recurrence) || !Array.isArray(next.slots)) return setJsonProblem("A schedule needs what it sets (target), when it repeats (recurrence) and its slots; the last schedule is kept.");
            setJsonProblem(null);
            // The editor needs those three to draw; the backend lints the rest, as it does every save.
            setSchedule({ ...(next as unknown as ScheduleDef), id });
          }}
        />
        {jsonProblem ? <Issues issues={[{ severity: "error", path: `schedules.${id}`, code: "json", message: jsonProblem }]} /> : null}
      </Disclosure>
      {slot && open !== null ? (
        <SlotSheet
          slot={slot}
          index={open}
          issues={issues.filter((issue) => issue.slots.includes(open)).map((issue) => issue.message)}
          onChange={(next) => setSchedule({ ...schedule, slots: schedule.slots.map((s, i) => (i === open ? next : s)) })}
          onRemove={() => {
            setSchedule({ ...schedule, slots: schedule.slots.filter((_, i) => i !== open) });
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
      <SaveBar>
        <Button variant="primary" disabled={(!changed && !isNew) || busy} onClick={save}>
          {isNew ? "Create schedule" : "Save to draft"}
          {issues.length > 0 ? ` · ${issues.length} to fix` : ""}
        </Button>
        <Button variant="ghost" disabled={!changed || busy} onClick={() => setSchedule(stored ? structuredClone(stored) : blank)}>
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}

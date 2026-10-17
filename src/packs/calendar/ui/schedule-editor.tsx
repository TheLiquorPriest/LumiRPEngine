// The schedule/timeline special widget (DESIGN §13): recurrence plus a slot table on a 24-hour bar.
// Slots are fixed values, weighted distributions or distributions given the previous slot. The owner
// is an entity, a group, a kind or a selector (the most specific one wins a field, DESIGN §8).

import { useEffect, useMemo, useState } from "preact/hooks";
import type { JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { Recurrence, ScheduleDef, ScheduleSlot } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { kindIs, SelectorEditor, selectorOf } from "../../../frontend/build/selector-editor";
import { Seg, useBusy } from "../../../frontend/components";
import type { EditorProps } from "../../../frontend/registry";
import { useSelect } from "../../../frontend/store";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Plain-language problems with a slot table: bad times and overlaps (an end at or before the start runs past midnight). */
export function slotProblems(slots: readonly ScheduleSlot[]): string[] {
  const problems: string[] = [];
  const spans: { start: number; end: number; index: number }[] = [];
  slots.forEach((slot, index) => {
    if (!TIME.test(slot.start) || !TIME.test(slot.end)) {
      problems.push(`Slot ${index + 1}: times must be HH:MM`);
      return;
    }
    const start = minutesOf(slot.start);
    const end = minutesOf(slot.end);
    if (end > start) spans.push({ start, end, index });
    else {
      spans.push({ start, end: 1440, index });
      if (end > 0) spans.push({ start: 0, end, index });
    }
    if (slot.value === undefined && !slot.weighted && !slot.given) problems.push(`Slot ${index + 1}: no value`);
    if (slot.weighted && slot.weighted.reduce((sum, w) => sum + w.weight, 0) <= 0) problems.push(`Slot ${index + 1}: weights must add up to more than 0`);
  });
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i += 1) {
    const prev = spans[i - 1];
    const cur = spans[i];
    if (prev && cur && cur.start < prev.end && prev.index !== cur.index) problems.push(`Slots ${prev.index + 1} and ${cur.index + 1} overlap`);
  }
  return [...new Set(problems)];
}

function slotLabel(slot: ScheduleSlot): string {
  if (slot.value !== undefined) return typeof slot.value === "string" ? slot.value : JSON.stringify(slot.value);
  if (slot.weighted) return slot.weighted.map((w) => (typeof w.value === "string" ? w.value : JSON.stringify(w.value))).join(" / ");
  return "given";
}

function JsonField(props: { label: string; value: JsonValue | undefined; onChange(value: JsonValue | undefined): void }) {
  const [text, setText] = useState(props.value === undefined ? "" : JSON.stringify(props.value));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(props.value === undefined ? "" : JSON.stringify(props.value)), [JSON.stringify(props.value)]);
  return (
    <label class="lre-field">
      <span class="label">{props.label}</span>
      <input
        class={bad ? "lre-input invalid" : "lre-input"}
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
        onBlur={() => {
          if (text.trim() === "") {
            setBad(false);
            props.onChange(undefined);
            return;
          }
          try {
            props.onChange(JSON.parse(text) as JsonValue);
            setBad(false);
          } catch {
            // A bare word is a string value.
            props.onChange(text.trim());
            setBad(false);
          }
        }}
      />
    </label>
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
  const [selected, setSelected] = useState(0);
  const [busy, run] = useBusy();
  useEffect(() => setSchedule(stored ? structuredClone(stored) : blank), [JSON.stringify(stored)]);
  const problems = useMemo(() => slotProblems(schedule.slots), [schedule.slots]);
  // Owners and selectors see the packs' kinds too (groups among them); the world's own win.
  const doc = useMemo(() => ({ ...props.world, kinds: { ...draft?.packKinds, ...props.world.kinds } }), [props.world, draft?.packKinds]);
  if (!id) return <span class="lre-muted">Choose a schedule.</span>;
  const rec = schedule.recurrence;
  const setRec = (next: Recurrence) => setSchedule({ ...schedule, recurrence: next });
  const slot = schedule.slots[selected];
  const setSlot = (next: ScheduleSlot) => setSchedule({ ...schedule, slots: schedule.slots.map((s, i) => (i === selected ? next : s)) });
  const changed = JSON.stringify(schedule) !== JSON.stringify(stored ?? null);
  const owners = [
    ...Object.values(doc.entities).map((e) => ({ value: e.id, label: `${e.name}${kindIs(doc, e.kind, "group") ? " (group: its members)" : ""}` })),
    ...Object.entries(doc.kinds).map(([kid, k]) => ({ value: kid, label: `${k.label} (every one of this kind)` })),
  ];
  const bySelector = isRecord(schedule.owner);
  return (
    <div class="lre-stack" data-lre-editor="schedules">
      <div class="lre-h2">
        <code>{id}</code>
      </div>
      <div class="lre-field">
        <span class="label">Owner</span>
        <Seg<"id" | "selector">
          label="Owner"
          value={bySelector ? "selector" : "id"}
          options={[
            { value: "id", label: "An entity, group or kind" },
            { value: "selector", label: "A selector" },
          ]}
          onChange={(mode) => setSchedule({ ...schedule, owner: mode === "selector" ? {} : undefined })}
        />
        {bySelector ? (
          <SelectorEditor label="Applies to" value={selectorOf(schedule.owner)} doc={doc} onChange={(owner) => setSchedule({ ...schedule, owner: owner ?? {} })} />
        ) : (
          <>
            <input class="lre-input" list="lre-schedule-owners" aria-label="Owner id" placeholder="Empty for a world process (weather, prices)" value={typeof schedule.owner === "string" ? schedule.owner : ""} onChange={(event) => setSchedule({ ...schedule, owner: event.currentTarget.value || undefined })} />
            <datalist id="lre-schedule-owners">
              {owners.map((o) => (
                <option key={o.value} value={o.value} label={o.label} />
              ))}
            </datalist>
          </>
        )}
        <span class="lre-small lre-muted">When schedules set the same field of the same entity, the most specific owner wins: the entity's own, then a group's, then its kind's, then a selector's.</span>
      </div>
      <label class="lre-field">
        <span class="label">Sets (place, activity, weather, price…)</span>
        <input class="lre-input" value={schedule.target} onChange={(event) => setSchedule({ ...schedule, target: event.currentTarget.value })} />
      </label>
      <section class="lre-card">
        <div class="lre-h">Repeats</div>
        <Seg<Recurrence["every"]>
          label="Every"
          value={rec.every}
          options={[
            { value: "day", label: "Daily" },
            { value: "week", label: "Weekly" },
            { value: "month", label: "Monthly" },
            { value: "year", label: "Yearly" },
          ]}
          onChange={(every) => setRec({ ...rec, every })}
        />
        {rec.every === "week" ? (
          <div class="lre-seg" style={{ marginTop: "8px" }} role="group" aria-label="Weekdays">
            {WEEKDAYS.map((day, i) => {
              const on = rec.weekdays?.includes(i) ?? false;
              return (
                <button key={day} type="button" aria-pressed={on} onClick={() => setRec({ ...rec, weekdays: on ? (rec.weekdays ?? []).filter((d) => d !== i) : [...(rec.weekdays ?? []), i].sort() })}>
                  {day}
                </button>
              );
            })}
          </div>
        ) : null}
        {rec.every === "month" ? (
          <label class="lre-field" style={{ marginTop: "8px" }}>
            <span class="label">Days of the month (comma separated)</span>
            <input class="lre-input" value={(rec.days ?? []).join(", ")} onChange={(event) => setRec({ ...rec, days: event.currentTarget.value.split(",").map((d) => Number(d.trim())).filter((d) => Number.isInteger(d) && d >= 1 && d <= 31) })} />
          </label>
        ) : null}
        {props.world.calendar.holidays.length > 0 ? (
          <div class="lre-field" style={{ marginTop: "8px" }}>
            <span class="label">Not on</span>
            <div class="lre-inline">
              {props.world.calendar.holidays.map((h) => {
                const on = rec.except?.includes(h.id) ?? false;
                return (
                  <button key={h.id} type="button" class={on ? "lre-btn small primary" : "lre-btn small"} aria-pressed={on} onClick={() => setRec({ ...rec, except: on ? (rec.except ?? []).filter((e) => e !== h.id) : [...(rec.except ?? []), h.id] })}>
                    {h.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div class="lre-inline" style={{ marginTop: "8px" }}>
          <label class="lre-field" style={{ flex: 1 }}>
            <span class="label">From</span>
            <input class="lre-input" type="date" value={rec.from ?? ""} onChange={(event) => setRec({ ...rec, from: event.currentTarget.value || undefined })} />
          </label>
          <label class="lre-field" style={{ flex: 1 }}>
            <span class="label">Until</span>
            <input class="lre-input" type="date" value={rec.until ?? ""} onChange={(event) => setRec({ ...rec, until: event.currentTarget.value || undefined })} />
          </label>
        </div>
      </section>
      <section class="lre-card">
        <div class="lre-h">
          <span>Day</span>
          <button
            type="button"
            class="lre-btn small"
            onClick={() => {
              const last = schedule.slots.at(-1);
              const start = last && TIME.test(last.end) ? last.end : "00:00";
              const endMinutes = Math.min(1439, minutesOf(start) + 60);
              const end = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
              setSchedule({ ...schedule, slots: [...schedule.slots, { start, end, value: "" }] });
              setSelected(schedule.slots.length);
            }}
          >
            + Slot
          </button>
        </div>
        {/* The bar is the picture; its spans can be narrower than a finger, so the list below is the target. */}
        <div class="lre-sched" aria-hidden="true">
          {schedule.slots.map((s, i) => {
            if (!TIME.test(s.start) || !TIME.test(s.end)) return null;
            const start = minutesOf(s.start);
            const endRaw = minutesOf(s.end);
            const end = endRaw <= start ? 1440 : endRaw;
            return (
              <button key={i} type="button" tabIndex={-1} aria-current={i === selected} style={{ left: `${(start / 1440) * 100}%`, width: `${((end - start) / 1440) * 100}%` }} title={`${s.start}–${s.end} ${slotLabel(s)}`} onClick={() => setSelected(i)}>
                {slotLabel(s)}
              </button>
            );
          })}
        </div>
        <div class="lre-sched-axis" aria-hidden="true">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
        {schedule.slots.length > 0 ? (
          <div class="lre-inline" role="group" aria-label="Slots" style={{ marginTop: "6px" }}>
            {schedule.slots.map((s, i) => (
              <button key={i} type="button" class={i === selected ? "lre-btn small primary" : "lre-btn small"} aria-pressed={i === selected} onClick={() => setSelected(i)}>
                {s.start}–{s.end} {slotLabel(s)}
              </button>
            ))}
          </div>
        ) : null}
        {problems.map((p) => (
          <div key={p} class="lre-small lre-neg">
            {p}
          </div>
        ))}
        {slot ? (
          <div class="lre-stack" style={{ marginTop: "10px" }} data-lre-slot={selected}>
            <div class="lre-inline">
              <label class="lre-field" style={{ flex: 1 }}>
                <span class="label">Start</span>
                <input class="lre-input" type="time" value={slot.start} onChange={(event) => setSlot({ ...slot, start: event.currentTarget.value })} />
              </label>
              <label class="lre-field" style={{ flex: 1 }}>
                <span class="label">End</span>
                <input class="lre-input" type="time" value={slot.end} onChange={(event) => setSlot({ ...slot, end: event.currentTarget.value })} />
              </label>
            </div>
            <Seg<"value" | "weighted">
              label="Slot value"
              value={slot.weighted ? "weighted" : "value"}
              options={[
                { value: "value", label: "Fixed" },
                { value: "weighted", label: "Weighted" },
              ]}
              onChange={(mode) => setSlot(mode === "value" ? { start: slot.start, end: slot.end, value: slot.weighted?.[0]?.value ?? "" } : { start: slot.start, end: slot.end, weighted: [{ value: slot.value ?? "", weight: 1 }] })}
            />
            {slot.weighted ? (
              <>
                {slot.weighted.map((w, i) => (
                  <div key={i} class="lre-inline" style={{ alignItems: "flex-end" }}>
                    <div style={{ flex: 2 }}>
                      <JsonField label={`Value ${i + 1}`} value={w.value} onChange={(value) => setSlot({ ...slot, weighted: slot.weighted?.map((x, j) => (j === i ? { ...x, value: value ?? "" } : x)) })} />
                    </div>
                    <label class="lre-field" style={{ flex: 1 }}>
                      <span class="label">Weight</span>
                      <input class="lre-input" inputMode="decimal" value={String(w.weight)} onChange={(event) => setSlot({ ...slot, weighted: slot.weighted?.map((x, j) => (j === i ? { ...x, weight: Number(event.currentTarget.value) || 0 } : x)) })} />
                    </label>
                    <button type="button" class="lre-btn small ghost" aria-label={`Remove value ${i + 1}`} onClick={() => setSlot({ ...slot, weighted: slot.weighted?.filter((_, j) => j !== i) })}>
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" class="lre-btn small" onClick={() => setSlot({ ...slot, weighted: [...(slot.weighted ?? []), { value: "", weight: 1 }] })}>
                  + Value
                </button>
              </>
            ) : (
              <JsonField label="Value" value={slot.value} onChange={(value) => setSlot({ ...slot, value })} />
            )}
            <JsonField label="Given the previous slot (JSON, optional)" value={slot.given as JsonValue | undefined} onChange={(value) => setSlot({ ...slot, given: value === undefined ? undefined : (value as unknown as ScheduleSlot["given"]) })} />
            <button
              type="button"
              class="lre-btn danger small"
              onClick={() => {
                setSchedule({ ...schedule, slots: schedule.slots.filter((_, i) => i !== selected) });
                setSelected(Math.max(0, selected - 1));
              }}
            >
              Remove slot
            </button>
          </div>
        ) : null}
      </section>
      <div class="lre-inline">
        <button
          type="button"
          class="lre-btn primary"
          disabled={(!changed && !isNew) || busy}
          onClick={() =>
            run(async () => {
              const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "schedules", id, value: { ...schedule, id } as unknown as JsonValue });
              if (message.type === "lre.result" && isNew) app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.world.id, collection: "schedules", id } }));
            })
          }
        >
          {isNew ? "Create schedule" : "Save to draft"}
          {problems.length > 0 ? ` (${problems.length}⚠)` : ""}
        </button>
        <button type="button" class="lre-btn ghost" disabled={!changed || busy} onClick={() => setSchedule(stored ? structuredClone(stored) : blank)}>
          Revert
        </button>
      </div>
    </div>
  );
}

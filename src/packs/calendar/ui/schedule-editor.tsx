// Build's schedule page (DESIGN §13): the schedule/timeline special widget for the `schedules`
// collection. The form itself (who and what, when it repeats, the day as a bar of slots) is Build's
// shared `ScheduleForm`; this page holds the draft's copy, saves it, reverts it and deletes it.

import { useMemo, useState } from "preact/hooks";
import type { JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import { nameOfId } from "../../../shared/maps";
import type { ScheduleDef } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { deleteItem, go, ItemHeader } from "../../../frontend/build/chrome";
import { Issues } from "../../../frontend/build/form-kit";
import { useHeld } from "../../../frontend/build/held";
import { EVERY, ScheduleForm, scheduleWrite, slotIssues, targetWords } from "../../../frontend/build/schedule-form";
import { FieldInput, lintAt } from "../../../frontend/build/schema-form";
import { Button, Disclosure, SaveBar, useBusy } from "../../../frontend/components";
import type { EditorProps } from "../../../frontend/registry";
import { useSelect } from "../../../frontend/store";

export function ScheduleEditor(props: EditorProps) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const isNew = props.id?.startsWith("new:") ?? false;
  const id = isNew ? (props.id ?? "").slice(4) : props.id;
  const stored = id ? props.world.schedules[id] : undefined;
  const blank: ScheduleDef = { id: id ?? "", target: "activity", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "17:00", value: "work" }] };
  const [schedule, setSchedule] = useState<ScheduleDef>(stored ? structuredClone(stored) : blank);
  const [busy, run] = useBusy();
  const [jsonProblem, setJsonProblem] = useState<string | null>(null);
  // Revert starts the form over too, so a level chosen but never filled, or a slot's sheet, goes with the rest.
  const [reverts, setReverts] = useState(0);
  useHeld(schedule, setSchedule, stored ?? blank, `${props.world.id}/schedules/${props.id ?? ""}`, JSON.stringify(stored ?? null));
  // Owners and selectors see the packs' kinds too (groups among them); the world's own win.
  const doc = useMemo(() => ({ ...props.world, kinds: { ...draft?.packKinds, ...props.world.kinds } }), [props.world, draft?.packKinds]);
  if (!id) return <span class="lre-muted">Choose a schedule.</span>;
  const changed = JSON.stringify(schedule) !== JSON.stringify(stored ?? null);
  const problems = slotIssues(schedule.slots).length;
  const lint = lintAt(draft?.lint ?? [], `schedules.${id}`);
  const save = () =>
    run(async () => {
      const message = await props.send(scheduleWrite(props.world.id, id, schedule));
      if (message.type === "lre.result" && isNew) go(app, { view: "item", worldId: props.world.id, collection: "schedules", id });
    });
  const remove = () =>
    run(async () => {
      await deleteItem(app, props.send, { worldId: props.world.id, collection: "schedules", id });
    });
  return (
    <div class="lre-build-page" data-lre-editor="schedules">
      <ItemHeader title={nameOfId(id)} id={id} subtitle={`Sets ${targetWords(doc, schedule.owner, schedule.target)} · ${EVERY[schedule.recurrence.every]}`} onDelete={isNew ? undefined : remove} busy={busy} />
      <Issues issues={lint.filter((issue) => !issue.path.includes(".slots"))} />
      <ScheduleForm key={reverts} value={schedule} doc={doc} path={`schedules.${id}`} onChange={setSchedule} />
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
      <SaveBar>
        <Button variant="primary" disabled={(!changed && !isNew) || busy} onClick={save}>
          {isNew ? "Create schedule" : "Save to draft"}
          {problems > 0 ? ` · ${problems} to fix` : ""}
        </Button>
        <Button
          variant="ghost"
          disabled={!changed || busy}
          onClick={() => {
            setSchedule(stored ? structuredClone(stored) : blank);
            setReverts(reverts + 1);
          }}
        >
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}

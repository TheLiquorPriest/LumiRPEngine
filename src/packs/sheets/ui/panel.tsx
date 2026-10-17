// Play → You: the POV's sheet (bands as words at Sheets 1, stats and skills above), conditions,
// place and activity, with ✎ fixes on the rows that have a fix target.

import { useState } from "preact/hooks";
import { isRecord } from "../../../shared/json";
import type { JsonValue } from "../../../shared/json";
import type { FixTarget } from "../../../shared/state-view";
import { Card, Empty, JsonView } from "../../../frontend/components";
import { list, obj, optStr, str, strings } from "../../../frontend/decode";
import { FixEditor } from "../../../frontend/fix-editor";
import type { PanelProps } from "../../../frontend/registry";

interface SheetRow {
  label: string;
  value: string;
  detail?: string;
  fix?: FixTarget;
}

export interface YouView {
  name: string;
  tier: string;
  place?: string;
  activity?: string;
  conditions: string[];
  sections: { title: string; rows: SheetRow[] }[];
}

const FIELD_TYPES = ["number", "text", "bool", "enum", "ref", "list", "dice", "money", "date", "duration"] as const;

/** A FixTarget from JSON, or undefined when it lacks entity and field. */
export function decodeFix(value: unknown): FixTarget | undefined {
  const fix = obj(value);
  if (!fix || typeof fix.entity !== "string" || typeof fix.field !== "string") return undefined;
  const type = FIELD_TYPES.find((candidate) => candidate === fix.type) ?? "text";
  const options = list(fix.options, (o) => (typeof o.label === "string" ? { label: o.label, value: (o.value ?? null) as JsonValue } : null));
  return {
    entity: fix.entity,
    field: fix.field,
    type,
    value: (fix.value ?? null) as JsonValue,
    options: options.length > 0 ? options : undefined,
    min: typeof fix.min === "number" ? fix.min : undefined,
    max: typeof fix.max === "number" ? fix.max : undefined,
  };
}

export function decodeYouView(value: unknown): YouView | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  return {
    name: value.name,
    tier: str(value.tier, "pov"),
    place: optStr(value.place),
    activity: optStr(value.activity),
    conditions: strings(value.conditions),
    sections: list(value.sections, (s) => ({
      title: str(s.title),
      rows: list(s.rows, (r) => ({ label: str(r.label), value: str(r.value), detail: optStr(r.detail), fix: decodeFix(r.fix) })),
    })),
  };
}

export function YouPanel(props: PanelProps) {
  const view = decodeYouView(props.view);
  const [fixing, setFixing] = useState<string | null>(null);
  if (props.view === null || props.view === undefined) return <Empty>No character sheet yet.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  return (
    <div class="lre-stack" data-lre-panel="sheets.you">
      <Card title={view.name} aside={<span class="lre-badge accent">{view.tier}</span>}>
        {view.place || view.activity ? <div class="lre-muted">{[view.activity, view.place].filter((part) => part).join(" · ")}</div> : null}
        {view.conditions.length > 0 ? (
          <div class="lre-inline" style={{ marginTop: "6px" }}>
            {view.conditions.map((c) => (
              <span key={c} class="lre-badge warn">
                {c}
              </span>
            ))}
          </div>
        ) : null}
      </Card>
      {view.sections.map((section) => (
        <Card key={section.title} title={section.title}>
          {section.rows.map((row) => {
            const key = `${section.title}:${row.label}`;
            if (fixing === key && row.fix) return <FixEditor key={key} label={row.label} target={row.fix} onDone={() => setFixing(null)} />;
            return (
              <div key={key} class="lre-row">
                <span class="k">
                  {row.label}
                  {row.detail ? <span class="sub">{row.detail}</span> : null}
                </span>
                <span class="v lre-inline">
                  {row.value}
                  {row.fix ? (
                    <button type="button" class="lre-btn small ghost" aria-label={`Fix ${row.label}`} onClick={() => setFixing(key)}>
                      ✎
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </Card>
      ))}
    </div>
  );
}

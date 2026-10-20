// Play → Me → You: the POV's sheet (bands as words at Sheets 1, stats and skills above, or the
// world ruleset's designed sheet with pool meters and XP toward the next level), conditions, place
// and activity, with ✎ fixes on the rows that have a fix target.

import { useState } from "preact/hooks";
import { isRecord } from "../../../shared/json";
import type { JsonValue } from "../../../shared/json";
import type { FixTarget, SheetRowView, SheetSectionView } from "../../../shared/state-view";
import { Avatar, Badge, Empty, IconButton, JsonView, Meter, Section } from "../../../frontend/components";
import { list, obj, optStr, str, strings } from "../../../frontend/decode";
import { FixEditor } from "../../../frontend/fix-editor";
import type { PanelProps } from "../../../frontend/registry";

export interface YouView {
  name: string;
  tier: string;
  place?: string;
  activity?: string;
  conditions: string[];
  sections: SheetSectionView[];
}

/** A row's pool bar or progression meter from JSON (DESIGN §11); anything malformed is left out. */
function decodeMeters(r: Record<string, unknown>): Pick<SheetRowView, "pool" | "progress"> {
  const pool = obj(r.pool);
  const progress = obj(r.progress);
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  return {
    ...(pool && num(pool.current) && num(pool.min) && (pool.max === null || num(pool.max)) ? { pool: { current: pool.current, min: pool.min, max: pool.max } } : {}),
    ...(progress && num(progress.level) && num(progress.xp) && num(progress.from) && (progress.next === null || num(progress.next)) ? { progress: { level: progress.level, xp: progress.xp, from: progress.from, next: progress.next } } : {}),
  };
}

/** A pool's meter, when its max can be read and lies above its min. */
function poolMeter(row: SheetRowView): { value: number; min: number; max: number } | null {
  const pool = row.pool;
  return pool && pool.max !== null && pool.max > pool.min ? { value: pool.current, min: pool.min, max: pool.max } : null;
}

/** A level's XP between its threshold and the next; a progression at its top level shows a full meter. */
function progressMeter(row: SheetRowView): { value: number; min: number; max: number } | null {
  const progress = row.progress;
  if (!progress) return null;
  if (progress.next === null) return { value: 1, min: 0, max: 1 };
  return progress.next > progress.from ? { value: progress.xp, min: progress.from, max: progress.next } : null;
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
    tier: str(value.tier),
    place: optStr(value.place),
    activity: optStr(value.activity),
    conditions: strings(value.conditions),
    sections: list(value.sections, (s) => ({
      title: str(s.title),
      rows: list(s.rows, (r) => ({ label: str(r.label), value: str(r.value), detail: optStr(r.detail), fix: decodeFix(r.fix), ...decodeMeters(r) })),
    })),
  };
}

/** One sheet row: a pool as a meter with its value, a level with its XP meter, or a label and value; ✎ when it has a fix target. */
function SheetRow(props: { row: SheetRowView; onFix(): void }) {
  const { row } = props;
  const fix = row.fix ? <IconButton icon="edit" label={`Fix ${row.label}`} onClick={props.onFix} /> : null;
  const pool = poolMeter(row);
  if (pool) {
    const low = (pool.value - pool.min) / (pool.max - pool.min) <= 0.25;
    return (
      <div class="lre-me-stat">
        <div class="lre-me-stat-main">
          <Meter label={row.label} value={pool.value} min={pool.min} max={pool.max} tone={low ? "neg" : "accent"} showValue />
          {row.detail ? <span class="lre-me-stat-sub">{row.detail}</span> : null}
        </div>
        {fix}
      </div>
    );
  }
  const progress = progressMeter(row);
  return (
    <div class="lre-me-stat">
      <div class="lre-me-stat-main">
        <div class="lre-me-stat-line">
          <span class="lre-me-stat-k">
            {row.label}
            {row.detail && !progress ? <span class="lre-me-stat-sub">{row.detail}</span> : null}
          </span>
          <span class="lre-me-stat-v">{row.value}</span>
        </div>
        {progress ? <Meter label={row.detail ?? (row.progress?.next === null ? "Top level" : `Level ${row.value}`)} value={progress.value} min={progress.min} max={progress.max} /> : null}
      </div>
      {fix}
    </div>
  );
}

/**
 * A designed sheet's sections, each a titled list: pools as meters, levels with their XP, and ✎ on
 * the rows with a fix target. Play → You shows the POV's; Build's Sheet Designer previews the same.
 */
export function SheetSectionCards(props: { sections: readonly SheetSectionView[] }) {
  const [fixing, setFixing] = useState<string | null>(null);
  return (
    <>
      {props.sections.map((section) => (
        <Section key={section.title} title={section.title} flush>
          <div class="lre-me-stats">
            {section.rows.map((row) => {
              const key = `${section.title}:${row.label}`;
              if (fixing === key && row.fix) {
                return (
                  <div key={key} class="lre-me-stat fixing">
                    <FixEditor label={row.label} target={row.fix} onDone={() => setFixing(null)} />
                  </div>
                );
              }
              return <SheetRow key={key} row={row} onFix={() => setFixing(key)} />;
            })}
          </div>
        </Section>
      ))}
    </>
  );
}

export function YouPanel(props: PanelProps) {
  const view = decodeYouView(props.view);
  if (props.view === null || props.view === undefined) return <Empty icon="user">No character sheet yet.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  const where = [view.activity, view.place].filter((part) => part).join(" · ");
  return (
    <div class="lre-stack lre-me" data-lre-panel="sheets.you">
      <section class="lre-me-hero">
        <Avatar name={view.name} size={48} />
        <div class="lre-me-hero-text">
          <h2 class="lre-me-hero-name">{view.name}</h2>
          {where ? <span class="lre-me-hero-sub">{where}</span> : null}
        </div>
        {view.tier ? <Badge tone="accent">{view.tier}</Badge> : null}
      </section>
      {view.conditions.length > 0 ? (
        <Section title="Conditions">
          <div class="lre-inline">
            {view.conditions.map((c) => (
              <Badge key={c} tone="warn">
                {c}
              </Badge>
            ))}
          </div>
        </Section>
      ) : null}
      <SheetSectionCards sections={view.sections} />
    </div>
  );
}

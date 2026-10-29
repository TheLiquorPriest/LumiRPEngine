// Settings → Agents → Retention (DESIGN §4.4; AGENT-LOOP-PLAN §15): how long the agents' stored texts
// are kept once nothing needs them, and how often the sweep that removes them runs. Each row says
// what it does, its default and its value, with a Default reset; No limit and Never are "none". The
// rows look like the Timeouts page's (styles/settings.ts).

import type { JsonObject } from "../../shared/json";
import type { Limit } from "../../shared/minds";
import { RETENTION_DEFAULTS, type RetentionSettings } from "../../shared/stores";
import { Button, HostSwitch, NumberStepper, Section } from "../components";

type RetentionKey = keyof RetentionSettings;

interface RetentionRowDef {
  id: RetentionKey;
  title: string;
  does: string;
  unit: "day" | "hour";
  /** The least value it takes (`retentionOf`'s floor). */
  min: number;
  /** What 0 means, where it takes 0. */
  zero?: string;
  /** Where it takes "none": the switch's word for it and what it means. */
  none?: { word: "No limit" | "Never"; means: string };
}

const ROWS: readonly RetentionRowDef[] = [
  {
    id: "transcriptDays",
    title: "Agent call texts",
    does: "How long Diagnostics keeps what each agent call was sent and answered, after the call. The call's row stays as long as Records per chat (Settings → Diagnostics) keeps it; only its text goes.",
    unit: "day",
    min: 0,
    zero: "no call's text is kept",
    none: { word: "No limit", means: "each text is kept as long as its call's row" },
  },
  {
    id: "unreferencedDays",
    title: "Unused texts",
    does: "How long a stored text nothing uses any more is kept before a sweep removes it: one only a deleted reply, swipe or chat used, or a call's text past the limit above. It counts from the first sweep that finds it unused. A text that a reply in any of your world chats, a chat's learned files, Diagnostics or a turn under way still uses is never removed.",
    unit: "day",
    min: 0,
    zero: "the sweep after the one that finds a text unused removes it",
  },
  {
    id: "sweepHours",
    title: "Sweep",
    does: "How often a sweep looks for unused texts. It runs while you use LumiRPEngine, never while a turn does.",
    unit: "hour",
    min: 1,
    none: { word: "Never", means: "nothing is removed" },
  },
];

/** A count with its unit: "1 day", "24 hours". */
function count(n: number, unit: "day" | "hour"): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** The home row's line: each setting as it stands. */
export function retentionSummary(r: RetentionSettings): string {
  const texts = r.transcriptDays === "none" ? "with their rows" : count(r.transcriptDays, "day");
  const sweep = r.sweepHours === "none" ? "never swept" : `swept every ${count(r.sweepHours, "hour")}`;
  return `Call texts ${texts} · unused ${count(r.unreferencedDays, "day")} · ${sweep}`;
}

function RetentionRow(props: { row: RetentionRowDef; value: Limit; busy: boolean; set(value: Limit | null): void }) {
  const { row, value } = props;
  const fallback = RETENTION_DEFAULTS[row.id];
  const fallbackText = fallback === "none" ? (row.none?.word ?? "none") : count(fallback, row.unit);
  return (
    <div class="lre-set-ext lre-set-timeout" data-lre-retention={row.id}>
      <div class="lre-set-ext-head">
        <span class="lre-set-ext-title">{row.title}</span>
        {value === fallback ? null : (
          <Button size="sm" variant="ghost" icon="undo" label={`Reset ${row.title} to its default, ${fallbackText}`} disabled={props.busy} onClick={() => props.set(null)}>
            Default
          </Button>
        )}
      </div>
      <span class="lre-set-timeout-text">{row.does}</span>
      {row.none ? <HostSwitch label={`${row.title}: ${row.none.word.toLowerCase()}`} checked={value === "none"} disabled={props.busy} onChange={(none) => props.set(none ? "none" : typeof fallback === "number" ? fallback : row.min)} /> : null}
      {value === "none" ? null : <NumberStepper label={`${row.title} (${row.unit}s)`} value={value} min={row.min} integer disabled={props.busy} onChange={props.set} />}
      <span class="lre-small lre-muted">
        Default {fallbackText}
        {row.zero ? `; 0 means ${row.zero}` : ""}
        {value === "none" && row.none ? `; ${row.none.word.toLowerCase()}: ${row.none.means}` : ""}.
      </span>
    </div>
  );
}

export function RetentionPage(props: { retention: RetentionSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const set = (id: RetentionKey) => (value: Limit | null) => props.patch({ retention: { [id]: value } });
  return (
    <div class="lre-stack" data-lre-settings-page="retention">
      <p class="lre-set-lead">The agents keep what they write (each turn's part of their session, their workspace and learned files, what each call was sent and answered) once in your storage, shared by all your chats, so a swipe, a Re-run or a Branch costs nothing. These say how long a text stays once nothing needs it.</p>
      <Section flush>
        <div class="lre-set-rows">
          {ROWS.map((row) => (
            <RetentionRow key={row.id} row={row} value={props.retention[row.id]} busy={props.busy} set={set(row.id)} />
          ))}
        </div>
      </Section>
    </div>
  );
}

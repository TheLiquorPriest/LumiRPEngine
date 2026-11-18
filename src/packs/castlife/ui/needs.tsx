// Play → Me → Needs (DESIGN §8): the player character's needs from Cast life 4, each the world has on,
// as a gauge from met (0) to urgent (100), in words once it is pressing, and under each what its number
// means (the point it presses from) and what meets it. The panel says what the Author is in fact told of
// a need: nothing of its number; in the world state each turn, a need of yours that reaches the point it
// alerts at within the time ahead that state lists, and one that reached it as the last turn moved the
// clock (`src/store/due.ts`, `src/store/world-state.ts`).

import { isRecord } from "../../../shared/json";
import { Badge, JsonView, Meter, Section } from "../../../frontend/components";
import { list, str } from "../../../frontend/decode";
import type { PanelProps } from "../../../frontend/registry";

export interface NeedRow {
  need: string;
  name: string;
  /** Its word once it's pressing ("hungry"). */
  label: string;
  value: number;
  pressing: boolean;
  /** The point it presses from; null in a view from before it carried one. */
  tell: number | null;
  /** What meets it, to finish "met by …"; empty in a view from before it carried one. */
  metBy: string;
}

/** The needs view as the core builds it (`buildNeedsView`); null for anything else. */
export function decodeNeedsView(value: unknown): NeedRow[] | null {
  if (!isRecord(value) || !Array.isArray(value.needs)) return null;
  return list(value.needs, (n) =>
    typeof n.need === "string" && typeof n.value === "number"
      ? { need: n.need, name: str(n.name, n.need), label: str(n.label), value: n.value, pressing: n.pressing === true, tell: typeof n.tell === "number" ? n.tell : null, metBy: str(n.metBy) }
      : null,
  );
}

/** Under a need's gauge: what its number means for the player (from when it's pressing, and whether it is) and what meets it. */
export function needLine(n: NeedRow): string {
  const point = n.pressing ? `You're ${n.label}.` : n.tell !== null && n.label !== "" ? `From ${n.tell} you're ${n.label}.` : "";
  return [point, n.metBy !== "" ? `Met by ${n.metBy}.` : ""].filter((s) => s !== "").join(" ");
}

/** What the Author is told of your needs, said once under the gauges. */
export const NEEDS_TOLD =
  "The Author is not shown these numbers. The world state it is given each turn says when one of your needs will reach the point it alerts at, if that falls within the time ahead it lists (the setting Time ahead listed as due), and which reached it while the last turn moved the clock.";

export function NeedsPanel(props: PanelProps) {
  const needs = decodeNeedsView(props.view);
  if (!needs) return <JsonView value={props.view ?? null} />;
  return (
    <Section title="Needs" aside={needs.some((n) => n.pressing) ? <Badge tone="warn">{needs.filter((n) => n.pressing).map((n) => n.label).join(", ")}</Badge> : undefined}>
      <p class="lre-small lre-muted lre-needs-note">Each runs from 0, met, to 100, urgent, and grows by the hour until something meets it.</p>
      <p class="lre-small lre-muted lre-needs-note" data-lre-needs-told>
        {NEEDS_TOLD}
      </p>
      <div class="lre-stack" data-lre-needs>
        {needs.map((n) => (
          <div key={n.need} data-lre-need={n.need} data-lre-pressing={n.pressing ? "" : undefined}>
            <Meter label={n.pressing ? `${n.name}: ${n.label}` : n.name} value={n.value} max={100} tone={n.pressing ? "warn" : "accent"} showValue />
            <p class="lre-small lre-muted lre-need-line">{needLine(n)}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

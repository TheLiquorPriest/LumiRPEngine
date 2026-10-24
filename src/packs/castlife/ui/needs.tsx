// Play → Me → Needs (DESIGN §8): the player character's needs from Cast life 4, each the world has on,
// as a gauge from met (0) to urgent (100), and in words once it is pressing, as the narrator is told it.

import { isRecord } from "../../../shared/json";
import { Badge, JsonView, Meter, Section } from "../../../frontend/components";
import { list, str } from "../../../frontend/decode";
import type { PanelProps } from "../../../frontend/registry";

export interface NeedRow {
  need: string;
  name: string;
  label: string;
  value: number;
  pressing: boolean;
}

/** The needs view as the core builds it (`buildNeedsView`); null for anything else. */
export function decodeNeedsView(value: unknown): NeedRow[] | null {
  if (!isRecord(value) || !Array.isArray(value.needs)) return null;
  return list(value.needs, (n) => (typeof n.need === "string" && typeof n.value === "number" ? { need: n.need, name: str(n.name, n.need), label: str(n.label), value: n.value, pressing: n.pressing === true } : null));
}

export function NeedsPanel(props: PanelProps) {
  const needs = decodeNeedsView(props.view);
  if (!needs) return <JsonView value={props.view ?? null} />;
  return (
    <Section title="Needs" aside={needs.some((n) => n.pressing) ? <Badge tone="warn">{needs.filter((n) => n.pressing).map((n) => n.label).join(", ")}</Badge> : undefined}>
      <div class="lre-stack" data-lre-needs>
        {needs.map((n) => (
          <div key={n.need} data-lre-need={n.need} data-lre-pressing={n.pressing ? "" : undefined}>
            <Meter label={n.pressing ? `${n.name}: ${n.label}` : n.name} value={n.value} max={100} tone={n.pressing ? "warn" : "accent"} showValue />
          </div>
        ))}
      </div>
    </Section>
  );
}

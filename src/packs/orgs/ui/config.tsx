// Build → Packs → orgs: the orgs pack's own config fields in the Build forms' idiom, above its config as JSON. For now the
// plan's four figures (`packs.orgs.config.plan`): how many open goals and orders an organization's plan holds before a new
// one is reported, and how many closed ones its page shows. Each is a count, left empty it is the engine's own
// (`PLAN_DEFAULTS`), and none is capped: a plan past its figure keeps what the story gives it and says so.

import type { JsonObject, JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import { FormGroup } from "../../../frontend/build/form-kit";
import { lintAt, NumberInput } from "../../../frontend/build/schema-form";
import type { PackConfigProps } from "../../../frontend/registry";
import { PLAN_DEFAULTS } from "../core/agenda";

const CONFIG = "packs.orgs.config";

type PlanKey = keyof typeof PLAN_DEFAULTS;

const PLAN_FIELDS: readonly { key: PlanKey; label: string; hint: string }[] = [
  { key: "goals", label: "Open goals a plan holds", hint: "A goal given past this is kept, and the plan says it is full." },
  { key: "orders", label: "Open orders a plan holds", hint: "An order given past this is kept, and the plan says it is full." },
  { key: "closedGoals", label: "Closed goals its page shows", hint: "The newest closed goals; the page counts the rest. Every closed goal stays in the record." },
  { key: "closedOrders", label: "Closed orders its page shows", hint: "The newest closed orders; the page counts the rest. Every closed order stays in the record." },
];

/** The config with one plan figure set (undefined removes it), and no empty `plan` left. */
export function withPlanFigure(config: Readonly<JsonObject>, key: PlanKey, value: JsonValue | undefined): JsonObject {
  const plan: JsonObject = isRecord(config.plan) ? { ...config.plan } : {};
  if (value === undefined) delete plan[key];
  else plan[key] = value;
  const { plan: _old, ...rest } = config;
  return Object.keys(plan).length > 0 ? { ...rest, plan } : { ...rest };
}

export function OrgsConfig(props: PackConfigProps) {
  const plan = isRecord(props.config.plan) ? props.config.plan : {};
  return (
    <div class="lre-form-fields" data-lre-orgs-config>
      <FormGroup title="Organizations' plans">
        {PLAN_FIELDS.map((f) => (
          <NumberInput
            key={f.key}
            label={f.label}
            value={plan[f.key]}
            min={0}
            step={1}
            optional
            placeholder={String(PLAN_DEFAULTS[f.key])}
            hint={`${f.hint} Empty uses ${PLAN_DEFAULTS[f.key]}.`}
            issues={lintAt(props.lint, `${CONFIG}.plan.${f.key}`)}
            onChange={(value) => props.onChange(withPlanFigure(props.config, f.key, value))}
          />
        ))}
      </FormGroup>
    </div>
  );
}

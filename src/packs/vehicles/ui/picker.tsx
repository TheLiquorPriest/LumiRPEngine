// The vehicle picker (DESIGN §9.3): the world's vehicle classes grouped by where they go (On the
// road, Off road, On the water, and In the air only where the world authors air routes), found by
// name, each with its typical used price. A pick opens its make, model and year, filled from the
// class and a used one's year, to change before it is taken. It doesn't fetch: the caller passes the
// classes (`vehicleClassChoices`). Add a thing (Play, GM, Build) and the Garage open it.

import { useMemo, useState } from "preact/hooks";
import { VEHICLE_DOMAIN_LABEL, VEHICLE_DOMAINS, shortClassName, type VehicleClassChoice, type VehicleDomain, type VehiclePick } from "../../../shared/vehicles";
import { FormSheet } from "../../../frontend/build/form-kit";
import { Button, Empty, Field, List, ListRow, Section } from "../../../frontend/components";
import { formatCents } from "../../../frontend/format";
import type { IconName } from "../../../frontend/icons";

/** How a class's domain draws. */
export const DOMAIN_ICON: Readonly<Record<VehicleDomain, IconName>> = { road: "car", offroad: "car", marine: "boat", air: "plane" };

/** The classes whose name, id, make or model has every word of the search, in the order given. */
export function filterClasses(classes: readonly VehicleClassChoice[], query: string): VehicleClassChoice[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return [...classes];
  return classes.filter((c) => {
    const hay = `${c.name} ${c.id.replace(/_/g, " ")} ${c.make ?? ""} ${c.model ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** A pick from a class and what the form holds: an empty make or model keeps the class's, a year out of range the default one. */
export function pickOf(c: VehicleClassChoice, form: { make: string; model: string; year: string }): VehiclePick {
  const year = Number.parseInt(form.year, 10);
  return { id: c.id, name: c.name, domain: c.domain, make: form.make.trim() || (c.make ?? ""), model: form.model.trim() || (c.model ?? ""), year: Number.isFinite(year) && year >= 1886 && year <= 2200 ? year : (c.year ?? new Date().getFullYear()) };
}

export function VehiclePicker(props: { classes: readonly VehicleClassChoice[]; value: string | null; onPick(pick: VehiclePick): void; onClose(): void; title?: string }) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<VehicleClassChoice | null>(null);
  const [form, setForm] = useState({ make: "", model: "", year: "" });
  const found = useMemo(() => filterClasses(props.classes, query), [props.classes, query]);
  const choose = (c: VehicleClassChoice): void => {
    setChosen(c);
    setForm({ make: c.make ?? "", model: c.model ?? "", year: c.year !== undefined ? String(c.year) : "" });
  };
  if (chosen) {
    return (
      <FormSheet
        title={shortClassName(chosen.name)}
        subtitle={VEHICLE_DOMAIN_LABEL[chosen.domain]}
        backLabel="Classes"
        onClose={() => setChosen(null)}
        actions={
          <Button variant="primary" onClick={() => props.onPick(pickOf(chosen, form))}>
            Use this
          </Button>
        }
      >
        <div class="lre-stack" data-lre-vehicle-pick={chosen.id}>
          <Field label="Make" for="lre-vehicle-make">
            <input id="lre-vehicle-make" class="lre-input" value={form.make} placeholder={chosen.make ?? "Make"} onInput={(event) => setForm({ ...form, make: event.currentTarget.value })} />
          </Field>
          <Field label="Model" for="lre-vehicle-model">
            <input id="lre-vehicle-model" class="lre-input" value={form.model} placeholder={chosen.model ?? "Model"} onInput={(event) => setForm({ ...form, model: event.currentTarget.value })} />
          </Field>
          <Field label="Year" help="A used one is about four years old; a new one is this year's." for="lre-vehicle-year">
            <input id="lre-vehicle-year" class="lre-input" type="number" inputMode="numeric" min={1886} max={2200} value={form.year} onInput={(event) => setForm({ ...form, year: event.currentTarget.value })} />
          </Field>
        </div>
      </FormSheet>
    );
  }
  return (
    <FormSheet title={props.title ?? "What vehicle?"} onClose={props.onClose}>
      <div class="lre-stack" data-lre-vehicle-picker>
        <input class="lre-input" type="search" aria-label="Search the vehicle classes" placeholder="Search: pickup, kayak, helicopter…" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
        {found.length === 0 ? <Empty icon="car">No class matches “{query}”.</Empty> : null}
        {VEHICLE_DOMAINS.map((domain) => {
          const rows = found.filter((c) => c.domain === domain);
          if (rows.length === 0) return null;
          return (
            <Section key={domain} title={VEHICLE_DOMAIN_LABEL[domain]} flush>
              <List>
                {rows.map((c) => (
                  <ListRow
                    key={c.id}
                    icon={DOMAIN_ICON[c.domain]}
                    title={shortClassName(c.name)}
                    subtitle={[c.make && c.model ? `${c.make} ${c.model}` : null, c.name !== shortClassName(c.name) ? c.name.slice(shortClassName(c.name).length).trim().replace(/^\(|\)$/g, "") : null].filter((p) => p).join(" · ")}
                    value={c.priceCents !== undefined ? `~${formatCents(c.priceCents)} used` : undefined}
                    current={c.id === props.value}
                    chevron
                    onClick={() => choose(c)}
                  />
                ))}
              </List>
            </Section>
          );
        })}
      </div>
    </FormSheet>
  );
}

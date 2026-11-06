// A vehicle's specs (DESIGN §9.3): free label-and-value pairs ("Engine: 5.0L V8", "Seats: 5"), each a
// chip with ×, and a row to add one (Enter or Add). Play's Garage, GM → Things and Build's thing page
// share it; the caller keeps the list and saves it its own way.

import { useId, useState } from "preact/hooks";
import { specWords, VEHICLE_SPEC_TEXT_MAX, VEHICLE_SPECS_MAX, type VehicleSpec } from "../../shared/vehicles";
import { Chip } from "../build/form-kit";
import { Button } from "../components";

export function SpecsEditor(props: { value: readonly VehicleSpec[]; onChange(next: VehicleSpec[]): void; disabled?: boolean }) {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const inputId = useId();
  const full = props.value.length >= VEHICLE_SPECS_MAX;
  const ready = label.trim() !== "" && value.trim() !== "" && !full;
  const add = () => {
    if (!ready) return;
    props.onChange([...props.value, { label: label.trim(), value: value.trim() }]);
    setLabel("");
    setValue("");
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add();
  };
  return (
    <div class="lre-field lre-cp-textlist" data-lre-specs="">
      <label for={inputId}>Specs</label>
      {props.value.length > 0 ? (
        <div class="lre-form-chips" role="list" aria-label="Specs">
          {props.value.map((s, i) => (
            <span key={`${i}:${s.label}`} role="listitem">
              <Chip removeLabel={`Remove ${s.label}`} disabled={props.disabled} onRemove={() => props.onChange(props.value.filter((_, j) => j !== i))}>
                {specWords(s)}
              </Chip>
            </span>
          ))}
        </div>
      ) : (
        <span class="lre-cp-note">None yet.</span>
      )}
      <div class="lre-cp-textlist-add">
        <input id={inputId} class="lre-input" aria-label="Spec" placeholder="Engine" maxLength={VEHICLE_SPEC_TEXT_MAX} value={label} disabled={props.disabled || full} onInput={(event) => setLabel(event.currentTarget.value)} onKeyDown={onKeyDown} />
        <input class="lre-input" aria-label="Value" placeholder="5.0L V8" maxLength={VEHICLE_SPEC_TEXT_MAX} value={value} disabled={props.disabled || full} onInput={(event) => setValue(event.currentTarget.value)} onKeyDown={onKeyDown} />
        <Button size="sm" icon="plus" disabled={props.disabled || !ready} onClick={add}>
          Add
        </Button>
      </div>
      <span class="lre-field-help">{full ? `At most ${VEHICLE_SPECS_MAX} specs.` : "Anything worth knowing about it, a label and its value: Seats, 5."}</span>
    </div>
  );
}

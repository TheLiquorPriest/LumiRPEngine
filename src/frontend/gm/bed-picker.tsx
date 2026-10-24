// The GM entity sheet's bed picker (DESIGN §8): where a person sleeps, a place or an item (a bed,
// wherever it stands), as one GM edit with its Undo. Go to bed and their sleep blocks take them there.

import { useId } from "preact/hooks";
import type { GmEntity, GmView } from "../../shared/state-view";
import { Field } from "../components";
import type { Editor } from "./editor";

/** Whether a kind is an item, or one built on it, by the kinds the GM view lists. */
function isItemKind(kinds: GmView["kinds"], kind: string): boolean {
  let at: string | null = kind;
  for (let guard = 0; at !== null && guard < 32; guard++) {
    if (at === "item") return true;
    const id: string = at;
    at = kinds.find((k) => k.id === id)?.extends ?? null;
  }
  return false;
}

/** Shown for anyone with a bed field (a person): the bed as it stands, and a choice of places and items. */
export function BedPicker(props: { entity: GmEntity; editor: Editor }) {
  const { entity, editor } = props;
  const select = useId();
  const field = entity.fields.find((f) => f.id === "bed");
  if (!field) return null;
  const bed = typeof field.value === "string" ? field.value : "";
  const items = editor.gm.entities.filter((e) => e.id !== entity.id && isItemKind(editor.gm.kinds, e.kind));
  const set = (value: string) => void editor.edit([{ op: "set", entity: entity.id, field: "bed", value: value === "" ? null : value }]);
  return (
    <Field label="Bed" for={select} help="Where they sleep: Go to bed and their nights take them there. Without one, they sleep at home.">
      <select id={select} class="lre-input" value={bed} disabled={editor.busy} onChange={(event) => set(event.currentTarget.value)}>
        <option value="">No bed of their own</option>
        <optgroup label="Places">
          {editor.gm.places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
        {items.length > 0 ? (
          <optgroup label="Items">
            {items.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </Field>
  );
}

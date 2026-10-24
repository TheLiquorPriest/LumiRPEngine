// A list of text as chips (DESIGN §7, the Character model): a character's traits and any list-of-text
// field, never JSON. Type and press Enter (or Add) to add one; a chip's × removes it. A blank entry or
// one already there (in any case) adds nothing.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { Chip } from "../build/form-kit";
import { Button } from "../components";
import { withText } from "./places";

export function TextListEditor(props: { label: string; value: readonly string[]; onChange(next: string[]): void; placeholder?: string; help?: ComponentChildren; disabled?: boolean }) {
  const [text, setText] = useState("");
  const inputId = useId();
  const add = () => {
    const next = withText(props.value, text);
    setText("");
    if (next.length !== props.value.length) props.onChange(next);
  };
  return (
    <div class="lre-field lre-cp-textlist" data-lre-text-list={props.label}>
      <label for={inputId}>{props.label}</label>
      {props.value.length > 0 ? (
        <div class="lre-form-chips" role="list" aria-label={props.label}>
          {props.value.map((item, i) => (
            <span key={`${i}:${item}`} role="listitem">
              <Chip removeLabel={`Remove ${item}`} disabled={props.disabled} onRemove={() => props.onChange(props.value.filter((_, j) => j !== i))}>
                {item}
              </Chip>
            </span>
          ))}
        </div>
      ) : (
        <span class="lre-cp-note">None yet.</span>
      )}
      <div class="lre-cp-textlist-add">
        <input
          id={inputId}
          class="lre-input"
          placeholder={props.placeholder ?? "Add one"}
          value={text}
          disabled={props.disabled}
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
        <Button size="sm" icon="plus" disabled={props.disabled || text.trim() === ""} onClick={add}>
          Add
        </Button>
      </div>
      {props.help !== undefined ? <span class="lre-field-help">{props.help}</span> : null}
    </div>
  );
}

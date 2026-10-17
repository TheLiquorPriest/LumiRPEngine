// An effect's arguments (DESIGN §11, engine/scope "Effect arguments"): each one is a value, or a
// formula written with a leading `=` that the effect evaluates when it runs. Effect arguments are
// the one place `roll()` works, so their formulas use the expression editor's effect mode.

import { useEffect, useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { LintIssue } from "../../shared/protocol";
import { Seg } from "../components";
import { ExprEditor } from "./expr-editor";

/**
 * A value as typed: JSON when it reads as JSON (`2`, `true`, `null`, `"42"`, `{…}`, `[…]`), any
 * other text as itself (`self`, `might`). A leading `=` stays text: it is the formula form.
 */
export function parseArgText(text: string): JsonValue {
  const trimmed = text.trim();
  if (trimmed.startsWith("=")) return text;
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return text;
  }
}

/** The text a value is typed as, so that `parseArgText` reads it back unchanged: bare where it can be, JSON where it must. */
export function argText(value: JsonValue): string {
  if (typeof value === "string" && parseArgText(value) === value) return value;
  return isRecord(value) || Array.isArray(value) ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

function ValueInput(props: { name: string; value: JsonValue; onChange(value: JsonValue): void }) {
  const [text, setText] = useState(argText(props.value));
  useEffect(() => setText(argText(props.value)), [JSON.stringify(props.value)]);
  const structured = isRecord(props.value) || Array.isArray(props.value);
  const attrs = { class: "lre-input", spellcheck: false, "aria-label": `${props.name} value`, value: text, onBlur: () => props.onChange(parseArgText(text)) };
  return structured ? <textarea {...attrs} rows={Math.min(8, Math.max(2, text.split("\n").length))} onInput={(event) => setText(event.currentTarget.value)} /> : <input {...attrs} onInput={(event) => setText(event.currentTarget.value)} />;
}

export function EffectArgsInput(props: { label: string; value: JsonValue | undefined; identifiers: readonly string[]; functions: readonly string[]; lint: (path: string) => readonly LintIssue[]; path: string; onChange(value: JsonObject): void }) {
  const args: JsonObject = isRecord(props.value) ? (props.value as JsonObject) : {};
  const [name, setName] = useState("");
  const key = name.trim();
  const set = (arg: string, next: JsonValue) => props.onChange({ ...args, [arg]: next });
  return (
    <div class="lre-field" data-lre-effect-args>
      <span class="label">{props.label}</span>
      {Object.entries(args).map(([arg, value]) => {
        const formula = typeof value === "string" && value.startsWith("=");
        const issues = props.lint(`${props.path}.${arg}`);
        return (
          <div key={arg} class="lre-card lre-stack" style={{ padding: "6px 8px" }}>
            <div class="lre-spread">
              <code>{arg}</code>
              <span class="lre-inline">
                <Seg<"value" | "formula">
                  label={`${arg} is`}
                  value={formula ? "formula" : "value"}
                  options={[
                    { value: "value", label: "Value" },
                    { value: "formula", label: "Formula" },
                  ]}
                  onChange={(mode) => {
                    if (mode === "formula" && !formula) set(arg, `=${value === "" ? "" : argText(value)}`);
                    if (mode === "value" && formula) set(arg, parseArgText(value.slice(1)));
                  }}
                />
                <button
                  type="button"
                  class="lre-btn small ghost"
                  aria-label={`Remove argument ${arg}`}
                  onClick={() => {
                    const next = { ...args };
                    delete next[arg];
                    props.onChange(next);
                  }}
                >
                  ✕
                </button>
              </span>
            </div>
            {formula ? (
              <ExprEditor label={`${arg} (worked out when the effect runs)`} value={value.slice(1)} identifiers={props.identifiers} functions={props.functions} mode="effect" lint={issues} onChange={(text) => set(arg, `=${text}`)} />
            ) : (
              <>
                <ValueInput name={arg} value={value} onChange={(next) => set(arg, next)} />
                {issues.map((issue) => (
                  <span key={`${issue.path}:${issue.code}`} class={issue.severity === "error" ? "lre-small lre-neg" : "lre-small lre-warn"}>
                    {issue.message}
                  </span>
                ))}
              </>
            )}
          </div>
        );
      })}
      <form
        class="lre-inline"
        onSubmit={(event) => {
          event.preventDefault();
          if (!key || key in args) return;
          set(key, "");
          setName("");
        }}
      >
        <input class="lre-input" style={{ flex: 1 }} placeholder="Argument, e.g. field" aria-label="Argument name" value={name} onInput={(event) => setName(event.currentTarget.value.replace(/\s+/g, "_"))} />
        <button type="submit" class="lre-btn small" disabled={!key || key in args}>
          + Add
        </button>
      </form>
    </div>
  );
}

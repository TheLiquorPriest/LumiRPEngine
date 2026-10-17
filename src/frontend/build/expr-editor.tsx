// The expression editor (DESIGN §13 special widget): a monospace input with operator and function
// buttons, identifier suggestions from the world, a bracket and quote balance check, and the
// backend's lint for this field. Parsing and evaluation stay in the engine; the backend lints.

import { useRef, useState } from "preact/hooks";
import type { LintIssue } from "../../shared/protocol";

const OPERATORS = ["+", "-", "*", "/", "%", "==", "!=", "<", "<=", ">", ">=", "and", "or", "not", "(", ")", "?", ":"];
/** Query and formula names the engine and packs register (DESIGN §9.2 level contract). */
const FUNCTIONS = ["min(", "max(", "abs(", "round(", "floor(", "clamp(", "roll(", "wealth(", "can_afford(", "has_item(", "fuel_ok(", "regard_band(", "knows(", "stage(", "at(", "now()"];

export interface Balance {
  ok: boolean;
  message: string | null;
}

/** Bracket and string balance only; real parse errors come from the backend lint. */
export function checkBalance(text: string): Balance {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== pairs[ch]) return { ok: false, message: `Unexpected ${ch} at ${i + 1}` };
    }
  }
  if (quote) return { ok: false, message: "Unclosed string" };
  if (stack.length > 0) return { ok: false, message: `${stack.length} unclosed ${stack.at(-1)}` };
  return { ok: true, message: null };
}

export function ExprEditor(props: { label: string; value: string; identifiers: readonly string[]; lint: readonly LintIssue[]; optional?: boolean; onChange(value: string): void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [tools, setTools] = useState(false);
  const balance = checkBalance(props.value);
  const word = /[A-Za-z_][\w.]*$/.exec(props.value)?.[0] ?? "";
  const suggestions = word.length >= 1 ? props.identifiers.filter((id) => id.startsWith(word) && id !== word).slice(0, 8) : [];
  const insert = (text: string, replace = 0) => {
    const el = input.current;
    const start = el?.selectionStart ?? props.value.length;
    const end = el?.selectionEnd ?? props.value.length;
    const before = props.value.slice(0, start - replace);
    const spaced = /^[a-z]+$/.test(text) ? ` ${text} ` : text;
    props.onChange(before + spaced + props.value.slice(end));
    queueMicrotask(() => {
      el?.focus();
      const caret = before.length + spaced.length;
      el?.setSelectionRange(caret, caret);
    });
  };
  return (
    <div class="lre-field" data-lre-expr>
      <span class="label lre-spread">
        <span>
          {props.label}
          {props.optional ? " (optional)" : ""}
        </span>
        <button type="button" class="lre-btn small ghost" aria-label="Operators and functions" aria-expanded={tools} onClick={() => setTools(!tools)}>
          <span aria-hidden="true">ƒx</span>
        </button>
      </span>
      <textarea ref={input} class={balance.ok && props.lint.length === 0 ? "lre-input" : "lre-input invalid"} rows={2} spellcheck={false} aria-label={props.label} value={props.value} onInput={(event) => props.onChange(event.currentTarget.value)} />
      {suggestions.length > 0 ? (
        <div class="lre-expr-tools">
          {suggestions.map((id) => (
            <button key={id} type="button" onClick={() => insert(id, word.length)}>
              {id}
            </button>
          ))}
        </div>
      ) : null}
      {tools ? (
        <div class="lre-expr-tools">
          {[...OPERATORS, ...FUNCTIONS].map((token) => (
            <button key={token} type="button" onClick={() => insert(token)}>
              {token}
            </button>
          ))}
        </div>
      ) : null}
      {balance.message ? <span class="lre-small lre-neg">{balance.message}</span> : null}
      {props.lint.map((issue) => (
        <span key={`${issue.code}:${issue.message}`} class={issue.severity === "error" ? "lre-small lre-neg" : "lre-small lre-warn"}>
          {issue.message}
        </span>
      ))}
    </div>
  );
}

// The expression editor (DESIGN §13 special widget): a monospace input with operator and function
// buttons, identifier and function suggestions, a bracket and quote balance check, and the
// backend's lint for this field. Parsing and evaluation stay in the engine; the backend lints.
// The functions are the backend's own list (`lre.world get` `functions`: the math built-ins, the
// engine's and the registered packs' formulas), so the editor never offers a name the engine lacks.

import { useRef, useState } from "preact/hooks";
import type { LintIssue } from "../../shared/protocol";
import { EFFECT_ONLY_FUNCTIONS } from "../../shared/world";

const OPERATORS = ["+", "-", "*", "/", "%", "==", "!=", "<", "<=", ">", ">=", "and", "or", "not", "(", ")", "?", ":"];

/**
 * Where an expression sits: a `formula` (a modifier, requirement, derived field, rule condition or
 * sheet row) or an `effect` argument, the only place `roll()` and the other effect-only functions
 * work (DESIGN §11).
 */
export type ExprMode = "formula" | "effect";

/** The function names the editor offers in a mode: the backend's list, plus the effect-only ones in an effect argument. */
export function exprFunctions(functions: readonly string[], mode: ExprMode): string[] {
  const names = new Set(functions);
  for (const name of EFFECT_ONLY_FUNCTIONS) {
    if (mode === "effect") names.add(name);
    else names.delete(name);
  }
  return [...names].sort();
}

/** Suggestions for the word being typed: identifiers that extend it, then functions (as `name(`) that do. */
export function exprCompletions(word: string, identifiers: readonly string[], functions: readonly string[]): string[] {
  if (word === "") return [];
  const ids = identifiers.filter((id) => id.startsWith(word) && id !== word);
  const calls = functions.filter((name) => name.startsWith(word)).map((name) => `${name}(`);
  return [...ids, ...calls].slice(0, 8);
}

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

export function ExprEditor(props: { label: string; value: string; identifiers: readonly string[]; functions: readonly string[]; mode?: ExprMode; lint: readonly LintIssue[]; optional?: boolean; onChange(value: string): void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [tools, setTools] = useState(false);
  const balance = checkBalance(props.value);
  const functions = exprFunctions(props.functions, props.mode ?? "formula");
  const word = /[A-Za-z_][\w.]*$/.exec(props.value)?.[0] ?? "";
  const suggestions = exprCompletions(word, props.identifiers, functions);
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
          {[...OPERATORS, ...functions.map((name) => `${name}(`)].map((token) => (
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

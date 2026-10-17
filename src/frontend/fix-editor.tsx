// The ✎ fix editor (DESIGN §12): edits one FixTarget and sends `lre.fix`, a `post` entry of kind
// `fix` on the head. The input follows the target's field type; options win when present. Money is
// typed in the world's currency (the shared money input).

import { useState } from "preact/hooks";
import type { JsonValue } from "../shared/json";
import { formatMoneyInput, parseMoneyInput } from "../shared/money";
import type { FixTarget } from "../shared/state-view";
import { DEFAULT_CURRENCY, type WorldCurrency } from "../shared/world";
import { useApp, useView } from "./app";
import { useBusy } from "./components";
import { MoneyInput } from "./money-input";
import { fixRequest } from "./requests";

function initialText(target: FixTarget, currency: WorldCurrency): string {
  if (target.type === "money" && typeof target.value === "number") return formatMoneyInput(target.value, currency);
  if (target.value === null || target.value === undefined) return "";
  return typeof target.value === "string" ? target.value : JSON.stringify(target.value);
}

/** Parses the typed text for the target's field type (money in `currency`); null when it doesn't parse or is out of range. */
export function parseFixValue(target: FixTarget, text: string, currency: WorldCurrency): JsonValue | null {
  const trimmed = text.trim();
  if (target.type === "money") {
    const cents = parseMoneyInput(trimmed, currency);
    if (cents === null || (target.min !== undefined && cents < target.min) || (target.max !== undefined && cents > target.max)) return null;
    return cents;
  }
  if (target.type === "number" || target.type === "duration") {
    if (trimmed === "" || !Number.isFinite(Number(trimmed))) return null;
    const value = Number(trimmed);
    if ((target.min !== undefined && value < target.min) || (target.max !== undefined && value > target.max)) return null;
    return value;
  }
  if (target.type === "bool") return trimmed === "true" ? true : trimmed === "false" ? false : null;
  if (target.type === "list") {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return Array.isArray(parsed) ? (parsed as JsonValue[]) : null;
    } catch {
      return null;
    }
  }
  return trimmed;
}

export function FixEditor(props: { label: string; target: FixTarget; onDone(): void }) {
  const app = useApp();
  const view = useView();
  const { target } = props;
  const currency = view?.currency ?? DEFAULT_CURRENCY;
  const [text, setText] = useState(() => initialText(target, currency));
  const [busy, run] = useBusy();
  const chatId = view?.chatId;
  if (!chatId) return null;
  const save = (value: JsonValue) =>
    run(async () => {
      const result = await app.request(fixRequest(target, value, chatId));
      if (result) {
        if (result.pending) app.toast("Fix saved — it applies when the reply finishes.", "info");
        props.onDone();
      }
    });
  if (target.options && target.options.length > 0) {
    return (
      <div class="lre-stack" data-lre-fix={target.field}>
        <div class="lre-small lre-muted">
          <span aria-hidden="true">✎</span> Fix {props.label.toLowerCase()}
        </div>
        <div class="lre-list">
          {target.options.map((option) => (
            <button key={JSON.stringify(option.value)} type="button" class="lre-item" aria-current={JSON.stringify(option.value) === JSON.stringify(target.value)} disabled={busy} onClick={() => save(option.value)}>
              <span class="grow">{option.label}</span>
            </button>
          ))}
        </div>
        <button type="button" class="lre-btn ghost" onClick={props.onDone}>
          Cancel
        </button>
      </div>
    );
  }
  const parsed = parseFixValue(target, text, currency);
  return (
    <form
      class="lre-stack"
      data-lre-fix={target.field}
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed !== null) save(parsed);
      }}
    >
      <label class="lre-field">
        <span class="label">
          <span aria-hidden="true">✎</span> Fix {props.label.toLowerCase()}
        </span>
        {target.type === "bool" ? (
          <select class="lre-input" value={text} onChange={(event) => setText(event.currentTarget.value)}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : target.type === "money" ? (
          <MoneyInput currency={currency} value={text} onInput={setText} label={`Fix ${props.label.toLowerCase()}`} invalid={parsed === null} />
        ) : (
          <input
            class={parsed === null ? "lre-input invalid" : "lre-input"}
            inputMode={target.type === "number" || target.type === "duration" ? "decimal" : "text"}
            value={text}
            onInput={(event) => setText(event.currentTarget.value)}
          />
        )}
      </label>
      <div class="lre-inline">
        <button type="submit" class="lre-btn primary" disabled={busy || parsed === null}>
          Save fix
        </button>
        <button type="button" class="lre-btn ghost" onClick={props.onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

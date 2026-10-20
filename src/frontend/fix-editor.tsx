// The ✎ fix editor (DESIGN §12): edits one FixTarget and sends `lre.fix`, a `post` entry of kind
// `fix` on the head. The input follows the target's field type; options win when present. Money is
// typed in the world's currency (the shared money input). A value that doesn't read says what would;
// Escape cancels the fix without closing the sheet around it.

import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { JsonValue } from "../shared/json";
import { formatMoneyInput, parseMoneyInput } from "../shared/money";
import type { FixTarget } from "../shared/state-view";
import { DEFAULT_CURRENCY, formatMoney, type WorldCurrency } from "../shared/world";
import { useApp, useView } from "./app";
import { Button, Field, useBusy } from "./components";
import { Icon } from "./icons";
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

/** What the target takes, for the line under an input whose text doesn't read. */
function expected(target: FixTarget, currency: WorldCurrency): string {
  const show = (n: number) => (target.type === "money" ? formatMoney(n, currency) : String(n));
  const span = target.min !== undefined && target.max !== undefined ? ` from ${show(target.min)} to ${show(target.max)}` : target.min !== undefined ? ` of at least ${show(target.min)}` : target.max !== undefined ? ` of at most ${show(target.max)}` : "";
  if (target.type === "money") return `Enter an amount${span}.`;
  if (target.type === "number" || target.type === "duration") return `Enter a number${span}.`;
  return 'Enter a list, like ["a", "b"].';
}

export function FixEditor(props: { label: string; target: FixTarget; onDone(): void }) {
  const app = useApp();
  const view = useView();
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const { target } = props;
  const currency = view?.currency ?? DEFAULT_CURRENCY;
  const [text, setText] = useState(() => initialText(target, currency));
  const [busy, run] = useBusy();
  // The ✎ that opened the editor made way for it: focus moves in, to the value now (else the first
  // choice) or to the input, so typing, Escape and the tab order start here.
  useEffect(() => {
    const into = list.current?.querySelector<HTMLElement>('[aria-current="true"]') ?? list.current?.querySelector<HTMLElement>("button") ?? form.current?.querySelector<HTMLElement>("input, select");
    into?.focus();
  }, []);
  const chatId = view?.chatId;
  if (!chatId) return null;
  const title = `Fix ${props.label.toLowerCase()}`;
  const save = (value: JsonValue) =>
    run(async () => {
      const result = await app.request(fixRequest(target, value, chatId));
      if (result) {
        if (result.pending) app.toast("Fix saved — it applies when the reply finishes.", "info");
        props.onDone();
      }
    });
  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    props.onDone();
  };
  if (target.options && target.options.length > 0) {
    const now = JSON.stringify(target.value);
    return (
      <div ref={list} class="lre-chat-fix" data-lre-fix={target.field} role="group" aria-label={title} onKeyDown={cancelOnEscape}>
        <div class="lre-chat-fix-head">
          <Icon name="edit" size={16} />
          {title}
        </div>
        <div class="lre-list">
          {target.options.map((option) => {
            const current = JSON.stringify(option.value) === now;
            return (
              <button key={JSON.stringify(option.value)} type="button" class="lre-item" aria-current={current} disabled={busy} onClick={() => save(option.value)}>
                <span class="grow">{option.label}</span>
                {current ? <Icon name="check" size={16} label="Now" /> : null}
              </button>
            );
          })}
        </div>
        <div class="lre-chat-actions">
          <Button variant="ghost" size="sm" onClick={props.onDone}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  const parsed = parseFixValue(target, text, currency);
  const label = (
    <span class="lre-chat-fix-head">
      <Icon name="edit" size={16} />
      {title}
    </span>
  );
  return (
    <form
      ref={form}
      class="lre-chat-fix"
      data-lre-fix={target.field}
      onKeyDown={cancelOnEscape}
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed !== null) save(parsed);
      }}
    >
      <Field label={label} for={target.type === "money" ? undefined : id} error={parsed === null && text.trim() !== "" ? expected(target, currency) : null}>
        {target.type === "bool" ? (
          <select id={id} class="lre-input" value={text} onChange={(event) => setText(event.currentTarget.value)}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : target.type === "money" ? (
          <MoneyInput currency={currency} value={text} onInput={setText} label={title} invalid={parsed === null} />
        ) : (
          <input
            id={id}
            class={parsed === null ? "lre-input invalid" : "lre-input"}
            inputMode={target.type === "number" || target.type === "duration" ? "decimal" : "text"}
            aria-invalid={parsed === null || undefined}
            value={text}
            onInput={(event) => setText(event.currentTarget.value)}
          />
        )}
      </Field>
      <div class="lre-chat-actions">
        <Button type="submit" variant="primary" size="sm" icon="check" busy={busy} disabled={parsed === null}>
          Save fix
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

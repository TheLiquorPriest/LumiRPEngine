// The ✎ fix editor (DESIGN §12): edits one FixTarget and sends `lre.fix`, a `post` entry of kind
// `fix` on the head. A field's input follows its type; options win when present. Money is typed in
// the world's currency (the shared money input). The clock takes a date and a time of day in the
// world's calendar. A value that doesn't read says what would; Escape cancels the fix without
// closing the sheet around it.

import type { Ref } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { JsonValue } from "../shared/json";
import { formatMoneyInput, parseMoneyInput } from "../shared/money";
import type { FieldFixTarget, FixTarget, TimeFixTarget } from "../shared/state-view";
import { DEFAULT_CURRENCY, formatMoney, type WorldCurrency } from "../shared/world";
import { useApp, useView } from "./app";
import { Button, Field, useBusy } from "./components";
import { Icon } from "./icons";
import { MoneyInput } from "./money-input";
import { fixRequest, timeFixRequest, type Req } from "./requests";

function initialText(target: FixTarget, currency: WorldCurrency): string {
  if (target.type === "money" && typeof target.value === "number") return formatMoneyInput(target.value, currency);
  if (target.value === null || target.value === undefined) return "";
  return typeof target.value === "string" ? target.value : JSON.stringify(target.value);
}

/** Parses the typed text for the target's field type (money in `currency`); null when it doesn't parse or is out of range. */
export function parseFixValue(target: FieldFixTarget, text: string, currency: WorldCurrency): JsonValue | null {
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
function expected(target: FieldFixTarget, currency: WorldCurrency): string {
  const show = (n: number) => (target.type === "money" ? formatMoney(n, currency) : String(n));
  const span = target.min !== undefined && target.max !== undefined ? ` from ${show(target.min)} to ${show(target.max)}` : target.min !== undefined ? ` of at least ${show(target.min)}` : target.max !== undefined ? ` of at most ${show(target.max)}` : "";
  if (target.type === "money") return `Enter an amount${span}.`;
  if (target.type === "number" || target.type === "duration") return `Enter a number${span}.`;
  return 'Enter a list, like ["a", "b"].';
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Whether a Gregorian year has a 29 February. */
function leapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * What the clock's ✎ reads from its date and its time of day (DESIGN §12): the date and time it
 * sends (`YYYY-MM-DD HH:MM` in the world's calendar) with the date in the calendar's words, or, for
 * each of the two that doesn't read, what would.
 */
export function readTimeFix(target: TimeFixTarget, date: string, time: string): { stamp: string; words: string } | { date: string | null; time: string | null } {
  const d = /^\s*(-?\d{1,6})-(\d{1,2})-(\d{1,2})\s*$/.exec(date);
  const year = Number(d?.[1]);
  const month = Number(d?.[2]);
  const day = Number(d?.[3]);
  const named = d ? target.months[month - 1] : undefined;
  const february = target.gregorian && month === 2;
  const days = !named ? 0 : february && !leapYear(year) ? 28 : named.days;
  const now = target.value.split(" ")[0] ?? "";
  const dateProblem = !d ? `Enter a date as year-month-day, like ${now}.` : !named ? `Enter a month from 1 to ${target.months.length}.` : day < 1 || day > days ? `${named.name}${february ? ` ${year}` : ""} has ${days} days.` : null;
  const t = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(time);
  const hour = Number(t?.[1]);
  const minute = Number(t?.[2]);
  const timeProblem = t && hour <= 23 && minute <= 59 ? null : "Enter a time of day from 00:00 to 23:59.";
  if (dateProblem !== null || timeProblem !== null || !named) return { date: dateProblem, time: timeProblem };
  return { stamp: `${year < 0 ? "-" : ""}${String(Math.abs(year)).padStart(4, "0")}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}`, words: `${day} ${named.name} ${year}, ${pad2(hour)}:${pad2(minute)}` };
}

/** The clock's ✎ form (DESIGN §12): a date and a time of day in the world's calendar, where the POV is, starting from now. */
function TimeFixForm(props: { title: string; target: TimeFixTarget; busy: boolean; formRef: Ref<HTMLFormElement>; onSave(time: string): void; onCancel(): void; onKeyDown(event: KeyboardEvent): void }) {
  const dateId = useId();
  const timeId = useId();
  const [nowDate = "", nowTime = ""] = props.target.value.split(" ");
  const [date, setDate] = useState(nowDate);
  const [time, setTime] = useState(nowTime);
  const read = readTimeFix(props.target, date, time);
  const problems = "stamp" in read ? { date: null, time: null } : read;
  return (
    <form
      ref={props.formRef}
      class="lre-chat-fix"
      data-lre-fix="time"
      onKeyDown={props.onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        if ("stamp" in read) props.onSave(read.stamp);
      }}
    >
      <span class="lre-chat-fix-head">
        <Icon name="edit" size={16} />
        {props.title}
      </span>
      <div class="lre-chat-fix-when">
        <Field label="Date" for={dateId} help={"words" in read ? read.words : undefined} error={problems.date}>
          {/* A date picker reads only Gregorian dates; another calendar's date is typed in its own months. */}
          {props.target.gregorian ? (
            <input id={dateId} type="date" class={problems.date ? "lre-input invalid" : "lre-input"} aria-invalid={problems.date ? true : undefined} value={date} onInput={(event) => setDate(event.currentTarget.value)} />
          ) : (
            <input id={dateId} class={problems.date ? "lre-input invalid" : "lre-input"} aria-invalid={problems.date ? true : undefined} value={date} onInput={(event) => setDate(event.currentTarget.value)} />
          )}
        </Field>
        <Field label="Time" for={timeId} error={problems.time}>
          <input id={timeId} type="time" class={problems.time ? "lre-input invalid" : "lre-input"} aria-invalid={problems.time ? true : undefined} value={time} onInput={(event) => setTime(event.currentTarget.value)} />
        </Field>
      </div>
      <div class="lre-chat-actions">
        <Button type="submit" variant="primary" size="sm" icon="check" busy={props.busy} disabled={!("stamp" in read)}>
          Save fix
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
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
  const send = (request: Req<"lre.fix">) =>
    run(async () => {
      const result = await app.request(request);
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
  if (target.type === "time") return <TimeFixForm title={title} target={target} busy={busy} formRef={form} onSave={(time) => send(timeFixRequest(time, chatId))} onCancel={props.onDone} onKeyDown={cancelOnEscape} />;
  const save = (value: JsonValue) => send(fixRequest(target, value, chatId));
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

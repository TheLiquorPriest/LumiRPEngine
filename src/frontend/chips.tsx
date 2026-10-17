// Chips under each message (DESIGN §11, §12), rendered by a DOM decorator on `message_body_after`.
// A pack can override a kind's rendering through `UiRegistry.chip`; everything else uses the
// default chip, whose buttons send exactly the request `chipRequest` builds. An action that asks for
// a value first (an amount, a catalog item) opens a small form in the chip.

import { useState } from "preact/hooks";
import type { ChatId, MessageId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import type { KeepLine } from "../shared/ledger";
import { formatMoneyInput, parseMoneyInput } from "../shared/money";
import type { Chip, ChipAction, ChipInput, ChipKind } from "../shared/state-view";
import { DEFAULT_CURRENCY, type WorldCurrency } from "../shared/world";
import { useApp, useView } from "./app";
import { useBusy } from "./components";
import { MoneyInput } from "./money-input";
import type { ChipProps } from "./registry";
import { chipIntent, convertRequest } from "./requests";

const CHIP_ICON: Record<ChipKind, string> = {
  change: "✦",
  elapsed: "⏱",
  roll: "🎲",
  price: "💳",
  confirm: "❓",
  decline: "⛔",
  undo: "↺",
  retry_read: "↻",
  not_action: "💬",
  swipe_option: "⇄",
  overdue: "⏰",
  timelapse_offer: "⏩",
  continue_timelapse: "⏩",
  retry_timelapse: "↻",
  keep_report: "⚑",
  reread: "👁",
  retry: "↻",
  degraded: "⚠",
  pending: "⋯",
  mode_change: "⚙",
  choice: "➜",
  contradiction: "≠",
  read_failed: "⚠",
};

/** Matches the decorator scope `message:<id>:…` (dom-decorator-service scope templates). */
export function messageIdFromScope(scope: string): MessageId | null {
  const match = /^message:([^:]+):/.exec(scope);
  return match?.[1] ?? null;
}

export function MessageChips(props: { messageId: MessageId }) {
  const app = useApp();
  const view = useView();
  if (!view || view.status === "not_world") return null;
  const chips = view.chips.filter((chip) => chip.messageId === props.messageId);
  if (chips.length === 0) return null;
  return (
    <div class="lre-chips" data-lre-chips={props.messageId}>
      {chips.map((chip) => {
        const Custom = app.catalog.chips.get(chip.kind);
        if (Custom) return <Custom key={chip.id} chip={chip} chatId={view.chatId} send={app.send} />;
        if (chip.kind === "keep_report") return <KeepReportChip key={chip.id} chip={chip} chatId={view.chatId} send={app.send} />;
        return <DefaultChip key={chip.id} chip={chip} chatId={view.chatId} send={app.send} />;
      })}
    </div>
  );
}

function useChipAction(chip: Chip, chatId: ChatId): [boolean, (choice: string, payload?: JsonObject) => void] {
  const app = useApp();
  const [busy, run] = useBusy();
  return [
    busy,
    (choice, payload) =>
      run(async () => {
        const intent = chipIntent(chip, choice, chatId, payload);
        if (intent.request) {
          const message = await app.send(intent.request);
          if (message.type === "lre.error") {
            app.toast(message.message, "error");
            return;
          }
          if (message.request === "lre.chip" && message.body.pending && !intent.regenerate) app.toast("Saved — it applies when the reply finishes.", "info");
        }
        if (intent.regenerate && !(await app.host.regenerate())) app.toast("Couldn't start Regenerate here; use the message's Regenerate button.", "error");
      }),
  ];
}

/** The small form an action with an input opens: an amount in the world's currency, or one of its options; Apply sends it as the chip's payload. */
function ChipInputForm(props: { action: ChipAction; input: ChipInput; currency: WorldCurrency; busy: boolean; onSend(payload: JsonObject): void; onCancel(): void }) {
  const { input } = props;
  const [text, setText] = useState(() => (input.type === "money" && input.value !== undefined ? formatMoneyInput(input.value, props.currency) : ""));
  const [picked, setPicked] = useState(() => (input.type === "choice" ? (input.options[0]?.value ?? "") : ""));
  const cents = input.type === "money" ? parseMoneyInput(text, props.currency) : null;
  const ok = input.type === "money" ? cents !== null && cents > 0 : picked !== "";
  return (
    <form
      class="lre-chip-form"
      data-lre-chip-input={props.action.id}
      onSubmit={(event) => {
        event.preventDefault();
        if (ok) props.onSend(input.type === "money" ? { cents } : { value: picked });
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onCancel();
      }}
    >
      {input.type === "money" ? (
        <MoneyInput currency={props.currency} value={text} onInput={setText} label={input.label} invalid={text.trim() !== "" && !ok} autoFocus />
      ) : (
        <select class="lre-input" aria-label={input.label} value={picked} onChange={(event) => setPicked(event.currentTarget.value)}>
          {input.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      <button type="submit" class="primary" disabled={props.busy || !ok}>
        Apply
      </button>
      <button type="button" disabled={props.busy} onClick={props.onCancel}>
        Cancel
      </button>
    </form>
  );
}

export function DefaultChip(props: ChipProps) {
  const { chip } = props;
  const view = useView();
  const [busy, choose] = useChipAction(chip, props.chatId);
  const [asking, setAsking] = useState<string | null>(null);
  const info = chip.actions.length === 0;
  const open = chip.actions.find((action) => action.id === asking);
  return (
    <div class={`lre-chip${info ? " info" : ""}${busy ? " busy" : ""}`} data-kind={chip.kind} title={chip.detail}>
      <span class="lab">
        <span aria-hidden="true">{CHIP_ICON[chip.kind]} </span>
        {chip.label}
        {chip.detail ? <span class="det"> · {chip.detail}</span> : null}
      </span>
      {chip.actions.map((action) => (
        <button key={action.id} type="button" class={action.style} disabled={busy} aria-expanded={action.input ? asking === action.id : undefined} onClick={() => (action.input ? setAsking(asking === action.id ? null : action.id) : choose(action.id))}>
          {action.label}
        </button>
      ))}
      {open?.input ? <ChipInputForm key={open.id} action={open} input={open.input} currency={view?.currency ?? DEFAULT_CURRENCY} busy={busy} onSend={(payload) => choose(open.id, payload)} onCancel={() => setAsking(null)} /> : null}
    </div>
  );
}

const KEEP_STATUS: Record<KeepLine["status"], string> = {
  dropped: "no longer valid here",
  inert: "made on another branch",
  converted: "kept",
};

/**
 * Keep report rows. An event group (a payment with its history line and item) drops and converts
 * as one unit, so its members show as one row with their count; lines outside a group merge when
 * they read the same. Converting a row's line converts its whole group.
 */
export function keepRows(lines: readonly KeepLine[]): { line: KeepLine; count: number }[] {
  const rows: { key: string; line: KeepLine; count: number }[] = [];
  for (const line of lines) {
    const key = `${line.messageId}\u0000${line.status}\u0000${line.group !== undefined ? `g:${line.group}` : `t:${line.text}`}`;
    const row = rows.find((r) => r.key === key);
    if (row) row.count += 1;
    else rows.push({ key, line, count: 1 });
  }
  return rows.map(({ line, count }) => ({ line, count }));
}

/** The Keep report (DESIGN §4.3): convert per entry, Keep, and one-tap Discard. */
export function KeepReportChip(props: ChipProps) {
  const app = useApp();
  const view = useView();
  const { chip } = props;
  const [busy, choose] = useChipAction(chip, props.chatId);
  const [converting, runConvert] = useBusy();
  const lines = keepRows(view?.keepReport ?? []);
  return (
    <div class="lre-keep" data-kind="keep_report">
      <div class="lre-spread">
        <strong>
          <span aria-hidden="true">{CHIP_ICON.keep_report}</span> {chip.label}
        </strong>
        <span class="lre-badge warn">{lines.length} entr{lines.length === 1 ? "y" : "ies"}</span>
      </div>
      {chip.detail ? <div class="lre-small lre-muted">{chip.detail}</div> : null}
      {lines.map(({ line, count }) => {
        const convert = convertRequest(line, props.chatId);
        const key = "marker" in line.ref ? `${line.messageId}:m${line.ref.marker}` : `${line.messageId}:${line.ref.in}:${"seq" in line.ref ? line.ref.seq : 0}:${line.ref.index}`;
        return (
          <div class="lre-row" key={key}>
            <span class="k">
              {line.text}
              <span class="sub">
                {KEEP_STATUS[line.status]}
                {count > 1 ? ` · ${count} linked changes` : ""}
              </span>
            </span>
            {convert && line.status !== "converted" ? (
              <button
                type="button"
                class="lre-btn small"
                disabled={converting}
                onClick={() =>
                  runConvert(async () => {
                    await app.request(convert);
                  })
                }
              >
                Convert
              </button>
            ) : null}
          </div>
        );
      })}
      <div class="lre-inline" style={{ marginTop: "6px" }}>
        {chip.actions.map((action) => (
          <button key={action.id} type="button" class={`lre-btn small ${action.id === "discard" ? "danger" : action.style ?? ""}`} disabled={busy} onClick={() => choose(action.id)}>
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}


// Chips under each reply (DESIGN §11, §12), rendered by a DOM decorator on
// `message_body_after`: one quiet receipt line for what the turn did (its `done` chips), a card for
// each decision the player owes, and compact offers. Nothing is dropped: the receipt opens to the full
// list, where every chip shows with its own buttons. A pack can override a kind's rendering through
// `UiRegistry.chip`; its component replaces the default wherever that chip shows. Buttons send exactly
// the request `chipIntent` builds; an action that asks for a value first (an amount, a catalog item)
// opens a small form in the chip.

import type { ComponentChildren, ComponentType } from "preact";
import { Fragment } from "preact";
import { useId, useState } from "preact/hooks";
import type { ChatId, MessageId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import type { KeepLine } from "../shared/ledger";
import { formatMoneyInput, parseMoneyInput } from "../shared/money";
import type { Chip, ChipAction, ChipInput, ChipKind } from "../shared/state-view";
import { DEFAULT_CURRENCY, type WorldCurrency } from "../shared/world";
import { type App, useApp, useView } from "./app";
import { chipRole, chipTone } from "./chip-roles";
import { Badge, Button, Field, useBusy } from "./components";
import { openDiagnostics } from "./diagnostics";
import type { IconName } from "./icons";
import { Icon } from "./icons";
import { MoneyInput } from "./money-input";
import type { ChipProps } from "./registry";
import { chipIntent, convertRequest } from "./requests";

const CHIP_ICON: Record<ChipKind, IconName> = {
  change: "check",
  elapsed: "clock",
  roll: "dice",
  price: "card",
  confirm: "help",
  decline: "alert",
  undo: "undo",
  retry_read: "refresh",
  not_action: "message",
  swipe_option: "refresh",
  overdue: "calendar",
  timelapse_offer: "fast-forward",
  continue_timelapse: "fast-forward",
  keep_report: "flag",
  reread: "eye",
  retry: "refresh",
  degraded: "alert",
  pending: "hourglass",
  mode_change: "gear",
  choice: "send",
  contradiction: "info",
  read_failed: "alert",
  engine_failed: "alert",
  claim: "help",
  check: "dice",
  claimed: "sparkle",
  routine_ask: "calendar",
  routine_added: "calendar",
  fix: "edit",
  refused: "alert",
  intent_gate: "pause",
  outline_gate: "list",
};

/** Icons for the actions players reach for most; every button keeps its words. */
const ACTION_ICON: Partial<Record<string, IconName>> = { undo: "undo", regenerate: "refresh", rerun: "refresh", send: "send", timelapse: "fast-forward", play: "play", edit: "edit" };

/**
 * The receipt's order: what went wrong first, so it never hides behind "n more";
 * then time, money, the roll, the changes and how the message was read.
 */
const RECEIPT_ORDER: readonly ChipKind[] = ["decline", "degraded", "pending", "elapsed", "price", "undo", "roll", "change", "not_action", "fix", "mode_change"];

/** Segments the receipt line shows before "n more". */
const RECEIPT_SEGMENTS = 3;

/** A reply's `done` chips in receipt order, the few the line shows, and how many more its full list holds. */
export function receiptLine(done: readonly Chip[]): { sorted: Chip[]; shown: Chip[]; more: number } {
  const rank = (chip: Chip) => {
    const at = RECEIPT_ORDER.indexOf(chip.kind);
    return at < 0 ? RECEIPT_ORDER.length : at;
  };
  const sorted = [...done].sort((a, b) => rank(a) - rank(b));
  return { sorted, shown: sorted.slice(0, RECEIPT_SEGMENTS), more: Math.max(0, sorted.length - RECEIPT_SEGMENTS) };
}

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
  const when = view.replyClocks[props.messageId];
  if (chips.length === 0 && when === undefined) return null;
  // A pack's rendering for a kind replaces the default wherever that chip shows.
  const show = (chip: Chip, fallback: ComponentType<ChipProps>) => {
    const Chosen = app.catalog.chips.get(chip.kind) ?? fallback;
    return <Chosen key={chip.id} chip={chip} chatId={view.chatId} send={app.send} />;
  };
  const done = chips.filter((chip) => chipRole(chip) === "done");
  const offers = chips.filter((chip) => chipRole(chip) === "offer");
  return (
    <div class="lre-chips" data-lre-chips={props.messageId}>
      {when !== undefined ? (
        <span class="lre-chat-when lre-small lre-muted" data-lre-reply-clock>
          <span class="lre-sr">World time after this turn: </span>
          {when}
        </span>
      ) : null}
      {done.length > 0 ? <Receipt chips={done} show={(chip) => show(chip, DefaultChip)} /> : null}
      {chips.filter((chip) => chipRole(chip) === "decision").map((chip) => show(chip, chip.kind === "keep_report" ? KeepReportChip : DecisionCard))}
      {offers.length > 0 ? <div class="lre-chat-offers">{offers.map((chip) => show(chip, OfferChip))}</div> : null}
    </div>
  );
}

/** One quiet line for what the turn did; a tap opens the full list, each chip with its own buttons. */
function Receipt(props: { chips: readonly Chip[]; show(chip: Chip): ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { sorted, shown, more } = receiptLine(props.chips);
  return (
    <div class="lre-chat-receipt">
      <button type="button" class="lre-chat-receipt-line" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(!open)}>
        <span class="lre-sr">What this turn did: </span>
        <span class="lre-chat-segs">
          {shown.map((chip, index) => {
            const tone = chipTone(chip);
            return (
              <Fragment key={chip.id}>
                {index > 0 ? (
                  <span class="lre-chat-dot" aria-hidden="true">
                    ·
                  </span>
                ) : null}
                <span class="lre-chat-seg" data-tone={tone}>
                  {tone === "neutral" ? null : <Icon name="alert" size={14} />}
                  <span class="lre-chat-seg-text">{chip.kind === "not_action" ? "Read as an action" : chip.label}</span>
                </span>
              </Fragment>
            );
          })}
          {more > 0 ? (
            <>
              <span class="lre-chat-dot" aria-hidden="true">
                ·
              </span>
              <span class="lre-chat-seg more">{more} more</span>
            </>
          ) : null}
        </span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} class="lre-chat-chev" />
      </button>
      {open ? (
        <div id={listId} class="lre-chat-receipt-list">
          {sorted.map((chip) => props.show(chip))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Sends a chip's choice as the player made it (with any payload), then Regenerates when the choice
 * is finished by a new swipe. False when the engine refused it, which the player is told.
 */
export async function sendChipChoice(app: App, chip: Chip, choice: string, chatId: ChatId, payload?: JsonObject): Promise<boolean> {
  const intent = chipIntent(chip, choice, chatId, payload);
  if (intent.request) {
    const message = await app.send(intent.request);
    if (message.type === "lre.error") {
      app.toast(message.message, "error");
      return false;
    }
    if (message.request === "lre.chip" && message.body.pending && !intent.regenerate) app.toast("Saved — it applies when the reply finishes.", "info");
  }
  if (intent.regenerate && !(await app.host.generate("regenerate"))) app.toast("Couldn't start Regenerate here; use the message's Regenerate button.", "error");
  return true;
}

function useChipAction(chip: Chip, chatId: ChatId): [boolean, (choice: string, payload?: JsonObject) => void] {
  const app = useApp();
  const [busy, run] = useBusy();
  return [
    busy,
    (choice, payload) =>
      run(async () => {
        // A failed engine run's way to what failed (DESIGN §5.1): the drawer at Settings → Diagnostics.
        if (choice === "diagnostics") return openDiagnostics();
        await sendChipChoice(app, chip, choice, chatId, payload);
      }),
  ];
}

interface ChipControls {
  busy: boolean;
  /** The action whose form is open. */
  asking: string | null;
  press(action: ChipAction): void;
  /** The open action's form, or null. */
  form: ComponentChildren;
}

/**
 * A chip's actions as the player presses them: one that asks for a value opens its form first, one
 * that picks an action again opens the Actions palette at it (the intent gate's Edit), and any
 * other sends at once.
 */
function useChipControls(chip: Chip, chatId: ChatId): ChipControls {
  const app = useApp();
  const view = useView();
  const [busy, choose] = useChipAction(chip, chatId);
  const [asking, setAsking] = useState<string | null>(null);
  const open = chip.actions.find((action) => action.id === asking);
  const press = (action: ChipAction): void => {
    const input = action.input;
    if (input?.type === "action") void app.overlays.openPalette("actions", { chatId, chip, action: input.action, params: input.params });
    else if (input) setAsking(asking === action.id ? null : action.id);
    else choose(action.id);
  };
  return {
    busy,
    asking,
    press,
    form: open?.input && open.input.type !== "action" ? <ChipInputForm key={open.id} action={open} input={open.input} currency={view?.currency ?? DEFAULT_CURRENCY} busy={busy} onSend={(payload) => choose(open.id, payload)} onCancel={() => setAsking(null)} /> : null,
  };
}

/** One chip action as a button; one that opens a form says whether it is open. */
function ActionButton(props: { action: ChipAction; controls: ChipControls; pill?: boolean }) {
  const { action, controls } = props;
  const icon = ACTION_ICON[action.id];
  const style = action.style === "primary" ? " primary" : action.style === "danger" ? " danger" : "";
  return (
    <button type="button" class={props.pill ? `lre-chat-pill${style}` : `lre-btn small${style}`} disabled={controls.busy} aria-expanded={action.input && action.input.type !== "action" ? controls.asking === action.id : undefined} onClick={() => controls.press(action)}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {action.label}
    </button>
  );
}

/** The small form an action with an input opens: an amount in the world's currency, one of its options, or text to edit; Apply sends it as the chip's payload. */
function ChipInputForm(props: { action: ChipAction; input: Exclude<ChipInput, { type: "action" }>; currency: WorldCurrency; busy: boolean; onSend(payload: JsonObject): void; onCancel(): void }) {
  const { input } = props;
  const [text, setText] = useState(() => (input.type === "money" && input.value !== undefined ? formatMoneyInput(input.value, props.currency) : input.type === "text" ? input.value : ""));
  const [picked, setPicked] = useState(() => (input.type === "choice" ? (input.options[0]?.value ?? "") : ""));
  const cents = input.type === "money" ? parseMoneyInput(text, props.currency) : null;
  const ok = input.type === "money" ? cents !== null && cents > 0 : input.type === "text" ? text.trim() !== "" : picked !== "";
  return (
    <form
      class="lre-chat-form"
      data-lre-chip-input={props.action.id}
      onSubmit={(event) => {
        event.preventDefault();
        if (ok) props.onSend(input.type === "money" ? { cents } : input.type === "text" ? { text } : { value: picked });
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onCancel();
      }}
    >
      <Field label={input.label}>
        {input.type === "money" ? (
          <MoneyInput currency={props.currency} value={text} onInput={setText} label={input.label} invalid={text.trim() !== "" && !ok} autoFocus />
        ) : input.type === "text" ? (
          <textarea class="lre-input" aria-label={input.label} rows={Math.min(12, Math.max(3, text.split("\n").length))} value={text} onInput={(event) => setText(event.currentTarget.value)} autoFocus />
        ) : (
          <select class="lre-input" aria-label={input.label} value={picked} onChange={(event) => setPicked(event.currentTarget.value)}>
            {input.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div class="lre-chat-actions">
        <Button type="submit" variant="primary" size="sm" icon="check" disabled={props.busy || !ok}>
          Apply
        </Button>
        <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A chip in full, as the receipt's list shows it: its icon, label and detail, its buttons and any open form. */
export function DefaultChip(props: ChipProps) {
  const { chip } = props;
  const controls = useChipControls(chip, props.chatId);
  return (
    <div class={controls.busy ? "lre-chip busy" : "lre-chip"} data-kind={chip.kind} data-tone={chipTone(chip)}>
      <div class="lre-chip-row">
        <Icon name={CHIP_ICON[chip.kind]} size={16} class="lre-chip-icon" />
        <div class="lre-chip-text">
          <span class="lre-chip-label">{chip.label}</span>
          {chip.detail ? <span class="lre-chip-detail">{chip.detail}</span> : null}
        </div>
        {chip.actions.length > 0 ? (
          <div class="lre-chat-actions">
            {chip.actions.map((action) => (
              <ActionButton key={action.id} action={action} controls={controls} />
            ))}
          </div>
        ) : null}
      </div>
      {controls.form}
    </div>
  );
}

/** A decision the player owes: a card with its question, detail and answers, marked when the next send lapses it. */
function DecisionCard(props: ChipProps) {
  const { chip } = props;
  const controls = useChipControls(chip, props.chatId);
  return (
    <div class={controls.busy ? "lre-chat-decision busy" : "lre-chat-decision"} data-kind={chip.kind} data-tone={chipTone(chip) === "neg" ? "neg" : "warn"} role="group" aria-label={chip.label}>
      {chip.expires === "next_send" ? (
        <span class="lre-chat-due">
          <Icon name="send" size={14} />
          Answer before you send
        </span>
      ) : null}
      <div class="lre-chat-decision-head">
        <Icon name={CHIP_ICON[chip.kind]} class="lre-chat-decision-icon" />
        <div class="lre-chat-decision-text">
          <strong class="lre-chat-decision-label">{chip.label}</strong>
          {chip.detail ? <span class="lre-chat-decision-detail">{chip.detail}</span> : null}
        </div>
      </div>
      {chip.actions.length > 0 ? (
        <div class="lre-chat-actions">
          {chip.actions.map((action) => (
            <ActionButton key={action.id} action={action} controls={controls} />
          ))}
        </div>
      ) : null}
      {controls.form}
    </div>
  );
}

/**
 * An offer as compact pills: one action makes the whole pill its button ("Send: the
 * suggestion"), several sit as pills after the offer's label ("Swipe as… Re-narrate · Re-run"). The
 * detail follows in quiet text, so a touch screen loses none of it.
 */
function OfferChip(props: ChipProps) {
  const { chip } = props;
  const controls = useChipControls(chip, props.chatId);
  const detailId = useId();
  const only = chip.actions.length === 1 ? chip.actions[0] : undefined;
  const detail = chip.detail ? (
    <span id={detailId} class="lre-chat-offer-detail">
      {chip.detail}
    </span>
  ) : null;
  if (only)
    return (
      <div class={controls.busy ? "lre-chat-offer busy" : "lre-chat-offer"} data-kind={chip.kind}>
        <button
          type="button"
          class={only.style === "primary" ? "lre-chat-pill primary" : "lre-chat-pill"}
          aria-describedby={detail ? detailId : undefined}
          aria-expanded={only.input ? controls.asking === only.id : undefined}
          disabled={controls.busy}
          onClick={() => controls.press(only)}
        >
          <Icon name={CHIP_ICON[chip.kind]} size={16} />
          <strong>{only.label}:</strong>
          <span class="lre-chat-pill-text">{chip.label}</span>
        </button>
        {detail}
        {controls.form}
      </div>
    );
  return (
    <div class={controls.busy ? "lre-chat-offer busy" : "lre-chat-offer"} data-kind={chip.kind} role="group" aria-label={chip.label} aria-describedby={detail ? detailId : undefined}>
      <span class="lre-chat-offer-lead">
        <Icon name={CHIP_ICON[chip.kind]} size={16} />
        {chip.label}
      </span>
      {chip.actions.map((action) => (
        <ActionButton key={action.id} action={action} controls={controls} pill />
      ))}
      {detail}
      {controls.form}
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

/** The Keep report (DESIGN §4.3), its own decision card: convert per entry, Keep, and one-tap Discard. */
export function KeepReportChip(props: ChipProps) {
  const app = useApp();
  const view = useView();
  const { chip } = props;
  const [busy, choose] = useChipAction(chip, props.chatId);
  const [converting, runConvert] = useBusy();
  const lines = keepRows(view?.keepReport ?? []);
  return (
    <div class="lre-chat-decision lre-chat-keep" data-kind="keep_report" data-tone="warn" role="group" aria-label={chip.label}>
      <div class="lre-chat-decision-head">
        <Icon name={CHIP_ICON.keep_report} class="lre-chat-decision-icon" />
        <div class="lre-chat-decision-text">
          <strong class="lre-chat-decision-label">{chip.label}</strong>
          {chip.detail ? <span class="lre-chat-decision-detail">{chip.detail}</span> : null}
        </div>
        <Badge tone="warn">
          {lines.length} entr{lines.length === 1 ? "y" : "ies"}
        </Badge>
      </div>
      {lines.length > 0 ? (
        <div class="lre-chat-keep-rows">
          {lines.map(({ line, count }) => {
            const convert = convertRequest(line, props.chatId);
            const key = "marker" in line.ref ? `${line.messageId}:m${line.ref.marker}` : `${line.messageId}:${line.ref.in}:${"seq" in line.ref ? line.ref.seq : 0}:${line.ref.index}`;
            return (
              <div class="lre-chat-keep-row" key={key}>
                <span class="lre-chat-keep-text">
                  {line.text}
                  <span class="lre-chat-keep-sub">
                    {line.status === "converted" ? <Icon name="check" size={14} /> : null}
                    {KEEP_STATUS[line.status]}
                    {count > 1 ? ` · ${count} linked changes` : ""}
                  </span>
                </span>
                {convert && line.status !== "converted" ? (
                  <Button
                    size="sm"
                    disabled={converting}
                    onClick={() =>
                      runConvert(async () => {
                        await app.request(convert);
                      })
                    }
                  >
                    Convert
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <div class="lre-chat-actions">
        {chip.actions.map((action) => (
          <Button key={action.id} size="sm" variant={action.id === "discard" ? "danger" : action.style === "primary" ? "primary" : "secondary"} disabled={busy} onClick={() => choose(action.id)}>
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

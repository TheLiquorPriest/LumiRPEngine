// Chips under each message (DESIGN §11, §12), rendered by a DOM decorator on `message_body_after`.
// A pack can override a kind's rendering through `UiRegistry.chip`; everything else uses the
// default chip, whose buttons send exactly the request `chipRequest` builds.

import type { ChatId, MessageId } from "../shared/ids";
import type { KeepLine } from "../shared/ledger";
import type { Chip, ChipKind } from "../shared/state-view";
import { useApp, useView } from "./app";
import { useBusy } from "./components";
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

function useChipAction(chip: Chip, chatId: ChatId): [boolean, (choice: string) => void] {
  const app = useApp();
  const [busy, run] = useBusy();
  return [
    busy,
    (choice) =>
      run(async () => {
        const intent = chipIntent(chip, choice, chatId);
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

export function DefaultChip(props: ChipProps) {
  const { chip } = props;
  const [busy, choose] = useChipAction(chip, props.chatId);
  const info = chip.actions.length === 0;
  return (
    <div class={`lre-chip${info ? " info" : ""}${busy ? " busy" : ""}`} data-kind={chip.kind} title={chip.detail}>
      <span class="lab">
        <span aria-hidden="true">{CHIP_ICON[chip.kind]} </span>
        {chip.label}
        {chip.detail ? <span class="det"> · {chip.detail}</span> : null}
      </span>
      {chip.actions.map((action) => (
        <button key={action.id} type="button" class={action.style} disabled={busy} onClick={() => choose(action.id)}>
          {action.label}
        </button>
      ))}
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


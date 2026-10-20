// Diagnostics (DESIGN §6.9) on the frontend: the in-flight activity line the HUD, the status line and
// the drawer show while the engine works (a step's label and the time it has taken, or a failure with
// a way to Diagnostics), the drawer's error banner, and the Diagnostics page in Settings: each turn's
// steps with their model calls, the failures with their reasons and fixes, filters, copy and download.
// The page is GM-level (a reason may name what the player hasn't met): it asks for the records only
// once the player opens its curtain, and never keeps them in pushed state.

import { useEffect, useState } from "preact/hooks";
import { CANNOT_STOP, type Activity, type DiagRecord } from "../shared/diagnostics";
import { useApp } from "./app";
import { Badge, Banner, Button, Empty, List, ListRow, Section, Seg, useBusy } from "./components";
import { Icon } from "./icons";
import { useSelect } from "./store";

/** Opens the drawer at Settings → Diagnostics (`setup` listens). */
export const OPEN_DIAGNOSTICS_EVENT = "lre:open-diagnostics";

export function openDiagnostics(): void {
  window.dispatchEvent(new CustomEvent(OPEN_DIAGNOSTICS_EVENT));
}

/** How long something has taken, as the line reads it: "8 s", "1 m 05 s". */
export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, "0")} s`;
}

/** The chat's activity line, re-rendered each second while it runs. */
function useActivity(): { activity: Activity | null; now: number } {
  const app = useApp();
  const activity = useSelect(app.sync, (state) => state.activity);
  const [now, setNow] = useState(() => Date.now());
  const running = activity?.state === "running";
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return { activity, now };
}

/**
 * What the engine is doing now ("Asking 3 minds… 12 s"), or that the last turn failed, with a way to
 * Diagnostics. Nothing while idle. `compact` drops the words for the time (the HUD pill on a phone).
 */
export function ActivityLine(props: { compact?: boolean }) {
  const { activity, now } = useActivity();
  if (!activity) return null;
  if (activity.state === "failed")
    return (
      <button type="button" class="lre-activity failed" data-lre-activity="failed" onClick={openDiagnostics} aria-label={`${activity.label}. Open Diagnostics`} title="Open Diagnostics">
        <Icon name="alert" size={16} />
        {props.compact ? null : <span class="lre-activity-label">{activity.label}</span>}
      </button>
    );
  const elapsed = elapsedText(now - activity.since);
  return (
    <span class="lre-activity" data-lre-activity="running" role="status" aria-live="polite" aria-label={`${activity.label} ${elapsed}`}>
      <span class="lre-chat-pulse" aria-hidden="true" />
      {props.compact ? null : <span class="lre-activity-label">{activity.label}</span>}
      <span class="lre-num lre-activity-time">{elapsed}</span>
    </span>
  );
}

/** The drawer's banner: the engine at work, or the last turn's failure with Diagnostics and Dismiss. */
export function ActivityBanner() {
  const app = useApp();
  const chatId = useSelect(app.sync, (state) => state.chatId);
  const onPage = useSelect(app.ui, (ui) => ui.mode === "settings" && ui.settings.page === "diagnostics");
  const { activity, now } = useActivity();
  // On the Diagnostics page the failure is in its own list.
  if (onPage && activity?.state === "failed") return null;
  if (!activity || !chatId) return null;
  if (activity.state === "running")
    return (
      <div class="lre-activity-bar" data-lre-activity-bar="running" role="status" aria-live="polite">
        <span class="lre-chat-pulse" aria-hidden="true" />
        <span class="lre-activity-label">{activity.label}</span>
        <span class="lre-num lre-activity-time">{elapsedText(now - activity.since)}</span>
      </div>
    );
  return (
    <div class="lre-activity-banner" data-lre-activity-bar="failed">
      <Banner
        tone="neg"
        title={activity.label}
        actions={
          <>
            <Button size="sm" variant="secondary" icon="list" onClick={openDiagnostics}>
              Diagnostics
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void app.request({ type: "lre.diag", chatId, op: "dismiss" })}>
              Dismiss
            </Button>
          </>
        }
      >
        The engine didn't finish its work for the last reply. Diagnostics says which step failed and what to change.
      </Banner>
    </div>
  );
}

/**
 * This Lumiverse can't stop a generation for the engine run (DESIGN §5.1), so a reply may go out
 * without what the engine prepared: said above the chat's composer in world chats, and on the
 * Diagnostics page. Nothing until the backend's hello says so.
 */
export function CannotStopNotice(props: { inChat?: boolean }) {
  const app = useApp();
  const canStop = useSelect(app.sync, (state) => state.canStop);
  const world = useSelect(app.sync, (state) => state.view !== null && state.view.status !== "not_world");
  if (canStop !== false || (props.inChat && !world)) return null;
  return (
    <Banner tone="warn" title="The engine can't run before replies here">
      {CANNOT_STOP} Update Lumiverse to one that lets extensions stop a generation.
    </Banner>
  );
}

// ---------------------------------------------------------------- the page

export type DiagFilter = "all" | "problems" | "calls" | "slow";

const FILTERS: readonly { value: DiagFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "problems", label: "Problems" },
  { value: "calls", label: "Model calls" },
  { value: "slow", label: "Slow" },
];

export function filterRecords(records: readonly DiagRecord[], filter: DiagFilter): DiagRecord[] {
  if (filter === "problems") return records.filter((r) => r.status === "failed" || r.level === "warn" || r.level === "error");
  if (filter === "calls") return records.filter((r) => (r.calls?.length ?? 0) > 0);
  if (filter === "slow") return records.filter((r) => r.kind === "slow");
  return [...records];
}

/** Records by turn, the newest turn first; records outside a turn form their own groups, in time order. */
export function groupByTurn(records: readonly DiagRecord[]): { turn: string | null; records: DiagRecord[]; start: number }[] {
  const groups: { turn: string | null; records: DiagRecord[]; start: number }[] = [];
  const byTurn = new Map<string, { turn: string | null; records: DiagRecord[]; start: number }>();
  for (const r of records) {
    const known = r.turn !== null ? byTurn.get(r.turn) : undefined;
    if (known) {
      known.records.push(r);
      known.start = Math.min(known.start, r.start);
      continue;
    }
    const group = { turn: r.turn, records: [r], start: r.start };
    groups.push(group);
    if (r.turn !== null) byTurn.set(r.turn, group);
  }
  // In time order, the turn's own summary last.
  for (const g of groups) g.records.sort((a, b) => Number(a.kind === "turn") - Number(b.kind === "turn") || a.start - b.start || a.seq - b.seq);
  return groups.sort((a, b) => b.start - a.start);
}

function callText(r: DiagRecord): string[] {
  return (r.calls ?? []).map((c) => `    call ${c.purpose} via ${c.via} on ${c.connection} / ${c.model}: ${c.ok ? "ok" : "failed"}, ${c.tokensIn ?? "?"} in, ${c.tokensOut ?? "?"} out${c.maxTokens !== null ? ` of ${c.maxTokens}` : ""}, finish ${c.finishReason || "-"}, ${Math.round(c.ms)} ms${c.error ? `: ${c.error}` : ""}`);
}

/** The records as plain lines, oldest first, for the clipboard and a bug report. */
export function diagText(records: readonly DiagRecord[]): string {
  return records
    .flatMap((r) => [
      `${new Date(r.start).toISOString()} ${r.level.toUpperCase().padEnd(5)} ${r.turn ? `[turn ${r.turn.slice(0, 8)}] ` : ""}${r.kind} ${r.phase ? `${r.phase}/` : ""}${r.step} ${r.status} ${Math.round(r.ms)} ms${r.reason ? `: ${r.reason}` : ""}`,
      ...(r.fix ? [`    fix: ${r.fix}`] : []),
      ...(r.path ? [`    path: ${r.path}`] : []),
      ...(r.sections ?? []).map((s) => `    section ${s.slot}${s.outlet ? ` → ${s.outlet}` : ""}: ${s.filled ? "filled" : "empty"}`),
      ...callText(r),
    ])
    .join("\n");
}

const STATUS_TONE: Record<DiagRecord["status"], "pos" | "neg" | "neutral"> = { ok: "pos", failed: "neg", skipped: "neutral" };

function msText(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** A record's name in the timeline: the turn's summary, a phase's step, or what was asked. */
function titleOf(r: DiagRecord): string {
  if (r.kind === "turn") return "The turn";
  return r.phase && r.phase !== r.step && r.phase !== "request" ? `${r.phase} · ${r.step}` : r.step;
}

function RecordRow(props: { record: DiagRecord }) {
  const r = props.record;
  const calls = r.calls ?? [];
  const tokens = calls.reduce((n, c) => n + (c.tokensOut ?? 0), 0);
  const subtitle = [r.reason, calls.length > 0 ? `${calls.length} call${calls.length === 1 ? "" : "s"}, ${tokens} tokens out` : null].filter((s) => s).join(" · ");
  return (
    <div class="lre-diag-row" data-lre-diag-status={r.status} data-lre-diag-kind={r.kind}>
      <ListRow
        icon={r.status === "failed" ? "alert" : r.status === "skipped" ? "minus" : r.kind === "slow" ? "hourglass" : "check"}
        title={titleOf(r)}
        subtitle={subtitle || undefined}
        value={msText(r.ms)}
        valueTone={r.status === "failed" ? "neg" : "muted"}
        badge={r.kind === "slow" ? <Badge tone="warn">slow</Badge> : <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>}
      />
      {r.fix ? <p class="lre-diag-fix">Fix: {r.fix}</p> : null}
      {calls.length > 0 || (r.sections?.length ?? 0) > 0 ? (
        <ul class="lre-diag-calls">
          {calls.map((c, i) => (
            <li key={i} data-lre-diag-call={c.ok && c.finishReason !== "length" ? "ok" : "bad"}>
              <span class="lre-num">{c.purpose}</span> · {c.model} on {c.connection} · {c.tokensIn ?? "?"} in / {c.tokensOut ?? "?"} out{c.maxTokens !== null ? ` of ${c.maxTokens}` : ""} · {c.finishReason || "no finish reason"} · {msText(c.ms)}
              {c.error ? ` · ${c.error}` : ""}
            </li>
          ))}
          {(r.sections ?? []).map((s) => (
            <li key={s.slot} data-lre-diag-call={s.filled ? "ok" : "bad"}>
              {s.slot}
              {s.outlet ? ` → ${s.outlet}` : " (world placement)"}: {s.filled ? "filled" : "empty"}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function DiagnosticsPage() {
  const app = useApp();
  const chatId = useSelect(app.sync, (state) => state.chatId);
  const [revealed, setRevealed] = useState(false);
  const [records, setRecords] = useState<DiagRecord[] | null>(null);
  const [filter, setFilter] = useState<DiagFilter>("all");
  const [busy, run] = useBusy();
  const load = () =>
    run(async () => {
      if (!chatId) return;
      const result = await app.request({ type: "lre.diag", chatId, op: "get" });
      setRecords(result ? result.records : []);
    });
  // Another chat's records are its own: the curtain closes and they are read again.
  useEffect(() => {
    setRevealed(false);
    setRecords(null);
  }, [chatId]);
  useEffect(() => {
    if (revealed) load();
  }, [revealed]);
  if (!chatId) return <Empty icon="list">Open a chat to see what the engine did in it.</Empty>;
  if (!revealed)
    return (
      <div class="lre-stack" data-lre-settings-page="diagnostics">
        <CannotStopNotice />
        <Banner tone="gm" title="GM detail" actions={<Button icon="eye" onClick={() => setRevealed(true)}>Show diagnostics</Button>}>
          Diagnostics show each step the engine ran for this chat, its model calls and why one failed. A reason can name someone or something your character hasn't met yet.
        </Banner>
      </div>
    );
  const shown = records ? filterRecords(records, filter) : [];
  // What failed, newest first; a failed turn's summary only when none of its steps says why.
  const problems = (records ?? []).filter((r) => r.status === "failed" && (r.kind !== "turn" || !(records ?? []).some((s) => s !== r && s.turn === r.turn && s.status === "failed"))).slice(-20).reverse();
  return (
    <div class="lre-stack lre-diag" data-lre-settings-page="diagnostics">
      <CannotStopNotice />
      <div class="lre-diag-tools">
        <Seg<DiagFilter> label="Show" value={filter} options={FILTERS} onChange={setFilter} />
        <div class="lre-diag-actions">
          <Button size="sm" variant="secondary" icon="refresh" busy={busy} onClick={load}>
            Refresh
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="copy"
            disabled={!records || records.length === 0}
            onClick={() =>
              void navigator.clipboard.writeText(diagText(shown)).then(
                () => app.toast("Diagnostics copied"),
                () => app.toast("The clipboard refused the copy; use Download", "error"),
              )
            }
          >
            Copy
          </Button>
          <Button size="sm" variant="secondary" icon="download" disabled={!records || records.length === 0} onClick={() => app.host.download(`lre-diagnostics-${chatId}.json`, JSON.stringify({ chatId, at: new Date().toISOString(), records }, null, 2))}>
            Download
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            disabled={!records || records.length === 0}
            onClick={() =>
              run(async () => {
                await app.request({ type: "lre.diag", chatId, op: "clear" });
                setRecords([]);
              })
            }
          >
            Clear
          </Button>
        </div>
      </div>
      {problems.length > 0 ? (
        <Section title="Errors" flush>
          <div class="lre-stack lre-diag-errors">
            {problems.map((r) => (
              <Banner key={r.seq} tone="neg" title={`${titleOf(r)}${r.turn ? ` · turn ${r.turn.slice(0, 8)}` : ""}`}>
                <p class="lre-diag-fix">{r.reason ?? "failed"}</p>
                {r.fix ? <p class="lre-diag-fix">Fix: {r.fix}</p> : null}
              </Banner>
            ))}
          </div>
        </Section>
      ) : null}
      {records === null ? (
        <Empty icon="hourglass">Reading diagnostics…</Empty>
      ) : shown.length === 0 ? (
        <Empty icon="check">{records.length === 0 ? "Nothing recorded for this chat yet: the next turn's steps show here." : "Nothing matches this filter."}</Empty>
      ) : (
        groupByTurn(shown).map((group) => {
          const failed = group.records.some((r) => r.status === "failed");
          const slow = group.records.some((r) => r.kind === "slow");
          return (
            <Section key={`${group.turn ?? "none"}-${group.start}`} title={group.turn ? `Turn ${group.turn.slice(0, 8)} · ${new Date(group.start).toLocaleTimeString()}` : `Outside a turn · ${new Date(group.start).toLocaleTimeString()}`} aside={<Badge tone={failed ? "neg" : slow ? "warn" : "pos"}>{failed ? "failed" : slow ? "slow" : "ok"}</Badge>} flush>
              <List>
                {group.records.map((r) => (
                  <RecordRow key={r.seq} record={r} />
                ))}
              </List>
            </Section>
          );
        })
      )}
    </div>
  );
}

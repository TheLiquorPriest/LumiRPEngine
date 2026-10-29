// GM → Assistant (DESIGN §4.5; AGENT-LOOP-PLAN §9; INC1-SPEC R6b, C8): the game master's chat with
// the GM assistant about this chat's world, behind the GM gate. The thread is asked for when the tab
// shows (`lre.assistant {op: "get"}`) and then follows its pushes (`lre.assistant.update`); every
// control is one `lre.assistant` request, whose answer is the thread after it. Send carries your
// message; while the assistant answers, a running row shows its label, the tokens it has spent so
// far and Cancel. Each answer says how it ended and what it spent, with what it looked up folded
// under it (its trace: each tool call in short). A proposal lists each change in plain words, as the
// assistant's knowledge reads them, with Apply all, a pick of them or No; once applied, its Undo
// takes it back (`lre.chip`) for as long as its chip stands, as a GM edit's does. Clear forgets the
// conversation. None of it reaches Play: while it answers, the drawer's activity line shows only the
// assistant's label, which the backend sets. Styles: styles/assistant.ts.

import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { AGENT_ROLES } from "../../shared/agent-settings";
import type { ChatId } from "../../shared/ids";
import { type AssistantMessage, type AssistantProposal, type AssistantRun, type AssistantStatus, type AssistantView, type TraceRow, WRITE_REFUSED } from "../../shared/protocol";
import type { GmView } from "../../shared/state-view";
import { formatMs } from "../../shared/timeouts";
import { useApp } from "../app";
import { markdown } from "../markdown";
import { Badge, Button, Disclosure, Empty, useBusy } from "../components";
import { humanize } from "../format";
import { Icon } from "../icons";
import type { GmSectionProps } from "../registry";
import type { Req } from "../requests";
import { scrollParent } from "../scroll";
import { GmCard } from "./ui";

/** The assistant's name, as Settings → Agents gives its role. */
const ASSISTANT_NAME = AGENT_ROLES.find((r) => r.id === "assistant")?.label ?? "GM assistant";

/** How an answer that stopped short of one ended (`AssistantStatus`), in words; its `reason` says why. */
const ENDED: Readonly<Record<Exclude<AssistantStatus, "answered">, { text: string; tone: "neutral" | "warn" | "neg" }>> = {
  refused: { text: "Stopped at a limit", tone: "warn" },
  stopped: { text: "Stopped: it kept repeating a call", tone: "warn" },
  cancelled: { text: "Cancelled", tone: "neutral" },
  failed: { text: "Failed", tone: "neg" },
};

const n = (value: number): string => value.toLocaleString("en-US");

// ---------------------------------------------------------------- what the controls do

/** What the page's controls need from outside: the requests, and the page's own state. */
export interface AssistantIo {
  /** Sends one `lre.assistant` request; whether it was accepted (a refusal is a toast). */
  ask(body: Req<"lre.assistant">): Promise<boolean>;
  /** Takes an applied proposal back by its chip (`lre.chip` undo); whether it was. */
  undo(chipId: string): Promise<boolean>;
  /** Runs a request under the page's busy flag. */
  run(task: () => Promise<unknown>): void;
  /** Asks before Clear forgets the conversation. */
  confirmClear(): Promise<boolean>;
  /** Opens Settings → Agents → Assistant. */
  openSettings(): void;
  /** Your message as typed, not sent yet. */
  draft: string;
  setDraft(text: string): void;
  /** The changes picked on each open proposal, by its id. */
  picked: Readonly<Record<string, readonly string[]>>;
  setPicked(next: Readonly<Record<string, readonly string[]>>): void;
  /** An applied proposal's chip was used here. */
  undone(chipId: string): void;
}

/** What each control does: the tab's handlers. */
export interface AssistantHandlers {
  draft(text: string): void;
  pick(proposalId: string, key: string, on: boolean): void;
  send(): void;
  cancel(): void;
  applyAll(proposalId: string): void;
  applyPicked(proposalId: string, keys: readonly string[]): void;
  reject(proposalId: string): void;
  undo(chipId: string): void;
  clear(): void;
  settings(): void;
}

/**
 * The tab's controls as requests (C8): Send carries your message trimmed, and empties the box once
 * it is accepted; Cancel stops the answer under way, at once, whatever else the page is waiting on
 * (an Apply among it); Apply all names no change and Apply picked names the ones picked, in the
 * proposal's order; No turns the proposal down; Undo is the applied proposal's chip; Clear asks first.
 */
export function assistantHandlers(chatId: ChatId, io: AssistantIo): AssistantHandlers {
  return {
    draft: (text) => io.setDraft(text),
    pick: (proposalId, key, on) => {
      const now = io.picked[proposalId] ?? [];
      io.setPicked({ ...io.picked, [proposalId]: on ? (now.includes(key) ? now : [...now, key]) : now.filter((k) => k !== key) });
    },
    send: () => {
      const text = io.draft.trim();
      if (text === "") return;
      io.run(async () => {
        if (await io.ask({ type: "lre.assistant", op: "send", chatId, text })) io.setDraft("");
      });
    },
    cancel: () => void io.ask({ type: "lre.assistant", op: "cancel", chatId }),
    applyAll: (proposalId) => io.run(() => io.ask({ type: "lre.assistant", op: "apply", chatId, proposalId })),
    applyPicked: (proposalId, keys) => {
      if (keys.length === 0) return;
      io.run(() => io.ask({ type: "lre.assistant", op: "apply", chatId, proposalId, keys: [...keys] }));
    },
    reject: (proposalId) => io.run(() => io.ask({ type: "lre.assistant", op: "reject", chatId, proposalId })),
    undo: (chipId) =>
      io.run(async () => {
        if (await io.undo(chipId)) io.undone(chipId);
      }),
    clear: () =>
      io.run(async () => {
        if (await io.confirmClear()) await io.ask({ type: "lre.assistant", op: "clear", chatId });
      }),
    settings: () => io.openSettings(),
  };
}

// ---------------------------------------------------------------- the thread

/** An answer's tool calls, folded: each tool, its arguments in short, its time, and what a failed one gave back. */
export function Trace(props: { rows: readonly TraceRow[] }) {
  const failed = props.rows.filter((r) => r.error !== undefined).length;
  return (
    <div class="lre-gm-assist-trace" data-lre-assistant-trace>
      <Disclosure summary={`What it looked up: ${props.rows.length} ${props.rows.length === 1 ? "tool call" : "tool calls"}${failed > 0 ? `, ${failed} failed` : ""}`}>
        <ol class="lre-gm-assist-trace-rows">
          {props.rows.map((r, i) => (
            <li key={i} data-lre-trace-tool={r.tool} data-lre-trace-failed={r.error !== undefined ? "" : undefined}>
              <code class="lre-gm-assist-trace-tool">{r.tool}</code>
              {r.summary !== "" ? <span class="lre-gm-assist-trace-args">{r.summary}</span> : null}
              <span class="lre-gm-assist-trace-ms">{formatMs(r.ms)}</span>
              {r.error !== undefined ? <span class="lre-gm-assist-trace-error">{r.error}</span> : null}
            </li>
          ))}
        </ol>
      </Disclosure>
    </div>
  );
}

/** Of an answer's tokens in, what the cache gave it (when any) and what it wrote to the cache (when its provider says), in brackets; "" when neither. */
function usageNote(u: NonNullable<AssistantMessage["usage"]>): string {
  const parts = [...(u.cached > 0 ? [`${n(u.cached)} cached`] : []), ...(u.written !== undefined ? [`${n(u.written)} written`] : [])];
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** One message: yours as you wrote it, or the assistant's, its answer read as Markdown's safe subset (`markdown`), with how it ended, what it spent, its trace, and the proposal it made (`children`). */
export function MessageView(props: { message: AssistantMessage; children?: ComponentChildren }) {
  const m = props.message;
  const mine = m.role === "user";
  const ended = !mine && m.status !== undefined && m.status !== "answered" ? ENDED[m.status] : null;
  return (
    <div class={mine ? "lre-gm-assist-msg mine" : "lre-gm-assist-msg"} data-lre-assistant-message={m.id} data-lre-role={m.role} data-lre-status={m.status}>
      <div class="lre-gm-assist-msg-head">
        <span class="lre-gm-assist-msg-who">{mine ? "You" : ASSISTANT_NAME}</span>
        {ended ? <Badge tone={ended.tone}>{ended.text}</Badge> : null}
        <span class="lre-gm-assist-msg-at">{Number.isFinite(m.at) ? new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
      </div>
      {m.text.trim() === "" ? (mine ? null : <p class="lre-gm-assist-msg-text lre-muted">It said nothing before it stopped.</p>) : mine ? <p class="lre-gm-assist-msg-text">{m.text}</p> : markdown(m.text, "lre-gm-assist-msg-text")}
      {ended && m.reason ? <p class="lre-gm-assist-msg-why">{m.reason}</p> : null}
      {!mine && m.trace && m.trace.length > 0 ? <Trace rows={m.trace} /> : null}
      {!mine && m.usage ? <span class="lre-gm-assist-msg-usage">{`${n(m.usage.in)} tokens in${usageNote(m.usage)} · ${n(m.usage.out)} out`}</span> : null}
      {props.children}
    </div>
  );
}

/** A proposal's status in a badge. */
function proposalBadge(p: AssistantProposal, undone: boolean): { text: string; tone: "neutral" | "pos" | "warn" } {
  if (p.status === "open") return { text: "Waits for you", tone: "warn" };
  if (p.status === "rejected") return { text: "Turned down", tone: "neutral" };
  if (p.pending) return { text: "Waits for the turn", tone: "warn" };
  return undone ? { text: "Undone", tone: "neutral" } : { text: "Applied", tone: "pos" };
}

/**
 * The changes one answer proposed, each in plain words. Open: Apply all, Apply picked once you've
 * picked some (when there are several), or No; a change its type makes ask first says so. Applied:
 * what landed (✓), what was refused and why (!) and what wasn't picked (–), with Undo while the
 * edit's chip still stands (`standing`), or that it waits for the turn under way; a change whose
 * write a turn refused, beside a learned note that landed, may be applied again (Apply again sends
 * only those). Turned down: that nothing changed.
 */
export function ProposalCard(props: { proposal: AssistantProposal; picked: readonly string[]; standing: boolean; undone: boolean; busy: boolean; onPick(key: string, on: boolean): void; onApplyAll(): void; onApplyPicked(keys: readonly string[]): void; onReject(): void; onUndo(): void }) {
  const p = props.proposal;
  const open = p.status === "open";
  const several = p.ops.length > 1;
  // In the proposal's order, whatever order they were ticked in.
  const picked = p.ops.filter((o) => props.picked.includes(o.key)).map((o) => o.key);
  const badge = proposalBadge(p, props.undone);
  // An applied proposal's changes a turn's close refused: Apply may send them again.
  const again = p.status === "applied" && !p.pending && p.ops.some((o) => !o.applied && o.refused?.code === WRITE_REFUSED);
  return (
    <div class="lre-gm-assist-proposal" data-lre-assistant-proposal={p.id} data-lre-proposal-status={p.pending ? "pending" : p.status}>
      <GmCard name="assistant-proposal" title={open ? "Proposed changes" : p.status === "applied" ? "The changes it proposed" : "Proposed changes, turned down"} subtitle={`${p.ops.length} ${p.ops.length === 1 ? "change" : "changes"}`} badges={<Badge tone={badge.tone}>{badge.text}</Badge>}>
        <div class="lre-gm-assist-ops" role="list">
          {p.ops.map((o) => (
            <div key={o.key} class="lre-gm-assist-op" role="listitem" data-lre-op={o.key} data-lre-change-type={o.changeType}>
              {open && several ? (
                <label class="lre-check">
                  <input type="checkbox" aria-label={`Pick: ${o.lines[0] ?? humanize(o.changeType)}`} checked={picked.includes(o.key)} disabled={props.busy} onChange={(event) => props.onPick(o.key, event.currentTarget.checked)} />
                </label>
              ) : open ? null : (
                <span class={o.undone ? "lre-gm-assist-op-mark" : o.applied ? "lre-gm-assist-op-mark lre-pos" : o.refused ? "lre-gm-assist-op-mark lre-neg" : "lre-gm-assist-op-mark"} role="img" aria-label={o.undone ? "Undone" : o.applied ? "Applied" : o.refused ? "Refused" : "Not applied"}>
                  <Icon name={o.undone ? "undo" : o.applied ? "check" : o.refused ? "alert" : "minus"} size={16} />
                </span>
              )}
              <div class="lre-gm-assist-op-body">
                {(o.lines.length > 0 ? o.lines : [humanize(o.changeType)]).map((line, i) => (
                  <span key={i} class="lre-gm-assist-op-line">
                    {line}
                  </span>
                ))}
                {open && o.mode === "confirm" ? <span class="lre-gm-assist-op-note">Asks first: it waits for your Apply even when changes apply at once.</span> : null}
                {o.refused ? <span class="lre-gm-assist-op-note lre-neg">Refused: {o.refused.reason}</span> : null}
              </div>
            </div>
          ))}
        </div>
        {open ? (
          <div class="lre-gm-assist-actions">
            <Button variant="primary" icon="check" disabled={props.busy} onClick={props.onApplyAll}>
              Apply all
            </Button>
            {several ? (
              <Button icon="checklist" disabled={props.busy || picked.length === 0} onClick={() => props.onApplyPicked(picked)}>
                {picked.length === 0 ? "Apply picked" : `Apply ${picked.length} picked`}
              </Button>
            ) : null}
            <Button variant="ghost" icon="close" disabled={props.busy} onClick={props.onReject}>
              No
            </Button>
          </div>
        ) : p.status === "rejected" ? (
          <p class="lre-gm-note">You turned these down: nothing changed.</p>
        ) : p.pending ? (
          <p class="lre-gm-note">Applied while a turn runs: it lands once the reply is in, and its Undo shows here then.</p>
        ) : again ? (
          <div class="lre-gm-assist-actions">
            <Button variant="primary" icon="check" disabled={props.busy} onClick={props.onApplyAll}>
              Apply again
            </Button>
            <span class="lre-gm-assist-op-note">Sends only what the turn refused: what landed stays as it is.</span>
          </div>
        ) : props.undone ? (
          <p class="lre-gm-note">{p.ops.some((o) => o.applied && o.undone !== true) && p.ops.some((o) => o.undone) ? "Undone, but for its learned notes: no Undo takes those back." : "Undone: what it changed is back as it was."}</p>
        ) : props.standing ? (
          <div class="lre-gm-assist-actions">
            <Button icon="undo" disabled={props.busy} onClick={props.onUndo}>
              Undo
            </Button>
          </div>
        ) : (
          <p class="lre-gm-note">{p.chipId ? "Applied. Its Undo has passed: a reply came after it." : "Applied."}</p>
        )}
      </GmCard>
    </div>
  );
}

/** The answer under way: its label, the tokens it has spent so far, and Cancel, which never waits for the page's other requests. */
export function RunningRow(props: { run: AssistantRun; onCancel(): void }) {
  const { tokens } = props.run;
  return (
    <div class="lre-gm-assist-run" role="status" data-lre-assistant-running={props.run.agentId}>
      <Icon name="hourglass" size={16} />
      <span class="lre-gm-assist-run-text">
        <span class="lre-gm-assist-run-label">{props.run.label}</span>
        <span class="lre-gm-assist-run-tokens">{tokens.in === 0 && tokens.out === 0 ? "No tokens spent yet" : `${n(tokens.in)} tokens in · ${n(tokens.out)} out so far`}</span>
      </span>
      <Button size="sm" variant="danger" icon="close" onClick={props.onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/** Your next message and Send, kept above GM mode's bar; while an answer runs, the box takes a draft but Send waits for it. */
export function Composer(props: { draft: string; running: boolean; busy: boolean; onDraft(text: string): void; onSend(): void }) {
  const ready = !props.busy && !props.running && props.draft.trim() !== "";
  return (
    <div class="lre-gm-assist-compose" data-lre-assistant-compose>
      <textarea
        class="lre-input lre-gm-prose"
        rows={3}
        aria-label="Your message to the GM assistant"
        aria-keyshortcuts="Control+Enter Meta+Enter"
        placeholder="Ask about this chat's world, or ask it to change something…"
        value={props.draft}
        onInput={(event) => props.onDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          // Ctrl+Enter (⌘+Enter on a Mac) sends; Enter alone starts a new line.
          if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
          event.preventDefault();
          if (ready) props.onSend();
        }}
      />
      <div class="lre-gm-assist-compose-row">
        <span class="lre-gm-note">{props.running ? "It's still answering: wait for it, or Cancel it, to send another." : "Ctrl+Enter sends."}</span>
        <Button variant="primary" icon="send" disabled={!ready} onClick={props.onSend}>
          Send
        </Button>
      </div>
    </div>
  );
}

/**
 * The conversation: each message in order, each proposal under the answer that made it, the answer
 * under way, and your next message. `edits` is the GM view's, whose chips tell whether an applied
 * proposal's Undo still stands; `undone` the chips used here.
 */
export function AssistantThread(props: { view: AssistantView; edits: GmView["edits"]; picked: Readonly<Record<string, readonly string[]>>; undone: readonly string[]; draft: string; busy: boolean; on: AssistantHandlers }) {
  const { view, on } = props;
  const running = view.running;
  const ids = new Set(view.thread.map((m) => m.id));
  const card = (p: AssistantProposal) => (
    <ProposalCard
      key={p.id}
      proposal={p}
      picked={props.picked[p.id] ?? []}
      standing={p.chipId !== undefined && props.edits.some((e) => e.undo === p.chipId)}
      undone={p.undone === true || (p.chipId !== undefined && props.undone.includes(p.chipId))}
      busy={props.busy}
      onPick={(key, picked) => on.pick(p.id, key, picked)}
      onApplyAll={() => on.applyAll(p.id)}
      onApplyPicked={(keys) => on.applyPicked(p.id, keys)}
      onReject={() => on.reject(p.id)}
      onUndo={() => {
        if (p.chipId !== undefined) on.undo(p.chipId);
      }}
    />
  );
  return (
    <div class="lre-stack lre-gm-assist" data-lre-assistant={running ? "running" : view.thread.length === 0 ? "empty" : "idle"}>
      {view.thread.length === 0 && running === null ? (
        <Empty
          icon="message"
          title="Ask the GM assistant"
          action={
            <Button size="sm" icon="sliders" onClick={on.settings}>
              Assistant settings
            </Button>
          }
        >
          It looks things up in this chat's world with the engine's own tools and answers from what they show it, reading with the knowledge Settings → Agents → Assistant gives it. Ask it to change something and it proposes the change for you to apply.
        </Empty>
      ) : (
        <>
          <div class="lre-gm-assist-tools">
            <Button size="sm" variant="ghost" icon="trash" disabled={props.busy || running !== null} onClick={on.clear}>
              Clear
            </Button>
          </div>
          <div class="lre-gm-assist-thread" role="log" aria-label="Your conversation with the GM assistant">
            {view.thread.map((m) => (
              <MessageView key={m.id} message={m}>
                {view.proposals.filter((p) => p.messageId === m.id).map(card)}
              </MessageView>
            ))}
            {view.proposals.filter((p) => !ids.has(p.messageId)).map(card)}
          </div>
        </>
      )}
      {running ? <RunningRow run={running} onCancel={on.cancel} /> : null}
      <Composer draft={props.draft} running={running !== null} busy={props.busy} onDraft={on.draft} onSend={on.send} />
    </div>
  );
}

// ---------------------------------------------------------------- the tab

/** GM → Assistant: the chat's thread, asked for when the tab shows and kept live by its pushes. */
export function AssistantSection(props: GmSectionProps) {
  const app = useApp();
  const [view, setView] = useState<AssistantView | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [undone, setUndone] = useState<readonly string[]>([]);
  const [busy, run] = useBusy();
  // Every change the backend makes to the thread is pushed, so a request answered after a push came is older than that push.
  const pushes = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setFailed(false);
    const off = app.client.onAssistant((update) => {
      if (update.chatId !== props.chatId) return;
      pushes.current += 1;
      setView(update.view);
    });
    const at = pushes.current;
    void app.request<"lre.assistant">({ type: "lre.assistant", op: "get", chatId: props.chatId }).then((next) => {
      if (!live) return;
      if (next === null) setFailed(pushes.current === at);
      else if (pushes.current === at) setView(next);
    });
    return () => {
      live = false;
      off();
    };
  }, [props.chatId, tries]);
  // Another chat's thread is another conversation: nothing typed or picked carries over.
  useEffect(() => {
    setView(null);
    setDraft("");
    setPicked({});
    setUndone([]);
  }, [props.chatId]);
  // The newest message, or the answer starting, scrolls into view at the foot of the thread.
  const count = view === null ? -1 : view.thread.length;
  const answering = view !== null && view.running !== null;
  useLayoutEffect(() => {
    const el = root.current;
    const scroller = count >= 0 && el ? scrollParent(el) : null;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [count, answering]);
  const on = assistantHandlers(props.chatId, {
    ask: async (body) => {
      const at = pushes.current;
      const next = await app.request<"lre.assistant">(body);
      if (next === null) return false;
      if (pushes.current === at) setView(next);
      return true;
    },
    undo: async (chipId) => {
      if ((await app.request({ type: "lre.chip", chatId: props.chatId, chip: chipId, choice: "undo" })) === null) return false;
      app.toast("Undone.", "info");
      await props.reload();
      return true;
    },
    run,
    confirmClear: () => app.host.confirm("Clear the conversation", "Forget this chat's conversation with the GM assistant, with the changes it proposed that you haven't applied? Changes you applied stay, with their Undo.", "danger", "Clear"),
    openSettings: () => app.ui.update((ui) => ({ ...ui, mode: "settings", settings: { page: "assistant" } })),
    draft,
    setDraft,
    picked,
    setPicked,
    undone: (chipId) => setUndone((now) => (now.includes(chipId) ? now : [...now, chipId])),
  });
  return (
    <div ref={root} class="lre-gm-assist-tab" data-lre-gm-section="assistant">
      {view ? (
        <AssistantThread view={view} edits={props.gm.edits} picked={picked} undone={undone} draft={draft} busy={busy || props.busy} on={on} />
      ) : failed ? (
        <Empty
          icon="alert"
          title="The conversation didn't load"
          action={
            <Button size="sm" icon="refresh" onClick={() => setTries((t) => t + 1)}>
              Try again
            </Button>
          }
        >
          The engine didn't answer with this chat's conversation.
        </Empty>
      ) : (
        <Empty icon="hourglass">Loading the conversation…</Empty>
      )}
    </div>
  );
}

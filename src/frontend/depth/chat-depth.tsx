// GM → This chat → Depth (DEPTH-PLAN §8 "Nothing breaks", §7): whether this chat runs on depth.
// Off, it says what depth does and offers the bootstrap with its estimate before anything runs:
// calls, tokens, money and time per stage on the models Settings → Depth sets, with the run's cap.
// Turning depth on with the bootstrap starts it in the background; without it, the history isn't
// read and the minds and the notebook start empty. On, it says how the bootstrap stands, opens it in
// GM → Depth, and turns depth off again (nothing depth wrote is deleted; the chat goes back to
// today's engine). Turning it on is refused while this user can't play it (no relay Running, no
// loopback key, no loopback connection: Settings → Loopback's own health), said with a way there.
// The body is hook-free; `DepthThisChat` holds the requests.

import { useState } from "preact/hooks";
import type { BootstrapCap, BootstrapEstimate, BootstrapView } from "../../shared/bootstrap";
import { HISTORY_CUT_DEFAULT, HISTORY_KEEP_DEFAULT, HISTORY_KEEP_MOST, historyCutWords, type HistoryCut } from "../../shared/depth-history";
import { DEPTH_TREATMENT_LABEL, DEPTH_TREATMENTS, type DepthLimit, type DepthTreatment } from "../../shared/depth-settings";
import { useApp } from "../app";
import { Badge, Banner, Button, Empty, NumberStepper, Section, Seg, useBusy } from "../components";
import { gmOpen } from "../gm/nav";
import { CapControl, capText, EstimateView, EXPORT_NOTE, startCap, STATUS_LABEL, useBootstrap } from "./bootstrap";

/** The GM tab the depth views live in, and its Bootstrap tab (opened through GM mode's focus). */
export const DEPTH_SECTION = "core.depth";

/** What This chat → Depth's controls do. */
export interface DepthChatControls {
  busy: boolean;
  cap: BootstrapCap | "none";
  onCap(cap: BootstrapCap | "none"): void;
  onEstimate(): void;
  /** Turns depth on; with the bootstrap, starts it under `cap`. */
  onOptIn(bootstrap: boolean): void;
  onOptOut(): void;
  onOpenBootstrap(): void;
  /** Opens Settings → Loopback, where what the opt-in's refusal names is put right. */
  onOpenLoopback(): void;
  /** Sets the chat's history cutoff (History): what a depth turn's request leaves out. */
  onHistory(cut: HistoryCut): void;
  /** Sets the chat's own allowances (Allowances), over yours in Settings → Depth → Budget; none set goes back to yours. */
  onAllowances?(allowances: Partial<Record<DepthTreatment, DepthLimit>>): void;
}

/** History: which of the chat's messages a depth turn's request carries; the rest stay out of it, and the author and the GM search and quote them on demand. */
function HistorySection(props: { cut: Readonly<HistoryCut>; c: DepthChatControls }) {
  const { cut, c } = props;
  return (
    <Section title="History">
      <p class="lre-small lre-muted" data-lre-depth-history="">{`A turn's request carries ${historyCutWords(cut)} of this chat; every message before that stays out of it. The author and the GM search and quote the whole chat whenever a turn needs something older.`}</p>
      <Seg
        label="Hide messages before"
        value={cut.keep}
        disabled={c.busy}
        options={[
          { value: "last", label: "Keep the latest" },
          { value: "from", label: "From a message on" },
        ]}
        onChange={(keep) => c.onHistory(keep === "last" ? { keep, count: cut.keep === "last" ? cut.count : HISTORY_KEEP_DEFAULT } : { keep, index: cut.keep === "from" ? cut.index : 0 })}
      />
      {cut.keep === "last" ? (
        <NumberStepper label="Messages kept" value={cut.count} min={1} max={HISTORY_KEEP_MOST} integer disabled={c.busy} onChange={(count) => c.onHistory({ keep: "last", count })} />
      ) : (
        <NumberStepper label="Hide messages before #" value={cut.index} min={0} integer disabled={c.busy} onChange={(index) => c.onHistory({ keep: "from", index })} />
      )}
    </Section>
  );
}

/** Allowances: the parts each treatment may spend per story interval in this chat, over yours. */
function AllowancesSection(props: { a: NonNullable<BootstrapView["allowances"]>; c: DepthChatControls }) {
  const { a, c } = props;
  const set = c.onAllowances;
  if (!set) return null;
  const own = Object.keys(a.own).length > 0;
  const words = (l: DepthLimit): string => (l === "none" ? "no limit" : String(l));
  return (
    <Section title="Allowances">
      <p class="lre-small lre-muted" data-lre-depth-allowances="">{`How many parts of each treatment the world beyond view may spend per story ${a.interval} in this chat. A treatment this chat doesn't set keeps yours (Settings → Depth → Budget); the ceilings stay yours.`}</p>
      {DEPTH_TREATMENTS.map((t) => {
        const mine = a.own[t];
        const shown = mine ?? a.yours[t];
        return <NumberStepper key={t} label={`${DEPTH_TREATMENT_LABEL[t]} (${mine === undefined ? "yours" : `this chat; yours: ${words(a.yours[t])}`})`} value={shown === "none" ? 0 : shown} min={0} max={1000} integer disabled={c.busy} onChange={(n) => set({ ...a.own, [t]: n })} />;
      })}
      {own ? (
        <Button icon="close" busy={c.busy} onClick={() => set({})}>
          Use your allowances
        </Button>
      ) : null}
    </Section>
  );
}

/** GM → This chat → Depth's body, hook-free. `unready`: why the opt-in was refused (no relay Running, no key, no loopback connection), shown with Settings → Loopback. */
export function DepthChatBody(props: { view: BootstrapView; estimate: BootstrapEstimate | null; unready?: string | null; c: DepthChatControls }) {
  const { view, c } = props;
  const estimate = props.estimate ?? view.remaining;
  if (view.optedIn) {
    const status = STATUS_LABEL[view.status];
    return (
      <div class="lre-stack lre-depth-chat" data-lre-depth-chat="on">
        <div class="lre-depth-status">
          <Badge tone="pos">Depth is on</Badge>
          <span class="lre-small lre-muted">{`Bootstrap: ${status.label.toLowerCase()} · ${view.chunks.done} of ${view.chunks.total} chunks`}</span>
        </div>
        <p class="lre-small lre-muted lre-depth-note">The author runs each scene, characters play from their own minds, and the GM keeps the truth. Every mind, the notebook and the bootstrap are yours to read in GM → Minds and GM → Depth.</p>
        <p class="lre-small lre-muted lre-depth-export" data-lre-depth-export="">{EXPORT_NOTE}</p>
        <div class="lre-inline">
          <Button variant="primary" icon="layers" onClick={c.onOpenBootstrap}>
            Open the bootstrap
          </Button>
        </div>
        <HistorySection cut={view.history ?? HISTORY_CUT_DEFAULT} c={c} />
        {view.allowances ? <AllowancesSection a={view.allowances} c={c} /> : null}
        <Section title="Turn depth off">
          <p class="lre-small lre-muted">The chat goes back to today's engine. Nothing depth wrote is deleted: turning it on again picks up where it was.</p>
          <Button variant="danger" icon="close" busy={c.busy} onClick={c.onOptOut}>
            Turn depth off
          </Button>
        </Section>
      </div>
    );
  }
  return (
    <div class="lre-stack lre-depth-chat" data-lre-depth-chat="off">
      <div class="lre-depth-status">
        <Badge>Depth is off</Badge>
      </div>
      <p class="lre-small lre-depth-note">Depth simulates this chat: an author who runs each scene and keeps a notebook of where the story points, characters who play and remember from minds of their own, and a GM who resolves what they try and keeps the truth. Nothing changes until you turn it on.</p>
      <Section title="The bootstrap">
        <div class="lre-stack">
          <p class="lre-small lre-muted">It reads this chat's history once, oldest first, in the background: canon beats from the prose, each character's mind from what they lived, the author's notebook chapter by chapter, your World Info and memory entries reconciled. You review spot checks as it goes; play goes on meanwhile.</p>
          {estimate ? (
            <EstimateView estimate={estimate} />
          ) : (
            <Empty icon="hourglass" title="Not surveyed yet">
              The estimate reads the chat once, with no model call.
            </Empty>
          )}
          <Button icon="refresh" busy={c.busy} onClick={c.onEstimate}>
            {estimate ? "Estimate again" : "Survey and estimate"}
          </Button>
          <CapControl cap={c.cap} estimate={estimate} busy={c.busy} onCap={c.onCap} />
          <p class="lre-small lre-muted">{`At its cap (${capText(c.cap)}) the run pauses and says what the rest would cost. Every model it uses is set in Settings → Depth.`}</p>
        </div>
      </Section>
      <div class="lre-stack">
        <Button variant="primary" icon="play" busy={c.busy} disabled={estimate === null} onClick={() => c.onOptIn(true)}>
          Turn on depth and start the bootstrap
        </Button>
        <Button variant="secondary" disabled={c.busy} onClick={() => c.onOptIn(false)}>
          Turn on depth without the bootstrap
        </Button>
        <p class="lre-small lre-muted">Without the bootstrap the history isn't read: the minds and the notebook start empty, from the next scene on.</p>
      </div>
      {props.unready ? (
        <div data-lre-depth-unready>
          <Banner
            tone="warn"
            title="Depth needs the loopback"
            actions={
              <Button size="sm" variant="primary" icon="route" onClick={c.onOpenLoopback}>
                Settings → Loopback
              </Button>
            }
          >
            {props.unready}
          </Banner>
        </div>
      ) : null}
      {view.reason ? <Banner tone="warn">{view.reason}</Banner> : null}
    </div>
  );
}

/** GM → This chat → Depth: the opt-in, its estimate and the run's cap. */
export function DepthThisChat(props: { chatId: string }) {
  const app = useApp();
  const run = useBootstrap(props.chatId);
  const [busy, go] = useBusy();
  const [cap, setCap] = useState<BootstrapCap | "none" | null>(null);
  if (run.view === undefined) return <Empty icon="hourglass">Reading this chat's depth…</Empty>;
  if (run.view === null) return <Empty icon="layers">This chat's depth couldn't be read.</Empty>;
  const view = run.view;
  const chosen = cap ?? startCap(view, run.settingsCap);
  const c: DepthChatControls = {
    busy,
    cap: chosen,
    onCap: setCap,
    onEstimate: () => go(() => run.ask({ op: "estimate" })),
    onOptIn: (bootstrap) =>
      go(async () => {
        if (!(await run.ask({ op: "opt", on: true }))) return;
        if (bootstrap) await run.ask({ op: "start", cap: chosen });
      }),
    onOptOut: () =>
      go(async () => {
        if (await app.host.confirm("Turn depth off", "The chat goes back to today's engine. Nothing depth wrote is deleted.", "warning", "Turn off")) await run.ask({ op: "opt", on: false });
      }),
    onOpenBootstrap: () => app.ui.update((ui) => gmOpen(ui, DEPTH_SECTION, "bootstrap")),
    onOpenLoopback: () => app.ui.update((ui) => ({ ...ui, mode: "settings", settings: { page: "loopback" } })),
    onHistory: (cut) => go(() => run.ask({ op: "history", cut })),
    onAllowances: (allowances) => go(() => run.ask({ op: "allowances", allowances })),
  };
  return <DepthChatBody view={view} estimate={run.estimate} unready={run.unready} c={c} />;
}

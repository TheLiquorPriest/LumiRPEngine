// GM → Depth → Treatments (DEPTH-PLAN §6.5, §7): what got which depth and why, what it cost, and what
// the budget dial leaves. On top, the asks waiting on you ("Ask me"), answered here as their chips
// under the replies answer them. Then three views: the Log, newest first (each turn's scene with the
// effort each character played at and the author's reason, each step after a reply, each episode off
// screen with each part's treatment and the author's grade, each ask with your answer; each with what
// it cost and every line a ceiling put off); the Meter, per story interval (per lane, per treatment
// off screen, per role); and the Budget (the ceilings, a UTC day for today's; this story interval's
// allowances; Ask me and the threshold). The author grades; the allowances and ceilings bind.
// Nothing is withheld (§1.4, D-9). The body is hook-free; `TreatmentsView` holds the requests.

import { useEffect, useState } from "preact/hooks";
import { DEPTH_ROLE_WORDS, DEPTH_THRESHOLD_LEVEL_WORDS, DEPTH_TREATMENT_LABEL } from "../../shared/depth-settings";
import { costText, DEPTH_LANE_LABEL, DEPTH_LOG_KIND_LABEL, DEPTH_LOG_STATE_LABEL, type DepthLogState, type DepthTreatmentsView, tokensText } from "../../shared/depth-views";
import type { MessageId } from "../../shared/ids";
import { useApp } from "../app";
import { Badge, Button, Disclosure, Empty, Meter, Section, Seg, useBusy } from "../components";
import { ActionRow, ActionRows, GmCard } from "../gm/ui";
import type { GmSectionProps } from "../registry";

export type TreatmentsTab = "log" | "meter" | "budget";

const TAB_LABEL: Readonly<Record<TreatmentsTab, string>> = { log: "Log", meter: "Meter", budget: "Budget" };

const STATE_TONE: Readonly<Record<DepthLogState, "accent" | "pos" | "warn" | "neutral">> = { open: "accent", settled: "pos", dropped: "neutral", waiting: "warn", spent: "accent", kept: "neutral" };

/** What the Treatments view's controls do. */
export interface TreatmentsControls {
  busy: boolean;
  tab: TreatmentsTab;
  onTab(tab: TreatmentsTab): void;
  /** Answers an ask as its chip would: the chip's id and the button's. */
  onAnswer(chip: string, choice: string): void;
  onJump(messageId: MessageId): void;
}

function LogTab(props: { view: DepthTreatmentsView; c: TreatmentsControls }) {
  const { view, c } = props;
  if (view.log.length === 0) return <Empty icon="list">Nothing yet: each turn's scene, the step after its reply and the work off screen land here as they run.</Empty>;
  return (
    <div class="lre-stack" data-lre-depth-log>
      {view.log.map((e, i) => (
        <div key={i} data-lre-depth-log-entry={e.kind}>
          <GmCard
            title={e.title}
            subtitle={[e.when, `message ${e.at.index}`].filter((s) => s !== null).join(" · ")}
            badges={
              <>
                <Badge>{DEPTH_LOG_KIND_LABEL[e.kind]}</Badge>
                {e.state ? <Badge tone={STATE_TONE[e.state]}>{DEPTH_LOG_STATE_LABEL[e.state]}</Badge> : null}
              </>
            }
          >
            {e.lines.length > 0 ? (
              <ActionRows label={e.title}>
                {e.lines.map((l, j) => (
                  <ActionRow key={j} title={l.subject} subtitle={l.why.trim() || undefined} value={l.depth} />
                ))}
              </ActionRows>
            ) : null}
            {e.cost ? <p class="lre-small lre-muted lre-depth-note">{costText(e.cost)}</p> : null}
            {e.put.length > 0 ? (
              <div class="lre-stack lre-depth-put" data-lre-depth-put>
                <span class="lre-small lre-depth-put-head">Put off by a ceiling</span>
                <ul class="lre-depth-notes">
                  {e.put.map((p, j) => (
                    <li key={j}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div class="lre-inline">
              <Button size="sm" variant="ghost" icon="external" label={`Go to message ${e.at.index}`} onClick={() => c.onJump(e.at.messageId)}>
                Go to the message
              </Button>
            </div>
          </GmCard>
        </div>
      ))}
    </div>
  );
}

function MeterTab(props: { view: DepthTreatmentsView }) {
  const { view } = props;
  if (view.meter.length === 0) return <Empty icon="coins">Nothing spent on this chat's chain yet.</Empty>;
  return (
    <div class="lre-stack" data-lre-depth-meter>
      <p class="lre-small lre-muted lre-depth-note">Spend folds with the work it paid for: a swipe that discarded a turn gives back what it spent here. Today's ceiling counts what was spent, discarded or not.</p>
      {view.meter.map((m) => (
        <div key={m.label} data-lre-depth-meter-row={m.label}>
          <GmCard title={m.label} subtitle={costText(m.total)} badges={m.now ? <Badge tone="accent">Now</Badge> : undefined}>
            <ActionRows label={`${m.label}, per lane`}>
              {m.lanes.map((l) => (
                <ActionRow key={l.lane} title={DEPTH_LANE_LABEL[l.lane]} subtitle={costText(l.cost)} />
              ))}
            </ActionRows>
            {m.treatments.length > 0 ? (
              <>
                <h4 class="lre-depth-subhead">Off screen, per treatment</h4>
                <ActionRows label={`${m.label}, per treatment`}>
                  {m.treatments.map((t) => (
                    <ActionRow key={t.treatment} title={DEPTH_TREATMENT_LABEL[t.treatment]} subtitle={costText(t.cost)} value={`${t.episodes} ${t.episodes === 1 ? "episode" : "episodes"}`} />
                  ))}
                </ActionRows>
              </>
            ) : null}
            {m.roles.length > 0 ? (
              <Disclosure summary="Per role">
                <ActionRows label={`${m.label}, per role`}>
                  {m.roles.map((r) => (
                    <ActionRow key={r.role} title={DEPTH_ROLE_WORDS[r.role].label} subtitle={costText(r.cost)} />
                  ))}
                </ActionRows>
              </Disclosure>
            ) : null}
            {m.grades.length > 0 ? (
              <>
                <h4 class="lre-depth-subhead">The author's grades</h4>
                <ActionRows label={`${m.label}, grades`}>
                  {m.grades.map((g, i) => (
                    <ActionRow key={`${g.episode}:${g.subject}:${i}`} title={`${g.subject}: ${g.depth}`} subtitle={g.why.trim() === "" ? g.episode : `${g.episode}. ${g.why}`} />
                  ))}
                </ActionRows>
              </>
            ) : null}
          </GmCard>
        </div>
      ))}
    </div>
  );
}

function BudgetTab(props: { view: DepthTreatmentsView }) {
  const { view } = props;
  return (
    <div class="lre-stack" data-lre-depth-budget>
      <Section title="Ceilings">
        <div class="lre-stack">
          {view.ceilings.map((ce) => {
            const label = ce.which === "turn" ? "Per turn" : "Per day";
            return (
              <div key={ce.which} class="lre-stack lre-depth-ceiling" data-lre-depth-ceiling={ce.which}>
                {ce.limit === null ? <span class="lre-depth-ceiling-label">{`${label}: no limit`}</span> : <Meter label={label} value={ce.spent} max={ce.limit} tone={ce.reached ? "warn" : "accent"} />}
                <span class="lre-small">{ce.limit === null ? `${tokensText(ce.spent)} tokens` : `${tokensText(ce.spent)} of ${tokensText(ce.limit)} tokens`}</span>
                <span class="lre-small lre-muted lre-depth-note">{ce.of}</span>
                {ce.reached ? <Badge tone="warn">{ce.which === "day" ? "Reached: the author's own work waits for the next UTC day" : "Reached: the turn spent no more"}</Badge> : null}
              </div>
            );
          })}
          <p class="lre-small lre-muted lre-depth-note">The ceilings bind the author's own work: once one binds, it starts nothing more and says what it put off. Your own presses always run, and are counted.</p>
        </div>
      </Section>
      <Section title="Allowances">
        <div class="lre-stack">
          <span class="lre-small lre-muted">{view.interval}</span>
          {view.allowances.map((a) => (
            <div key={a.treatment} class="lre-stack lre-depth-allowance" data-lre-depth-allowance={a.treatment}>
              {a.allowance === null ? <span class="lre-depth-ceiling-label">{DEPTH_TREATMENT_LABEL[a.treatment]}</span> : <Meter label={DEPTH_TREATMENT_LABEL[a.treatment]} value={a.spent} max={a.allowance} tone={a.spent >= a.allowance ? "warn" : "accent"} />}
              <span class="lre-small">{a.allowance === null ? `${a.spent} spent · no limit` : `${a.spent} of ${a.allowance} spent`}</span>
            </div>
          ))}
          <p class="lre-small lre-muted lre-depth-note">{view.ask ? "Ask me is on: where the author judges a moment major and its treatment's allowance is spent, it asks you before spending more." : "Ask me is off: a part past its treatment's allowance slides down the ladder (live, campfire, room, written), said in its grade."}</p>
        </div>
      </Section>
      <Section title="What deserves more than written">
        <div class="lre-stack">
          <p class="lre-depth-reasoning">{`${DEPTH_THRESHOLD_LEVEL_WORDS[view.level].label}: ${view.threshold.trim() === "" ? "no words given." : view.threshold}`}</p>
          <p class="lre-small lre-muted lre-depth-note">Your level and words, which the author grades each candidate against; every grade shows in the log and on the Meter with its reason. Settings → Depth → Budget sets these.</p>
        </div>
      </Section>
    </div>
  );
}

/** GM → Depth → Treatments' body, hook-free. */
export function TreatmentsBody(props: { view: DepthTreatmentsView; c: TreatmentsControls }) {
  const { view, c } = props;
  if (!view.on && view.log.length === 0) {
    return (
      <Empty icon="layers" title="This chat doesn't run on depth">
        Opt in at GM → This chat → Depth: what each scene and episode got, and what it cost, shows here as it runs.
      </Empty>
    );
  }
  return (
    <div class="lre-stack lre-depth-treatments" data-lre-depth-treatments>
      <p class="lre-small lre-muted lre-depth-note">What got which depth and why, what it cost, and what the budget dial leaves. The author grades; the allowances and ceilings bind.</p>
      {view.asks.length > 0 ? (
        <Section title={`Waiting on you (${view.asks.length})`}>
          <div class="lre-stack" data-lre-depth-asks>
            {view.asks.map((a) => (
              <div key={a.chip} data-lre-depth-ask={a.chip}>
                <GmCard title={a.label} subtitle={`At message ${a.at.index}`}>
                  {a.detail !== "" ? <p class="lre-depth-reasoning">{a.detail}</p> : null}
                  <div class="lre-inline">
                    {a.actions.map((x) => (
                      <Button key={x.id} size="sm" variant={x.primary ? "primary" : "secondary"} disabled={c.busy} onClick={() => c.onAnswer(a.chip, x.id)}>
                        {x.label}
                      </Button>
                    ))}
                    <Button size="sm" variant="ghost" icon="external" label={`Go to message ${a.at.index}`} onClick={() => c.onJump(a.at.messageId)}>
                      Message
                    </Button>
                  </div>
                </GmCard>
              </div>
            ))}
          </div>
        </Section>
      ) : null}
      <Seg<TreatmentsTab> label="Treatments" value={c.tab} options={(["log", "meter", "budget"] as const).map((t) => ({ value: t, label: TAB_LABEL[t] }))} onChange={c.onTab} />
      {c.tab === "log" ? <LogTab view={view} c={c} /> : c.tab === "meter" ? <MeterTab view={view} /> : <BudgetTab view={view} />}
    </div>
  );
}

/** GM → Depth → Treatments: read again when the chat moves on; an ask's answer goes as its chip's, and the episode drafts in the background. */
export function TreatmentsView(props: { section: GmSectionProps }) {
  const { section } = props;
  const app = useApp();
  const [view, setView] = useState<DepthTreatmentsView | null | undefined>(undefined);
  const [tab, setTab] = useState<TreatmentsTab>("log");
  const [busy, run] = useBusy();
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    void app.request<"lre.depth">({ type: "lre.depth", chatId: section.chatId, op: "treatments" }).then((result) => {
      if (live) setView(result?.treatments ?? null);
    });
    return () => {
      live = false;
    };
  }, [section.chatId, section.reloadKey, nonce]);
  if (view === undefined) return <Empty icon="hourglass">Reading the treatments…</Empty>;
  if (view === null) return <Empty icon="list">The treatments couldn't be read.</Empty>;
  const c: TreatmentsControls = {
    busy,
    tab,
    onTab: setTab,
    onAnswer: (chip, choice) =>
      run(async () => {
        const result = await app.request<"lre.chip">({ type: "lre.chip", chatId: section.chatId, chip, choice });
        if (!result) return;
        app.toast(`Answered: the author drafts the episode in the background, and GM → Depth → Drafts shows it once it lands.${result.pending ? " Your answer lands once the reply being written is kept." : ""}`, "info");
        setNonce((k) => k + 1);
      }),
    onJump: (messageId) => {
      if (!app.host.revealMessage(messageId)) app.toast("That message isn't on screen in this chat.", "info");
    },
  };
  return <TreatmentsBody view={view} c={c} />;
}

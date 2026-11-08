// GM → Depth → Bootstrap (DEPTH-PLAN §8, §7; `shared/bootstrap.ts`): onboarding this chat's history
// into depth, shown whole. Its state and why it stopped; Start, Pause and Resume, with the run's
// cap; progress per stage and per chapter; what it spent against the cap and what the rest would
// cost; what the import read; the spot-check cards, each thing it made beside what it came from,
// for you to mark right or wrong with a word on what's wrong; Redo from a chapter after a run of
// wrong marks, or after a chunk's new beats couldn't take the place of the old; the advice about the
// memory systems it replaces (D-18); and its log. It follows the
// run's pushes (`lre.bootstrap.update`). The body is hook-free; `BootstrapPanel` holds the requests.

import { useEffect, useState } from "preact/hooks";
import { BOOTSTRAP_STAGES, type BootstrapCap, type BootstrapEstimate, type BootstrapOp, type BootstrapStage, type BootstrapStatus, type BootstrapView, type SpotCheckCard, type SpotItem } from "../../shared/bootstrap";
import { countsText, durationText, tokensText } from "../../shared/depth-views";
import type { MessageId } from "../../shared/ids";
import { useApp } from "../app";
import { Badge, Banner, Button, Disclosure, Empty, Field, HostSwitch, Meter, NumberStepper, Section, Seg, useBusy } from "../components";
import { ActionRow, ActionRows, GmCard } from "../gm/ui";
import type { GmSectionProps } from "../registry";
import { MisreadFields } from "./misread";

export const STAGE_LABEL: Readonly<Record<BootstrapStage, string>> = {
  survey: "Survey",
  import: "Import",
  historian: "Canon beats",
  author: "The author's chapters",
  pov: "Points of view",
  minds: "Minds",
  truthlink: "Truth links",
  reconcile: "Reconcile",
};

export const STATUS_LABEL: Readonly<Record<BootstrapStatus, { label: string; tone: "neutral" | "accent" | "pos" | "neg" | "warn" }>> = {
  idle: { label: "Not surveyed", tone: "neutral" },
  estimated: { label: "Ready to start", tone: "accent" },
  running: { label: "Running", tone: "accent" },
  pausing: { label: "Pausing", tone: "warn" },
  paused: { label: "Paused", tone: "warn" },
  done: { label: "Done", tone: "pos" },
  failed: { label: "Stopped", tone: "neg" },
};

const SOURCE_LABEL: Readonly<Record<string, string>> = { world_lore: "The world's lore", world_info: "World Info", lumibooks: "Lumibooks", summary: "Summaries", cortex: "Memory Cortex", lre_minds: "Today's minds" };

/** A cap in words: "20M tokens", "$15.00", "No cap". */
export function capText(cap: BootstrapCap | "none" | null): string {
  if (cap === null || cap === "none") return "No cap";
  return cap.unit === "money" ? `$${cap.value.toFixed(2)}` : `${tokensText(cap.value)} tokens`;
}

/** How much of the cap is spent, 0 to 1; null with no cap or no price to measure it by. */
export function capUsed(view: Pick<BootstrapView, "cap" | "spent">): number | null {
  const cap = view.cap;
  if (!cap || cap.value <= 0) return null;
  if (cap.unit === "tokens") return Math.min(1, (view.spent.tokensIn + view.spent.tokensOut) / cap.value);
  return view.spent.cost === null ? null : Math.min(1, view.spent.cost / cap.value);
}

/** Resident memory as the view says it: "312 MB". */
export function mbText(bytes: number): string {
  return `${Math.round(bytes / 1_048_576).toLocaleString("en-US")} MB`;
}

/** Whether a cap of `cap` would stop the run before what `estimate` projects is done: the projection passes it. */
export function capPassed(cap: BootstrapCap | "none", estimate: BootstrapEstimate | null): boolean {
  if (cap === "none" || !estimate) return false;
  if (cap.unit === "tokens") return estimate.total.tokensIn + estimate.total.tokensOut > cap.value;
  return estimate.total.cost !== null && estimate.total.cost > cap.value;
}

/**
 * The run's cap, set before it starts or resumes: none, or tokens or money and how much. Money is
 * offered only where the estimate is priced (every stage's connection reports a price): a money cap
 * can't bind otherwise. It warns when the estimate passes the cap.
 */
export function CapControl(props: { cap: BootstrapCap | "none"; estimate: BootstrapEstimate | null; busy: boolean; onCap(cap: BootstrapCap | "none"): void }) {
  const cap = props.cap === "none" ? null : props.cap;
  const priced = props.estimate !== null && props.estimate.total.cost !== null;
  const units: { value: "tokens" | "money"; label: string }[] = priced || cap?.unit === "money" ? [{ value: "tokens", label: "Tokens" }, { value: "money", label: "Money" }] : [{ value: "tokens", label: "Tokens" }];
  return (
    <div class="lre-stack lre-depth-cap" data-lre-depth-cap>
      <HostSwitch label="No cap" checked={cap === null} disabled={props.busy} onChange={(none) => props.onCap(none ? "none" : { unit: "tokens", value: 20_000_000 })} />
      {cap ? (
        <>
          <Seg<"tokens" | "money"> label="Cap in" value={cap.unit} options={units} disabled={props.busy} onChange={(unit) => props.onCap({ unit, value: unit === cap.unit ? cap.value : unit === "money" ? 20 : 20_000_000 })} />
          <NumberStepper label={cap.unit === "money" ? "Cap (in your connection's money)" : "Cap (tokens)"} value={cap.value} min={1} step={cap.unit === "money" ? 5 : 1_000_000} integer={cap.unit === "tokens"} disabled={props.busy} onChange={(value) => props.onCap({ unit: cap.unit, value })} />
          {!priced ? (
            <p class="lre-small lre-muted" data-lre-depth-cap-unpriced="">
              {cap.unit === "money" ? "A money cap can't bind here: a connection the run uses reports no price, so the run stops at its first such call. Cap it in tokens." : "The cap is in tokens: a connection the run uses reports no price, so a money cap couldn't bind."}
            </p>
          ) : null}
        </>
      ) : null}
      {capPassed(props.cap, props.estimate) ? (
        <Banner tone="warn" title="The estimate passes the cap">
          {`The run would pause at its cap (${capText(props.cap)}) before it is done. Raise the cap, give fewer characters a mind, or pick cheaper models in Settings → Depth.`}
        </Banner>
      ) : null}
    </div>
  );
}

/** An estimate, stage by stage: what each would take on the models Settings → Depth sets, and in all. */
export function EstimateView(props: { estimate: BootstrapEstimate }) {
  const e = props.estimate;
  return (
    <div class="lre-stack" data-lre-depth-estimate>
      <p class="lre-small lre-depth-note">{`${e.messages.toLocaleString("en-US")} ${e.messages === 1 ? "message" : "messages"} · ${e.words.toLocaleString("en-US")} ${e.words === 1 ? "word" : "words"} · ${tokensText(e.tokens)} tokens · ${e.chunks} ${e.chunks === 1 ? "chunk" : "chunks"} · ${e.minds} ${e.minds === 1 ? "mind" : "minds"}`}</p>
      {e.rss !== null ? <p class="lre-small lre-muted lre-depth-note">{`Peak memory so far: ${mbText(e.rss)}. The rest needs about as much: the jobs at once bound it, not the chat's length.`}</p> : null}
      <ActionRows label="The estimate by stage">
        {e.stages.map((s) => (
          <ActionRow key={s.stage} title={STAGE_LABEL[s.stage]} subtitle={[s.connection ?? "The helper model's connection", s.model, s.measured ? "measured on this chat" : "first guess"].filter(Boolean).join(" · ")} value={countsText(s)} />
        ))}
        <ActionRow title="In all" value={countsText(e.total)} />
      </ActionRows>
      {e.notes.length > 0 ? (
        <ul class="lre-depth-notes">
          {e.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** What a spot-check item shows: what the run made, beside what it came from. */
function SpotItemBody(props: { item: SpotItem; onJump(messageId: MessageId): void }) {
  const { item } = props;
  if (item.kind === "beat") {
    return (
      <div class="lre-depth-spot-pair">
        <div class="lre-depth-spot-made">
          <span class="lre-small lre-muted">The beat</span>
          <p>{item.what}</p>
          {item.quotes ? <p class="lre-depth-quote">{item.quotes}</p> : null}
        </div>
        <div class="lre-depth-spot-source">
          <span class="lre-small lre-muted">{`From message ${item.index}`}</span>
          <p class="lre-depth-snippet">{item.prose}</p>
          <Button size="sm" variant="ghost" icon="external" onClick={() => props.onJump(item.message)}>
            Go to the message
          </Button>
        </div>
      </div>
    );
  }
  if (item.kind === "memory") {
    return (
      <div class="lre-depth-spot-pair">
        <div class="lre-depth-spot-made">
          <span class="lre-small lre-muted">{`${item.name}'s memory (${item.path})`}</span>
          <p>{item.text}</p>
        </div>
        <div class="lre-depth-spot-source">
          <span class="lre-small lre-muted">What they lived</span>
          <ul class="lre-depth-beats">
            {item.lived.map((l) => (
              <li key={l.beat} class="lre-depth-beat">
                <span class="lre-depth-beat-text">{l.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  if (item.kind === "notebook") {
    return (
      <div class="lre-depth-spot-pair">
        <div class="lre-depth-spot-made">
          <span class="lre-small lre-muted">{`The notebook (${item.path})`}</span>
          <p>{item.excerpt}</p>
        </div>
        <div class="lre-depth-spot-source">
          <span class="lre-small lre-muted">It cites</span>
          {item.cites.length > 0 ? (
            <ul class="lre-small">
              {item.cites.map((c) => (
                <li key={c.beat}>{c.what || c.beat}</li>
              ))}
            </ul>
          ) : (
            <p>Nothing</p>
          )}
        </div>
      </div>
    );
  }
  return (
    <div class="lre-depth-spot-pair">
      <div class="lre-depth-spot-made">
        <span class="lre-small lre-muted">{`${SOURCE_LABEL[item.source] ?? item.source}: ${item.title}`}</span>
        <p>{item.text}</p>
      </div>
      <div class="lre-depth-spot-source">
        <span class="lre-small lre-muted">Against</span>
        <p>{item.against}</p>
        <p class="lre-small lre-muted">{item.why}</p>
      </div>
    </div>
  );
}

const SPOT_TITLE: Readonly<Record<SpotItem["kind"], string>> = { beat: "A canon beat", memory: "A memory", notebook: "The notebook", contradiction: "A contradiction the import found" };

/** One spot-check card: each item with Right, and Wrong with a word on what's wrong; then, unmarked, the answers the parser didn't keep whole. */
export function SpotCard(props: { card: SpotCheckCard; notes: Readonly<Record<string, string>>; busy: boolean; onNote(item: string, note: string): void; onMark(item: string, right: boolean, note: string): void; onJump(messageId: MessageId): void }) {
  const { card } = props;
  const marked = card.items.filter((i) => i.mark !== null).length;
  return (
    <div data-lre-depth-spot={card.id}>
      <GmCard title={`Chapter ${card.chapter + 1}: spot check`} subtitle={`${marked} of ${card.items.length} marked`}>
        <div class="lre-stack">
          {card.items.map((item) => {
            const note = props.notes[item.id] ?? item.mark?.note ?? "";
            return (
              <div key={item.id} class="lre-depth-spot-item" data-lre-depth-spot-item={item.id} data-lre-marked={item.mark === null ? undefined : item.mark.right ? "right" : "wrong"}>
                <div class="lre-depth-spot-head">
                  <span class="lre-depth-spot-kind">{SPOT_TITLE[item.kind]}</span>
                  {item.flagged ? <Badge tone="warn">Flagged as uncertain</Badge> : null}
                  {item.mark ? <Badge tone={item.mark.right ? "pos" : "neg"}>{item.mark.right ? "Right" : "Wrong"}</Badge> : null}
                </div>
                <SpotItemBody item={item} onJump={props.onJump} />
                <Field label="What's wrong">
                  <input class="lre-input" type="text" value={note} placeholder="A word on what's wrong" disabled={props.busy} aria-label={`What's wrong: ${SPOT_TITLE[item.kind]}`} onInput={(event) => props.onNote(item.id, event.currentTarget.value)} />
                </Field>
                <div class="lre-inline">
                  <Button size="sm" variant={item.mark?.right === true ? "primary" : "secondary"} icon="check" disabled={props.busy} onClick={() => props.onMark(item.id, true, "")}>
                    Right
                  </Button>
                  <Button size="sm" variant={item.mark?.right === false ? "danger" : "secondary"} icon="close" disabled={props.busy || note.trim() === ""} onClick={() => props.onMark(item.id, false, note.trim())}>
                    Wrong
                  </Button>
                </div>
              </div>
            );
          })}
          {card.uncertain && card.uncertain.length > 0 ? (
            <div class="lre-stack" data-lre-depth-spot-uncertain={card.uncertain.length}>
              <Badge tone="warn">Flagged as uncertain, naming no beat</Badge>
              <ul class="lre-small">
                {card.uncertain.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {card.misread && card.misread.length > 0 ? (
            <Disclosure summary={`Answers the parser didn't keep whole (${card.misread.length})`}>
              <div class="lre-stack" data-lre-depth-spot-misread={card.misread.length}>
                <p class="lre-small lre-muted">Each lists the fields of a model's answer the run didn't keep as the model wrote them, since the card before. The answer itself is kept in that job's record.</p>
                {card.misread.map((m, i) => (
                  <div key={i} class="lre-stack">
                    <p class="lre-small">{`${STAGE_LABEL[m.stage]} · ${m.job}${m.call > 0 ? ` · call ${m.call + 1}` : ""}`}</p>
                    <MisreadFields fields={m.fields} count={m.count} />
                  </div>
                ))}
              </div>
            </Disclosure>
          ) : null}
        </div>
      </GmCard>
    </div>
  );
}

/** What the Bootstrap view's controls do. */
export interface BootstrapControls {
  busy: boolean;
  cap: BootstrapCap | "none";
  onCap(cap: BootstrapCap | "none"): void;
  onEstimate(): void;
  onStart(): void;
  onPause(): void;
  onResume(): void;
  notes: Readonly<Record<string, string>>;
  onNote(item: string, note: string): void;
  onMark(card: string, item: string, right: boolean, note: string): void;
  onRedo(chapter: number): void;
  onJump(messageId: MessageId): void;
}

/** Said on every depth chat's Depth and Bootstrap views: an export carries the depth layer in the chat's metadata only while it fits (`layer-carry.ts`), and the bootstrap can't rebuild what live turns made. */
export const EXPORT_NOTE = "An export of this chat carries its depth (minds, beats, notebook) as it stood at the end of the last turn, while that fits in 1 MB compressed. Past that, an imported copy starts without it: keep the original chat.";

/** GM → Depth → Bootstrap's body, hook-free. */
export function BootstrapBody(props: { view: BootstrapView; c: BootstrapControls }) {
  const { view, c } = props;
  const status = STATUS_LABEL[view.status];
  const used = capUsed(view);
  const startable = view.status === "estimated" || view.status === "idle";
  const resumable = view.status === "paused" || view.status === "failed";
  if (!view.optedIn) {
    return (
      <Empty icon="layers" title="This chat doesn't run on depth">
        Opt in at GM → This chat → Depth: it shows what the bootstrap would cost before anything runs.
      </Empty>
    );
  }
  return (
    <div class="lre-stack lre-depth-bootstrap" data-lre-depth-bootstrap={view.status}>
      <div class="lre-depth-status">
        <Badge tone={status.tone}>{status.label}</Badge>
        <span class="lre-small lre-muted">{`${view.chunks.done} of ${view.chunks.total} chunks · ${durationText(view.elapsedMs)} running`}</span>
      </div>
      <p class="lre-small lre-muted lre-depth-export" data-lre-depth-export="">{EXPORT_NOTE}</p>
      {view.reason ? <Banner tone={view.status === "failed" ? "neg" : "warn"}>{view.reason}</Banner> : null}
      {view.redoFrom !== null ? (
        <Banner
          tone="warn"
          title="A redo is offered"
          actions={
            <Button size="sm" variant="primary" busy={c.busy} onClick={() => view.redoFrom !== null && c.onRedo(view.redoFrom)}>
              {`Redo from chapter ${view.redoFrom + 1}`}
            </Button>
          }
        >
          Redo lands new work from that chapter on, which supersedes the old; pick other models in Settings → Depth first if they were the trouble.
        </Banner>
      ) : null}
      <Section title="The run">
        <div class="lre-stack">
          {startable || resumable || view.status === "done" ? <CapControl cap={c.cap} estimate={view.remaining} busy={c.busy} onCap={c.onCap} /> : <p class="lre-small lre-muted">{`Cap: ${capText(view.cap)}`}</p>}
          <div class="lre-inline">
            {startable ? (
              <Button variant="primary" icon="play" busy={c.busy} disabled={view.status === "idle"} onClick={c.onStart}>
                Start
              </Button>
            ) : null}
            {view.status === "idle" || view.status === "estimated" ? (
              <Button icon="refresh" disabled={c.busy} onClick={c.onEstimate}>
                {view.status === "idle" ? "Survey and estimate" : "Estimate again"}
              </Button>
            ) : null}
            {view.status === "running" ? (
              <Button icon="pause" busy={c.busy} onClick={c.onPause}>
                Pause
              </Button>
            ) : null}
            {view.status === "done" ? (
              <Button icon="refresh" busy={c.busy} onClick={c.onResume}>
                Run again
              </Button>
            ) : null}
            {resumable ? (
              <Button variant="primary" icon="play" busy={c.busy} onClick={c.onResume}>
                Resume
              </Button>
            ) : null}
          </div>
          <Meter label="Chunks" value={view.chunks.done} max={Math.max(1, view.chunks.total)} showValue />
          {used !== null ? <Meter label={`Spent of the cap (${capText(view.cap)})`} value={Math.round(used * 100)} max={100} tone={used >= 0.9 ? "warn" : "accent"} showValue /> : null}
          <p class="lre-small lre-muted">{`Spent so far: ${countsText(view.spent)}`}</p>
        </div>
      </Section>
      <Section title="By stage" flush>
        <ActionRows label="Progress by stage">
          {BOOTSTRAP_STAGES.map((stage) => {
            const p = view.progress.find((s) => s.stage === stage);
            return p ? (
              <ActionRow key={stage} title={STAGE_LABEL[stage]} subtitle={[countsText(p.spent), p.rss !== null ? `peak ${mbText(p.rss)}` : null].filter((s) => s !== null).join(" · ")} value={`${p.done} of ${p.total}`} tone={p.total > 0 && p.done >= p.total ? "muted" : undefined}>
                <Meter label={`${STAGE_LABEL[stage]} done`} value={p.done} max={Math.max(1, p.total)} />
              </ActionRow>
            ) : null;
          })}
        </ActionRows>
      </Section>
      {view.chapters.length > 0 ? (
        <Section title="Chapters" flush>
          <ActionRows label="Chapters">
            {view.chapters.map((ch) => (
              <ActionRow
                key={ch.n}
                title={`Chapter ${ch.n + 1}`}
                subtitle={`Chunks ${ch.chunks[0] + 1}–${ch.chunks[1] + 1}${ch.ended ? "" : " · still open"}`}
                value={ch.spot === "waiting" ? <Badge tone="accent">Spot check waiting</Badge> : ch.spot === "reviewed" ? <Badge tone="pos">Reviewed</Badge> : undefined}
                actions={
                  ch.ended && view.status !== "running" && view.status !== "pausing" ? (
                    <Button size="sm" variant="secondary" busy={c.busy} onClick={() => c.onRedo(ch.n)}>
                      {`Redo from chapter ${ch.n + 1}`}
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </ActionRows>
        </Section>
      ) : null}
      {view.spot.length > 0 ? (
        <Section title={`Spot checks (${view.spot.length})`}>
          <div class="lre-stack">
            <p class="lre-small lre-muted lre-depth-note">A sample of what the run made beside what it came from, plus whatever it flagged as uncertain. A wrong beat is a directive: the author amends it and the characters who lived it catch up.</p>
            {view.spot.map((card) => (
              <SpotCard key={card.id} card={card} notes={c.notes} busy={c.busy} onNote={c.onNote} onMark={(item, right, note) => c.onMark(card.id, item, right, note)} onJump={c.onJump} />
            ))}
          </div>
        </Section>
      ) : null}
      {view.remaining ? (
        <Section title="What the rest would take">
          <EstimateView estimate={view.remaining} />
        </Section>
      ) : null}
      {view.advice.some((a) => a.found) ? (
        <Section title="After the hand-over">
          <div class="lre-stack" data-lre-depth-advice>
            {view.advice
              .filter((a) => a.found)
              .map((a) => (
                <Banner key={a.system} tone="info">
                  {a.text}
                </Banner>
              ))}
          </div>
        </Section>
      ) : null}
      {view.imported.length > 0 ? (
        <Section title="What the import read" flush>
          <ActionRows label="Imported">
            {view.imported.map((i) => (
              <ActionRow key={i.source} title={SOURCE_LABEL[i.source] ?? i.source} subtitle={i.unreadable ?? undefined} value={i.unreadable ? "Not read" : `${i.entries} ${i.entries === 1 ? "entry" : "entries"}`} tone={i.unreadable ? "warn" : undefined} />
            ))}
          </ActionRows>
        </Section>
      ) : null}
      {view.log.length > 0 ? (
        <Disclosure summary={`The run's log (${view.log.length})`}>
          <ol class="lre-depth-log">
            {view.log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </Disclosure>
      ) : null}
    </div>
  );
}

/** The cap a run starts with: the one it had, else Settings → Depth's. */
export function startCap(view: Pick<BootstrapView, "cap"> | null, settingsCap: BootstrapCap | "none"): BootstrapCap | "none" {
  return view?.cap ?? settingsCap;
}

/** A chat's bootstrap as a page follows it. */
export interface BootstrapRun {
  /** Undefined while it is first read; null when it couldn't be. */
  view: BootstrapView | null | undefined;
  /** The latest estimate an op answered with. */
  estimate: BootstrapEstimate | null;
  /** Settings → Depth's cap for a run, which a page starts from. */
  settingsCap: BootstrapCap | "none";
  /** Sends one op and takes the view it answers; false when it was refused. */
  ask(op: BootstrapOp): Promise<boolean>;
  /** Why the last op was refused because depth can't be played by this user now (the opt-in's gate, `loopbackUnready`), shown with Settings → Loopback; null otherwise. */
  unready: string | null;
}

/** Follows a chat's bootstrap: its view, asked for once and then from its pushes. */
export function useBootstrap(chatId: string): BootstrapRun {
  const app = useApp();
  const [view, setView] = useState<BootstrapView | null | undefined>(undefined);
  const [estimate, setEstimate] = useState<BootstrapEstimate | null>(null);
  const [settingsCap, setSettingsCap] = useState<BootstrapCap | "none">("none");
  const [unready, setUnready] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void app.request<"lre.bootstrap">(bootstrapBody(chatId, { op: "status" })).then((result) => {
      if (live) setView(result?.view ?? null);
    });
    void app.request({ type: "lre.settings.get" }).then((result) => {
      if (live && result) setSettingsCap(result.settings.depth.bootstrap.cap);
    });
    const off = app.client.onBootstrap((update) => {
      if (update.chatId === chatId) setView(update.view);
    });
    return () => {
      live = false;
      off();
    };
  }, [chatId]);
  return {
    view,
    estimate,
    settingsCap,
    unready,
    ask: async (op) => {
      const message = await app.send(bootstrapBody(chatId, op));
      // The opt-in's gate is said on the page with its way to Settings → Loopback; any other refusal as a toast.
      if (message.type === "lre.error") {
        if (message.code === "unavailable") setUnready(message.message);
        else app.toast(message.message, "error");
        return false;
      }
      if (message.request !== "lre.bootstrap") return false;
      setUnready(null);
      setView(message.body.view);
      if (message.body.estimate) setEstimate(message.body.estimate);
      return true;
    },
  };
}

/** An `lre.bootstrap` request for `chatId`. */
export function bootstrapBody(chatId: string, op: BootstrapOp) {
  return { type: "lre.bootstrap" as const, chatId, ...op };
}

/** GM → Depth → Bootstrap: the run as it moves. */
export function BootstrapPanel(props: { section: GmSectionProps }) {
  const app = useApp();
  const run = useBootstrap(props.section.chatId);
  const [busy, go] = useBusy();
  const [cap, setCap] = useState<BootstrapCap | "none" | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (run.view === undefined) return <Empty icon="hourglass">Reading the bootstrap…</Empty>;
  if (run.view === null) return <Empty icon="layers">The bootstrap couldn't be read.</Empty>;
  const c: BootstrapControls = {
    busy,
    cap: cap ?? startCap(run.view, run.settingsCap),
    onCap: setCap,
    onEstimate: () => go(() => run.ask({ op: "estimate" })),
    onStart: () => go(() => run.ask({ op: "start", cap: cap ?? startCap(run.view ?? null, run.settingsCap) })),
    onPause: () => go(() => run.ask({ op: "pause" })),
    onResume: () => go(() => run.ask({ op: "resume", cap: cap ?? startCap(run.view ?? null, run.settingsCap) })),
    notes,
    onNote: (item, note) => setNotes((n) => ({ ...n, [item]: note })),
    onMark: (card, item, right, note) => go(() => run.ask({ op: "mark", card, item, right, ...(note ? { note } : {}) })),
    onRedo: (chapter) => go(() => run.ask({ op: "redo", chapter })),
    onJump: (messageId) => {
      if (!app.host.revealMessage(messageId)) app.toast("That message isn't on screen in this chat.", "info");
    },
  };
  return <BootstrapBody view={run.view} c={c} />;
}

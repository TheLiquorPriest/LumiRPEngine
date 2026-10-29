// GM → Minds (DESIGN §24.9): every character's place on the fidelity ladder and why,
// their latest mind (monologue, depiction, intent, reactions), the intent you set for them, what they
// know (§24.11), plans, commitments, notes, what they witnessed and their summary, and what the player
// character knows. It lives in GM mode behind the gate, and its data comes with `lre.gm` only. A
// character opens as a page over the list, and each change opens as its own page over theirs: the
// pin, a refresh, their intent, a holding, and adding, editing or deleting a plan, commitment or
// note. Every change is one `lre.edit` (one GM edit chip with its Undo), and success goes back to the
// character's page.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { EntityId, PlaceId } from "../../../shared/ids";
import type { CommitmentKind, CommitmentStatus, FactId, Fidelity, HoldingBelief, HoldingHow, MindApproach, MindIntent, MindsGmCharacter, MindsGmHolding, MindsGmView, PlanKind, PlanStatus, RefreshReason } from "../../../shared/minds";
import { COMMITMENT_KINDS, COMMITMENT_STATUSES, FIDELITIES, HOLDING_BELIEFS, HOLDING_HOWS, MIND_APPROACHES, MIND_TEXT_CAPS, PLAN_KINDS, PLAN_PRIORITY, planInForce, witnessRef } from "../../../shared/minds";
import type { EditOp } from "../../../shared/protocol";
import { formatMoneyInput, parseMoneyInput } from "../../../shared/money";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Chip } from "../../../frontend/build/form-kit";
import { Badge, Banner, Button, Empty, Field, IdText, List, ListRow, Section, Seg, Stat } from "../../../frontend/components";
import { formatMinutes } from "../../../frontend/format";
import { GmPage, SheetLink, useGmFocus, usePages } from "../../../frontend/gm/ui";
import { Icon, type IconName } from "../../../frontend/icons";
import { fidelityGroups } from "../../../frontend/batch";
import { PickBox, SelectBar, useSelection } from "../../../frontend/multi-select";
import { MoneyInput } from "../../../frontend/money-input";
import type { GmSectionProps, Send } from "../../../frontend/registry";
import type { GmView } from "../../../shared/state-view";
import type { HoldingDraft, PlanFormDraft } from "./ops";
import { APPROACH_LABEL, BELIEF_LABEL, COMMITMENT_KIND_LABEL, COMMITMENT_STATUS_LABEL, commitmentDraft, commitmentOp, deleteOp, FIDELITY_LABEL, forgetOp, holdingDraft, holdingOp, HOW_LABEL, intentOp, isMoneyPlan, narratorGets, noteDraft, noteOp, pinOp, PLAN_KIND_LABEL, PLAN_STATUS_LABEL, planDraft, planLasts, planOp, refreshOp, startPlanIn, TRUTH_LABEL } from "./ops";
import { PinnedLore, RunCard, useMindsRun, type MindsRun } from "./run";

type Tone = "neutral" | "accent" | "pos" | "neg";
type Mind = NonNullable<MindsGmCharacter["mind"]>;
type Plan = MindsGmCharacter["plans"][number];
type Commitment = MindsGmCharacter["commitments"][number];
type Note = MindsGmCharacter["notes"][number];

/** A change to one character, each its own page over theirs; an item's `id` (a holding's `fact`) is null while adding one. */
type Change = { kind: "pin" } | { kind: "refresh" } | { kind: "intent" } | { kind: "plan" | "commitment" | "note"; id: string | null } | { kind: "holding"; fact: FactId | null };

const LEVEL_TONE: Record<Fidelity, Tone> = { live: "accent", near: "neutral", far: "neutral", background: "neutral" };
const PLAN_TONE: Record<PlanStatus, Tone> = { open: "neutral", done: "pos", dropped: "neutral" };
const COMMITMENT_TONE: Record<CommitmentStatus, Tone> = { open: "neutral", kept: "pos", broken: "neg", released: "neutral" };

/** What the narrator gets of a mind under each secrecy (DESIGN §24.3). */
const SECRECY: Record<MindsGmView["secrecy"], { label: string; note: string }> = {
  full: { label: "Full", note: "The narrator gets each mind whole (monologue, intent, reactions, mood and depiction), told to show it and never state it." },
  brief: { label: "Brief", note: "The narrator gets only the depiction, checked for leaks; the monologue and intent stay here." },
};

/** What each rung means for a mind (the guide's ladder), for choosing a pin. */
const LEVEL_NOTE: Record<Fidelity, string> = {
  live: "They think every turn, best score first, up to your Live limit.",
  near: "They think again when something calls for it.",
  far: "They think now and then, on the Far refresh period.",
  background: "No mind; they follow their routine.",
};

/** What each approach means for their mind, for choosing one. */
const APPROACH_NOTE: Record<MindApproach, string> = {
  reactive: "They answer the scene and what is asked of them, and start nothing of their own.",
  proactive: "They pursue their own aims unprompted, without waiting to be asked.",
};

/** Why a turn's mind ran, in words; a time-skip beat's reason is words already. */
const TURN_WHY: Record<RefreshReason, string> = {
  live: "Live: every turn",
  gm: "you asked for it",
  first: "their first mind",
  scene: "came into the scene, or it changed",
  mention: "named this turn",
  turns: "enough turns since their last mind",
  minutes: "their last mind was old enough",
  period: "the Far refresh period",
  promoted: "rose on the ladder",
};

/** The people a commitment or plan can be with: the characters, and the player's own. */
interface Person {
  id: EntityId;
  name: string;
}

interface Ctx {
  view: MindsGmView;
  busy: boolean;
  people: Person[];
  currency: WorldCurrency;
  places: { id: PlaceId; name: string }[];
  edit(ops: EditOp[]): Promise<boolean>;
  /** The chat's minds run on demand (DESIGN §24.9), and what the pinned-lore section reads with. */
  minds: MindsRun;
  chatId: string;
  send: Send;
  gm: GmView;
}

function nameIn(list: readonly { id: string; name: string }[], id: string | null): string {
  if (id === null) return "—";
  return list.find((p) => p.id === id)?.name ?? id;
}

function whyOf(m: Mind): string {
  if (m.moment === "beat") return m.reason;
  const known: Partial<Record<string, string>> = TURN_WHY;
  return known[m.reason] ?? m.reason;
}

/** Sends one change; back to the page it came from once it is accepted. */
function send(ctx: Ctx, op: EditOp, onDone: () => void): void {
  void ctx.edit([op]).then((ok) => {
    if (ok) onDone();
  });
}

/**
 * Running minds now: everyone Live and Near behind a button that says how many it runs and asks
 * before it spends a model call on each, and choosing who to run from the list below.
 */
function RunEveryone(props: { count: number; disabled: boolean; picking: boolean; onRun(): void; onPick(): void }) {
  const [asking, setAsking] = useState(false);
  const minds = props.count === 1 ? "1 mind" : `${props.count} minds`;
  return (
    <Section title="Run minds now">
      <div class="lre-stack" data-lre-minds-runall="">
        <p class="lre-gm-note">Each mind thinks from the chat so far and its lore, as a turn would. A run is recorded as one edit you can undo.</p>
        {asking ? (
          <Banner
            tone="gm"
            icon="sparkle"
            title={`Run ${minds} now?`}
            actions={
              <>
                <Button variant="primary" icon="sparkle" disabled={props.disabled} onClick={() => (setAsking(false), props.onRun())}>
                  {`Run ${minds}`}
                </Button>
                <Button variant="ghost" onClick={() => setAsking(false)}>
                  Cancel
                </Button>
              </>
            }
          >
            Everyone Live and Near, one model call each, starting now.
          </Banner>
        ) : (
          <Button variant="primary" icon="sparkle" disabled={props.disabled || props.count === 0} onClick={() => setAsking(true)}>
            {`Run everyone Live and Near (${props.count})…`}
          </Button>
        )}
        <Button variant={props.picking ? "secondary" : "ghost"} icon="users" disabled={props.disabled} onClick={props.onPick}>
          {props.picking ? "Stop choosing" : "Choose who to run"}
        </Button>
        {props.picking ? <p class="lre-gm-note">Tap people below to pick them, or pick everyone shown or a whole level in the bar at the bottom; its Run their minds runs them.</p> : null}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- the list

export function GmMindsSection(props: GmSectionProps) {
  const view = props.gm.minds;
  const pages = usePages<EntityId>();
  // A link from a character's sheet opens their mind here.
  useGmFocus((id) => pages.open(id));
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<Fidelity | "">("");
  // Choosing who to run: tapping a row picks them instead of opening their page.
  const picking = useSelection();
  const minds = useMindsRun(props.chatId, props.send, props.reload);
  const running = minds.run?.status === "running";
  const pov = props.gm.entities.find((e) => e.pov);
  const ctx: Ctx = {
    view,
    busy: props.busy,
    people: [...(pov ? [{ id: pov.id, name: pov.name }] : []), ...view.characters.map((c) => ({ id: c.entity, name: c.name }))],
    places: props.gm.places.map((p) => ({ id: p.id, name: p.name })),
    currency: props.currency,
    edit: props.edit,
    minds,
    chatId: props.chatId,
    send: props.send,
    gm: props.gm,
  };
  const liveNear = view.characters.filter((c) => c.fidelity.level === "live" || c.fidelity.level === "near").length;
  const page = pages.page;
  const selected = page === null ? undefined : view.characters.find((c) => c.entity === page);
  // The player character has no mind, but holds what they know: a page of their own.
  const knower = view.knowledge.pov;
  const povKnows = knower !== null && page === knower.entity ? knower : undefined;
  // Someone no longer among the characters (an Undo took back a spawn) gives way to the list.
  useEffect(() => {
    if (page !== null && selected === undefined && povKnows === undefined) pages.back();
  });
  const q = query.trim().toLowerCase();
  const list = view.characters.filter((c) => (level === "" || c.fidelity.level === level) && (q === "" || c.name.toLowerCase().includes(q)));
  // Those picked who are still characters (an Undo can take back a spawn), in the list's order.
  const chosen = view.characters.filter((c) => picking.ids.includes(c.entity)).map((c) => c.entity);
  const secrecy = SECRECY[view.secrecy];
  return (
    <div ref={pages.host.ref} class="lre-gm-pages" onKeyDown={pages.host.onKeyDown} data-lre-gm-section="minds">
      <div class="lre-stack lre-gm-list" hidden={selected !== undefined || povKnows !== undefined}>
        {view.enabled ? null : (
          <Banner tone="info" title="Character minds are off in Settings → Minds">
            What they recorded before stays here, and edits still apply.
          </Banner>
        )}
        <div class="lre-gm-minds-head">
          <Section flush>
            <List>
              <ListRow icon="clock" title="Now" value={view.nowText} />
              <ListRow icon="eye" title="This world's secrecy" subtitle={secrecy.note} value={secrecy.label} />
            </List>
          </Section>
        </div>
        {knower && !picking.on ? (
          <Section title="The player character" flush>
            <List>
              <ListRow icon="user" title={knower.name} subtitle="What they know; the player decides for them, so they have no mind" value={`${knower.holdings.length} held`} chevron onClick={() => pages.open(knower.entity)} />
            </List>
          </Section>
        ) : null}
        <RunCard minds={minds} busy={props.busy} />
        <RunEveryone count={liveNear} disabled={props.busy || running} picking={picking.on} onRun={() => void minds.start()} onPick={() => (picking.on ? picking.stop() : picking.start())} />
        <div class="lre-gm-tools">
          <label class="lre-gm-search">
            <Icon name="search" size={16} />
            <input class="lre-input" type="search" aria-label="Search by name" placeholder="Search by name" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
          </label>
          <select class="lre-input" aria-label="Fidelity" value={level} onChange={(event) => setLevel(event.currentTarget.value as Fidelity | "")}>
            <option value="">Every level</option>
            {FIDELITIES.map((f) => (
              <option key={f} value={f}>
                {FIDELITY_LABEL[f]}
              </option>
            ))}
          </select>
        </div>
        <Section title={`${list.length} of ${view.characters.length}`} flush>
          {view.characters.length === 0 ? (
            <Empty icon="users">No characters yet.</Empty>
          ) : list.length === 0 ? (
            <Empty icon="search">No one matches.</Empty>
          ) : (
            <div data-lre-gm-list="minds">
              <List>
                {list.map((c) => (
                  <ListRow
                    key={c.entity}
                    id={c.entity}
                    title={c.name}
                    leading={picking.on ? <PickBox label={`Pick ${c.name}`} checked={picking.ids.includes(c.entity)} /> : undefined}
                    subtitle={
                      <span class="lre-gm-minds-sub">
                        <span>{c.mind ? `Last mind ${c.mind.clock}` : "No mind yet"}</span>
                        {c.fidelity.pin.gm || c.fidelity.pin.author ? <Badge tone="warn">Pinned</Badge> : null}
                        {c.refreshQueued ? <Badge>Refresh</Badge> : null}
                        {c.intent ? <Badge tone="accent">Intent</Badge> : null}
                      </span>
                    }
                    badge={<Badge tone={LEVEL_TONE[c.fidelity.level]}>{FIDELITY_LABEL[c.fidelity.level]}</Badge>}
                    value={
                      <span class="lre-gm-minds-score">
                        <span class="lre-gm-minds-score-n">{Math.round(c.fidelity.score)}</span>
                        <span class="lre-gm-minds-score-k">score</span>
                      </span>
                    }
                    chevron={!picking.on}
                    onClick={() => (picking.on ? picking.toggle(c.entity) : pages.open(c.entity))}
                  />
                ))}
              </List>
            </div>
          )}
        </Section>
        {picking.on ? (
          <SelectBar label="Run the chosen minds" selection={picking} all={view.characters.map((c) => c.entity)} shown={list.map((c) => c.entity)} groups={fidelityGroups(view.characters, FIDELITY_LABEL)} groupLabel="Select a level">
            <Button variant="primary" icon="sparkle" disabled={chosen.length === 0 || running || props.busy} onClick={() => void minds.start(chosen).then((ok) => ok && picking.stop())}>
              Run their minds
            </Button>
          </SelectBar>
        ) : null}
      </div>
      {selected ? <CharacterPages ctx={ctx} c={selected} onBack={pages.back} /> : null}
      {povKnows ? <KnowerPages ctx={ctx} who={{ ...povKnows, witness: [] }} onBack={pages.back} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- a character's page

/**
 * A character's page and the change open over it. To the list's pages this is one page (it carries
 * `lre-gm-page`, so opening it focuses its Back); inside, it hosts the change pages the same way, so
 * Back or Escape on a change returns to the row that opened it, and Escape here goes to the list.
 */
function CharacterPages(props: { ctx: Ctx; c: MindsGmCharacter; onBack(): void }) {
  const { ctx, c } = props;
  const changes = usePages<Change>();
  const change = changes.page;
  const plan = change?.kind === "plan" && change.id !== null ? c.plans.find((p) => p.id === change.id) : undefined;
  const commitment = change?.kind === "commitment" && change.id !== null ? c.commitments.find((x) => x.id === change.id) : undefined;
  const note = change?.kind === "note" && change.id !== null ? c.notes.find((n) => n.id === change.id) : undefined;
  const holding = change?.kind === "holding" && change.fact !== null ? c.holdings.find((h) => h.fact === change.fact) : undefined;
  // An item they no longer hold (an Undo took it back, a note folded into their summary) takes its page with it.
  const gone = change !== null && (("id" in change && change.id !== null && plan === undefined && commitment === undefined && note === undefined) || (change.kind === "holding" && change.fact !== null && holding === undefined));
  useEffect(() => {
    if (gone) changes.back();
  });
  // A deleted item's row can't take focus back: keep it on this page rather than lose it.
  const was = useRef(change);
  useEffect(() => {
    const before = was.current;
    was.current = change;
    const root = changes.host.ref.current;
    if (before === null || change !== null || !root || root.contains(document.activeElement)) return;
    root.querySelector<HTMLElement>(".lre-page-header button")?.focus();
  }, [change]);
  const f = c.fidelity;
  return (
    <div ref={changes.host.ref} class="lre-gm-page lre-gm-pages lre-gm-minds-pages" onKeyDown={changes.host.onKeyDown}>
      <div class="lre-gm-list" hidden={change !== null}>
        <GmPage
          name="mind"
          title={c.name}
          subtitle={
            <>
              {FIDELITY_LABEL[f.level]} · score {Math.round(f.score)}
              <IdText id={c.entity} />
            </>
          }
          backLabel="Minds"
          actions={<SheetLink entity={c.entity} />}
          onBack={props.onBack}
        >
          <div class="lre-gm-minds" data-lre-gm-minds={c.entity}>
            <Section title="Run their mind now" flush>
              <List>
                <ListRow icon="sparkle" title="Run their mind now" subtitle="From the chat so far and their lore, as a turn would; recorded as one edit you can undo" chevron disabled={ctx.busy || ctx.minds.run?.status === "running"} onClick={() => void ctx.minds.start([c.entity])} />
              </List>
            </Section>
            {ctx.minds.run?.entries.some((e) => e.entity === c.entity) || ctx.minds.error ? <RunCard minds={ctx.minds} busy={ctx.busy} /> : null}
            <Ladder c={c} busy={ctx.busy} open={changes.open} />
            <Intent c={c} busy={ctx.busy} open={changes.open} />
            <LatestMind ctx={ctx} c={c} />
            <Holdings ctx={ctx} who={c} open={changes.open} />
            <PinnedLore gm={ctx.gm} chatId={ctx.chatId} who={c.entity} send={ctx.send} />
            <Plans ctx={ctx} c={c} open={changes.open} />
            <Commitments c={c} busy={ctx.busy} open={changes.open} />
            <Notes c={c} busy={ctx.busy} open={changes.open} />
            <Section title="Summary">{c.summary ? <p class="lre-gm-minds-prose">{c.summary}</p> : <p class="lre-gm-none">No summary yet.</p>}</Section>
            <Witnessed ctx={ctx} c={c} />
          </div>
        </GmPage>
      </div>
      {change?.kind === "pin" ? <PinPage ctx={ctx} c={c} onBack={changes.back} /> : null}
      {change?.kind === "refresh" ? <RefreshPage ctx={ctx} c={c} onBack={changes.back} /> : null}
      {change?.kind === "intent" ? <IntentPage ctx={ctx} c={c} onBack={changes.back} /> : null}
      {change?.kind === "plan" && (change.id === null || plan) ? <PlanPage key={change.id ?? ""} ctx={ctx} c={c} plan={plan ?? null} onBack={changes.back} /> : null}
      {change?.kind === "commitment" && (change.id === null || commitment) ? <CommitmentPage key={change.id ?? ""} ctx={ctx} c={c} commitment={commitment ?? null} onBack={changes.back} /> : null}
      {change?.kind === "note" && (change.id === null || note) ? <NotePage key={change.id ?? ""} ctx={ctx} c={c} note={note ?? null} onBack={changes.back} /> : null}
      {change?.kind === "holding" && (change.fact === null || holding) ? <HoldingPage key={change.fact ?? ""} ctx={ctx} who={c} holding={holding ?? null} onBack={changes.back} /> : null}
    </div>
  );
}

/** Their rung and score, each input's points, the pins, and a refresh asked for. */
function Ladder(props: { c: MindsGmCharacter; busy: boolean; open(change: Change): void }) {
  const { c } = props;
  const f = c.fidelity;
  return (
    <>
      <Section title="Fidelity" aside={<Badge tone={LEVEL_TONE[f.level]}>{FIDELITY_LABEL[f.level]}</Badge>}>
        <Stat label="Score" value={String(Math.round(f.score))} />
        {f.reasons.length === 0 ? (
          <p class="lre-gm-none">Nothing adds to their score now.</p>
        ) : (
          <ul class="lre-gm-minds-reasons" aria-label="What adds to their score">
            {f.reasons.map((r, i) => (
              // A reason without points is a rule that sets the level (a pin, a cap), not part of the score.
              <li key={`${r.label}:${i}`} class={r.points === 0 ? "rule" : undefined}>
                <span>{r.label}</span>
                {r.points === 0 ? null : <span class="lre-gm-minds-points">{r.points > 0 ? `+${r.points}` : `−${-r.points}`}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Pin and refresh" flush>
        <List>
          <ListRow
            icon="pin"
            title="Pin their fidelity"
            subtitle={f.pin.gm ? "Pinned in this chat, whatever their score" : f.pin.author ? "The author's pin decides their level" : "Their score decides their level"}
            value={f.pin.gm ? FIDELITY_LABEL[f.pin.gm] : "By score"}
            chevron
            disabled={props.busy}
            onClick={() => props.open({ kind: "pin" })}
          />
          {f.pin.author ? <ListRow icon="lock" title="The author's pin" subtitle="Build → World → Minds: Always Live or Never a mind" value={FIDELITY_LABEL[f.pin.author]} /> : null}
          <ListRow
            icon="refresh"
            title="Refresh their mind next turn"
            subtitle={c.refreshQueued ? <Badge tone="accent">Fresh mind next turn</Badge> : "Whatever the refresh settings say"}
            chevron
            disabled={props.busy}
            onClick={() => props.open({ kind: "refresh" })}
          />
        </List>
      </Section>
    </>
  );
}

/** The intent you set for them: what they mean to do now, which only their own mind reads, and how they go about it. */
function Intent(props: { c: MindsGmCharacter; busy: boolean; open(change: Change): void }) {
  const i = props.c.intent;
  return (
    <Section title="Your intent for them" aside={i ? <Badge tone="accent">Set</Badge> : undefined} flush>
      <List>
        <ListRow
          icon="flag"
          title={i && i.text !== "" ? i.text : "What they mean to do"}
          subtitle={i ? (i.approach ? `${APPROACH_LABEL[i.approach]}: ${APPROACH_NOTE[i.approach]}` : "Their mind decides how they go about it") : "Not set: their mind decides for itself"}
          chevron
          disabled={props.busy}
          onClick={() => props.open({ kind: "intent" })}
        />
      </List>
    </Section>
  );
}

/** One part of a mind: its label, a badge when the narrator got it, and its text. */
function Thought(props: { label: string; told?: boolean; children: ComponentChildren }) {
  return (
    <div class="lre-gm-minds-thought">
      <span class="lre-gm-minds-thought-head">
        {props.label}
        {props.told ? <Badge>To the narrator</Badge> : null}
      </span>
      <div class="lre-gm-minds-thought-text">{props.children}</div>
    </div>
  );
}

function LatestMind(props: { ctx: Ctx; c: MindsGmCharacter }) {
  const { ctx, c } = props;
  const m = c.mind;
  const secrecy = SECRECY[ctx.view.secrecy];
  if (!m) {
    return (
      <Section title="Latest mind">
        <p class="lre-gm-none">No mind yet.</p>
      </Section>
    );
  }
  const sent = narratorGets(ctx.view.secrecy, m);
  return (
    <Section title="Latest mind" aside={<Badge>{FIDELITY_LABEL[m.level]}</Badge>}>
      <div class="lre-gm-minds-when">
        <span class="lre-gm-minds-clock">{m.clock}</span>
        <span class="lre-gm-minds-why">{[m.moment === "beat" ? "At a time-skip beat" : "On a turn", whyOf(m), m.place ? `at ${nameIn(ctx.places, m.place)}` : null].filter((part) => part !== null && part !== "").join(" · ")}</span>
      </div>
      {m.mood ? (
        <Thought label="Mood" told={sent.mood}>
          {m.mood}
        </Thought>
      ) : null}
      <Thought label="Monologue" told={sent.monologue}>
        {m.monologue || "—"}
      </Thought>
      <Thought label="Depiction" told={sent.depiction}>
        {m.depiction || "—"}
      </Thought>
      {m.withheld ? <Banner tone="warn">The depiction gave away a secret or a name you haven't met, so the narrator got none of it this time.</Banner> : null}
      <Thought label="Intent" told={sent.intent}>
        {m.intent || "—"}
      </Thought>
      {m.reactions.length > 0 ? (
        <Thought label="Reactions" told={sent.reactions}>
          <ul class="lre-gm-minds-reactions">
            {m.reactions.map((r, i) => (
              <li key={`${i}:${r}`}>{r}</li>
            ))}
          </ul>
        </Thought>
      ) : null}
      {m.interrupt ? (
        <Banner
          tone="warn"
          icon="pause"
          title={
            <>
              Interrupted the skip {sent.interrupt ? <Badge>To the narrator</Badge> : null}
            </>
          }
        >
          {m.interrupt}
        </Banner>
      ) : null}
      <p class="lre-gm-note">
        {secrecy.label} secrecy. {secrecy.note}
      </p>
    </Section>
  );
}

/** A flush section's note where its rows would be. */
function None(props: { children: string }) {
  return <p class="lre-gm-minds-none">{props.children}</p>;
}

function Plans(props: { ctx: Ctx; c: MindsGmCharacter; open(change: Change): void }) {
  const { ctx, c } = props;
  return (
    <Section title="Plans" aside={<Badge>{c.plans.filter((p) => p.status === "open" && planInForce(p)).length} open</Badge>} flush>
      {c.plans.length === 0 ? <None>No plans.</None> : null}
      <List>
        {c.plans.map((p) => (
          <ListRow
            key={p.id}
            id={p.id}
            title={p.what}
            subtitle={
              <span class="lre-gm-minds-lines">
                <span>
                  {PLAN_KIND_LABEL[p.kind]}
                  {p.cents !== undefined ? <> · {formatMoney(p.cents, ctx.currency)}</> : null} · {p.fromText} · <span class="lre-gm-minds-keep">{formatMinutes(p.when.to - p.when.from)}</span>
                </span>
                <span>
                  {[p.where ? `at ${nameIn(ctx.places, p.where)}` : null, p.with.length > 0 ? `with ${p.with.map((w) => nameIn(ctx.people, w)).join(", ")}` : null, `priority ${p.priority}`, p.source === "gm" ? "from you" : p.source === "mind" ? "a thought from their mind, which drives nothing" : `from their ${p.source}`, p.reason]
                    .filter((part) => part !== null && part !== "")
                    .join(" · ")}
                </span>
              </span>
            }
            badge={planInForce(p) ? <Badge tone={PLAN_TONE[p.status]}>{PLAN_STATUS_LABEL[p.status]}</Badge> : <Badge>Thought</Badge>}
            chevron
            disabled={ctx.busy}
            onClick={() => props.open({ kind: "plan", id: p.id })}
          />
        ))}
        <ListRow icon="plus" title="Add a plan" disabled={ctx.busy} onClick={() => props.open({ kind: "plan", id: null })} />
      </List>
    </Section>
  );
}

function Commitments(props: { c: MindsGmCharacter; busy: boolean; open(change: Change): void }) {
  const { c } = props;
  return (
    <Section title="Commitments" aside={<Badge>{c.commitments.filter((x) => x.status === "open").length} open</Badge>} flush>
      {c.commitments.length === 0 ? <None>No commitments.</None> : null}
      <List>
        {c.commitments.map((x) => (
          <ListRow
            key={x.id}
            id={x.id}
            title={x.text}
            subtitle={
              <span class="lre-gm-minds-lines">
                <span>
                  {COMMITMENT_KIND_LABEL[x.kind]} with {x.withNames.join(", ") || "—"}
                </span>
                {x.dueText ? <span>Due {x.dueText}</span> : null}
              </span>
            }
            badge={<Badge tone={COMMITMENT_TONE[x.status]}>{COMMITMENT_STATUS_LABEL[x.status]}</Badge>}
            chevron
            disabled={props.busy}
            onClick={() => props.open({ kind: "commitment", id: x.id })}
          />
        ))}
        <ListRow icon="plus" title="Add a commitment" disabled={props.busy} onClick={() => props.open({ kind: "commitment", id: null })} />
      </List>
    </Section>
  );
}

function Notes(props: { c: MindsGmCharacter; busy: boolean; open(change: Change): void }) {
  const { c } = props;
  return (
    <Section title="Memory notes" aside={<Badge>{c.notes.filter((n) => !n.faded).length} remembered</Badge>} flush>
      {c.notes.length === 0 ? <None>No notes.</None> : null}
      <List>
        {c.notes.map((n) => (
          <ListRow key={n.id} id={n.id} title={n.text} subtitle={`${n.clock} · salience ${n.salience}, now ${n.now.toFixed(1)}`} badge={n.faded ? <Badge>Faded</Badge> : undefined} chevron disabled={props.busy} onClick={() => props.open({ kind: "note", id: n.id })} />
        ))}
        <ListRow icon="plus" title="Add a note" disabled={props.busy} onClick={() => props.open({ kind: "note", id: null })} />
      </List>
    </Section>
  );
}

function Witnessed(props: { ctx: Ctx; c: MindsGmCharacter }) {
  const { ctx, c } = props;
  return (
    <Section title="Witnessed" flush>
      {c.witness.length === 0 ? (
        <None>Nothing recorded.</None>
      ) : (
        <List>
          {c.witness.map((w, i) => (
            <ListRow
              key={`${w.at}:${i}`}
              icon={w.how === "told" ? "message" : "eye"}
              title={w.what}
              subtitle={`${w.clock} · ${w.how === "told" ? `told${w.by ? ` by ${nameIn(ctx.people, w.by)}` : ""}` : "saw it"}${w.place ? ` · ${nameIn(ctx.places, w.place)}` : ""}`}
            />
          ))}
        </List>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- the change pages

/** A change's page over the character's: their name under its title, Back to them. */
function ChangePage(props: { name: string; title: string; c: Pick<MindsGmCharacter, "name">; onBack(): void; children: ComponentChildren }) {
  return (
    <GmPage name={props.name} title={props.title} subtitle={props.c.name} backLabel={props.c.name} onBack={props.onBack}>
      {props.children}
    </GmPage>
  );
}

/** The page's one primary button, and why it can't save yet. */
function Submit(props: { ctx: Ctx; ready: boolean; icon: "check" | "plus" | "pin"; invalid?: string; children: string }) {
  return (
    <div class="lre-gm-minds-submit">
      <Button type="submit" variant="primary" icon={props.icon} block disabled={props.ctx.busy || !props.ready}>
        {props.children}
      </Button>
      {!props.ready && props.invalid ? <p class="lre-gm-note">{props.invalid}</p> : null}
    </div>
  );
}

/** Deleting an item from its page; the GM edit chip's Undo brings it back. */
function DeleteItem(props: { ctx: Ctx; op: EditOp; noun: string; onDone(): void }) {
  return (
    <Section title="Delete">
      <p class="lre-gm-note">Deletes this {props.noun}. The edit's Undo brings it back.</p>
      <Button variant="danger" icon="trash" disabled={props.ctx.busy} onClick={() => send(props.ctx, props.op, props.onDone)}>
        Delete {props.noun}
      </Button>
    </Section>
  );
}

/** People picked one at a time from a list, each removable. */
function PeopleField(props: { label: string; value: readonly EntityId[]; people: readonly Person[]; exclude: EntityId; disabled: boolean; onChange(next: EntityId[]): void }) {
  const add = useId();
  const left = props.people.filter((p) => p.id !== props.exclude && !props.value.includes(p.id));
  return (
    <Field label={props.label} for={left.length > 0 ? add : undefined}>
      {props.value.length > 0 ? (
        <div class="lre-form-chips">
          {props.value.map((id) => (
            <Chip key={id} removeLabel={`Remove ${nameIn(props.people, id)}`} disabled={props.disabled} onRemove={() => props.onChange(props.value.filter((v) => v !== id))}>
              {nameIn(props.people, id)}
            </Chip>
          ))}
        </div>
      ) : null}
      {left.length > 0 ? (
        <select id={add} class="lre-input" value="" disabled={props.disabled} onChange={(event) => event.currentTarget.value && props.onChange([...props.value, event.currentTarget.value])}>
          <option value="">Add someone…</option>
          {left.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}
    </Field>
  );
}

/** How much of a text's cap is used. */
function used(text: string, cap: number): string {
  return `${text.length} / ${cap}`;
}

function PinPage(props: { ctx: Ctx; c: MindsGmCharacter; onBack(): void }) {
  const { ctx, c } = props;
  const f = c.fidelity;
  const current: Fidelity | "score" = f.pin.gm ?? "score";
  const [pick, setPick] = useState<Fidelity | "score">(current);
  const group = useId();
  const choices: readonly (Fidelity | "score")[] = ["score", ...FIDELITIES];
  // With the GM's pin gone, the author's pin decides before the score does.
  const unpinned = f.pin.author ? `The author's pin decides: ${FIDELITY_LABEL[f.pin.author]}.` : `Their score decides: ${Math.round(f.score)} now.`;
  return (
    <ChangePage name="mind-pin" title="Pin their fidelity" c={c} onBack={props.onBack}>
      <form
        class="lre-stack"
        data-lre-minds-form="pin"
        onSubmit={(event) => {
          event.preventDefault();
          if (pick !== current) send(ctx, pinOp(c.entity, pick === "score" ? null : pick), props.onBack);
        }}
      >
        <Section>
          <p class="lre-gm-note">Keeps them at a level in this chat, whatever their score. By score unpins.{f.pin.author ? ` The author pins them at ${FIDELITY_LABEL[f.pin.author]} (Build → World → Minds); yours wins in this chat.` : ""}</p>
          <fieldset class="lre-gm-minds-choices">
            <legend class="lre-sr">Pin their fidelity</legend>
            {choices.map((choice) => (
              <label key={choice} class="lre-gm-minds-choice">
                <input type="radio" name={group} value={choice} checked={pick === choice} disabled={ctx.busy} onChange={() => setPick(choice)} />
                <span class="lre-gm-minds-choice-text">
                  <span class="lre-gm-minds-choice-name">
                    {choice === "score" ? "By score" : FIDELITY_LABEL[choice]}
                    {choice === current ? <Badge>Now</Badge> : null}
                  </span>
                  <span class="lre-gm-minds-choice-help">{choice === "score" ? unpinned : LEVEL_NOTE[choice]}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </Section>
        <Submit ctx={ctx} ready={pick !== current} icon="pin">
          {pick === "score" ? "Go by score" : `Pin at ${FIDELITY_LABEL[pick]}`}
        </Submit>
      </form>
    </ChangePage>
  );
}

function RefreshPage(props: { ctx: Ctx; c: MindsGmCharacter; onBack(): void }) {
  const { ctx, c } = props;
  return (
    <ChangePage name="mind-refresh" title="Refresh their mind" c={c} onBack={props.onBack}>
      <Section>
        <p class="lre-gm-minds-prose">
          Asks for a fresh mind for {c.name} on the next turn, whatever the refresh settings say.
        </p>
        {c.refreshQueued ? <Banner tone="info" title="Fresh mind next turn">Already asked for: they think again on the next turn.</Banner> : null}
        <Button variant="primary" icon="refresh" block disabled={ctx.busy || c.refreshQueued} onClick={() => send(ctx, refreshOp(c.entity), props.onBack)}>
          Refresh their mind next turn
        </Button>
      </Section>
    </ChangePage>
  );
}

const NO_INTENT: MindIntent = { text: "", approach: null };

function IntentPage(props: { ctx: Ctx; c: MindsGmCharacter; onBack(): void }) {
  const { ctx, c } = props;
  const current = c.intent ?? NO_INTENT;
  const [draft, setDraft] = useState<MindIntent>(current);
  const textId = useId();
  const group = useId();
  const op = intentOp(c.entity, draft);
  const clear = intentOp(c.entity, NO_INTENT);
  // Saving only what changes; spaces alone are no change.
  const changed = draft.text.trim().replace(/\s+/g, " ") !== current.text || draft.approach !== current.approach;
  const choices: readonly (MindApproach | null)[] = [null, ...MIND_APPROACHES];
  return (
    <ChangePage name="mind-intent" title="Your intent for them" c={c} onBack={props.onBack}>
      <form
        class="lre-stack"
        data-lre-minds-form="intent"
        onSubmit={(event) => {
          event.preventDefault();
          if (op && changed) send(ctx, op, props.onBack);
        }}
      >
        <Section>
          <p class="lre-gm-note">What {c.name} means to do now, in your words. Only their own mind reads it, first after who they are, and works from it, so the story follows; no other mind, the narrator or Play ever sees it. It stays until you change or clear it.</p>
          <Field label="What they mean to do" for={textId} help={used(draft.text, MIND_TEXT_CAPS.gmIntent)}>
            <textarea id={textId} class="lre-input lre-gm-prose" rows={4} maxLength={MIND_TEXT_CAPS.gmIntent} value={draft.text} onInput={(event) => setDraft({ ...draft, text: event.currentTarget.value })} />
          </Field>
          <Field label="How they go about it">
            <fieldset class="lre-gm-minds-choices">
              <legend class="lre-sr">How they go about it</legend>
              {choices.map((choice) => (
                <label key={choice ?? "mind"} class="lre-gm-minds-choice">
                  <input type="radio" name={group} value={choice ?? "mind"} checked={draft.approach === choice} disabled={ctx.busy} onChange={() => setDraft({ ...draft, approach: choice })} />
                  <span class="lre-gm-minds-choice-text">
                    <span class="lre-gm-minds-choice-name">
                      {choice === null ? "Their mind decides" : APPROACH_LABEL[choice]}
                      {choice === current.approach ? <Badge>Now</Badge> : null}
                    </span>
                    <span class="lre-gm-minds-choice-help">{choice === null ? "As the moment and what they know lead them." : APPROACH_NOTE[choice]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </Field>
        </Section>
        <Submit ctx={ctx} ready={op !== null && changed} icon="check" invalid={op === null ? `At most ${MIND_TEXT_CAPS.gmIntent} characters.` : undefined}>
          {op !== null && changed && draft.text.trim() === "" && draft.approach === null ? "Clear intent" : "Save"}
        </Submit>
      </form>
      {c.intent && clear ? (
        <Section title="Clear">
          <p class="lre-gm-note">Clears your intent: their mind decides for itself again. The edit's Undo brings it back.</p>
          <Button variant="danger" icon="trash" disabled={ctx.busy} onClick={() => send(ctx, clear, props.onBack)}>
            Clear intent
          </Button>
        </Section>
      ) : null}
    </ChangePage>
  );
}

function NotePage(props: { ctx: Ctx; c: MindsGmCharacter; note: Note | null; onBack(): void }) {
  const { ctx, c, note } = props;
  const [draft, setDraft] = useState(() => noteDraft(note ?? undefined));
  const textId = useId();
  const op = noteOp(c.entity, note?.id ?? null, draft);
  return (
    <ChangePage name="mind-note" title={note ? "Edit note" : "Add a note"} c={c} onBack={props.onBack}>
      <form
        class="lre-stack"
        data-lre-minds-form="note"
        onSubmit={(event) => {
          event.preventDefault();
          if (op) send(ctx, op, props.onBack);
        }}
      >
        <Section>
          <Field label="Note" for={textId} help={used(draft.text, MIND_TEXT_CAPS.note)}>
            <textarea id={textId} class="lre-input lre-gm-prose" rows={3} maxLength={MIND_TEXT_CAPS.note} value={draft.text} onInput={(event) => setDraft({ ...draft, text: event.currentTarget.value })} />
          </Field>
          <Field label="Salience" help={note ? `From 1 to 5; it fades with time unless it matters. Now ${note.now.toFixed(1)}${note.faded ? ", faded" : ""}.` : "From 1 to 5; it fades with time unless it matters."}>
            <Seg<string> label="Salience" value={draft.salience} options={["1", "2", "3", "4", "5"].map((s) => ({ value: s, label: s }))} onChange={(salience) => setDraft({ ...draft, salience })} />
          </Field>
        </Section>
        <Submit ctx={ctx} ready={op !== null} icon={note ? "check" : "plus"} invalid="A note needs its text.">
          {note ? "Save" : "Add note"}
        </Submit>
      </form>
      {note ? <DeleteItem ctx={ctx} op={deleteOp(c.entity, "note", note.id)} noun="note" onDone={props.onBack} /> : null}
    </ChangePage>
  );
}

function CommitmentPage(props: { ctx: Ctx; c: MindsGmCharacter; commitment: Commitment | null; onBack(): void }) {
  const { ctx, c, commitment } = props;
  const now = ctx.view.now;
  const [draft, setDraft] = useState(() => commitmentDraft(commitment ?? undefined));
  const [dueIn, setDueIn] = useState("");
  const ids = { kind: useId(), text: useId(), due: useId(), status: useId() };
  // Blank keeps the due time it has; a number of hours from now replaces it.
  const setDue = (text: string) => {
    setDueIn(text);
    const hours = Number(text);
    setDraft({ ...draft, due: text.trim() === "" ? (commitment?.due ?? null) : Number.isFinite(hours) ? Math.round(now + hours * 60) : Number.NaN });
  };
  const op = commitmentOp(c.entity, commitment?.id ?? null, draft);
  const dueText = commitment?.dueText ?? null;
  return (
    <ChangePage name="mind-commitment" title={commitment ? "Edit commitment" : "Add a commitment"} c={c} onBack={props.onBack}>
      <form
        class="lre-stack"
        data-lre-minds-form="commitment"
        onSubmit={(event) => {
          event.preventDefault();
          if (op) send(ctx, op, props.onBack);
        }}
      >
        <Section>
          <Field label="Kind" for={ids.kind}>
            <select id={ids.kind} class="lre-input" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.currentTarget.value as CommitmentKind })}>
              {COMMITMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {COMMITMENT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="What it is" for={ids.text} help={used(draft.text, MIND_TEXT_CAPS.commitment)}>
            <textarea id={ids.text} class="lre-input lre-gm-prose" rows={3} maxLength={MIND_TEXT_CAPS.commitment} value={draft.text} onInput={(event) => setDraft({ ...draft, text: event.currentTarget.value })} />
          </Field>
          <PeopleField label="With" value={draft.with} people={ctx.people} exclude={c.entity} disabled={ctx.busy} onChange={(next) => setDraft({ ...draft, with: next })} />
          <Field
            label="Due in (hours from now)"
            for={ids.due}
            help={draft.due === null ? `From ${ctx.view.nowText}. Blank for no due time.` : dueText && dueIn.trim() === "" ? `Due ${dueText}. Blank keeps it.` : `From ${ctx.view.nowText}.`}
            error={draft.due !== null && !Number.isFinite(draft.due) ? "Hours as a number, like 24 or 1.5." : null}
          >
            <div class="lre-gm-minds-due">
              <input id={ids.due} class={draft.due !== null && !Number.isFinite(draft.due) ? "lre-input invalid" : "lre-input"} inputMode="decimal" placeholder="Hours, like 24" value={dueIn} onInput={(event) => setDue(event.currentTarget.value)} />
              {draft.due !== null ? (
                <Button
                  icon="close"
                  onClick={() => {
                    setDueIn("");
                    setDraft({ ...draft, due: null });
                  }}
                >
                  No due time
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Status" for={ids.status}>
            <select id={ids.status} class="lre-input" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.currentTarget.value as CommitmentStatus })}>
              {COMMITMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {COMMITMENT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        </Section>
        <Submit ctx={ctx} ready={op !== null} icon={commitment ? "check" : "plus"} invalid="A commitment needs its text and someone it is with.">
          {commitment ? "Save" : "Add commitment"}
        </Submit>
      </form>
      {commitment ? <DeleteItem ctx={ctx} op={deleteOp(c.entity, "commitment", commitment.id)} noun="commitment" onDone={props.onBack} /> : null}
    </ChangePage>
  );
}

function PlanPage(props: { ctx: Ctx; c: MindsGmCharacter; plan: Plan | null; onBack(): void }) {
  const { ctx, c, plan } = props;
  const now = ctx.view.now;
  const [draft, setDraft] = useState<PlanFormDraft>(() => planDraft(now, plan ?? undefined));
  const [startIn, setStartIn] = useState(() => String(Math.round(((draft.from - now) / 60) * 4) / 4));
  const [lasts, setLasts] = useState(() => String(draft.to - draft.from));
  const [amount, setAmount] = useState(() => (draft.cents === null ? "" : formatMoneyInput(draft.cents, ctx.currency)));
  const money = isMoneyPlan(draft.kind);
  const amountOff = amount.trim() !== "" && draft.cents === null;
  const ids = { what: useId(), kind: useId(), start: useId(), lasts: useId(), where: useId(), status: useId() };
  const op = planOp(c.entity, plan?.id ?? null, draft);
  // Text that isn't a number leaves the plan's start or length as it was.
  const startOff = startIn.trim() !== "" && !Number.isFinite(Number(startIn));
  const minutes = Number(lasts);
  const lastsOff = !(Number.isInteger(minutes) && minutes > 0);
  return (
    <ChangePage name="mind-plan" title={plan ? "Edit plan" : "Add a plan"} c={c} onBack={props.onBack}>
      <form
        class="lre-stack"
        data-lre-minds-form="plan"
        onSubmit={(event) => {
          event.preventDefault();
          if (op) send(ctx, op, props.onBack);
        }}
      >
        <Section>
          <Field label="What" for={ids.what} help={used(draft.what, MIND_TEXT_CAPS.planWhat)}>
            <input id={ids.what} class="lre-input" placeholder="What they mean to do" maxLength={MIND_TEXT_CAPS.planWhat} value={draft.what} onInput={(event) => setDraft({ ...draft, what: event.currentTarget.value })} />
          </Field>
          <Field label="Kind" for={ids.kind}>
            <select id={ids.kind} class="lre-input" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.currentTarget.value as PlanKind })}>
              {PLAN_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PLAN_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Starts in (hours from now)"
            for={ids.start}
            help={`From ${ctx.view.nowText}; negative for earlier.${plan ? ` Saved: ${plan.fromText} – ${plan.toText}.` : ""}`}
            error={startOff ? "Hours as a number, like 2 or -1.5. Until then the start stays as it was." : null}
          >
            <input
              id={ids.start}
              class={startOff ? "lre-input invalid" : "lre-input"}
              inputMode="decimal"
              value={startIn}
              onInput={(event) => {
                const text = event.currentTarget.value;
                setStartIn(text);
                const hours = Number(text);
                if (text.trim() !== "" && Number.isFinite(hours)) setDraft(startPlanIn(draft, now, hours));
              }}
            />
          </Field>
          <Field label="Lasts (minutes)" for={ids.lasts} error={lastsOff ? "Whole minutes, more than 0. Until then the length stays as it was." : null}>
            <input
              id={ids.lasts}
              class={lastsOff ? "lre-input invalid" : "lre-input"}
              inputMode="numeric"
              value={lasts}
              onInput={(event) => {
                const text = event.currentTarget.value;
                setLasts(text);
                const length = Number(text);
                if (Number.isInteger(length) && length > 0) setDraft(planLasts(draft, length));
              }}
            />
          </Field>
          <Field label="Where" for={ids.where}>
            <select id={ids.where} class="lre-input" value={draft.where ?? ""} onChange={(event) => setDraft({ ...draft, where: event.currentTarget.value || null })}>
              <option value="">Anywhere</option>
              {ctx.places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          {money ? (
            <Field label="Amount" help="Handed to the first person it's with, at the plan's time." error={amountOff ? "An amount above zero, like 20 or 12.50." : null}>
              <MoneyInput
                currency={ctx.currency}
                label="Amount"
                value={amount}
                invalid={amountOff}
                onInput={(text) => {
                  setAmount(text);
                  const cents = parseMoneyInput(text, ctx.currency);
                  setDraft({ ...draft, cents: cents !== null && cents > 0 ? cents : null });
                }}
              />
            </Field>
          ) : null}
          <PeopleField label="With" value={draft.with} people={ctx.people} exclude={c.entity} disabled={ctx.busy} onChange={(next) => setDraft({ ...draft, with: next })} />
          <Field label="Priority" help="1 whenever it fits, 5 it must happen.">
            <Seg<number>
              label="Priority"
              value={draft.priority}
              options={Array.from({ length: PLAN_PRIORITY.max - PLAN_PRIORITY.min + 1 }, (_, i) => ({ value: PLAN_PRIORITY.min + i, label: String(PLAN_PRIORITY.min + i), title: i === 0 ? "Whenever it fits" : i === PLAN_PRIORITY.max - PLAN_PRIORITY.min ? "It must happen" : undefined }))}
              onChange={(priority) => setDraft({ ...draft, priority })}
            />
          </Field>
          <Field label="Status" for={ids.status}>
            <select id={ids.status} class="lre-input" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.currentTarget.value as PlanStatus })}>
              {(["open", "done", "dropped"] as const).map((s) => (
                <option key={s} value={s}>
                  {PLAN_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        </Section>
        <Submit ctx={ctx} ready={op !== null} icon={plan ? "check" : "plus"} invalid={money ? "A plan to pay or lend needs what it is, a length, an amount and someone it is with." : "A plan needs what it is, and a length."}>
          {plan ? "Save" : "Add plan"}
        </Submit>
      </form>
      {plan ? <DeleteItem ctx={ctx} op={deleteOp(c.entity, "plan", plan.id)} noun="plan" onDone={props.onBack} /> : null}
    </ChangePage>
  );
}

// ---------------------------------------------------------------- what they know

/** Someone who holds facts: a character, or the player character, with the witness log a holding can rest on (none for the player character). */
type Knower = Pick<MindsGmCharacter, "entity" | "name" | "holdings" | "witness">;

const HOW_ICON: Record<HoldingHow, IconName> = { authored: "scroll", witnessed: "eye", told: "message", inferred: "sparkle", guessed: "help" };

/** How they came by it, in words: "Told by Marcus Delgado", "Witnessed". */
function howWords(h: MindsGmHolding): string {
  if (h.byName === null) return HOW_LABEL[h.how];
  return h.how === "told" ? `Told by ${h.byName}` : `${HOW_LABEL[h.how]}, from ${h.byName}`;
}

/** What they make of it, how sure they are, and whom they keep it from. */
function beliefWords(h: MindsGmHolding): string {
  const kept = h.keptFromNames === "everyone" ? " · kept from everyone" : h.keptFromNames.length > 0 ? ` · kept from ${h.keptFromNames.join(", ")}` : "";
  return `${BELIEF_LABEL[h.belief]}, ${Math.round(h.confidence * 100)}% sure${kept}`;
}

/**
 * What they know (DESIGN §24.11): each holding with how and since when they hold it, how sure they
 * are and whom they keep it from, and what it rests on (a fact, or the witness entry itself), marked
 * when it is a suspicion or the fact isn't true. Each opens its own page; Add holds a fact the chat
 * has that they don't.
 */
function Holdings(props: { ctx: Ctx; who: Knower; open(change: Change): void }) {
  const { ctx, who } = props;
  const facts = ctx.view.knowledge.facts;
  const unheld = facts.filter((f) => !who.holdings.some((h) => h.fact === f.id)).length;
  return (
    <Section title="What they know" aside={<Badge>{`${who.holdings.length} held`}</Badge>} flush>
      {who.holdings.length === 0 ? <None>Nothing recorded.</None> : null}
      <List>
        {who.holdings.map((h) => (
          <ListRow
            key={h.fact}
            id={h.fact}
            icon={HOW_ICON[h.how]}
            title={h.claim}
            subtitle={
              <span class="lre-gm-minds-lines">
                <span>{`${howWords(h)} · since ${h.sinceText}`}</span>
                <span>{beliefWords(h)}</span>
                {h.evidenceShown.length > 0 ? <span>{`Rests on: ${h.evidenceShown.map((e) => e.text).join("; ")}`}</span> : null}
              </span>
            }
            badge={h.suspicion ? <Badge tone="warn">Suspicion</Badge> : h.truth !== "true" ? <Badge>{TRUTH_LABEL[h.truth]}</Badge> : undefined}
            chevron
            disabled={ctx.busy}
            onClick={() => props.open({ kind: "holding", fact: h.fact })}
          />
        ))}
        <ListRow icon="plus" title="Add a holding" subtitle={unheld > 0 ? undefined : facts.length === 0 ? "The chat holds no facts yet" : "They hold every fact the chat has"} disabled={ctx.busy || unheld === 0} onClick={() => props.open({ kind: "holding", fact: null })} />
      </List>
    </Section>
  );
}

/**
 * One holding's page: the fact (picked when adding), how they came by it and from whom, what they
 * make of it and how sure (under the threshold it is a suspicion), whom they keep it from and what
 * it rests on, saved whole; and taking it away, which the edit's Undo brings back.
 */
function HoldingPage(props: { ctx: Ctx; who: Knower; holding: MindsGmHolding | null; onBack(): void }) {
  const { ctx, who, holding } = props;
  const knowledge = ctx.view.knowledge;
  const choices = knowledge.facts.filter((f) => f.id === holding?.fact || !who.holdings.some((h) => h.fact === f.id));
  const [fact, setFact] = useState<FactId>(() => holding?.fact ?? choices[0]?.id ?? "");
  const [draft, setDraft] = useState<HoldingDraft>(() => holdingDraft(ctx.view.now, holding ?? undefined));
  const ids = { fact: useId(), how: useId(), by: useId(), confidence: useId(), grounds: useId() };
  const chosen = knowledge.facts.find((f) => f.id === fact);
  const op = chosen ? holdingOp(who.entity, fact, draft) : null;
  // What it can rest on: the other facts they hold, and their own witness entries.
  const grounds = [...who.holdings.filter((h) => h.fact !== fact).map((h) => ({ ref: h.fact, text: h.claim })), ...who.witness.map((w) => ({ ref: witnessRef(w), text: `${w.what} (${w.clock})` }))];
  const groundText = (ref: string): string => grounds.find((g) => g.ref === ref)?.text ?? holding?.evidenceShown.find((e) => e.ref === ref)?.text ?? ref;
  const left = grounds.filter((g) => !draft.evidence.includes(g.ref));
  const percent = Number(draft.confidence);
  const sureOff = draft.confidence.trim() === "" || !Number.isInteger(percent) || percent < 0 || percent > 100;
  const threshold = Math.round(knowledge.threshold * 100);
  return (
    <ChangePage name="mind-holding" title={holding ? "Edit holding" : "Add a holding"} c={who} onBack={props.onBack}>
      <form
        class="lre-stack"
        data-lre-minds-form="holding"
        onSubmit={(event) => {
          event.preventDefault();
          if (op) send(ctx, op, props.onBack);
        }}
      >
        <Section>
          {holding ? (
            <p class="lre-gm-minds-prose">{holding.claim}</p>
          ) : (
            <Field label="What they hold" for={ids.fact} help={chosen ? `${TRUTH_LABEL[chosen.truth]}, as you hold it.` : "The chat holds no fact they don't."}>
              <select id={ids.fact} class="lre-input" value={fact} disabled={ctx.busy || choices.length === 0} onChange={(event) => setFact(event.currentTarget.value)}>
                {choices.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.claim}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="How they came by it" for={ids.how}>
            <select id={ids.how} class="lre-input" value={draft.how} disabled={ctx.busy} onChange={(event) => setDraft({ ...draft, how: event.currentTarget.value as HoldingHow })}>
              {HOLDING_HOWS.map((h) => (
                <option key={h} value={h}>
                  {HOW_LABEL[h]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Who told them" for={ids.by} help={draft.how === "told" ? "A told holding names who told them." : "No one, unless someone gave it to them."}>
            <select id={ids.by} class="lre-input" value={draft.by ?? ""} disabled={ctx.busy} onChange={(event) => setDraft({ ...draft, by: event.currentTarget.value || null })}>
              <option value="">No one</option>
              {ctx.people
                .filter((p) => p.id !== who.entity)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="What they make of it">
            <Seg<HoldingBelief> label="What they make of it" value={draft.belief} options={HOLDING_BELIEFS.map((b) => ({ value: b, label: BELIEF_LABEL[b] }))} onChange={(belief) => setDraft({ ...draft, belief })} />
          </Field>
          <Field label="How sure (percent)" for={ids.confidence} help={`Under ${threshold}% it is a suspicion (Settings → Minds → Knowledge).${!sureOff && percent < threshold ? " This one is." : ""}`} error={sureOff ? "A whole number from 0 to 100." : null}>
            <input id={ids.confidence} class={sureOff ? "lre-input invalid" : "lre-input"} inputMode="numeric" value={draft.confidence} onInput={(event) => setDraft({ ...draft, confidence: event.currentTarget.value })} />
          </Field>
          <Field label="Whom they keep it from">
            <Seg<HoldingDraft["kept"]>
              label="Whom they keep it from"
              value={draft.kept}
              options={[
                { value: "none", label: "No one" },
                { value: "everyone", label: "Everyone" },
                { value: "some", label: "Some people" },
              ]}
              onChange={(kept) => setDraft({ ...draft, kept })}
            />
          </Field>
          {draft.kept === "some" ? <PeopleField label="Kept from" value={draft.keptFrom} people={ctx.people} exclude={who.entity} disabled={ctx.busy} onChange={(keptFrom) => setDraft({ ...draft, keptFrom })} /> : null}
          <Field label="What it rests on" for={left.length > 0 ? ids.grounds : undefined} help="Other facts they hold, and what they witnessed or were told.">
            {draft.evidence.length > 0 ? (
              <div class="lre-form-chips">
                {draft.evidence.map((ref) => (
                  <Chip key={ref} removeLabel={`Remove ${groundText(ref)}`} disabled={ctx.busy} onRemove={() => setDraft({ ...draft, evidence: draft.evidence.filter((r) => r !== ref) })}>
                    {groundText(ref)}
                  </Chip>
                ))}
              </div>
            ) : null}
            {left.length > 0 ? (
              <select id={ids.grounds} class="lre-input" value="" disabled={ctx.busy} onChange={(event) => event.currentTarget.value && setDraft({ ...draft, evidence: [...draft.evidence, event.currentTarget.value] })}>
                <option value="">Add what it rests on…</option>
                {left.map((g) => (
                  <option key={g.ref} value={g.ref}>
                    {g.text}
                  </option>
                ))}
              </select>
            ) : null}
          </Field>
        </Section>
        <Submit ctx={ctx} ready={op !== null} icon={holding ? "check" : "plus"} invalid={chosen ? "A told holding names who told them, never themselves; how sure is a whole percent; keeping it from some people names them." : "Pick a fact they don't hold yet."}>
          {holding ? "Save" : "Add holding"}
        </Submit>
      </form>
      {holding ? <DeleteItem ctx={ctx} op={forgetOp(who.entity, holding.fact)} noun="holding" onDone={props.onBack} /> : null}
    </ChangePage>
  );
}

/** The player character's page: they have no mind (the player decides for them), but they hold what they know, each holding its own page over it. */
function KnowerPages(props: { ctx: Ctx; who: Knower; onBack(): void }) {
  const { ctx, who } = props;
  const changes = usePages<Change>();
  const change = changes.page;
  const holding = change?.kind === "holding" && change.fact !== null ? who.holdings.find((h) => h.fact === change.fact) : undefined;
  // A holding taken back (an Undo) takes its page with it.
  const gone = change?.kind === "holding" && change.fact !== null && holding === undefined;
  useEffect(() => {
    if (gone) changes.back();
  });
  // A holding taken away leaves no row to take focus back: keep it on this page rather than lose it.
  const was = useRef(change);
  useEffect(() => {
    const before = was.current;
    was.current = change;
    const root = changes.host.ref.current;
    if (before === null || change !== null || !root || root.contains(document.activeElement)) return;
    root.querySelector<HTMLElement>(".lre-page-header button")?.focus();
  }, [change]);
  return (
    <div ref={changes.host.ref} class="lre-gm-page lre-gm-pages lre-gm-minds-pages" onKeyDown={changes.host.onKeyDown}>
      <div class="lre-gm-list" hidden={change !== null}>
        <GmPage
          name="mind-knower"
          title={who.name}
          subtitle={
            <>
              The player character
              <IdText id={who.entity} />
            </>
          }
          backLabel="Minds"
          actions={<SheetLink entity={who.entity} />}
          onBack={props.onBack}
        >
          <div class="lre-gm-minds" data-lre-gm-minds={who.entity}>
            <p class="lre-gm-note">The player decides for them, so they have no mind. What they know is what the story, the world's author and you have given them; nothing here reaches Play until the story tells them.</p>
            <Holdings ctx={ctx} who={who} open={changes.open} />
          </div>
        </GmPage>
      </div>
      {change?.kind === "holding" && (change.fact === null || holding) ? <HoldingPage key={change.fact ?? ""} ctx={ctx} who={who} holding={holding ?? null} onBack={changes.back} /> : null}
    </div>
  );
}

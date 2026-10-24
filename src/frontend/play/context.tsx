// GM → This chat → Inspector (`core.context`, DESIGN §6.5): per generation, the activation
// confirmation, the engine sections with their token cost, clipping and delivery, the section
// budget, and the lore each model step read (§5.4): its searches, the entries it was given with
// their token cost, its lookups and how they reached the model; the minds calls (whose mind ran, at
// which level, how it went and what it cost, only for people the player can see and has met, and
// never a word of what a mind said or whether its depiction was kept back); and the call meter.
// Built by the backend as `core.context`: an unrevealed secret entry isn't in it at all, a search
// that would name a secret or someone the player hasn't met is withheld, a step that may read a
// secret or an NPC's private options shows its lookups without their text ("—"), and an NPC choice,
// being private, shows no counts and no entries. So it needs no GM gate.

import { useEffect, useState } from "preact/hooks";
import { isRecord } from "../../shared/json";
import { LORE_AUDIENCE } from "../../shared/lore";
import type { LorePolicy } from "../../shared/settings";
import { LORE_POLICIES } from "../../shared/settings";
import type { CallMeterView, ContextView, LoreStepTrace } from "../../shared/state-view";
import { useApp } from "../app";
import { Badge, Banner, Empty, IconButton, JsonView, List, ListRow, Meter, Section } from "../components";
import { list, num, oneOf, optNum, str, strings } from "../decode";
import { ActionRow, ActionRows } from "../gm/ui";
import { Icon } from "../icons";
import type { PanelProps } from "../registry";
import { STEP_LABEL } from "../../shared/steps";
import type { MindCallTrace } from "../../shared/minds";
import { FIDELITIES, MIND_PURPOSES } from "../../shared/minds";
import { FIDELITY_LABEL } from "../../packs/minds/ui/ops";

const POLICY_LABEL: Record<LorePolicy, string> = { none: "lore off", prefetch: "prefetch", lookup: "lookups", "prefetch+lookup": "prefetch and lookups" };
const TRANSPORT_LABEL: Record<LoreStepTrace["transport"], string> = { none: "", tools: "through tools", need: "through the ask form" };
const QUERY_LABEL: Record<LoreStepTrace["queries"][number]["kind"], string> = { prefetch: "Prefetch", search: "Search", get: "Read", list: "List" };

function decodeLore(value: unknown): LoreStepTrace[] {
  return list(value, (t) => ({
    step: oneOf(t.step, LORE_AUDIENCE, "interpret"),
    phase: oneOf(t.phase, ["pre", "post"] as const, "pre"),
    policy: oneOf(t.policy, LORE_POLICIES, "prefetch"),
    transport: oneOf(t.transport, ["none", "tools", "need"] as const, "none"),
    queries: list(t.queries, (q) => ({ kind: oneOf(q.kind, ["prefetch", "search", "get", "list"] as const, "search"), text: str(q.text), matched: optNum(q.matched) })),
    entries: list(t.entries, (e) => ({ title: str(e.title), tokens: num(e.tokens), cut: e.cut === true, ...(e.pinned === true ? { pinned: true as const } : {}) })),
    ...(t.private === true ? { private: true as const } : {}),
    lookups: num(t.lookups),
    notes: strings(t.notes),
  }));
}

const MIND_OUTCOME: Record<MindCallTrace["outcome"], { text: string; tone: "neutral" | "pos" | "neg" | "warn" }> = {
  recorded: { text: "recorded", tone: "pos" },
  failed: { text: "failed", tone: "neg" },
};
const MIND_PHASE: Record<MindCallTrace["phase"], string> = { pre: "Before the reply", post: "After the reply", skip: "In a time skip" };
const MIND_PROMPT: Record<MindCallTrace["prompt"], string> = { world: "the world's prompt", override: "your prompt", default: "the built-in prompt" };

function decodeMinds(value: unknown): MindCallTrace[] {
  return list(value, (t) => ({
    purpose: oneOf(t.purpose, MIND_PURPOSES, "mind"),
    phase: oneOf(t.phase, ["pre", "post", "skip"] as const, "pre"),
    who: str(t.who, "Someone"),
    level: t.level === null ? null : oneOf(t.level, FIDELITIES, "near"),
    outcome: oneOf(t.outcome, ["recorded", "failed"] as const, "failed"),
    ms: num(t.ms),
    tokens: num(t.tokens),
    prompt: oneOf(t.prompt, ["world", "override", "default"] as const, "default"),
    pinned: list(t.pinned, (p) => ({ title: str(p.title), tokens: num(p.tokens), cut: p.cut === true })),
    activated: list(t.activated, (p) => ({ title: str(p.title), tokens: num(p.tokens), cut: p.cut === true })),
    ...(num(t.routine) > 0 ? { routine: num(t.routine) } : {}),
    ...(num(t.plans) > 0 ? { plans: num(t.plans) } : {}),
    ...(num(t.history) > 0 ? { history: num(t.history) } : {}),
    notes: strings(t.notes),
  }));
}

const DELIVERY = ["verified", "unverified", "unchecked"] as const;
type Delivery = (typeof DELIVERY)[number];
const DELIVERY_BADGE: Record<Delivery, { text: string; tone: "pos" | "neg" | "neutral" }> = {
  verified: { text: "Delivered", tone: "pos" },
  unverified: { text: "Not delivered", tone: "neg" },
  unchecked: { text: "Unchecked", tone: "neutral" },
};

export function decodeContextView(value: unknown): ContextView | null {
  if (!isRecord(value) || !Array.isArray(value.generations)) return null;
  return {
    warnings: strings(value.warnings),
    generations: list(value.generations, (g) => {
      const budget = isRecord(g.budget) ? g.budget : {};
      return {
        id: str(g.id),
        at: num(g.at),
        activation: oneOf(g.activation, ["confirmed", "unconfirmed"] as const, "unconfirmed"),
        sections: list(g.sections, (s) => {
          const cut = optNum(s.cut);
          return { slot: str(s.slot), label: str(s.label, str(s.slot)), tokens: num(s.tokens), clipped: s.clipped === true, ...(cut !== undefined && cut > 0 ? { cut } : {}), delivery: oneOf(s.delivery, DELIVERY, "unchecked") };
        }),
        budget: { sections: num(budget.sections), used: num(budget.used) },
        lore: decodeLore(g.lore),
        minds: decodeMinds(g.minds),
      };
    }),
  };
}

const ACTIVATION: Record<ContextView["generations"][number]["activation"], { text: string; tone: "pos" | "warn" }> = {
  confirmed: { text: "Activation confirmed", tone: "pos" },
  unconfirmed: { text: "Not confirmed", tone: "warn" },
};

/** Why a section's row is short: left out over the section budget, or (the Minds section) lines left out over its own. */
export function sectionNote(s: ContextView["generations"][number]["sections"][number]): string | undefined {
  if (s.cut === undefined) return s.clipped ? "Left out: over the section budget" : undefined;
  if (s.clipped) return "Left out: over its own budget";
  return `${s.cut} line${s.cut === 1 ? "" : "s"} left out: over its own budget`;
}

/** The model calls replies make: this turn's, the average and the 95th percentile. */
function CallMeter(props: { meter: CallMeterView }) {
  const rows = [
    ["This turn", props.meter.turn],
    ["Average", props.meter.average],
    ["95th percentile", props.meter.p95],
  ] as const;
  return (
    <Section title="Call meter">
      <ActionRows label="Call meter">
        {rows.map(([label, m]) => (
          <ActionRow key={label} title={label} subtitle={`${Math.round(m.tokens)} tokens${m.lookups > 0 ? ` · ${Number(m.lookups.toFixed(1))} lore lookup${m.lookups === 1 ? "" : "s"}` : ""}`} value={`${Number(m.calls.toFixed(1))} calls · ${(m.ms / 1000).toFixed(1)} s`} />
        ))}
      </ActionRows>
    </Section>
  );
}

export function ContextPanel(props: PanelProps) {
  const view = decodeContextView(props.view);
  const [index, setIndex] = useState(0);
  const app = useApp();
  // Opening the inspector runs the backend's deliverability check (a dry-run assembly).
  useEffect(() => {
    void app.request({ type: "lre.view.open", chatId: props.chatId, panel: "core.context", entity: null });
  }, [props.chatId]);
  const meter = props.state.meter ? <CallMeter meter={props.state.meter} /> : null;
  if (props.view === undefined || props.view === null) {
    return (
      <div class="lre-stack" data-lre-panel="core.context">
        <Empty icon="code" title="Nothing inspected yet">
          The inspector fills in after the first reply.
        </Empty>
        {meter}
      </div>
    );
  }
  if (!view) return <JsonView value={props.view} />;
  const generations = [...view.generations].sort((a, b) => b.at - a.at);
  const shownIndex = Math.min(index, generations.length - 1);
  const generation = generations[shownIndex];
  const total = generation ? generation.budget.sections : 0;
  return (
    <div class="lre-stack" data-lre-panel="core.context">
      {view.warnings.map((warning) => (
        <Banner key={warning} tone="warn">
          {warning}
        </Banner>
      ))}
      {!generation ? (
        <Empty icon="code">No generations inspected yet.</Empty>
      ) : (
        <>
          <div class="lre-gm-pager" role="group" aria-label="Generation">
            <IconButton icon="chevron-left" label="Older generation" disabled={shownIndex >= generations.length - 1} onClick={() => setIndex(shownIndex + 1)} />
            <span class="lre-gm-pager-text">
              <span class="lre-gm-pager-when">{generation.at > 0 ? new Date(generation.at).toLocaleString() : "—"}</span>
              <span class="lre-gm-pager-count">
                {shownIndex === 0 ? "Latest" : `${shownIndex} older`} · {generations.length} kept
              </span>
            </span>
            <IconButton icon="chevron-right" label="Newer generation" disabled={shownIndex === 0} onClick={() => setIndex(shownIndex - 1)} />
          </div>
          <Section title="Activation" aside={<Badge tone={ACTIVATION[generation.activation].tone}>{ACTIVATION[generation.activation].text}</Badge>}>
            <Meter label={`Section budget: ${generation.budget.used} of ${total} tokens`} value={generation.budget.used} max={total} tone={generation.budget.used > total ? "neg" : "accent"} />
          </Section>
          <Section title="Engine sections" flush>
            {generation.sections.length === 0 ? (
              <Empty>None.</Empty>
            ) : (
              <List>
                {generation.sections.map((s) => (
                  <ListRow
                    key={s.slot}
                    id={s.slot}
                    title={s.label}
                    subtitle={sectionNote(s)}
                    value={`${s.tokens} tok`}
                    valueTone={s.clipped || s.cut !== undefined ? "warn" : undefined}
                    badge={s.clipped ? <Badge tone="warn">Clipped</Badge> : <Badge tone={DELIVERY_BADGE[s.delivery].tone}>{DELIVERY_BADGE[s.delivery].text}</Badge>}
                  />
                ))}
              </List>
            )}
          </Section>
          {(generation.lore ?? []).length > 0 ? (
            <Section title="Lore the helpers read">
              {(generation.lore ?? []).map((t, i) => (
                <div key={`${t.phase}:${t.step}:${i}`} class="lre-gm-lore" data-lre-lore-step={t.step}>
                  <ActionRows label={STEP_LABEL[t.step]}>
                    <ActionRow
                      title={STEP_LABEL[t.step]}
                      subtitle={[t.phase === "pre" ? "Before the reply" : "After the reply", POLICY_LABEL[t.policy], t.lookups > 0 ? `${t.lookups} lookup${t.lookups === 1 ? "" : "s"}${t.transport === "none" ? "" : ` ${TRANSPORT_LABEL[t.transport]}`}` : null].filter((part) => part !== null).join(" · ")}
                      value={t.private ? "Private" : `${t.entries.reduce((s, e) => s + e.tokens, 0)} tok`}
                    >
                      {t.queries.length > 0 ? (
                        <ul class="lre-gm-queries">
                          {t.queries.map((q, j) => (
                            <li key={`q${j}`}>
                              {QUERY_LABEL[q.kind]}: {q.text === "" ? "—" : q.text}
                              {q.matched === undefined ? "" : ` · ${q.matched} found`}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </ActionRow>
                    {t.entries.map((e, j) => (
                      <ActionRow key={`e${j}`} title={e.title === "" ? "—" : e.title} subtitle={[e.pinned ? "Pinned here" : "", e.cut ? "Cut to fit" : ""].filter((s) => s !== "").join(" · ") || undefined} value={`${e.tokens} tok`} />
                    ))}
                  </ActionRows>
                  {t.notes.map((n) => (
                    <p key={n} class="lre-gm-warnline">
                      <Icon name="alert" size={16} />
                      {n}
                    </p>
                  ))}
                </div>
              ))}
            </Section>
          ) : null}
          {(generation.minds ?? []).length > 0 ? (
            <Section title="Minds">
              <ActionRows label="Minds">
                {(generation.minds ?? []).map((m, i) => (
                  <ActionRow
                    key={`${m.phase}:${m.purpose}:${i}`}
                    title={m.who === "" ? STEP_LABEL[m.purpose] : `${m.who} · ${STEP_LABEL[m.purpose]}`}
                    subtitle={[...(m.level ? [FIDELITY_LABEL[m.level]] : []), MIND_PHASE[m.phase], MIND_PROMPT[m.prompt]].join(" · ")}
                    value={`${(m.ms / 1000).toFixed(1)} s · ${m.tokens} tok`}
                    actions={<Badge tone={MIND_OUTCOME[m.outcome].tone}>{MIND_OUTCOME[m.outcome].text}</Badge>}
                  >
                    {(m.pinned ?? []).length > 0 || (m.activated ?? []).length > 0 || (m.routine ?? 0) > 0 || (m.plans ?? 0) > 0 || (m.history ?? 0) > 0 || (m.notes ?? []).length > 0 ? (
                      <div class="lre-gm-minds-pinned" data-lre-mind-pins>
                        {(m.pinned ?? []).length > 0 ? <span>Pinned lore: {(m.pinned ?? []).map((p) => `${p.title} (${p.tokens} tok${p.cut ? ", cut" : ""})`).join(", ")}</span> : null}
                        {(m.activated ?? []).length > 0 ? <span>Lore the turn activated: {(m.activated ?? []).map((p) => `${p.title} (${p.tokens} tok${p.cut ? ", cut" : ""})`).join(", ")}</span> : null}
                        {(m.routine ?? 0) > 0 ? <span data-lre-mind-routine>Their usual routine: {m.routine} line{m.routine === 1 ? "" : "s"}</span> : null}
                        {(m.plans ?? 0) > 0 ? <span data-lre-mind-plans>Their plans: {m.plans}</span> : null}
                        {(m.history ?? 0) > 0 ? <span data-lre-mind-history>Recent chat: {m.history} message{m.history === 1 ? "" : "s"}</span> : null}
                        {(m.notes ?? []).map((n) => (
                          <p key={n} class="lre-gm-warnline">
                            <Icon name="alert" size={16} />
                            {n}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </ActionRow>
                ))}
              </ActionRows>
            </Section>
          ) : null}
        </>
      )}
      {meter}
    </div>
  );
}

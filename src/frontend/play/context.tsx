// Play → Context (DESIGN §6.5): per generation, the activation confirmation, the engine sections
// with their token cost, clipping and delivery, the section budget, and the lore each model step
// read (§5.4): its searches, the entries it was given with their token cost, its lookups and how
// they reached the model. Built by the backend as `core.context`: an unrevealed secret entry isn't
// in it at all, a search that would name a secret or someone the player hasn't met is withheld, a
// step that may read a secret or an NPC's private options shows its lookups without their text
// ("—"), and an NPC choice, being private, shows no counts and no entries. The minds calls show
// whose mind ran, at which level, how it went and what it cost, only for people the player can see
// and has met, and never a word of what a mind said or whether its depiction was kept back.

import { useEffect, useState } from "preact/hooks";
import { isRecord } from "../../shared/json";
import { LORE_AUDIENCE } from "../../shared/lore";
import type { LorePolicy } from "../../shared/settings";
import { LORE_POLICIES } from "../../shared/settings";
import { useApp } from "../app";
import { Card, Empty, JsonView, Row } from "../components";
import { list, num, oneOf, optNum, str, strings } from "../decode";
import type { PanelProps } from "../registry";
import { STEP_LABEL } from "../settings/steps";
import type { ContextView, LoreStepTrace } from "../../shared/state-view";
import type { MindCallTrace } from "../../shared/minds";
import { FIDELITIES, MIND_PURPOSES } from "../../shared/minds";
import { FIDELITY_LABEL } from "../../packs/minds/ui/ops";

const POLICY_LABEL: Record<LorePolicy, string> = { none: "lore off", prefetch: "prefetch", lookup: "lookups", "prefetch+lookup": "prefetch and lookups" };
const TRANSPORT_LABEL: Record<LoreStepTrace["transport"], string> = { none: "", tools: "tools", need: "ask form" };
const QUERY_LABEL: Record<LoreStepTrace["queries"][number]["kind"], string> = { prefetch: "Prefetch", search: "Search", get: "Read", list: "List" };

function decodeLore(value: unknown): LoreStepTrace[] {
  return list(value, (t) => ({
    step: oneOf(t.step, LORE_AUDIENCE, "interpret"),
    phase: oneOf(t.phase, ["pre", "post"] as const, "pre"),
    policy: oneOf(t.policy, LORE_POLICIES, "prefetch"),
    transport: oneOf(t.transport, ["none", "tools", "need"] as const, "none"),
    queries: list(t.queries, (q) => ({ kind: oneOf(q.kind, ["prefetch", "search", "get", "list"] as const, "search"), text: str(q.text), matched: optNum(q.matched) })),
    entries: list(t.entries, (e) => ({ title: str(e.title), tokens: num(e.tokens), cut: e.cut === true })),
    ...(t.private === true ? { private: true as const } : {}),
    lookups: num(t.lookups),
    notes: strings(t.notes),
  }));
}

const MIND_OUTCOME: Record<MindCallTrace["outcome"], { text: string; tone: string }> = {
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
    level: oneOf(t.level, FIDELITIES, "near"),
    outcome: oneOf(t.outcome, ["recorded", "failed"] as const, "failed"),
    ms: num(t.ms),
    tokens: num(t.tokens),
    prompt: oneOf(t.prompt, ["world", "override", "default"] as const, "default"),
  }));
}

const DELIVERY = ["verified", "unverified", "unchecked"] as const;
type Delivery = (typeof DELIVERY)[number];
const DELIVERY_BADGE: Record<Delivery, { text: string; tone: string }> = {
  verified: { text: "delivered", tone: "pos" },
  unverified: { text: "not delivered", tone: "neg" },
  unchecked: { text: "unchecked", tone: "" },
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
        sections: list(g.sections, (s) => ({ slot: str(s.slot), label: str(s.label, str(s.slot)), tokens: num(s.tokens), clipped: s.clipped === true, delivery: oneOf(s.delivery, DELIVERY, "unchecked") })),
        budget: { sections: num(budget.sections), used: num(budget.used) },
        lore: decodeLore(g.lore),
        minds: decodeMinds(g.minds),
      };
    }),
  };
}

const ACTIVATION: Record<ContextView["generations"][number]["activation"], { text: string; tone: string }> = {
  confirmed: { text: "Activation confirmed", tone: "pos" },
  unconfirmed: { text: "Not confirmed", tone: "warn" },
};

export function ContextPanel(props: PanelProps) {
  const view = decodeContextView(props.view);
  const [index, setIndex] = useState(0);
  const app = useApp();
  // Opening the inspector runs the backend's deliverability check (a dry-run assembly).
  useEffect(() => {
    void app.request({ type: "lre.view.open", chatId: props.chatId, panel: "core.context", entity: null });
  }, [props.chatId]);
  if (props.view === undefined || props.view === null) return <Empty>The inspector fills in after the first reply.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  const generations = [...view.generations].sort((a, b) => b.at - a.at);
  const generation = generations[Math.min(index, generations.length - 1)];
  const total = generation ? generation.budget.sections : 0;
  return (
    <div class="lre-stack" data-lre-panel="core.context">
      {view.warnings.map((warning) => (
        <div key={warning} class="lre-banner warn">
          {warning}
        </div>
      ))}
      {!generation ? (
        <Empty>No generations inspected yet.</Empty>
      ) : (
        <>
          <div class="lre-spread">
            <button type="button" class="lre-btn small" aria-label="Older generation" disabled={index >= generations.length - 1} onClick={() => setIndex(index + 1)}>
              ‹ Older
            </button>
            <span class="lre-small lre-muted">{generation.at > 0 ? new Date(generation.at).toLocaleString() : "—"}</span>
            <button type="button" class="lre-btn small" aria-label="Newer generation" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              Newer ›
            </button>
          </div>
          <Card title="Activation" aside={<span class={`lre-badge ${ACTIVATION[generation.activation].tone}`}>{ACTIVATION[generation.activation].text}</span>}>
            <Row k="Budget used" v={`${generation.budget.used} / ${total} tokens`} />
            <div class={generation.budget.used > total ? "lre-bar low" : "lre-bar"}>
              <span style={{ width: `${total > 0 ? Math.min(100, (generation.budget.used / total) * 100) : 0}%` }} />
            </div>
          </Card>
          <Card title="Engine sections">
            {generation.sections.length === 0 ? (
              <Empty>None.</Empty>
            ) : (
              generation.sections.map((s) => (
                <Row
                  key={s.slot}
                  k={s.label}
                  v={
                    <span class="lre-inline">
                      {s.tokens} tok{" "}
                      {s.clipped ? <span class="lre-badge warn">clipped</span> : <span class={`lre-badge ${DELIVERY_BADGE[s.delivery].tone}`}>{DELIVERY_BADGE[s.delivery].text}</span>}
                    </span>
                  }
                  sub={s.clipped ? "left out: over the section budget" : undefined}
                  tone={s.clipped ? "warn" : undefined}
                />
              ))
            )}
          </Card>
          {(generation.lore ?? []).length > 0 ? (
            <Card title="Lore the helpers read">
              {(generation.lore ?? []).map((t, i) => (
                <div key={`${t.phase}:${t.step}:${i}`} class="lre-stack" data-lre-lore-step={t.step} style={{ gap: "2px", marginBottom: "8px" }}>
                  <Row
                    k={STEP_LABEL[t.step]}
                    v={
                      <span class="lre-inline">
                        {t.private ? "private" : `${t.entries.reduce((s, e) => s + e.tokens, 0)} tok`}
                        {t.lookups > 0 ? (
                          <span class="lre-badge">
                            {t.lookups} lookup{t.lookups === 1 ? "" : "s"}
                            {t.transport !== "none" ? ` · ${TRANSPORT_LABEL[t.transport]}` : ""}
                          </span>
                        ) : null}
                      </span>
                    }
                    sub={`${t.phase === "pre" ? "Before the reply" : "After the reply"} · ${POLICY_LABEL[t.policy]}`}
                  />
                  {t.queries.map((q, j) => (
                    <div key={`q${j}`} class="lre-small lre-muted">
                      {QUERY_LABEL[q.kind]}: {q.text === "" ? "—" : q.text}
                      {q.matched === undefined ? "" : ` · ${q.matched} found`}
                    </div>
                  ))}
                  {t.entries.map((e, j) => (
                    <Row key={`e${j}`} k={e.title === "" ? "—" : e.title} v={`${e.tokens} tok`} sub={e.cut ? "cut to fit" : undefined} />
                  ))}
                  {t.notes.map((n) => (
                    <div key={n} class="lre-small lre-warn">
                      {n}
                    </div>
                  ))}
                </div>
              ))}
            </Card>
          ) : null}
          {(generation.minds ?? []).length > 0 ? (
            <Card title="Minds">
              {(generation.minds ?? []).map((m, i) => (
                <Row
                  key={`${m.phase}:${m.purpose}:${i}`}
                  k={`${m.who} · ${STEP_LABEL[m.purpose]}`}
                  v={
                    <span class="lre-inline">
                      {`${(m.ms / 1000).toFixed(1)} s · ${m.tokens} tok`}
                      <span class={`lre-badge ${MIND_OUTCOME[m.outcome].tone}`}>{MIND_OUTCOME[m.outcome].text}</span>
                    </span>
                  }
                  sub={`${FIDELITY_LABEL[m.level]} · ${MIND_PHASE[m.phase]} · ${MIND_PROMPT[m.prompt]}`}
                />
              ))}
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

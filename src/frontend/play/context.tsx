// Play → Context (DESIGN §6.5): per generation, the activation confirmation, the engine sections
// with their token cost, clipping and delivery, and the section budget. Built by the backend as
// `core.context`.

import { useEffect, useState } from "preact/hooks";
import { isRecord } from "../../shared/json";
import { useApp } from "../app";
import { Card, Empty, JsonView, Row } from "../components";
import { list, num, oneOf, str, strings } from "../decode";
import type { PanelProps } from "../registry";
import type { ContextView } from "../../shared/state-view";

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
        activation: oneOf(g.activation, ["confirmed", "unconfirmed", "stalled"] as const, "unconfirmed"),
        sections: list(g.sections, (s) => ({ slot: str(s.slot), label: str(s.label, str(s.slot)), tokens: num(s.tokens), clipped: s.clipped === true, delivery: oneOf(s.delivery, DELIVERY, "unchecked") })),
        budget: { sections: num(budget.sections), used: num(budget.used) },
      };
    }),
  };
}

const ACTIVATION: Record<ContextView["generations"][number]["activation"], { text: string; tone: string }> = {
  confirmed: { text: "Activation confirmed", tone: "pos" },
  unconfirmed: { text: "Not confirmed", tone: "warn" },
  stalled: { text: "Worker stalled: engine sections absent", tone: "neg" },
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
        </>
      )}
    </div>
  );
}

// Play → Context (DESIGN §6.5): per generation, every World Info candidate with its status and
// reason, the activation confirmation, the engine sections with their token cost and clipping,
// and the budget. Built by the backend as `core.context`.

import { useEffect, useState } from "preact/hooks";
import { isRecord } from "../../shared/json";
import { useApp } from "../app";
import { Card, Empty, JsonView, Row, Seg } from "../components";
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

const STATUSES = ["included", "pinned", "dropped", "unverified"] as const;
type CandidateStatus = (typeof STATUSES)[number];

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
        candidates: list(g.candidates, (c) => ({ title: str(c.title, "Untitled"), book: str(c.book), bookName: str(c.bookName, str(c.book)), status: oneOf(c.status, STATUSES, "unverified"), reason: str(c.reason) })),
        sections: list(g.sections, (s) => ({ slot: str(s.slot), label: str(s.label, str(s.slot)), tokens: num(s.tokens), clipped: s.clipped === true, delivery: oneOf(s.delivery, DELIVERY, "unchecked") })),
        budget: { sections: num(budget.sections), lore: num(budget.lore), used: num(budget.used) },
      };
    }),
  };
}

const ACTIVATION: Record<ContextView["generations"][number]["activation"], { text: string; tone: string }> = {
  confirmed: { text: "Activation confirmed", tone: "pos" },
  unconfirmed: { text: "Not confirmed", tone: "warn" },
  stalled: { text: "Worker stalled: world lore absent", tone: "neg" },
};

const STATUS_TONE: Record<CandidateStatus, string> = { included: "pos", pinned: "accent", dropped: "", unverified: "warn" };

export function ContextPanel(props: PanelProps) {
  const view = decodeContextView(props.view);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<CandidateStatus | "all">("all");
  const app = useApp();
  // Opening the inspector runs the backend's deliverability check (a dry-run assembly).
  useEffect(() => {
    void app.request({ type: "lre.view.open", chatId: props.chatId, panel: "core.context", entity: null });
  }, [props.chatId]);
  if (props.view === undefined || props.view === null) return <Empty>The inspector fills in after the first reply.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  const generations = [...view.generations].sort((a, b) => b.at - a.at);
  const generation = generations[Math.min(index, generations.length - 1)];
  const total = generation ? generation.budget.sections + generation.budget.lore : 0;
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
          <Card title="Candidates" aside={<span class="lre-badge">{generation.candidates.length}</span>}>
            <Seg<CandidateStatus | "all">
              label="Candidate status"
              value={status}
              options={[{ value: "all", label: "All" }, ...STATUSES.map((s) => ({ value: s, label: `${s[0]?.toUpperCase()}${s.slice(1)} (${generation.candidates.filter((c) => c.status === s).length})` }))]}
              onChange={(next) => setStatus(next)}
            />
            {generation.candidates
              .filter((c) => status === "all" || c.status === status)
              .map((c, i) => (
                <div key={`${c.book}:${c.title}:${i}`} class="lre-row" style={{ alignItems: "flex-start" }}>
                  <span class="k">
                    {c.title}
                    <span class="sub">
                      {c.bookName}
                      {c.reason ? ` — ${c.reason}` : ""}
                    </span>
                  </span>
                  <span class={`lre-badge ${STATUS_TONE[c.status]}`}>{c.status}</span>
                </div>
              ))}
          </Card>
        </>
      )}
    </div>
  );
}

// Play → GM view (DESIGN §7, §9.2): everything, including secrets, as labelled previews from the
// seed that record nothing. Behind a spoiler gate so a glance at Play never reveals a secret.

import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { isRecord } from "../../shared/json";
import { Card, Empty, JsonView, Row } from "../components";
import { list, num, str, strings } from "../decode";
import { formatCents } from "../format";
import type { PanelProps } from "../registry";
import type { GmMoney, GmView } from "../../shared/state-view";

export function decodeGmView(value: unknown): GmView | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.previews) && !Array.isArray(value.truths) && !Array.isArray(value.agendas) && !Array.isArray(value.money)) return null;
  return {
    label: str(value.label, "Previews — not recorded"),
    previews: list(value.previews, (p) => ({ title: str(p.title, "Preview"), lines: strings(p.lines) })),
    truths: list(value.truths, (t) => ({ track: str(t.track), stage: str(t.stage), truth: str(t.truth) })),
    agendas: list(value.agendas, (a) => ({ entity: str(a.entity), label: str(a.label), stage: str(a.stage) })),
    money: list(value.money, (m) =>
      typeof m.entity === "string"
        ? {
            entity: m.entity,
            name: str(m.name, m.entity),
            level: num(m.level, 1),
            band: typeof m.band === "string" ? m.band : null,
            netWorthCents: typeof m.netWorthCents === "number" ? m.netWorthCents : null,
            opened: m.opened !== false,
            accounts: list(m.accounts, (a) => (typeof a.id === "string" ? { id: a.id, name: str(a.name, a.id), kind: str(a.kind), cents: num(a.cents) } : null)),
            bills: list(m.bills, (b) => ({ at: str(b.at), label: str(b.label), cents: num(b.cents), payee: str(b.payee) })),
            recent: list(m.recent, (t) => ({ at: str(t.at), memo: str(t.memo), cents: num(t.cents), account: str(t.account) })),
            notes: list(m.notes, (n) => ({ at: str(n.at), text: str(n.text) })),
          }
        : null,
    ),
  };
}

function Part(props: { children: ComponentChildren }) {
  return (
    <div class="lre-small lre-muted" style={{ marginTop: "6px", textTransform: "uppercase", letterSpacing: ".06em" }}>
      {props.children}
    </div>
  );
}

/** One person's money at their own Money level: what they hold, what they pay, what moved and their notes. */
function PersonMoney(props: { money: GmMoney }) {
  const m = props.money;
  return (
    <Card title={`Money · ${m.name}`} aside={<span class="lre-badge">Money {m.level}</span>} preview>
      <div data-lre-gm-money={m.entity}>
        {m.band ? <Row k="Wealth" v={m.band} /> : null}
        {m.netWorthCents !== null ? <Row k="Net worth" v={formatCents(m.netWorthCents)} tone={m.netWorthCents < 0 ? "neg" : undefined} /> : null}
        {!m.opened ? <div class="lre-small lre-muted">Accounts not opened yet: shown with the opening balances they start from.</div> : null}
        {m.accounts.length > 0 ? <Part>Accounts</Part> : null}
        {m.accounts.map((a) => (
          <Row key={a.id} k={a.name} sub={a.kind} v={formatCents(a.cents)} tone={a.cents < 0 ? "neg" : undefined} />
        ))}
        {m.bills.length > 0 ? <Part>Bills</Part> : null}
        {m.bills.map((b, i) => (
          <Row key={`bill:${i}`} k={b.label} sub={b.payee ? `${b.at} · to ${b.payee}` : b.at} v={formatCents(b.cents)} tone="neg" />
        ))}
        {m.recent.length > 0 ? <Part>Recent</Part> : null}
        {m.recent.map((t, i) => (
          <Row key={`line:${i}`} k={t.memo} sub={`${t.at} · ${t.account}`} v={`${t.cents > 0 ? "+" : ""}${formatCents(t.cents)}`} tone={t.cents < 0 ? "neg" : "pos"} />
        ))}
        {m.notes.length > 0 ? <Part>Notes</Part> : null}
        {m.notes.map((n, i) => (
          <Row key={`note:${i}`} k={n.text} sub={n.at} />
        ))}
      </div>
    </Card>
  );
}

export function GmPanel(props: PanelProps) {
  const [revealed, setRevealed] = useState(false);
  if (!revealed) {
    return (
      <div class="lre-stack" data-lre-panel="core.gm">
        <div class="lre-banner warn">
          <strong>Spoilers ahead</strong>
          <span>The GM view shows secrets, hidden agendas, unrevealed truths and everyone's money as previews. Nothing here is recorded or shown to the narrator.</span>
          <button type="button" class="lre-btn" onClick={() => setRevealed(true)}>
            Show GM view
          </button>
        </div>
      </div>
    );
  }
  const view = decodeGmView(props.view);
  return (
    <div class="lre-stack" data-lre-panel="core.gm">
      <div class="lre-spread">
        <span class="lre-preview-label">{view?.label ?? "Previews — not recorded"}</span>
        <button type="button" class="lre-btn small" onClick={() => setRevealed(false)}>
          Hide
        </button>
      </div>
      {props.view === undefined || props.view === null ? (
        <Empty>No GM view for this world.</Empty>
      ) : !view ? (
        <Card preview>
          <JsonView value={props.view} />
        </Card>
      ) : (
        <>
          {view.truths.length > 0 ? (
            <Card title="Secret truths" preview>
              {view.truths.map((t) => (
                <Row key={`${t.track}:${t.stage}`} k={t.truth} sub={`${t.track} · ${t.stage}`} />
              ))}
            </Card>
          ) : null}
          {view.agendas.length > 0 ? (
            <Card title="Agendas" preview>
              {view.agendas.map((a) => (
                <Row key={`${a.entity}:${a.label}`} k={a.entity} sub={a.label} v={a.stage} />
              ))}
            </Card>
          ) : null}
          {view.money.map((m) => (
            <PersonMoney key={m.entity} money={m} />
          ))}
          {view.previews.map((p) => (
            <Card key={p.title} title={p.title} preview>
              {p.lines.map((line, i) => (
                <div key={i} class="lre-row">
                  <span class="k">{line}</span>
                </div>
              ))}
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

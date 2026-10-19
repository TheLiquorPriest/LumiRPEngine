// Money → Credit and Household (DESIGN §25): the credit score with its band (its history, its
// parts and the report in the full books) and what applying for credit can ask for; a household's
// members, shares, shared accounts and shared costs. The player applies for credit (an in-world
// action) and handles the shared flows they may; the GM adds and removes household members.

import { useState } from "preact/hooks";
import { formatMoney } from "../../../shared/world";
import { Card, Empty, Row } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { FlowRow } from "./flows";
import { SelectField } from "./forms";
import type { SectionProps } from "./hub";
import { creditBlocks } from "./layout";
import { AmountAction } from "./lines";
import { applyCreditAction } from "./requests";

/** A 0–1 score part as a percentage. */
function pct(part: number): string {
  return `${Math.round(part * 100)}%`;
}

export function CreditSection(props: SectionProps) {
  const { view, controls } = props;
  // Asked first: a hook may not follow the early return.
  const [applying, setApplying] = useState<string | null>(null);
  const c = view.credit;
  if (!c) return <Empty>No credit report.</Empty>;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const blocks = creditBlocks(view);
  return (
    <>
      <Card title="Credit score" aside={c.asOf ? <span class="lre-badge">as of {c.asOf}</span> : null}>
        <Row k={c.score !== null ? String(c.score) : "No score yet"} sub={[c.band, c.tier ? `${humanize(c.tier)} rates` : null].filter((s) => s !== null).join(" · ") || undefined} />
        {blocks.history > 0
          ? c.history.slice(-blocks.history).map((h) => (
              <Row key={h.at} k={h.at} v={String(h.score)} />
            ))
          : null}
      </Card>
      {blocks.factors && c.factors ? (
        <Card title="What makes it">
          <Row k="Paying on time" v={pct(c.factors.payment)} />
          <Row k="Credit used" sub={`${c.utilisationPct}% of limits`} v={pct(c.factors.utilisation)} />
          <Row k="Age of accounts" sub={`${c.ageMonths} months on average`} v={pct(c.factors.age)} />
          <Row k="Mix of credit" v={pct(c.factors.mix)} />
          <Row k="New credit" v={pct(c.factors.recent)} />
        </Card>
      ) : null}
      {blocks.report ? (
        <Card title="Report">
          <Row k="On time" v={`${c.onTimePct}%`} />
          {c.accounts.map((a) => (
            <Row key={a.id} k={a.name} sub={[humanize(a.class), humanize(a.status), a.opened ? `opened ${a.opened}` : null, a.late30 + a.late60 + a.late90 > 0 ? `late ${a.late30}×30 ${a.late60}×60 ${a.late90}×90` : null].filter((s) => s !== null).join(" · ")} v={a.limit !== null ? `${fmt(a.owed)} of ${fmt(a.limit)}` : fmt(a.owed)} />
          ))}
          {c.inquiries.length > 0 ? <div class="lre-h">Inquiries</div> : null}
          {c.inquiries.map((i, n) => (
            <Row key={`${i.at}:${n}`} k={i.note} sub={i.at} />
          ))}
          {c.marks.length > 0 ? <div class="lre-h">Marks</div> : null}
          {c.marks.map((m, n) => (
            <Row key={`${m.at}:${n}`} k={humanize(m.kind)} sub={`${m.at} · ${m.note}`} tone="neg" />
          ))}
        </Card>
      ) : null}
      {c.offers.length > 0 ? (
        <Card title="Credit you could apply for">
          {c.offers.map((o) => (
            <Row key={o.product} k={o.label} sub={[humanize(o.class), o.aprPct !== null ? `${o.aprPct}% APR` : null, o.limit !== null ? `up to ${fmt(o.limit)}` : null].filter((s) => s !== null).join(" · ")} />
          ))}
          {controls.mode === "player" ? (
            <>
              <SelectField label="Apply for" value={applying ?? ""} empty="Choose" options={c.offers.map((o) => ({ value: o.product, label: o.label }))} onChange={(v) => setApplying(v === "" ? null : v)} />
              {applying !== null ? <AmountAction label="How much" go="Apply" optional="What they offer" currency={controls.currency} busy={controls.busy} submit={(cents) => controls.act(applyCreditAction(applying, cents))} onDone={() => setApplying(null)} /> : null}
            </>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}

export function HouseholdSection(props: SectionProps) {
  const { view, controls } = props;
  const h = view.household;
  const [adding, setAdding] = useState("");
  if (!h) return <Empty>No household.</Empty>;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const candidates = controls.mode === "gm" ? controls.gm.entities.filter((e) => e.kind === "person" && !e.gone && !h.members.some((m) => m.id === e.id)) : [];
  return (
    <>
      <Card title={`🏡 ${h.name}`} aside={<span class="lre-badge">{fmt(h.monthly.total)} a month shared</span>}>
        {h.members.map((m) => (
          <Row
            key={m.id}
            k={m.name}
            sub={[m.role ? humanize(m.role) : null, h.monthly.parts.find((p) => p.id === m.id) ? `${fmt(h.monthly.parts.find((p) => p.id === m.id)?.cents ?? 0)} a month` : null].filter((s) => s !== null).join(" · ") || undefined}
            v={
              <span class="lre-inline">
                {m.share > 0 ? `${Math.round(m.share * 10) / 10}%` : null}
                {controls.mode === "gm" ? (
                  <button type="button" class="lre-btn small danger" disabled={controls.busy} aria-label={`Take ${m.name} out of ${h.name}`} onClick={() => void controls.edit([{ op: "unlink", rel: "member_of", from: m.id, to: h.id }])}>
                    ✕
                  </button>
                ) : null}
              </span>
            }
          />
        ))}
        {controls.mode === "gm" ? (
          <div class="lre-inline">
            <SelectField label="Add a member" value={adding} empty="Choose someone" options={candidates.map((e) => ({ value: e.id, label: e.name }))} onChange={setAdding} />
            <button type="button" class="lre-btn small" disabled={controls.busy || adding === ""} onClick={() => void controls.edit([{ op: "link", rel: "member_of", from: adding, to: h.id }]).then((ok) => ok && setAdding(""))}>
              Add
            </button>
          </div>
        ) : null}
        {h.accounts.length > 0 ? <Row k="Shared accounts" v={h.accounts.map((id) => view.accounts.find((a) => a.id === id)?.name ?? id).join(", ")} /> : null}
      </Card>
      <Card title="Shared costs">
        {h.flows.length === 0 ? <Empty>No shared costs.</Empty> : h.flows.map((f) => <FlowRow key={f.id} view={view} flow={f} controls={controls} />)}
      </Card>
    </>
  );
}

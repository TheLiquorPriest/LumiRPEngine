// GM view → Money (DESIGN §7): everyone else's money at their own Money level, with Add and Take
// on each account shown. Each change is one GM edit with its own Corrected chip.

import { useState } from "preact/hooks";
import type { GmMoney } from "../../../shared/state-view";
import { formatMoney } from "../../../shared/world";
import { Card, Empty, Row } from "../../../frontend/components";
import type { GmSectionProps } from "../../../frontend/registry";
import { adjustOp } from "../../../frontend/requests";

function PersonMoney(props: { money: GmMoney; section: GmSectionProps }) {
  const { money: m, section } = props;
  const [amount, setAmount] = useState("");
  const valid = adjustOp(m.entity, amount, section.currency, false) !== null;
  return (
    <Card title={`Money · ${m.name}`} aside={<span class="lre-badge">Money {m.level}</span>}>
      {m.band ? <Row k="Band" v={m.band} /> : null}
      {m.netWorthCents !== null ? <Row k="Net worth" v={formatMoney(m.netWorthCents, section.currency)} /> : null}
      {!m.opened ? <div class="lre-small lre-muted">Not opened yet: these are the opening balances it will start from.</div> : null}
      {m.accounts.map((a) => (
        <Row
          key={a.id}
          k={a.name}
          sub={a.kind}
          v={
            <span class="lre-inline">
              {formatMoney(a.cents, section.currency)}
              <button type="button" class="lre-btn small" aria-label={`Add to ${a.name}`} disabled={section.busy || !valid} onClick={() => { const op = adjustOp(a.id, amount, section.currency, false); if (op) void section.edit([op]); }}>
                +
              </button>
              <button type="button" class="lre-btn small" aria-label={`Take from ${a.name}`} disabled={section.busy || !valid} onClick={() => { const op = adjustOp(a.id, amount, section.currency, true); if (op) void section.edit([op]); }}>
                −
              </button>
            </span>
          }
        />
      ))}
      {m.accounts.length > 0 ? <input class="lre-input" aria-label={`Amount for ${m.name}`} placeholder="Amount to add or take" value={amount} onInput={(event) => setAmount(event.currentTarget.value)} /> : null}
      {m.recent.map((r, i) => (
        <Row key={`r${i}`} k={r.memo} sub={`${r.at} · ${r.account}`} v={formatMoney(r.cents, section.currency)} />
      ))}
      {m.notes.map((n, i) => (
        <Row key={`n${i}`} k={n.text} sub={n.at} />
      ))}
    </Card>
  );
}

export function GmMoneySection(props: GmSectionProps) {
  if (props.gm.money.length === 0) return <Empty>No one else's money is tracked.</Empty>;
  return (
    <>
      {props.gm.money.map((m) => (
        <PersonMoney key={m.entity} money={m} section={props} />
      ))}
    </>
  );
}

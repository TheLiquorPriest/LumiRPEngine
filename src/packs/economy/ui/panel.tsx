// Play → Money (DESIGN §9.1 Money levels, §25): a wealth band at level 1; cash plus accounts from
// level 2; cards, flows and income from 3; APR, statements and loans at 4. The view model
// (`FinanceView`) is already at the POV's level; this only lays it out. Amounts sit left of the
// right gutter.

import { ACCOUNT_CLASSES, type AccountClass } from "../../../shared/finance";
import { isRecord } from "../../../shared/json";
import { Card, Empty, JsonView, Row } from "../../../frontend/components";
import { list, num, oneOf, optNum, str } from "../../../frontend/decode";
import { formatCents } from "../../../frontend/format";
import type { PanelProps } from "../../../frontend/registry";

const CLASS_ICON: Record<AccountClass, string> = {
  cash: "💵",
  checking: "🏦",
  business_checking: "🏦",
  savings: "🐖",
  money_market: "🐖",
  cd: "🔒",
  trust: "🏛",
  escrow: "🏛",
  credit_card: "💳",
  charge_card: "💳",
  line_of_credit: "💳",
  loan: "📄",
  mortgage: "🏠",
  brokerage: "📈",
  retirement: "📈",
};

/** What this panel lays out of a `FinanceView`. */
export interface MoneyPanelView {
  level: number;
  band: string | null;
  netWorthCents: number | null;
  cash: { band: string } | { cents: number } | null;
  accounts: { id: string; name: string; class: AccountClass; cents: number; limitCents?: number; aprPct?: number; due?: { label: string; cents: number } }[];
  recent: { at: string; memo: string; cents: number; account: string }[];
  upcoming: { at: string; label: string; cents: number }[];
}

export function decodeMoneyView(value: unknown): MoneyPanelView | null {
  if (!isRecord(value) || (!Array.isArray(value.accounts) && typeof value.band !== "string")) return null;
  const overview = isRecord(value.overview) ? value.overview : null;
  return {
    level: num(value.level, 1),
    band: typeof value.band === "string" ? value.band : null,
    netWorthCents: overview && typeof overview.netWorth === "number" ? overview.netWorth : null,
    cash: isRecord(value.cash) ? (typeof value.cash.cents === "number" ? { cents: value.cash.cents } : { band: str(value.cash.band) }) : null,
    accounts: list(value.accounts, (a) => {
      const due = isRecord(a.due) ? { label: str(a.due.label), cents: num(a.due.cents) } : undefined;
      const limitCents = optNum(a.limit);
      const aprPct = optNum(a.aprPct);
      return typeof a.id === "string" ? { id: a.id, name: str(a.name, a.id), class: oneOf(a.class, ACCOUNT_CLASSES, "checking"), cents: num(a.cents), ...(limitCents !== undefined ? { limitCents } : {}), ...(aprPct !== undefined ? { aprPct } : {}), ...(due ? { due } : {}) } : null;
    }),
    recent: list(value.recent, (t) => ({ at: str(t.at), memo: str(t.memo), cents: num(t.cents), account: str(t.account) })),
    upcoming: list(overview?.upcoming, (u) => ({ at: str(u.at), label: str(u.label), cents: num(u.cents) })),
  };
}

export function MoneyPanel(props: PanelProps) {
  const view = decodeMoneyView(props.view);
  if (props.view === null || props.view === undefined) return <Empty>Money is off in this world.</Empty>;
  if (!view) return <JsonView value={props.view} />;
  return (
    <div class="lre-stack" data-lre-panel="economy.money">
      <Card title="Overview" aside={<span class="lre-badge">Money {view.level}</span>}>
        {view.band ? <Row k="Wealth" v={view.band} /> : null}
        {view.netWorthCents !== null ? <Row k="Net worth" v={formatCents(view.netWorthCents)} tone={view.netWorthCents < 0 ? "neg" : undefined} /> : null}
      </Card>
      {view.accounts.length > 0 ? (
        <Card title="Accounts">
          {view.accounts.map((a) => {
            const subs = [
              a.limitCents !== undefined ? `limit ${formatCents(a.limitCents)}` : null,
              a.aprPct !== undefined ? `${a.aprPct}% APR` : null,
              a.due ? `${a.due.label} ${formatCents(a.due.cents)}` : null,
            ].filter((part) => part);
            return (
              <Row
                key={a.id}
                k={
                  <>
                    <span aria-hidden="true">{CLASS_ICON[a.class]}</span> {a.name}
                  </>
                }
                sub={subs.length > 0 ? subs.join(" · ") : undefined}
                v={formatCents(a.cents)}
                tone={a.cents < 0 ? "neg" : undefined}
              />
            );
          })}
        </Card>
      ) : null}
      {view.upcoming.length > 0 ? (
        <Card title="Coming up">
          {view.upcoming.map((u, i) => (
            <Row key={`${u.at}:${i}`} k={u.label} sub={u.at} v={formatCents(u.cents)} tone={u.cents < 0 ? "neg" : "pos"} />
          ))}
        </Card>
      ) : null}
      <Card title="Recent">
        {view.recent.length === 0 ? (
          <Empty>No transactions yet.</Empty>
        ) : (
          view.recent.map((t, i) => <Row key={`${t.at}:${i}`} k={t.memo} sub={`${t.at} · ${t.account}`} v={`${t.cents > 0 ? "+" : ""}${formatCents(t.cents)}`} tone={t.cents < 0 ? "neg" : "pos"} />)
        )}
      </Card>
    </div>
  );
}

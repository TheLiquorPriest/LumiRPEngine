// Now's money glance: what in the POV's money needs them, from the overview: its
// problems, then its warnings, then what's coming up within about three days of the world's clock.
// At most three rows, and nothing when there's nothing; a row opens the account or flow page it
// names, over Now.

import { DEFAULT_CURRENCY } from "../../../shared/world";
import { pushSheet, useApp } from "../../../frontend/app";
import { Badge, ListRow } from "../../../frontend/components";
import { GLANCE_ROWS, GlanceCard } from "../../../frontend/play/glance";
import type { PanelProps } from "../../../frontend/registry";
import { decodeFinanceView } from "./decode";
import { lineTarget, upcomingValue } from "./hub";
import { glanceLines } from "./layout";
import type { HubPage } from "./nav";
import { routeOf } from "./routes";

export function MoneyGlance(props: PanelProps) {
  const app = useApp();
  const view = decodeFinanceView(props.view);
  if (!view) return null;
  const lines = glanceLines(view, props.state.hud?.clock.minutes ?? null).slice(0, GLANCE_ROWS);
  if (lines.length === 0) return null;
  const currency = props.state.currency ?? DEFAULT_CURRENCY;
  const open = (page: HubPage) => app.ui.update((ui) => pushSheet(ui, routeOf(page)));
  return (
    <GlanceCard title="Money" panel="economy.money">
      {lines.map((line, i) => {
        if (line.kind === "alert") {
          const { alert } = line;
          const target = lineTarget(view, alert.flow, alert.account);
          return <ListRow key={`alert:${i}`} icon="alert" title={alert.text} badge={alert.tone === "neg" ? <Badge tone="neg">Problem</Badge> : <Badge tone="warn">Check</Badge>} chevron={target !== null} onClick={target ? () => open(target.page) : undefined} />;
        }
        const u = line.line;
        const target = lineTarget(view, u.flow, u.account);
        const amount = upcomingValue(view, u, currency);
        return <ListRow key={`soon:${i}`} icon="calendar" title={u.label} subtitle={u.at} value={amount.value} valueTone={amount.tone} chevron={target !== null} onClick={target ? () => open(target.page) : undefined} />;
      })}
    </GlanceCard>
  );
}

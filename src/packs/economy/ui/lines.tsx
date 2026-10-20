// Rows the money pages share: journal lines, and the GM's edit of an entity's declared fields (on a
// page of their own, each field one edit with its own Undo, as GM mode's entity page edits them).

import { useState } from "preact/hooks";
import type { JournalLine, OwnerLine } from "../../../shared/finance";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Badge, Button, Empty, List, ListRow, Section } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { FieldRow } from "../../../frontend/gm/entity";
import { ActionRows } from "../../../frontend/gm/ui";
import type { GmControls, HubControls } from "./hub";
import { MoneyPage, type HubNav } from "./nav";

/** Journal lines, newest first: at most `max`, with a Show all when there are more. `account` names each line's account. */
export function TxnRows(props: { lines: readonly JournalLine[]; max: number; currency: WorldCurrency; account?: boolean }) {
  const [all, setAll] = useState(false);
  if (props.lines.length === 0) return <Empty icon="receipt">No transactions yet.</Empty>;
  const shown = all ? props.lines : props.lines.slice(0, props.max);
  return (
    <div class="lre-money-lines">
      <List>
        {shown.map((t, i) => (
          <ListRow
            key={`${t.id}:${i}`}
            title={t.memo}
            subtitle={[t.at, props.account ? t.account : null, t.category ? humanize(t.category) : null, t.counterparty, t.card].filter((s) => s !== null && s !== "").join(" · ")}
            badge={t.status === "pending" ? <Badge>Pending</Badge> : undefined}
            value={`${t.cents > 0 ? "+" : ""}${formatMoney(t.cents, props.currency)}`}
            valueTone={t.cents < 0 ? "neg" : "pos"}
          />
        ))}
      </List>
      {props.lines.length > shown.length ? (
        <div class="lre-money-more">
          <Button variant="ghost" size="sm" block onClick={() => setAll(true)}>
            Show all {props.lines.length}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The GM's ✎ on an entity's declared fields, as GM mode's entity page edits them (typed by the
 * kind's definitions, each save one edit). `only` keeps the listed fields, in that order.
 */
export function EntityFields(props: { controls: GmControls; entity: string; only?: readonly string[] }) {
  const entity = props.controls.gm.entities.find((e) => e.id === props.entity);
  if (!entity) return <Empty icon="info">Not in the world.</Empty>;
  const fields = props.only ? props.only.flatMap((id) => entity.fields.filter((f) => f.id === id)) : entity.fields;
  if (fields.length === 0) return <Empty icon="info">It declares no fields.</Empty>;
  return (
    <ActionRows label={`${entity.name}: fields`}>
      {fields.map((f) => (
        <FieldRow key={f.id} entity={entity} field={f} editor={props.controls} />
      ))}
    </ActionRows>
  );
}

/** The GM's page of every field an entity declares, each with ✎. A player has none, and the router shows such a page as gone. */
export function FieldsPage(props: { nav: HubNav; controls: HubControls; name: string; title: string; entity: string; subtitle?: string }) {
  const { controls } = props;
  if (controls.mode !== "gm") return null;
  return (
    <MoneyPage nav={props.nav} name={props.name} title={props.title} subtitle={props.subtitle}>
      <Section>
        <EntityFields controls={controls} entity={props.entity} />
      </Section>
    </MoneyPage>
  );
}

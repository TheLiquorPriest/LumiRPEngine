// Rows the money pages share: journal lines, an account's or a business's owners grouped by role,
// Money's one filter bar, and the GM's edit of an entity's declared fields (on a page of their own,
// each field one edit with its own Undo, as GM mode's entity page edits them).

import { useState } from "preact/hooks";
import { isCorrection, OWNER_ROLE_LABELS, OWNER_ROLES, ROLE_RIGHTS, type JournalLine, type OwnerLine } from "../../../shared/finance";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Badge, Button, Empty, List, ListRow, Section, Seg } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import type { IconName } from "../../../frontend/icons";
import { FieldRow } from "../../../frontend/gm/entity";
import { ActionRows } from "../../../frontend/gm/ui";
import { SelectField, type Choice } from "./forms";
import type { GmControls, HubControls } from "./hub";
import type { ActivityFilter } from "./layout";
import { MoneyPage, type HubNav } from "./nav";

/**
 * Owners with their roles and shares, each role its own group in role order (Owners, Trustees,
 * Beneficiaries…) where there is more than one, each holder titled by their role ("Trustee"). A role
 * that carries no worth shows no share. An owner the player can't see comes without an id (null,
 * or "" from a module that masks it so), so rows are told apart by place where the id is missing.
 */
export function OwnerRows(props: { owners: readonly OwnerLine[]; icon?: IconName }) {
  const roles = OWNER_ROLES.filter((role) => props.owners.some((o) => o.role === role));
  const row = (o: OwnerLine, i: number) => <ListRow key={o.party || `someone:${i}`} icon={props.icon} title={o.name} subtitle={OWNER_ROLE_LABELS[o.role].one} value={ROLE_RIGHTS[o.role].worth && o.share > 0 ? `${Math.round(o.share * 10) / 10}%` : undefined} />;
  if (roles.length < 2) return <>{props.owners.map(row)}</>;
  return (
    <>
      {roles.map((role) => (
        <div key={role} class="lre-money-owner-group" data-lre-owner-role={role}>
          <div class="lre-money-owner-role">{OWNER_ROLE_LABELS[role].many}</div>
          {props.owners.map((o, i) => (o.role === role ? row(o, i) : null))}
        </div>
      ))}
    </>
  );
}

/** One journal line: its memo; when, its account (`account`), category, other side and card, and who made it for the organization whose account it is ("Paid by Jordan Ellis for Alder Automotive"); its amount; a correction (a balance put right) badged so. */
export function TxnRow(props: { line: JournalLine; currency: WorldCurrency; account?: boolean }) {
  const t = props.line;
  return (
    <ListRow
      title={t.memo}
      subtitle={[t.at, props.account ? t.account : null, t.category && !isCorrection(t) ? humanize(t.category) : null, t.counterparty, t.card, t.by ?? null].filter((s) => s !== null && s !== "").join(" · ")}
      badge={t.status === "pending" ? <Badge>Pending</Badge> : isCorrection(t) ? <Badge>Correction</Badge> : undefined}
      value={`${t.cents > 0 ? "+" : ""}${formatMoney(t.cents, props.currency)}`}
      valueTone={t.cents < 0 ? "neg" : "pos"}
    />
  );
}

const DIRECTIONS: readonly { value: ActivityFilter["direction"]; label: string }[] = [
  { value: "", label: "All" },
  { value: "in", label: "In" },
  { value: "out", label: "Out" },
];

/**
 * Money's one filter bar (ORG-SPEC §5.1), for Activity and In & out alike: money In or Out, whose
 * money it is, one account's and one category's, as the page offers them; a choice with nothing to
 * pick between is left out.
 */
export function MoneyFilters(props: { filter: ActivityFilter; onFilter(filter: ActivityFilter): void; whose?: readonly Choice[]; accounts?: readonly Choice[]; categories?: readonly Choice[] }) {
  const { filter, onFilter } = props;
  return (
    <div class="lre-money-filters" data-lre-money-filters>
      <Seg<ActivityFilter["direction"]> label="Direction" value={filter.direction} options={DIRECTIONS} onChange={(direction) => onFilter({ ...filter, direction })} />
      {props.whose && props.whose.length > 1 ? <SelectField label="Whose" value={filter.whose} empty="Everyone's" options={props.whose} onChange={(whose) => onFilter({ ...filter, whose })} /> : null}
      {props.accounts && props.accounts.length > 1 ? <SelectField label="Account" value={filter.account} empty="Every account" options={props.accounts} onChange={(account) => onFilter({ ...filter, account })} /> : null}
      {props.categories && props.categories.length > 0 ? <SelectField label="Category" value={filter.category} empty="Every category" options={props.categories.map((c) => ({ value: c.value, label: humanize(c.label) }))} onChange={(category) => onFilter({ ...filter, category })} /> : null}
    </div>
  );
}

/** Journal lines, newest first: at most `max`, with a Show all when there are more. `account` names each line's account. */
export function TxnRows(props: { lines: readonly JournalLine[]; max: number; currency: WorldCurrency; account?: boolean }) {
  const [all, setAll] = useState(false);
  if (props.lines.length === 0) return <Empty icon="receipt">No transactions yet.</Empty>;
  const shown = all ? props.lines : props.lines.slice(0, props.max);
  return (
    <div class="lre-money-lines">
      <List>
        {shown.map((t, i) => (
          <TxnRow key={`${t.id}:${i}`} line={t} currency={props.currency} account={props.account} />
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

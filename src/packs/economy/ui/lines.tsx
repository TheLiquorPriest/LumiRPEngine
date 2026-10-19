// Rows the money sections share: journal lines, a GM edit of an entity's declared fields, and the
// amount a player types for an action.

import { useState } from "preact/hooks";
import type { JournalLine } from "../../../shared/finance";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Empty, Row } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { FieldRow } from "../../../frontend/gm/entity";
import type { GmControls } from "./hub";
import { AmountField } from "./forms";
import { amountOf } from "./requests";

/** Journal lines, newest first: at most `max`, with a Show all when there are more. */
export function TxnRows(props: { lines: readonly JournalLine[]; max: number; currency: WorldCurrency; account?: boolean }) {
  const [all, setAll] = useState(false);
  if (props.lines.length === 0) return <Empty>No transactions yet.</Empty>;
  const shown = all ? props.lines : props.lines.slice(0, props.max);
  return (
    <>
      {shown.map((t, i) => (
        <Row
          key={`${t.id}:${i}`}
          k={t.memo}
          sub={[t.at, props.account ? t.account : null, t.category ? humanize(t.category) : null, t.counterparty, t.card, t.status === "pending" ? "pending" : null].filter((s) => s !== null && s !== "").join(" · ")}
          v={`${t.cents > 0 ? "+" : ""}${formatMoney(t.cents, props.currency)}`}
          tone={t.cents < 0 ? "neg" : "pos"}
        />
      ))}
      {props.lines.length > shown.length ? (
        <button type="button" class="lre-btn small ghost" onClick={() => setAll(true)}>
          Show all {props.lines.length}
        </button>
      ) : null}
    </>
  );
}

/**
 * The GM's ✎ on an entity's declared fields, as the GM view's entity form edits them (typed by the
 * kind's definitions, each save one edit). `only` keeps the listed fields, in that order.
 */
export function EntityFields(props: { controls: GmControls; entity: string; only?: readonly string[] }) {
  const entity = props.controls.gm.entities.find((e) => e.id === props.entity);
  if (!entity) return <Empty>Not in the world.</Empty>;
  const fields = props.only ? props.only.flatMap((id) => entity.fields.filter((f) => f.id === id)) : entity.fields;
  return (
    <>
      {fields.map((f) => (
        <FieldRow key={f.id} entity={entity} field={f} editor={props.controls} />
      ))}
    </>
  );
}

/**
 * An amount typed for a control and the button that sends it. Empty is allowed only with
 * `optional`, the words for what an empty amount means ("the whole balance").
 */
export function AmountAction(props: { label: string; go: string; currency: WorldCurrency; busy: boolean; optional?: string; submit(cents: number | null): Promise<boolean>; onDone(): void }) {
  const [text, setText] = useState("");
  const empty = text.trim() === "";
  const cents = empty ? null : amountOf(text, props.currency);
  const ok = empty ? props.optional !== undefined : cents !== null;
  return (
    <form
      class="lre-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (ok) void props.submit(cents).then((sent) => sent && props.onDone());
      }}
    >
      <AmountField label={props.label} value={text} currency={props.currency} onInput={setText} invalid={!empty && cents === null} placeholder={props.optional} />
      <button type="submit" class="lre-btn primary" disabled={props.busy || !ok}>
        {props.go}
      </button>
    </form>
  );
}

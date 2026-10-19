// GM view → Money (DESIGN §7, §25): anyone's money, a person's, a business's, a trust's or a
// household's, as the same hub the player sees, at that party's own level, with the GM's controls:
// money in and out, statuses, autopay, card states, flows, jobs, prices and every declared field,
// each one edit with its own Corrected chip.

import { useState } from "preact/hooks";
import { Empty, JsonView } from "../../../frontend/components";
import type { GmSectionProps } from "../../../frontend/registry";
import { decodeFinanceView } from "./decode";
import { MoneyHub } from "./hub";

export function GmMoneySection(props: GmSectionProps) {
  const parties = props.gm.money.map((raw) => ({ raw, view: decodeFinanceView(raw) }));
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  if (parties.length === 0) return <Empty>No one's money is tracked.</Empty>;
  const q = query.trim().toLowerCase();
  const shown = parties.filter((p) => q === "" || (p.view?.name ?? "").toLowerCase().includes(q) || (p.view?.party ?? "").toLowerCase().includes(q));
  const current = parties.find((p) => p.view !== null && p.view.party === picked) ?? shown.find((p) => p.view !== null) ?? null;
  return (
    <div class="lre-stack" data-lre-gm-money>
      {parties.length > 8 ? <input class="lre-input" placeholder="Search" aria-label="Search parties" value={query} onInput={(event) => setQuery(event.currentTarget.value)} /> : null}
      <label class="lre-field">
        <span class="label">Whose money</span>
        <select class="lre-input" value={current?.view?.party ?? ""} onChange={(event) => setPicked(event.currentTarget.value)}>
          {shown.flatMap((p) =>
            p.view
              ? [
                  <option key={p.view.party} value={p.view.party}>
                    {`${p.view.name} · ${p.view.partyKind} · Money ${p.view.level}`}
                  </option>,
                ]
              : [],
          )}
        </select>
      </label>
      {current?.view ? (
        <MoneyHub key={current.view.party} view={current.view} label={`${current.view.name}'s money`} controls={{ mode: "gm", busy: props.busy, currency: props.currency, edit: props.edit, gm: props.gm }} />
      ) : (
        <Empty>Nothing to show for that party.</Empty>
      )}
      {parties.some((p) => p.view === null) ? (
        <details>
          <summary class="lre-small lre-muted">Money this build can't draw ({parties.filter((p) => p.view === null).length})</summary>
          {parties
            .filter((p) => p.view === null)
            .map((p, i) => (
              <JsonView key={i} value={p.raw} />
            ))}
        </details>
      ) : null}
    </div>
  );
}

// The settings set for one connection or one agent at a time, as a table (plan §14, §5.4 "Config"): a row for each connection or
// agent definition, a column for each setting, each cell its value, marked where he changed it. A press on a cell opens that one
// setting under the table, with its control, its advice and its way back. The first column stays put while the rest scroll sideways,
// so it reads on a phone as on a desktop.

import { useState } from "preact/hooks";
import { Button, Disclosure } from "../../../frontend/components";
import type { LoreBooks, SettingView } from "../../../shared/api";
import { type ChangeLevel, isChanged, tableOf, valueWords } from "./model";
import { type RowActions, SettingRow } from "./row";

export interface SettingsTableProps extends RowActions {
  settings: readonly SettingView[];
  kind: "connection" | "definition";
  level: ChangeLevel;
  busy: string | null;
  refusal: { key: string; words: string } | null;
  choices(s: SettingView): readonly string[] | null;
  books: LoreBooks | null;
  /** The setting the address names: its cell starts open. */
  openKey: string | null;
}

export function SettingsTable(props: SettingsTableProps) {
  const { columns, rows } = tableOf(props.settings);
  const [open, setOpen] = useState<string | null>(props.settings.some((s) => s.key === props.openKey) ? props.openKey : null);
  const opened = open === null ? undefined : props.settings.find((s) => s.key === open);
  const rowWord = props.kind === "connection" ? "Connection" : "Agent";
  return (
    <div class="lre-stack" data-table={props.kind}>
      <div class="rpe-set-tablewrap">
        <table class="rpe-set-table">
          <thead>
            <tr>
              <th scope="col">{rowWord}</th>
              {columns.map((c) => (
                <th key={c.pattern} scope="col" title={c.about}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} data-row={row.key}>
                <th scope="row">
                  {row.name}
                  {row.known ? null : <span class="rpe-meta"> (none in force by that name)</span>}
                </th>
                {columns.map((c) => {
                  const s = row.cells.get(c.pattern);
                  if (s === undefined) return <td key={c.pattern} />;
                  const changed = isChanged(s);
                  return (
                    <td key={c.pattern}>
                      <button type="button" class="rpe-set-cell" aria-pressed={open === s.key} aria-label={`${row.name}, ${c.name}: ${valueWords(s, s.value, s.from !== null)}`} data-changed={changed ? "" : undefined} onClick={() => setOpen(open === s.key ? null : s.key)}>
                        {changed ? <span class="lre-dot" aria-hidden="true" /> : null}
                        <span>{valueWords(s, s.value, s.from !== null)}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {opened === undefined ? (
        <p class="rpe-meta">Press a cell to change it. A marked cell differs from what was shipped.</p>
      ) : (
        <div class="lre-stack rpe-set-cellopen">
          <ul class="rpe-plain">
            <SettingRow
              setting={opened}
              title={`${opened.setFor?.name ?? ""} · ${opened.name}`}
              level={props.level}
              busy={props.busy}
              refusal={props.refusal !== null && props.refusal.key === opened.key ? props.refusal.words : null}
              choices={props.choices(opened)}
              books={props.books}
              onWrite={props.onWrite}
              onTakeAway={props.onTakeAway}
            />
          </ul>
          <span>
            <Button size="sm" variant="ghost" icon="close" onClick={() => setOpen(null)}>
              Close
            </Button>
          </span>
        </div>
      )}
      <Disclosure summary="What each column is">
        <ul class="rpe-plain lre-stack">
          {columns.map((c) => (
            <li key={c.pattern} class="rpe-line">
              <strong>{c.name}</strong>: {c.about}
            </li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}

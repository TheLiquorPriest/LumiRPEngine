// One setting on the page (plan §14, §2.1 point 5): its name and what it does; the control that fits it, written at the level the
// page writes (every chat or this chat) or, where it is read from one level alone, at that one, which the row says; the advice its
// value passes; a mark when it differs from what was shipped, and where it is set; what was shipped and the way back to it; and,
// for one every level of which applies, each level's own part.

import { useState } from "preact/hooks";
import { Badge, Banner, Button } from "../../../frontend/components";
import type { LayerLevel, LoreBooks, SettingView } from "../../../shared/api";
import type { JsonValue } from "../../../shared/json";
import { Icon } from "../../icons";
import { SettingControl } from "./controls";
import { adviceFor, type ChangeLevel, isChanged, levelFor, SET_AT_WORDS, shippedValue, startingValue, valueWords, wayBack } from "./model";

export interface RowActions {
  /** Writes `key` at `level`: a value, or `~` with `none`. */
  onWrite(key: string, level: LayerLevel, value: JsonValue, none: boolean): void;
  /** Takes the key away at `level`, so what a farther level sets, or the default, holds. */
  onTakeAway(key: string, level: LayerLevel): void;
}

export interface SettingRowProps extends RowActions {
  setting: SettingView;
  /** Where the page writes a change. */
  level: ChangeLevel;
  /** The key a write is out for; null when none is. */
  busy: string | null;
  /** RPE's refusal of the last write of this setting, in its words. */
  refusal: string | null;
  /** The choices for a setting that names a connection or a definition. */
  choices: readonly string[] | null;
  books: LoreBooks | null;
  /** What the row is called in place of the setting's name (a cell of a table names its row and column). */
  title?: string;
  /** The address names it: it is marked. */
  opened?: boolean;
  /** What holds where nothing of his sets it, said in place of the default where the page knows it better: a definition's own effort or limit. */
  shipped?: string;
}

export function SettingRow(props: SettingRowProps) {
  const { setting: s } = props;
  const [draft, setDraft] = useState<JsonValue | undefined>(undefined);
  const busy = props.busy === s.key;
  const level = levelFor(s, props.level);
  const start = startingValue(s, level);
  const back = wayBack(s, level);
  const changed = isChanged(s);
  const advice = adviceFor(s.advice, draft === undefined ? s.value : draft);
  const onlyHere = props.level === "chat" && level !== "chat";
  return (
    <li class={props.opened === true ? "rpe-set-row rpe-opened" : "rpe-set-row"} data-setting={s.key} data-changed={changed ? "" : undefined}>
      <div class="rpe-set-head">
        <span class="rpe-set-name">{props.title ?? s.name}</span>
        {changed ? <Badge tone="accent">Changed</Badge> : null}
        {s.from !== null && s.from !== "shipped" ? <Badge>{`Set ${SET_AT_WORDS[s.from]}`}</Badge> : null}
      </div>
      <p class="rpe-set-about">{s.about}</p>
      {/* A cell of a table keeps its control's state per setting: a change of cell starts afresh. */}
      <div class="rpe-set-control" key={`${s.key}:${level}:${JSON.stringify(start)}`}>
        <SettingControl setting={s} start={start} busy={busy} onWrite={(value) => props.onWrite(s.key, level, value, false)} onNone={() => props.onWrite(s.key, level, null, true)} onDraft={setDraft} choices={props.choices} books={props.books} />
      </div>
      {advice.map((line) => (
        <p key={line} class="rpe-set-advice" role="note">
          <Icon name="alert" size={14} /> {line}
        </p>
      ))}
      {s.joined ? (
        <ul class="rpe-plain rpe-set-levels">
          {s.set.map((at) => (
            <li key={at.level} data-level={at.level}>
              <span class="rpe-meta">{`Set ${SET_AT_WORDS[at.level]}:`}</span> {valueWords(s, at.value)}
            </li>
          ))}
        </ul>
      ) : null}
      {s.passed === null ? null : (
        <p class="rpe-set-advice" role="note">
          <Icon name="alert" size={14} /> A file sets {JSON.stringify(s.passed.value)}, which is not taken, so {s.joined ? "it is passed over" : "the default holds"}: {s.passed.why}
        </p>
      )}
      <div class="rpe-set-foot">
        <span class="rpe-meta">{props.shipped ?? `${s.joined ? "Shipped" : "Default"}: ${valueWords(s, shippedValue(s), false)}`}</span>
        {back === null ? null : (
          <Button size="sm" variant="ghost" icon="undo" busy={busy} onClick={() => props.onTakeAway(s.key, back.level)}>
            {s.joined ? `Clear what is set ${SET_AT_WORDS[back.level]}` : back.to === "farther" ? "Use every chat's value" : s.setFor?.kind === "definition" ? "Back to its definition's" : "Back to the default"}
          </Button>
        )}
        <span class="rpe-meta rpe-set-meta">
          {onlyHere ? "Set for every chat only · " : ""}
          {s.effectWords.charAt(0).toUpperCase() + s.effectWords.slice(1)} · <code>{s.key}</code>
        </span>
      </div>
      {props.refusal === null ? null : (
        <Banner tone="neg" icon="alert" title="RPE did not make that change">
          <span>{props.refusal}</span>
        </Banner>
      )}
    </li>
  );
}

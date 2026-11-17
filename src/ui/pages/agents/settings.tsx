// An agent's effort and limits, and its sampling, as settings (plan §2.1 point 5, §14 Agents): each setting set per agent, for the
// definition open, with the control that fits it, written for every chat or for this chat alone; what its definition's header says
// beside it, which holds where no level sets one; and the way back to it. A value set at any level stands over the header. The same
// settings are side by side for every agent on the Settings page, a row for each.

import type { ListedDefinition } from "rp-harness/contract";
import { useState } from "preact/hooks";
import { Banner, Section, Seg } from "../../../frontend/components";
import type { SettingView } from "../../../shared/api";
import type { SettingsShown } from "../settings";
import { type ChangeLevel, numberWords } from "../settings/model";
import { type RowActions, SettingRow } from "../settings/row";

/** A definition as the list gives it, with the limits its header sets (RPH's `DefinitionView.limits` from its next head: pin). */
type WithHeader = ListedDefinition & { readonly limits?: Readonly<Record<string, number>> };

/** What the definition's header says of a setting set per agent, where it says anything: its effort, or one of its limits. */
function headerWords(agent: WithHeader, s: SettingView): string | undefined {
  const parts = s.pattern.split(".");
  const [first, second] = parts.slice(parts.indexOf("<definition>") + 1);
  if (first === "effort" && second === undefined) return `Its definition: ${agent.effort ?? "none, so its connection's own"}`;
  if (first !== "limits" || second === undefined) return undefined;
  const set = agent.limits?.[second];
  return `Its definition: ${set === undefined ? "no limit" : numberWords(set, s.unit)}`;
}

export interface AgentSettingsProps extends RowActions {
  chat: string | null;
  agent: ListedDefinition;
  shown: SettingsShown;
}

export function AgentSettings(props: AgentSettingsProps) {
  const { agent, shown } = props;
  const [level, setLevel] = useState<ChangeLevel>(props.chat === null ? "global" : "chat");
  const mine = (shown.reply?.settings ?? []).filter((s) => s.setFor?.kind === "definition" && s.setFor.key === agent.name);
  const groups = [...new Set(mine.map((s) => s.group))];
  return (
    <Section id="settings" title="Effort and limits">
      {props.chat === null ? (
        <p class="rpe-meta">A change here is for every chat; open a chat to make one for it alone.</p>
      ) : (
        <div class="rpe-set-levelbar">
          <span class="rpe-meta">A change here is</span>
          <Seg
            value={level}
            options={[
              { value: "global", label: "For every chat" },
              { value: "chat", label: "For this chat only" },
            ]}
            label="Where a change goes"
            onChange={(to: ChangeLevel) => setLevel(to)}
          />
        </div>
      )}
      {shown.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Its settings could not be read">
          <span>{shown.problem}</span>
        </Banner>
      )}
      {shown.reply === null && shown.loading ? <p class="lre-muted rpe-line">Reading its settings…</p> : null}
      {shown.reply !== null && mine.length === 0 ? <p class="lre-muted rpe-line">No setting is set per agent.</p> : null}
      {groups.map((group) => (
        <div key={group} class="rpe-set-group" data-group={group}>
          <h4 class="rpe-set-grouptitle">{group.replace(/, for each agent$/, "")}</h4>
          <ul class="rpe-plain rpe-set-rows">
            {mine
              .filter((s) => s.group === group)
              .map((s) => (
                <SettingRow
                  key={s.key}
                  setting={s}
                  level={level}
                  busy={shown.busy}
                  refusal={shown.refusal !== null && shown.refusal.key === s.key ? shown.refusal.words : null}
                  choices={null}
                  books={null}
                  shipped={headerWords(agent, s)}
                  onWrite={props.onWrite}
                  onTakeAway={props.onTakeAway}
                />
              ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

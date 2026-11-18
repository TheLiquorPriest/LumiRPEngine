// The press on the World page that puts a tabletop rule set on this chat's world (RULESET-DESIGN §5.2): the rule set becomes the world's next
// revision, which this chat alone moves to from its next turn, with the chat's rules switched on and who has no sheet yet said in words. What
// the world has of its own is kept. The Undo it gives is the Upgrade's, which takes the revision and the level back together.

import { useState } from "preact/hooks";
import type { RulesAnswer } from "../../../shared/api";
import { PROFILE_IDS, PROFILES } from "../../../shared/profiles/index";
import { Banner, Button } from "../../../frontend/components";
import { useApp } from "../../app";
import { errorWords } from "../../words";
import { sendRules, sendUpgradeUndo } from "./read";

/** The rule sets the press offers: every ready-made one but the bare. */
const SETS = PROFILE_IDS.filter((id) => id !== "custom");

/** What this chat's world could be given: pick a rule set, see what it would add, put it on, take it back. */
export function RulesPress(props: { chat: string; disabled: boolean; onDone(): void }) {
  const app = useApp();
  const { chat } = props;
  const [rules, setRules] = useState<string>(SETS[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<RulesAnswer | null>(null);
  const [undone, setUndone] = useState<string | null>(null);
  const press = (preview: boolean): void => {
    setBusy(true);
    setProblem(null);
    setUndone(null);
    sendRules(app.client, chat, { rules, preview }).then(
      (answer) => {
        setBusy(false);
        setSaid(answer);
        if (answer.made) props.onDone();
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  const undo = (): void => {
    if (said?.undo == null) return;
    setBusy(true);
    sendUpgradeUndo(app.client, chat, said.undo).then(
      (answer) => {
        setBusy(false);
        setUndone(answer.undone ? "Taken back: this chat goes to the revision it came from at its next turn, with the rules as they were." : answer.words);
        setSaid(null);
        props.onDone();
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  return (
    <div class="lre-stack" data-own="rules">
      <h4 class="rpe-caption">Tabletop rules</h4>
      <p class="rpe-meta">
        Put a ready-made rule set (abilities, skills, classes, weapons and the numbers a check and an attack are worked out with) on this chat's world. It becomes the world's next revision, and this chat moves to it from its next turn; your other chats of this world stay on the revision they play. What the world already has of its own is kept. The rules are switched on for this chat, and you are told who has no sheet yet.
      </p>
      <label class="lre-form-level">
        <span>Rule set</span>
        <select class="lre-input" value={rules} disabled={props.disabled || busy} onChange={(event) => setRules(event.currentTarget.value)}>
          {SETS.map((id) => (
            <option key={id} value={id}>
              {`${PROFILES[id].label}: ${PROFILES[id].summary}`}
            </option>
          ))}
        </select>
      </label>
      <div class="lre-inline">
        <Button size="sm" variant="ghost" busy={busy} disabled={props.disabled} onClick={() => press(true)}>
          See what it adds
        </Button>
        <Button size="sm" busy={busy} disabled={props.disabled} onClick={() => press(false)}>
          Put these rules on
        </Button>
      </div>
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="This could not be done">
          <span>{problem}</span>
        </Banner>
      )}
      {undone === null ? null : (
        <Banner tone="info" icon="check" title="Taken back">
          <span>{undone}</span>
        </Banner>
      )}
      {said === null ? null : (
        <Banner tone={said.made ? "info" : "warn"} icon={said.made ? "check" : "alert"} title={said.made ? "Done" : "Nothing was changed"} actions={said.undo === null ? undefined : <Button busy={busy} size="sm" variant="ghost" onClick={undo}>Undo</Button>}>
          {said.words.map((line, i) => (
            <p key={i} class="rpe-meta">
              {line}
            </p>
          ))}
        </Banner>
      )}
    </div>
  );
}

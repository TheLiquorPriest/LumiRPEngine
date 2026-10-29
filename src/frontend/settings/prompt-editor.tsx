// A step's own prompt and the placeholders it may use (DESIGN §5.2): the prompt editor Settings → Minds,
// Settings → Steps and connections and Settings → Agents → Prompts share, and the vars panel shown
// beside every template editor (those, and Build's step templates), read from the one table of what
// each step is given (`STEP_VARS`), or for a text of the prompts registry from its own placeholders
// (`PromptDef.vars`, DESIGN §6.12). Styles: styles/minds.ts.

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import { hasOwn } from "../../shared/json";
import { STEP_VARS, VAR_TEXT } from "../../shared/steps";
import type { PromptVar } from "../../shared/prompts";
import { placeholder } from "../../shared/prompts";
import type { StepPurpose, StepTemplateDef } from "../../shared/world";
import { Badge, Button, Disclosure } from "../components";
import { Icon } from "../icons";

/** Which step's placeholders: a purpose, or the skip plan. */
export type VarsKey = StepPurpose | "skip_plan";

/** A placeholder as a vars panel lists it, and what it holds. */
interface Placeholder {
  name: string;
  holds: string;
}

/** Whether a value names a step the vars panel knows (a Build step template's purpose as typed). */
export function isVarsKey(v: unknown): v is VarsKey {
  return typeof v === "string" && hasOwn(STEP_VARS, v);
}

function PlaceholderList(props: { vars: readonly Placeholder[] }) {
  return (
    <dl class="lre-minds-vars-list">
      {props.vars.map((v) => (
        <div key={v.name} class="lre-minds-var" data-lre-var={v.name}>
          <dt>
            <code>{placeholder(v.name)}</code>
          </dt>
          <dd>{v.holds}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The placeholders a step's prompt is filled with, when it runs, and what each holds. A world's `effects` template gets the reply-reading steps' set. */
export function VarsPanel(props: { step: VarsKey; output?: StepTemplateDef["output"] }) {
  const row = props.output === "effects" ? { ...STEP_VARS.extract, note: undefined } : STEP_VARS[props.step];
  return (
    <div class="lre-minds-vars" data-lre-vars={props.step}>
      <Disclosure summary={`Placeholders (${row.phase})`}>
        {row.vars.length === 0 ? <p class="lre-minds-note">No placeholders: the prompt is sent as you write it.</p> : null}
        {row.vars.length > 0 ? <PlaceholderList vars={row.vars.map((name) => ({ name, holds: VAR_TEXT[name] ?? "" }))} /> : null}
        {row.note ? <p class="lre-minds-note">{row.note}</p> : null}
        {row.vars.length > 0 ? <p class="lre-minds-note">Each holds only what your character may know: a line that would give away a secret is left out.</p> : null}
      </Disclosure>
    </div>
  );
}

/** The placeholders a text of the prompts registry may use, what each holds, and which it must keep (DESIGN §6.12). */
export function PromptVarsPanel(props: { vars: readonly PromptVar[] }) {
  return (
    <div class="lre-minds-vars" data-lre-vars="prompt">
      <Disclosure summary="Placeholders">
        {props.vars.length === 0 ? <p class="lre-minds-note">No placeholders: the text is sent as you write it.</p> : null}
        {props.vars.length > 0 ? <PlaceholderList vars={props.vars.map((v) => ({ name: v.name, holds: v.required ? `${v.text}; it must stay in the text` : v.text }))} /> : null}
      </Disclosure>
    </div>
  );
}

/**
 * One prompt of the user's own for a step: the text saved, else the built-in to start from, with
 * Save, Revert and Reset. Every step's editor reads alike: a line on what the prompt does, then, folded
 * and read-only, the built-in it replaces (`builtIn`) or, for a step whose prompt goes before
 * instructions it keeps, what those hold (`adds`), since they're made fresh each turn. `vars` is a
 * step's (its vars panel) or a registry text's own placeholders; `problems` says what is wrong with
 * the text as written (a placeholder it doesn't have, one it must keep), each shown under it. `save`
 * turns the text (null to reset) into the settings patch, or null when it can't be saved. `test`,
 * where the text can be tested (a role's, on Settings → Agents → Prompts), is its Test control for
 * the text as written.
 */
export function PromptEditor(props: { id: string; label: string; note: string; builtIn?: string; adds?: string; value: string | undefined; max: number; vars: VarsKey | readonly PromptVar[]; problems?(text: string): readonly string[]; busy: boolean; save(text: string | null): JsonObject | null; patch(patch: JsonObject): void; test?(text: string): ComponentChildren; children?: ComponentChildren }) {
  const saved = props.value ?? props.builtIn ?? "";
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const save = props.save(text);
  const problems = props.problems ? props.problems(text) : [];
  return (
    <div class="lre-minds-prompt" data-lre-minds-prompt={props.id}>
      <Disclosure
        summary={
          <span class="lre-minds-prompt-head">
            <span class="lre-minds-prompt-text">
              <span class="lre-minds-prompt-title">{props.label}</span>
              <span class="lre-minds-prompt-sub">{props.note}</span>
            </span>
            {props.value !== undefined ? <Badge tone="accent">Your own</Badge> : props.builtIn !== undefined ? <Badge>Built-in</Badge> : <Badge>None added</Badge>}
          </span>
        }
      >
        <textarea class="lre-input lre-minds-prompt-input" rows={10} aria-label={`${props.label} prompt`} placeholder={props.builtIn === undefined ? "Nothing added: the built-in instructions run alone." : undefined} value={text} disabled={props.busy} onInput={(event) => setText(event.currentTarget.value)} />
        {text.length > props.max ? (
          <div class="lre-set-warn" role="note">
            <Icon name="alert" size={16} />
            <span>Too long: at most {props.max.toLocaleString()} characters.</span>
          </div>
        ) : null}
        {problems.map((p) => (
          <div key={p} class="lre-set-warn" role="note" data-lre-prompt-problem>
            <Icon name="alert" size={16} />
            <span>{p.charAt(0).toUpperCase() + p.slice(1)}.</span>
          </div>
        ))}
        <div class="lre-minds-actions">
          <Button size="sm" variant="primary" disabled={props.busy || save === null || text === saved} onClick={() => save && props.patch(save)}>
            Save
          </Button>
          <Button size="sm" variant="ghost" disabled={props.busy || text === saved} onClick={() => setText(saved)}>
            Revert
          </Button>
          <Button size="sm" icon="undo" disabled={props.busy || props.value === undefined} onClick={() => props.patch(props.save(null) ?? {})}>
            Reset to the default
          </Button>
        </div>
        {props.test ? props.test(text) : null}
        {typeof props.vars === "string" ? <VarsPanel step={props.vars} /> : <PromptVarsPanel vars={props.vars} />}
        {props.builtIn !== undefined ? (
          <div class="lre-minds-default" data-lre-built-in="replaced">
            <Disclosure summary="The built-in prompt (read-only)">
              <p class="lre-minds-note">Your prompt starts from this and replaces it; Reset to the default goes back to it.</p>
              <pre class="lre-minds-code">{props.builtIn}</pre>
            </Disclosure>
          </div>
        ) : props.adds !== undefined ? (
          <div class="lre-minds-default" data-lre-built-in="added">
            <Disclosure summary="The built-in instructions (read-only)">
              <p class="lre-minds-note">Your prompt goes before these, which it can't change. They're made fresh each turn from the scene, so here is what they hold:</p>
              <pre class="lre-minds-code">{props.adds}</pre>
            </Disclosure>
          </div>
        ) : null}
        {props.children}
      </Disclosure>
    </div>
  );
}

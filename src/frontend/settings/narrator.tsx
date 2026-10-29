// Settings → Narrator (DESIGN §6.11): the user's default for the narrator's knowledge (whose
// knowledge it gets, and what of a secret), which a world's default and a chat's own choice come
// before, and the wording of a secret's mark, part by part, each beside its shipped text with Reset.
// The view's control is the one Build → World and GM → This chat → Knowledge use (`NarratorViewControl`).

import type { JsonObject } from "../../shared/json";
import { MIND_PROMPT_MAX } from "../../shared/minds";
import { SECRET_MARK_WORDING, type SecretMarkWording } from "../../shared/secret-marks";
import type { NarratorKnowledge, NarratorSecrets, NarratorSettings, NarratorView } from "../../shared/settings";
import { NARRATOR_KNOWLEDGE, NARRATOR_KNOWLEDGE_LABEL, NARRATOR_SECRETS, NARRATOR_SECRETS_LABEL, SECRET_MARK_NEEDS, secretMarkProblem } from "../../shared/settings";
import { Section, Seg } from "../components";
import { PromptEditor } from "./prompt-editor";

type MarkPart = keyof SecretMarkWording;

/** The parts of a secret's mark, in the order Settings lists them. */
const MARK_PARTS = Object.keys(SECRET_MARK_NEEDS) as MarkPart[];

const KNOWLEDGE_CHOICES = NARRATOR_KNOWLEDGE.map((value) => ({ value, label: NARRATOR_KNOWLEDGE_LABEL[value] }));
const SECRETS_CHOICES = NARRATOR_SECRETS.map((value) => ({ value, label: NARRATOR_SECRETS_LABEL[value] }));

const KNOWLEDGE_HELP: Record<NarratorKnowledge, string> = {
  scene: "What every person in the scene knows, with what your character doesn't know marked for the narrator.",
  pov: "Only what your character knows.",
};

const SECRETS_HELP: Record<NarratorSecrets, string> = {
  marked: "A line carrying a secret's words goes in marked as a secret, with whom it is known to or kept from.",
  omit: "A line carrying a secret's words is left out.",
};

/** A view in a few words, for a summary row: "Everyone in the scene · secrets marked". */
export function narratorViewSummary(view: NarratorView): string {
  return `${NARRATOR_KNOWLEDGE_LABEL[view.knowledge]} · secrets ${NARRATOR_SECRETS_LABEL[view.secrets].toLowerCase()}`;
}

/**
 * The narrator's knowledge (DESIGN §6.11): whose knowledge it gets and what of a secret. The one
 * control for a view in all three places it is set (Settings → Narrator, Build → World, GM → This
 * chat → Knowledge), so each reads the same.
 */
export function NarratorViewControl(props: { value: NarratorView; disabled?: boolean; onChange(next: NarratorView): void }) {
  const { knowledge, secrets } = props.value;
  return (
    <div class="lre-stack" data-lre-narrator-view>
      <div class="lre-field">
        <span class="label">Whose knowledge the narrator gets</span>
        <Seg<NarratorKnowledge> label="Whose knowledge the narrator gets" value={knowledge} options={KNOWLEDGE_CHOICES} disabled={props.disabled} onChange={(next) => props.onChange({ knowledge: next, secrets })} />
        <span class="lre-field-help">{KNOWLEDGE_HELP[knowledge]}</span>
      </div>
      <div class="lre-field">
        <span class="label">Secrets</span>
        <Seg<NarratorSecrets> label="Secrets" value={secrets} options={SECRETS_CHOICES} disabled={props.disabled} onChange={(next) => props.onChange({ knowledge, secrets: next })} />
        <span class="lre-field-help">{SECRETS_HELP[secrets]}</span>
      </div>
    </div>
  );
}

/**
 * The settings patch that keeps one part of a secret's mark (`lre.settings.set`), or null when it
 * can't be kept (`secretMarkProblem`). Blank, the shipped text, or null (Reset) deletes the user's
 * own, so the shipped text stands and follows it when it changes, as `mindsPromptPatch` does.
 */
export function secretMarkPatch(part: MarkPart, text: string | null): JsonObject | null {
  if (text === null || text.trim() === "" || text.trim() === SECRET_MARK_WORDING[part].trim()) return { narrator: { marks: { [part]: null } } };
  return secretMarkProblem(part, text) === null ? { narrator: { marks: { [part]: text } } } : null;
}

const MARK_LABEL: Record<MarkPart, string> = {
  known: "Known to some",
  kept: "Kept from some",
  both: "Known to some, kept from others",
  everyone: "The word for everyone",
  rule: "What the narrator is told a mark means",
};

const MARK_NOTE: Record<MarkPart, string> = {
  known: "A secret some people know, marked with who knows it.",
  kept: "A secret marked with whom it is kept from.",
  both: "A secret marked with both who knows it and whom it is kept from.",
  everyone: "Used for {{kept}} when a secret is kept from everyone.",
  rule: "The sentence in the narrator's rules that explains a secret's mark, every turn.",
};

/** The placeholders a part may hold beside those it needs (`SECRET_MARK_NEEDS`). */
const MARK_MAY_HOLD: Partial<Record<MarkPart, readonly string[]>> = { rule: ["{{everyone}}"] };

/** What each placeholder of a secret's mark holds, by its bare name. */
const MARK_VAR_HOLDS: Record<string, string> = {
  text: "The secret's words.",
  known: "Who knows it, names joined with commas.",
  kept: "Whom it is kept from, names joined with commas, or the word for everyone when it's kept from everyone.",
  forms: 'Each way a secret is marked in your wording above, "…" for its words and names, joined with "or".',
  everyone: "The word for everyone, as above.",
};

export function NarratorPage(props: { narrator: NarratorSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const { narrator, busy } = props;
  return (
    <div class="lre-stack lre-minds-set" data-lre-settings-page="narrator">
      <p class="lre-set-lead">What the narrator is told each turn: whose knowledge, and what of a secret.</p>
      <Section>
        <div class="lre-minds-body">
          <NarratorViewControl value={narrator} disabled={busy} onChange={(next) => props.patch({ narrator: { knowledge: next.knowledge, secrets: next.secrets } })} />
          <p class="lre-minds-note">This is your default. A world's own (Build → World) and a chat's own choice (GM → This chat → Knowledge) come before it. A change applies from each chat's next turn.</p>
        </div>
      </Section>
      <Section title="How a secret is marked" flush>
        <div class="lre-minds-prompts">
          <p class="lre-minds-note lre-minds-prompts-lead">When secrets are marked, a line carrying a secret's words goes to the narrator in these words, and the narrator's rules explain them in the last. Each part needs its placeholders.</p>
          {MARK_PARTS.map((part) => (
            <PromptEditor
              key={part}
              id={`mark-${part}`}
              label={MARK_LABEL[part]}
              note={MARK_NOTE[part]}
              noun="wording"
              builtIn={SECRET_MARK_WORDING[part]}
              value={narrator.marks[part]}
              max={MIND_PROMPT_MAX}
              vars={[...SECRET_MARK_NEEDS[part], ...(MARK_MAY_HOLD[part] ?? [])].map((p) => p.replace(/^\{\{|\}\}$/g, "")).map((name) => ({ name, holds: MARK_VAR_HOLDS[name] ?? "" }))}
              rows={part === "rule" ? 6 : 3}
              busy={busy}
              save={(text) => secretMarkPatch(part, text)}
              // Blank saves as the shipped text, so it names no problem.
              problem={(text) => (text.trim() === "" ? null : secretMarkProblem(part, text))}
              patch={props.patch}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

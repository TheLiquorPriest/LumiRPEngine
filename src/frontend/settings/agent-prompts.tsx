// Settings → Agents → Prompts (DESIGN §6.12): every text LumiRPEngine sends to a model, one page per
// part it goes to (the final output, then each agent), each text on the step prompts' editor with its
// placeholders, its shipped text and Reset. A text with a placeholder it doesn't have, or without one
// it must keep, is flagged as it is typed and can't be saved; the backend refuses it too. Styles:
// styles/minds.ts.

import { useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { PromptDef, PromptPage, PromptSettings } from "../../shared/prompts";
import { PROMPT_PAGES, PROMPTS, promptProblems } from "../../shared/prompts";
import { NumberStepper, Section, Seg } from "../components";
import { PromptEditor } from "./prompt-editor";

/**
 * The patch saving `text` as the user's own for `def` (null resets it to the shipped text), or null
 * when it can't be saved (`promptProblems`). The shipped text word for word saves none, so it keeps
 * any later update; anything else, an empty text included, is the user's own.
 */
export function promptTextPatch(def: PromptDef, text: string | null, maxChars: number): JsonObject | null {
  if (text === null) return { prompts: { texts: { [def.id]: null } } };
  if (promptProblems(def, text, maxChars).length > 0) return null;
  return { prompts: { texts: { [def.id]: text.trim() === def.text.trim() ? null : text } } };
}

/** A page's texts under their headings, in the registry's order. */
export function promptGroups(page: PromptPage): { title: string; defs: PromptDef[] }[] {
  const out: { title: string; defs: PromptDef[] }[] = [];
  for (const def of PROMPTS) {
    if (def.page !== page.id) continue;
    const title = def.group ?? page.label;
    const group = out.find((g) => g.title === title);
    if (group) group.defs.push(def);
    else out.push({ title, defs: [def] });
  }
  return out;
}

/** How many texts are the user's own, for Settings' home row. */
export function ownTextCount(prompts: PromptSettings): number {
  return PROMPTS.filter((def) => prompts.texts[def.id] !== undefined).length;
}

export function PromptsPage(props: { prompts: PromptSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const { prompts, busy } = props;
  const [pageId, setPageId] = useState(PROMPT_PAGES[0]?.id ?? "");
  const page = PROMPT_PAGES.find((p) => p.id === pageId) ?? PROMPT_PAGES[0];
  if (!page) return null;
  return (
    <div class="lre-stack lre-minds-set" data-lre-settings-page="prompts">
      <p class="lre-set-lead">Every text LumiRPEngine sends to a model, as shipped until you write your own. Yours is sent from the next turn; Reset brings back the shipped text. A Re-narrate is sent the texts its turn was made with unless Settings → Swipes says otherwise.</p>
      <Seg label="Prompts for" value={page.id} options={PROMPT_PAGES.map((p) => ({ value: p.id, label: p.label }))} disabled={busy} onChange={(v) => setPageId(String(v))} />
      <p class="lre-minds-note" data-lre-prompt-page={page.id}>
        {page.note}
      </p>
      {promptGroups(page).map((group) => (
        <Section key={group.title} title={group.title} flush>
          <div class="lre-minds-prompts">
            {group.defs.map((def) => (
              <PromptEditor
                key={def.id}
                id={def.id}
                label={def.label}
                note={def.note}
                builtIn={def.text}
                value={prompts.texts[def.id]}
                max={prompts.maxChars}
                vars={def.vars}
                problems={(text) => promptProblems(def, text).map((p) => p.message)}
                busy={busy}
                save={(text) => promptTextPatch(def, text, prompts.maxChars)}
                patch={props.patch}
              />
            ))}
          </div>
        </Section>
      ))}
      <Section title="Limits">
        <div class="lre-minds-body">
          <NumberStepper label="Longest text of your own (characters)" value={prompts.maxChars} min={1} step={1000} integer disabled={busy} onChange={(maxChars) => props.patch({ prompts: { maxChars } })} />
          <p class="lre-minds-note">A text you save may be at most this long. Lowering it leaves a longer text you already saved as it is, until you edit it.</p>
        </div>
      </Section>
    </div>
  );
}

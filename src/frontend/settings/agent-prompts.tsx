// Settings → Agents → Prompts (DESIGN §6.12): every text LumiRPEngine sends to a model, one page per
// part it goes to (the final output, then each agent), each text on the step prompts' editor with its
// placeholders, its shipped text and Reset. A text with a placeholder it doesn't have, or without one
// it must keep, is flagged as it is typed and can't be saved; the backend refuses it too. A role's
// text has Test while a chat is open (`lre.prompts test`): the role runs once on that chat's latest
// exchange with the text as written, one model call, and the page says whether its answer kept the
// role's contract or, in words, how it didn't, and what of its task the chat couldn't give
// (`PromptTestRow`). Styles: styles/minds.ts.

import { useState } from "preact/hooks";
import type { ChatId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import type { PromptDef, PromptPage, PromptSettings } from "../../shared/prompts";
import { PROMPT_PAGES, PROMPTS, promptProblems } from "../../shared/prompts";
import type { PromptTestView } from "../../shared/protocol";
import { ROLE_IDS } from "../../shared/agent-roles";
import { rolePageId } from "../../shared/role-prompts";
import type { RequestBody } from "../registry";
import { Button, NumberStepper, Section, Seg } from "../components";
import { PromptEditor } from "./prompt-editor";

/** The request a Test press sends: `text`, as written, tested as text `id`'s on `chatId`. */
export function promptTestRequest(chatId: ChatId, id: string, text: string): Extract<RequestBody, { type: "lre.prompts" }> {
  return { type: "lre.prompts", op: "test", chatId, id, text };
}

/** Whether a text has Test: a role's, whose answer keeps a task's contract. */
export function testable(def: PromptDef): boolean {
  return def.contract !== undefined && ROLE_IDS.some((role) => def.page === rolePageId(role));
}

/** A Test's state on the page: under way, or what it found. */
export type PromptTestState = "running" | PromptTestView;

/**
 * A role text's Test: the button, which tests the text as written (`send`, one model call), then
 * what the last press found: that it passed, or each problem in words. Hook-free.
 */
export function PromptTestRow(props: { label: string; text: string; problems: readonly string[]; busy: boolean; state: PromptTestState | undefined; send(text: string): void }) {
  const { state } = props;
  return (
    <div class="lre-minds-body" data-lre-prompt-test={state === undefined ? "none" : state === "running" ? "running" : state.ok ? "passed" : "failed"}>
      <div class="lre-minds-actions">
        <Button size="sm" variant="secondary" icon="play" label={`Test ${props.label} on this chat`} disabled={props.busy || state === "running" || props.problems.length > 0} onClick={() => props.send(props.text)}>
          Test
        </Button>
      </div>
      <p class="lre-minds-note">Runs the role once on this chat's latest exchange with the text as written (one model call) and checks its answer against the role's contract.</p>
      {state === "running" ? <p class="lre-minds-note">Testing…</p> : null}
      {state !== undefined && state !== "running" && state.ok ? <p class="lre-minds-note">Passed: the role's answer kept its contract.</p> : null}
      {state !== undefined && state !== "running" && !state.ok ? (
        <div class="lre-set-warn" role="note">
          <span>
            Failed: {state.problems.map((p) => `${p.charAt(0).toUpperCase()}${p.slice(1)}`).join("; ")}.
          </span>
        </div>
      ) : null}
      {state !== undefined && state !== "running" && state.left.length > 0 ? <p class="lre-minds-note">{`Left out of its task: ${state.left.join("; ")}.`}</p> : null}
    </div>
  );
}

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

/** `test`: a role text's Test on the open chat, the press's answer, or null when it failed (the request says why); absent while no chat is open. */
export function PromptsPage(props: { prompts: PromptSettings; patch(patch: JsonObject): void; busy: boolean; test?(def: PromptDef, text: string): Promise<PromptTestView | null> }) {
  const { prompts, busy } = props;
  const [pageId, setPageId] = useState(PROMPT_PAGES[0]?.id ?? "");
  const [tests, setTests] = useState<Readonly<Record<string, PromptTestState>>>({});
  const page = PROMPT_PAGES.find((p) => p.id === pageId) ?? PROMPT_PAGES[0];
  if (!page) return null;
  const run = async (def: PromptDef, text: string): Promise<void> => {
    if (!props.test) return;
    setTests((now) => ({ ...now, [def.id]: "running" }));
    const found = await props.test(def, text);
    setTests((now) => {
      const { [def.id]: _was, ...rest } = now;
      return found ? { ...rest, [def.id]: found } : rest;
    });
  };
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
                {...(props.test && testable(def) ? { test: (text: string) => <PromptTestRow label={def.label} text={text} problems={promptProblems(def, text).map((p) => p.message)} busy={busy} state={tests[def.id]} send={(t) => void run(def, t)} /> } : {})}
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

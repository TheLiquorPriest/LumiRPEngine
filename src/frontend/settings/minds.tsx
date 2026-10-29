// Settings → Minds (DESIGN §24.6): whether characters get minds, how many think a
// turn, what refreshes a Near mind and how often a Far one thinks, which levels write memory notes,
// what a mind reads (each source on or off with its own limit), the Minds section's own budget and a
// time skip's caps (under Advanced), knowledge (DESIGN §24.11: who knows what, its limits and the
// wording of its texts), the user's memory overrides of the world's settings (a disclosure, as
// they're long), and the minds prompts, each beside its built-in default with Reset. Every patch is
// `minds-patch.ts`'s. Styles: styles/minds.ts.

import { useEffect, useId, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { KnowledgeBatch, KnowledgeLimit, KnowledgeSettings, KnowledgeTextId, Limit, MindPurpose, MindSource, MindsReads, MindsSettings } from "../../shared/minds";
import { DEFAULT_MIND_READS, DEFAULT_MINDS_MEMORY, FIDELITIES, KNOWLEDGE_BATCHES, KNOWLEDGE_LIMITS, KNOWLEDGE_RANGES, KNOWLEDGE_TEXT_IDS, KNOWLEDGE_TEXTS, knowledgeLimitRange, MIND_PROMPT_DEFAULTS, MIND_PROMPT_MAX, MIND_PURPOSES, MIND_SOURCES, MINDS_DEFAULTS } from "../../shared/minds";
import { Badge, Button, Disclosure, HostSwitch, NumberStepper, Section, Seg } from "../components";
import { Icon } from "../icons";
import { PromptEditor } from "./prompt-editor";
import type { KnowledgeSettingsChange, MemoryField } from "./minds-patch";
import { knowledgeLimitPatch, knowledgePatch, knowledgePlaceholders, knowledgeTextPatch, MEMORY_FIELDS, memoryOverride, memoryOverridePatch, memoryValue, mindsPolicyPatch, mindsPromptPatch, mindsReadPatch, missingPlaceholders, withMemoryLevel } from "./minds-patch";
import { STEP_LABEL } from "../../shared/steps";
import { FIDELITY_LABEL } from "../../packs/minds/ui/ops";

const PROMPT_NOTE: Record<MindPurpose, string> = {
  mind: "One call per character, as that character: what they think, how they come across, what they mean to do.",
  memory: "After the reply, per character who heard your message, at the levels you pick: the notes, commitments and plans they take from it.",
  skip: "Before a time skip: further moments in it worth stopping at.",
  consolidate: "Folds a character's faded and surplus notes into their summary.",
  knowledge: "After the reply, one call per scene, or one per character as set in Knowledge: who learned what, what they worked out and what they now doubt.",
};

function Note(props: { children: string }) {
  return <p class="lre-minds-note">{props.children}</p>;
}

/** Where a source's limit starts when it stops being "no limit": room for a long scene's end. */
const TOKENS_START = 1000;

/** Each source of what a mind reads, as Settings names it. */
const READ_LABEL: Record<MindSource, string> = {
  pinned: "Lore pinned to them and to where they are",
  activated: "Lore the turn activates",
  reply: "The latest reply",
  message: "Your message",
  history: "Recent chat",
  summary: "Their summary",
  memory: "Their notes and what they saw",
  thoughts: "Their last thoughts",
  recall: "Turns they were there for",
  routine: "Their usual routine",
  plans: "Their plans",
  life: "Their life: money, the day and commitments",
  knowledge: "What they know: their own holdings",
};

const READ_NOTE: Record<MindSource, string> = {
  pinned: "What Build pins to the character, then to every mind (Build → Pinned lore, Character minds), then to their place and each place around it, nearest first; a pinned World Info book or entry is read from the book each time. Within the limit every entry comes whole; the Context panel says what didn't fit.",
  activated: "The world's lore entries the turn names, by a key, an alias, a title or a lookup-table term, as World Info activates them, read as the character: by your message and the latest reply when they were there for them, else by where they are.",
  reply: "How the latest reply ended, for those who were there for it; cut to a number, they read its end. The memory step reads the reply within this limit too.",
  message: "What you say and do, for those with you. The memory step reads it within this limit too.",
  history: "The latest messages before the turn as you see them in the chat (hidden JSON blocks left out), oldest first, up to both limits, whichever comes first. It includes turns they weren't there for: the chat as the player sees it, not what they know. The memory step, consolidation and the time-skip step read it too while it's on.",
  summary: "The summary their memory keeps and folds their old notes into.",
  memory: "Their memory notes, most salient first, and what they saw happen. Never what someone's memory says they were told: that came from another mind.",
  thoughts: "Their own latest mind: what they thought, what they meant to do and how they felt.",
  recall: "Earlier turns they were there for: the latest, and those that best match the moment. Its limit is the memory setting's, which the world sets and you can override.",
  routine: "What they usually do, from their routine and schedules as the world and the story set them, while their routine isn't off: theirs to weigh, never what they must do. A private block only when it's their own, and never social life the planner made up.",
  plans: "What they mean to do later, soonest first, with when, where and who else is in it: the plans the story's turns stated for them and the ones you set in GM mode. A plan shared by several people is each one's. Never the day the planner lays.",
  life: "Their money, the rest of today as the planner lays it (with what it fills free time with: meals, friends, outings) and their commitments. None of it is the story as it stands.",
  knowledge: "While the chat tracks knowledge, the facts they hold and how they came by them (saw it, were told, worked it out), in place of the secrets in who they are. Its limit is Knowledge's What they know tokens.",
};

/** Where each source is listed: the story as it stands, what they know, the chat as the player sees it, what they usually do, or their own memory and life. */
type ReadGroup = "story" | "known" | "chat" | "usual" | "own";
const READ_GROUPS: readonly ReadGroup[] = ["story", "known", "chat", "usual", "own"];
const READ_GROUP: Readonly<Record<MindSource, ReadGroup>> = { pinned: "story", activated: "story", reply: "story", message: "story", knowledge: "known", history: "chat", summary: "own", memory: "own", thoughts: "own", recall: "own", routine: "usual", plans: "usual", life: "own" };

const GROUP_TITLE: Record<ReadGroup, string> = { story: "The story as it stands", known: "What they know", chat: "The chat as you see it", usual: "What they usually do and mean to do", own: "Their own memory and life" };

/** Each group's note; the story as it stands needs none. */
const GROUP_NOTE: Record<ReadGroup, string | null> = {
  story: null,
  known: "On unless you turn it off: what they know and how, so they act on that and no more. It reads nothing while the chat doesn't track knowledge.",
  chat: "Off unless you turn it on: it tells a mind of turns its character wasn't there for.",
  usual: "On unless you turn them off: their routine as context, and the plans the story made for them, so they can keep to their days and to what they agreed without the planner deciding for them.",
  own: "Off unless you turn them on: each can carry what the story never set up, like a day the planner filled with meals and friends, or a plan their memory took from narration that showed another character's mind.",
};

/** What a mind reads: every source in its group, each its own row. */
export function ReadSources(props: { reads: MindsReads; memory: MindsSettings["memory"]; knowledge: KnowledgeSettings; busy: boolean; patch(patch: JsonObject): void }) {
  return (
    <>
      {READ_GROUPS.map((group) => {
        const note = GROUP_NOTE[group];
        return (
          <div key={group} class="lre-minds-group">
            <span class="lre-minds-group-title">{GROUP_TITLE[group]}</span>
            {note ? <Note>{note}</Note> : null}
            {MIND_SOURCES.filter((s) => READ_GROUP[s] === group).map((source) => (
              <ReadRow key={source} source={source} reads={props.reads} memory={props.memory} knowledge={props.knowledge} busy={props.busy} patch={props.patch} />
            ))}
          </div>
        );
      })}
    </>
  );
}

/** A count, period or allowance that may have no limit: a switch, and the number while there is one. Settings → Steps uses it for Build's jobs too. */
export function LimitField(props: { label: string; noneLabel: string; value: Limit; min: number; max?: number; step?: number; fallback: Limit; disabled: boolean; onChange(next: Limit): void }) {
  const fallback = props.fallback === "none" ? props.min : props.fallback;
  return (
    <div class="lre-minds-limit">
      <HostSwitch label={`${props.label}: ${props.noneLabel}`} checked={props.value === "none"} disabled={props.disabled} onChange={(none) => props.onChange(none ? "none" : fallback)} />
      {props.value === "none" ? null : <NumberStepper label={props.label} value={props.value} min={props.min} max={props.max} step={props.step ?? 1} integer disabled={props.disabled} onChange={props.onChange} />}
    </div>
  );
}

/** One memory tunable as the user's override: unset, the world's applies; set, "Use the world's" deletes it. A field that may have no limit has its switch. */
function MemoryOverride(props: { field: MemoryField; memory: MindsSettings["memory"]; busy: boolean; patch(patch: JsonObject): void }) {
  const { field, busy } = props;
  const own = memoryOverride(props.memory, field);
  const builtIn = memoryValue(DEFAULT_MINDS_MEMORY, field);
  const id = `${field.part}.${field.key}`;
  const set = (value: Limit | boolean | null): void => {
    const p = memoryOverridePatch(field, value);
    if (p) props.patch(p);
  };
  return (
    <div class="lre-minds-override" data-lre-minds-memory={id}>
      {field.none ? <HostSwitch label={`${field.label}: ${field.none}`} checked={own === "none" || (own === undefined && builtIn === "none")} disabled={busy} onChange={(none) => set(none ? "none" : typeof builtIn === "number" ? builtIn : (field.range?.[0] ?? 0))} /> : null}
      {field.range && own !== "none" ? (
        <NumberStepper label={field.label} value={typeof own === "number" ? own : null} min={field.range[0]} max={field.range[1]} step={field.step ?? 1} integer={field.integer === true} disabled={busy} onChange={set} />
      ) : field.range ? null : (
        <HostSwitch label={field.label} checked={typeof own === "boolean" ? own : builtIn === true} disabled={busy} onChange={set} />
      )}
      <div class="lre-minds-override-foot">
        {own === undefined ? (
          <span class="lre-minds-note">The world's applies (built in: {typeof builtIn === "boolean" ? (builtIn ? "on" : "off") : builtIn === "none" ? (field.none ?? "none") : builtIn})</span>
        ) : (
          <>
            <Badge tone="accent">Yours</Badge>
            <Button size="sm" variant="ghost" icon="undo" label={`Use the world's ${field.label.toLowerCase()}`} disabled={busy} onClick={() => set(null)}>
              Use the world's
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** One source of what a mind reads: its switch and, while it's on, its limit (recall's is its memory override, what they know's is Knowledge's mind tokens; the recent chat has a messages limit too). */
export function ReadRow(props: { source: MindSource; reads: MindsReads; memory: MindsSettings["memory"]; knowledge: KnowledgeSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const { source, reads, busy } = props;
  const on = reads[source].on;
  const recall = MEMORY_FIELDS.find((f) => f.part === "recall" && f.key === "tokens");
  return (
    <div class="lre-minds-override" data-lre-minds-read={source}>
      <HostSwitch label={READ_LABEL[source]} checked={on} disabled={busy} onChange={(next) => props.patch(mindsReadPatch(source, { on: next }))} />
      {!on ? null : source === "recall" ? (
        recall ? <MemoryOverride field={recall} memory={props.memory} busy={busy} patch={props.patch} /> : null
      ) : source === "knowledge" ? (
        <>
          <KnowledgeLimitStepper limit="mindTokens" knowledge={props.knowledge} busy={busy} patch={props.patch} />
          {props.knowledge.enabled ? null : <Note>Track who knows what is off (Knowledge, below), so this reads nothing unless a chat turns it on in GM → This chat.</Note>}
        </>
      ) : (
        <>
          {source === "history" ? <LimitField label={`${READ_LABEL.history} (messages)`} noneLabel="no limit" value={reads.history.messages} min={1} fallback={DEFAULT_MIND_READS.history.messages} disabled={busy} onChange={(messages) => props.patch(mindsReadPatch("history", { messages }))} /> : null}
          <LimitField label={`${READ_LABEL[source]} (tokens)`} noneLabel="no limit" value={reads[source].tokens} min={1} step={100} fallback={DEFAULT_MIND_READS[source].tokens === "none" ? TOKENS_START : DEFAULT_MIND_READS[source].tokens} disabled={busy} onChange={(tokens) => props.patch(mindsReadPatch(source, { tokens }))} />
        </>
      )}
      <Note>{READ_NOTE[source]}</Note>
    </div>
  );
}

/** A minds step's own prompt (`minds.prompts`), on the editor Settings → Steps and connections shares. */
export function MindPromptEditor(props: { purpose: MindPurpose; value: string | undefined; busy: boolean; patch(patch: JsonObject): void }) {
  return <PromptEditor id={props.purpose} label={STEP_LABEL[props.purpose]} note={PROMPT_NOTE[props.purpose]} builtIn={MIND_PROMPT_DEFAULTS[props.purpose]} value={props.value} max={MIND_PROMPT_MAX} vars={props.purpose} busy={props.busy} save={(text) => mindsPromptPatch(props.purpose, text)} patch={props.patch} />;
}

const BATCH_LABEL: Record<KnowledgeBatch, string> = { scene: "One call per scene", character: "One call per character" };

/** Each knowledge limit as Settings names it, with a short note and the stepper's step. */
const LIMIT_FIELD: Record<KnowledgeLimit, { label: string; note: string; step: number }> = {
  mindTokens: { label: "What they know, for each mind (tokens)", note: "What a mind reads of the facts it holds. What a mind reads shows it on its What they know row too.", step: 100 },
  narratorTokens: { label: "Who knows what, for the narrator (tokens)", note: "The narrator's Who knows what: who here knows, suspects or doesn't know the facts in play.", step: 100 },
  perPerson: { label: "Who knows what: facts per person", note: "The narrator gets each person's most relevant facts, up to this many.", step: 1 },
  stepTokens: { label: "The knowledge step's context (tokens)", note: "What happened, who could perceive it, what each of them already knows and has seen lately, and the facts in play.", step: 100 },
  claimChars: { label: "A fact's claim (characters)", note: "The longest claim the knowledge step records; a longer one is cut.", step: 10 },
  factsPerChat: { label: "Facts made in play, per chat", note: "Past it, the knowledge step makes no new fact; people still learn the ones there are.", step: 1 },
  holdersPerFact: { label: "People who may hold one fact", note: "Past it, no one else learns that fact from the knowledge step.", step: 1 },
  factsPerTurn: { label: "New facts a turn", note: "The most new facts one turn's knowledge step records.", step: 1 },
  learningsPerTurn: { label: "Learnings a turn", note: "The most learnings one turn's knowledge step records: each person told something counts one, and each fact seen or heard counts one however many were there.", step: 1 },
  inPlayTurns: { label: "A fact stays in play for (turns)", note: "A fact is in play while someone learned it within this many of the latest turns, or while it's about someone or somewhere here.", step: 1 },
};

/** The limits Knowledge shows open; the rest fold under More limits. */
const OPEN_LIMITS: readonly KnowledgeLimit[] = ["mindTokens", "narratorTokens", "perPerson", "stepTokens"];

/** One knowledge limit: a whole number within its range (`knowledgeLimitRange`). */
function KnowledgeLimitStepper(props: { limit: KnowledgeLimit; knowledge: KnowledgeSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const [min, max] = knowledgeLimitRange(props.limit);
  const field = LIMIT_FIELD[props.limit];
  return <NumberStepper label={field.label} value={props.knowledge[props.limit]} min={min} max={max} step={field.step} integer disabled={props.busy} onChange={(value) => props.patch(knowledgeLimitPatch(props.limit, value))} />;
}

function KnowledgeLimitRow(props: { limit: KnowledgeLimit; knowledge: KnowledgeSettings; busy: boolean; patch(patch: JsonObject): void }) {
  return (
    <div class="lre-minds-override" data-lre-knowledge-limit={props.limit}>
      <KnowledgeLimitStepper limit={props.limit} knowledge={props.knowledge} busy={props.busy} patch={props.patch} />
      <Note>{LIMIT_FIELD[props.limit].note}</Note>
    </div>
  );
}

/** Where each knowledge text is sent: what a mind reads of its own, how any holding reads, the narrator's Who knows what, and the knowledge step's context. */
type TextGroup = "mind" | "holding" | "narrator" | "step";
const TEXT_GROUPS: readonly TextGroup[] = ["mind", "holding", "narrator", "step"];
const TEXT_GROUP_TITLE: Record<TextGroup, string> = {
  mind: "What a mind reads",
  holding: "How a fact someone holds reads",
  narrator: "The narrator's Who knows what",
  step: "The knowledge step's context",
};
const TEXT_GROUP_NOTE: Record<TextGroup, string> = {
  mind: "The heading and lead over the facts a mind holds.",
  holding: "Each line a mind, the narrator and the knowledge step read for a fact someone holds, and the words for how they came by it.",
  narrator: "How Who knows what names a person's facts, and what they don't know.",
  step: "The headings of what the knowledge step is given.",
};

/** Each knowledge text: its group and what it is. */
const TEXT_FIELD: Record<KnowledgeTextId, { group: TextGroup; label: string }> = {
  mindTitle: { group: "mind", label: "Heading" },
  mindLead: { group: "mind", label: "Lead" },
  known: { group: "holding", label: "A fact they know" },
  suspected: { group: "holding", label: "A fact they suspect" },
  disbelieved: { group: "holding", label: "A fact they don't believe" },
  unsure: { group: "holding", label: "A fact they're unsure of" },
  keeps: { group: "holding", label: "Whom they keep it from" },
  everyone: { group: "holding", label: "Kept from everyone" },
  authored: { group: "holding", label: "How: known from the start" },
  witnessed: { group: "holding", label: "How: saw it" },
  told: { group: "holding", label: "How: told by someone" },
  inferred: { group: "holding", label: "How: worked it out" },
  guessed: { group: "holding", label: "How: a guess" },
  person: { group: "narrator", label: "A person's line" },
  notKnown: { group: "narrator", label: "What someone doesn't know" },
  stepHappened: { group: "step", label: "What happened" },
  stepPresent: { group: "step", label: "Who could perceive it" },
  stepPeople: { group: "step", label: "What each already knows" },
  stepFacts: { group: "step", label: "Facts in play" },
  stepPerson: { group: "step", label: "A person" },
  stepYou: { group: "step", label: "The player character" },
  stepSaid: { group: "step", label: "What the player character said or did" },
  stepStory: { group: "step", label: "The story, as written" },
  stepThroughout: { group: "step", label: "Present: throughout" },
  stepLeft: { group: "step", label: "Present: not at its end" },
  stepCame: { group: "step", label: "Present: came in during the turn" },
  stepOpen: { group: "step", label: "An open question" },
  stepFalse: { group: "step", label: "A false fact" },
  stepPinned: { group: "step", label: "Pinned lore" },
  stepTraits: { group: "step", label: "Who they are" },
  stepHolds: { group: "step", label: "What they hold" },
  stepNothing: { group: "step", label: "Holding nothing yet" },
  stepWitnessed: { group: "step", label: "What they witnessed lately" },
  stepSomeone: { group: "step", label: "A teller with no name" },
  stepAnswer: { group: "step", label: "What each list of the answer holds" },
};

/**
 * One knowledge text as the user words it (`minds.knowledge.prompts[id]`): the saved wording, else
 * the shipped text to start from, with Save, Revert and Reset. A wording that leaves out a shipped
 * placeholder can't be saved: the engine fills each.
 */
function KnowledgeTextField(props: { id: KnowledgeTextId; value: string | undefined; busy: boolean; patch(patch: JsonObject): void }) {
  const { id, busy } = props;
  const input = useId();
  const shipped = KNOWLEDGE_TEXTS[id];
  const saved = props.value ?? shipped;
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const save = knowledgeTextPatch(id, text);
  const placeholders = knowledgePlaceholders(id);
  const missing = text.trim() === "" ? [] : missingPlaceholders(id, text);
  const error = text.length > MIND_PROMPT_MAX ? `Too long: at most ${MIND_PROMPT_MAX.toLocaleString()} characters.` : missing.length > 0 ? `Keep ${missing.join(", ")}: the engine fills ${missing.length === 1 ? "it" : "each"} in.` : null;
  const label = TEXT_FIELD[id].label;
  return (
    <div class="lre-minds-tpl" data-lre-knowledge-text={id}>
      <div class="lre-minds-tpl-head">
        <span class="lre-minds-tpl-text">
          <label class="lre-minds-subhead" for={input}>
            {label}
          </label>
          {placeholders.length > 0 ? <span class="lre-minds-note">Keep {placeholders.join(", ")}.</span> : null}
        </span>
        {props.value !== undefined ? <Badge tone="accent">Your own</Badge> : <Badge>Shipped</Badge>}
      </div>
      <textarea id={input} class="lre-input lre-minds-text-input" rows={shipped.length > 80 ? 3 : 1} value={text} disabled={busy} onInput={(event) => setText(event.currentTarget.value)} />
      {error ? (
        <div class="lre-set-warn" role="note">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      ) : null}
      <div class="lre-minds-actions">
        <Button size="sm" variant="primary" disabled={busy || save === null || text === saved} onClick={() => save && props.patch(save)}>
          Save
        </Button>
        <Button size="sm" variant="ghost" disabled={busy || text === saved} onClick={() => setText(saved)}>
          Revert
        </Button>
        <Button size="sm" icon="undo" label={`Reset ${label} to the shipped text`} disabled={busy || props.value === undefined} onClick={() => props.patch(knowledgeTextPatch(id, null) ?? {})}>
          Reset
        </Button>
      </div>
    </div>
  );
}

/** Settings → Minds → Knowledge (DESIGN §24.11): shown with minds on or off, as the knowledge step runs either way. */
function KnowledgeSection(props: { knowledge: KnowledgeSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const { knowledge: k, busy } = props;
  const set = (change: KnowledgeSettingsChange) => props.patch(knowledgePatch(change));
  const [lo, hi] = KNOWLEDGE_RANGES.threshold;
  return (
    <Section title="Knowledge">
      <div class="lre-minds-body" data-lre-knowledge-settings="">
        <HostSwitch label="Track who knows what" checked={k.enabled} disabled={busy} onChange={(enabled) => set({ enabled })} />
        <Note>On, each character holds the facts they know. After each reply the knowledge step works out who learned what; minds read what they know, the narrator gets Who knows what, and Play shows What you know. A chat's own switch in GM → This chat wins.</Note>
        <NumberStepper label="Suspicion threshold (%)" value={Math.round(k.threshold * 100)} min={lo * 100} max={hi * 100} step={5} integer disabled={busy} onChange={(percent) => set({ threshold: percent / 100 })} />
        <Note>A fact someone holds less surely than this is a suspicion, not something they know.</Note>
        <div class="lre-minds-group">
          <span class="lre-minds-group-title">The knowledge step</span>
          <Seg<KnowledgeBatch> label="The knowledge step" value={k.batch} options={KNOWLEDGE_BATCHES.map((b) => ({ value: b, label: BATCH_LABEL[b] }))} disabled={busy} onChange={(batch) => set({ batch })} />
          <Note>One call per scene works out everyone who could perceive the turn at once. One call per character asks about each of them alone: closer reading, a call each.</Note>
        </div>
        <div class="lre-minds-group">
          <span class="lre-minds-group-title">Limits</span>
          <div class="lre-minds-overrides">
            {OPEN_LIMITS.map((limit) => (
              <KnowledgeLimitRow key={limit} limit={limit} knowledge={k} busy={busy} patch={props.patch} />
            ))}
          </div>
          <Disclosure summary="More limits">
            <div class="lre-minds-overrides">
              {KNOWLEDGE_LIMITS.filter((limit) => !OPEN_LIMITS.includes(limit)).map((limit) => (
                <KnowledgeLimitRow key={limit} limit={limit} knowledge={k} busy={busy} patch={props.patch} />
              ))}
            </div>
          </Disclosure>
        </div>
        <div class="lre-minds-group">
          <span class="lre-minds-group-title">Texts</span>
          <Note>The words knowledge sends a model, besides the knowledge step's own prompt (under Prompts). Yours replaces the shipped text; Reset goes back to it.</Note>
          {TEXT_GROUPS.map((group) => (
            <Disclosure
              key={group}
              summary={
                <span class="lre-minds-summary">
                  <span>{TEXT_GROUP_TITLE[group]}</span>
                  {KNOWLEDGE_TEXT_IDS.some((id) => TEXT_FIELD[id].group === group && k.prompts[id] !== undefined) ? <Badge tone="accent">Yours</Badge> : null}
                </span>
              }
            >
              <Note>{TEXT_GROUP_NOTE[group]}</Note>
              {KNOWLEDGE_TEXT_IDS.filter((id) => TEXT_FIELD[id].group === group).map((id) => (
                <KnowledgeTextField key={id} id={id} value={k.prompts[id]} busy={busy} patch={props.patch} />
              ))}
            </Disclosure>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function MindsSection(props: { minds: MindsSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const { minds, busy } = props;
  const policy = (change: Parameters<typeof mindsPolicyPatch>[0]) => props.patch(mindsPolicyPatch(change));
  // Recall's tokens are its limit in What a mind reads, so the overrides leave them out.
  const memoryFields = MEMORY_FIELDS.filter((field) => !(field.part === "recall" && field.key === "tokens"));
  const overrides = memoryFields.filter((field) => memoryOverride(minds.memory, field) !== undefined).length;
  return (
    <div class="lre-stack lre-minds-set" data-lre-settings-page="minds">
      <p class="lre-set-lead">Each character near the story thinks for themselves in their own model call, scoped to what they know.</p>
      <Section>
        <div class="lre-minds-body">
          <HostSwitch label="Character minds" checked={minds.enabled} disabled={busy} onChange={(enabled) => policy({ enabled })} />
          <Note>Picking a Model use preset sets everything here but what a mind reads, knowledge, your prompts and memory overrides; changing any of the rest makes it Custom.</Note>
        </div>
      </Section>
      {minds.enabled ? (
        <>
          <Section title="How many think">
            <div class="lre-minds-body">
              <LimitField label="Live minds a turn" noneLabel="no limit" value={minds.liveLimit} min={0} max={64} fallback={MINDS_DEFAULTS.liveLimit} disabled={busy} onChange={(liveLimit) => policy({ liveLimit })} />
              <Note>Live characters think every turn, best score first; past the limit they wait for a Near refresh.</Note>
              <LimitField label="Near and Far refreshes a turn" noneLabel="no limit" value={minds.refreshLimit} min={0} max={64} fallback={MINDS_DEFAULTS.refreshLimit} disabled={busy} onChange={(refreshLimit) => policy({ refreshLimit })} />
              <Note>Besides the Live minds, the most pressing first. A refresh you ask for in GM mode always runs.</Note>
              <Note>Background characters never get a mind; they follow their routine.</Note>
            </div>
          </Section>
          <Section title="Near refresh">
            <div class="lre-minds-body">
              <Note>A Near character thinks again when one of these calls for it.</Note>
              <HostSwitch label="When they come into the scene, or it changes" checked={minds.nearRefresh.scene} disabled={busy} onChange={(scene) => policy({ nearRefresh: { scene } })} />
              <HostSwitch label="When the latest message or reply names them" checked={minds.nearRefresh.mention} disabled={busy} onChange={(mention) => policy({ nearRefresh: { mention } })} />
              <LimitField label="Every so many turns" noneLabel="never by turns" value={minds.nearRefresh.turns} min={1} max={1000} fallback={MINDS_DEFAULTS.nearRefresh.turns} disabled={busy} onChange={(turns) => policy({ nearRefresh: { turns } })} />
              <LimitField label="When their mind is this old (game minutes)" noneLabel="never by age" value={minds.nearRefresh.minutes} min={1} max={525_600} step={30} fallback={MINDS_DEFAULTS.nearRefresh.minutes} disabled={busy} onChange={(minutes) => policy({ nearRefresh: { minutes } })} />
            </div>
          </Section>
          <Section title="Far refresh">
            <div class="lre-minds-body">
              <Note>A Far character thinks now and then, on game time.</Note>
              <LimitField label="Every (game minutes)" noneLabel="never" value={minds.farRefreshMinutes} min={1} max={525_600} step={60} fallback={MINDS_DEFAULTS.farRefreshMinutes} disabled={busy} onChange={(farRefreshMinutes) => policy({ farRefreshMinutes })} />
            </div>
          </Section>
          <Section title="Memory notes after the reply">
            <div class="lre-minds-body">
              <Note>Which of the characters who heard your message take notes, commitments and plans from the reply.</Note>
              {FIDELITIES.filter((f) => f !== "background").map((level) => (
                <HostSwitch key={level} label={`${FIDELITY_LABEL[level]} characters who heard you`} checked={minds.memoryLevels.includes(level)} disabled={busy} onChange={(on) => policy({ memoryLevels: withMemoryLevel(minds.memoryLevels, level, on) })} />
              ))}
            </div>
          </Section>
          <Section title="What a mind reads">
            <div class="lre-minds-body">
              <Note>Who they are (their own sheet, aims and secrets), where they are and whom they see there, and what they mean to do are always in it. Each source below is yours to switch on or off and to limit; within its limit it comes whole, and nothing else cuts it.</Note>
              <ReadSources reads={minds.reads} memory={minds.memory} knowledge={minds.knowledge} busy={busy} patch={props.patch} />
            </div>
          </Section>
          <Section>
            <Disclosure summary="Advanced: the Minds section budget and time skips">
              <div class="lre-minds-group">
                <span class="lre-minds-group-title">The narrator's Minds section</span>
                <NumberStepper label="Minds section budget (tokens)" value={minds.tokens} min={0} step={100} integer disabled={busy} onChange={(tokens) => policy({ tokens })} />
                <Note>The narrator's Minds section has its own budget, apart from the engine's section budget, so minds never crowd out Scene or People.</Note>
              </div>
              <div class="lre-minds-group">
                <span class="lre-minds-group-title">Time skips</span>
                <LimitField label="Beats a skip may stop at" noneLabel="no limit" value={minds.skip.maxBeats} min={0} max={200} fallback={MINDS_DEFAULTS.skip.maxBeats} disabled={busy} onChange={(maxBeats) => policy({ skip: { maxBeats } })} />
                <LimitField label="Minds at each beat" noneLabel="no limit" value={minds.skip.maxMindsPerBeat} min={0} max={64} fallback={MINDS_DEFAULTS.skip.maxMindsPerBeat} disabled={busy} onChange={(maxMindsPerBeat) => policy({ skip: { maxMindsPerBeat } })} />
              </div>
            </Disclosure>
          </Section>
        </>
      ) : null}
      <KnowledgeSection knowledge={minds.knowledge} busy={busy} patch={props.patch} />
      <Section title="Memory">
        <div class="lre-minds-body">
          <Note>Each world sets how its characters remember (Build → World → Minds); what you set here wins in every world.</Note>
          <Disclosure
            summary={
              <span class="lre-minds-summary">
                <span>Your overrides</span>
                {overrides > 0 ? <Badge tone="accent">{overrides === 1 ? "1 set" : `${overrides} set`}</Badge> : <Badge>None</Badge>}
              </span>
            }
          >
            <div class="lre-minds-overrides">
              {memoryFields.map((field) => (
                <MemoryOverride key={`${field.part}.${field.key}`} field={field} memory={minds.memory} busy={busy} patch={props.patch} />
              ))}
            </div>
          </Disclosure>
        </div>
      </Section>
      <Section title="Prompts" flush>
        <div class="lre-minds-prompts">
          <p class="lre-minds-note lre-minds-prompts-lead">Your prompt wins over the world's own step template for a purpose (Build → Step templates), and that over the built-in.</p>
          {MIND_PURPOSES.map((purpose) => (
            <MindPromptEditor key={purpose} purpose={purpose} value={minds.prompts[purpose]} busy={busy} patch={props.patch} />
          ))}
        </div>
      </Section>
    </div>
  );
}

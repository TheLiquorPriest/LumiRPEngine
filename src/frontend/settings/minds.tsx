// Settings → Minds (DESIGN §24.6): whether characters get minds, how many think a
// turn, what refreshes a Near mind and how often a Far one thinks, which levels write memory notes,
// what a mind reads (each source on or off with its own limit), the Minds section's own budget and a
// time skip's caps (under Advanced), the user's memory overrides of the world's settings (a
// disclosure, as they're long), and the four minds prompts, each beside its built-in default with
// Reset. Every patch is `minds-patch.ts`'s. Styles: styles/minds.ts.

import type { JsonObject } from "../../shared/json";
import type { Limit, MindPurpose, MindSource, MindsReads, MindsSettings } from "../../shared/minds";
import { DEFAULT_MIND_READS, DEFAULT_MINDS_MEMORY, FIDELITIES, MIND_PROMPT_DEFAULTS, MIND_PROMPT_MAX, MIND_PURPOSES, MIND_SOURCES, MINDS_DEFAULTS } from "../../shared/minds";
import { Badge, Button, Disclosure, HostSwitch, NumberStepper, Section } from "../components";
import { PromptEditor } from "./prompt-editor";
import type { MemoryField } from "./minds-patch";
import { MEMORY_FIELDS, memoryOverride, memoryOverridePatch, memoryValue, mindsPolicyPatch, mindsPromptPatch, mindsReadPatch, withMemoryLevel } from "./minds-patch";
import { STEP_LABEL } from "../../shared/steps";
import { FIDELITY_LABEL } from "../../packs/minds/ui/ops";

const PROMPT_NOTE: Record<MindPurpose, string> = {
  mind: "One call per character, as that character: what they think, how they come across, what they mean to do.",
  memory: "After the reply, per character who heard your message, at the levels you pick: the notes, commitments and plans they take from it.",
  skip: "Before a time skip: further moments in it worth stopping at.",
  consolidate: "Folds a character's faded and surplus notes into their summary.",
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
};

/** Where each source is listed: the story as it stands, the chat as the player sees it, what they usually do, or their own memory and life. */
type ReadGroup = "story" | "chat" | "usual" | "own";
const READ_GROUP: Readonly<Record<MindSource, ReadGroup>> = { pinned: "story", activated: "story", reply: "story", message: "story", history: "chat", summary: "own", memory: "own", thoughts: "own", recall: "own", routine: "usual", plans: "usual", life: "own" };

const GROUP_TITLE: Record<ReadGroup, string> = { story: "The story as it stands", chat: "The chat as you see it", usual: "What they usually do and mean to do", own: "Their own memory and life" };

/** Each group's note; the story as it stands needs none. */
const GROUP_NOTE: Record<ReadGroup, string | null> = {
  story: null,
  chat: "Off unless you turn it on: it tells a mind of turns its character wasn't there for.",
  usual: "On unless you turn them off: their routine as context, and the plans the story made for them, so they can keep to their days and to what they agreed without the planner deciding for them.",
  own: "Off unless you turn them on: each can carry what the story never set up, like a day the planner filled with meals and friends, or a plan their memory took from narration that showed another character's mind.",
};

/** What a mind reads: every source in its group, each its own row. */
export function ReadSources(props: { reads: MindsReads; memory: MindsSettings["memory"]; busy: boolean; patch(patch: JsonObject): void }) {
  return (
    <>
      {(["story", "chat", "usual", "own"] as const).map((group) => {
        const note = GROUP_NOTE[group];
        return (
          <div key={group} class="lre-minds-group">
            <span class="lre-minds-group-title">{GROUP_TITLE[group]}</span>
            {note ? <Note>{note}</Note> : null}
            {MIND_SOURCES.filter((s) => READ_GROUP[s] === group).map((source) => (
              <ReadRow key={source} source={source} reads={props.reads} memory={props.memory} busy={props.busy} patch={props.patch} />
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

/** One source of what a mind reads: its switch and, while it's on, its limit (recall's is its memory override; the recent chat has a messages limit too). */
export function ReadRow(props: { source: MindSource; reads: MindsReads; memory: MindsSettings["memory"]; busy: boolean; patch(patch: JsonObject): void }) {
  const { source, reads, busy } = props;
  const on = reads[source].on;
  const recall = MEMORY_FIELDS.find((f) => f.part === "recall" && f.key === "tokens");
  return (
    <div class="lre-minds-override" data-lre-minds-read={source}>
      <HostSwitch label={READ_LABEL[source]} checked={on} disabled={busy} onChange={(next) => props.patch(mindsReadPatch(source, { on: next }))} />
      {!on ? null : source === "recall" ? (
        recall ? <MemoryOverride field={recall} memory={props.memory} busy={busy} patch={props.patch} /> : null
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
          <Note>Picking a Model use preset sets everything here but what a mind reads, your prompts and memory overrides; changing any of the rest makes it Custom.</Note>
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
              <ReadSources reads={minds.reads} memory={minds.memory} busy={busy} patch={props.patch} />
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

// Play → Now's live view of the prepared start, inside its card (`lre.prepareLive`; the backend's
// `story/prepare-live.ts`): where it stands, who is at work on it, how far it has come, what it has
// taken and cost, and what happened. A compact form, a line and a bar, opens into the whole, which
// lays out in two columns where the card is wide; open or closed is kept for the chat on this device.
// Long lists scroll in their own box, grouped with their counts, so nothing is cut. It asks again
// every few seconds (Settings → Story → Preparing) while a run of it is at work, and stops once none
// is; the card's own state changing asks once more. Every line is worded here from what the backend
// read, and says plainly where an older file keeps nothing to show.

import { useEffect, useState } from "preact/hooks";
import type { PrepareLive as Live, PrepareLiveView, PreparePrincipalLine, PrepareRunLine, PrepareRunState, PrepareStage, PrepareStageState, PrepareStretchLine, PrepareStretchState, PrepareTrailEntry } from "../../shared/prepare-live";
import type { PrepareState as CardState, StoryNames } from "../../shared/story-pages";
import { useApp } from "../app";
import { Badge, Button, Disclosure, List, ListRow, Meter, Stat } from "../components";
import { HARNESS_MODE } from "../harness/mode";
import { Icon, type IconName } from "../icons";
import { useSelect } from "../store";
import { pageStore, type RecentStore } from "../things/play-where";
import { andList, DEPTH_WORDS, nameIn, STORY_AGENTS, tokensText } from "./model";

// ---------------------------------------------------------------- words

/** Each stage, as the view names it. */
export const STAGE_WORDS: Readonly<Record<PrepareStage, string>> = {
  reading: "Reading the story",
  planning: "Planning",
  waiting: "Waiting for your word",
  reliving: "Reliving",
  filling: "Filling in the rest",
  scene: "Setting the scene",
  ready: "Ready",
};

const STAGE_ICON: Readonly<Record<PrepareStageState, IconName>> = { done: "check", now: "hourglass", ahead: "clock", skipped: "minus" };

/** How a run stands, on its badge. */
const RUN_STATE_WORDS: Readonly<Record<PrepareRunState, { word: string; tone: "accent" | "warn" | "neg" | "neutral" }>> = {
  queued: { word: "Waiting", tone: "neutral" },
  running: { word: "At work", tone: "accent" },
  paused: { word: "Held", tone: "warn" },
  failed: { word: "Failed", tone: "neg" },
  interrupted: { word: "Cut off", tone: "neg" },
  spent: { word: "Out of budget", tone: "warn" },
  off_path: { word: "Stopped", tone: "neg" },
  cancelled: { word: "Cancelled", tone: "neutral" },
};

/** Why a run stopped, where LumiAH gave no reason of its own. */
const STOPPED_WORDS: Readonly<Partial<Record<PrepareRunState, string>>> = {
  failed: "It failed.",
  interrupted: "A restart cut it off.",
  spent: "It used all it may spend.",
  off_path: "The reply it worked for is gone.",
};

/** What the author does at each stage, on its line. */
const AUTHOR_DOING: Readonly<Record<PrepareStage, string>> = {
  reading: "Reading the story so far",
  planning: "Revising the plan with what you said",
  waiting: "Waiting for your word",
  reliving: "Opening stretches and starting who relives them",
  filling: "Writing outlines and profiles",
  scene: "Setting the scene",
  ready: "Closing the preparation",
};

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** A length of time in words: "under a minute", "12 min", "1 h 5 min", "2 days 3 h". */
export function spanText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? plural(days, "day", "days") : `${plural(days, "day", "days")} ${hours % 24} h`;
}

/** When something happened: the time today, else the day and the time. */
export function clockText(at: number, now: number): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return when.toDateString() === new Date(now).toDateString() ? time : `${when.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time}`;
}

/** Who a run is, by name. */
function whoText(r: { role?: PrepareRunLine["role"]; who?: string | null; agent?: string }, names: StoryNames): string {
  if (r.role === "author") return "The author";
  if (r.role === "historian") return "The historian";
  if (r.role === "principal" && r.who) return nameIn(names, r.who);
  return STORY_AGENTS.find((a) => a.id === r.agent)?.label ?? r.agent ?? "An agent";
}

const messagesText = (s: Pick<PrepareStretchLine, "from" | "to">): string => `messages ${s.from} to ${s.to}`;

/** A stretch's line: which messages, and how far it has come. */
export function stretchWords(s: PrepareStretchLine, names: StoryNames): string {
  const head = `${s.id}${s.key ? " (a key moment)" : ""}, ${messagesText(s)}`;
  const beats = plural(s.beats, "beat", "beats");
  const who = (ids: readonly string[]): string => andList(ids.map((id) => nameIn(names, id)));
  switch (s.state) {
    case "waiting":
      return `${head}: not opened yet${s.relivers.length > 0 ? `, for ${who(s.relivers)}` : ""}.`;
    case "reading":
      return `${head}: the historian records it, ${beats} so far${s.through !== null ? `, through #${s.through}` : ""}.`;
    case "reliving": {
      const through = s.relived ?? [];
      const left = s.relivers.filter((p) => !through.includes(p));
      return `${head}: ${beats}. Being relived by ${who(left)}; ${through.length} of ${s.relivers.length} through.`;
    }
    case "done":
      return `${head}: ${beats}. ${s.relivers.length === 0 ? "It reached none of the principals." : `Relived by ${who(s.relivers)}.`}`;
    case "recorded":
      return `${head}: ${beats}. This file doesn't say who has relived it.`;
    case "left":
      return `${head}: left out at the depth chosen, so not relived.`;
    case "dropped":
      return `${head}: dropped, filled from summaries instead.`;
  }
}

/** The stretches by how far they have come, those under way first; only the states some stretch is in. */
const GROUPS: readonly { state: PrepareStretchState; label: string }[] = [
  { state: "reading", label: "Being read" },
  { state: "reliving", label: "Being relived" },
  { state: "waiting", label: "Waiting" },
  { state: "recorded", label: "Recorded" },
  { state: "done", label: "Done" },
  { state: "left", label: "Left out" },
  { state: "dropped", label: "Dropped" },
];

export function stretchGroups(stretches: readonly PrepareStretchLine[]): { state: PrepareStretchState; label: string; stretches: PrepareStretchLine[] }[] {
  return GROUPS.map((g) => ({ ...g, stretches: stretches.filter((s) => s.state === g.state) })).filter((g) => g.stretches.length > 0);
}

/** A principal's line: the stretches they relived of those they relive, and whether their outline and profile are written. */
export function principalWords(p: PreparePrincipalLine): string {
  const relived = p.relived === null ? `${plural(p.planned, "stretch", "stretches")} to relive; this file doesn't say how many are relived` : `${p.relived} of ${plural(p.planned, "stretch", "stretches")} relived`;
  const outline = p.outline === null ? null : p.outline ? "outline written" : "no outline yet";
  return [relived, outline, p.profile ? "profile written" : "no profile yet"].filter((part): part is string => part !== null).join(" · ");
}

/** What a stopped run's player can do about it: the author's is carried on from the card; anyone else's is started again or granted more on LumiAH's Jobs page. */
function fixWords(r: PrepareRunLine): string {
  const day = r.state === "spent" && r.stoppedAt === "day";
  if (r.role === "author") return day ? "It goes on once the day's spending limit allows it: Carry on then." : "Carry on starts it again from its file.";
  if (day) return "It goes on once the day's spending limit allows it: in the Harness tab, Agents, then Jobs.";
  if (r.state === "spent") return "Grant it more in the Harness tab: Agents, then Jobs.";
  return "Start it again in the Harness tab: Agents, then Jobs.";
}

/** A run's line: who, what they do and on which stretch, since when, what it has used, and, where it stopped before its work was done, why and what can be done. */
export function runWords(r: PrepareRunLine, live: Pick<Live, "stage" | "stretches" | "names">, now: number): { title: string; doing: string; when: string; used: string; problem: string | null } {
  const stretch = r.stretch !== null ? (live.stretches.find((s) => s.id === r.stretch) ?? null) : null;
  const doing =
    r.role === "author"
      ? AUTHOR_DOING[live.stage]
      : r.role === "historian"
        ? stretch !== null
          ? `Recording ${stretch.id}, ${messagesText(stretch)}: ${plural(stretch.beats, "beat", "beats")} so far`
          : "Recording a stretch"
        : r.role === "principal"
          ? stretch !== null
            ? `Reliving ${stretch.id}, ${messagesText(stretch)}`
            : "Reliving what reached them"
          : "At work for the preparation";
  const inside = r.inside !== null ? ", inside the author's run" : "";
  const when =
    r.state === "running"
      ? r.since !== null
        ? `For ${spanText(now - r.since)}${inside}`
        : `At work${inside}`
      : r.state === "queued"
        ? `Waiting for its place since ${clockText(r.since ?? now, now)}`
        : r.state === "paused"
          ? `Held${inside}`
          : `Stopped at ${clockText(r.endedAt ?? r.since ?? now, now)}`;
  const used = r.used === null ? "Its use is counted in the author's run" : `${tokensText(r.used.tokens)} in ${plural(r.used.calls, "call", "calls")}`;
  const stopped = r.state === "failed" || r.state === "interrupted" || r.state === "spent" || r.state === "off_path";
  return { title: whoText(r, live.names), doing, when, used, problem: stopped ? `${r.reason ?? STOPPED_WORDS[r.state] ?? ""} ${fixWords(r)}`.trim() : null };
}

/** A line of the trail, in words. */
export function trailWords(e: PrepareTrailEntry, names: StoryNames): string {
  const name = e.who !== undefined ? nameIn(names, e.who) : "";
  const s = e.stretch ?? "a stretch";
  const run = whoText(e, names);
  const stretches = e.count != null ? `: ${plural(e.count, "stretch", "stretches")}` : "";
  switch (e.what) {
    case "planned":
      return `The author wrote the plan${stretches}.`;
    case "revised":
      return `The author revised the plan${stretches}.`;
    case "said":
      return `You told the author: "${e.text ?? ""}"`;
    case "answered":
      return `The author answered: "${e.text ?? ""}"`;
    case "approved":
      return "You approved the plan.";
    case "depth":
      return e.count != null ? `You chose how deep it goes, reckoned at ${tokensText(e.count)}.` : "You chose how deep it goes.";
    case "cap":
      return e.count != null ? `You capped what it may spend at ${tokensText(e.count)}.` : "You took the cap off.";
    case "opened":
      return `${s} opened for the historian.`;
    case "recorded":
      return e.count != null ? `${s} recorded: ${plural(e.count, "beat", "beats")}.` : `${s} recorded.`;
    case "dropped":
      return `${s} dropped: filled from summaries instead.`;
    case "relived":
      return `${name} relived ${s}.`;
    case "outlined":
      return `${name}'s outline written.`;
    case "profiled":
      return `${name}'s profile written.`;
    case "paused":
      return "Paused.";
    case "resumed":
      return "Carried on.";
    case "cancelled":
      return "Cancelled.";
    case "carried":
      return e.text ? `A run ended, and the next started by itself: ${e.text}` : "A run ended, and the next started by itself.";
    case "stopped":
      // The stop's own words are whole sentences that say what stopped it.
      return e.text ?? "It stopped.";
    case "reopened":
      return "Opened again.";
    case "finished":
      return "The preparation finished.";
    case "run_started":
      return `${run}'s run began.`;
    case "run_ended":
      return `${run}'s run ended.`;
    case "run_stopped":
      return e.text ? `${run}'s run stopped: ${e.text}` : `${run}'s run stopped.`;
    case "run_cancelled":
      return `${run}'s run was cancelled.`;
    case "run_again":
      return `${run}'s run was started again.`;
  }
}

/** The compact form's line: what the stage it is at is doing now, or why nothing moves. */
export function nowLine(live: Live): string {
  switch (live.going) {
    case "done":
      return "Prepared. The first reply starts from it.";
    case "held":
      return "Held. Nothing moves until you carry it on.";
    case "waiting":
      return "The plan waits for your word: go ahead with it, tell the author what to change, or cap it.";
    case "stopped":
      return "Nothing is running now. Carry on goes on from where it stopped.";
    case "queued":
      return "A run waits for its place, then it goes on.";
    case "running":
      break;
  }
  switch (live.stage) {
    case "reading":
      return "The author is reading the story so far, and writes the plan once it has read enough.";
    case "planning":
      return "The author is revising the plan with what you said.";
    case "waiting":
      return "The plan waits for your word.";
    case "reliving": {
      const read = live.stretches.find((s) => s.state === "reading");
      const relived = live.stretches.filter((s) => s.state === "reliving");
      const parts: string[] = [];
      if (read) parts.push(`The historian records ${read.id}, ${messagesText(read)}.`);
      const first = relived[0];
      if (first) {
        const left = first.relivers.filter((p) => !(first.relived ?? []).includes(p));
        parts.push(`${andList(left.map((id) => nameIn(live.names, id)))} ${left.length === 1 ? "relives" : "relive"} ${first.id}${relived.length > 1 ? `, with ${plural(relived.length - 1, "more stretch", "more stretches")} being relived` : ""}.`);
      }
      const next = live.stretches.find((s) => s.state === "waiting");
      if (parts.length === 0) parts.push(next ? `Next: ${next.id}, ${messagesText(next)}.` : "The principals take in what was recorded.");
      return parts.join(" ");
    }
    case "filling": {
      const all = live.principals.length;
      const profiles = live.principals.filter((p) => p.profile).length;
      if (live.kind === "new") return `The author writes each principal's profile: ${profiles} of ${all} written.`;
      return `The author writes what each principal knows: ${live.principals.filter((p) => p.outline === true).length} of ${all} outlines and ${profiles} of ${all} profiles written.`;
    }
    case "scene":
      return live.scene && live.notebook ? "The author is closing the preparation." : "The author sets the scene and writes its notebook.";
    case "ready":
      return "Prepared.";
  }
}

/** The compact form's bar: stretches recorded of those planned; with none, stages done. */
export function progressOf(live: Live): { label: string; value: number; max: number } {
  const planned = live.stretches.filter((s) => s.state !== "dropped" && s.state !== "left");
  if (planned.length > 0) {
    const recorded = planned.filter((s) => s.state === "reliving" || s.state === "done" || s.state === "recorded").length;
    return { label: `${recorded} of ${plural(planned.length, "stretch", "stretches")} recorded`, value: recorded, max: planned.length };
  }
  const stages = live.stages.filter((s) => s.state !== "skipped");
  const done = stages.filter((s) => s.state === "done").length;
  return { label: `${done} of ${plural(stages.length, "stage", "stages")} done`, value: done, max: stages.length };
}

/** Why a stage isn't needed, beside it. */
function skippedWords(id: PrepareStage, live: Live): string {
  if (id === "waiting") return "not needed: within your ceiling";
  if (id === "reliving") return live.kind === "new" ? "nothing to relive in a new story" : live.depth?.chosen === "outline" ? "outlines only, as chosen" : "the plan relives nothing";
  return "not needed";
}

/** Who is at work, where no one is. */
const NO_ONE: Readonly<Record<Live["going"], string>> = {
  running: "No run is at work.",
  queued: "A run waits for its place.",
  held: "No one is at work: it is held.",
  waiting: "No one is at work: the plan waits for your word.",
  stopped: "No one is at work: nothing is running.",
  done: "No one is at work: it is done.",
};

// ---------------------------------------------------------------- asking

/** How long until the view asks again, in ms: its `every` while a run of the preparation is at work; never once none is. */
export function nextAsk(view: PrepareLiveView | null): number | null {
  return view !== null && view.live ? view.every * 1000 : null;
}

/** What the view's asking runs on: the ask, a timer, and where an answer goes. */
export interface WatchIo {
  ask(): Promise<PrepareLiveView | null>;
  later(ms: number, then: () => void): () => void;
  show(view: PrepareLiveView): void;
}

/** Asks for the view now, and again while it says a run is at work; an ask that failed is made again at the last answer's pace. The function it returns stops it. */
export function watchPreparation(io: WatchIo): () => void {
  let last: PrepareLiveView | null = null;
  let cancel: (() => void) | null = null;
  let stopped = false;
  const round = async (): Promise<void> => {
    const view = await io.ask();
    if (stopped) return;
    if (view !== null) {
      last = view;
      io.show(view);
    }
    const wait = nextAsk(last);
    if (wait !== null) cancel = io.later(wait, () => void round());
  };
  void round();
  return () => {
    stopped = true;
    cancel?.();
  };
}

/** Where open or closed is kept for a chat, on this device. */
const OPEN_KEY = "lre:prepare-live:";

// ---------------------------------------------------------------- the view

/** The live view, drawn from what the backend read (`view`) at `now` on its clock, open or compact as the player left it. */
export function PrepareLiveBody(props: { view: PrepareLiveView; now: number; open: boolean; onToggle(open: boolean): void; onWatch(): void }) {
  const live = props.view.prep;
  if (live === null) return null;
  const { now } = props;
  const bar = progressOf(live);
  return (
    <section class="lre-prep-live" data-lre-prep-live={live.stage} data-lre-going={live.going} aria-label="The preparation as it runs">
      <p class="lre-prep-live-now">
        <strong>{STAGE_WORDS[live.stage]}.</strong> {nowLine(live)}
      </p>
      <Meter label={bar.label} value={bar.value} max={bar.max} tone={live.going === "done" ? "pos" : "accent"} />
      <Disclosure summary="The whole preparation" open={props.open} onToggle={props.onToggle}>
        <div class="lre-prep-live-whole">
          <div class="lre-prep-live-col">
            {stagesBlock(live)}
            {runsBlock(live, now, props.onWatch)}
            {costBlock(live, now)}
          </div>
          <div class="lre-prep-live-col">
            {progressBlock(live, now)}
            {trailBlock(live, now)}
          </div>
        </div>
      </Disclosure>
    </section>
  );
}

function stagesBlock(live: Live) {
  return (
    <div class="lre-prep-live-block" data-lre-live="stages">
      <h4>Where it stands</h4>
      <ol class="lre-prep-live-stages">
        {live.stages.map((s) => (
          <li key={s.id} data-lre-stage={s.id} data-state={s.state} aria-current={s.state === "now" ? "step" : undefined}>
            <Icon name={STAGE_ICON[s.state]} size={16} />
            <span class="lre-prep-live-stage">{STAGE_WORDS[s.id]}</span>
            <span class="lre-prep-live-stage-state">{s.state === "done" ? "done" : s.state === "now" ? "now" : s.state === "ahead" ? "to come" : skippedWords(s.id, live)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function runsBlock(live: Live, now: number, onWatch: () => void) {
  return (
    <div class="lre-prep-live-block" data-lre-live="runs">
      <h4>Who is at work</h4>
      {live.runs.length === 0 ? (
        <p class="lre-story-note">{NO_ONE[live.going]}</p>
      ) : (
        <List>
          {live.runs.map((r) => {
            const words = runWords(r, live, now);
            const badge = RUN_STATE_WORDS[r.state];
            return (
              <ListRow
                key={`${r.role}:${r.id}`}
                row={`run:${r.role}:${r.id}`}
                title={words.title}
                subtitle={
                  <>
                    <span class="lre-prep-live-run-line">{`${words.doing}. ${words.when}.`}</span>
                    <span class="lre-prep-live-run-line">{words.used}.</span>
                    {words.problem !== null ? <span class="lre-prep-live-run-line lre-story-problem">{words.problem}</span> : null}
                  </>
                }
                badge={<Badge tone={badge.tone}>{badge.word}</Badge>}
              />
            );
          })}
        </List>
      )}
      {live.going === "running" || live.going === "queued" ? (
        <div class="lre-prep-live-actions">
          <Button size="sm" icon={HARNESS_MODE.icon} onClick={onWatch}>
            Watch it work
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function progressBlock(live: Live, now: number) {
  const groups = stretchGroups(live.stretches);
  return (
    <div class="lre-prep-live-block" data-lre-live="progress">
      <h4>How far along</h4>
      {live.depth !== null ? <p class="lre-story-note">{`Depth: ${DEPTH_WORDS[live.depth.chosen].label}, ${live.depth.picked ? "as you chose" : "as the author recommends"}.${live.stretches.some((s) => s.state === "left") ? ` ${plural(live.stretches.filter((s) => s.state === "left").length, "stretch is", "stretches are")} left out at it.` : ""}`}</p> : null}
      {groups.length === 0 ? (
        <p class="lre-story-note">{live.stage === "reading" ? "The plan isn't written yet." : "The plan relives no stretch of the chat."}</p>
      ) : (
        <div class="lre-prep-live-scroll" role="region" aria-label="Stretches" tabIndex={0}>
          {groups.map((g) => (
            <Disclosure key={g.state} summary={`${g.label} (${g.stretches.length})`} defaultOpen={g.state === "reading" || g.state === "reliving"}>
              <ul class="lre-prep-live-list">
                {g.stretches.map((s) => (
                  <li key={s.id} data-lre-stretch={s.state}>
                    {stretchWords(s, live.names)}
                  </li>
                ))}
              </ul>
            </Disclosure>
          ))}
        </div>
      )}
      {!live.reach ? <p class="lre-story-note">This preparation's file is older: it doesn't say whom each stretch reached or who has relived it.</p> : live.relivedAt !== null ? <p class="lre-story-note">{`Who has relived what is as last checked at ${clockText(live.relivedAt, now)}.`}</p> : null}
      {live.principals.length > 0 ? (
        <List>
          {live.principals.map((p) => (
            <ListRow key={p.id} row={`principal:${p.id}`} title={nameIn(live.names, p.id)} subtitle={principalWords(p)} badge={p.atWork ? <Badge tone="accent">Reliving now</Badge> : undefined} />
          ))}
        </List>
      ) : null}
      {live.messages !== null ? (
        <>
          <div class="lre-prep-live-figures">
            <Stat label="Relived" value={live.messages.relived.toLocaleString("en-US")} />
            <Stat label="Filled from summaries" value={live.messages.filled.toLocaleString("en-US")} />
            <Stat label="Neither" value={live.messages.neither.toLocaleString("en-US")} sub="Not relived so far, and in no summary" />
          </div>
          <p class="lre-story-note">{`Of the chat's ${plural(live.messages.total, "message", "messages")} when the plan was written.`}</p>
        </>
      ) : live.stage !== "reading" ? (
        <p class="lre-story-note">This preparation's file is older: it doesn't keep the chat's count, so how much is relived or filled from summaries can't be shown.</p>
      ) : null}
    </div>
  );
}

function costBlock(live: Live, now: number) {
  const max = live.cap ?? live.estimate ?? Math.max(live.spent, 1);
  const label = live.cap !== null ? `Spent ${tokensText(live.spent)} of your ${tokensText(live.cap)} cap` : live.estimate !== null ? `Spent ${tokensText(live.spent)} of ${tokensText(live.estimate)} reckoned` : `Spent ${tokensText(live.spent)}`;
  const tone = live.cap !== null && live.spent >= live.cap ? "neg" : live.estimate !== null && live.spent > live.estimate ? "warn" : "accent";
  return (
    <div class="lre-prep-live-block" data-lre-live="cost">
      <h4>Time and cost</h4>
      <div class="lre-prep-live-figures">
        {live.startedAt !== null ? <Stat label="Started" value={clockText(live.startedAt, now)} sub={live.endedAt !== null ? `Took ${spanText(live.endedAt - live.startedAt)}` : `${spanText(now - live.startedAt)} ago`} /> : null}
        {live.endedAt !== null ? <Stat label="Finished" value={clockText(live.endedAt, now)} /> : null}
        <Stat label="At work" value={spanText(live.workedMs)} sub="The author's runs, less the time held" />
      </div>
      <Meter label={label} value={live.spent} max={max} tone={tone} />
      <p class="lre-story-note">{live.estimate !== null ? `Reckoned at ${tokensText(live.estimate)} in all, the author's own work included. ${live.cap !== null ? `Your cap is ${tokensText(live.cap)}.` : "No cap."}` : "No plan yet, so nothing is reckoned."}</p>
      {live.left !== null ? <p class="lre-prep-live-left">{`Rough time left: about ${spanText(live.left.ms)} for the ${plural(live.left.stretches, "stretch", "stretches")} not done yet, at the pace so far. The closing work comes after.`}</p> : null}
    </div>
  );
}

function trailBlock(live: Live, now: number) {
  return (
    <div class="lre-prep-live-block" data-lre-live="trail">
      <h4>What happened</h4>
      {!live.logged ? <p class="lre-story-note">This preparation's file is older and keeps no trail of its own: only its runs show here.</p> : null}
      {live.trail.length === 0 ? (
        <p class="lre-story-note">Nothing yet.</p>
      ) : (
        <div class="lre-prep-live-scroll" role="region" aria-label="What happened" tabIndex={0}>
          <ol class="lre-prep-live-trail">
            {live.trail.map((e, i) => (
              <li key={`${e.at}:${i}`} data-lre-trail={e.what}>
                <time dateTime={new Date(e.at).toISOString()}>{clockText(e.at, now)}</time>
                <span>{trailWords(e, live.names)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** The live view in the card: asks while the preparation runs, again whenever the card's state (`state`) changes, and keeps open or closed for the chat (`store`: this device's, as standard). */
export function PrepareLive(props: { state: CardState; store?: RecentStore }) {
  const app = useApp();
  const store = props.store ?? pageStore;
  const chatId = useSelect(app.sync, (s) => s.chatId);
  const [got, setGot] = useState<{ view: PrepareLiveView; skew: number } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setGot(null);
    setOpen(chatId !== null && store.get(`${OPEN_KEY}${chatId}`) === "open");
  }, [chatId]);
  useEffect(() => {
    if (chatId === null) return;
    return watchPreparation({
      ask: async () => {
        const answer = await app.send({ type: "lre.prepareLive", chatId });
        return answer.type === "lre.result" && answer.request === "lre.prepareLive" ? answer.body : null;
      },
      later: (ms, then) => {
        const timer = setTimeout(then, ms);
        return () => clearTimeout(timer);
      },
      // How far the backend's clock is from this page's, so how long something has run reads true.
      show: (view) => setGot({ view, skew: view.at - Date.now() }),
    });
  }, [chatId, props.state]);
  if (chatId === null || got === null) return null;
  const toggle = (next: boolean): void => {
    setOpen(next);
    store.set(`${OPEN_KEY}${chatId}`, next ? "open" : "closed");
  };
  return <PrepareLiveBody view={got.view} now={Date.now() + got.skew} open={open} onToggle={toggle} onWatch={() => app.ui.update((ui) => ({ ...ui, mode: HARNESS_MODE.id, harness: { page: "agents" } }))} />;
}

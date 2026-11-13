// Settings → Story (DEPTH2-PLAN §1.7, §1.12, §5): the story engine's dials, for every chat the
// harness plays. The page holds a row for each page of its own, then the story record's limits.
// - Models: where each agent runs and how hard it thinks: by default, by agent, by how it was
//   started, by a character's kind of run, and per character. The most specific choice wins, each
//   member apart; anything not set falls through to the next. The connections offered are the
//   runtime's own, as LumiAH lists them for the runtime that plays the open chat
//   (`story/connections.ts`); a choice saved on one the runtime doesn't have (one of Lumiverse's,
//   from before the runtime kept its own) is marked, with what its agents run on instead. Under the
//   default, one line says what an agent with no connection runs on: the runtime's default. While
//   the runtime keeps no connection, the page says so first, with the way to Harness → System →
//   Runtime → Connections.
// - Narration: who checks a passage before it is released, how often it may be drafted again,
//   what the narrator is given, how long a passage and a check's changes may be, what the author
//   may release in its own words, and whose the direct line's answer is (`settings.narration`).
//   Its row on the Story page says what is set.
// - Budget: how many T1, T2 and T3 treatments any stretch of story time allows, and what the open
//   chat has used around its time now (`lre.story budget`). T4 is never counted.
// - Minds: how long each file of a mind may be, and the player's character's mind.
// - Preparing: the prepared start's dials.
// Every setting is `story` in the settings (`StorySettings`), Narration's `narration`
// (`NarrationSettings`): a number or a pick sends its own
// field, Default and Clear send null so the store reads the default back. Hook-free but the pages
// that read the open chat (Budget's use, Models' names for characters) and LumiAH's list (Models).

import { useEffect, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { DirectLinePassage, MindFileId, NarrationCheck, NarrationNumber, NarrationSettings, StoryLimits, StoryModels, StoryPrepare, StorySettings } from "../../shared/settings";
import { AGENT_STANDINGS, CHARACTER_RUNS, MIND_FILE_IDS, NARRATION_BOUNDS, NARRATION_CHECKS, NARRATION_DEFAULTS, NARRATION_LABELS, PREPARE_LABELS, STORY_BOUNDS, STORY_DEFAULTS, STORY_LIMIT_LABELS } from "../../shared/settings";
import type { BudgetUseView, StoryNames } from "../../shared/story-pages";
import type { StateView } from "../../shared/state-view";
import type { SettingsRoute } from "../app";
import { useApp } from "../app";
import { Banner, Button, Disclosure, Empty, HostSwitch, List, NumberStepper, Section, Seg, Stat } from "../components";
import type { IconName } from "../icons";
import { MIND_FILE_LABEL } from "../story/files";
import { type AgentConnections, NO_CONNECTION, notTheRuntimes, notTheRuntimesMark, useAgentConnections, useOpenConnections } from "../story/connections";
import { ModelPickRows, pickText } from "../story/model-pick";
import { nameIn, picksAny, RUN_WORDS, STANDING_RUN_WORDS, STORY_AGENTS, STRETCH_CHOICES, stretchText, TIER_WORDS } from "../story/model";
import { NavRow, SettingRow } from "./kit";

/** The pages of its own Settings → Story opens. */
export const STORY_SUBS = ["models", "narration", "budget", "minds", "preparing"] as const;
export type StorySub = (typeof STORY_SUBS)[number];

export const STORY_SUB: Readonly<Record<StorySub, { title: string; subtitle: string; icon: IconName }>> = {
  models: { title: "Models", subtitle: "Where each agent runs, and how hard it thinks", icon: "sliders" },
  narration: { title: "Narration", subtitle: "Who checks each passage, and what the narrator is given", icon: "message" },
  budget: { title: "Budget", subtitle: "How many treatments a stretch of story time allows", icon: "hourglass" },
  minds: { title: "Minds", subtitle: "How long each mind's file may be, and your character's mind", icon: "sparkle" },
  preparing: { title: "Preparing", subtitle: "How the prepared start plans and what it may spend", icon: "scroll" },
};

/** Who checks a passage, in the page's words: the choice, and what the Story page's row says of it. */
const CHECK_WORDS: Readonly<Record<NarrationCheck, { label: string; summary: string }>> = {
  gm: { label: "Game master", summary: "The game master checks" },
  author: { label: "Author", summary: "The author checks" },
  none: { label: "No one", summary: "No check: released as drafted" },
};

/** Whose the direct line's answer is, in the page's words, in the order offered. */
const DIRECT_LINE_WORDS: Readonly<Record<DirectLinePassage, string>> = { own: "Their own", narrated: "The narrator's" };

/** Each number of the narration, in the page's words; its label is `NARRATION_LABELS`', which its refusals name too. */
const NARRATION_WORDS: Readonly<Record<NarrationNumber, { help: string; unit: string; step: number }>> = {
  revisions: { help: "How many times the narrator may draft a passage again when the check finds a fault. Each revision is one more draft and one more check.", unit: "revisions", step: 1 },
  changes: { help: "The most changes one check may ask of a draft.", unit: "changes", step: 1 },
  changeChars: { help: "How long each change a check asks for may be.", unit: "characters", step: 50 },
  replyChars: { help: "How much of the end of the reply so far the narrator is given, so the next passage carries on from it. 0: none.", unit: "characters", step: 250 },
  recentChars: { help: "How much of the chat's prose before this turn the narrator is given, to keep its voice. 0: none.", unit: "characters", step: 500 },
  passageChars: { help: "The longest passage the narrator may draft at once.", unit: "characters", step: 500 },
  ownChars: { help: "How much the author may release in its own words with no check, such as a line for an extra or an answer out of character. 0: nothing.", unit: "characters", step: 100 },
};

/** The Story page's row for Narration: who checks, and how many revisions where someone does. */
export function narrationSummary(n: NarrationSettings): string {
  return n.check === "none" ? CHECK_WORDS.none.summary : `${CHECK_WORDS[n.check].summary} · ${n.revisions} ${n.revisions === 1 ? "revision" : "revisions"}`;
}

/** How many of the narration's settings differ from their defaults. */
export function narrationChanged(n: NarrationSettings): number {
  return (Object.keys(NARRATION_DEFAULTS) as (keyof NarrationSettings)[]).filter((key) => n[key] !== NARRATION_DEFAULTS[key]).length;
}

/** Each limit of the story record, in the page's words; its label is `STORY_LIMIT_LABELS`', which its refusals name too. */
const LIMIT_WORDS: Readonly<Record<keyof StoryLimits, { help: string; unit: string }>> = {
  beatChars: { help: "What a beat says happened, what anyone there could tell of it, and what someone got of it.", unit: "characters" },
  quoteChars: { help: "Each quote of words spoken in a beat.", unit: "characters" },
  quotes: { help: "How many quotes one beat holds.", unit: "quotes" },
  people: { help: "People one beat is addressed to or reached, or one draft names.", unit: "people" },
  beatsPerTurn: { help: "Beats one turn's record holds, with what its jobs write after the reply.", unit: "beats" },
  draftChars: { help: "What a draft kept for later says, and its notes.", unit: "characters" },
  draftsPerTurn: { help: "Drafts one turn's record opens, with its jobs'.", unit: "drafts" },
  whyChars: { help: "Why someone is cast as they are, or why a beat is struck.", unit: "characters" },
  beatsRead: { help: "Beats the author or the game master reads of the record at once.", unit: "beats" },
  feedItems: { help: "Beats one character's agent is given of what reached them, at once.", unit: "beats" },
  openingChars: { help: "What the author is told of the moment before it acts: the time, the place, who is there, the last beats and the quests. The oldest beats go first when it is longer.", unit: "characters" },
};

/** Each dial of the prepared start, in the page's words; its label is `PREPARE_LABELS`', which the preparing tools' refusals name too. */
const PREPARE_WORDS: Readonly<Record<keyof StoryPrepare, { label: string; help: string; unit: string; step: number }>> = {
  stretchMessages: { label: PREPARE_LABELS.stretchMessages, help: "The most messages one run of the historian reads. A longer stretch of the chat is planned as several.", unit: "messages", step: 5 },
  askAboveTokens: { label: PREPARE_LABELS.askAboveTokens, help: "A plan reckoned to cost more than this in all, the author's own work included, waits for your word before anything is relived. 0: every plan waits.", unit: "tokens", step: 10_000 },
  reliveAtOnce: { label: PREPARE_LABELS.reliveAtOnce, help: "How many principals may have moments to relive at the same time.", unit: "principals", step: 1 },
  beatsPerStretch: { label: PREPARE_LABELS.beatsPerStretch, help: "The most beats the historian records for one stretch.", unit: "beats", step: 5 },
  readChars: { label: PREPARE_LABELS.readChars, help: "The most of the chat one read of a stretch gives the historian, whole. Larger means fewer reads, so fewer model calls, but each read stays in the historian's prompt and is sent again with every later call. 60,000 characters is about 19,000 tokens. Lower it for a model with a short context; raise it for one with a long context. The historian's prompt stops at its Prompt per call, under Harness → Agents: 160,000 tokens as shipped, for a model that reads 200,000. Set it about 40,000 under what your model reads. At that limit a read is cut to the room left, the historian is told, and it records what it has and ends its run.", unit: "characters", step: 1000 },
  textChars: { label: PREPARE_LABELS.textChars, help: "What the story is, why a stretch or a principal, what is filled from summaries.", unit: "characters", step: 100 },
  callTokens: { label: PREPARE_LABELS.callTokens, help: "Every call of the preparation sends its agent's whole prompt again, so a plan is reckoned at its calls times what one weighs. That weight is measured from the preparation's own calls, or from this chat's last author run; until either is known, it is this.", unit: "tokens", step: 5000 },
  surveyChars: { label: PREPARE_LABELS.surveyChars, help: "The most one answer gives the author, whole, when it surveys the story: the summaries' own text and the lore's, the rest named with how to read it. Larger means fewer answers, so fewer model calls, but each answer stays in the author's prompt and is sent again with every later call. 60,000 characters is about 19,000 tokens. Lower it for a model with a short context; raise it for one with a long context. The author's prompt stops at its Prompt per call, under Harness → Agents: 160,000 tokens as shipped, for a model that reads 200,000. Set it about 40,000 under what your model reads. At that limit an answer is cut to the room left, the author is told, and it writes what it has to its files and ends its run.", unit: "characters", step: 1000 },
  watchSeconds: { label: PREPARE_LABELS.watchSeconds, help: "While a run of the preparation is at work, the view of it on Play → Now asks how it stands this often. It stops asking once nothing runs.", unit: "seconds", step: 1 },
  watchRuns: { label: PREPARE_LABELS.watchRuns, help: "The most of this chat's latest runs the live view reads each time it asks. Each principal relives in runs of their own, so a long preparation starts many: past this many, its oldest runs aren't shown.", unit: "runs", step: 10 },
  runMinutes: { label: PREPARE_LABELS.runMinutes, help: "How long one run of the preparation may work. When a run ends with work left, the next one starts by itself, as long as the plan has your word, nothing waits for you, you haven't paused or cancelled it, and your cap allows. A run has no token limit of its own: your cap holds what the whole preparation spends.", unit: "minutes", step: 5 },
  runRounds: { label: PREPARE_LABELS.runRounds, help: "How many rounds of tool calls one run of the preparation has: the author's and those of the agents it starts, together. Each agent's own limits in LumiAH still stand.", unit: "rounds", step: 10 },
  idleRuns: { label: PREPARE_LABELS.idleRuns, help: "When this many runs it started on its own end in a row without moving the preparation forward, it stops carrying on by itself and says why. Carry on starts it again.", unit: "runs", step: 1 },
};

/** How many of the story's settings differ from their defaults: each level of the ladder set, each number or switch changed. */
export function storyChanged(story: StorySettings): number {
  const d = STORY_DEFAULTS;
  const m = story.models;
  const levels = [m.default, ...Object.values(m.agents), ...Object.values(m.standings), ...Object.values(m.runs), ...Object.values(m.characters)].filter(picksAny).length;
  const numbers = [...(Object.keys(d.limits) as (keyof StoryLimits)[]).map((k) => story.limits[k] !== d.limits[k]), ...(Object.keys(d.prepare) as (keyof StoryPrepare)[]).map((k) => story.prepare[k] !== d.prepare[k]), ...MIND_FILE_IDS.map((k) => story.minds.chars[k] !== d.minds.chars[k]), story.minds.playerMind !== d.minds.playerMind, ...(["stretchMinutes", "t1", "t2", "t3"] as const).map((k) => story.budget[k] !== d.budget[k])];
  return levels + numbers.filter(Boolean).length;
}

/** Settings home's line for the page: the budget, and how many model choices are made. */
export function storySummary(story: StorySettings): string {
  const { budget } = story;
  const m = story.models;
  const picks = [m.default, ...Object.values(m.agents), ...Object.values(m.standings), ...Object.values(m.runs), ...Object.values(m.characters)].filter(picksAny).length;
  return `${budget.t1} T1, ${budget.t2} T2 and ${budget.t3} T3 per ${stretchText(budget.stretchMinutes)} · ${picks === 0 ? "no model choices" : `${picks} model ${picks === 1 ? "choice" : "choices"}`}`;
}

/** One number of the story's settings: its control in its bounds, and while changed its default. */
function NumberRow(props: { id: string; label: string; help: string; unit: string; value: number; standard: number; bounds: readonly [number, number]; step?: number; busy: boolean; set(value: number | null): void }) {
  const changed = props.value !== props.standard;
  return (
    <SettingRow id={props.id} label={props.label} bare changed={changed} help={props.help} reset={{ label: `Reset ${props.label.toLowerCase()} to ${props.standard.toLocaleString("en-US")}`, to: `${props.standard.toLocaleString("en-US")} ${props.unit}`, onClick: () => props.set(null) }} busy={props.busy}>
      <NumberStepper label={`${props.label} (${props.unit})`} value={props.value} min={props.bounds[0]} max={props.bounds[1]} step={props.step ?? 1} integer disabled={props.busy} onChange={(v) => props.set(v)} />
    </SettingRow>
  );
}

/** Settings → Story itself: its pages, then the record's limits. */
export function StoryHub(props: { story: StorySettings; narration: NarrationSettings; busy: boolean; patch(patch: JsonObject): void; go(route: SettingsRoute): void }) {
  const { story, busy } = props;
  const set = (key: keyof StoryLimits, value: number | null) => props.patch({ story: { limits: { [key]: value } } });
  return (
    <div class="lre-stack" data-lre-settings-page="story">
      <p class="lre-set-lead">How the story engine plays a chat on the harness: which models its agents run on, how the reply is told and checked, how much treatment the story gets, how much a mind holds, and how a story is prepared.</p>
      <Section title="Pages" flush>
        <List>
          {STORY_SUBS.map((sub) => (
            <NavRow key={sub} id={sub} icon={STORY_SUB[sub].icon} title={STORY_SUB[sub].title} subtitle={sub === "narration" ? narrationSummary(props.narration) : STORY_SUB[sub].subtitle} changed={sub === "narration" ? narrationChanged(props.narration) : 0} onOpen={() => props.go({ page: "story", sub })} />
          ))}
        </List>
      </Section>
      <Section title="The record's limits">
        <p class="lre-set-note">How much the story record takes at once. A tool asked for more is refused, and the agent says it in fewer words.</p>
        {(Object.keys(LIMIT_WORDS) as (keyof StoryLimits)[]).map((key) => (
          <NumberRow key={key} id={`limit-${key}`} label={STORY_LIMIT_LABELS[key]} help={LIMIT_WORDS[key].help} unit={LIMIT_WORDS[key].unit} value={story.limits[key]} standard={STORY_DEFAULTS.limits[key]} bounds={STORY_BOUNDS.limits[key]} step={LIMIT_WORDS[key].unit === "characters" ? 50 : 1} busy={busy} set={(v) => set(key, v)} />
        ))}
      </Section>
    </div>
  );
}

/** One of Settings → Story's own pages. */
export function StorySubPage(props: { sub: StorySub; story: StorySettings; narration: NarrationSettings; view: StateView | null; busy: boolean; patch(patch: JsonObject): void }) {
  switch (props.sub) {
    case "models":
      return <ModelsPage models={props.story.models} view={props.view} busy={props.busy} patch={props.patch} />;
    case "narration":
      return <NarrationPage narration={props.narration} busy={props.busy} patch={props.patch} />;
    case "budget":
      return <BudgetPage story={props.story} view={props.view} busy={props.busy} patch={props.patch} />;
    case "minds":
      return <MindsPage story={props.story} busy={props.busy} patch={props.patch} />;
    case "preparing":
      return (
        <div class="lre-stack" data-lre-settings-page="story-preparing">
          <p class="lre-set-lead">How the prepared start works: the author reads the chat so far, plans what to relive, and the principals relive it. A chat can be played meanwhile.</p>
          {(Object.keys(PREPARE_WORDS) as (keyof StoryPrepare)[]).map((key) => (
            <NumberRow key={key} id={`prepare-${key}`} label={PREPARE_WORDS[key].label} help={PREPARE_WORDS[key].help} unit={PREPARE_WORDS[key].unit} value={props.story.prepare[key]} standard={STORY_DEFAULTS.prepare[key]} bounds={STORY_BOUNDS.prepare[key]} step={PREPARE_WORDS[key].step} busy={props.busy} set={(v) => props.patch({ story: { prepare: { [key]: v } } })} />
          ))}
        </div>
      );
  }
}

/** Settings → Story → Narration: how a passage of the reply is told, checked and let out (`settings.narration`). Hook-free. */
function NarrationPage(props: { narration: NarrationSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const n = props.narration;
  const d = NARRATION_DEFAULTS;
  const set = (fields: JsonObject) => props.patch({ narration: fields });
  const number = (key: NarrationNumber) => <NumberRow key={key} id={`narration-${key}`} label={NARRATION_LABELS[key]} help={NARRATION_WORDS[key].help} unit={NARRATION_WORDS[key].unit} value={n[key]} standard={d[key]} bounds={NARRATION_BOUNDS[key]} step={NARRATION_WORDS[key].step} busy={props.busy} set={(v) => set({ [key]: v })} />;
  return (
    <div class="lre-stack" data-lre-settings-page="story-narration">
      <p class="lre-set-lead">How the reply is told: who checks each passage against what happened, how often it may be drafted again, and what the narrator is given to write it. Every draft and every check adds to how long a reply takes.</p>
      <Section title="Checking">
        <SettingRow id="narration-check" label="Who checks a passage" changed={n.check !== d.check} help="Who holds each passage to what happened before it is released. The game master is a separate agent, so it is the slowest. The author checks in its own turn. No one: a passage is released as drafted." reset={{ label: `Reset who checks to ${CHECK_WORDS[d.check].label.toLowerCase()}`, to: CHECK_WORDS[d.check].label, onClick: () => set({ check: null }) }} busy={props.busy}>
          <Seg<NarrationCheck> label="Who checks a passage" value={n.check} disabled={props.busy} options={NARRATION_CHECKS.map((c) => ({ value: c, label: CHECK_WORDS[c].label }))} onChange={(check) => set({ check })} />
        </SettingRow>
        {n.check === "none" ? <p class="lre-set-note">With no one checking, the three rows below aren't used.</p> : null}
        {number("revisions")}
        {number("changes")}
        {number("changeChars")}
      </Section>
      <Section title="What the narrator is given">
        {number("replyChars")}
        {number("recentChars")}
        {number("passageChars")}
      </Section>
      <Section title="The author's own words">{number("ownChars")}</Section>
      <Section title="The direct line">
        <SettingRow id="narration-directLine" label="Whose answer it is" changed={n.directLine !== d.directLine} help="When you speak to someone present, their answer is either their own, streamed as they speak, or told afterwards by the narrator." reset={{ label: `Reset whose answer it is to ${DIRECT_LINE_WORDS[d.directLine].toLowerCase()}`, to: DIRECT_LINE_WORDS[d.directLine], onClick: () => set({ directLine: null }) }} busy={props.busy}>
          <Seg<DirectLinePassage> label="Whose answer it is" value={n.directLine} disabled={props.busy} options={(Object.keys(DIRECT_LINE_WORDS) as DirectLinePassage[]).map((v) => ({ value: v, label: DIRECT_LINE_WORDS[v] }))} onChange={(directLine) => set({ directLine })} />
        </SettingRow>
      </Section>
    </div>
  );
}

/** A level's rows folded under its name and what it picks. */
function LevelFold(props: { id: string; title: string; help: string; owner: string; pick: StoryModels["default"] | undefined; fallsTo: string; connections: AgentConnections; busy: boolean; set(fields: JsonObject | null): void }) {
  const named = props.pick ? pickText(props.pick, props.connections) : null;
  const bad = notTheRuntimes(props.pick, props.connections);
  return (
    <div class="lre-set-fold" data-lre-setting={props.id} data-lre-changed={named !== null ? "" : undefined}>
      <Disclosure
        summary={
          <span class="lre-story-level-head">
            <span class="lre-story-level-title">{props.title}</span>
            <span class={bad ? "lre-story-level-value lre-story-problem" : "lre-story-level-value"}>{bad ? `${named ?? ""}: ${notTheRuntimesMark(props.connections)}` : (named ?? `Not set: ${props.fallsTo}`)}</span>
          </span>
        }
      >
        <div class="lre-set-fold-body">
          <p class="lre-set-note">{props.help}</p>
          <ModelPickRows id={props.id} owner={props.owner} pick={props.pick} fallsTo={props.fallsTo} connections={props.connections} busy={props.busy} set={props.set} />
        </div>
      </Disclosure>
    </div>
  );
}

/**
 * What Models says above its levels, without hooks: that the runtime keeps no connection yet (no
 * agent can run, and how to give it one), and how many choices name a connection the runtime
 * doesn't have, with what their agents run on until they are chosen again.
 */
export function modelsNotices(models: StoryModels, connections: AgentConnections): { id: "none" | "not-runtimes"; title: string; text: string }[] {
  const out: { id: "none" | "not-runtimes"; title: string; text: string }[] = [];
  if (connections.none) out.push({ id: "none", title: NO_CONNECTION.title, text: NO_CONNECTION.text });
  const bad = [models.default, ...Object.values(models.agents), ...Object.values(models.standings), ...Object.values(models.runs), ...Object.values(models.characters)].filter((pick) => notTheRuntimes(pick, connections)).length;
  if (bad > 0) {
    const one = bad === 1;
    const until = connections.fallback !== null ? `Until you choose again, ${one ? "its agents run" : "their agents run"} on the runtime's default, ${connections.fallback.name}` : `Until you choose again, ${one ? "its agents'" : "their agents'"} calls are refused, since the runtime has no default connection`;
    out.push({
      id: "not-runtimes",
      title: one ? "A choice names a connection the runtime doesn't have" : `${bad} choices name connections the runtime doesn't have`,
      text: `${one ? "It was" : "They were"} made before the runtime kept connections of its own, or ${one ? "its connection was" : "their connections were"} removed since. ${until}: each is marked below. Copy from Lumiverse, in Harness → System → Runtime → Connections, copies a connection of yours into the runtime under its own id, so a choice of it works again.`,
    });
  }
  return out;
}

/** The model ladder, most general first; the open chat's cast names the characters given choices of their own. */
function ModelsPage(props: { models: StoryModels; view: StateView | null; busy: boolean; patch(patch: JsonObject): void }) {
  const app = useApp();
  const { models, busy } = props;
  const connections = useAgentConnections(props.view?.chatId ?? null);
  const open = useOpenConnections();
  const harness = props.view?.engine === "harness" ? props.view.chatId : null;
  const [names, setNames] = useState<StoryNames>({});
  useEffect(() => {
    if (harness === null) return;
    void app.send({ type: "lre.story", chatId: harness, op: "cast" }).then((m) => {
      if (m.type === "lre.result" && m.request === "lre.story" && m.body.cast) setNames(m.body.cast.names);
    });
  }, [harness]);
  const send = (level: JsonObject) => props.patch({ story: { models: level } });
  const characters = Object.keys(models.characters);
  return (
    <div class="lre-stack" data-lre-settings-page="story-models">
      <p class="lre-set-lead">Where the story's agents run and how hard they think, on the runtime's own connections (Harness → System → Runtime → Connections). The most specific choice wins: a character's own, then the kind of run, then how the agent was started, then the agent, then the default. Anything not set falls through to the next.</p>
      {modelsNotices(models, connections).map((notice) => (
        <div key={notice.id} data-lre-models-notice={notice.id}>
          <Banner
            tone="warn"
            title={notice.title}
            actions={
              open !== null ? (
                <Button size="sm" icon="link" onClick={open}>
                  Open Connections
                </Button>
              ) : undefined
            }
          >
            {notice.text}
          </Banner>
        </div>
      ))}
      <Section title="The default">
        <ModelPickRows id="default" owner="Every agent" pick={models.default} connections={connections} busy={busy} set={(fields) => send({ default: fields })} />
      </Section>
      <Section title="By agent" flush>
        {STORY_AGENTS.map((a) => (
          <LevelFold key={a.id} id={`agent-${a.id}`} title={a.label} help={a.help} owner={a.label} pick={models.agents[a.id]} fallsTo="the default" connections={connections} busy={busy} set={(fields) => send({ agents: { [a.id]: fields } })} />
        ))}
      </Section>
      <Section title="By how it was started" flush>
        {AGENT_STANDINGS.map((s) => (
          <LevelFold key={s} id={`standing-${s}`} title={STANDING_RUN_WORDS[s].label} help={`${STANDING_RUN_WORDS[s].help} Comes before the agent's own choice.`} owner={STANDING_RUN_WORDS[s].label} pick={models.standings[s]} fallsTo="the agent's choice" connections={connections} busy={busy} set={(fields) => send({ standings: { [s]: fields } })} />
        ))}
      </Section>
      <Section title="A character's kind of run" flush>
        {CHARACTER_RUNS.map((r) => (
          <LevelFold key={r} id={`run-${r}`} title={RUN_WORDS[r].label} help={RUN_WORDS[r].help} owner={RUN_WORDS[r].label} pick={models.runs[r]} fallsTo="how it was started" connections={connections} busy={busy} set={(fields) => send({ runs: { [r]: fields } })} />
        ))}
      </Section>
      <Section title="Per character" flush>
        {characters.length === 0 ? (
          <Empty icon="users">No character has a choice of their own. Give a principal one on their page in Harness → Cast.</Empty>
        ) : (
          characters.map((id) => (
            <LevelFold key={id} id={`character-${id}`} title={nameIn(names, id)} help="This character's own choice: it comes before every other." owner={nameIn(names, id)} pick={models.characters[id]} fallsTo="the kind of run" connections={connections} busy={busy} set={(fields) => send({ characters: { [id]: fields } })} />
          ))
        )}
      </Section>
    </div>
  );
}

/** The budget: the stretch, each tier's count, and what the open chat has used around now. */
function BudgetPage(props: { story: StorySettings; view: StateView | null; busy: boolean; patch(patch: JsonObject): void }) {
  const app = useApp();
  const { budget } = props.story;
  const harness = props.view?.engine === "harness" ? props.view.chatId : null;
  const [use, setUse] = useState<BudgetUseView | null>(null);
  useEffect(() => {
    setUse(null);
    if (harness === null) return;
    void app.send({ type: "lre.story", chatId: harness, op: "budget" }).then((m) => {
      if (m.type === "lre.result" && m.request === "lre.story" && m.body.budget) setUse(m.body.budget);
    });
  }, [harness, budget.stretchMinutes]);
  const set = (fields: JsonObject) => props.patch({ story: { budget: fields } });
  const stretches = STRETCH_CHOICES.includes(budget.stretchMinutes) ? STRETCH_CHOICES : [...STRETCH_CHOICES, budget.stretchMinutes].sort((a, b) => a - b);
  return (
    <div class="lre-stack" data-lre-settings-page="story-budget">
      <p class="lre-set-lead">How much treatment the story gets. The author chooses a tier for each event it plays or keeps for later; past your budget it is refused and chooses a lighter one. T4, the author just writing it, is never counted.</p>
      <Section title="In this chat now">
        {harness === null ? (
          <p class="lre-set-note">Open a chat the harness plays to see what its story has used.</p>
        ) : use === null ? (
          <p class="lre-set-note">Reading what this chat's story has used…</p>
        ) : (
          <>
            <p class="lre-set-note">{use.now !== null ? `Within ${stretchText(budget.stretchMinutes)} either side of ${use.now.text}:` : "Around the story's time now:"}</p>
            <div class="lre-story-budget">
              <Stat label="T1" value={`${use.used.t1} of ${budget.t1}`} tone={use.used.t1 >= budget.t1 ? "warn" : undefined} />
              <Stat label="T2" value={`${use.used.t2} of ${budget.t2}`} tone={use.used.t2 >= budget.t2 ? "warn" : undefined} />
              <Stat label="T3" value={`${use.used.t3} of ${budget.t3}`} tone={use.used.t3 >= budget.t3 ? "warn" : undefined} />
            </div>
          </>
        )}
      </Section>
      <Section title="The dial">
        <SettingRow id="stretch" label="A stretch of story time" bare changed={budget.stretchMinutes !== STORY_DEFAULTS.budget.stretchMinutes} help="Any stretch this long holds at most the counts below, wherever it falls." reset={{ label: `Reset the stretch to ${stretchText(STORY_DEFAULTS.budget.stretchMinutes)}`, to: stretchText(STORY_DEFAULTS.budget.stretchMinutes), onClick: () => set({ stretchMinutes: null }) }} busy={props.busy}>
          <label class="lre-field">
            <span class="label">A stretch of story time</span>
            <select class="lre-input" value={String(budget.stretchMinutes)} disabled={props.busy} onChange={(event) => set({ stretchMinutes: Number(event.currentTarget.value) })}>
              {stretches.map((m) => (
                <option key={m} value={String(m)}>
                  {stretchText(m)}
                </option>
              ))}
            </select>
          </label>
        </SettingRow>
        {(["t1", "t2", "t3"] as const).map((tier, i) => (
          <NumberRow key={tier} id={`budget-${tier}`} label={`${TIER_WORDS[(i + 1) as 1 | 2 | 3].short} treatments`} help={TIER_WORDS[(i + 1) as 1 | 2 | 3].long} unit="per stretch" value={budget[tier]} standard={STORY_DEFAULTS.budget[tier]} bounds={STORY_BOUNDS.treatments} busy={props.busy} set={(v) => set({ [tier]: v })} />
        ))}
      </Section>
    </div>
  );
}

/** How long each file of a mind may be, and the player's character's mind. */
function MindsPage(props: { story: StorySettings; busy: boolean; patch(patch: JsonObject): void }) {
  const { minds } = props.story;
  const set = (fields: JsonObject) => props.patch({ story: { minds: fields } });
  return (
    <div class="lre-stack" data-lre-settings-page="story-minds">
      <p class="lre-set-lead">A principal's mind is files they write themselves, in their own voice, from what reached them. Past a file's size they condense it, as memory does.</p>
      <Section title="Your character">
        <SettingRow id="playerMind" label="Your character's mind" bare changed={minds.playerMind !== STORY_DEFAULTS.minds.playerMind} help="While Sovereign Hand is on, your character keeps a mind of their own: your direction says what happens, their mind gives their voice and inner life." reset={{ label: "Reset your character's mind to on", to: "On", onClick: () => set({ playerMind: null }) }} busy={props.busy}>
          <HostSwitch label="Your character has a mind" checked={minds.playerMind} disabled={props.busy} onChange={(on) => set({ playerMind: on })} />
        </SettingRow>
      </Section>
      <Section title="How long each file may be">
        {MIND_FILE_IDS.map((id: MindFileId) => (
          <NumberRow key={id} id={`mind-${id}`} label={MIND_FILE_LABEL[id].title} help={MIND_FILE_LABEL[id].note} unit="characters" value={minds.chars[id]} standard={STORY_DEFAULTS.minds.chars[id]} bounds={STORY_BOUNDS.mindChars} step={500} busy={props.busy} set={(v) => set({ chars: { [id]: v } })} />
        ))}
      </Section>
    </div>
  );
}

// A rule's firings as the log and the tester show them (plan §14 Rules, App. A "ruleFired"): which rule, in which run, on what, what happened
// and what the agent did next. What was matched and what the agent did next can give away what comes, so they show behind the chat's
// spoiler gate; the rule, the moment and what happened do not.

import type { RuleFiring } from "../../../shared/api";
import { Badge } from "../../atoms";
import { when } from "../../words";
import type { FiringShown } from "../../../shared/api";

export const MOMENT_WORDS: Readonly<Record<RuleFiring["moment"], string>> = {
  stream: "while the agent was writing",
  "tool-call": "at a tool call",
  "tool-result": "at a tool's result",
  "after-message": "after a message",
  "run-end": "at a run's end",
  "turn-start": "at a turn's start",
  "before-compaction": "before a compaction",
  interval: "on its turns",
};

export const ACTION_WORDS: Readonly<Record<RuleFiring["action"], string>> = {
  cut: "the call was stopped and its text added",
  remind: "its text was added to a tool's result",
  hold: "the tool was held",
  "follow-up": "another call was given",
  briefing: "its text was put in the next briefing",
  call: "its command was asked",
};

const WATCHED_WORDS: Readonly<Record<NonNullable<RuleFiring["watched"]>, string>> = { text: "the agent's text", thinking: "its thinking", reply: "the reply", arguments: "a tool's arguments", result: "a tool's result" };

/** What the agent did next, in words. */
export function thenWords(then: RuleFiring["then"]): string | null {
  if (then === undefined) return null;
  if (then.did === "called") return `it called ${then.tools.join(", ")}`;
  if (then.did === "wrote") return "it wrote on";
  return then.did === "released" ? "it released the reply" : "its run ended";
}

/** The fact a moment rule tested, with its value then. */
export function factWords(fact: NonNullable<RuleFiring["fact"]>): string {
  const groups = fact.value.by === undefined ? "" : ` (${Object.entries(fact.value.by).map(([name, n]) => `${name} ${n}`).join(", ")})`;
  const names = fact.value.names === undefined || fact.value.names.length === 0 ? "" : `: ${fact.value.names.join(", ")}`;
  return `${fact.name} was ${fact.value.count}${groups}${names}`;
}

export function FiringLine(props: { firing: RuleFiring; placed?: FiringShown; gate: boolean; onRule?: (rule: string) => void; onTurn?: (turn: string) => void }) {
  const f = props.firing;
  const placed = props.placed ?? null;
  const then = thenWords(f.then);
  return (
    <li class="rpe-entry lre-stack" data-firing={placed?.id ?? f.rule}>
      <p class="rpe-line">
        {props.onRule === undefined ? (
          <strong>{f.rule}</strong>
        ) : (
          <button type="button" class="lre-btn ghost small" onClick={() => props.onRule?.(f.rule)}>
            {f.rule}
          </button>
        )}{" "}
        <Badge>{f.level}</Badge> <span class="rpe-meta">{MOMENT_WORDS[f.moment]}{f.watched === undefined ? "" : `, in ${WATCHED_WORDS[f.watched]}`}{f.tool === undefined ? "" : `, of ${f.tool}`}</span>
      </p>
      <p class="rpe-meta">
        {f.agent.definition}
        {placed === null ? "" : ` · ${when(placed.at)}`}
        {placed?.job != null ? ` · in a job's run` : placed?.talk != null ? " · in a talk's run" : ""}
        {placed?.turn != null && props.onTurn !== undefined ? " · " : ""}
        {placed?.turn != null && props.onTurn !== undefined ? (
          <button type="button" class="lre-btn ghost small" onClick={() => props.onTurn?.(placed.turn as string)}>
            its turn
          </button>
        ) : null}
      </p>
      <p class="rpe-line" data-action>{ACTION_WORDS[f.action]}{f.dropped === undefined ? "" : `; ${f.dropped}`}</p>
      {!props.gate ? (
        <p class="lre-muted rpe-meta" data-hidden>What it matched and what the agent did next are behind the spoiler gate.</p>
      ) : (
        <div class="lre-stack" data-gated>
          {f.matched === undefined ? null : <p class="rpe-pre" data-matched>{f.matched}</p>}
          {f.fact === undefined ? null : <p class="rpe-meta" data-fact>{factWords(f.fact)}</p>}
          {then === null ? null : <p class="rpe-meta" data-then>Then {then}.</p>}
        </div>
      )}
    </li>
  );
}

// What a turn was told and what it checked, as the Turn page lists it: each gap check with what was
// searched for and what came back, each consent with its scope and bounds, each rule that fired with what it
// fired on, what it added and what the agent did next, the attachments it was given, and what was dropped.

import type { ConsentGrant, GapCheck, RuleFiring, TurnReply } from "../../../shared/api";
import { Badge } from "../../../frontend/components";
import { valueWords } from "./changes";

type Told = TurnReply["told"];

/** An agent as the page names it: its definition, and whom it plays. */
function agentWords(agent: { definition: string; plays?: string }): string {
  return agent.plays === undefined ? agent.definition : `${agent.definition} (playing ${agent.plays})`;
}

/** One gap check: who made it, its topic and terms, each place searched with what came back and how (by words or by meaning), and the consents that rest on it. */
export function GapCheckBox(props: { check: GapCheck; consents: readonly ConsentGrant[] }) {
  const { check } = props;
  const empty = check.searched.every((place) => place.hits.length === 0);
  const resting = props.consents.filter((c) => c.gapCheck === check.id);
  return (
    <li class="rpe-entry" data-gap-check={check.id}>
      <p class="rpe-line">
        <span class="rpe-strong">{check.topic}</span> <span class="rpe-meta">by {agentWords(check.by)}</span> {empty ? <Badge tone="warn">found nothing</Badge> : null}
      </p>
      <p class="rpe-meta">Searched for: {check.terms.length === 0 ? "no terms" : check.terms.join(", ")}</p>
      {check.searched.map((place) => (
        <div key={place.where} class="lre-stack" data-searched={place.where}>
          <span class="rpe-caption">{place.where}</span>
          {place.hits.length === 0 ? (
            <p class="rpe-meta">Nothing came back.</p>
          ) : (
            <ul class="rpe-reports">
              {place.hits.map((hit, i) => (
                <li key={i}>
                  {hit.title} <span class="rpe-meta">({hit.ref}, by {hit.how})</span>: {hit.snippet}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {check.saved === undefined ? null : <p class="rpe-meta">Saved as {check.saved}.</p>}
      {resting.length === 0 ? null : <p class="rpe-meta">An invention rests on it: {resting.map((c) => c.topic).join("; ")}.</p>}
    </li>
  );
}

/** One consent: whose, to whom, what it covers and within what bounds, how it was given, and the gap check it rests on. */
export function ConsentBox(props: { consent: ConsentGrant; checks: readonly GapCheck[] }) {
  const { consent } = props;
  const check = consent.gapCheck === undefined ? undefined : props.checks.find((c) => c.id === consent.gapCheck);
  return (
    <li class="rpe-entry" data-consent={consent.id}>
      <p class="rpe-line">
        <span class="rpe-strong">{consent.topic}</span> <span class="rpe-meta">given by {agentWords(consent.by)}{consent.to === undefined ? "" : ` to ${agentWords(consent.to)}`}</span>
      </p>
      <p class="rpe-meta">
        {consent.bounds === undefined ? "No bounds named." : `Bounds: ${consent.bounds}`} Through {consent.via.kind === "write" ? `its write by ${consent.via.tool}` : "an answer"}.
        {consent.gapCheck === undefined ? " It cites no gap check." : check === undefined ? ` It rests on gap check ${consent.gapCheck}, which this turn does not hold.` : ` It rests on the gap check on ${check.topic}.`}
      </p>
    </li>
  );
}

/** What a rule fired on, in the facts the firing carries. */
function firedOn(firing: RuleFiring): string {
  if (firing.matched !== undefined) return `${firing.watched ?? "text"} matched ${JSON.stringify(firing.matched)}`;
  if (firing.fact !== undefined) return `${firing.fact.name} was ${valueWords(firing.fact.value.count)}`;
  return firing.moment;
}

/** What the agent did next, from the firing's own record. */
function didNext(firing: RuleFiring): string | null {
  const then = firing.then;
  if (then === undefined) return null;
  switch (then.did) {
    case "called":
      return `then called ${then.tools.join(", ")}`;
    case "wrote":
      return "then wrote";
    case "released":
      return "then released the reply";
    case "ended":
      return "then ended";
  }
}

/** One rule that fired: its name and level, the agent and the moment, what it fired on, what it did, what it dropped and what the agent did next. */
export function RuleBox(props: { firing: RuleFiring }) {
  const { firing } = props;
  const next = didNext(firing);
  return (
    <li class="rpe-entry" data-rule={firing.rule}>
      <p class="rpe-line">
        <span class="rpe-strong">{firing.rule}</span> <span class="rpe-meta">({firing.level}, {firing.path})</span> <Badge>{firing.action}</Badge>
      </p>
      <p class="rpe-meta">
        {agentWords(firing.agent)}, at {firing.moment}
        {firing.tool === undefined ? "" : `, on ${firing.tool}`}: fired on {firedOn(firing)}.
        {firing.dropped === undefined ? "" : ` It dropped ${JSON.stringify(firing.dropped)}.`}
        {next === null ? "" : ` The agent ${next}.`}
      </p>
    </li>
  );
}

/** What a turn was told, in lists: its gap checks, its consents, the rules that fired, the attachments its agents were given, and what was dropped. */
export function TurnTold(props: { told: Told }) {
  const { told } = props;
  return (
    <div class="lre-stack" data-told>
      {told.gapChecks.length === 0 ? null : (
        <div class="lre-stack">
          <span class="rpe-caption">Gap checks</span>
          <ul class="rpe-plain lre-stack">
            {told.gapChecks.map(({ check }) => (
              <GapCheckBox key={check.id} check={check} consents={told.consents.map((c) => c.grant)} />
            ))}
          </ul>
        </div>
      )}
      {told.consents.length === 0 ? null : (
        <div class="lre-stack">
          <span class="rpe-caption">Consents</span>
          <ul class="rpe-plain lre-stack">
            {told.consents.map(({ grant }) => (
              <ConsentBox key={grant.id} consent={grant} checks={told.gapChecks.map((c) => c.check)} />
            ))}
          </ul>
        </div>
      )}
      {told.rules.length === 0 ? null : (
        <div class="lre-stack">
          <span class="rpe-caption">Rules that fired</span>
          <ul class="rpe-plain lre-stack">
            {told.rules.map(({ firing, at }) => (
              <RuleBox key={`${firing.rule}-${at}`} firing={firing} />
            ))}
          </ul>
        </div>
      )}
      {told.attachments.length === 0 && told.dropped.length === 0 ? null : (
        <div class="lre-stack">
          <span class="rpe-caption">What it was given with</span>
          <ul class="rpe-reports">
            {told.attachments.map((a, i) => (
              <li key={`a${i}`}>
                {agentWords(a.agent)} was given {valueWords(a.refs)}
              </li>
            ))}
            {told.dropped.map((d, i) => (
              <li key={`d${i}`} data-dropped>
                {agentWords(d.agent)}: what it was given was dropped
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// An organization's Decisions tab (ORG-SPEC Phase 5; DESIGN §29.19-29.20; `r.orgTab` over its
// `orgs.decisions` section): its open motions, each with what it would do, who put it and when it
// closes, how the votes stand against its quorum and pass mark, each voter's vote and how it was
// cast, and the reader's own (For, Against, Abstain, for themselves or an organization holder whose
// shares they manage; Withdraw for whoever put it); the requests for approval waiting (what, the
// limit it is over, who may approve it, until when), with Approve and Deny for those up its
// requester's chain of command and Withdraw for whoever asked; the latest closed and answered; and How decisions are made
// (how votes are counted, the quorum, the pass mark, how long a motion stays open and a request
// waits, the standing votes), with an editor for whoever governs it and one's own standing vote. A
// vote, an approval and a denial play as turns; the rules and a withdrawal are bookkeeping, at once
// with Undo. In GM → Orgs each is the GM's edit of the effect it plays, the GM voting for anyone.

import { useState } from "preact/hooks";
import { useApp } from "../../../frontend/app";
import { Badge, Button, Card, Disclosure, Empty, Field, JsonView, List, ListRow, Row, Section, Seg, useBusy } from "../../../frontend/components";
import type { OrgGmTabProps, OrgTabDef, OrgTabProps } from "../../../frontend/registry";
import type { JsonObject } from "../../../shared/json";
import { DECISION_ACTIONS, DECISION_EFFECTS, DECISION_RANGES, DECISIONS_SECTION, DECISIONS_TAB, pctWords, type Answer, type DecisionsView, type MotionView, type RequestView, type StandingVoteKind, type Vote, type VoteBasis, type VoteHow } from "../../../shared/org-motions";
import type { OrgRef } from "../../../shared/org-view";
import type { EditOp } from "../../../shared/protocol";
import { decodeDecisions } from "./decode";

const STATUS_TONE: Readonly<Record<MotionView["status"], "neutral" | "accent" | "pos" | "neg">> = { open: "accent", passed: "pos", failed: "neg", withdrawn: "neutral" };
const STATE_TONE: Readonly<Record<RequestView["state"], "neutral" | "accent" | "pos" | "neg" | "warn">> = { asked: "accent", approved: "pos", denied: "neg", withdrawn: "neutral", lapsed: "warn" };
const HOW_WORDS: Readonly<Record<VoteHow, string>> = { own: "", rule: "by standing vote", story: "as the story told it", gm: "by the GM" };
const VOTE_LABELS: Readonly<Record<Vote, string>> = { for: "For", against: "Against", abstain: "Abstain" };
const VOTE_OPTIONS = (["for", "against", "abstain"] as const).map((v) => ({ value: v, label: VOTE_LABELS[v] }));

/** One change the tab makes: the reader's action (`action`, `params`), which GM → Orgs plays as its effect with no actor. */
export interface DecisionChange {
  action: string;
  params: JsonObject;
  effect: string;
  /** The effect's own arguments, the GM's: `who` named where the action takes `self`. */
  gm: JsonObject;
}

/** A vote on a motion: by the reader for themselves or as an organization holder (`as`); the GM's for the voter. */
export function voteChange(org: string, m: MotionView, voter: string, vote: Vote, as?: string): DecisionChange {
  return { action: DECISION_ACTIONS.vote, params: { org, motion: m.id, vote, ...(as !== undefined ? { as } : {}) }, effect: DECISION_EFFECTS.vote, gm: { org, motion: m.id, vote, who: voter } };
}

/** A motion withdrawn by whoever put it, or (the GM's alone) closed now on the votes cast. */
export function endChange(org: string, m: MotionView, how: "withdraw" | "close"): DecisionChange {
  return { action: DECISION_ACTIONS.end, params: { org, motion: m.id }, effect: DECISION_EFFECTS.end, gm: { org, motion: m.id, how } };
}

/** An answer to a request: approve, deny (with why), or withdraw (the requester's deny). */
export function answerChange(org: string, r: RequestView, answer: Answer, why = ""): DecisionChange {
  const words = why.trim();
  return { action: answer === "approve" ? DECISION_ACTIONS.approve : DECISION_ACTIONS.deny, params: { org, request: r.id, ...(words !== "" ? { why: words } : {}) }, effect: DECISION_EFFECTS.answer, gm: { org, request: r.id, answer, ...(words !== "" ? { why: words } : {}) } };
}

/** The rules as their editor holds them: each number as typed (empty: the default). */
export interface RulesDraft {
  basis: VoteBasis;
  quorum: string;
  pass: string;
  days: string;
  approvalDays: string;
}

export function rulesDraft(view: DecisionsView): RulesDraft {
  return { basis: view.rules.basis, quorum: String(view.rules.quorum), pass: String(view.rules.pass), days: String(view.rules.days), approvalDays: String(view.rules.approvalDays) };
}

/** Why the rules as typed can't be saved, in words; null when they can. */
export function rulesProblem(d: RulesDraft): string | null {
  const bad = (text: string, [lo, hi]: readonly [number, number]): boolean => text.trim() !== "" && !(Number.isFinite(Number(text)) && Number(text) >= lo && Number(text) <= hi);
  if (bad(d.quorum, DECISION_RANGES.quorum)) return "Quorum: a percentage from 0 to 100.";
  if (bad(d.pass, DECISION_RANGES.pass)) return "Passes with more than: a percentage from 0 to 99.9.";
  if (bad(d.days, DECISION_RANGES.days) || bad(d.approvalDays, DECISION_RANGES.days)) return "Days: a whole number from 1 to 365.";
  return null;
}

/** The rules saved: what changed from the view, an empty number putting its default back. */
export function rulesChange(org: string, view: DecisionsView, d: RulesDraft): DecisionChange | null {
  const params: JsonObject = {};
  if (d.basis !== view.rules.basis) params.vote_by = d.basis;
  const numbers: [keyof RulesDraft, string, number][] = [
    ["quorum", "quorum", view.rules.quorum],
    ["pass", "pass", view.rules.pass],
    ["days", "days", view.rules.days],
    ["approvalDays", "approval_days", view.rules.approvalDays],
  ];
  for (const [key, arg, was] of numbers) {
    const text = String(d[key]).trim();
    if (text === "") params[arg] = "default";
    else if (Number(text) !== was) params[arg] = Number(text);
  }
  return Object.keys(params).length === 0 ? null : { action: DECISION_ACTIONS.rules, params: { org, ...params }, effect: DECISION_EFFECTS.rules, gm: { org, ...params } };
}

/** One's own standing vote; the GM's for whoever it names. */
export function standingChange(org: string, who: string, vote: StandingVoteKind | "none", follows = ""): DecisionChange {
  const params: JsonObject = { org, vote, ...(vote === "with" && follows !== "" ? { with: follows } : {}) };
  return { action: DECISION_ACTIONS.standing, params, effect: DECISION_EFFECTS.standing, gm: { ...params, who } };
}

/** A change as GM → Orgs sends it: one GM edit of the effect it plays. */
export function decisionOps(change: DecisionChange): EditOp[] {
  return [{ op: "effect", effect: change.effect, args: change.gm }];
}

// ---------------------------------------------------------------- the board

export interface DecisionsBoardProps {
  org: { id: string; name: string };
  view: DecisionsView;
  busy: boolean;
  /** GM → Orgs: every voter's vote is the GM's to set, a motion's to close, a request's to answer. */
  gm: boolean;
  onChange(change: DecisionChange, done?: () => void): void;
}

function tallyLine(m: MotionView): string {
  const t = m.tally;
  return [`For ${pctWords(t.for)}`, `Against ${pctWords(t.against)}`, `Abstain ${pctWords(t.abstain)}`, ...(t.remaining > 0.0001 ? [`Not yet ${pctWords(t.remaining)}`] : [])].join(" · ");
}

/** A motion: what it would do, how it stands, its voters, and the reader's (or the GM's) controls. */
export function MotionCard(props: DecisionsBoardProps & { motion: MotionView }) {
  const { motion: m, org } = props;
  const open = m.status === "open";
  return (
    <Card title={m.text} aside={<Badge tone={STATUS_TONE[m.status]}>{open ? "Open" : m.status === "passed" ? "Carried" : m.status === "failed" ? "Failed" : "Withdrawn"}</Badge>}>
      <div class="lre-stack" data-lre-motion={m.id}>
        <Row k="Put by" v={m.by?.name ?? "the GM"} />
        <Row k={open ? "Closes" : "Closed"} v={open ? m.closesText : (m.why ?? "")} />
        <Row k="Votes" v={tallyLine(m)} sub={`Counted by ${m.basis === "members" ? "members, one each" : "shares"}; needs ${pctWords(m.quorum)} to take part and more than ${pctWords(m.pass)} of the votes cast for it${m.public > 0 ? `; the outside public's ${pctWords(m.public)} counts as abstaining` : ""}.`} />
        <List>
          {m.voters.map((v) => (
            <ListRow key={v.who.id} title={v.who.name} subtitle={v.how !== null && HOW_WORDS[v.how] !== "" ? HOW_WORDS[v.how] : undefined} value={`${pctWords(v.weight)} · ${v.vote !== null ? VOTE_LABELS[v.vote] : "Not yet"}`} />
          ))}
        </List>
        {open && !props.gm
          ? m.cast.map((c) => (
              <Field key={c.voter} label={c.as !== undefined ? `Vote as ${c.name}` : "Your vote"} help="Your vote plays as your next turn.">
                <Seg label={c.as !== undefined ? `Vote as ${c.name}` : "Your vote"} value={c.vote} options={VOTE_OPTIONS} disabled={props.busy} onChange={(vote) => props.onChange(voteChange(org.id, m, c.voter, vote, c.as))} />
              </Field>
            ))
          : null}
        {open && props.gm
          ? m.voters.map((v) => (
              <Field key={v.who.id} label={`${v.who.name}'s vote`}>
                <Seg label={`${v.who.name}'s vote`} value={v.vote} options={VOTE_OPTIONS} disabled={props.busy} onChange={(vote) => props.onChange(voteChange(org.id, m, v.who.id, vote))} />
              </Field>
            ))
          : null}
        {open && (m.mayWithdraw || props.gm) ? (
          <div class="lre-actions">
            {props.gm ? (
              <Button disabled={props.busy} onClick={() => props.onChange(endChange(org.id, m, "close"))}>
                Close it now
              </Button>
            ) : null}
            <Button variant="ghost" disabled={props.busy} onClick={() => props.onChange(endChange(org.id, m, "withdraw"))}>
              Withdraw
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** A request for approval: what, the limit it is over, who may approve it, and the controls. */
export function RequestCard(props: DecisionsBoardProps & { request: RequestView }) {
  const { request: r, org } = props;
  const [why, setWhy] = useState("");
  const waiting = r.state === "asked";
  const answers = waiting && (r.mayAnswer || props.gm);
  return (
    <Card title={r.text} aside={<Badge tone={STATE_TONE[r.state]}>{r.state === "asked" ? "Waiting" : r.state === "approved" ? "Approved" : r.state === "denied" ? "Denied" : r.state === "lapsed" ? "Lapsed" : "Withdrawn"}</Badge>}>
      <div class="lre-stack" data-lre-request={r.id}>
        <Row k="Asked by" v={r.by.name} sub={r.why} />
        {waiting ? <Row k="May approve" v={r.approvers.length > 0 ? r.approvers.map((a) => a.name).join(", ") : "No one now"} /> : null}
        {waiting ? <Row k="Lapses" v={r.untilText} /> : null}
        {r.answered ? <Row k={r.state === "withdrawn" ? "Withdrawn" : "Answered by"} v={r.answered.by?.name ?? "the GM"} sub={r.answered.why ?? undefined} /> : null}
        {answers ? (
          <>
            <Field label="Why (if you deny it)">
              <input class="lre-input" value={why} maxLength={300} onInput={(event) => setWhy(event.currentTarget.value)} />
            </Field>
            <div class="lre-actions">
              <Button variant="primary" disabled={props.busy || (!props.gm && !r.mayAnswer)} onClick={() => props.onChange(answerChange(org.id, r, "approve"))}>
                Approve
              </Button>
              <Button variant="danger" disabled={props.busy} onClick={() => props.onChange(answerChange(org.id, r, "deny", why), () => setWhy(""))}>
                Deny
              </Button>
            </div>
          </>
        ) : null}
        {waiting && (r.mayWithdraw || props.gm) ? (
          <Button variant="ghost" disabled={props.busy} onClick={() => props.onChange(answerChange(org.id, r, "withdraw"))}>
            Withdraw
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** How decisions are made, and its editor for whoever governs the organization (or the GM). */
export function RulesPart(props: DecisionsBoardProps) {
  const { view, org } = props;
  const [draft, setDraft] = useState<RulesDraft | null>(null);
  const may = props.gm || view.rulesWhy === null;
  const problem = draft ? rulesProblem(draft) : null;
  const standing = (s: DecisionsView["rules"]["standing"][number]): string => (s.vote === "with" ? `With ${s.with?.name ?? "someone"}` : VOTE_LABELS[s.vote as Vote]);
  return (
    <div class="lre-stack" data-lre-decision-rules={org.id}>
      <Row k="Votes are counted by" v={view.rules.basis === "members" ? "Members, one each" : "Shares (each unit its class's votes)"} />
      <Row k="Quorum" v={`${pctWords(view.rules.quorum)} of the votes take part`} />
      <Row k="Passes with" v={`More than ${pctWords(view.rules.pass)} of the votes cast`} />
      <Row k="A motion stays open" v={`${view.rules.days} days`} />
      <Row k="A request waits" v={`${view.rules.approvalDays} days`} />
      {view.rules.standing.length > 0 ? (
        <List>
          {view.rules.standing.map((s) => (
            <ListRow key={s.who.id} title={s.who.name} subtitle="Standing vote" value={standing(s)} />
          ))}
        </List>
      ) : null}
      {may && draft === null ? (
        <Button disabled={props.busy} onClick={() => setDraft(rulesDraft(view))}>
          Change how decisions are made
        </Button>
      ) : null}
      {!may && view.rulesWhy !== null ? <span class="lre-field-help">{view.rulesWhy}</span> : null}
      {draft ? (
        <div class="lre-stack" data-lre-decision-rules-form>
          <Field label="Votes are counted by">
            <Seg label="Votes are counted by" value={draft.basis} options={[{ value: "shares", label: "Shares" }, { value: "members", label: "Members" }]} onChange={(basis) => setDraft({ ...draft, basis })} />
          </Field>
          {(
            [
              ["quorum", "Quorum (% of the votes that take part)"],
              ["pass", "Passes with more than (% of the votes cast)"],
              ["days", "A motion stays open (days)"],
              ["approvalDays", "A request for approval waits (days)"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label} help="Empty: the default.">
              <input class="lre-input" inputMode="decimal" value={draft[key]} onInput={(event) => setDraft({ ...draft, [key]: event.currentTarget.value })} />
            </Field>
          ))}
          {problem !== null ? <span class="lre-field-help">{problem}</span> : null}
          <div class="lre-actions">
            <Button
              variant="primary"
              disabled={props.busy || problem !== null}
              onClick={() => {
                const change = rulesChange(org.id, view, draft);
                if (change === null) setDraft(null);
                else props.onChange(change, () => setDraft(null));
              }}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One's own standing vote: none, for, against, abstain, or with another voter. */
export function StandingPart(props: DecisionsBoardProps & { who: string; people: readonly OrgRef[] }) {
  const mine = props.view.standing ?? null;
  const [vote, setVote] = useState<StandingVoteKind | "none">(mine?.vote ?? "none");
  const [follows, setFollows] = useState<string>(mine?.with ?? "");
  const options: { value: StandingVoteKind | "none"; label: string }[] = [{ value: "none", label: "None" }, ...VOTE_OPTIONS, { value: "with", label: "With…" }];
  return (
    <div class="lre-stack" data-lre-standing-vote>
      <Field label="When you don't vote yourself" help="A standing vote is cast for you as a motion opens, or as the voter you follow votes.">
        <Seg<StandingVoteKind | "none"> label="Standing vote" value={vote} options={options} disabled={props.busy} onChange={(v) => setVote(v)} />
      </Field>
      {vote === "with" ? (
        <Field label="Vote with">
          <select class="lre-input" value={follows} onChange={(event) => setFollows(event.currentTarget.value)}>
            <option value="">Choose someone</option>
            {props.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Button disabled={props.busy || (vote === "with" && follows === "")} onClick={() => props.onChange(standingChange(props.org.id, props.who, vote, follows))}>
        Save your standing vote
      </Button>
    </div>
  );
}

/** The tab's board: open motions, waiting requests, the latest closed, and the rules. */
export function DecisionsBoard(props: DecisionsBoardProps & { reader: string | null }) {
  const { view } = props;
  const people = [...new Map([...view.open, ...view.closed].flatMap((m) => m.voters.map((v) => [v.who.id, v.who] as const))).values()].filter((p) => p.id !== props.reader && !p.id.startsWith("someone_"));
  return (
    <div class="lre-stack" data-lre-org-decisions={props.org.id}>
      <Section title="To a vote">{view.open.length > 0 ? view.open.map((m) => <MotionCard key={m.id} {...props} motion={m} />) : <Empty icon="users">No motion is open. A decision your votes alone can't make is put to a vote from Ownership.</Empty>}</Section>
      {view.waiting.length > 0 ? (
        <Section title="Waiting for approval">
          {view.waiting.map((r) => (
            <RequestCard key={r.id} {...props} request={r} />
          ))}
        </Section>
      ) : null}
      {view.closed.length > 0 || view.answered.length > 0 ? (
        <Disclosure summary="Decided">
          <div class="lre-stack">
            {view.closed.map((m) => (
              <MotionCard key={m.id} {...props} motion={m} />
            ))}
            {view.answered.map((r) => (
              <RequestCard key={r.id} {...props} request={r} />
            ))}
          </div>
        </Disclosure>
      ) : null}
      <Section title="How decisions are made">
        <RulesPart {...props} />
        {view.standing !== undefined && props.reader !== null && !props.gm ? <StandingPart {...props} who={props.reader} people={people} /> : null}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- the tab

/** Play's Decisions: votes, approvals and denials play as the next turn; the rules, one's standing vote and a withdrawal at once, with Undo. */
export function OrgDecisionsTab(props: OrgTabProps) {
  const app = useApp();
  const [busy, run] = useBusy();
  const view = decodeDecisions(props.section);
  if (!view) return <JsonView value={props.section} />;
  const onChange = (change: DecisionChange, done?: () => void): void =>
    run(async () => {
      const result = await app.request({ type: "lre.action", chatId: props.chatId, action: change.action, params: change.params, source: "palette" });
      if (result && "pending" in result && result.pending) app.toast("Saved — it applies when the reply finishes.", "info");
      if (result) done?.();
    });
  return <DecisionsBoard org={props.org} view={view} busy={busy} gm={false} reader={props.org.people.find((p) => p.you)?.id ?? null} onChange={onChange} />;
}

/** GM → Orgs' Decisions: the same board, each change one GM edit of the effect it plays. */
export function GmOrgDecisionsTab(props: OrgGmTabProps) {
  const view = decodeDecisions(props.section);
  if (!view) return <JsonView value={props.section} />;
  return <DecisionsBoard org={props.org} view={view} busy={props.gm.busy} gm={true} reader={null} onChange={(change, done) => void props.gm.edit(decisionOps(change)).then((ok) => ok && done?.())} />;
}

/** The Decisions tab, after Ownership and before Rules (90). */
export const DECISIONS_TAB_DEF: OrgTabDef = { id: DECISIONS_TAB, label: "Decisions", order: 85, section: DECISIONS_SECTION, component: OrgDecisionsTab, gm: GmOrgDecisionsTab };

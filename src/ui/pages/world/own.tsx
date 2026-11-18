// What this chat plays by on its own, on the World page (plan §14): how closely each part of life is worked out, what the Add on a
// panel does when you say you have something the world doesn't, and when a check rolls. Each change is your own edit, from now on
// and over nothing already recorded, with the Undo its answer names; the claims and the check rules can go back to what the
// world says. What a change does and does not do is said where it is made.

import { useState } from "preact/hooks";
import type { OwnAnswer, OwnAsk, OwnValues } from "../../../shared/api";
import { BANDS, DOMAIN_LABEL, DOMAINS, LEVEL_LABEL, type Level } from "../../../shared/ids";
import { BAND_LABEL } from "../../../shared/tiers";
import { type CheckRules, CheckRulesForm } from "../../../frontend/adjudication-form";
import { Banner, Button, Disclosure } from "../../../frontend/components";
import { ClaimsControl } from "../../../frontend/claims-control";
import { useApp } from "../../app";
import { useRead } from "../../reading";
import { errorWords } from "../../words";
import { readOwn, sendOwn, sendUndo } from "./read";
import { RulesPress } from "./rules";

const LEVELS: readonly Level[] = [0, 1, 2, 3, 4];

/** What a chat that plays a world reads as. */
type Played = Extract<OwnValues, { world: true }>;

const PRESET_WORDS: Readonly<Record<Played["realism"]["preset"], string>> = { story: "the Story preset", grounded: "the Grounded preset", simulation: "the Simulation preset", custom: "a mix of your own" };

/** The ask a change of the check rules' controls comes to. */
function checksAsk(patch: Partial<CheckRules>): OwnAsk {
  return {
    kind: "checks",
    ...(patch.checks === undefined ? {} : { when: patch.checks }),
    ...(patch.riskyAt === undefined ? {} : { riskyAt: patch.riskyAt }),
    ...(patch.trivialAt === undefined ? {} : { trivialAt: patch.trivialAt }),
    ...(patch.impossibleAt === undefined ? {} : { impossibleAt: patch.impossibleAt }),
    ...(patch.retry === undefined ? {} : { retry: patch.retry }),
    ...(patch.retryAfter === undefined ? {} : { retryAfter: patch.retryAfter }),
  };
}

function Levels(props: { values: Played["realism"]; disabled: boolean; onAsk(ask: OwnAsk): void }) {
  const { values } = props;
  return (
    <div class="lre-stack" data-own="levels">
      <h4 class="rpe-caption">How closely life is worked out</h4>
      <p class="rpe-meta">
        Each part of life has a level, from Off to Simulation. From now on RPE works out and shows that much of it for everyone in this chat. Nothing already recorded changes: every value stays as it is. A part you set lower stops working out detail, and setting it back doesn't fill in what it skipped meanwhile.
      </p>
      <p class="rpe-meta" data-own="preset">{`These levels are ${PRESET_WORDS[values.preset]}.`}</p>
      <div class="lre-form-levels">
        {DOMAINS.map((domain) => {
          const floor = values.floors[domain] ?? 0;
          return (
            <label key={domain} class="lre-form-level">
              <span>
                {DOMAIN_LABEL[domain]}
                {floor > 0 ? <span class="lre-form-optional">{` · at least ${floor}, as this world's ruleset needs`}</span> : null}
              </span>
              <select class="lre-input" value={String(values.levels[domain] ?? 0)} disabled={props.disabled} onChange={(event) => props.onAsk({ kind: "level", domain, to: Number(event.currentTarget.value) })}>
                {LEVELS.map((level) => (
                  <option key={level} value={String(level)} disabled={level < floor}>
                    {`${level} · ${LEVEL_LABEL[level]}`}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <Disclosure summary="How deeply each kind of person is worked out">
        <p class="rpe-meta">A cap holds a kind of person to at most that level, whatever the level above says. A dash is no cap.</p>
        <p class="rpe-meta">{BANDS.map((band) => `${BAND_LABEL[band]}: ${values.tiers[band]?.length ? values.tiers[band]?.join(", ") : "no tier of this world"}`).join(" · ")}</p>
        <div class="lre-tier-wrap">
          <div class="lre-tier-grid" role="table" aria-label="Caps for each kind of person" lang="en">
            <div role="row" class="lre-form-contents">
              <span role="columnheader">
                <span class="lre-sr">Part of life</span>
              </span>
              {BANDS.map((band) => (
                <span key={band} class="lre-muted" role="columnheader">
                  {BAND_LABEL[band]}
                </span>
              ))}
            </div>
            {DOMAINS.map((domain) => (
              <div key={domain} role="row" class="lre-form-contents">
                <span role="rowheader">{DOMAIN_LABEL[domain]}</span>
                {BANDS.map((band) => {
                  const cap = values.caps[band]?.[domain] ?? 4;
                  return (
                    <span key={band} role="cell" class="lre-form-contents">
                      <select class="lre-input" aria-label={`${DOMAIN_LABEL[domain]} cap for ${BAND_LABEL[band]}`} value={String(cap)} disabled={props.disabled} onChange={(event) => props.onAsk({ kind: "cap", band, domain, to: Number(event.currentTarget.value) })}>
                        {LEVELS.map((level) => (
                          <option key={level} value={String(level)}>
                            {level === 4 ? "— (no cap)" : String(level)}
                          </option>
                        ))}
                      </select>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Disclosure>
    </div>
  );
}

function Claims(props: { values: Played["claims"]; disabled: boolean; onAsk(ask: OwnAsk): void }) {
  const { mode, capped, own } = props.values;
  return (
    <div class="lre-stack" data-own="claims">
      <h4 class="rpe-caption">When you add something the world doesn't have</h4>
      <p class="rpe-meta">This is what the Add on a panel does when you say you have something this world doesn't. It changes only what you add from now on: what you added before stays.</p>
      <ClaimsControl value={{ mode, capped }} disabled={props.disabled} onChange={(next) => props.onAsk({ kind: "claims", mode: next.mode, capped: next.capped })} />
      <p class="rpe-meta">{own ? "This chat sets this for itself." : "This chat follows its world."}</p>
      {own ? (
        <div class="lre-inline">
          <Button size="sm" variant="ghost" disabled={props.disabled} onClick={() => props.onAsk({ kind: "claims-world" })}>
            Follow the world again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Checks(props: { values: Played["checks"]; disabled: boolean; onAsk(ask: OwnAsk): void }) {
  const { own, ...rules } = props.values;
  return (
    <div class="lre-stack" data-own="checks">
      <h4 class="rpe-caption">How checks are decided</h4>
      <p class="rpe-meta">From now on this decides whether a check rolls, and when a failed try may be tried again. A roll already made stands, with its result.</p>
      <CheckRulesForm value={{ checks: rules.when, riskyAt: rules.riskyAt, trivialAt: rules.trivialAt, impossibleAt: rules.impossibleAt, retry: rules.retry, retryAfter: rules.retryAfter }} disabled={props.disabled} onChange={(patch) => props.onAsk(checksAsk(patch))} />
      <p class="rpe-meta">{own ? "This chat sets this for itself." : "This chat follows its world."}</p>
      {own ? (
        <div class="lre-inline">
          <Button size="sm" variant="ghost" disabled={props.disabled} onClick={() => props.onAsk({ kind: "checks-world" })}>
            Follow the world again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The part of the World page for this chat: what it plays by on its own, each change your own edit with its Undo. */
export function OwnValuesSection(props: { chat: string }) {
  const app = useApp();
  const { chat } = props;
  const read = useRead(() => readOwn(app.client, chat), [chat]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<OwnAnswer | null>(null);
  const settle = (next: Promise<OwnAnswer>): void => {
    setBusy(true);
    setProblem(null);
    next.then(
      (answer) => {
        setBusy(false);
        setDone(answer);
        read.again();
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  const send = (ask: OwnAsk): void => settle(sendOwn(app.client, chat, ask));
  const undo = (): void => {
    if (done?.undo == null) return;
    settle(sendUndo(app.client, chat, done.undo).then((reply) => ({ applied: reply.applied, undo: reply.undo, words: reply.words })));
  };
  const values = read.value;
  return (
    <section class="lre-section" data-section="own">
      <div class="lre-section-head">
        <h3 class="lre-section-title">For this chat</h3>
      </div>
      <div class="lre-section-body lre-stack">
        {values !== null && !values.world ? null : <p class="rpe-meta">What this chat plays by from now on. Each change is your own edit, and Undo takes it back.</p>}
        {read.problem === null ? null : (
          <Banner tone="neg" icon="alert" title="This could not be read">
            <span>{read.problem}</span>
          </Banner>
        )}
        {problem === null ? null : (
          <Banner tone="neg" icon="alert" title="Not recorded">
            <span>{problem}</span>
          </Banner>
        )}
        {done === null ? null : (
          <Banner tone={done.applied ? "info" : "warn"} icon={done.applied ? "check" : "alert"} title={done.applied ? "Recorded as your change" : "Nothing was recorded"} actions={done.undo === null ? undefined : <Button busy={busy} onClick={undo}>Undo</Button>}>
            {done.words === "" ? null : <span>{done.words}</span>}
          </Banner>
        )}
        {values === null ? (
          read.loading ? <p class="lre-muted rpe-line">Reading what this chat plays by…</p> : null
        ) : !values.world ? (
          <p class="rpe-meta" data-own="no-world">This chat plays no world, so there is nothing to set here.</p>
        ) : (
          <>
            <Levels values={values.realism} disabled={busy} onAsk={send} />
            <Claims values={values.claims} disabled={busy} onAsk={send} />
            <Checks values={values.checks} disabled={busy} onAsk={send} />
            <RulesPress chat={chat} disabled={busy} onDone={read.again} />
          </>
        )}
      </div>
    </section>
  );
}

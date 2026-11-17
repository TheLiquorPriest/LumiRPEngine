// The session measurement on the Sessions page (plan §11, §14): what carrying the Author's earlier work between turns costs and buys, mode by
// mode, so he chooses the default himself. The test-bed script plays one fixed scene in each of the three modes and sends its report to RPE
// (`POST /api/v1/sessions/measurements`); every report is kept, and this shows the latest whole with the earlier ones beside it: when it ran and
// on what, each mode's tokens, time and calls (totals and medians, then turn by turn), each planted decision with its check and the judge's
// answer, the look-ups and the repeated ones, and the recommendation of whoever ran it. The mode in force is shown beside them, and a mode becomes
// the default only on his press, at the level he picks (every chat, or this chat): a report's arrival never changes it.

import { useState } from "preact/hooks";
import type { CarryMode, MeasureDecision, MeasureFigures, MeasureMode, MeasurementReport } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Disclosure, Empty, Pre, Row, Section } from "../../../frontend/components";
import { usePaged, useRead } from "../../reading";
import { useUiSetting } from "../../ui-settings";
import { counted, duration, errorWords, LEVEL_WORDS, num, when } from "../../words";
import { CARRY_MODES, CARRY_WORDS } from "./carry";

/** The figures a mode's block shows, in the order shown, each with what it is counted in. */
const FIGURES: readonly { key: keyof MeasureFigures; name: string; show(value: number): string }[] = [
  { key: "tokensIn", name: "Tokens in", show: num },
  { key: "tokensOut", name: "Tokens out", show: num },
  { key: "cached", name: "Tokens cached", show: num },
  { key: "replyMs", name: "Time to the reply's end", show: duration },
  { key: "runMs", name: "Time to the run's end", show: duration },
  { key: "calls", name: "Model calls", show: num },
];

/** How many of a mode's planted decisions the judge found honoured. */
export function honouredOf(decisions: readonly MeasureDecision[]): number {
  return decisions.filter((d) => d.honoured).length;
}

function DecisionLine(props: { decision: MeasureDecision }) {
  const { decision } = props;
  return (
    <Disclosure
      summary={
        <>
          {decision.name} <Badge tone={decision.honoured ? "pos" : "neg"}>{decision.honoured ? "honoured" : "not honoured"}</Badge>
        </>
      }
    >
      <div class="lre-stack" data-decision>
        <p class="rpe-meta">
          Planted in turn {decision.planted}, tested in turn {decision.tested}.
        </p>
        <Row k="The check" v={decision.check} />
        <Row k="The judge's answer" v={decision.answer} />
        <Pre text={decision.evidence} mono={false} />
      </div>
    </Disclosure>
  );
}

/** One mode's figures as a block of its own: its totals and medians, its planted decisions, its look-ups, and the turn by turn behind them. */
export function ModeBlock(props: { mode: MeasureMode; inForce: boolean }) {
  const { mode } = props;
  const words = CARRY_WORDS[mode.mode];
  return (
    <div class="lre-stack rpe-measure-mode" data-measure-mode={mode.mode}>
      <h3 class="rpe-measure-title">
        {words.name}
        {props.inForce ? <Badge tone="accent">in force</Badge> : null}
      </h3>
      <p class="rpe-meta">{words.about}.</p>
      <div class="lre-stack" data-measure-figures>
        {FIGURES.map((f) => (
          <Row key={f.key} k={f.name} v={<span class="lre-num">{f.show(mode.totals[f.key])}</span>} sub={<span class="lre-num">median per turn {f.show(mode.medians[f.key])}</span>} />
        ))}
      </div>
      <p class="rpe-line" data-measure-decisions>
        Planted decisions honoured: {honouredOf(mode.decisions)} of {mode.decisions.length}
      </p>
      {mode.decisions.map((d) => (
        <DecisionLine key={`${d.name}:${d.tested}`} decision={d} />
      ))}
      <p class="rpe-line" data-measure-lookups>
        Look-ups: {num(mode.lookups.total)}, {num(mode.lookups.repeated.length)} repeated
      </p>
      {mode.lookups.repeated.length === 0 ? null : (
        <ul class="rpe-measure-repeats">
          {mode.lookups.repeated.map((r, i) => (
            <li key={`${r.tool}:${r.args}:${i}`} class="rpe-meta">
              {r.tool} {r.args}: turn {r.turn} made it again after turn {r.first}.
            </li>
          ))}
        </ul>
      )}
      <Disclosure summary={`Turn by turn, ${counted(mode.turns.length, "turn")}`}>
        <div class="rpe-measure-turns">
          <table class="rpe-measure-table">
            <thead>
              <tr>
                <th scope="col">Turn</th>
                {FIGURES.map((f) => (
                  <th key={f.key} scope="col">
                    {f.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mode.turns.map((t) => (
                <tr key={t.n}>
                  <th scope="row">{t.n}</th>
                  {FIGURES.map((f) => (
                    <td key={f.key} class="lre-num">
                      {f.show(t.figures[f.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </div>
  );
}

/** A report whole: when it ran and on what, its three modes, and its recommendation (or that it waits for one). */
export function ReportView(props: { report: MeasurementReport; at: number; inForce: CarryMode }) {
  const { report } = props;
  const recommended = report.recommendation.trim() !== "";
  return (
    <div class="lre-stack" data-measure-report>
      <p class="rpe-meta" data-measure-ran>
        Ran {when(report.ran)} on {report.model} through {report.connection}; judged by {report.judge.model} through {report.judge.connection}. The script's hash is {report.script}. Received {when(props.at)}.
      </p>
      <div class="rpe-measure-modes">
        {report.modes.map((m) => (
          <ModeBlock key={m.mode} mode={m} inForce={m.mode === props.inForce} />
        ))}
      </div>
      <Section id="recommendation" title="Its recommendation">
        {recommended ? (
          <Pre text={report.recommendation} mono={false} />
        ) : (
          <p class="lre-muted rpe-line" data-waiting-recommendation>
            The recommendation of whoever ran it is not written yet. This report is kept and waits for it.
          </p>
        )}
      </Section>
    </div>
  );
}

type Level = "global" | "chat";

/** The measurement, with or without a chat open: the latest report, the earlier ones, the mode in force and his press to change it. */
export function MeasurementSection(props: { chat: string | null }) {
  const app = useApp();
  const { chat } = props;
  const perPage = useUiSetting("rowsAtOnce");
  const list = usePaged((cursor) => app.client.call("GET /api/v1/sessions/measurements", {}, { query: { limit: perPage, ...(cursor === undefined ? {} : { cursor }) } }), []);
  const [picked, setPicked] = useState<string | null>(null);
  const shownId = picked ?? list.items[0]?.id ?? null;
  const report = useRead(shownId === null ? null : () => app.client.call("GET /api/v1/sessions/measurements/:id", { id: shownId }), [shownId]);
  const settings = useRead(() => app.client.call("GET /api/v1/settings", {}, { query: chat === null ? {} : { chat } }), [chat]);
  const carry = settings.value?.settings.find((s) => s.key === "carry");
  const inForce: CarryMode = carry?.value === "records" || carry?.value === "nothing" ? carry.value : "continuing";
  const [level, setLevel] = useState<Level>("global");
  const [busy, setBusy] = useState<CarryMode | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const atLevel: Level = chat === null ? "global" : level;
  const makeDefault = (mode: CarryMode): void => {
    if (busy !== null) return;
    setBusy(mode);
    setProblem(null);
    app.client.call("PUT /api/v1/settings", {}, { body: { level: atLevel, ...(atLevel === "chat" ? { chat } : {}), key: "carry", value: mode } }).then(
      () => {
        setBusy(null);
        setSaid(`${CARRY_WORDS[mode].name} is now the default ${atLevel === "chat" ? "for this chat" : "for every chat"}.`);
        settings.again();
      },
      (error: unknown) => {
        setBusy(null);
        setSaid(null);
        setProblem(errorWords(error));
      },
    );
  };
  const none = list.items.length === 0 && !list.loading && list.problem === null;
  return (
    <Section id="measurement" title="What carrying costs and buys">
      <div class="lre-stack rpe-measure" data-measurement>
        <p class="rpe-meta" data-carry-in-force>
          In force now: {CARRY_WORDS[inForce].name}
          {carry?.from == null ? ", the shipped default" : `, set at ${LEVEL_WORDS[carry.from].toLowerCase()} level`}. The default changes only when you press it below; a report that arrives changes nothing.
        </p>
        {list.problem === null ? null : <p class="rpe-line" data-measurement-problem>{list.problem}</p>}
        {settings.problem === null ? null : <p class="rpe-line">{settings.problem}</p>}
        {said === null ? null : (
          <Banner tone="info" icon="check" title="Done">
            <span data-said>{said}</span>
          </Banner>
        )}
        {problem === null ? null : (
          <Banner tone="neg" icon="alert" title="Not done">
            <span>{problem}</span>
          </Banner>
        )}
        {none ? (
          <Empty icon="sliders" title="The measurement has not been run">
            <span data-no-report>RPE has no report of it. The test-bed script runs it (`scripts/testbed/sessions.ts`) and sends its report here.</span>
          </Empty>
        ) : null}
        {report.problem === null ? null : <p class="rpe-line">{report.problem}</p>}
        {report.value === null ? (
          list.loading || report.loading ? <p class="lre-muted rpe-line">Reading the report…</p> : null
        ) : (
          <>
            <div class="lre-inline rpe-wrap" data-measure-default>
              <span class="rpe-meta">Make a mode the default for</span>
              <Button size="sm" variant="ghost" current={atLevel === "global"} onClick={() => setLevel("global")}>
                Every chat
              </Button>
              {chat === null ? null : (
                <Button size="sm" variant="ghost" current={atLevel === "chat"} onClick={() => setLevel("chat")}>
                  This chat
                </Button>
              )}
              {CARRY_MODES.map((m) => (
                <Button key={m} size="sm" busy={busy === m} disabled={m === inForce && carry?.from === atLevel} onClick={() => makeDefault(m)}>
                  {CARRY_WORDS[m].name}
                </Button>
              ))}
            </div>
            <ReportView report={report.value.report} at={report.value.at} inForce={inForce} />
          </>
        )}
        {list.items.length > 1 ? (
          <Disclosure summary={`Earlier reports, ${list.items.length - 1}${list.more ? " so far" : ""}`}>
            <ul class="lre-list" data-earlier-reports>
              {list.items.map((r) => (
                <li key={r.id} class="lre-listrow">
                  <button type="button" class="lre-listrow-hit" onClick={() => setPicked(r.id)} aria-current={r.id === shownId ? "true" : undefined} data-report-line={r.id}>
                    <span class="lre-listrow-content">
                      <span class="lre-listrow-text">
                        <span class="lre-listrow-title">Ran {when(r.ran)}</span>
                        <span class="lre-listrow-sub">
                          {r.model} through {r.connection}; judged through {r.judge}
                        </span>
                      </span>
                      <span class="lre-inline">{r.recommended ? null : <Badge tone="warn">no recommendation yet</Badge>}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {list.more ? (
              <Button size="sm" variant="ghost" busy={list.loading} onClick={list.older}>
                Older reports
              </Button>
            ) : null}
          </Disclosure>
        ) : null}
      </div>
    </Section>
  );
}

// Start a job by hand (plan §13.5, R-27, AuUI-205): a definition from the agents route, a brief, what it is given by name, and limits of its own
// (calls, tokens in, tokens out, tokens, time; each holds only where tighter than `jobs.run.*`), in the chat open. It is his own job: what it records is
// his, placed before the next turn that begins after it ends. RPE's refusal (jobs off, a limit of the day reached, a bad limit) is shown in its words.

import { useState } from "preact/hooks";
import type { JobLimits, JobView } from "../../../shared/api";
import { useApp } from "../../app";
import { Banner, Button, Section } from "../../../frontend/components";
import { useRead } from "../../reading";
import { errorWords } from "../../words";

/** The limits a job may be given of its own: each by the key the route takes it under, and as its field is labelled. */
export const LIMIT_FIELDS = [
  ["calls", "Calls at most"],
  ["tokensIn", "Tokens in at most"],
  ["tokensOut", "Tokens out at most"],
  ["tokens", "Tokens in all at most"],
  ["time", "Seconds at most"],
] as const;

/** The limits he typed: a field left empty sets none; a whole number of at least one is kept; anything else is named, by its field's label. */
export function limitsOf(typed: Readonly<Record<string, string>>): { limits: JobLimits; bad: string[] } {
  const limits: Record<string, number> = {};
  const bad: string[] = [];
  for (const [key, label] of LIMIT_FIELDS) {
    const text = (typed[key] ?? "").trim();
    if (text === "") continue;
    const n = Number(text);
    if (Number.isInteger(n) && n >= 1) limits[key] = n;
    else bad.push(label);
  }
  return { limits, bad };
}

export function StartSection(props: { chat: string | null; onStarted(job: JobView): void }) {
  const app = useApp();
  const { chat } = props;
  const agents = useRead(() => app.client.call("GET /api/v1/agents", {}, { query: chat === null ? {} : { chat } }), [chat]);
  const [definition, setDefinition] = useState("");
  const [brief, setBrief] = useState("");
  const [given, setGiven] = useState("");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [started, setStarted] = useState<JobView | null>(null);
  if (chat === null) {
    return (
      <Section id="start" title="Start a job">
        <p class="lre-muted rpe-line">Open a chat to start a job in it.</p>
      </Section>
    );
  }
  const start = (): void => {
    if (busy) return;
    const { limits, bad } = limitsOf(typed);
    if (definition === "") return setProblem("Choose the agent that does the job.");
    if (brief.trim() === "") return setProblem("Say what the job is to do.");
    if (bad.length > 0) return setProblem(`A limit takes a whole number of at least one: ${bad.join(", ")}.`);
    setBusy(true);
    setProblem(null);
    const names = given.split(",").map((n) => n.trim()).filter((n) => n !== "");
    app.client.call("POST /api/v1/chats/:chat/jobs", { chat }, { body: { definition, brief, ...(names.length === 0 ? {} : { given: names }), ...(Object.keys(limits).length === 0 ? {} : { limits }) } }).then(
      (answer) => {
        setBusy(false);
        setStarted(answer.job);
        props.onStarted(answer.job);
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  return (
    <Section id="start" title="Start a job">
      <label class="lre-field">
        <span class="label">The agent that does it</span>
        <select class="lre-input" value={definition} onChange={(e) => setDefinition((e.currentTarget as HTMLSelectElement).value)}>
          <option value="">choose an agent</option>
          {(agents.value?.agents ?? []).filter((a) => !a.off).map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label class="lre-field">
        <span class="label">What it is to do</span>
        <textarea class="lre-input" rows={4} value={brief} onInput={(e) => setBrief((e.currentTarget as HTMLTextAreaElement).value)} />
      </label>
      <label class="lre-field">
        <span class="label">What it is given, by name, separated by commas</span>
        <input class="lre-input" value={given} spellcheck={false} onInput={(e) => setGiven((e.currentTarget as HTMLInputElement).value)} />
      </label>
      <div class="rpe-log-filters">
        {LIMIT_FIELDS.map(([key, label]) => (
          <label key={key} class="lre-field">
            <span class="label">{label}</span>
            <input class="lre-input" inputMode="numeric" value={typed[key] ?? ""} onInput={(e) => setTyped((held) => ({ ...held, [key]: (e.currentTarget as HTMLInputElement).value }))} />
          </label>
        ))}
      </div>
      <p class="rpe-meta">A limit of its own holds only where it is tighter than the limits of every job in Settings. It starts at once, or waits for the jobs running to end.</p>
      <div class="lre-inline">
        <Button busy={busy} onClick={start}>
          Start it
        </Button>
      </div>
      {started === null ? null : (
        <Banner tone="info" icon="check" title="Started">
          <span data-started>Job {started.id} ({started.state}) is yours: what it records is yours, placed before the next turn that begins after it ends.</span>
        </Banner>
      )}
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not started">
          <span data-problem>{problem}</span>
        </Banner>
      )}
    </Section>
  );
}

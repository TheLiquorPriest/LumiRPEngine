// One rule open (plan §5.4, §14 Rules): who it is for and what triggers it in words, its text edited and saved as his at a level, reset to the
// default or deleted, an example copied into force, its file opened on Files, switched on and off for this chat or every chat, its own firings,
// and the tester that runs it as its file stands against a past turn of the chat, writing nothing. Every refusal is shown in RPE's words.

import type { RuleTest } from "rp-harness/contract";
import { useState } from "preact/hooks";
import type { TurnRow } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Section } from "../../atoms";
import { useRead } from "../../reading";
import { useSelect } from "../../store";
import { useUiSetting } from "../../ui-settings";
import { callWanted, type RuleShown } from "../../wanted";
import { counted, errorWords, LEVEL_WORDS, when } from "../../words";
import { filesCalls, type WriteLevel, writeLevels } from "../files/model";
import { FiringLine } from "./firings";
import { namesOf, ruleFileOf, triggerWords } from "./header";

const WHY_WORDS: Readonly<Record<NonNullable<RuleShown["why"]>, string>> = {
  off: "switched off",
  needs: "a file it needs is not in force",
  example: "an example: nothing under examples/ is in force",
  broken: "its header or text does not parse",
  judge: "its question cannot be put",
};

const JUDGE_WORDS: Readonly<Record<NonNullable<RuleShown["judge"]>, string>> = {
  part: "the judging model's part is missing or switched off",
  yes: "it names no yes: answer",
  connection: "the connection that judges is none of his",
};

/** Why a rule is not in force, in words; null for one that is. */
export function whyWords(rule: RuleShown): string | null {
  if (rule.inForce) return null;
  const why = rule.why === undefined ? "not in force" : WHY_WORDS[rule.why];
  return rule.why === "judge" && rule.judge !== undefined ? `${why}: ${JUDGE_WORDS[rule.judge]}` : why;
}

export interface RuleOpenProps {
  chat: string | null;
  rule: RuleShown;
  onChanged(rule: RuleShown | null): void;
  onAgent(definition: string): void;
  onTurn(turn: string): void;
  onFile(path: string): void;
}

function Tester(props: { chat: string; rule: RuleShown; onTurn(turn: string): void }) {
  const app = useApp();
  const { chat, rule } = props;
  const perPage = useUiSetting("turnsAtATime");
  const gate = useSelect(app.gate, (open) => open.has(chat));
  const turns = useRead(() => app.client.call("GET /api/v1/chats/:chat/turns", { chat }, { query: { limit: perPage } }).then((answer) => ("joined" in answer ? { turns: [] as TurnRow[], more: false } : answer)), [chat]);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RuleTest | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = (): void => {
    if (busy || picked === "") return;
    setBusy(true);
    setProblem(null);
    setResult(null);
    callWanted(app.client, "POST /api/v1/chats/:chat/rules/:name/test", { chat, name: rule.name }, { body: { turn: picked } }).then(
      (test) => {
        setBusy(false);
        setResult(test);
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  return (
    <Section id="tester" title="Try it on a turn already played">
      <p class="rpe-meta">It runs as its file stands now, edits included, and writes nothing: nothing goes to the chat or to any turn's records.</p>
      <label class="lre-field">
        <span class="label">A turn of this chat</span>
        <select class="lre-input" value={picked} onChange={(e) => setPicked((e.currentTarget as HTMLSelectElement).value)}>
          <option value="">choose a turn</option>
          {(turns.value?.turns ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {when(t.timings.received)} · {t.kind}
              {t.onPath ? "" : " · off the path"}
            </option>
          ))}
        </select>
      </label>
      <div class="lre-inline">
        <Button busy={busy} disabled={picked === ""} onClick={run}>
          Run it on that turn
        </Button>
        {picked === "" ? null : (
          <Button small kind="ghost" onClick={() => props.onTurn(picked)}>
            Open that turn
          </Button>
        )}
      </div>
      {turns.problem === null ? null : <p class="rpe-line">{turns.problem}</p>}
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="It could not be run">
          <span data-test-problem>{problem}</span>
        </Banner>
      )}
      {result === null ? null : (
        <div class="lre-stack" data-test-result>
          <p class="rpe-line">
            <Badge tone={result.fired ? "warn" : undefined}>{result.fired ? "would have fired" : "would not have fired"}</Badge> on that turn{result.fired ? `, ${counted(result.firings.length, "time")}` : ""}.
          </p>
          <ul class="rpe-plain lre-stack">
            {result.firings.map((f, i) => (
              <FiringLine key={i} firing={f} gate={gate} />
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

export function RuleOpen(props: RuleOpenProps) {
  const app = useApp();
  const { chat, rule } = props;
  const files = filesCalls(app.client, chat);
  const piece = useUiSetting("filePieceBytes");
  const file = useRead(() => files.read(rule.path, 0, piece), [rule.path, chat]);
  const header = file.value === null ? null : ruleFileOf(file.value.text);
  const [draft, setDraft] = useState<string | null>(null);
  const [level, setLevel] = useState<WriteLevel>(chat === null ? "global" : "chat");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const levels = writeLevels(chat);
  const text = draft ?? file.value?.text ?? "";
  const whole = file.value !== null && file.value.more !== true;
  const isExample = rule.why === "example";
  const mine = rule.level !== "shipped";
  const replacesShipped = rule.replaces.some((r) => r.level === "shipped");
  const press = (what: string, go: () => Promise<void>): void => {
    if (busy !== null) return;
    setBusy(what);
    setProblem(null);
    go().then(
      () => setBusy(null),
      (error: unknown) => {
        setBusy(null);
        setProblem(errorWords(error));
      },
    );
  };
  const save = (): void =>
    press("save", async () => {
      await files.save(rule.path, level, text);
      setDraft(null);
      setSaid(`Saved as yours, ${level === "global" ? "for every chat" : level === "chat" ? "for this chat" : "for this character"}; the list now shows what is in force.`);
      file.again();
      props.onChanged(null);
    });
  const reset = (): void =>
    press("reset", async () => {
      await files.remove(rule.path);
      setAsking(false);
      setDraft(null);
      setSaid(replacesShipped ? "Your file is gone: the shipped rule is in force again." : "Your rule is deleted.");
      props.onChanged(null);
    });
  const copy = (to: string): void =>
    press("copy", async () => {
      const made = await files.copy(rule.path, to);
      setSaid(`Copied to ${made.path}; it is in force as a rule of yours.`);
      props.onChanged(null);
    });
  const switchTo = (on: boolean, at: "chat" | "global"): void =>
    press("switch", async () => {
      const answer = await callWanted(app.client, "POST /api/v1/rules/:name/switch", { name: rule.name }, { body: { on, level: at, ...(chat === null ? {} : { chat }) } });
      setSaid(`${rule.name} is ${answer.rule.inForce ? "in force" : "not in force"} now${answer.rule.inForce ? "" : whyWords(answer.rule) === null ? "" : `: ${whyWords(answer.rule)}`}.`);
      props.onChanged(answer.rule);
    });
  const why = whyWords(rule);
  const agents = rule.agents === "all" ? null : rule.agents;
  return (
    <div class="lre-stack" data-rule={rule.name}>
      <p class="rpe-line">
        <Badge tone={rule.inForce ? "pos" : "warn"}>{rule.inForce ? "in force" : "not in force"}</Badge> <Badge>{LEVEL_WORDS[rule.level]}</Badge>
        {why === null ? "" : ` ${why}`}
      </p>
      <p class="rpe-line">{rule.description}</p>
      <p class="rpe-line" data-for>
        Who it is for:{" "}
        {agents === null
          ? "every agent."
          : agents.map((a) => (
              <Button key={a} small kind="ghost" onClick={() => props.onAgent(a)}>
                {a}
              </Button>
            ))}
      </p>
      {header === null ? null : (
        <>
          <p class="rpe-line" data-trigger>{rule.trigger === undefined && header.fields.size === 0 ? "Its header does not say what triggers it." : triggerWords(header.fields)}</p>
          {namesOf(header.fields.get("needs")).length === 0 ? null : <p class="rpe-meta" data-needs>It needs: {namesOf(header.fields.get("needs")).join(", ")}.</p>}
        </>
      )}
      {rule.command === undefined ? null : (
        <p class="rpe-meta" data-command>
          It asks a command, <code>{rule.command.runs}</code>, which {rule.command.state === "on" ? "may run" : "waits for the server's own command line: run rpe allow on the server"}. No page switches it on.
        </p>
      )}
      {rule.replaces.length === 0 ? null : <p class="rpe-meta">It replaces: {rule.replaces.map((r) => `${LEVEL_WORDS[r.level]} (${r.path})`).join("; ")}.</p>}
      {said === null ? null : (
        <Banner tone="info" icon="check" title="Done">
          <span data-said>{said}</span>
        </Banner>
      )}
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not done">
          <span data-problem>{problem}</span>
        </Banner>
      )}
      <div class="lre-inline rpe-wrap" data-switches>
        {rule.inForce || rule.why === "off" ? (
          <>
            {chat === null ? null : (
              <Button small busy={busy === "switch"} onClick={() => switchTo(!rule.inForce, "chat")}>
                {rule.inForce ? "Switch off for this chat" : "Switch on for this chat"}
              </Button>
            )}
            <Button small kind="ghost" busy={busy === "switch"} onClick={() => switchTo(!rule.inForce, "global")}>
              {rule.inForce ? "Switch off for every chat" : "Switch on for every chat"}
            </Button>
          </>
        ) : null}
        <Button small kind="ghost" onClick={() => props.onFile(rule.path)}>
          Open its file on Files
        </Button>
      </div>
      <Section id="text" title="Its text">
        {file.problem === null ? null : <p class="rpe-line">{file.problem}</p>}
        {file.value === null ? (
          file.problem === null ? <p class="lre-muted rpe-line">Reading its file…</p> : null
        ) : whole ? (
          <>
            <textarea class="lre-input rpe-editor" value={text} spellcheck={false} onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)} aria-label="The rule's file" />
            <div class="lre-inline rpe-wrap">
              <label class="lre-field">
                <span class="label">Save it as yours at</span>
                <select class="lre-input" value={level} onChange={(e) => setLevel((e.currentTarget as HTMLSelectElement).value as WriteLevel)}>
                  {levels.map((l) => (
                    <option key={l} value={l}>
                      {l === "global" ? "every chat" : l === "chat" ? "this chat" : "this character"}
                    </option>
                  ))}
                </select>
              </label>
              <Button busy={busy === "save"} disabled={draft === null || draft === file.value.text} onClick={save}>
                Save as mine
              </Button>
            </div>
          </>
        ) : (
          <p class="rpe-line">This file is longer than a piece; edit it on Files.</p>
        )}
        <div class="lre-inline rpe-wrap">
          {isExample ? (
            <>
              <Button small busy={busy === "copy"} onClick={() => copy(`@global/rules/${rule.name}.md`)}>
                Copy it into force for every chat
              </Button>
              {chat === null ? null : (
                <Button small kind="ghost" busy={busy === "copy"} onClick={() => copy(`rules/${rule.name}.md`)}>
                  Copy it into force for this chat
                </Button>
              )}
            </>
          ) : null}
          {mine && !isExample ? (
            asking ? (
              <Banner tone="warn" icon="alert" title={replacesShipped ? "Reset to the shipped rule?" : "Delete your rule?"}>
                <span>{replacesShipped ? "Your file goes, and the shipped rule is in force in its place." : "Your file goes, and nothing replaces it."}</span>
                <div class="lre-inline">
                  <Button kind="danger" busy={busy === "reset"} onClick={reset}>
                    Yes
                  </Button>
                  <Button kind="ghost" onClick={() => setAsking(false)}>
                    No
                  </Button>
                </div>
              </Banner>
            ) : (
              <Button small kind="ghost" onClick={() => setAsking(true)}>
                {replacesShipped ? "Reset to the shipped rule" : "Delete my rule"}
              </Button>
            )
          ) : null}
        </div>
      </Section>
      {chat === null ? null : <Tester chat={chat} rule={rule} onTurn={props.onTurn} />}
    </div>
  );
}

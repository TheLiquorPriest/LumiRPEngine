// One definition open (plan §5.2, §5.4, §14 Agents, §2.1 point 5): which connection, model and effort it will really run with; its
// effort, its limits and its sampling as settings, each changed for every chat or this chat with what its header says beside it and the
// way back to it; its tools (each with its family, a tool nobody registers marked), what it reads (its stack in the chat open, part by
// part, each with its file and level), and what it is given by name with what provides each; and the change form: its header as fields
// (model from the connections, tools from what is registered, what it reads, what it is given) and its text, saved as his own file at a
// level, a shipped one reset to its default, a copy of it made as a new agent, its file opened on Files. A change to its tools or to
// what it is given holds from the next session, or at once by Apply now.

import type { ListedDefinition, RegisteredTool } from "rp-harness/contract";
import { useState } from "preact/hooks";
import type { ConnectionShown, StackReply } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Disclosure, Section } from "../../../frontend/components";
import { useRead } from "../../reading";
import { useUiSetting } from "../../ui-settings";
import { counted, errorWords, LEVEL_WORDS, num } from "../../words";
import { guidanceFolder } from "../files/kinds";
import { filesCalls, type WriteLevel, writeLevels } from "../files/model";
import { Handed } from "../files/stack";
import type { SettingsShown } from "../settings";
import type { RowActions } from "../settings/row";
import { windowOfModel } from "../usage";
import { listLine, rewrite, splitFile } from "./header";
import { AgentSettings } from "./settings";

/** What a name in `given:` is, in words, by the kind the route gives it. */
export const GIVEN_KIND_WORDS: Readonly<Record<string, string>> = {
  file: "a file of the tree",
  chat: "the chat's messages",
  lore: "the lore",
  prompt: "the prompt",
  world: "the world's state",
  story: "the story record",
  cast: "the cast",
  turn: "the turn",
  index: "the lore index",
  ruleset: "the ruleset",
  map: "the map",
  view: "a view of the world",
};

export interface AgentOpenProps extends RowActions {
  chat: string | null;
  agent: ListedDefinition;
  connections: readonly ConnectionShown[];
  /** The settings of the chat's levels, the ones set per agent among them. */
  settings: SettingsShown;
  /** Called when a file was written, so the list is read again. */
  onChanged(): void;
  onConnection(id: string): void;
  onFile(path: string): void;
}

/** A tool of the definition's fixed list with where it stands in the registry. */
export function toolStanding(name: string, registered: readonly RegisteredTool[]): { tool: RegisteredTool | null; text: string } {
  const tool = registered.find((t) => t.name === name) ?? null;
  return { tool, text: tool === null ? "nobody registers it, so it is not offered" : `${tool.family}, ${tool.from === "rph" ? "RPH's own" : tool.from === "host" ? "the host's" : "your own"}` };
}

function ModelSection(props: { agent: ListedDefinition; connections: readonly ConnectionShown[]; onConnection(id: string): void }) {
  const { agent } = props;
  const run = agent.runsOn;
  const connection = run.connection;
  const window = connection === null || run.model === null ? null : windowOfModel(props.connections, connection.id, run.model);
  return (
    <Section id="model" title="What it runs on">
      <p class="rpe-line" data-profile>
        {agent.model === undefined || agent.model === "default" ? "Its header names no profile: it runs on your default connection." : `Its header names the connection ${agent.model}.`}
      </p>
      {connection === null ? (
        <p class="rpe-line" data-no-connection>No connection resolves for it: add one on Connections, or name one of yours in its header.</p>
      ) : (
        <p class="rpe-line" data-runs-on>
          <Button size="sm" variant="ghost" onClick={() => props.onConnection(connection.id)}>
            {connection.name}
          </Button>{" "}
          {run.model === null ? "(no model named)" : <code>{run.model}</code>}
          {window === null ? "" : `, a window of ${num(window)} tokens`}
        </p>
      )}
      <p class="rpe-line" data-effort>
        {run.effort === null ? "Its effort is left to its provider's own default" : <>It is set to think at <strong>{run.effort}</strong>. A model that has no level so high is sent the nearest level it has, which the turn's record names for each run (its “effort”)</>}
        {agent.effort === undefined ? ". Its definition sets none." : `. Its definition says ${agent.effort}.`} An effort set for its connection on the Settings page stands over its definition's, and one set below, for every chat or this one, over both.
      </p>
    </Section>
  );
}

function ToolsSection(props: { chat: string | null; agent: ListedDefinition }) {
  const app = useApp();
  const tools = useRead(() => app.client.call("GET /api/v1/agents/:agent/tools", { agent: props.agent.name }, { query: props.chat === null ? {} : { chat: props.chat } }), [props.agent.name, props.chat]);
  const registered = tools.value?.registered ?? [];
  const over = tools.value !== undefined && tools.value !== null && tools.value.tokens > tools.value.most;
  return (
    <Section id="tools" title="Its tools">
      {tools.problem === null ? null : <p class="rpe-line">{tools.problem}</p>}
      <ul class="rpe-plain lre-stack" data-tools>
        {props.agent.tools.map((name) => {
          const s = toolStanding(name, registered);
          return (
            <li key={name} class="rpe-line" data-tool={name} data-registered={s.tool === null && tools.value !== null ? "no" : "yes"}>
              <code>{name}</code> <span class="rpe-meta">{tools.value === null ? "" : s.text}</span> {s.tool === null && tools.value !== null ? <Badge tone="warn">not registered</Badge> : null}
            </li>
          );
        })}
      </ul>
      {tools.value === null ? null : (
        <p class="rpe-meta" data-declared>
          Its requests carry {counted(tools.value.declared.length, "tool")}, {num(tools.value.tokens)} tokens of at most {num(tools.value.most)}
          {over ? ": over the most, which is only marked here" : ""}. {props.agent.toolsAs === undefined || props.agent.toolsAs === "auto" ? "Offered as the connection does best." : `Offered as ${props.agent.toolsAs} tool calls.`} It reaches the rest of what is registered through
          <code> tool_search</code> and <code>tool_use</code>.
        </p>
      )}
    </Section>
  );
}

function StackSection(props: { chat: string | null; agent: string }) {
  const app = useApp();
  const files = filesCalls(app.client, props.chat);
  const stack = useRead<StackReply>(() => files.stack(props.agent), [props.agent, props.chat]);
  return (
    <Section id="reads" title="What it reads">
      <p class="rpe-meta">{props.chat === null ? "As a new chat takes it." : "In this chat."} The opening block, then what comes with the briefing.</p>
      {stack.problem === null ? null : <p class="rpe-line">{stack.problem}</p>}
      <ul class="rpe-plain lre-stack" data-stack>
        {(stack.value?.parts ?? []).map((part, i) => (
          <li key={`${part.part}-${i}`} class="rpe-line" data-part={part.part} data-left={part.left}>
            <code>{part.part}</code> <Badge>{part.where === "opening" ? "opening" : "briefing"}</Badge> <span class="rpe-meta">{part.path} · {LEVEL_WORDS[part.level]}</span>
            {part.left === undefined ? null : <Badge tone="warn">left out: {part.left}</Badge>}
          </li>
        ))}
      </ul>
      <Handed agent={props.agent} handed={(stack.value?.handed ?? []).filter((h) => h.from === "pin")} />
    </Section>
  );
}

function GivenSection(props: { chat: string | null; agent: ListedDefinition }) {
  const app = useApp();
  const chat = props.chat;
  const given = useRead(chat === null ? null : () => app.client.call("GET /api/v1/chats/:chat/given", { chat }), [chat, props.agent.name]);
  const mine = given.value?.definitions.find((d) => d.name === props.agent.name);
  return (
    <Section id="given" title="What it is given">
      {props.agent.given.length === 0 ? <p class="lre-muted rpe-line">Nothing by name.</p> : null}
      <ul class="rpe-plain lre-stack" data-given>
        {props.agent.given.map((name) => {
          const found = mine?.given.find((g) => g.name === name);
          const missing = mine?.missing.includes(name) === true;
          return (
            <li key={name} class="rpe-line" data-given-name={name}>
              <code>{name}</code>{" "}
              {found === undefined ? null : <span class="rpe-meta">{GIVEN_KIND_WORDS[found.kind] ?? found.kind}{found.by === "rpe" ? ", RPE's" : ", RPH's"}</span>}{" "}
              {missing || found?.found === false ? <Badge tone="warn">nothing provides it</Badge> : null}
            </li>
          );
        })}
      </ul>
      {chat === null ? <p class="rpe-meta">Open a chat to see what each name brings there.</p> : given.problem === null ? null : <p class="rpe-line">{given.problem}</p>}
    </Section>
  );
}

function ChangeSection(props: AgentOpenProps) {
  const app = useApp();
  const { chat, agent } = props;
  const files = filesCalls(app.client, chat);
  const piece = useUiSetting("filePieceBytes");
  const file = useRead(() => files.read(agent.path, 0, piece), [agent.path, chat]);
  const tools = useRead(() => app.client.call("GET /api/v1/agents/:agent/tools", { agent: agent.name }, { query: chat === null ? {} : { chat } }), [agent.name, chat]);
  const [model, setModel] = useState(agent.model ?? "default");
  const [picked, setPicked] = useState<readonly string[]>(agent.tools);
  const [reads, setReads] = useState(agent.reads.join(", "));
  const [given, setGiven] = useState(agent.given.join(", "));
  const [body, setBody] = useState<string | null>(null);
  const [level, setLevel] = useState<WriteLevel>(chat === null ? "global" : "chat");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [copyAs, setCopyAs] = useState("");
  const whole = file.value !== null && file.value.more !== true;
  const bodyText = body ?? (file.value === null ? "" : splitFile(file.value.text).body);
  const names = (text: string): string[] => text.split(",").map((n) => n.trim()).filter((n) => n !== "");
  const offered = [...new Set([...(tools.value?.registered.map((t) => t.name) ?? []), ...agent.tools])].sort();
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
      if (file.value === null) return;
      const { text, kept } = rewrite(file.value.text, { model: model === "" ? null : model, tools: listLine(picked), reads: listLine(names(reads)), given: listLine(names(given)) }, bodyText);
      await files.save(agent.path, level, text);
      setSaid(`Saved as your own file ${level === "global" ? "for every chat" : level === "chat" ? "for this chat" : "for this character"}.${kept.length === 0 ? "" : ` ${kept.join(", ")} is written over several lines in its file and was left as it is: change it on Files.`} A change to its tools or to what it is given holds from the next session, or at once with Apply now.`);
      file.again();
      props.onChanged();
    });
  const reset = (): void =>
    press("reset", async () => {
      await files.remove(agent.path);
      setAsking(false);
      setSaid(agent.replaces.some((r) => r.level === "shipped") ? "Your file is gone: the shipped definition is in force again." : "Your definition is deleted.");
      props.onChanged();
    });
  const copy = (): void =>
    press("copy", async () => {
      const name = copyAs.trim();
      if (name === "") throw new Error("Name the new agent.");
      const made = await files.copy(agent.path, `@global/${guidanceFolder("global", "agents")}/${name}.md`);
      setSaid(`Copied to ${made.path}: a new agent of yours named ${name}; open its file to change its name field.`);
      props.onChanged();
    });
  const apply = (): void =>
    press("apply", async () => {
      const done = await files.applyNow();
      setSaid(done.note);
    });
  const mine = agent.level !== "shipped";
  return (
    <Section id="change" title="Change it">
      {file.problem === null ? null : <p class="rpe-line">{file.problem}</p>}
      {file.value === null || !whole ? (
        <p class="lre-muted rpe-line">{file.value === null ? "Reading its file…" : "Its file is longer than a piece: change it on Files."}</p>
      ) : (
        <div class="lre-stack" data-form>
          <label class="lre-field">
            <span class="label">Connection</span>
            <select class="lre-input" value={model} onChange={(e) => setModel((e.currentTarget as HTMLSelectElement).value)}>
              <option value="default">your default connection</option>
              {props.connections.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                  {c.model === undefined ? "" : ` · ${c.model}`}
                </option>
              ))}
              {model !== "default" && !props.connections.some((c) => c.name === model) ? <option value={model}>{model} (not one of yours)</option> : null}
            </select>
          </label>
          <Disclosure summary={`Tools (${picked.length})`}>
            <ul class="rpe-plain lre-stack" data-tool-picks>
              {offered.map((name) => (
                <li key={name}>
                  <label class="lre-inline">
                    <input type="checkbox" checked={picked.includes(name)} onChange={(e) => setPicked((held) => ((e.currentTarget as HTMLInputElement).checked ? [...held, name] : held.filter((n) => n !== name)))} /> <code>{name}</code>
                    {toolStanding(name, tools.value?.registered ?? []).tool === null && tools.value !== null ? <Badge tone="warn">not registered</Badge> : null}
                  </label>
                </li>
              ))}
            </ul>
          </Disclosure>
          <label class="lre-field">
            <span class="label">Instruction files it reads, separated by commas</span>
            <input class="lre-input" value={reads} spellcheck={false} onInput={(e) => setReads((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label class="lre-field">
            <span class="label">Names it is given, separated by commas</span>
            <input class="lre-input" value={given} spellcheck={false} onInput={(e) => setGiven((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label class="lre-field">
            <span class="label">Its text</span>
            <textarea class="lre-input rpe-editor" value={bodyText} spellcheck={false} onInput={(e) => setBody((e.currentTarget as HTMLTextAreaElement).value)} />
          </label>
          <div class="lre-inline rpe-wrap">
            <label class="lre-field">
              <span class="label">Save it as yours at</span>
              <select class="lre-input" value={level} onChange={(e) => setLevel((e.currentTarget as HTMLSelectElement).value as WriteLevel)}>
                {writeLevels(chat).map((l) => (
                  <option key={l} value={l}>
                    {l === "global" ? "every chat" : l === "chat" ? "this chat" : "this character"}
                  </option>
                ))}
              </select>
            </label>
            <Button busy={busy === "save"} onClick={save}>
              Save as mine
            </Button>
          </div>
        </div>
      )}
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
      <div class="lre-inline rpe-wrap">
        {chat === null ? null : (
          <Button size="sm" variant="ghost" busy={busy === "apply"} onClick={apply}>
            Apply now
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => props.onFile(agent.path)}>
          Open its file on Files
        </Button>
        {mine ? (
          asking ? (
            <Banner tone="warn" icon="alert" title={agent.replaces.some((r) => r.level === "shipped") ? "Reset to the shipped definition?" : "Delete your definition?"}>
              <span>Your file goes{agent.replaces.some((r) => r.level === "shipped") ? ", and the shipped definition is in force in its place" : ", and nothing replaces it"}.</span>
              <div class="lre-inline">
                <Button variant="danger" busy={busy === "reset"} onClick={reset}>
                  Yes
                </Button>
                <Button variant="ghost" onClick={() => setAsking(false)}>
                  No
                </Button>
              </div>
            </Banner>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>
              {agent.replaces.some((r) => r.level === "shipped") ? "Reset to the shipped definition" : "Delete my definition"}
            </Button>
          )
        ) : null}
      </div>
      <div class="lre-inline rpe-wrap">
        <label class="lre-field">
          <span class="label">A new agent as a copy of this one, named</span>
          <input class="lre-input" value={copyAs} spellcheck={false} onInput={(e) => setCopyAs((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <Button size="sm" busy={busy === "copy"} onClick={copy}>
          Make a copy
        </Button>
      </div>
    </Section>
  );
}

export function AgentOpen(props: AgentOpenProps) {
  const { agent } = props;
  return (
    <div class="lre-stack" data-agent={agent.name}>
      <p class="rpe-line">
        <Badge>{LEVEL_WORDS[agent.level]}</Badge> {agent.off ? <Badge tone="warn">switched off</Badge> : <Badge tone="pos">in force</Badge>}
        {agent.replaces.length === 0 ? "" : ` replaces ${agent.replaces.map((r) => LEVEL_WORDS[r.level].toLowerCase()).join(", ")}`}
      </p>
      <p class="rpe-line">{agent.description}</p>
      <ModelSection agent={agent} connections={props.connections} onConnection={props.onConnection} />
      <AgentSettings chat={props.chat} agent={agent} shown={props.settings} onWrite={props.onWrite} onTakeAway={props.onTakeAway} />
      <ToolsSection chat={props.chat} agent={agent} />
      <StackSection chat={props.chat} agent={agent.name} />
      <GivenSection chat={props.chat} agent={agent} />
      <ChangeSection key={`${agent.level}:${agent.path}`} {...props} />
    </div>
  );
}

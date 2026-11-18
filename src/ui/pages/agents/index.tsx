// Agents (plan §14, App. C, §2.1 point 5): every definition in force for the chat open (or, with none open, as a new chat takes them), each with
// which connection, model and effort it will really run with, its effort and limits as settings, its tools, what it reads and what it is given;
// one open by address (`agents/<name>`), the list beside it at desktop width and gone for it, with Back, on a phone. He changes any of it there:
// a setting for every chat or this chat, and the definition saved as his own file at a level.

import type { ListedDefinition } from "rp-harness/contract";
import { useState } from "preact/hooks";
import { useApp } from "../../app";
import { Badge, Banner, Empty, PageHeader } from "../../../frontend/components";
import type { PageEntry } from "../../page-entry";
import { useRead } from "../../reading";
import { LEVEL_WORDS } from "../../words";
import { useSettings } from "../settings";
import { AgentOpen } from "./open";

export { toolStanding } from "./open";

/** The definitions in force first, those switched off after, each by name. */
export function sortedAgents(agents: readonly ListedDefinition[]): ListedDefinition[] {
  return [...agents].sort((a, b) => Number(a.off) - Number(b.off) || a.name.localeCompare(b.name));
}

/** What an agent runs on, in a few words, for the list: the level its model is sent beside the effort set, where they differ. */
export function runsWords(agent: ListedDefinition): string {
  const { connection, model, effort, sent } = agent.runsOn;
  if (connection === null) return "no connection resolves";
  return `${connection.name}${model === null ? "" : ` · ${model}`}${effort === null ? "" : ` · ${effort}`}${sent !== null && sent !== effort ? ` (sent ${sent})` : ""}`;
}

export function AgentLine(props: { agent: ListedDefinition; open: boolean; onOpen(): void }) {
  const { agent } = props;
  return (
    <li class="lre-listrow">
      <button type="button" class="lre-listrow-hit" onClick={props.onOpen} data-agent-line={agent.name} aria-current={props.open ? "page" : undefined}>
        <span class="lre-listrow-content">
          <span class="lre-listrow-text">
            <span class="lre-listrow-title">{agent.name}</span>
            <span class="lre-listrow-sub">
              {agent.description === "" ? "its header gives no description" : agent.description}
              {" · "}
              {runsWords(agent)}
            </span>
          </span>
          <span class="lre-inline">
            <Badge>{LEVEL_WORDS[agent.level]}</Badge>
            {agent.off ? <Badge tone="warn">off</Badge> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

export function AgentsPage(props: { chat: string | null; at: readonly string[] | undefined }) {
  const app = useApp();
  const { chat } = props;
  const [changed, setChanged] = useState(0);
  const [settingsWritten, setSettingsWritten] = useState(0);
  // A setting written changes what an agent runs with (its effort): the list is read again. A file written may add a definition: the settings are read again.
  const agents = useRead(() => app.client.call("GET /api/v1/agents", {}, { query: chat === null ? {} : { chat } }), [chat, changed, settingsWritten]);
  const settings = useSettings(chat, () => setSettingsWritten((n) => n + 1), changed);
  const connections = useRead(() => app.client.call("GET /api/v1/connections", {}), []);
  const name = props.at?.[0] ?? null;
  const list = sortedAgents(agents.value?.agents ?? []);
  const open = name === null ? null : (list.find((a) => a.name === name) ?? null);
  const go = (to: string | null): void => app.go({ page: "agents", chat, at: to === null ? [] : [to] });
  return (
    <div class="lre-stack rpe-page" data-page="agents">
      <PageHeader title="Agents" subtitle={chat === null ? "The definitions every new chat takes: the shipped level and yours." : "Each definition as it will run in this chat, and changed here."} {...(name === null ? {} : { onBack: () => go(null), backLabel: "all agents" })} />
      {agents.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The agents could not be read">
          <span>{agents.problem}</span>
        </Banner>
      )}
      <div class="rpe-files-split" data-open={open === null ? "no" : "yes"}>
        <div class="rpe-files-browser lre-stack">
          {list.length === 0 && !agents.loading && agents.problem === null ? (
            <Empty icon="user" title="No definition">
              <span>No agent definition is in force.</span>
            </Empty>
          ) : (
            <ul class="lre-list" data-agents>
              {list.map((a) => (
                <AgentLine key={`${a.level}:${a.path}`} agent={a} open={open?.name === a.name} onOpen={() => go(a.name)} />
              ))}
            </ul>
          )}
          {agents.loading && agents.value === null ? <p class="lre-muted rpe-line">Reading the definitions…</p> : null}
        </div>
        {name === null ? null : (
          <div class="lre-stack rpe-open-session">
            {open === null ? (
              <p class="lre-muted rpe-line">{agents.loading ? "Reading the definitions…" : "No definition of that name is in force."}</p>
            ) : (
              <AgentOpen
                key={`${open.level}:${open.path}`}
                chat={chat}
                agent={open}
                connections={connections.value?.connections ?? []}
                settings={settings.shown}
                {...settings.actions}
                onChanged={() => setChanged((n) => n + 1)}
                onConnection={(id) => app.go({ page: "connections", chat, at: [id] })}
                onFile={(path) => app.go({ page: "files", chat, at: [path] })}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const entry: PageEntry = { id: "agents", title: "Agents", icon: "users", shells: ["web", "drawer"], needsChat: false, withChat: true, often: false, order: 57, render: (route) => <AgentsPage chat={route.chat ?? null} at={route.at} /> };

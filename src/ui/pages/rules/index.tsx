// Rules (plan §5.4, §14): every rule of the chat's stack, in force or not as RPH's own list says and why, who it is for and what triggers it in
// words; the examples marked as examples; what waits for the server's command line (a hook, a rule's command); the facts a trigger can use with
// their value for the chat open; and the log of what fired and what the agent did next. A rule is open by address (`rules/<name>`), the list
// beside it at desktop width and gone for it, with Back, on a phone; `rules/~facts` and `rules/~log` are the other two views.

import { useState } from "preact/hooks";
import type { SwitchEntry } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Empty, PageHeader, Section } from "../../atoms";
import type { PageEntry } from "../../page-entry";
import { usePaged, useRead } from "../../reading";
import { useSelect } from "../../store";
import { useUiSetting } from "../../ui-settings";
import type { FactShown, RuleView } from "../../../shared/api";
import { counted, LEVEL_WORDS } from "../../words";
import { WaitingSection } from "../settings/waiting";
import { FiringLine } from "./firings";
import { namesOf } from "./header";
import { hookAddress, hookAt, HookOpen, HOOKS, HooksList, useHooks } from "./hooks";
import { RuleOpen, whyWords } from "./open";

export { whyWords } from "./open";

const FACTS = "~facts";
const LOG = "~log";

/** Rules in force first, then those not, each by name; an example last. */
export function sortedRules(rules: readonly RuleView[]): RuleView[] {
  const rank = (r: RuleView): number => (r.inForce ? 0 : r.why === "example" ? 2 : 1);
  return [...rules].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function RuleLine(props: { rule: RuleView; open: boolean; onOpen(): void }) {
  const { rule } = props;
  const why = whyWords(rule);
  return (
    <li class="lre-listrow">
      <button type="button" class="lre-listrow-hit" onClick={props.onOpen} data-rule-line={rule.name} aria-current={props.open ? "page" : undefined}>
        <span class="lre-listrow-content">
          <span class="lre-listrow-text">
            <span class="lre-listrow-title">{rule.name}</span>
            <span class="lre-listrow-sub">
              {rule.description === "" ? "its header gives no description" : rule.description}
              {" · "}
              {rule.agents === "all" ? "for every agent" : `for ${namesOf(`[${rule.agents.join(",")}]`).join(", ")}`}
              {why === null ? "" : ` · ${why}`}
            </span>
          </span>
          <span class="lre-inline">
            <Badge>{LEVEL_WORDS[rule.level]}</Badge>
            <Badge tone={rule.inForce ? "pos" : "warn"}>{rule.inForce ? "in force" : rule.why === "example" ? "example" : "not in force"}</Badge>
            {rule.command?.state === "waiting" ? <Badge tone="warn" title="Its command waits for rpe allow on the server">command waiting</Badge> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function FactsView(props: { facts: readonly FactShown[] | null; problem: string | null; chat: string | null; onRule(name: string): void }) {
  return (
    <Section id="facts" title="Facts a trigger can use">
      <p class="rpe-meta">A rule's `fact:` names one of these and a test of it, such as <code>todo.open &gt; 0</code>. {props.chat === null ? "Open a chat to see each one's value now." : "Each shows its value for this chat now."}</p>
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The facts could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      <ul class="rpe-plain lre-stack" data-facts>
        {(props.facts ?? []).map((f) => (
          <li key={f.name} class="rpe-entry lre-stack" data-fact={f.name}>
            <p class="rpe-line">
              <code>{f.name}</code> <Badge>{f.from === "rph" ? "RPH's own" : "the host's"}</Badge>
              {f.clash === true ? <Badge tone="warn" title="A host fact named like one of RPH's own: rules read RPH's">clash</Badge> : null}
            </p>
            <p class="rpe-line">{f.counts}</p>
            {f.by === undefined ? null : <p class="rpe-meta">Groups: {f.by.join(", ")}</p>}
            {f.fields === undefined ? null : <p class="rpe-meta">Fields: {f.fields.join(", ")}</p>}
            {f.value === null ? null : (
              <p class="rpe-meta" data-value>
                Now: {f.value.count}
                {f.value.by === undefined ? "" : ` (${Object.entries(f.value.by).map(([g, n]) => `${g} ${n}`).join(", ")})`}
                {f.value.names === undefined || f.value.names.length === 0 ? "" : `: ${f.value.names.join(", ")}`}
              </p>
            )}
            {f.rules.length === 0 ? null : (
              <p class="rpe-meta">
                Named by:{" "}
                {f.rules.map((r) => (
                  <Button key={r} small kind="ghost" onClick={() => props.onRule(r)}>
                    {r}
                  </Button>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function LogPart(props: { chat: string; rule: string | null; onRule(rule: string): void; onTurn(turn: string): void }) {
  const app = useApp();
  const { chat } = props;
  const perPage = useUiSetting("rowsAtOnce");
  const gate = useSelect(app.gate, (open) => open.has(chat));
  const list = usePaged(
    (cursor) => app.client.call("GET /api/v1/chats/:chat/rules/firings", { chat }, { query: { ...(props.rule === null ? {} : { rule: props.rule }), limit: perPage, ...(cursor === undefined ? {} : { cursor }) } }),
    [chat, props.rule],
  );
  return (
    <Section id="log" title={props.rule === null ? "What fired" : `What ${props.rule} fired`}>
      {gate ? null : (
        <Banner tone="gm" icon="eye-off" title="What was matched and what the agent did next are hidden" actions={<Button onClick={() => app.gate.open(chat)}>Show them for this chat</Button>}>
          <span>They can give away what comes next.</span>
        </Banner>
      )}
      {list.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The log could not be read">
          <span>{list.problem}</span>
        </Banner>
      )}
      {list.items.length === 0 && !list.loading && list.problem === null ? (
        <p class="lre-muted rpe-line" data-log-none>No rule has fired{props.rule === null ? "" : ` for ${props.rule}`} yet.</p>
      ) : (
        <ul class="rpe-plain lre-stack" data-log>
          {list.items.map((f) => (
            <FiringLine key={f.id} firing={f.firing} placed={f} gate={gate} onRule={props.onRule} onTurn={props.onTurn} />
          ))}
        </ul>
      )}
      {list.more ? (
        <Button busy={list.loading} onClick={list.older}>
          Older firings
        </Button>
      ) : null}
    </Section>
  );
}

export function RulesPage(props: { chat: string | null; at: readonly string[] | undefined }) {
  const app = useApp();
  const { chat } = props;
  const [changed, setChanged] = useState(0);
  const rules = useRead(() => app.client.call("GET /api/v1/rules", {}, { query: chat === null ? {} : { chat } }), [chat, changed]);
  const switches = useRead(() => app.client.call("GET /api/v1/switches", {}).then((got) => got.switches), [changed]);
  const view = props.at?.[0] ?? null;
  const facts = useRead(view === FACTS ? () => app.client.call("GET /api/v1/rules/facts", {}, { query: chat === null ? {} : { chat } }) : null, [chat, view === FACTS]);
  const go = (at: string[]): void => app.go({ page: "rules", chat, at });
  const [switched, setSwitched] = useState<ReadonlyMap<string, RuleView>>(new Map());
  const list = sortedRules((rules.value?.rules ?? []).map((r) => switched.get(r.name) ?? r));
  const open = view === null || view === FACTS || view === LOG || view === HOOKS ? null : (list.find((r) => r.name === view) ?? null);
  const hooks = useHooks(chat, changed);
  const openHook = view === HOOKS ? hookAt(hooks.value?.rows ?? [], props.at ?? []) : null;
  const waiting = (switches.value ?? []).filter((s: SwitchEntry) => s.kind === "hook" || s.kind === "rule-command");
  const reload = (rule: RuleView | null): void => {
    if (rule !== null) setSwitched((held) => new Map(held).set(rule.name, rule));
    setChanged((n) => n + 1);
  };
  const detail = view !== null;
  return (
    <div class="lre-stack rpe-page" data-page="rules">
      <PageHeader
        title="Rules"
        sub={chat === null ? "The rules every new chat takes: the shipped level and yours." : "Every rule and hook of this chat, and whether it holds."}
        {...(detail ? { back: { label: "All rules", go: () => go([]) } } : {})}
        actions={
          <div class="lre-inline">
            <Button small kind="ghost" current={view === FACTS} onClick={() => go([FACTS])}>
              Facts
            </Button>
            {chat === null ? null : (
              <Button small kind="ghost" current={view === LOG} onClick={() => go([LOG])}>
                What fired
              </Button>
            )}
          </div>
        }
      />
      {view === FACTS ? (
        <FactsView facts={facts.value?.facts ?? null} problem={facts.problem} chat={chat} onRule={(name) => go([name])} />
      ) : view === LOG && chat !== null ? (
        <LogPart chat={chat} rule={props.at?.[1] ?? null} onRule={(rule) => go([LOG, rule])} onTurn={(turn) => app.go({ page: "turns", chat, at: [turn] })} />
      ) : (
        <div class="rpe-files-split" data-open={open === null && view !== HOOKS ? "no" : "yes"}>
          <div class="rpe-files-browser lre-stack">
            {rules.problem === null ? null : (
              <Banner tone="neg" icon="alert" title="The rules could not be read">
                <span>{rules.problem}</span>
              </Banner>
            )}
            {list.length === 0 && !rules.loading && rules.problem === null ? (
              <Empty icon="scroll" title="No rule">
                <span>No rule is in the stack of this chat.</span>
              </Empty>
            ) : (
              <ul class="lre-list" data-rules>
                {list.map((r) => (
                  <RuleLine key={`${r.level}:${r.path}`} rule={r} open={open?.name === r.name} onOpen={() => go([r.name])} />
                ))}
              </ul>
            )}
            {rules.loading && rules.value === null ? <p class="lre-muted rpe-line">Reading the rules…</p> : null}
            <p class="rpe-meta">{counted(list.filter((r) => r.inForce).length, "rule")} in force of {list.length}.</p>
            <HooksList rows={hooks.value?.rows ?? []} loading={hooks.loading} problem={hooks.problem} stopped={hooks.value?.stopped ?? false} open={openHook} onOpen={(row) => go(hookAddress(row))} />
            <WaitingSection switches={waiting} problem={switches.problem} />
          </div>
          {view === null ? null : view === HOOKS ? (
            <div class="lre-stack rpe-open-session">
              {openHook === null ? (
                <p class="lre-muted rpe-line">{hooks.loading ? "Reading the hooks…" : "No hook of that name is in this stack."}</p>
              ) : (
                <HookOpen key={`${openHook.file.path}:${openHook.hook.name}`} chat={chat} row={openHook} onChanged={() => setChanged((n) => n + 1)} onFile={(path) => app.go({ page: "files", chat, at: [path] })} />
              )}
            </div>
          ) : (
            <div class="lre-stack rpe-open-session">
              {open === null ? (
                <p class="lre-muted rpe-line">{rules.loading ? "Reading the rules…" : "No rule of that name is in this stack."}</p>
              ) : (
                <RuleOpen
                  key={`${open.level}:${open.path}`}
                  chat={chat}
                  rule={open}
                  onChanged={reload}
                  onAgent={(definition) => app.go({ page: "agents", chat, at: [definition] })}
                  onTurn={(turn) => (chat === null ? undefined : app.go({ page: "turns", chat, at: [turn] }))}
                  onFile={(path) => app.go({ page: "files", chat, at: [path] })}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const entry: PageEntry = { id: "rules", title: "Rules", icon: "scroll", shells: ["web", "drawer"], needsChat: false, withChat: true, often: false, order: 58, render: (route) => <RulesPage chat={route.chat ?? null} at={route.at} /> };

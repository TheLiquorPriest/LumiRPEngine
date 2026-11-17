// Settings (plan §14, §5.2, §5.4 "Config", §2.1 point 5): every setting RPH and RPE read, found by what it does. The page is in
// sections of plain words, chosen from a row of them (a column beside the settings where the page is wide); a search over every
// setting's name and what it does; and a filter to the settings he changed. Each setting shows what it does, the control that fits
// it, its unit, the advice its value passes, what was shipped and a way back to it, and where it is set. With a chat open he chooses
// whether a change is for every chat or for this chat alone. The settings set for one connection or one agent at a time are a table,
// a row for each. The install's facts, and what waits for the server's command line, are listed under Server and service.

import { useEffect, useRef, useState } from "preact/hooks";
import { Badge, Banner, Button, Disclosure, PageHeader, SearchField, Seg } from "../../../frontend/components";
import type { LayerLevel, LoreBooks, SettingsReply, SettingView, SwitchEntry } from "../../../shared/api";
import type { JsonValue } from "../../../shared/json";
import { useApp } from "../../app";
import { useRead } from "../../reading";
import type { RpeClient } from "../../client";
import type { PageEntry } from "../../page-entry";
import { useUiSettings } from "../../ui-settings";
import { errorWords, LEVEL_WORDS } from "../../words";
import { type ChangeLevel, isChanged, type SectionShown, sectionsOf, settingMatches } from "./model";
import { type RowActions, SettingRow } from "./row";
import { SettingsTable } from "./table";
import { WaitingSection } from "./waiting";

// ---------------------------------------------------------------- the calls and the state over them

export interface SettingsCalls {
  read(): Promise<SettingsReply>;
  /** Writes `key` at `level`: `value` null takes it away there, and `none` sets `~`. */
  write(level: LayerLevel, key: string, value: JsonValue, none: boolean): Promise<SettingsReply>;
}

/** The calls for `chat` (null: the levels every chat shares). */
export function settingsCalls(client: Pick<RpeClient, "call">, chat: string | null): SettingsCalls {
  return {
    read: () => client.call("GET /api/v1/settings", {}, { query: chat === null ? {} : { chat } }),
    write: (level, key, value, none) => client.call("PUT /api/v1/settings", {}, { body: { level, chat, key, value, none } }),
  };
}

/** What a page over the settings holds: the settings once read, or why they could not be; the key a write is out for; and RPE's refusal of the last write, by its key. */
export interface SettingsShown {
  reply: SettingsReply | null;
  loading: boolean;
  problem: string | null;
  busy: string | null;
  refusal: { key: string; words: string } | null;
}

export const NO_SETTINGS: SettingsShown = { reply: null, loading: true, problem: null, busy: null, refusal: null };

export interface SettingsControl extends RowActions {
  stop(): void;
}

/** The state over the calls: the settings at once, and as RPE answers each write; nothing once `stop()` is called. `written` is told of each write RPE took. */
export function settingsControl(calls: SettingsCalls, onChange: (shown: SettingsShown) => void, written: () => void = () => undefined): SettingsControl {
  let shown = NO_SETTINGS;
  let alive = true;
  const show = (next: SettingsShown): void => {
    if (!alive) return;
    shown = next;
    onChange(next);
  };
  calls.read().then(
    (reply) => show({ ...shown, reply, loading: false, problem: null }),
    (error: unknown) => show({ ...shown, loading: false, problem: errorWords(error) }),
  );
  const write = (key: string, level: LayerLevel, value: JsonValue, none: boolean): void => {
    show({ ...shown, busy: key, refusal: null });
    calls.write(level, key, value, none).then(
      (reply) => {
        show({ ...shown, reply, busy: null });
        written();
      },
      (error: unknown) => show({ ...shown, busy: null, refusal: { key, words: errorWords(error) } }),
    );
  };
  return {
    onWrite: write,
    onTakeAway: (key, level) => write(key, level, null, false),
    stop() {
      alive = false;
    },
  };
}

/**
 * The settings of a chat's levels (null: those every chat shares), read and written by one control while the page is open; `written`
 * hears of each write RPE took. A change of `again` reads them again (a definition added by a file written), what was read staying
 * shown until the new read comes.
 */
export function useSettings(chat: string | null, written: () => void = () => undefined, again: unknown = null): { shown: SettingsShown; actions: RowActions } {
  const app = useApp();
  // The page's own settings (pages.*) are read again after each write.
  const ui = useUiSettings();
  const [shown, setShown] = useState<SettingsShown>(NO_SETTINGS);
  const [control, setControl] = useState<SettingsControl | null>(null);
  const readFor = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (readFor.current !== chat) setShown(NO_SETTINGS);
    readFor.current = chat;
    const made = settingsControl(settingsCalls(app.client, chat), setShown, () => {
      ui.reread();
      written();
    });
    setControl(made);
    return () => made.stop();
  }, [chat, again]);
  return { shown, actions: { onWrite: (key, level, value, none) => control?.onWrite(key, level, value, none), onTakeAway: (key, level) => control?.onTakeAway(key, level) } };
}

// ---------------------------------------------------------------- the view

/** The settings that name a connection or a definition, by key: each is chosen among them rather than typed. */
const NAMES: Readonly<Record<string, "connections" | "definitions">> = { passConnection: "connections", "embedding.connection": "connections", "rules.judge": "connections", lead: "definitions" };

/** The section the facts of the install and what waits for the server are shown under. */
const SERVER_SECTION = "Server and service";

export interface SettingsViewProps extends RowActions {
  chat: string | null;
  shown: SettingsShown;
  /** Where a change goes: every chat, or this chat (with a chat open). */
  level: ChangeLevel;
  onLevel(level: ChangeLevel): void;
  query: string;
  onQuery(query: string): void;
  changedOnly: boolean;
  onChangedOnly(on: boolean): void;
  /** The section shown; null for the first, or the one that holds `openKey`. */
  section: string | null;
  onSection(title: string): void;
  /** The setting the address names: its section is shown and it is marked. */
  openKey: string | null;
  /** His connections' and definitions' names, which the settings that name one are chosen among. */
  connections: readonly string[] | null;
  definitions: readonly string[] | null;
  books: LoreBooks | null;
  switches: readonly SwitchEntry[] | null;
  switchesProblem: string | null;
  onGo(page: "connections" | "agents"): void;
}

function SectionBody(props: SettingsViewProps & { shownSection: SectionShown }) {
  const section = props.shownSection;
  const choices = (s: SettingView): readonly string[] | null => {
    const from = NAMES[s.key];
    return from === undefined ? null : from === "connections" ? props.connections : props.definitions;
  };
  const refusalOf = (key: string): string | null => (props.shown.refusal !== null && props.shown.refusal.key === key ? props.shown.refusal.words : null);
  return (
    <section class="rpe-set-section" data-section={section.title}>
      <div class="rpe-set-sectionhead">
        <h3 class="lre-section-title">{section.title}</h3>
        <p class="rpe-meta">{section.about}</p>
      </div>
      {section.title === "Agents" ? (
        <p class="rpe-line rpe-meta">
          Each agent's effort and limits are also on its page.{" "}
          <Button size="sm" variant="ghost" onClick={() => props.onGo("agents")}>
            Agents
          </Button>{" "}
          A model's window and longest reply are its connection's.{" "}
          <Button size="sm" variant="ghost" onClick={() => props.onGo("connections")}>
            Connections
          </Button>
        </p>
      ) : null}
      {section.groups.map((group) => (
        <div key={group.title} class="rpe-set-group" data-group={group.title}>
          <h4 class="rpe-set-grouptitle">{group.title}</h4>
          {group.table !== null ? (
            <SettingsTable settings={group.settings} kind={group.table} level={props.level} busy={props.shown.busy} refusal={props.shown.refusal} choices={choices} books={props.books} openKey={props.openKey} onWrite={props.onWrite} onTakeAway={props.onTakeAway} />
          ) : (
            <ul class="rpe-plain rpe-set-rows">
              {group.settings.map((s) => (
                <SettingRow key={s.key} setting={s} level={props.level} busy={props.shown.busy} refusal={refusalOf(s.key)} choices={choices(s)} books={props.books} opened={props.openKey === s.key} onWrite={props.onWrite} onTakeAway={props.onTakeAway} />
              ))}
            </ul>
          )}
        </div>
      ))}
      {section.title === SERVER_SECTION ? <ServerExtras {...props} /> : null}
    </section>
  );
}

/** What the command line sets and what waits for it: listed, never written here. */
function ServerExtras(props: SettingsViewProps) {
  const facts = props.shown.reply?.facts ?? [];
  return (
    <>
      <WaitingSection switches={props.switches} problem={props.switchesProblem} />
      {facts.length === 0 ? null : (
        <Disclosure summary={`The install (${facts.length})`}>
          <p class="rpe-meta">Set by the command line (rpe up, rpe lumiverse), never on this page.</p>
          <ul class="lre-stack rpe-plain">
            {facts.map((fact) => (
              <li key={fact.key} class="rpe-line" data-fact={fact.key}>
                <strong>{fact.name}</strong>: {fact.value === null ? "not set" : typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)}
                <span class="rpe-meta">{fact.from === "environment" ? " (given by the environment, over config.json)" : fact.from === "install" ? " (where the install put it)" : " (config.json)"}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </>
  );
}

export function SettingsView(props: SettingsViewProps) {
  const { shown } = props;
  const reply = shown.reply;
  const searching = props.query.trim() !== "";
  const filtering = searching || props.changedOnly;
  const all = reply === null ? [] : sectionsOf(reply.sections, reply.settings);
  const shownSettings = reply === null ? [] : reply.settings.filter((s) => settingMatches(s, props.query) && (!props.changedOnly || isChanged(s)));
  const found = reply === null ? [] : sectionsOf(reply.sections, shownSettings);
  const changedCount = reply === null ? 0 : reply.settings.filter(isChanged).length;
  const holding = props.openKey === null ? undefined : reply?.settings.find((s) => s.key === props.openKey)?.section;
  const current = all.find((s) => s.title === (props.section ?? holding)) ?? all[0];
  return (
    <div class="lre-stack rpe-page rpe-set-page" data-page="settings" data-chat={props.chat ?? undefined}>
      <PageHeader title="Settings" subtitle={props.chat === null ? "What RPE and its agents run under. A change here is for every chat; open a chat to make one for it alone." : "What RPE and its agents run under in this chat."} />
      {props.chat === null ? null : (
        <div class="rpe-set-levelbar">
          <span class="rpe-meta">A change here is</span>
          <Seg
            value={props.level}
            options={[
              { value: "global", label: "For every chat" },
              { value: "chat", label: "For this chat only" },
            ]}
            label="Where a change goes"
            onChange={props.onLevel}
          />
        </div>
      )}
      <div class="rpe-set-tools">
        <SearchField value={props.query} label="Find a setting" placeholder="Find a setting by what it does" status={searching ? `${shownSettings.length} found` : undefined} onInput={props.onQuery} />
        <button type="button" class="rpe-set-filter" aria-pressed={props.changedOnly} onClick={() => props.onChangedOnly(!props.changedOnly)}>
          Changed <Badge tone={changedCount > 0 ? "accent" : "neutral"}>{String(changedCount)}</Badge>
        </button>
      </div>
      {shown.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The settings could not be read">
          <span>{shown.problem}</span>
        </Banner>
      )}
      {reply === null ? (
        shown.loading ? <p class="lre-muted rpe-line">Reading the settings…</p> : null
      ) : (
        <>
          {reply.files.flatMap((f) =>
            f.problem === null
              ? []
              : [
                  <Banner key={f.file} tone="warn" icon="alert" title={`${f.file} could not be read`}>
                    <span>{f.problem}</span>
                  </Banner>,
                ],
          )}
          {filtering ? (
            <div class="lre-stack rpe-set-body">
              <p class="rpe-meta">{shownSettings.length === 0 ? (props.changedOnly && !searching ? "Nothing differs from what was shipped." : "No setting matches that.") : `${shownSettings.length} ${shownSettings.length === 1 ? "setting" : "settings"}${props.changedOnly ? " changed" : ""}${searching ? " found" : ""}.`}</p>
              {found.map((section) => (
                <SectionBody key={section.title} {...props} shownSection={section} />
              ))}
            </div>
          ) : (
            <div class="rpe-set-layout">
              <nav class="rpe-set-nav" aria-label="Sections">
                {all.map((section) => (
                  <button key={section.title} type="button" aria-current={section === current ? "true" : undefined} onClick={() => props.onSection(section.title)}>
                    <span>{section.title}</span>
                    {section.changed > 0 ? <Badge tone="accent">{String(section.changed)}</Badge> : null}
                  </button>
                ))}
              </nav>
              <div class="lre-stack rpe-set-body">{current === undefined ? null : <SectionBody {...props} shownSection={current} />}</div>
            </div>
          )}
          <p class="rpe-meta">Read from {reply.files.map((f) => `${f.file} (${LEVEL_WORDS[f.level]})`).join(", ")}.</p>
        </>
      )}
    </div>
  );
}

export function SettingsPage(props: { chat: string | null; at?: readonly string[] }) {
  const app = useApp();
  const { chat } = props;
  const { shown, actions } = useSettings(chat);
  const [level, setLevel] = useState<ChangeLevel>(chat === null ? "global" : "chat");
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [section, setSection] = useState<string | null>(null);
  const openKey = props.at?.[0] ?? null;
  const switches = useRead(() => app.client.call("GET /api/v1/switches", {}).then((got) => got.switches), []);
  const connections = useRead(() => app.client.call("GET /api/v1/connections", {}).then((got) => got.connections.map((c) => c.name)), []);
  const definitions = useRead(() => app.client.call("GET /api/v1/agents", {}, { query: chat === null ? {} : { chat } }).then((got) => got.agents.map((a) => a.name)), [chat]);
  // His books are the choice `lore.books` is made from; with no chat open there are none to choose among.
  const books = useRead(chat === null ? null : () => app.client.call("GET /api/v1/chats/:chat/lore/books", { chat }), [chat]);
  useEffect(() => setLevel(chat === null ? "global" : "chat"), [chat]);
  // The setting the address names is brought into view once the settings are read.
  useEffect(() => {
    if (openKey === null || shown.reply === null) return;
    globalThis.document?.querySelector(`[data-setting="${CSS.escape(openKey)}"]`)?.scrollIntoView({ block: "center" });
  }, [openKey, shown.reply === null]);
  return (
    <SettingsView
      chat={chat}
      shown={shown}
      level={level}
      onLevel={setLevel}
      query={query}
      onQuery={setQuery}
      changedOnly={changedOnly}
      onChangedOnly={setChangedOnly}
      section={section}
      onSection={setSection}
      openKey={openKey}
      connections={connections.value}
      definitions={definitions.value}
      books={books.value}
      switches={switches.value}
      switchesProblem={switches.problem}
      onGo={(page) => app.go({ page, chat })}
      {...actions}
    />
  );
}

export const entry: PageEntry = { id: "settings", title: "Settings", icon: "sliders", shells: ["web", "drawer"], needsChat: false, withChat: true, often: false, order: 110, render: (route) => <SettingsPage chat={route.chat ?? null} at={route.at} /> };

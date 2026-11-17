// A record's lore bindings, read and edited by him (plan §9.3, §14 Places and Lore; PlanLore-2): which lore entries define a place, a person, a thing
// or a quest, and which aspect of it each defines. The lore keeps them (`defines` of an entry, one store for an indexing run's, casting's, the
// bootstrap's and his own); what he sets stands over a run's and outlives a run that redoes the entry. Two sides of one edit: `RecordBindings` for a
// record that is open (the Places page; the Cast page may mount it for a character): its entries, with a way to bind another; and `EntryBindings`
// for an entry that is open (the Lore page): the records it is bound to, with a way to bind another. A pin of the world's own is Build's to change.

import { useState } from "preact/hooks";
import type { LoreIndexRow } from "../shared/api";
import { useApp } from "./app";
import { Badge, Banner, Button } from "../frontend/components";
import { replyOf, type RpeClient } from "./client";
import { useRead } from "./reading";
import { useUiSetting } from "./ui-settings";
import { counted, errorWords } from "./words";

/** Who bound what, in words. */
export const BOUND_BY_WORDS: Readonly<Record<string, string>> = { run: "an indexing run", casting: "casting", bootstrap: "the bootstrap", owner: "you", pin: "the world's own pin", world: "the world's own place", play: "play" };

/** A binding's makers whose bindings sit in an entry's `defines`, which he can change; the rest are the world's or play's own. */
const CHANGEABLE: readonly string[] = ["run", "casting", "bootstrap", "owner"];

type Defines = { what: string; aspect: string }[];

/** Whether the words an entry's `defines` names a record by (its ref, its id or its name, as he or a run wrote them) are that record. */
export function namesRecord(what: string, record: { ref: string; names?: readonly string[] }): boolean {
  const key = what.trim().toLowerCase();
  const tail = record.ref.includes(":") ? record.ref.slice(record.ref.indexOf(":") + 1) : record.ref;
  return [record.ref, tail, ...(record.names ?? [])].some((n) => n.trim().toLowerCase() === key);
}

/** The entry's row from the lore index, read a page at a time until it is found. */
async function entryRow(client: Pick<RpeClient, "call">, chat: string, entry: string, limit: number): Promise<LoreIndexRow> {
  let cursor: string | undefined;
  for (;;) {
    const page = replyOf(await client.call("GET /api/v1/chats/:chat/lore/index", { chat }, { query: { limit, ...(cursor === undefined ? {} : { cursor }) } }));
    const found = page.items.find((row) => row.id === entry);
    if (found !== undefined) return found;
    if (page.next === null || page.next === cursor) throw new Error(`The lore index holds no entry ${entry}.`);
    cursor = page.next;
  }
}

/** Sets what an entry defines as his own: `change` is given what it defines now and gives what it should. */
async function redefine(client: Pick<RpeClient, "call">, chat: string, row: LoreIndexRow, change: (now: Defines) => Defines): Promise<LoreIndexRow> {
  return client.call("PUT /api/v1/chats/:chat/lore/index/:entry", { chat, entry: row.id }, { body: { defines: change(row.defines.map((d) => ({ what: d.what, aspect: d.aspect }))) } });
}

/** Every entry of the chat's lore, its pages read one after another to the end, for the choice of one to bind. */
async function everyEntry(client: Pick<RpeClient, "call">, chat: string, limit: number): Promise<LoreIndexRow[]> {
  const rows: LoreIndexRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = replyOf(await client.call("GET /api/v1/chats/:chat/lore/index", { chat }, { query: { limit, ...(cursor === undefined ? {} : { cursor }) } }));
    rows.push(...page.items);
    if (page.next === null || page.next === cursor) return rows;
    cursor = page.next;
  }
}

function useDoing(): { busy: string | null; problem: string | null; said: string | null; run(what: string, go: () => Promise<string>): void } {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const run = (what: string, go: () => Promise<string>): void => {
    if (busy !== null) return;
    setBusy(what);
    setProblem(null);
    go().then(
      (words) => {
        setBusy(null);
        setSaid(words);
      },
      (error: unknown) => {
        setBusy(null);
        setProblem(errorWords(error));
      },
    );
  };
  return { busy, problem, said, run };
}

function Told(props: { problem: string | null; said: string | null }) {
  return (
    <>
      {props.said === null ? null : (
        <Banner tone="info" icon="check" title="Done">
          <span data-said>{props.said}</span>
        </Banner>
      )}
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not done">
          <span data-problem>{props.problem}</span>
        </Banner>
      )}
    </>
  );
}

/** An entry bound to the open record, as the record gives it. */
export interface BoundEntry {
  entry: string;
  aspect: string;
  by: string;
  title: string | null;
}

export interface RecordBindingsProps {
  chat: string;
  /** The open record: its ref in the tree (`place:harbor`) and the names the lore may write it by. */
  record: { ref: string; names: readonly string[] };
  bound: readonly BoundEntry[];
  /** Called after any change, for the page to read the record again. */
  onChanged(): void;
}

/** The entries bound to the open record, each with the aspect it defines, which he can change or take off, and a choice of another entry of the chat's lore to bind. */
export function RecordBindings(props: RecordBindingsProps) {
  const { chat, record } = props;
  const app = useApp().client;
  const limit = useUiSetting("rowsAtOnce");
  const doing = useDoing();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [aspect, setAspect] = useState("");
  const entries = useRead(adding ? () => everyEntry(app, chat, limit) : null, [chat, adding]);
  const matches = (entries.value ?? []).filter((row) => query.trim() === "" || [row.title, row.source, row.id, ...row.keys].some((t) => t.toLowerCase().includes(query.trim().toLowerCase())));
  const bind = (row: LoreIndexRow): void =>
    doing.run(`bind ${row.id}`, async () => {
      const wanted = aspect.trim();
      await redefine(app, chat, row, (now) => [...now.filter((d) => !(namesRecord(d.what, record) && d.aspect === wanted)), { what: record.ref, aspect: wanted }]);
      props.onChanged();
      return `${row.title} is bound${wanted === "" ? "" : `, defining its ${wanted}`}; it is yours and a run that indexes the entry again leaves it.`;
    });
  const change = (b: BoundEntry, to: string | null): void =>
    doing.run(`change ${b.entry}`, async () => {
      const row = await entryRow(app, chat, b.entry, limit);
      await redefine(app, chat, row, (now) => {
        const rest = now.filter((d) => !(namesRecord(d.what, record) && d.aspect === b.aspect));
        return to === null ? rest : [...rest, { what: record.ref, aspect: to.trim() }];
      });
      props.onChanged();
      return to === null ? `${b.title ?? b.entry} no longer defines it.` : `${b.title ?? b.entry} defines ${to.trim() === "" ? "it, no aspect named" : `its ${to.trim()}`}.`;
    });
  return (
    <div class="lre-stack" data-bindings>
      {props.bound.length === 0 ? <p class="lre-muted rpe-line">No lore entry is bound to it.</p> : null}
      <ul class="rpe-plain lre-stack">
        {props.bound.map((b) => (
          <BoundLine key={`${b.entry}:${b.aspect}`} bound={b} busy={doing.busy} onAspect={(to) => change(b, to)} onTake={() => change(b, null)} />
        ))}
      </ul>
      <Told problem={doing.problem} said={doing.said} />
      {adding ? (
        <div class="lre-stack" data-bind-entry>
          <label class="lre-field">
            <span>Search the chat's lore</span>
            <input class="lre-input" type="search" value={query} placeholder="a title, a key, an id" onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label class="lre-field">
            <span>The aspect of it that the entry defines</span>
            <input class="lre-input" value={aspect} placeholder="layout, history, … or none" onInput={(e) => setAspect((e.currentTarget as HTMLInputElement).value)} />
          </label>
          {entries.problem === null ? null : <p class="rpe-line">{entries.problem}</p>}
          {entries.loading && entries.value === null ? <p class="lre-muted rpe-line">Reading the chat's lore…</p> : null}
          <ul class="rpe-plain lre-stack" data-entry-choices>
            {matches.slice(0, limit).map((row) => (
              <li key={row.id} class="lre-inline rpe-wrap" data-choice={row.id}>
                <span class="rpe-line">
                  {row.title} <span class="rpe-meta">{row.id} · {row.source}</span>
                </span>
                <Button size="sm" busy={doing.busy === `bind ${row.id}`} onClick={() => bind(row)}>
                  Bind it
                </Button>
              </li>
            ))}
          </ul>
          {matches.length > limit ? <p class="rpe-meta">{counted(matches.length - limit, "more entry", "more entries")} match: narrow the search.</p> : null}
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Done binding
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
          Bind an entry to it
        </Button>
      )}
    </div>
  );
}

function BoundLine(props: { bound: BoundEntry; busy: string | null; onAspect(to: string): void; onTake(): void }) {
  const { bound: b } = props;
  const [aspect, setAspect] = useState(b.aspect);
  const mine = CHANGEABLE.includes(b.by);
  return (
    <li class="rpe-entry lre-stack" data-bound={b.entry}>
      <p class="rpe-line">
        {b.title ?? <span class="lre-muted">an entry Lumiverse no longer holds</span>} <code class="lre-id">{b.entry}</code> <Badge>{BOUND_BY_WORDS[b.by] ?? b.by}</Badge>
      </p>
      {mine ? (
        <div class="lre-inline rpe-wrap">
          <label class="lre-field">
            <span class="label">Defines its</span>
            <input class="lre-input" value={aspect} placeholder="an aspect, or none" onInput={(e) => setAspect((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <Button size="sm" busy={props.busy === `change ${b.entry}`} disabled={aspect === b.aspect} onClick={() => props.onAspect(aspect)}>
            Change the aspect
          </Button>
          <Button size="sm" variant="ghost" busy={props.busy === `change ${b.entry}`} onClick={props.onTake}>
            Take the binding off
          </Button>
        </div>
      ) : (
        <p class="rpe-meta">{b.aspect === "" ? "It names no aspect." : `It defines its ${b.aspect}.`} This one is {b.by === "pin" ? "the world's own pin: it is changed in Build" : `${BOUND_BY_WORDS[b.by] ?? b.by}'s: it is not a line of the entry's`}.</p>
      )}
    </li>
  );
}

export interface EntryBindingsProps {
  chat: string;
  row: LoreIndexRow;
  /** Called with the entry as it now stands, after a change. */
  onChanged(row: LoreIndexRow): void;
}

/** The records an entry is bound to, each with its aspect, which he can take off, and a field to bind it to another record, named by its ref or its name. */
export function EntryBindings(props: EntryBindingsProps) {
  const { chat, row } = props;
  const client = useApp().client;
  const doing = useDoing();
  const [record, setRecord] = useState("");
  const [aspect, setAspect] = useState("");
  const apply = (what: string, change: (now: Defines) => Defines, words: string): void =>
    doing.run(what, async () => {
      props.onChanged(await redefine(client, chat, row, change));
      return words;
    });
  return (
    <div class="lre-stack" data-entry-bindings={row.id}>
      <ul class="rpe-plain lre-stack">
        {row.links.map((l) => (
          <li key={`${l.record}:${l.aspect}:${l.by}`} class="lre-inline rpe-wrap" data-link={l.record}>
            <span class="rpe-line">
              <code class="lre-id">{l.record}</code>
              {l.linked ? "" : " (no record of that name)"}
              {l.aspect === "" ? "" : `, ${l.aspect}`} <Badge>{BOUND_BY_WORDS[l.by] ?? l.by}</Badge>
            </span>
            {CHANGEABLE.includes(l.by) ? (
              <Button size="sm" variant="ghost" busy={doing.busy === `take ${l.record}`} onClick={() => apply(`take ${l.record}`, (now) => now.filter((d) => !(namesRecord(d.what, { ref: l.record }) && d.aspect === l.aspect)), `${l.record} is no longer bound to ${row.title}.`)}>
                Take it off
              </Button>
            ) : (
              <span class="rpe-meta">the world's own pin, changed in Build</span>
            )}
          </li>
        ))}
      </ul>
      <div class="lre-inline rpe-wrap">
        <label class="lre-field">
          <span class="label">Bind it to the record</span>
          <input class="lre-input" value={record} placeholder="place:harbor, entity:sefa, or a name" onInput={(e) => setRecord((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label class="lre-field">
          <span class="label">It defines its</span>
          <input class="lre-input" value={aspect} placeholder="an aspect, or none" onInput={(e) => setAspect((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <Button size="sm" busy={doing.busy === "bind"} disabled={record.trim() === ""} onClick={() => apply("bind", (now) => [...now, { what: record.trim(), aspect: aspect.trim() }], `${row.title} is bound to ${record.trim()}; it is yours and a run that indexes the entry again leaves it.`)}>
          Bind
        </Button>
      </div>
      <Told problem={doing.problem} said={doing.said} />
    </div>
  );
}

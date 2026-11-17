// World (plan §14): the chat's world as one tree (plan §6.4), opened at any level and to any depth, at
// the chat's head or as it stood at one of its turns. Each level shows what is beneath it, and its values,
// each with where it comes from (its own, inherited from a level above, or kept by a game system) and the
// change that last wrote it; beside each value stand the facts recorded on the level with the same key,
// which never overwrite it (plan §6.6). The page opens behind the spoiler gate: shut, it shows and reads
// nothing of the tree, its counts included. Open, any value or fact can be changed or removed as the
// owner's own edit, any value's history is read turn by turn, a level's typed systems are read as each
// keeps them, what a turn's time brought due is shown where it concerns, and an earlier reply showing
// another swipe lists the later changes that no longer apply. Its address is a level and a value
// (`at: [level, key]`), so a link from a panel lands there.

import { useEffect, useRef, useState } from "preact/hooks";
import type { DueReply, LevelNode, TurnRow, WorldReply } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Gated, PageHeader } from "../../../frontend/components";
import type { PageEntry } from "../../page-entry";
import { useRead } from "../../reading";
import { useSelect } from "../../store";
import { TURN_KIND_WORDS } from "../../trace-view";
import { KeptThings } from "../../kept/things-page";
import { useUiSetting } from "../../ui-settings";
import type { NotAppliedReply } from "../../../shared/api";
import { counted, when } from "../../words";
import { readTurns } from "../turns";
import { NodeTree, type WorldSlots } from "./parts";
import { readDue, readNotApplied, readWorld, type ValuesShown, WORLD_START, type WorldQuery } from "./read";
import { NodeTools, RowTools } from "./tools";

export { readWorld, WORLD_START };
export type { ValuesShown, WorldQuery, WorldResult } from "./read";

const VALUE_CHOICES: readonly { values: ValuesShown; words: string }[] = [
  { values: "all", words: "With what it inherits" },
  { values: "own", words: "Its own" },
  { values: "none", words: "None" },
];

const GATE_WHY = "The world holds its secrets as well as what the story has shown: every value and fact of it, and how many there are, can give away what comes next.";

/** The later changes that no longer apply on the swipe an earlier reply now shows, each with its turn and why. */
export function NotApplied(props: { read: NotAppliedReply | null }) {
  const { read } = props;
  if (read === null || read.reply === null || read.items.length === 0) return null;
  return (
    <Banner tone="warn" icon="alert" title={`Reply ${read.reply.n} shows another swipe: ${counted(read.items.length, "later change")} no longer apply`}>
      <span>The later turns' changes are applied again on top of the swipe now showing; these could not be. Flipping back restores what was.</span>
      <ul class="rpe-reports" data-not-applied>
        {read.items.map((item) => (
          <li key={item.change}>
            Turn {item.n}: {item.words || item.op} — {item.reason}
          </li>
        ))}
      </ul>
    </Banner>
  );
}

/** What the chosen turn's time brought due, each with the outcome recorded for it; those at a level also show at it. */
export function DueSection(props: { read: DueReply | null }) {
  const { read } = props;
  if (read === null || read.items.length === 0) return null;
  return (
    <section class="lre-section" data-section="due">
      <div class="lre-section-head">
        <h3 class="lre-section-title">What the time brought due</h3>
        {read.span === null ? null : <Badge>{`${read.span.from} to ${read.span.to}`}</Badge>}
      </div>
      <ul class="lre-section-body rpe-plain lre-stack">
        {read.items.map((item, i) => (
          <li key={i} class="rpe-entry">
            <p class="rpe-line">
              <Badge>{item.kind}</Badge> {item.words} <span class="rpe-meta">({item.when})</span>
            </p>
            <p class="rpe-meta">{item.outcome === null ? "No outcome recorded yet." : `Outcome: ${item.outcome}`}</p>
          </li>
        ))}
      </ul>
      {read.more === 0 ? null : <p class="rpe-meta lre-section-body">{read.more === null ? "More fell due than this list holds." : `${counted(read.more, "more item")} fell due than this list holds.`}</p>}
    </section>
  );
}

export interface WorldViewProps {
  query: WorldQuery;
  answer: WorldReply | null;
  loading: boolean;
  /** RPE's refusal of the last read, in its words; null when it answered. */
  problem: string | null;
  /** The chat's turns on RPE, newest first, to see the world as it stood at one; null until read. */
  turns: readonly TurnRow[] | null;
  /** Older turns remain to be read for "As it stood", and the way to read them. */
  moreTurns?: { more: boolean; onMore(): void };
  /** Whether the spoiler gate is open for this chat: shut, nothing of the world is shown. */
  gateOpen: boolean;
  onOpenGate(): void;
  onCloseGate(): void;
  onQuery(next: WorldQuery): void;
  /** What stands beside the tree's values and levels, and above it. */
  slots?: WorldSlots;
  notApplied?: NotAppliedReply | null;
  due?: DueReply | null;
}

export function WorldView(props: WorldViewProps) {
  const { query, answer } = props;
  const byRef = new Map((answer?.nodes ?? []).map((node) => [node.ref, node]));
  const root = answer === null ? undefined : byRef.get(answer.at);
  const parent = root?.parent ?? null;
  return (
    <div class="lre-stack rpe-page" data-page="world">
      <PageHeader title="World" subtitle="This chat's world as one tree: any level, to any depth." />
      <Gated open={props.gateOpen} onOpen={props.onOpenGate} onClose={props.onCloseGate} why={GATE_WHY}>
        <NotApplied read={props.notApplied ?? null} />
        <div class="lre-stack rpe-controls">
          <form
            class="rpe-point"
            onSubmit={(event) => {
              event.preventDefault();
              const at = new FormData(event.currentTarget).get("at");
              if (typeof at === "string" && at.trim() !== "") props.onQuery({ ...query, at: at.trim() });
            }}
          >
            <label class="lre-field">
              <span class="label">Level</span>
              <input key={query.at} name="at" class="lre-input" defaultValue={query.at} spellcheck={false} autoComplete="off" />
            </label>
            <button type="submit" class="lre-btn">
              Open
            </button>
          </form>
          <div class="lre-inline rpe-wrap">
            {parent === null ? null : (
              <Button size="sm" onClick={() => props.onQuery({ ...query, at: parent })}>
                Up a level
              </Button>
            )}
            {query.at === "world" ? null : (
              <Button size="sm" variant="ghost" onClick={() => props.onQuery({ ...query, at: "world" })}>
                The whole world
              </Button>
            )}
            <span class="lre-inline" aria-label="Depth">
              <Button size="sm" variant="ghost" disabled={query.depth === 0} onClick={() => props.onQuery({ ...query, depth: query.depth - 1 })}>
                Fewer levels
              </Button>
              <span class="lre-num rpe-meta">{counted(query.depth, "level")} down</span>
              <Button size="sm" variant="ghost" onClick={() => props.onQuery({ ...query, depth: query.depth + 1 })}>
                More levels
              </Button>
            </span>
          </div>
          <div class="lre-seg" role="group" aria-label="Values">
            {VALUE_CHOICES.map((choice) => (
              <button key={choice.values} type="button" aria-pressed={query.values === choice.values ? "true" : "false"} onClick={() => props.onQuery({ ...query, values: choice.values })}>
                {choice.words}
              </button>
            ))}
          </div>
          {props.turns !== null && props.turns.length === 0 ? (
            <p class="rpe-meta" data-as-it-stood="none">
              No turn of this chat has been played on RPE yet, so its world is shown as it stands now.
            </p>
          ) : (
            <label class="lre-field">
              <span class="label">As it stood</span>
              <select class="lre-input" value={query.turn ?? ""} onChange={(event) => props.onQuery({ ...query, turn: event.currentTarget.value === "" ? null : event.currentTarget.value })}>
                <option value="">Now, at the chat's head</option>
                {(props.turns ?? []).map((turn) => (
                  <option key={turn.id} value={turn.id}>
                    {`After the turn of ${when(turn.timings.received)} (${TURN_KIND_WORDS[turn.kind]})`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {props.moreTurns?.more === true ? (
            <Button size="sm" variant="ghost" onClick={props.moreTurns.onMore}>
              Older turns
            </Button>
          ) : null}
        </div>
        {props.problem === null ? null : (
          <Banner tone="neg" icon="alert" title="The world could not be read">
            <span>{props.problem}</span>
          </Banner>
        )}
        <DueSection read={props.due ?? null} />
        {root === undefined ? props.loading ? <p class="lre-muted rpe-line">Reading the world…</p> : null : <NodeTree node={root} byRef={byRef} root query={query} slots={props.slots ?? {}} onQuery={props.onQuery} />}
        {props.slots?.things === undefined ? null : <div data-slot="things">{props.slots.things}</div>}
      </Gated>
    </div>
  );
}

/** The World page of a chat: the tree read again whenever where it looks changes, once the spoiler gate is open. */
export function WorldPage(props: { chat: string; at?: readonly string[] }) {
  const app = useApp();
  const { chat } = props;
  const level = props.at?.[0] ?? WORLD_START.at;
  const focus = props.at?.[1] ?? null;
  const turnsAtATime = useUiSetting("turnsAtATime");
  const gateOpen = useSelect(app.gate, (opened) => opened.has(chat));
  const [rest, setRest] = useState<Omit<WorldQuery, "at">>({ depth: WORLD_START.depth, values: WORLD_START.values, turn: WORLD_START.turn });
  const query: WorldQuery = { at: level, ...rest };
  const [shown, setShown] = useState<{ answer: WorldReply | null; loading: boolean; problem: string | null }>({ answer: null, loading: true, problem: null });
  const [turns, setTurns] = useState<readonly TurnRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [changes, setChanges] = useState(0);
  const reader = useRef<{ more(): void } | null>(null);
  useEffect(() => {
    setRest({ depth: WORLD_START.depth, values: WORLD_START.values, turn: WORLD_START.turn });
    setShown({ answer: null, loading: true, problem: null });
    setTurns(null);
    setMore(false);
    // A read that failed leaves them unknown: the page then says nothing of whether any turn was played.
    const reading = readTurns(app.client, chat, turnsAtATime, (read) => {
      if (read.loading || read.problem !== null) return;
      setTurns(read.turns);
      setMore(read.more);
    });
    reader.current = reading;
    return reading.stop;
  }, [chat, turnsAtATime]);
  useEffect(() => {
    if (!gateOpen) {
      setShown({ answer: null, loading: false, problem: null });
      return;
    }
    setShown((held) => ({ ...held, loading: true }));
    return readWorld(app.client, chat, query, (result) => setShown((held) => ({ answer: result.answer ?? held.answer, loading: false, problem: result.problem })));
  }, [chat, gateOpen, level, rest.depth, rest.values, rest.turn, changes]);
  const head = rest.turn === null;
  const notApplied = useRead(gateOpen && head ? () => readNotApplied(app.client, chat) : null, [chat, gateOpen, head, changes]);
  const due = useRead(gateOpen ? () => readDue(app.client, chat, rest.turn) : null, [chat, gateOpen, rest.turn, changes]);
  const dueAt = (ref: string) => (due.value?.items ?? []).filter((item) => item.at === ref);
  const onChanged = (): void => setChanges((n) => n + 1);
  const slots: WorldSlots = {
    things: <KeptThings chat={chat} />,
    node: (node: LevelNode) => <NodeTools key={node.ref} chat={chat} node={node} turn={rest.turn} due={dueAt(node.ref)} onChanged={onChanged} />,
    value: (node, line) => <RowTools key={line.key} chat={chat} level={node.ref} part={line.key} as="value" current={line.value} turn={rest.turn} startOpen={node.ref === level && line.key === focus} onChanged={onChanged} />,
    fact: (node, fact) => <RowTools key={fact.id} chat={chat} level={node.ref} part={fact.key} as="fact" current={fact.value} turn={rest.turn} startOpen={false} onChanged={onChanged} />,
  };
  return (
    <WorldView
      query={query}
      {...shown}
      turns={turns}
      moreTurns={{ more, onMore: () => reader.current?.more() }}
      gateOpen={gateOpen}
      onOpenGate={() => app.gate.open(chat)}
      onCloseGate={() => app.gate.close(chat)}
      slots={slots}
      notApplied={notApplied.value}
      due={due.value}
      onQuery={(next) => {
        setRest({ depth: next.depth, values: next.values, turn: next.turn });
        if (next.at !== level) app.go({ page: "world", chat, at: [next.at] });
      }}
    />
  );
}

export const entry: PageEntry = { id: "world", title: "World", icon: "globe", shells: ["web", "drawer"], needsChat: true, often: true, order: 40, render: (route) => <WorldPage chat={route.chat} at={route.at} /> };

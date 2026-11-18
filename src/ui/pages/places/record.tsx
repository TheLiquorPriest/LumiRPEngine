// One place's record in its nine parts (plan §8.2, §14 Places), at the chat's newest turn or as it stood at one of its turns: the lore entries that
// define it (bound by him, a run, casting or the bootstrap) read as Lumiverse holds them now; its base, which he can write over; what the story
// changed there since, with the beat of each; its features; who and what is here; its ways; who may enter and the doors; its history; and who
// knows of it. A list a part keeps short says how many it leaves out. Its grid, with everyone and everything on it, is the page's own pane.

import { useState } from "preact/hooks";
import type { PlaceBase, PlaceFactRow, PlaceRecord } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Section } from "../../../frontend/components";
import { RecordBindings } from "../../bindings";
import { replyOf } from "../../client";
import { useRead } from "../../reading";
import { useUiSetting } from "../../ui-settings";
import { counted, errorWords, when } from "../../words";
import { GridPane } from "./grid";

/** How many a part leaves out, in words; nothing where it leaves none. */
function More(props: { n: number; of: string }) {
  return props.n === 0 ? null : <p class="rpe-meta" data-more>{counted(props.n, props.of)} more {props.n === 1 ? "is" : "are"} left out of this part, as the chat's places settings keep it short.</p>;
}

/** What a fact says about itself beside its words: how exact, how sure, from where, by whom, at which turn and story time. */
export function factMeta(f: PlaceFactRow): string {
  return [
    `turn ${f.n}`,
    f.time === null ? null : f.time,
    f.precision === null ? null : f.precision,
    f.standing === null ? null : f.standing,
    f.source === null ? null : `from ${f.source}`,
    f.by === null ? null : `by ${f.by}`,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

function Facts(props: { items: readonly PlaceFactRow[]; onTurn(turn: string): void }) {
  return (
    <ul class="rpe-plain lre-stack">
      {props.items.map((f) => (
        <li key={f.id} class="rpe-entry" data-fact={f.id}>
          <p class="rpe-line">
            <strong>{f.key}</strong>: {f.value}
          </p>
          <p class="rpe-meta">
            {factMeta(f)}
            {f.beat === null ? null : (
              <>
                {" · the beat: "}
                {f.beat.text ?? f.beat.id}
                {f.beat.message === null ? "" : ` (message ${f.beat.message})`}
              </>
            )}{" "}
            <Button size="sm" variant="ghost" onClick={() => props.onTurn(f.turn)}>
              Open turn {f.n}
            </Button>
          </p>
        </li>
      ))}
    </ul>
  );
}

const BASE_WORDS = (base: PlaceBase): string => {
  if (base.text === null) return "No words stand for the place yet.";
  if (base.world) return `These are the world's own words for it${base.revision === null ? "" : `, at revision ${base.revision}`}; no base was written.`;
  return `Written ${base.by === null ? "" : `by ${base.by} `}${base.turn === null ? "as your own change after the newest reply" : "in a turn"}.`;
};

function BasePart(props: { chat: string; record: PlaceRecord; onChanged(): void }) {
  const app = useApp();
  const { chat, record } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const text = draft ?? record.base.text ?? "";
  const save = (): void => {
    if (busy || draft === null) return;
    setBusy(true);
    setProblem(null);
    app.client.call("PUT /api/v1/chats/:chat/places/:place/base", { chat, place: record.place }, { body: { text: draft } }).then(
      () => {
        setBusy(false);
        setDraft(null);
        setSaid("Saved as your own change, after the chat's newest reply: swiping that reply keeps it, and you can undo it from the review card.");
        props.onChanged();
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  return (
    <div class="lre-stack" data-base>
      <p class="rpe-meta">
        {BASE_WORDS(record.base)}
        {record.base.older ? <> <Badge tone="warn" title="An entry bound to the place changed, went or was bound since the base was drawn">older than its sources</Badge></> : null}
      </p>
      {record.turn !== null ? (
        record.base.text === null ? null : <p class="rpe-line" data-base-text>{record.base.text}</p>
      ) : (
        <>
          <textarea class="lre-input rpe-editor" value={text} spellcheck={false} onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)} aria-label="The place's base" />
          <div class="lre-inline rpe-wrap">
            <Button busy={busy} disabled={draft === null || draft.trim() === "" || draft.trim() === (record.base.text ?? "").trim()} onClick={save}>
              Write it as your base
            </Button>
          </div>
        </>
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
    </div>
  );
}

export interface PlaceOpenProps {
  chat: string;
  place: string;
  /** The turn the place is read at; null: the chat's newest. */
  turn: string | null;
  stamp: number;
  onTurn(turn: string | null): void;
  onOpenTurn(turn: string): void;
  onOpenPlace(place: string): void;
  onLore(): void;
}

export function PlaceOpen(props: PlaceOpenProps) {
  const app = useApp();
  const { chat, place, turn } = props;
  const turnsAtATime = useUiSetting("turnsAtATime");
  const [changed, setChanged] = useState(0);
  const record = useRead(() => app.client.call("GET /api/v1/chats/:chat/places/:place", { chat, place }, { query: turn === null ? {} : { turn } }).then(replyOf), [chat, place, turn, props.stamp, changed]);
  const turns = useRead(() => app.client.call("GET /api/v1/chats/:chat/turns", { chat }, { query: { limit: turnsAtATime } }).then((answer) => ("joined" in answer ? { turns: [] } : answer)), [chat, props.stamp]);
  const r = record.value;
  if (r === null) {
    return record.problem === null ? (
      <p class="lre-muted rpe-line">Reading the place…</p>
    ) : (
      <Banner tone="neg" icon="alert" title="The place could not be read">
        <span data-problem>{record.problem}</span>
      </Banner>
    );
  }
  const again = (): void => setChanged((n) => n + 1);
  return (
    <div class="lre-stack" data-place={r.place}>
      <p class="rpe-line">
        <Badge>{r.kind}</Badge> {r.made ? <Badge tone="accent" title="Play made it; the world's document does not have it">made in play</Badge> : <Badge>the world's own</Badge>} {r.grid ? <Badge>has a grid</Badge> : null} <code class="lre-id">{r.ref}</code>
        {r.parent === null ? null : (
          <>
            {" in "}
            <Button size="sm" variant="ghost" onClick={() => props.onOpenPlace(r.parent?.id ?? "")}>
              {r.parent.name}
            </Button>
          </>
        )}
      </p>
      <label class="lre-field">
        <span class="label">Read it as it stood</span>
        <select class="lre-input" value={turn ?? ""} onChange={(e) => props.onTurn((e.currentTarget as HTMLSelectElement).value === "" ? null : (e.currentTarget as HTMLSelectElement).value)}>
          <option value="">at the chat's newest turn</option>
          {(turns.value?.turns ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              at the turn of {when(t.timings.received)}
            </option>
          ))}
        </select>
      </label>
      {r.grid ? (
        <Section id="map" title="Its map">
          <GridPane chat={chat} place={r.place} turn={turn} stamp={props.stamp + changed} onChanged={again} />
        </Section>
      ) : (
        <p class="rpe-meta" data-no-grid>It draws no grid of its own.</p>
      )}
      <Section id="sources" title="What defines it">
        <p class="rpe-meta">The lore entries bound to it, read as Lumiverse holds them now.</p>
        <RecordBindings
          chat={chat}
          record={{ ref: r.ref, names: [r.name, r.place] }}
          bound={r.sources.map((s) => ({ entry: s.entry, aspect: s.aspect, by: s.by, title: s.title }))}
          onChanged={again}
        />
        {r.sources.some((s) => s.newer) ? <p class="rpe-meta" data-newer>{r.sources.filter((s) => s.newer).map((s) => s.title ?? s.entry).join(", ")} changed, went or was bound after the base was drawn.</p> : null}
        <p class="rpe-meta">
          <Button size="sm" variant="ghost" onClick={props.onLore}>
            Open the Lore page
          </Button>
        </p>
      </Section>
      <Section id="base" title="Its base">
        <BasePart chat={chat} record={r} onChanged={again} />
      </Section>
      <Section id="since" title="What the story changed there since">
        {r.since.items.length === 0 ? <p class="lre-muted rpe-line">The story has changed nothing there.</p> : <Facts items={r.since.items} onTurn={props.onOpenTurn} />}
        <More n={r.since.more} of="change" />
      </Section>
      <Section id="features" title="Its features">
        {r.features.facts.items.length === 0 && r.features.fixtures.length === 0 && r.features.zones.length === 0 ? <p class="lre-muted rpe-line">No feature is recorded.</p> : null}
        <Facts items={r.features.facts.items} onTurn={props.onOpenTurn} />
        <More n={r.features.facts.more} of="feature" />
        {r.features.fixtures.length === 0 ? null : (
          <ul class="rpe-plain lre-stack" data-fixtures>
            {r.features.fixtures.map((f) => (
              <li key={`${f.name}:${f.at.join(",")}`} class="rpe-line">
                {f.name}: at ({f.at.join(", ")}), {f.size.join(" by ")}
              </li>
            ))}
          </ul>
        )}
        {r.features.zones.length === 0 ? null : <p class="rpe-meta">Zones: {r.features.zones.map((z) => `${z.name} (${counted(z.squares, "square")})`).join(", ")}.</p>}
      </Section>
      <Section id="here" title="Who and what is here">
        {r.here.length === 0 ? <p class="lre-muted rpe-line">Nobody and nothing is placed here.</p> : null}
        <ul class="rpe-plain lre-stack" data-here>
          {r.here.map((h) => (
            <li key={h.ref} class="rpe-line" data-here-row={h.ref}>
              <strong>{h.name}</strong> <span class="rpe-meta">{h.kind}{h.holder === null ? "" : `, ${h.holder.how} ${h.holder.name}`}{h.square === null ? "" : `, at (${h.square.join(", ")})`}{h.zone === null ? "" : `, in ${h.zone}`}{h.words === null ? "" : `: ${h.words}`}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="ways" title="Its ways">
        {r.ways.ways.length === 0 && r.ways.adjoining.length === 0 ? <p class="lre-muted rpe-line">No way leads from it or to it.</p> : null}
        <ul class="rpe-plain lre-stack" data-ways>
          {r.ways.ways.map((w) => (
            <li key={w.route} class="rpe-entry" data-way={w.route}>
              <p class="rpe-line">
                {w.dir === "in" ? "From " : "To "}
                <Button size="sm" variant="ghost" onClick={() => props.onOpenPlace(w.to.id)}>
                  {w.to.name}
                </Button>
                {w.dir === "both" ? " both ways" : w.dir === "out" ? ", out of it only" : ", into it only"}
              </p>
              <p class="rpe-meta">
                {w.modes.map((m) => `${m.mode}: ${counted(m.minutes, "minute")}${m.km === null ? "" : `, ${m.km} km`}`).join(" · ")}
                {w.turn === null ? "" : ` · laid or changed in play`}
                {w.turn === null ? null : (
                  <>
                    {" "}
                    <Button size="sm" variant="ghost" onClick={() => props.onOpenTurn(w.turn ?? "")}>
                      Open its turn
                    </Button>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
        {r.ways.adjoining.length === 0 ? null : (
          <p class="rpe-meta" data-adjoining>
            Adjoining:{" "}
            {r.ways.adjoining.map((a) => (
              <Button key={a.id} size="sm" variant="ghost" onClick={() => props.onOpenPlace(a.id)}>
                {a.name} ({a.how})
              </Button>
            ))}
          </p>
        )}
      </Section>
      <Section id="access" title="Access and state">
        <p class="rpe-line" data-entry-rule>
          {r.access.entry === null ? "Anyone may enter." : `${r.access.entry.audience} may enter${r.access.entry.inherited ? `, as ${r.access.entry.name} sets it` : ""}.`}
        </p>
        {r.access.facts.items.length === 0 ? null : <Facts items={r.access.facts.items} onTurn={props.onOpenTurn} />}
        <More n={r.access.facts.more} of="fact" />
        {r.access.doors.length === 0 ? null : <p class="rpe-meta" data-doors>Doors: {r.access.doors.map((d) => `(${d.at.join(", ")}) ${d.state}`).join(" · ")}.</p>}
      </Section>
      <Section id="history" title="Its history">
        {r.history.items.length === 0 ? <p class="lre-muted rpe-line">No beat of the story is tied to it.</p> : null}
        <ul class="rpe-plain lre-stack" data-history>
          {r.history.items.map((h) => (
            <li key={h.beat} class="rpe-entry" data-beat={h.beat}>
              <p class="rpe-line">{h.text ?? h.beat}</p>
              <p class="rpe-meta">
                {h.message === null ? "not on the chat's path" : `message ${h.message}`}{" "}
                <Button size="sm" variant="ghost" onClick={() => props.onOpenTurn(h.turn)}>
                  Open its turn
                </Button>
              </p>
            </li>
          ))}
        </ul>
        <More n={r.history.more} of="beat" />
      </Section>
      <Section id="known" title="Who knows of it">
        {r.known.length === 0 ? <p class="lre-muted rpe-line">No one is recorded as knowing of it.</p> : null}
        <ul class="rpe-plain lre-stack" data-known>
          {r.known.map((k) => (
            <li key={`${k.who}:${k.by}`} class="rpe-line">
              <strong>{k.name}</strong>{" "}
              <span class="rpe-meta">
                {k.by === "world" ? "the world's own record says so" : "their knowledge names it"}
                {k.how === null ? "" : `, learned ${k.how}`}
                {k.reach === null ? "" : `, ${k.reach}`}
                {k.precision === null ? "" : `, ${k.precision}`}
                {k.standing === null ? "" : `, ${k.standing}`}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

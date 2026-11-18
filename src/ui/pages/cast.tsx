// The Cast page (plan §14 Cast, §7): the player's view of a chat's cast, and his hand on it. Every character
// the chat knows, with its casting and what its record holds; one opened: its base as it stands with the
// accepted growth laid over it, its sources read live in Lumiverse and marked current, changed, not drawn from
// yet or gone, who of the world's people it is, its castings, its mind by kind, its memories by tier (strength,
// faint ones as their gist), relationships, knowledge, history with its beats, perceptions, the mind files a
// migration carried word for word with whether each is filed, while a principal is away where it is and what it
// means to do, and its game side by reference to the world's person. Every list is read a page at a time. A
// record holds a character's secrets and the Author's plans for it, so the record opened, the Author's casting
// line in the list, and what a strike let go sit behind the spoiler gate; the names, kinds of casting and counts
// do not. Behind it everything is shown: struck entries are marked struck, and nothing is cut by what a
// character knows. An entry can be struck, or its strike taken back; a perception can be written for a turn the
// character was on stage in and has none of; its casting can be set or pinned, its base redrawn, a source bound,
// said again or taken away, and the person it is named; and the page says what the cast did with each. A
// character can be read as it stood at a turn (the turn a perception was missed in); a turn that was joined to
// another is shown at the turn it joined, and said so. It reads when it opens, after each edit, and when the
// chat's live view says its record changed or a run began or ended.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useSelect } from "../store";
import type { CharacterReply, CharacterListName, EntryRow, EntryCounts, EntryItems, CastReply, CastMemberRow, CastStrikeReply, CastRole, MemoryBand, PerceptionRecordReply } from "../../shared/api";
import { isRecord } from "../../shared/json";
import { useApp } from "../app";
import { Badge, Banner, Button, Disclosure, Empty, Gated, PageHeader, Pre, Row, Section } from "../../frontend/components";
import { isJoined, replyOf, type RpeClient } from "../client";
import { onChatChange } from "../live-watch";
import { EntryCard, type EntryCardProps, type StrikeAsk, writeWords } from "../records";
import { counted, errorWords } from "../words";
import type { PageEntry } from "../page-entry";
import { BASE_WORDS, BaseEditor, CastingEditor, type CastEdit, type Drafts, PerceptionWriter, PersonEditor, SourceBinder, SourceLine } from "./cast-edit";

/** How many of the latest turns the page looks through for one a character was on stage in and has no perception of. */
const STAGE_TURNS = 12;

/** What the page shows: the cast, the character open with its record, what is being read, and the last strike and edit with what came of them. */
export interface CastShown {
  list: CastReply | null;
  open: string | null;
  character: CharacterReply | null;
  loading: boolean;
  /** What could not be read, in RPE's words. */
  problem: string | null;
  /** The entry whose strike is out now. */
  striking: string | null;
  struck: { ask: StrikeAsk; answer: CastStrikeReply } | null;
  /** Why the last strike was not done, in the cast's words. */
  strikeProblem: string | null;
  /** The turn the character is read at; null: the chat's newest. */
  at: string | null;
  /** The turn asked for was joined to another: the character is shown at the turn it joined. */
  joined: { turn: string; joined: string } | null;
  /** How far back each list is read: how many of its newest entries it passes over. */
  skips: Partial<Record<CharacterListName, number>>;
  /** The perception record of the latest turns: who was on stage, and of whom has none of a turn. */
  stage: PerceptionRecordReply | null;
  /** The kind of edit that is out now. */
  editing: CastEdit["what"] | null;
  /** What the last edit did: whether anything changed, and what it left, in the cast's words. */
  edited: { edit: CastEdit["what"]; changed: boolean; notes: string[] } | null;
  /** Why the last edit was not done, in the cast's words. */
  editProblem: string | null;
  /** What is typed in the forms and not sent, by the name of the field. */
  drafts: Drafts;
}

export const NO_CAST: CastShown = { list: null, open: null, character: null, loading: true, problem: null, striking: null, struck: null, strikeProblem: null, at: null, joined: null, skips: {}, stage: null, editing: null, edited: null, editProblem: null, drafts: {} };

export interface CastReader {
  /** Opens a character, as it stands at the chat's newest turn or, with `at`, at that turn. */
  open(character: string, at?: string): void;
  close(): void;
  strike(ask: StrikeAsk): void;
  /** Makes an edit of the character open and reads again. */
  edit(edit: CastEdit): void;
  /** Reads a list of the character open further back (or forward again): `skip` of its newest entries are passed over. */
  more(list: CharacterListName, skip: number): void;
  /** Reads the character open as it stands now, after being shown at a turn. */
  newest(): void;
  /** Keeps what is typed in a form. */
  draft(name: string, value: string | boolean): void;
  /** Reads the cast again, and the character open. */
  refresh(): void;
  stop(): void;
}

/** Reads a chat's cast, and the character opened; edits and strikes an entry of it and reads again. What comes back once `stop()` is called is let go, and so is a character's record once another is open. */
export function readCast(client: Pick<RpeClient, "call">, chat: string, onChange: (shown: CastShown) => void): CastReader {
  let shown: CastShown = NO_CAST;
  let alive = true;
  const show = (next: Partial<CastShown>): void => {
    if (!alive) return;
    shown = { ...shown, ...next };
    onChange(shown);
  };
  const readList = (): void => {
    client.call("GET /api/v1/chats/:chat/cast", { chat }).then(replyOf).then(
      (list) => show({ list, loading: false, problem: null }),
      (error: unknown) => show({ loading: false, problem: errorWords(error) }),
    );
  };
  const ask = (character: string, at: string | null, more: { part?: CharacterListName; skip?: number }) => client.call("GET /api/v1/chats/:chat/cast/:character", { chat, character }, { query: { ...(at === null ? {} : { turn: at }), ...more } });
  const readOne = (character: string): void => {
    const at = shown.at;
    const current = (): boolean => shown.open === character && shown.at === at;
    ask(character, at, {}).then(
      async (answer) => {
        if (!current()) return;
        // A turn that was joined to another is read as the turn it joined, and the page says so.
        if (isJoined(answer)) {
          show({ joined: answer.joined, at: answer.joined.joined });
          readOne(character);
          return;
        }
        let read: CharacterReply = answer;
        // The lists he read further back stay where he left them.
        for (const [list, skip] of Object.entries(shown.skips) as [CharacterListName, number][]) {
          if (skip <= 0) continue;
          const further = await ask(character, at, { part: list, skip });
          if (!isJoined(further)) read = { ...read, ...Object.fromEntries([[list, further[list]]]) };
        }
        if (current()) show({ character: read, problem: null });
      },
      (error: unknown) => {
        if (shown.open === character) show({ problem: errorWords(error) });
      },
    );
  };
  // Who was on stage in the latest turns and of whom has no perception of it: what a perception is written for.
  const readStage = (): void => {
    client.call("GET /api/v1/chats/:chat/perceptions", { chat }, { query: { count: STAGE_TURNS } }).then(replyOf).then(
      (stage) => show({ stage }),
      () => show({ stage: null }),
    );
  };
  readList();
  return {
    open(character, at) {
      show({ open: character, at: at ?? null, joined: null, character: null, struck: null, strikeProblem: null, skips: {}, stage: null, edited: null, editProblem: null, drafts: {} });
      readOne(character);
      readStage();
    },
    close() {
      show({ open: null, at: null, joined: null, character: null, struck: null, strikeProblem: null, skips: {}, stage: null, edited: null, editProblem: null, drafts: {} });
    },
    strike(ask) {
      const character = shown.open;
      if (character === null || shown.striking !== null) return;
      show({ striking: ask.id, strikeProblem: null });
      client.call("POST /api/v1/chats/:chat/cast/:character/strike", { chat, character }, { body: ask }).then(
        (answer) => {
          show({ striking: null, struck: { ask, answer } });
          readList();
          if (shown.open === character) readOne(character);
        },
        (error: unknown) => show({ striking: null, strikeProblem: errorWords(error) }),
      );
    },
    edit(edit) {
      const character = shown.open;
      if (character === null || shown.editing !== null) return;
      show({ editing: edit.what, edited: null, editProblem: null });
      const params = { chat, character };
      const done = (words: { changed: boolean; notes: string[] }): void => {
        show({ editing: null, edited: { edit: edit.what, ...words }, drafts: {} });
        readList();
        if (shown.open === character) {
          readOne(character);
          readStage();
        }
      };
      const failed = (error: unknown): void => show({ editing: null, editProblem: errorWords(error) });
      switch (edit.what) {
        case "casting":
          client.call("POST /api/v1/chats/:chat/cast/:character/casting", params, { body: edit.body }).then(done, failed);
          break;
        case "base":
          client.call("POST /api/v1/chats/:chat/cast/:character/base", params, { body: edit.body }).then(done, failed);
          break;
        case "sources":
          client.call("POST /api/v1/chats/:chat/cast/:character/sources", params, { body: edit.body }).then(done, failed);
          break;
        case "person":
          client.call("POST /api/v1/chats/:chat/cast/:character/person", params, { body: edit.body }).then(done, failed);
          break;
        case "perception":
          client.call("POST /api/v1/chats/:chat/cast/:character/perceptions", params, { body: edit.body }).then((answer) => done({ changed: replyOf(answer).id !== null, notes: replyOf(answer).notes }), failed);
          break;
      }
    },
    more(list, skip) {
      const character = shown.open;
      if (character === null) return;
      const at = shown.at;
      show({ skips: { ...shown.skips, [list]: skip } });
      ask(character, at, { part: list, skip }).then(
        (answer) => {
          if (isJoined(answer) || shown.open !== character || shown.at !== at || shown.character === null) return;
          show({ character: { ...shown.character, ...Object.fromEntries([[list, answer[list]]]) } });
        },
        (error: unknown) => {
          if (shown.open === character) show({ problem: errorWords(error) });
        },
      );
    },
    draft(name, value) {
      show({ drafts: { ...shown.drafts, [name]: value } });
    },
    newest() {
      const character = shown.open;
      if (character === null) return;
      show({ at: null, joined: null, character: null, skips: {}, drafts: {} });
      readOne(character);
    },
    refresh() {
      readList();
      if (shown.open !== null) {
        readOne(shown.open);
        readStage();
      }
    },
    stop() {
      alive = false;
    },
  };
}

const CASTING_WORDS: Readonly<Record<CastRole, string>> = { principal: "principal", supporting: "supporting", extra: "extra" };
const TIER_WORDS: Readonly<Record<MemoryBand, string>> = { top: "top of mind", short: "short term", long: "long term" };
/** The parts of a character's record that hold entries, as the cast counts them. */
type CastKind = keyof EntryCounts;

/** The kinds a character's record counts, in the order the page shows them. */
const KIND_WORDS: readonly [CastKind, string][] = [
  ["mind", "mind"],
  ["memories", "memories"],
  ["relationships", "relationships"],
  ["knowledge", "knowledge"],
  ["history", "history"],
  ["perceptions", "perceptions"],
  ["growth", "growth"],
  ["files", "carried mind files"],
];

/** "mind 3 · memories 2 (1 struck) · carried mind files 2 (1 filed)": every kind that holds anything. */
export function countWords(member: CastMemberRow): string {
  return KIND_WORDS.flatMap(([kind, words]) => {
    const held = member.counts[kind];
    if (held.held === 0 && held.struck === 0) return [];
    const notes = [held.struck > 0 ? `${held.struck} struck` : null, kind === "files" ? `${member.counts.files.filed} filed` : null].filter((n) => n !== null);
    return [`${words} ${held.held}${notes.length === 0 ? "" : ` (${notes.join(", ")})`}`];
  }).join(" · ");
}

function CastingBadge(props: { member: CastMemberRow }) {
  const { casting } = props.member;
  if (casting === null) return <Badge>not cast</Badge>;
  return <Badge tone={casting.as === "principal" ? "accent" : undefined}>{casting.pinned ? `${CASTING_WORDS[casting.as]}, pinned by you` : CASTING_WORDS[casting.as]}</Badge>;
}

/** Where a character's record came from. */
function originWords(member: CastMemberRow): string {
  const { carried, played } = member.from;
  return carried && played ? "carried by the migration, and played on RPE" : carried ? "carried by the migration" : played ? "played on RPE" : "nothing written yet";
}

function MemberLine(props: { member: CastMemberRow; gateOpen: boolean; onOpen(): void }) {
  const { member } = props;
  return (
    <li class="lre-listrow">
      <button type="button" class="lre-listrow-hit" onClick={props.onOpen} data-character={member.id}>
        <span class="lre-listrow-content">
          <span class="lre-listrow-text">
            <span class="lre-listrow-title">{member.name}</span>
            {!props.gateOpen || member.casting?.line == null ? null : <span class="lre-listrow-sub">{member.casting.line}</span>}
            <span class="lre-listrow-sub">
              {originWords(member)}
              {countWords(member) === "" ? "" : ` · ${countWords(member)}`}
            </span>
          </span>
          <CastingBadge member={member} />
        </span>
      </button>
    </li>
  );
}

/** What the last strike did, in the cast's own terms. */
function StruckBanner(props: { struck: { ask: StrikeAsk; answer: CastStrikeReply } }) {
  const { ask, answer } = props.struck;
  const title = !answer.changed ? "Nothing changed: it already stood so" : ask.struck ? "Struck" : "Its strike was taken back";
  return (
    <Banner tone="info" icon="check" title={title}>
      {answer.alsoStruck.length === 0 ? null : <span>Struck with it, the knowledge it gave: {answer.alsoStruck.join(", ")}.</span>}
      {answer.letGo.length === 0 ? null : <span>Secrets it no longer holds: {answer.letGo.join(", ")}.</span>}
      {answer.alsoStood.length === 0 ? null : <span>Standing again with it, the knowledge its strike struck: {answer.alsoStood.join(", ")}.</span>}
      {answer.heldAgain.length === 0 ? null : <span>Secrets it holds again: {answer.heldAgain.join(", ")}.</span>}
      {answer.notes.map((note, i) => (
        <span key={i}>{note}</span>
      ))}
    </Banner>
  );
}

/** What the last edit did, in the cast's own terms. */
function EditedBanner(props: { edited: NonNullable<CastShown["edited"]> }) {
  const { edited } = props;
  return (
    <Banner tone="info" icon="check" title={edited.changed ? "Done: the Author is told of it in the next briefing" : "Nothing changed: it already stood so"}>
      {edited.notes.map((note, i) => (
        <span key={i}>{note}</span>
      ))}
    </Banner>
  );
}

interface EntryList {
  id: CharacterListName;
  title: string;
  entries: EntryItems;
}

/** A bounded list's way back and forth: what it leaves out (the record holds `total` of them), and the pages before and after the one shown. */
function Pager(props: { id: CharacterListName; items: { total: number; before: number; after: number }; skip: number; size: number; onMore(list: CharacterListName, skip: number): void }) {
  const left = props.items.before + props.items.after;
  if (left === 0) return null;
  return (
    <div class="lre-stack" data-pager={props.id}>
      <p class="lre-muted rpe-meta" data-left-out>
        {counted(left, "entry", "entries")} of the {props.items.total} the record holds {left === 1 ? "is" : "are"} not shown here.
      </p>
      <div class="lre-inline rpe-wrap">
        {props.items.before === 0 ? null : (
          <Button size="sm" variant="ghost" onClick={() => props.onMore(props.id, props.skip + props.size)}>
            Earlier ones
          </Button>
        )}
        {props.skip === 0 ? null : (
          <Button size="sm" variant="ghost" onClick={() => props.onMore(props.id, Math.max(0, props.skip - props.size))}>
            Later ones
          </Button>
        )}
      </div>
    </div>
  );
}

export interface CastViewProps {
  shown: CastShown;
  gateOpen: boolean;
  onOpenGate(): void;
  onCloseGate(): void;
  /** Opens a character, at the chat's newest turn or at a turn. */
  onOpen(character: string, at?: string): void;
  onClose(): void;
  onStrike(ask: StrikeAsk): void;
  onEdit(edit: CastEdit): void;
  onMore(list: CharacterListName, skip: number): void;
  onNewest(): void;
  /** Keeps what is typed in a form, by the name of its field. */
  onDraft(name: string, value: string | boolean): void;
}

/** Why the record sits behind the gate. */
const GATE_WHY = "A character's mind, knowledge, memories, relationships and perceptions, and the Author's castings, hold its secrets and what the Author has in mind for it, and can give away what comes next.";

/** What a casting write said, as words: its size, whether it is pinned, its line and why. */
function castingWords(wrote: Record<string, unknown>): string {
  const as = typeof wrote.as === "string" ? wrote.as : null;
  const line = typeof wrote.line === "string" ? `“${wrote.line}”` : null;
  const why = typeof wrote.why === "string" ? wrote.why : null;
  const pin = wrote.pinned === true ? "pinned by you" : wrote.pinned === false ? "pin taken away" : null;
  const words = [as, pin, line, why === null ? null : `because ${why}`].filter((w) => w !== null).join(", ");
  return words === "" ? "no change to the casting itself" : words;
}

const AWAY_WORDS: readonly [string, string][] = [
  ["whereabouts", "Where it is"],
  ["intention", "What it means to do"],
  ["until", "Until"],
  ["place", "The place"],
  ["names", "With"],
  ["how", "How"],
];

/** A line of a value the game side or an away entry gives, as plain words. */
function plain(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(plain).join(", ");
  if (isRecord(value)) return Object.values(value).map(plain).join(" · ");
  return value === null || value === undefined ? "none" : String(value);
}

/** Its game side, by reference to the world's person it is: where it is, what it has on it, what it owns elsewhere, its values. */
function GameSide(props: { game: Record<string, unknown> }) {
  const { game } = props;
  const items = (key: string): Record<string, unknown>[] => {
    const held = game[key];
    return isRecord(held) && Array.isArray(held.items) ? held.items.filter(isRecord) : [];
  };
  const where = isRecord(game.where) && Array.isArray(game.where["."]) ? game.where["."].map(plain).join(" › ") : null;
  return (
    <div class="lre-stack" data-game>
      {where === null ? null : <Row k="Where it is" v={where} />}
      {items("holds").length === 0 ? null : <Row k="Has on it" v={items("holds").map((h) => plain(h.name)).join(", ")} />}
      {items("owns").map((o, i) => (
        <Row key={i} k="Owns, kept elsewhere" v={plain(o.name)} sub={isRecord(o.where) ? plain(o.where) : undefined} />
      ))}
      {items("values").map((v, i) => (
        <Row key={i} k={plain(v.key)} v={plain(v.value)} />
      ))}
    </div>
  );
}

/** The older minds pack's notes of a character, as the pack wrote them, with the names and dates the world gives them now. */
function MindsNotes(props: { notes: Record<string, unknown> }) {
  const { notes } = props;
  const rows = (key: string): Record<string, unknown>[] => (Array.isArray(notes[key]) ? (notes[key] as unknown[]).filter(isRecord) : []);
  const when = (row: Record<string, unknown>): string | undefined => (typeof row.date === "string" ? row.date : undefined);
  const mind = isRecord(notes.mind) ? notes.mind : null;
  return (
    <div class="lre-stack" data-minds>
      {typeof notes.summary === "string" ? <Row k="Summary" v={notes.summary} /> : null}
      {rows("notes").map((n, i) => (
        <Row key={`n${i}`} k={`Note, mattered ${plain(n.salience)} of 5`} v={plain(n.text)} sub={when(n)} />
      ))}
      {rows("commitments").map((c, i) => (
        <Row key={`c${i}`} k={`Commitment, ${plain(c.kind)}, ${plain(c.status)}`} v={plain(c.text)} sub={[c.with === "" ? undefined : `with ${plain(c.with)}`, typeof c.due === "string" ? `due ${c.due}` : undefined, when(c)].filter((s) => s !== undefined).join(" · ")} />
      ))}
      {rows("witness").map((w, i) => (
        <Row key={`w${i}`} k={w.how === "told" ? "Told" : "Saw"} v={plain(w.what)} sub={[typeof w.by === "string" ? `from ${w.by}` : undefined, typeof w.place === "string" ? `at ${w.place}` : undefined, when(w)].filter((s) => s !== undefined).join(" · ")} />
      ))}
      {mind === null ? null : <Row k={`Their last mind, ${plain(mind.level)}`} v={plain(mind.monologue)} sub={[typeof mind.intent === "string" && mind.intent !== "" ? `meant to ${mind.intent}` : undefined, typeof mind.depiction === "string" && mind.depiction !== "" ? `seemed ${mind.depiction}` : undefined, typeof mind.place === "string" ? `at ${mind.place}` : undefined, when(mind)].filter((s) => s !== undefined).join(" · ")} />}
    </div>
  );
}

/** One character's whole record. */
function CharacterView(props: CastViewProps & { character: CharacterReply }) {
  const { character: c, shown } = props;
  const busy = shown.editing !== null;
  const form = { drafts: shown.drafts, onDraft: props.onDraft, busy, onEdit: props.onEdit };
  const skip = (list: CharacterListName): number => shown.skips[list] ?? 0;
  const card = (entry: EntryRow, title: string, extra: Partial<EntryCardProps> = {}) => (
    <EntryCard
      key={entry.id}
      id={entry.id}
      title={title}
      fields={entry.fields}
      first={entry}
      struck={entry.struck}
      writes={entry.writes}
      busy={shown.striking === entry.id}
      onStrike={props.onStrike}
      {...extra}
    />
  );
  const dated = (entry: EntryRow) => card(entry, entry.date === null ? entry.part : `${entry.part}, ${entry.date}`);
  const pager = (id: CharacterListName, items: { total: number; before: number; after: number }) => <Pager id={id} items={items} skip={skip(id)} size={c.listed} onMore={props.onMore} />;
  const lists: readonly EntryList[] = [
    { id: "relationships", title: "Relationships", entries: c.relationships },
    { id: "knowledge", title: "Knowledge", entries: c.knowledge },
    { id: "growth", title: "Growth", entries: c.growth },
  ];
  const standing = c.base.filter((b) => b.standing);
  const older = c.base.filter((b) => !b.standing);
  // The mind by kind, in the order of its entries' first appearance.
  const kinds = [...new Set(c.mind.items.map((m) => String(m.fields.kind ?? "other")))];
  // The memories by tier; a struck one has none.
  const tiers: readonly [MemoryBand | null, string][] = [
    ["top", TIER_WORDS.top],
    ["short", TIER_WORDS.short],
    ["long", TIER_WORDS.long],
    [null, "struck"],
  ];
  const memory = (m: (typeof c.memories.items)[number]) =>
    card(m, m.date === null ? "memory" : `memory, ${m.date}`, {
      marks: (
        <>
          {m.strength === null ? null : <span class="rpe-meta lre-num">strength {m.strength.toFixed(2)}</span>}
          {m.faint ? <Badge tone="warn">faint: shown as its gist</Badge> : null}
        </>
      ),
      ...(m.faint && typeof m.fields.gist === "string" ? { fields: { ...m.fields, text: m.fields.gist } } : {}),
    });
  // Turns the character was on stage in and has no perception of, newest first: what a perception is written for.
  const gaps = (shown.stage?.turns ?? []).filter((t) => t.people.some((p) => p.character === c.character.id && p.perceptions.length === 0)).reverse();
  return (
    <>
      <div class="lre-inline rpe-wrap">
        <CastingBadge member={c.character} />
        <span class="rpe-meta">{originWords(c.character)}</span>
        {shown.at === null ? null : <Badge tone="gm">as it stood at turn {shown.at}</Badge>}
      </div>
      {c.character.casting?.line == null ? null : <p class="rpe-line">{c.character.casting.line}</p>}
      {shown.joined === null ? null : (
        <Banner tone="info" icon="alert" title="Turn joined to another" actions={<Button size="sm" onClick={props.onNewest}>Back to the newest</Button>}>
          <span data-joined>
            Turn {shown.joined.turn} was joined to turn {shown.joined.joined}, so the record is shown at turn {shown.joined.joined}.
          </span>
        </Banner>
      )}
      {shown.edited === null ? null : <EditedBanner edited={shown.edited} />}
      {shown.editProblem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not done">
          <span data-problem>{shown.editProblem}</span>
        </Banner>
      )}
      <Section id="who" title="Who it is">
        <PersonEditor {...form} member={c.character} />
        <CastingEditor key={`${c.character.casting?.as}-${c.character.casting?.pinned}`} {...form} member={c.character} />
        <Section id="castings" title={`Castings (${c.castings.length})`}>
          {c.castings.length === 0 ? (
            <p class="lre-muted rpe-line">The Author has not cast it.</p>
          ) : (
            <ol class="lre-stack rpe-plain">
              {c.castings.map((w, i) => (
                <li key={i} class="lre-stack">
                  <span class="rpe-line">{castingWords(w.wrote)}</span>
                  <span class="rpe-meta">{writeWords(w)}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </Section>
      <Section id="base" title="Base">
        {c.now.parts.length === 0 ? (
          <p class="lre-muted rpe-line">No part of its base is written.</p>
        ) : (
          c.now.parts.map((b) => (
            <div key={b.part} class="lre-stack">
              <span class="rpe-caption">
                {BASE_WORDS[b.part]}, version {b.version}
              </span>
              <Pre text={b.text} mono={false} />
            </div>
          ))
        )}
        {c.now.growth.length === 0 ? null : (
          <div class="lre-stack" data-growth-over>
            <span class="rpe-caption">Growth laid over it</span>
            <ul class="lre-stack rpe-plain">
              {c.now.growth.map((g) => (
                <li key={g.id} class="lre-stack">
                  <span class="rpe-line">{g.text}</span>
                  <span class="rpe-meta">{[g.date, g.cause === null ? null : `because ${g.cause}`].filter((p) => p !== null).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {older.length === 0 ? null : (
          <Disclosure summary={`Earlier versions (${older.length})`}>
            {older.map((b) => (
              <div key={`${b.part}-${b.version}`} class="lre-stack">
                <span class="rpe-caption">
                  {b.part}, version {b.version}
                </span>
                <Pre text={b.text} mono={false} />
              </div>
            ))}
          </Disclosure>
        )}
        <BaseEditor key={standing.map((b) => `${b.part}${b.version}`).join()} {...form} now={c.now} />
      </Section>
      <Section id="sources" title={`Sources (${c.sources.length})`}>
        {c.sources.length === 0 ? (
          <p class="lre-muted rpe-line">None bound.</p>
        ) : (
          <ul class="lre-stack rpe-plain">
            {c.sources.map((s) => (
              <SourceLine key={`${s.kind}:${s.ref}:${s.defines}`} {...form} source={s} />
            ))}
          </ul>
        )}
        <SourceBinder {...form} />
      </Section>
      {c.away === null ? null : (
        <Section id="away" title="Away">
          {AWAY_WORDS.flatMap(([key, label]) => (c.away?.fields[key] === undefined ? [] : [<Row key={key} k={label} v={plain(c.away.fields[key])} />]))}
        </Section>
      )}
      {c.game === null ? null : (
        <Section id="game" title="Game side">
          <GameSide game={c.game} />
        </Section>
      )}
      <Section id="mind" title={`Mind (${c.mind.total})`}>
        {c.mind.items.length === 0 ? (
          <p class="lre-muted rpe-line">None.</p>
        ) : (
          kinds.map((kind) => (
            <div key={kind} class="lre-stack" data-kind={kind}>
              <span class="rpe-caption">{kind}</span>
              <ul class="lre-stack rpe-plain">{c.mind.items.filter((m) => String(m.fields.kind ?? "other") === kind).map(dated)}</ul>
            </div>
          ))
        )}
        {pager("mind", c.mind)}
      </Section>
      <Section id="memories" title={`Memories (${c.memories.total})`}>
        {c.memories.items.length === 0 ? (
          <p class="lre-muted rpe-line">None.</p>
        ) : (
          tiers.flatMap(([tier, words]) => {
            const held = c.memories.items.filter((m) => (tier === null ? m.tier === null : m.tier === tier));
            return held.length === 0
              ? []
              : [
                  <div key={words} class="lre-stack" data-tier={tier ?? "struck"}>
                    <span class="rpe-caption">{words}</span>
                    <ul class="lre-stack rpe-plain">{held.map(memory)}</ul>
                  </div>,
                ];
          })
        )}
        {pager("memories", c.memories)}
      </Section>
      {lists.map((list) => (
        <Section key={list.id} id={list.id} title={`${list.title} (${list.entries.total})`}>
          {list.entries.items.length === 0 ? <p class="lre-muted rpe-line">None.</p> : <ul class="lre-stack rpe-plain">{list.entries.items.map(dated)}</ul>}
          {pager(list.id, list.entries)}
        </Section>
      ))}
      <Section id="history" title={`History (${c.history.total})`}>
        {c.history.items.length === 0 ? (
          <p class="lre-muted rpe-line">None.</p>
        ) : (
          <ul class="lre-stack rpe-plain">
            {c.history.items.map((h) => {
              const beats = Array.isArray(h.fields.beats) ? h.fields.beats.map(String) : [];
              return card(h, h.date === null ? "history" : `history, ${h.date}`, { more: beats.length === 0 ? undefined : <p class="rpe-meta">Linked to beats: {beats.join(", ")}</p> });
            })}
          </ul>
        )}
        {pager("history", c.history)}
      </Section>
      <Section id="perceptions" title={`Perceptions (${c.perceptions.total})`}>
        {c.perceptions.items.length === 0 ? (
          <p class="lre-muted rpe-line">None.</p>
        ) : (
          <ul class="lre-stack rpe-plain">{c.perceptions.items.map((p) => card(p, "perception", { more: <p class="rpe-meta">Of {writeWords({ turn: p.of.turn, message: p.of.message, by: null, imported: false })}</p> }))}</ul>
        )}
        {pager("perceptions", c.perceptions)}
        {gaps.length === 0 ? null : (
          <div class="lre-stack" data-gaps>
            <span class="rpe-caption">Turns it was on stage in and has no perception of</span>
            {gaps.map((t) => (
              <div key={t.turn} class="lre-stack">
                <Disclosure summary={`${t.message === null ? `Turn ${t.turn}` : `Message ${t.message}`}, the stage read from ${t.read === "scene" ? "the open scene" : t.read === "owner" ? "where your character stands" : "no record"}`}>
                  <PerceptionWriter {...form} turn={t.turn} message={t.message} />
                  {shown.at === t.turn ? null : (
                    <Button size="sm" variant="ghost" onClick={() => props.onOpen(c.character.id, t.turn)}>
                      See it as it stood then
                    </Button>
                  )}
                </Disclosure>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section id="files" title={`Mind files the migration carried (${c.files.total})`}>
        {c.files.items.length === 0 ? (
          <p class="lre-muted rpe-line">None.</p>
        ) : (
          <ul class="lre-stack rpe-plain">
            {c.files.items.map((f) =>
              card(f, f.file, {
                // Its text is shown whole below, word for word; the minds pack's notes, laid out as the pack kept them.
                fields: Object.fromEntries(Object.entries(f.fields).filter(([name]) => name !== "text" && name !== "minds")),
                marks: f.filed ? <Badge tone="pos">filed</Badge> : <Badge tone="warn">not filed yet</Badge>,
                more: isRecord(f.fields.minds) ? <MindsNotes notes={f.fields.minds} /> : f.text === null ? <p class="lre-muted rpe-line">Its row holds no text.</p> : <Pre text={f.text} mono={false} />,
              }),
            )}
          </ul>
        )}
        {pager("files", c.files)}
      </Section>
    </>
  );
}

export function CastView(props: CastViewProps) {
  const { shown } = props;
  const opened = shown.open === null ? null : (shown.list?.characters.find((m) => m.id === shown.open) ?? shown.character?.character ?? null);
  const problem =
    shown.problem === null ? null : (
      <Banner tone="neg" icon="alert" title={shown.open === null ? "The cast could not be read" : "This character could not be read"}>
        <span>{shown.problem}</span>
      </Banner>
    );
  const gate = (children: ComponentChildren) => (
    <Gated open={props.gateOpen} onOpen={props.onOpenGate} onClose={props.onCloseGate} why={GATE_WHY}>
      {children}
    </Gated>
  );
  if (shown.open !== null) {
    return (
      <div class="lre-stack rpe-page" data-page="cast" data-character={shown.open}>
        <PageHeader title={opened?.name ?? shown.open} subtitle="Everything on its record, struck entries included." onBack={props.onClose} backLabel="the cast" />
        {problem}
        {shown.strikeProblem === null ? null : (
          <Banner tone="neg" icon="alert" title="Not done">
            <span>{shown.strikeProblem}</span>
          </Banner>
        )}
        {/* What a strike let go names secrets, so it shows with the record. */}
        {gate(
          <>
            {shown.struck === null ? null : <StruckBanner struck={shown.struck} />}
            {shown.character === null ? shown.problem === null ? <p class="lre-muted rpe-line">Reading its record…</p> : null : <CharacterView {...props} character={shown.character} />}
          </>,
        )}
      </div>
    );
  }
  const characters = shown.list?.characters ?? [];
  return (
    <div class="lre-stack rpe-page" data-page="cast">
      <PageHeader title="Cast" subtitle="Every character this chat knows, with its casting and what its record holds." />
      {problem}
      {shown.list === null || characters.length === 0 ? null : gate(null)}
      {shown.list === null ? (
        shown.loading ? (
          <p class="lre-muted rpe-line">Reading the cast…</p>
        ) : null
      ) : characters.length === 0 ? (
        <Empty icon="users" title="No character yet">
          <span>A character shows here once the Author or the migration writes one.</span>
        </Empty>
      ) : (
        <div class="lre-section flush">
          <ul class="lre-section-body lre-rowlist">
            {characters.map((m) => (
              <MemberLine key={m.id} member={m} gateOpen={props.gateOpen} onOpen={() => props.onOpen(m.id)} />
            ))}
          </ul>
        </div>
      )}
      {shown.list === null ? null : <p class="rpe-meta">{counted(characters.length, "character")}</p>}
    </div>
  );
}

export function CastPage(props: { chat: string }) {
  const app = useApp();
  const { chat } = props;
  const [shown, setShown] = useState<CastShown>(NO_CAST);
  const reader = useRef<CastReader | null>(null);
  const gateOpen = useSelect(app.gate, (opened) => opened.has(chat));
  useEffect(() => {
    setShown(NO_CAST);
    const reading = readCast(app.client, chat, setShown);
    reader.current = reading;
    const off = onChatChange(app.client, chat, () => reading.refresh());
    return () => {
      off();
      reading.stop();
      reader.current = null;
    };
  }, [chat]);
  return (
    <CastView
      shown={shown}
      gateOpen={gateOpen}
      onOpenGate={() => app.gate.open(chat)}
      onCloseGate={() => app.gate.close(chat)}
      onOpen={(id, at) => reader.current?.open(id, at)}
      onClose={() => reader.current?.close()}
      onStrike={(ask) => reader.current?.strike(ask)}
      onEdit={(edit) => reader.current?.edit(edit)}
      onMore={(list, skip) => reader.current?.more(list, skip)}
      onNewest={() => reader.current?.newest()}
      onDraft={(name, value) => reader.current?.draft(name, value)}
    />
  );
}

export const entry: PageEntry = { id: "cast", title: "Cast", icon: "users", shells: ["web", "drawer"], needsChat: true, often: false, order: 50, render: (route) => <CastPage chat={route.chat} /> };

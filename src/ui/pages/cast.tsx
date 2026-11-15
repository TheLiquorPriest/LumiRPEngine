// The Cast page (plan §14 Cast, §7): the player's view of a chat's cast. Every character the chat knows,
// with its casting and what its record holds; one opened: its base, sources, castings, growth, mind,
// memories (tier, strength, faint), relationships, knowledge, history, perceptions, and the mind files a
// migration carried, word for word with whether each is filed. A record holds a character's secrets and
// the Author's plans for it, so the record opened, the Author's casting line in the list, and what a
// strike let go sit behind the spoiler gate; the names, kinds of casting and counts do not. Behind it
// everything is shown: struck entries are marked struck, and nothing is cut by what a character knows.
// An entry can be struck, or its strike taken back, and the page says what the cast did with it. It
// reads when it opens, after a strike, and when the chat's live view says a run began or ended.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useSelect } from "../../frontend/store";
import type { CastCharacter, CastEntryShown, CastKind, CastList, CastMemberShown, CastStruck, Casting, MemoryTier } from "../api";
import { useApp } from "../app";
import { Badge, Banner, Empty, Fold, Gated, PageHeader, Pre, Row, Section } from "../atoms";
import { replyOf, type RpeClient } from "../client";
import { onChatChange } from "../live-watch";
import { EntryCard, type EntryCardProps, type StrikeAsk, writeWords } from "../records";
import { counted, errorWords, when } from "../words";

/** What the page shows: the cast, the character open with its record, what is being read, and the last strike with what came of it. */
export interface CastShown {
  list: CastList | null;
  open: string | null;
  character: CastCharacter | null;
  loading: boolean;
  /** What could not be read, in RPE's words. */
  problem: string | null;
  /** The entry whose strike is out now. */
  striking: string | null;
  struck: { ask: StrikeAsk; answer: CastStruck } | null;
  /** Why the last strike was not done, in the cast's words. */
  strikeProblem: string | null;
}

export const NO_CAST: CastShown = { list: null, open: null, character: null, loading: true, problem: null, striking: null, struck: null, strikeProblem: null };

export interface CastReader {
  open(character: string): void;
  close(): void;
  strike(ask: StrikeAsk): void;
  /** Reads the cast again, and the character open. */
  refresh(): void;
  stop(): void;
}

/** Reads a chat's cast, and the character opened; strikes an entry of it and reads again. What comes back once `stop()` is called is let go, and so is a character's record once another is open. */
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
  const readOne = (character: string): void => {
    client.call("GET /api/v1/chats/:chat/cast/:character", { chat, character }).then(replyOf).then(
      (read) => {
        if (shown.open === character) show({ character: read, problem: null });
      },
      (error: unknown) => {
        if (shown.open === character) show({ problem: errorWords(error) });
      },
    );
  };
  readList();
  return {
    open(character) {
      show({ open: character, character: null, struck: null, strikeProblem: null });
      readOne(character);
    },
    close() {
      show({ open: null, character: null, struck: null, strikeProblem: null });
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
    refresh() {
      readList();
      if (shown.open !== null) readOne(shown.open);
    },
    stop() {
      alive = false;
    },
  };
}

const CASTING_WORDS: Readonly<Record<Casting, string>> = { principal: "principal", supporting: "supporting", extra: "extra" };
const TIER_WORDS: Readonly<Record<MemoryTier, string>> = { top: "top of mind", short: "short term", long: "long term" };
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
export function countWords(member: CastMemberShown): string {
  return KIND_WORDS.flatMap(([kind, words]) => {
    const held = member.counts[kind];
    if (held.held === 0 && held.struck === 0) return [];
    const notes = [held.struck > 0 ? `${held.struck} struck` : null, kind === "files" ? `${member.counts.files.filed} filed` : null].filter((n) => n !== null);
    return [`${words} ${held.held}${notes.length === 0 ? "" : ` (${notes.join(", ")})`}`];
  }).join(" · ");
}

function CastingBadge(props: { member: CastMemberShown }) {
  const { casting } = props.member;
  if (casting === null) return <Badge>not cast</Badge>;
  return <Badge tone={casting.as === "principal" ? "accent" : undefined}>{casting.pinned ? `${CASTING_WORDS[casting.as]}, pinned by you` : CASTING_WORDS[casting.as]}</Badge>;
}

/** Where a character's record came from. */
function originWords(member: CastMemberShown): string {
  const { carried, played } = member.from;
  return carried && played ? "carried by the migration, and played on RPE" : carried ? "carried by the migration" : played ? "played on RPE" : "nothing written yet";
}

function MemberLine(props: { member: CastMemberShown; gateOpen: boolean; onOpen(): void }) {
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
function StruckBanner(props: { struck: { ask: StrikeAsk; answer: CastStruck } }) {
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

interface EntryList {
  id: string;
  title: string;
  entries: readonly CastEntryShown[];
}

export interface CastViewProps {
  shown: CastShown;
  gateOpen: boolean;
  onOpenGate(): void;
  onCloseGate(): void;
  onOpen(character: string): void;
  onClose(): void;
  onStrike(ask: StrikeAsk): void;
}

/** Why the record sits behind the gate. */
const GATE_WHY = "A character's mind, knowledge, memories, relationships and perceptions, and the Author's castings, hold its secrets and what the Author has in mind for it, and can give away what comes next.";

/** One character's whole record. */
function CharacterView(props: CastViewProps & { character: CastCharacter }) {
  const { character: c, shown } = props;
  const card = (entry: CastEntryShown, title: string, extra: Partial<EntryCardProps> = {}) => (
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
  const plain = (entry: CastEntryShown) => card(entry, entry.date === null ? entry.part : `${entry.part}, ${entry.date}`);
  const lists: readonly EntryList[] = [
    { id: "mind", title: "Mind", entries: c.mind },
    { id: "relationships", title: "Relationships", entries: c.relationships },
    { id: "knowledge", title: "Knowledge", entries: c.knowledge },
    { id: "history", title: "History", entries: c.history },
    { id: "growth", title: "Growth", entries: c.growth },
  ];
  const standing = c.base.filter((b) => b.standing);
  const older = c.base.filter((b) => !b.standing);
  return (
    <>
      <div class="lre-inline rpe-wrap">
        <CastingBadge member={c.character} />
        <span class="rpe-meta">{originWords(c.character)}</span>
      </div>
      {c.character.casting?.line == null ? null : <p class="rpe-line">{c.character.casting.line}</p>}
      <Section id="base" title="Base">
        {standing.length === 0 ? (
          <p class="lre-muted rpe-line">No part of its base is written.</p>
        ) : (
          standing.map((b) => (
            <div key={b.part} class="lre-stack">
              <span class="rpe-caption">
                {b.part}, version {b.version}
              </span>
              <Pre text={b.text} mono={false} />
            </div>
          ))
        )}
        {older.length === 0 ? null : (
          <Fold summary={`Earlier versions (${older.length})`}>
            {older.map((b) => (
              <div key={`${b.part}-${b.version}`} class="lre-stack">
                <span class="rpe-caption">
                  {b.part}, version {b.version}
                </span>
                <Pre text={b.text} mono={false} />
              </div>
            ))}
          </Fold>
        )}
      </Section>
      <Section id="castings" title={`Castings (${c.castings.length})`}>
        {c.castings.length === 0 ? (
          <p class="lre-muted rpe-line">The Author has not cast it.</p>
        ) : (
          <ol class="lre-stack rpe-plain">
            {c.castings.map((w, i) => (
              <li key={i} class="lre-stack">
                <span class="rpe-meta">{writeWords(w)}</span>
                <Pre text={JSON.stringify(w.wrote)} />
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section id="memories" title={`Memories (${c.memories.length})`}>
        {c.memories.length === 0 ? (
          <p class="lre-muted rpe-line">None.</p>
        ) : (
          <ul class="lre-stack rpe-plain">
            {c.memories.map((m) =>
              card(m, m.date === null ? "memory" : `memory, ${m.date}`, {
                marks: (
                  <>
                    {m.tier === null ? null : <Badge>{TIER_WORDS[m.tier]}</Badge>}
                    {m.strength === null ? null : <span class="rpe-meta lre-num">strength {m.strength.toFixed(2)}</span>}
                    {m.faint ? <Badge tone="warn">faint</Badge> : null}
                  </>
                ),
              }),
            )}
          </ul>
        )}
      </Section>
      {lists.map((list) => (
        <Section key={list.id} id={list.id} title={`${list.title} (${list.entries.length})`}>
          {list.entries.length === 0 ? (
            <p class="lre-muted rpe-line">None.</p>
          ) : (
            <ul class="lre-stack rpe-plain">{list.entries.map(plain)}</ul>
          )}
        </Section>
      ))}
      <Section id="perceptions" title={`Perceptions (${c.perceptions.length})`}>
        {c.perceptions.length === 0 ? (
          <p class="lre-muted rpe-line">None.</p>
        ) : (
          <ul class="lre-stack rpe-plain">{c.perceptions.map((p) => card(p, "perception", { more: <p class="rpe-meta">Of {writeWords({ turn: p.of.turn, message: p.of.message, by: null, imported: false })}</p> }))}</ul>
        )}
      </Section>
      <Section id="files" title={`Mind files the migration carried (${c.files.length})`}>
        {c.files.length === 0 ? (
          <p class="lre-muted rpe-line">None.</p>
        ) : (
          <ul class="lre-stack rpe-plain">
            {c.files.map((f) =>
              card(f, f.file, {
                // Its text is shown whole below, word for word.
                fields: Object.fromEntries(Object.entries(f.fields).filter(([name]) => name !== "text")),
                marks: f.filed ? <Badge tone="pos">filed</Badge> : <Badge tone="warn">not filed yet</Badge>,
                more: f.text === null ? <p class="lre-muted rpe-line">Its row holds no text.</p> : <Pre text={f.text} mono={false} />,
              }),
            )}
          </ul>
        )}
      </Section>
      <Section id="sources" title={`Sources (${c.sources.length})`}>
        {c.sources.length === 0 ? (
          <p class="lre-muted rpe-line">None bound.</p>
        ) : (
          c.sources.map((s, i) => <Row key={i} label={`${s.kind} ${s.ref}`} value={s.defines ?? ""} sub={`bound ${when(s.created)}`} />)
        )}
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
        <PageHeader title={opened?.name ?? shown.open} sub="Everything on its record, struck entries included." back={{ label: "Back to the cast", go: props.onClose }} />
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
      <PageHeader title="Cast" sub="Every character this chat knows, with its casting and what its record holds." />
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
      onOpen={(id) => reader.current?.open(id)}
      onClose={() => reader.current?.close()}
      onStrike={(ask) => reader.current?.strike(ask)}
    />
  );
}

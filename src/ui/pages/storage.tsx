// Storage (plan §14, §5.1, §5.5): what RPE's files take, chat by chat and area by area, with the user's
// own level, the shipped level and RPE's database; for a chat, its largest notes and those agents rewrote
// most, which show where agents lean on notes; and the button that prunes the chat's old turn folders,
// which asks first. What RPE refuses is shown in its words.

import { useEffect, useState } from "preact/hooks";
import type { NoteRow, NotesReply, PrunedShown, StorageReply } from "../../shared/api";
import { useApp } from "../app";
import { Banner, Button, PageHeader, Row, Section } from "../atoms";
import type { RpeClient } from "../client";
import { bytesWords, counted, errorWords } from "../words";
import type { PageEntry } from "../page-entry";

export interface StorageCalls {
  storage(): Promise<StorageReply>;
  notes(chat: string): Promise<NotesReply>;
  prune(chat: string): Promise<{ pruned: PrunedShown }>;
}

export function storageCalls(client: Pick<RpeClient, "call">): StorageCalls {
  return {
    storage: () => client.call("GET /api/v1/storage", {}),
    notes: (chat) => client.call("GET /api/v1/storage/notes", {}, { query: { chat } }),
    prune: (chat) => client.call("POST /api/v1/files-prune", {}, { body: { chat } }),
  };
}

/**
 * What the page shows: the sizes once read, or why they could not be; for the chat chosen, its notes
 * once read, or why not; whether the prune waits for its yes or is under way, what it took away, and
 * RPE's refusal of it.
 */
export interface StorageShown {
  storage: StorageReply | null;
  problem: string | null;
  notes: NotesReply | null;
  notesProblem: string | null;
  asking: boolean;
  busy: boolean;
  pruned: PrunedShown | null;
  refusal: string | null;
}

export const NO_STORAGE: StorageShown = { storage: null, problem: null, notes: null, notesProblem: null, asking: false, busy: false, pruned: null, refusal: null };

export interface StorageControl {
  /** Asks for the prune's yes (true), or takes the question back. */
  ask(asking: boolean): void;
  prune(): void;
  stop(): void;
}

/** The page's state over its calls, for `chat` (null: none chosen): the sizes and the chat's notes at once, and again after a prune; nothing once `stop()` is called. */
export function storageControl(calls: StorageCalls, chat: string | null, onChange: (shown: StorageShown) => void): StorageControl {
  let shown = NO_STORAGE;
  let alive = true;
  const show = (next: Partial<StorageShown>): void => {
    if (!alive) return;
    shown = { ...shown, ...next };
    onChange(shown);
  };
  const read = (): void => {
    calls.storage().then(
      (storage) => show({ storage, problem: null }),
      (error: unknown) => show({ problem: errorWords(error) }),
    );
    if (chat !== null)
      calls.notes(chat).then(
        (notes) => show({ notes, notesProblem: null }),
        (error: unknown) => show({ notesProblem: errorWords(error) }),
      );
  };
  read();
  return {
    ask(asking) {
      show({ asking, refusal: null, pruned: null });
    },
    prune() {
      if (chat === null) return;
      show({ busy: true, refusal: null });
      calls.prune(chat).then(
        (answer) => {
          show({ busy: false, asking: false, pruned: answer.pruned });
          read();
        },
        (error: unknown) => show({ busy: false, asking: false, refusal: errorWords(error) }),
      );
    },
    stop() {
      alive = false;
    },
  };
}

function NoteList(props: { title: string; notes: readonly NoteRow[]; id: string }) {
  return (
    <div class="lre-stack" data-notes={props.id}>
      <p class="rpe-caption">{props.title}</p>
      {props.notes.length === 0 ? (
        <p class="lre-muted rpe-line">None.</p>
      ) : (
        props.notes.map((note) => <Row key={note.path} label={note.path} value={bytesWords(note.bytes)} sub={`${counted(note.writes, "write")} in turns`} />)
      )}
    </div>
  );
}

export interface StorageViewProps {
  chat: string | null;
  shown: StorageShown;
  onChat(chat: string | null): void;
  onAsk(asking: boolean): void;
  onPrune(): void;
}

export function StorageView(props: StorageViewProps) {
  const { shown, chat } = props;
  const storage = shown.storage;
  const chosen = chat === null ? undefined : storage?.chats.find((c) => c.chat === chat);
  const name = chosen?.folder ?? chat ?? "";
  return (
    <div class="lre-stack rpe-page" data-page="storage" data-chat={chat ?? undefined}>
      <PageHeader title="Storage" sub="What RPE's files take, chat by chat and area by area." />
      {shown.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The sizes could not be read">
          <span>{shown.problem}</span>
        </Banner>
      )}
      {storage === null ? (
        shown.problem === null ? (
          <p class="lre-muted rpe-line">Reading the sizes…</p>
        ) : null
      ) : (
        <>
          <Section title="Apart from the chats" id="levels">
            <Row label="Your own level" value={bytesWords(storage.global)} />
            <Row label="The shipped level" value={bytesWords(storage.shipped)} />
            <Row label="RPE's database, with its write-ahead log" value={bytesWords(storage.database)} />
          </Section>
          <Section title={`Chats (${storage.chats.length})`} id="chats">
            {storage.chats.length === 0 ? (
              <p class="lre-muted rpe-line">No chat has a folder yet.</p>
            ) : (
              <ul class="lre-stack rpe-plain">
                {storage.chats.map((c) => (
                  <li key={c.chat} class="lre-stack rpe-migrated" data-chat={c.chat}>
                    <Row label={c.folder} sub={c.chat === c.folder ? undefined : c.chat} value={bytesWords(c.bytes)} />
                    <p class="rpe-meta">
                      notes {bytesWords(c.areas.notes)} · turn folders {bytesWords(c.areas.turns)} · sessions {bytesWords(c.areas.sessions)} · other files {bytesWords(c.areas.files)}
                    </p>
                    {c.chat === chat ? null : (
                      <div class="lre-inline">
                        <Button small kind="ghost" onClick={() => props.onChat(c.chat)}>
                          Its notes, and pruning
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
      {chat === null ? null : (
        <Section title={`Chat ${name}`} id="chat">
          {shown.notesProblem === null ? null : (
            <Banner tone="neg" icon="alert" title="Its notes could not be read">
              <span>{shown.notesProblem}</span>
            </Banner>
          )}
          {shown.notes === null ? null : (
            <>
              <NoteList title="The largest notes" notes={shown.notes.largest} id="largest" />
              <NoteList title="The notes agents rewrote most" notes={shown.notes.rewritten} id="rewritten" />
            </>
          )}
          {shown.refusal === null ? null : (
            <Banner tone="neg" icon="alert" title="RPE did not prune them">
              <span>{shown.refusal}</span>
            </Banner>
          )}
          {shown.pruned === null ? null : (
            <p class="rpe-line" data-pruned="true">
              Pruned {counted(shown.pruned.folders, "turn folder")}: {counted(shown.pruned.files, "file")}, {bytesWords(shown.pruned.bytes)}.
            </p>
          )}
          {shown.asking ? (
            <div class="lre-inline rpe-wrap">
              <span>Prune the old turn folders of {name}?</span>
              <Button small kind="danger" busy={shown.busy} onClick={props.onPrune}>
                Prune them
              </Button>
              <Button small kind="ghost" onClick={() => props.onAsk(false)}>
                Keep them
              </Button>
            </div>
          ) : (
            <div class="lre-inline rpe-wrap">
              <Button small onClick={() => props.onAsk(true)}>
                Prune old turn folders
              </Button>
              <Button small kind="ghost" onClick={() => props.onChat(null)}>
                Close
              </Button>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

export function StoragePage(props: { chat: string | null }) {
  const app = useApp();
  const { chat } = props;
  const [shown, setShown] = useState<StorageShown>(NO_STORAGE);
  const [control, setControl] = useState<StorageControl | null>(null);
  useEffect(() => {
    setShown(NO_STORAGE);
    const made = storageControl(storageCalls(app.client), chat, setShown);
    setControl(made);
    return () => made.stop();
  }, [chat]);
  return <StorageView chat={chat} shown={shown} onChat={(next) => app.go({ page: "storage", chat: next })} onAsk={(asking) => control?.ask(asking)} onPrune={() => control?.prune()} />;
}

export const entry: PageEntry = { id: "storage", title: "Storage", icon: "box", shells: ["web", "drawer"], needsChat: false, withChat: true, often: false, order: 120, render: (route) => <StoragePage chat={route.chat ?? null} /> };

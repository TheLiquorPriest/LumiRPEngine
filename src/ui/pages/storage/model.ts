// What the Storage page holds and does over RPE's routes (plan §5.5, §14): each kind RPE keeps with its count,
// size, oldest and how long it is kept; every chat's folder by area and its rows of the database, a page at a
// time; the notes agents lean on; the backups and copies of the database; and pruning on request, told first:
// a dry run says what would go and gives a plan standing for exactly that, and the prune takes exactly that.

import type { BackupMadeReply, BackupPlan, BackupsReply, NotesReply, StorageKindsReply, StoragePruneAsk, StoragePruneReply, StorageReply } from "../../../shared/api";
import type { RpeClient } from "../../client";
import { errorWords } from "../../words";

export interface StorageCalls {
  kinds(): Promise<StorageKindsReply>;
  chats(after: string | undefined, limit: number): Promise<StorageReply>;
  notes(chat: string): Promise<NotesReply>;
  backups(): Promise<BackupsReply>;
  prune(ask: StoragePruneAsk): Promise<StoragePruneReply>;
  backupPlan(): Promise<BackupPlan>;
  makeBackup(): Promise<BackupMadeReply>;
}

export function storageCalls(client: Pick<RpeClient, "call">): StorageCalls {
  return {
    kinds: () => client.call("GET /api/v1/storage/kinds", {}),
    chats: (after, limit) => client.call("GET /api/v1/storage", {}, { query: { limit, ...(after === undefined ? {} : { after }) } }),
    notes: (chat) => client.call("GET /api/v1/storage/notes", {}, { query: { chat } }),
    backups: () => client.call("GET /api/v1/backups", {}),
    prune: (ask) => client.call("POST /api/v1/storage-prune", {}, { body: ask }),
    backupPlan: () => client.call("GET /api/v1/backups/next", {}),
    makeBackup: () => client.call("POST /api/v1/backups", {}),
  };
}

/** A prune asked and not yet taken: what it asked, and what RPE says would go (null while it waits for the answer). */
export interface PruneShown {
  ask: StoragePruneAsk;
  /** What the prune is of, in words, for the heading of its question. */
  title: string;
  plan: StoragePruneReply | null;
  busy: boolean;
  /** What a prune took, once it did. */
  done: StoragePruneReply | null;
  problem: string | null;
}

/** A backup made on a press, said first: what RPE says it would hold (null while it waits for the answer), and once made, what it made. */
export interface MakingBackup {
  plan: BackupPlan | null;
  busy: boolean;
  made: BackupMadeReply | null;
  problem: string | null;
}

export interface StorageShown {
  kinds: StorageKindsReply | null;
  kindsProblem: string | null;
  /** The chats read so far, and the totals the first page gave. */
  chats: StorageReply | null;
  more: boolean;
  loading: boolean;
  problem: string | null;
  backups: BackupsReply | null;
  /** The chat whose notes are shown, and its notes once read. */
  chat: string | null;
  notes: NotesReply | null;
  notesProblem: string | null;
  prune: PruneShown | null;
  /** A backup the page asked to make now. */
  making: MakingBackup | null;
}

export const NO_STORAGE: StorageShown = { kinds: null, kindsProblem: null, chats: null, more: false, loading: true, problem: null, backups: null, chat: null, notes: null, notesProblem: null, prune: null, making: null };

export interface StorageControl {
  /** Reads the next page of chats. */
  more(): void;
  /** Shows a chat's notes (null: none). */
  notes(chat: string | null): void;
  /** Asks what a prune would take; nothing goes until `confirm`. */
  ask(ask: StoragePruneAsk, title: string): void;
  /** Takes exactly what the plan named. */
  confirm(): void;
  /** Drops the question, or the answer to a prune. */
  dismiss(): void;
  /** Asks what a backup made now would hold; nothing is made until `makeBackup`. */
  askBackup(): void;
  /** Makes the backup that was said. */
  makeBackup(): void;
  /** Drops the question, or the answer to a backup. */
  dismissBackup(): void;
  refresh(): void;
  stop(): void;
}

/** The page's state over its calls: the kinds and the first page of chats at once, and again after a prune; nothing once `stop()` is called. */
export function storageControl(calls: StorageCalls, limit: () => number, onChange: (shown: StorageShown) => void): StorageControl {
  let shown = NO_STORAGE;
  let alive = true;
  let reading = 0;
  const show = (next: Partial<StorageShown>): void => {
    if (!alive) return;
    shown = { ...shown, ...next };
    onChange(shown);
  };
  const chats = (after: string | undefined): void => {
    reading += 1;
    const n = reading;
    show({ loading: true, problem: null });
    calls.chats(after, limit()).then(
      (got) => {
        if (n !== reading) return;
        const held = after === undefined || shown.chats === null ? [] : shown.chats.chats;
        show({ chats: { ...got, chats: [...held, ...got.chats] }, more: got.next != null, loading: false });
      },
      (error: unknown) => {
        if (n === reading) show({ loading: false, problem: errorWords(error) });
      },
    );
  };
  const refresh = (): void => {
    chats(undefined);
    calls.kinds().then(
      (kinds) => show({ kinds, kindsProblem: null }),
      (error: unknown) => show({ kindsProblem: errorWords(error) }),
    );
    calls.backups().then(
      (backups) => show({ backups }),
      () => undefined,
    );
  };
  refresh();
  return {
    more() {
      const next = shown.chats?.next;
      if (next != null && !shown.loading) chats(next);
    },
    notes(chat) {
      show({ chat, notes: null, notesProblem: null });
      if (chat === null) return;
      calls.notes(chat).then(
        (notes) => {
          if (shown.chat === chat) show({ notes });
        },
        (error: unknown) => {
          if (shown.chat === chat) show({ notesProblem: errorWords(error) });
        },
      );
    },
    ask(ask, title) {
      const asking: PruneShown = { ask, title, plan: null, busy: true, done: null, problem: null };
      show({ prune: asking });
      calls.prune(ask).then(
        (plan) => {
          if (shown.prune === asking) show({ prune: { ...asking, plan, busy: false } });
        },
        (error: unknown) => {
          if (shown.prune === asking) show({ prune: { ...asking, busy: false, problem: errorWords(error) } });
        },
      );
    },
    confirm() {
      const now = shown.prune;
      if (now === null || now.plan === null || now.busy) return;
      const asking: PruneShown = { ...now, busy: true, problem: null };
      show({ prune: asking });
      calls.prune({ ...now.ask, plan: now.plan.plan }).then(
        (done) => {
          if (shown.prune !== asking) return;
          show({ prune: { ...asking, busy: false, done } });
          refresh();
        },
        (error: unknown) => {
          if (shown.prune === asking) show({ prune: { ...asking, busy: false, problem: errorWords(error) } });
        },
      );
    },
    dismiss() {
      show({ prune: null });
    },
    askBackup() {
      const asking: MakingBackup = { plan: null, busy: true, made: null, problem: null };
      show({ making: asking });
      calls.backupPlan().then(
        (plan) => {
          if (shown.making === asking) show({ making: { ...asking, plan, busy: false } });
        },
        (error: unknown) => {
          if (shown.making === asking) show({ making: { ...asking, busy: false, problem: errorWords(error) } });
        },
      );
    },
    makeBackup() {
      const now = shown.making;
      if (now === null || now.plan === null || now.busy || now.made !== null) return;
      const making: MakingBackup = { ...now, busy: true, problem: null };
      show({ making });
      calls.makeBackup().then(
        (made) => {
          if (shown.making !== making) return;
          show({ making: { ...making, busy: false, made } });
          refresh();
        },
        (error: unknown) => {
          if (shown.making === making) show({ making: { ...making, busy: false, problem: errorWords(error) } });
        },
      );
    },
    dismissBackup() {
      show({ making: null });
    },
    refresh,
    stop() {
      alive = false;
    },
  };
}

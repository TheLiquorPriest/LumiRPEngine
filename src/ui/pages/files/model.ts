// What the Files page holds and does over RPE's routes (plan §5, §14): the tree read like a filesystem, a
// folder at a time and a page at a time, with a search across every level; a file opened in pieces; and every
// change the page makes to one (saved at a level, deleted or reset, switched off and on, compared with the
// default), with the agents' suggestions and an agent's stack. The page shows what RPE answers, in its
// words: what RPH does with a file is RPH's own list, never worked out here from names.

import type { LayerLevel, ApplyNowReply, DiffRow, FilePinAsk, FileSwitchAsk, FileWrittenReply, StackReply, SuggestionAcceptedReply, SuggestionDismissedReply, SuggestionsReply, SuggestionShown, TreeDiffReply, TreeFileReply, TreeFileRow, TreeListed, TreeListedReply } from "../../../shared/api";
import { RpeError, type RpeClient } from "../../client";
import { errorWords } from "../../words";

export type { DiffRow };

/** The levels a file is written at on this page. */
export type WriteLevel = Exclude<LayerLevel, "shipped">;

/** The levels a file may be written at on this page: yours alone with no chat open, and the chat's levels with one. */
export function writeLevels(chat: string | null): WriteLevel[] {
  return chat === null ? ["global"] : ["global", "character", "chat"];
}

/** The levels an accepted suggestion may be written at: it is always a chat's. */
export const SUGGESTION_LEVELS: readonly WriteLevel[] = ["global", "character", "chat"];

/** Where accepting a suggestion writes it unless another level is chosen: the level it names, else the level its path names (a chat's own file names none), and yours for a shipped file. */
export function suggestedLevel(path: string, named?: LayerLevel): WriteLevel {
  if (named !== undefined && named !== "shipped") return named;
  if (path.startsWith("@global/") || path.startsWith("@shipped/")) return "global";
  return path.startsWith("@character/") ? "character" : "chat";
}

/** The folder a path stands in, as the listing names a folder: `@global/rules/x.md` stands in `@global/rules`; a file at the chat's top in `""`. */
export function folderOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

// ---------------------------------------------------------------- the calls

/** The Files page's calls to RPE, for the chat it shows. */
export interface FilesCalls {
  /** The chat the calls are for; null: the shipped level and yours alone. */
  readonly chat: string | null;
  /** One folder's entries a page at a time, or (with `search`) every level searched by name and by text. */
  folder(folder: string, search: string | null, after: string | undefined, limit: number): Promise<TreeListedReply>;
  /** A piece of a file: `length` bytes from byte `offset`. */
  read(path: string, offset: number, length: number): Promise<TreeFileReply>;
  diff(path: string): Promise<TreeDiffReply>;
  save(path: string, level: WriteLevel, text: string): Promise<FileWrittenReply>;
  remove(path: string, contents?: boolean): Promise<{ removed: string }>;
  switchName(path: string, level: FileSwitchAsk["level"], off: boolean): Promise<FileWrittenReply>;
  pin(path: string, level: FilePinAsk["level"], agent: string, pinned: boolean): Promise<FileWrittenReply>;
  suggestions(): Promise<SuggestionsReply>;
  accept(id: number, level: WriteLevel, text: string | null): Promise<SuggestionAcceptedReply>;
  dismiss(id: number): Promise<SuggestionDismissedReply>;
  stack(agent: string): Promise<StackReply>;
  applyNow(): Promise<ApplyNowReply>;
  makeFolder(path: string): Promise<{ path: string }>;
  move(from: string, to: string): Promise<{ path: string }>;
  copy(from: string, to: string): Promise<{ path: string }>;
}

/** The calls for `chat` (null: the shipped level and yours alone). */
export function filesCalls(client: Pick<RpeClient, "call">, chat: string | null): FilesCalls {
  const query = chat === null ? {} : { chat };
  const body = chat === null ? {} : { chat };
  return {
    chat,
    folder: (folder, search, after, limit) => client.call("GET /api/v1/files-list", {}, { query: { ...query, ...(search === null ? { folder } : { search }), limit, ...(after === undefined ? {} : { after }) } }),
    read: (path, offset, length) => client.call("GET /api/v1/files/*", { "*": path }, { query: { ...query, offset, length } }),
    diff: (path) => client.call("GET /api/v1/files-diff/*", { "*": path }, { query }),
    save: (path, level, text) => client.call("PUT /api/v1/files/*", { "*": path }, { body: { level, text, ...query } }),
    remove: (path, contents) => client.call("DELETE /api/v1/files/*", { "*": path }, { query: contents === true ? { ...query, contents: true } : query }),
    switchName: (path, level, off) => client.call("PUT /api/v1/files-off/*", { "*": path }, { body: { level, off, ...query } }),
    pin: (path, level, agent, pinned) => client.call("PUT /api/v1/files-pin/*", { "*": path }, { body: { level, agent, pinned, ...query } }),
    suggestions: () => client.call("GET /api/v1/suggestions", {}, { query: { ...query, state: "open" } }),
    accept: (id, level, text) => client.call("POST /api/v1/suggestions/:id/accept", { id: String(id) }, { body: text === null ? { level } : { level, text } }),
    dismiss: (id) => client.call("POST /api/v1/suggestions/:id/dismiss", { id: String(id) }),
    // With no chat open RPE refuses it in its own words; the page offers it only with one.
    stack: (agent) => client.call("GET /api/v1/files-stack", {}, { query: { chat: chat ?? "", agent } }),
    applyNow: () => client.call("POST /api/v1/files-apply", {}, { body: { chat: chat ?? "" } }),
    makeFolder: (path) => client.call("POST /api/v1/files-folder", {}, { body: { path, ...body } }),
    move: (from, to) => client.call("POST /api/v1/files-move", {}, { body: { from, to, ...body } }),
    copy: (from, to) => client.call("POST /api/v1/files-copy", {}, { body: { from, to, ...body } }),
  };
}

// ---------------------------------------------------------------- what the page holds

/** The folder shown, or the search made: its entries as read so far, and where the next page begins. */
export interface BrowseShown {
  /** The folder listed; `""` for the chat's own top. */
  folder: string;
  /** The words searched for across every level; "" when browsing. */
  search: string;
  items: TreeListed[];
  next: string | null;
  loading: boolean;
  problem: string | null;
  /** The levels the view has now. */
  levels: LayerLevel[];
  /** A search that ran out of its time. */
  stopped: "time" | null;
}

/** A file opened: its pieces read so far, or RPE's reason it gave none; what is being done with it; the text being edited and where it is to be saved; and its difference from the shipped default once asked for. */
export interface OpenFile {
  path: string;
  /** The file as the first piece read it, with the text of every piece read so far; null until the first. */
  file: TreeFileReply | null;
  /** The next piece is being read. */
  piece: boolean;
  problem: string | null;
  mode: "read" | "edit" | "delete";
  draft: { text: string; level: WriteLevel };
  diff: { answer: TreeDiffReply | null; problem: string | null } | null;
}

/** The open suggestions once read, or why they could not be; the one being edited before it is accepted, and the level each is to be written at where another than its own was chosen. */
export interface SuggestionsShown {
  list: SuggestionShown[] | null;
  problem: string | null;
  editing: { id: number; text: string } | null;
  levels: Readonly<Record<number, WriteLevel>>;
}

/** An agent's stack, as asked for: the agent, its parts and what it is handed at a run's start once read, or why they could not be. */
export interface StackShown {
  agent: string;
  parts: StackReply["parts"] | null;
  handed: StackReply["handed"] | null;
  problem: string | null;
}

/** What "Apply now" came to, or why it did not. */
export interface ApplyShown {
  busy: boolean;
  note: string | null;
  problem: string | null;
}

export interface FilesShown {
  browse: BrowseShown;
  open: OpenFile | null;
  suggestions: SuggestionsShown;
  /** The definitions the chat's view holds, by name; null until read. */
  agents: string[] | null;
  stack: StackShown | null;
  apply: ApplyShown;
  busy: boolean;
  refusal: { at: "file" | "make" | number; words: string } | null;
  /** A folder that holds files, asked about before it is deleted: its path, and what RPE says it holds. */
  deleting: { path: string; words: string } | null;
  /** The pin form: the agent chosen or typed, and the level of the config that holds the pin (null: the default for the chat). */
  pinning: { agent: string; level: "global" | "chat" | null };
}

export const NO_BROWSE: BrowseShown = { folder: "", search: "", items: [], next: null, loading: true, problem: null, levels: [], stopped: null };
export const NO_APPLY: ApplyShown = { busy: false, note: null, problem: null };
export const NO_FILES: FilesShown = { browse: NO_BROWSE, open: null, suggestions: { list: null, problem: null, editing: null, levels: {} }, agents: null, stack: null, apply: NO_APPLY, busy: false, refusal: null, deleting: null, pinning: { agent: "", level: null } };

/** The entry the listing holds for a path, among those read. */
export function entryOf(browse: BrowseShown, path: string): TreeFileRow | undefined {
  return browse.items.find((item) => item.path === path)?.entry ?? undefined;
}

export interface FilesControl {
  /** Opens a folder (`""`: the chat's top), from its first page. */
  folder(folder: string): void;
  /** Searches every level by name and by text; "" goes back to the folder. */
  search(words: string): void;
  /** Reads the next page of the folder or the search. */
  more(): void;
  /** Opens a file, its folder with it where that is not the one shown. */
  open(path: string): void;
  close(): void;
  /** Reads the next piece of the file open. */
  piece(): void;
  mode(mode: OpenFile["mode"]): void;
  draft(draft: OpenFile["draft"]): void;
  save(): void;
  remove(): void;
  /** Deletes a folder of his: at once where it is empty; where it holds anything, RPE says what, and the page asks, then sends it again with `contents`. */
  removeFolder(path: string, contents: boolean): void;
  /** Leaves the folder asked about where it is. */
  keepFolder(): void;
  switchName(path: string, level: FileSwitchAsk["level"], off: boolean): void;
  /** Pins the file for an agent at a level, or takes the pin away. */
  pin(path: string, level: FilePinAsk["level"], agent: string, pinned: boolean): void;
  /** What the pin form holds: the agent chosen or typed, and the level (null: this chat's, or his own with none open). */
  pinning(next: FilesShown["pinning"]): void;
  diff(): void;
  edit(id: number | null): void;
  editText(text: string): void;
  level(id: number, level: WriteLevel): void;
  accept(id: number): void;
  dismiss(id: number): void;
  stack(agent: string): void;
  /** "Apply now": starts the open session's opening block afresh from the files as they stand. */
  applyNow(): void;
  /** Makes a folder, renames or moves a file or folder of his, or copies one. */
  makeFolder(path: string): void;
  /** Makes a file at a level, blank or from the shipped default at `shippedPath`, and opens it. */
  make(path: string, level: WriteLevel, shippedPath: string | null): void;
  move(from: string, to: string): void;
  copy(from: string, to: string): void;
  /** Reads the folder and the suggestions again. */
  refresh(): void;
  stop(): void;
}

/** What the page reads at a time: entries of a folder, and bytes of a file. */
export interface FilesLimits {
  entries: number;
  bytes: number;
}

/**
 * The page's state over its calls: the folder and the open suggestions at once, and again after each change RPE
 * makes; a file each time one is opened, a piece at a time. Only the file open now is shown: an answer for one
 * opened before it, or closed since, is let go, and so is all that comes back once `stop()` is called (the page has
 * left, or moved to another chat).
 */
export function filesControl(calls: FilesCalls, limits: () => FilesLimits, onChange: (shown: FilesShown) => void, start: { folder: string; file: string | null } = { folder: "", file: null }): FilesControl {
  let shown = NO_FILES;
  let alive = true;
  /** The number of the file open now: each opening and closing counts one. */
  let opening = 0;
  /** The number of the listing asked for now: each folder, search and refresh counts one. */
  let listing = 0;
  const show = (next: FilesShown): void => {
    if (!alive) return;
    shown = next;
    onChange(next);
  };
  const change = (n: number, next: (now: OpenFile) => Partial<OpenFile>): void => {
    const now = shown.open;
    if (n === opening && now !== null) show({ ...shown, open: { ...now, ...next(now) } });
  };
  const shut = (): void => {
    opening += 1;
    show({ ...shown, open: null });
  };
  /** Reads a page of the folder or the search: the first replaces what is held, a later one goes behind it. */
  const read = (folder: string, search: string, after: string | undefined): void => {
    listing += 1;
    const n = listing;
    show({ ...shown, browse: { ...(after === undefined ? { ...shown.browse, items: [], next: null } : shown.browse), folder, search, loading: true, problem: null } });
    calls.folder(folder, search === "" ? null : search, after, limits().entries).then(
      (got) => {
        if (n !== listing) return;
        const held = after === undefined ? [] : shown.browse.items;
        show({ ...shown, browse: { folder, search, items: [...held, ...got.items], next: got.next, loading: false, problem: null, levels: got.levels, stopped: got.stopped } });
      },
      (error: unknown) => {
        if (n === listing) show({ ...shown, browse: { ...shown.browse, loading: false, problem: errorWords(error) } });
      },
    );
  };
  const readSuggestions = (): void => {
    calls.suggestions().then(
      (got) => show({ ...shown, suggestions: { ...shown.suggestions, list: got.suggestions, problem: null } }),
      (error: unknown) => show({ ...shown, suggestions: { ...shown.suggestions, problem: errorWords(error) } }),
    );
  };
  const readAgents = (): void => {
    // The definitions of each level the view holds, merged by name: the shipped and the global level keep theirs in `.agents`, a character's and a chat's in `agents`. A chat's two stand only with a chat open; one with no folder yet is read as empty.
    const levels = ["@shipped/.agents", "@global/.agents", ...(calls.chat === null ? [] : ["@character/agents", "agents"])];
    Promise.all(levels.map((folder) => calls.folder(folder, null, undefined, 1000).then((got) => got.items, () => [] as TreeListed[]))).then((lists) => {
      const names = lists.flat().flatMap((item) => (item.entry?.item?.startsWith("agents/") === true ? [item.entry.item.slice("agents/".length)] : []));
      show({ ...shown, agents: [...new Set(names)].sort() });
    });
  };
  const refresh = (): void => {
    read(shown.browse.folder, shown.browse.search, undefined);
    readSuggestions();
  };
  const openFile = (path: string, folder: boolean): void => {
    opening += 1;
    const n = opening;
    // Saving writes a file at its own level unless another is chosen, and a shipped file as yours.
    const level = entryOf(shown.browse, path)?.level ?? (path.startsWith("@shipped/") ? "shipped" : path.startsWith("@global/") ? "global" : path.startsWith("@character/") ? "character" : "chat");
    show({ ...shown, open: { path, file: null, piece: false, problem: null, mode: "read", draft: { text: "", level: level === "shipped" ? "global" : level }, diff: null }, refusal: null });
    if (folder && folderOf(path) !== shown.browse.folder) read(folderOf(path), "", undefined);
    calls.read(path, 0, limits().bytes).then(
      (file) => change(n, (now) => ({ file, draft: { ...now.draft, text: file.text } })),
      (error: unknown) => change(n, () => ({ problem: errorWords(error) })),
    );
  };
  /** Asks RPE for a change; once it is made, `after`, and the listing and suggestions read again. A refusal is kept in RPE's words, under what it was asked for. */
  const ask = <T,>(at: "file" | "make" | number, run: () => Promise<T>, after: (answer: T) => void): void => {
    show({ ...shown, busy: true, refusal: null });
    run().then(
      (answer) => {
        show({ ...shown, busy: false });
        after(answer);
        refresh();
      },
      (error: unknown) => show({ ...shown, busy: false, refusal: { at, words: errorWords(error) } }),
    );
  };
  const suggestions = (next: Partial<SuggestionsShown>): void => show({ ...shown, suggestions: { ...shown.suggestions, ...next } });
  read(start.folder, "", undefined);
  readSuggestions();
  readAgents();
  if (start.file !== null) openFile(start.file, false);
  return {
    folder: (folder) => read(folder, "", undefined),
    search: (words) => read(words === "" ? shown.browse.folder : "", words, undefined),
    more() {
      const { next, folder, search, loading } = shown.browse;
      if (next !== null && !loading) read(folder, search, next);
    },
    open: (path) => openFile(path, true),
    close() {
      opening += 1;
      show({ ...shown, open: null, refusal: null });
    },
    piece() {
      const now = shown.open;
      if (now === null || now.file === null || now.piece || now.file.more !== true) return;
      const n = opening;
      const from = now.file.to ?? 0;
      show({ ...shown, open: { ...now, piece: true } });
      calls.read(now.path, from, limits().bytes).then(
        (next) => change(n, (held) => ({ piece: false, file: held.file === null ? next : { ...held.file, text: held.file.text + next.text, to: next.to, more: next.more } })),
        (error: unknown) => change(n, () => ({ piece: false, problem: errorWords(error) })),
      );
    },
    mode(mode) {
      const now = shown.open;
      if (now === null) return;
      // Editing starts again from the file as read.
      show({ ...shown, refusal: null, open: { ...now, mode, draft: mode === "edit" ? { ...now.draft, text: now.file?.text ?? now.draft.text } : now.draft } });
    },
    draft(draft) {
      const now = shown.open;
      if (now !== null) show({ ...shown, open: { ...now, draft } });
    },
    save() {
      const now = shown.open;
      if (now === null) return;
      // What was written is opened: for a file of another level, that is your own file of its name.
      ask(
        "file",
        () => calls.save(now.path, now.draft.level, now.draft.text),
        (answer) => openFile(answer.file?.path ?? now.path, false),
      );
    },
    remove() {
      const now = shown.open;
      if (now === null) return;
      ask("file", () => calls.remove(now.path), shut);
    },
    removeFolder(path, contents) {
      show({ ...shown, busy: true, refusal: null, deleting: null });
      calls.remove(path, contents).then(
        () => {
          show({ ...shown, busy: false });
          refresh();
        },
        (error: unknown) => {
          // A folder that holds something is asked about, in what RPE says it holds; any other refusal is kept in its words.
          if (error instanceof RpeError && error.status === 409) show({ ...shown, busy: false, deleting: { path, words: errorWords(error) } });
          else show({ ...shown, busy: false, refusal: { at: "make", words: errorWords(error) } });
        },
      );
    },
    keepFolder() {
      show({ ...shown, deleting: null });
    },
    switchName(path, level, off) {
      ask(
        "file",
        () => calls.switchName(path, level, off),
        () => undefined,
      );
    },
    pin(path, level, agent, pinned) {
      ask(
        "file",
        () => calls.pin(path, level, agent, pinned),
        () => {
          if (pinned) show({ ...shown, pinning: { ...shown.pinning, agent: "" } });
        },
      );
    },
    pinning(next) {
      show({ ...shown, pinning: next });
    },
    diff() {
      const now = shown.open;
      if (now === null) return;
      const n = opening;
      show({ ...shown, open: { ...now, diff: { answer: null, problem: null } } });
      calls.diff(now.path).then(
        (answer) => change(n, () => ({ diff: { answer, problem: null } })),
        (error: unknown) => change(n, () => ({ diff: { answer: null, problem: errorWords(error) } })),
      );
    },
    edit(id) {
      const s = id === null ? undefined : shown.suggestions.list?.find((one) => one.id === id);
      suggestions({ editing: s === undefined ? null : { id: s.id, text: s.text } });
    },
    editText(text) {
      const editing = shown.suggestions.editing;
      if (editing !== null) suggestions({ editing: { ...editing, text } });
    },
    level(id, level) {
      suggestions({ levels: { ...shown.suggestions.levels, [id]: level } });
    },
    accept(id) {
      const s = shown.suggestions.list?.find((one) => one.id === id);
      if (s === undefined) return;
      const editing = shown.suggestions.editing;
      const text = editing !== null && editing.id === id ? editing.text : null;
      ask(
        id,
        () => calls.accept(id, shown.suggestions.levels[id] ?? suggestedLevel(s.path, s.level), text),
        () => suggestions({ editing: null }),
      );
    },
    dismiss(id) {
      ask(
        id,
        () => calls.dismiss(id),
        () => undefined,
      );
    },
    stack(agent) {
      const asking: StackShown = { agent, parts: null, handed: null, problem: null };
      show({ ...shown, stack: asking });
      // Only the stack asked for last is shown.
      const answered = (stack: StackShown): void => {
        if (shown.stack === asking) show({ ...shown, stack });
      };
      calls.stack(agent).then(
        (got) => answered({ agent, parts: got.parts, handed: got.handed, problem: null }),
        (error: unknown) => answered({ agent, parts: null, handed: null, problem: errorWords(error) }),
      );
    },
    applyNow() {
      show({ ...shown, apply: { busy: true, note: null, problem: null } });
      calls.applyNow().then(
        (got) => show({ ...shown, apply: { busy: false, note: got.note, problem: null } }),
        (error: unknown) => show({ ...shown, apply: { busy: false, note: null, problem: errorWords(error) } }),
      );
    },
    makeFolder(path) {
      ask("make", () => calls.makeFolder(path), () => undefined);
    },
    make(path, level, shippedPath) {
      // A new file starts blank, or from the shipped default of its name, which it then replaces.
      const start = shippedPath === null ? Promise.resolve("") : calls.read(shippedPath, 0, limits().bytes).then((got) => got.text, () => "");
      ask("make", () => start.then((text) => calls.save(path, level, text)), (made) => openFile(made.file?.path ?? path, true));
    },
    move(from, to) {
      ask("make", () => calls.move(from, to), (moved) => (shown.open?.path === from ? openFile(moved.path, false) : undefined));
    },
    copy(from, to) {
      ask("make", () => calls.copy(from, to), () => undefined);
    },
    refresh,
    stop() {
      alive = false;
    },
  };
}

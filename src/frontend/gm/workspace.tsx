// GM → Workspace (DESIGN §4.4; AGENT-LOOP-PLAN §9; INC1-SPEC R6b, contract C8): the notes the agents
// keep for this chat at its head, its learned area, its turns' transcripts and its pins file, behind
// the GM gate, as a two-pane browser: the list on one side, what you opened on the other; in a narrow
// drawer the opened pane takes the list's place, with Back. The list (`lre.workspace {op: "list"}`,
// asked again whenever the GM view reloads) groups the files by area (`workspace-tree.ts`): Notes,
// Learned (learned/), Transcripts (transcripts/, folded until you open it) and the Pins file
// (.pins.json), each as folders first, names in natural order, every file with chips for who wrote
// it, at which reply, who may read it and whether it is pinned, learned or read-only. New note asks
// for a path (and who may read it) and writes the note empty (`{op: "write"}`), then opens it. A
// file's pane reads its text (`{op: "read"}`) into a draft to edit inline: Save sends it (Ctrl+S or
// ⌘S too), Revert takes the draft back, and leaving a draft with changes not saved asks first; Pin
// or Unpin (`{op: "pin"}`), Who may read it (`{op: "readers"}`), Rename or move (`{op: "move"}`, the
// pane following it) and Delete (`{op: "delete"}`). Each change is one GM edit with its Undo chip,
// held while a reply is written: GmPanel says it (`changed`) with its Undo, as after an edit; a
// learned file's changes land at once, with none, so deleting one asks first. A transcript opens
// read-only. Above the files, the main agent's session at the head (`{op: "session"}`, read with the
// list) opens in the same pane: its turns as message bubbles, whether a compaction summary stands in
// for its older turns, and Roll back for its latest compaction (`{op: "rollback"}`), which the next
// agent turn's record carries (INC2-SPEC C14). Workspace content and the session never go to Play or
// the drawer's activity line.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { AgentKnowledge } from "../../shared/agent-tools";
import type { ChatId } from "../../shared/ids";
import type { ResultBodies, SessionMessageView, SessionView, WorkspaceFileView } from "../../shared/protocol";
import { isLearnedPath, isTranscriptPath, isWorkspacePath, PINS_PATH } from "../../shared/stores";
import { useApp } from "../app";
import { Badge, Button, Disclosure, Empty, Field, IdText, Seg, useBusy } from "../components";
import { Icon } from "../icons";
import type { GmSectionProps, RequestBody } from "../registry";
import { GmPage, usePages } from "./ui";
import { AREA_WORDS, type FileChip, fileChips, folderOf, workspaceArea, workspaceGroups, type WorkspaceNode, writerWords } from "./workspace-tree";

/** A workspace request as the tab sends it (C8 `lre.workspace`). */
export type WorkspaceBody = Extract<RequestBody, { type: "lre.workspace" }>;

/** What a workspace request answers: `files` after `list` and each change, `text` after `read`, and a change's `pending` and `undo`. */
export type WorkspaceResult = ResultBodies["lre.workspace"];

/** Sends one workspace request: its result, or null when it failed (the error already said in a toast, as `app.request` does). */
export type WorkspaceAsk = (body: WorkspaceBody) => Promise<WorkspaceResult | null>;

/** The tab's requests, each built for one chat. A change resolves true once it landed (or is held); `landed` runs as soon as the list is set from its result, before the GM view loads again. */
export interface WorkspaceControls {
  /** The chat's files, or null when the list failed. */
  list(): Promise<WorkspaceFileView[] | null>;
  /** A file's text: null when there is no such file, undefined when the read failed. */
  read(path: string): Promise<string | null | undefined>;
  /** A new note at `path`, empty, read by `readers`. */
  create(path: string, readers: AgentKnowledge, landed?: () => void): Promise<boolean>;
  save(path: string, text: string, landed?: () => void): Promise<boolean>;
  pin(path: string, pinned: boolean, landed?: () => void): Promise<boolean>;
  readers(path: string, readers: AgentKnowledge, landed?: () => void): Promise<boolean>;
  move(from: string, to: string, landed?: () => void): Promise<boolean>;
  remove(path: string, landed?: () => void): Promise<boolean>;
  /** The main agent's session at the head, or null when the read failed. */
  session(): Promise<SessionView | null>;
  /** Asks for its latest compaction's rollback: the session after it, or null when it was refused. */
  rollback(): Promise<SessionView | null>;
}

/** Whose knowledge may read a file, as its page offers the choice: the GM's alone, everyone's (and so the GM's), or your character's (every agent's). */
export const READERS_LABELS: Readonly<Record<AgentKnowledge, string>> = { gm: "GM only", everyone: "Everyone's, secrets marked", pov: "Your character's" };

/** What each choice means, under the choice. */
export const READERS_NOTES: Readonly<Record<AgentKnowledge, string>> = {
  gm: "Only agents reading with the GM's knowledge see it.",
  everyone: "Agents reading with everyone's knowledge see it too, as the GM's do; agents reading as your character don't.",
  pov: "Every agent sees it, those reading as your character too: keep anything your character doesn't know out of it.",
};

const READERS_OPTIONS = (["gm", "everyone", "pov"] as const).map((k) => ({ value: k, label: READERS_LABELS[k] }));

/**
 * The tab's requests over `request` for chat `chatId`. After each change that landed, the list is
 * set from the result's `files` (`out.files`), then `out.changed` gets the change in a sentence
 * ("Saved notes/marcus.md") with its result, for GmPanel's notice and its Undo.
 */
export function workspaceControls(chatId: ChatId, request: WorkspaceAsk, out: { files(files: WorkspaceFileView[]): void; changed(text: string, result: WorkspaceResult): Promise<void> }): WorkspaceControls {
  const change = async (body: WorkspaceBody, text: string, landed: (() => void) | undefined): Promise<boolean> => {
    const result = await request(body);
    if (result === null) return false;
    if (result.files) out.files(result.files);
    landed?.();
    await out.changed(text, result);
    return true;
  };
  return {
    list: async () => (await request({ type: "lre.workspace", op: "list", chatId }))?.files ?? null,
    read: async (path) => {
      const result = await request({ type: "lre.workspace", op: "read", chatId, path });
      return result === null ? undefined : (result.text ?? null);
    },
    create: (path, readers, landed) => change({ type: "lre.workspace", op: "write", chatId, path, text: "", readers }, `Created ${path}`, landed),
    save: (path, text, landed) => change({ type: "lre.workspace", op: "write", chatId, path, text }, `Saved ${path}`, landed),
    pin: (path, pinned, landed) => change({ type: "lre.workspace", op: "pin", chatId, path, pinned }, `${pinned ? "Pinned" : "Unpinned"} ${path}`, landed),
    readers: (path, readers, landed) => change({ type: "lre.workspace", op: "readers", chatId, path, readers }, `Who may read ${path}: ${READERS_LABELS[readers]}`, landed),
    move: (from, to, landed) => change({ type: "lre.workspace", op: "move", chatId, from, to }, `Moved ${from} to ${to}`, landed),
    remove: (path, landed) => change({ type: "lre.workspace", op: "delete", chatId, path }, `Deleted ${path}`, landed),
    session: async () => (await request({ type: "lre.workspace", op: "session", chatId }))?.session ?? null,
    rollback: async () => (await request({ type: "lre.workspace", op: "rollback", chatId }))?.session ?? null,
  };
}

/**
 * Who wrote a file and when, in a sentence: "GM assistant · reply 4", "You · before the first reply"
 * (you, or an agent by its name in Settings → Agents). A file no agent wrote is the turn's own, or,
 * when no reply holds it yet, the turn under way's.
 */
export function provenanceWords(file: WorkspaceFileView): string {
  const { role, turn } = file.provenance;
  if (file.transcript) return `The turn's transcript · reply ${turn ?? "?"}`;
  if (role === undefined) return turn === null ? "Written by the turn under way" : `The turn's own · reply ${turn}`;
  const who = role === "gm" ? "You" : writerWords(file);
  return `${who} · ${turn === null ? "before the first reply" : `reply ${turn}`}`;
}

/** A size in characters: "1 character", "4,120 characters". */
export function sizeWords(size: number): string {
  return `${size.toLocaleString("en-US")} character${size === 1 ? "" : "s"}`;
}

const PATH_WORDS = "A path is names joined by /: letters, digits, dots, dashes, underscores and single spaces, no name empty, . or .., such as notes/marcus.md.";
const TRANSCRIPT_WORDS = "transcripts/ holds the turns' transcripts, which are read-only: choose another folder.";

/** Why a file can't move to `to` yet, in words, or null when it can: a new path, a valid one, one no listed file has, outside transcripts/, and one on the same side of the learned area. */
export function moveProblem(from: string, to: string, paths: readonly string[]): string | null {
  if (to === from) return "Type the path to move it to.";
  if (!isWorkspacePath(to)) return PATH_WORDS;
  if (paths.includes(to)) return `There is already a file at ${to}.`;
  if (isTranscriptPath(to)) return TRANSCRIPT_WORDS;
  if (isLearnedPath(from) !== isLearnedPath(to)) return "A file under learned/ stays there, and the others stay out of it: write the file at its new path, then delete this one.";
  return null;
}

/** Why a new note can't be written at `path` yet, in words, or null when it can: a whole, valid path no listed file has, outside transcripts/. */
export function newNoteProblem(path: string, paths: readonly string[]): string | null {
  if (path === "" || path.endsWith("/")) return "Type the note's path, its name last, such as notes/marcus.md.";
  if (!isWorkspacePath(path)) return PATH_WORDS;
  if (paths.includes(path)) return `There is already a file at ${path}.`;
  if (isTranscriptPath(path)) return TRANSCRIPT_WORDS;
  return null;
}

/** Where a new note starts: in the folder of the file open (not a transcript's), else under notes/. */
export function newNoteFolder(open: string | null): string {
  if (open === null || open === SESSION_PAGE || isTranscriptPath(open) || open === PINS_PATH) return "notes/";
  return folderOf(open) || "notes/";
}

/** The pane's page for the main agent's session: no workspace path can be it (`@` is no path's). */
export const SESSION_PAGE = "@session";

/**
 * Leaving the pane: with no draft changed (`dirty` null), `next` runs at once; with changes not
 * saved to the file at `dirty`, only once `confirm` says to discard them. True when it left.
 */
export async function guardDraft(dirty: string | null, confirm: (title: string, message: string, label: string) => Promise<boolean>, next: () => void): Promise<boolean> {
  if (dirty !== null && !(await confirm("Discard your changes?", `${dirty} has changes you haven't saved. Leave it and they're gone.`, "Discard"))) return false;
  next();
  return true;
}

/** The path dialog's state: a new note (with who may read it) or a file's new path. */
export interface PathDialogState {
  mode: "new" | "move";
  /** The file moved; null for a new note. */
  from: string | null;
  value: string;
  readers: AgentKnowledge;
}

// ---------------------------------------------------------------- the tab

export function WorkspaceSection(props: GmSectionProps) {
  const app = useApp();
  const pages = usePages<string>();
  const [working, run] = useBusy();
  const [files, setFiles] = useState<WorkspaceFileView[] | null>(null);
  // The main agent's session at the head: undefined while it is read, null when the read failed.
  const [session, setSession] = useState<SessionView | null | undefined>(undefined);
  // The text read for the pane's file (null: no such file), and the draft over it.
  const [opened, setOpened] = useState<{ path: string; text: string | null } | null>(null);
  const [draft, setDraft] = useState("");
  const [dialog, setDialog] = useState<PathDialogState | null>(null);
  // The areas and folders you folded or unfolded, by key; the rest show as they start.
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  const controls = workspaceControls(props.chatId, (body) => app.request<"lre.workspace">(body), { files: setFiles, changed: props.changed });
  // Read again whenever the GM view reloads: an Undo, a turn or a swipe may have changed the files and the session.
  useEffect(() => {
    let live = true;
    void controls.list().then((listed) => {
      if (live && listed !== null) setFiles(listed);
    });
    void controls.session().then((read) => {
      if (live) setSession(read);
    });
    return () => {
      live = false;
    };
  }, [props.chatId, props.gm]);
  const page = pages.page;
  const onSession = page === SESSION_PAGE;
  const selected = page === null || onSession || files === null ? undefined : files.find((f) => f.path === page);
  const text = selected !== undefined && opened !== null && opened.path === selected.path ? opened.text : undefined;
  const dirty = typeof text === "string" && draft !== text;
  // A file no longer listed (an Undo took back its write, a swipe went back before it) gives way to the list.
  useEffect(() => {
    if (page !== null && !onSession && files !== null && selected === undefined) pages.back();
  });
  // The pane's text: read on open, and again when the GM view reloads unless the draft holds changes not saved.
  useEffect(() => {
    if (page === null || page === SESSION_PAGE) {
      setOpened(null);
      return;
    }
    // The same file read again: what the pane holds now, kept when the draft has changes not saved.
    const held = opened !== null && opened.path === page ? opened : null;
    if (held !== null && held.text !== null && draft !== held.text) return;
    let live = true;
    void controls.read(page).then((read) => {
      if (!live) return;
      if (read === undefined) {
        if (held === null) pages.back();
        return;
      }
      setOpened({ path: page, text: read });
      // Typing since the read was asked for wins over it.
      setDraft((now) => (held !== null && now !== (held.text ?? "") ? now : (read ?? "")));
    });
    return () => {
      live = false;
    };
  }, [page, props.chatId, props.gm]);
  // Leaving a draft with changes not saved asks first; `next` runs once you choose to.
  const leave = (next: () => void): void => {
    void guardDraft(dirty ? (selected?.path ?? null) : null, (title, message, label) => app.host.confirm(title, message, "danger", label), () => {
      if (dirty && opened !== null) setDraft(opened.text ?? "");
      next();
    });
  };
  const open = (next: string) => {
    if (next !== page) leave(() => pages.open(next));
  };
  const busy = props.busy || working;
  const paths = (files ?? []).map((f) => f.path);
  const pane =
    selected !== undefined ? (
      <WorkspaceFilePane
        file={selected}
        text={text}
        draft={draft}
        busy={busy}
        controls={controls}
        run={run}
        confirm={(title, message, label) => app.host.confirm(title, message, "danger", label)}
        onDraft={setDraft}
        onSaved={(saved) => setOpened({ path: selected.path, text: saved })}
        onRevert={() => setDraft(text ?? "")}
        onMove={() => setDialog({ mode: "move", from: selected.path, value: selected.path, readers: selected.readers })}
        onDeleted={() => {
          setOpened(null);
          setDraft("");
          pages.back();
        }}
        onBack={() => leave(pages.back)}
      />
    ) : onSession ? (
      <GmPage name="workspace-session" title="The main agent's session" subtitle="What it holds, and what of it the main agent is sent" backLabel="Workspace" onBack={pages.back}>
        <SessionPanel
          session={session}
          busy={busy}
          onRollback={() =>
            run(async () => {
              const after = await controls.rollback();
              if (after !== null) setSession(after);
            })
          }
        />
      </GmPage>
    ) : (
      <div class="lre-ws-placeholder" aria-hidden="true">
        <Icon name="file" size={24} />
        <span>Open a note to read and edit it here.</span>
      </div>
    );
  const submit = (state: PathDialogState) => {
    if (state.mode === "new")
      run(async () => {
        const path = state.value;
        const made = await controls.create(path, state.readers, () => {
          setOpened({ path, text: "" });
          setDraft("");
          pages.open(path);
        });
        if (made) setDialog(null);
      });
    else if (state.from !== null) {
      const from = state.from;
      run(async () => {
        const moved = await controls.move(from, state.value, () => {
          setOpened((o) => (o === null ? null : { path: state.value, text: o.text }));
          pages.open(state.value);
        });
        if (moved) setDialog(null);
      });
    }
  };
  return (
    <div class="lre-ws-wrap">
      <div
        ref={pages.host.ref}
        class={page !== null ? "lre-gm-pages lre-ws has-preview" : "lre-gm-pages lre-ws"}
        onKeyDown={(event) => {
          if (event.key === "Escape" && dirty && page !== null && !event.defaultPrevented) {
            event.preventDefault();
            event.stopPropagation();
            leave(pages.back);
            return;
          }
          pages.host.onKeyDown(event);
        }}
        data-lre-gm-section="workspace"
      >
        <div class="lre-ws-browser">
          <WorkspaceBrowser
            files={files}
            session={session}
            selected={page}
            busy={busy}
            open={(key, start) => toggled[key] ?? start}
            onToggle={(key, now) => setToggled((t) => (t[key] === now ? t : { ...t, [key]: now }))}
            onOpen={open}
            onNew={() => leave(() => setDialog({ mode: "new", from: null, value: newNoteFolder(page), readers: "gm" }))}
          />
        </div>
        {pane}
      </div>
      {dialog !== null ? (
        <ModalDialog labelledBy={DIALOG_TITLE_ID} onCancel={() => setDialog(null)}>
          <PathDialog state={dialog} paths={paths} busy={busy} onChange={setDialog} onSubmit={() => submit(dialog)} onCancel={() => setDialog(null)} />
        </ModalDialog>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- the browser

/** A file's chips, in a row: each says its words, its full meaning in its tooltip. */
export function ChipRow(props: { chips: readonly FileChip[]; label?: string }) {
  return (
    <span class="lre-ws-chips" role={props.label ? "group" : undefined} aria-label={props.label}>
      {props.chips.map((c) => (
        <span key={`${c.kind}:${c.text}`} class="lre-ws-chip" data-chip={c.kind} title={c.title}>
          {c.text}
        </span>
      ))}
    </span>
  );
}

export interface WorkspaceBrowserProps {
  /** The chat's files; null while they are read. */
  files: readonly WorkspaceFileView[] | null;
  /** The main agent's session: undefined while it is read, null when that failed. */
  session: SessionView | null | undefined;
  /** What the pane shows: a file's path, `SESSION_PAGE`, or null. */
  selected: string | null;
  busy: boolean;
  /** Whether an area or a folder shows open: its own choice, else `start`. */
  open(key: string, start: boolean): boolean;
  onToggle(key: string, open: boolean): void;
  onOpen(page: string): void;
  onNew(): void;
}

/** A file's row: its icon, its name, its size, and its chips under them; the row the pane shows is current. */
function fileRow(file: WorkspaceFileView, name: string, props: WorkspaceBrowserProps) {
  const current = props.selected === file.path;
  return (
    <li key={file.path} class="lre-ws-item">
      <button type="button" class="lre-ws-row" data-lre-ws-file={file.path} aria-current={current ? "true" : undefined} title={file.path} onClick={() => props.onOpen(file.path)}>
        <Icon name="file" size={16} class="lre-ws-row-icon" />
        <span class="lre-ws-row-name">{name}</span>
        <span class="lre-ws-row-size">{sizeWords(file.size)}</span>
        <ChipRow chips={fileChips(file)} />
        {file.provenance.key !== undefined ? <IdText id={file.provenance.key} /> : null}
      </button>
    </li>
  );
}

/** A tree's nodes as a list: a folder folds over what it holds (open until you fold it), a file is its row. */
function treeList(nodes: readonly WorkspaceNode[], props: WorkspaceBrowserProps, label?: string) {
  return (
    <ul class="lre-ws-tree" aria-label={label}>
      {nodes.map((n) =>
        n.kind === "file" ? (
          fileRow(n.file, n.name, props)
        ) : (
          <li key={n.path} class="lre-ws-item">
            <details class="lre-ws-folder" data-lre-ws-folder={n.path} open={props.open(`folder:${n.path}`, true)} onToggle={(event) => props.onToggle(`folder:${n.path}`, (event.currentTarget as HTMLDetailsElement).open)}>
              <summary class="lre-ws-folder-head">
                <Icon name="folder" size={16} class="lre-ws-row-icon" />
                <span class="lre-ws-row-name">{n.name}</span>
                <span class="lre-ws-row-size">{`${n.count} file${n.count === 1 ? "" : "s"}`}</span>
              </summary>
              {treeList(n.children, props)}
            </details>
          </li>
        ),
      )}
    </ul>
  );
}

/** The session's row over the files: how much it holds and whether a rollback waits. */
function sessionRow(props: WorkspaceBrowserProps) {
  const { session } = props;
  if (session === undefined) return null;
  const chips: FileChip[] =
    session === null
      ? [{ kind: "warn", text: "Didn't load", title: "The engine didn't answer with the main agent's session" }]
      : [
          { kind: "info", text: `${session.turns} turn${session.turns === 1 ? "" : "s"}`, title: `It holds ${session.turns} turn${session.turns === 1 ? "" : "s"} whole` },
          { kind: "info", text: `~${session.tokens.toLocaleString("en-US")} tokens`, title: `About ${session.tokens.toLocaleString("en-US")} tokens` },
          ...(session.summary !== null ? [{ kind: "info" as const, text: "Summarized", title: "A compaction summary stands in for its older turns" }] : []),
          ...(session.rollback === "pending" ? [{ kind: "warn" as const, text: "Rollback waits", title: "The next agent turn rolls the latest compaction back" }] : []),
        ];
  return (
    <button type="button" class="lre-ws-row lre-ws-session-row" data-lre-ws-session aria-current={props.selected === SESSION_PAGE ? "true" : undefined} onClick={() => props.onOpen(SESSION_PAGE)}>
      <Icon name="message" size={16} class="lre-ws-row-icon" />
      <span class="lre-ws-row-name">The main agent's session</span>
      <span class="lre-ws-row-size" />
      <ChipRow chips={chips} />
    </button>
  );
}

/**
 * The browser: New note and how many files there are, the main agent's session, then the files by
 * area (Notes, Learned, Transcripts folded until you open them, the Pins file), each area's folders
 * first and names in natural order, every file with its chips; empty, what the workspace will hold.
 */
export function WorkspaceBrowser(props: WorkspaceBrowserProps) {
  const { files } = props;
  const pinned = files?.filter((f) => f.pinned).length ?? 0;
  return (
    <div class="lre-ws-list" data-lre-gm-list="workspace">
      <div class="lre-ws-toolbar">
        <span class="lre-ws-count" role="status">
          {files === null ? "Reading the workspace…" : `${files.length} file${files.length === 1 ? "" : "s"}${pinned > 0 ? ` · ${pinned} pinned` : ""}`}
        </span>
        <Button size="sm" variant="primary" icon="plus" disabled={props.busy || files === null} onClick={props.onNew}>
          New note
        </Button>
      </div>
      {sessionRow(props)}
      {files === null ? null : files.length === 0 ? (
        <Empty icon="box" title="Nothing in the workspace yet">
          The workspace holds the notes the agents keep for this chat as the story goes: what they've worked out, what they plan, drafts for you to look over. The notes follow the story: swipe back past a reply and what it wrote goes with it. Notes under learned/ are kept apart from the story: a swipe never changes them, and a Branch takes them along.
        </Empty>
      ) : (
        workspaceGroups(files).map((g) => (
          <details key={g.area} class="lre-ws-group" data-lre-ws-area={g.area} open={props.open(`area:${g.area}`, g.area !== "transcripts")} onToggle={(event) => props.onToggle(`area:${g.area}`, (event.currentTarget as HTMLDetailsElement).open)}>
            <summary class="lre-ws-group-head">
              <span class="lre-ws-group-title">{AREA_WORDS[g.area].title}</span>
              <span class="lre-ws-group-count">{g.files.length}</span>
              <Icon name="chevron-down" size={16} class="lre-ws-group-chev" />
            </summary>
            <p class="lre-gm-note lre-ws-group-note">{AREA_WORDS[g.area].note}</p>
            {treeList(g.nodes, props, AREA_WORDS[g.area].title)}
          </details>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------- a file's pane

/** What a file's pane shows and what its controls do; the tab's wrapper keeps the state. */
export interface WorkspaceFilePaneProps {
  file: WorkspaceFileView;
  /** The text read: undefined while it is read, null when the file is gone. */
  text: string | null | undefined;
  draft: string;
  busy: boolean;
  controls: WorkspaceControls;
  /** Runs a request with the busy flag (`useBusy`). */
  run(action: () => Promise<unknown>): void;
  /** Asks before a change with no Undo: true to go ahead. */
  confirm(title: string, message: string, label: string): Promise<boolean>;
  onDraft(text: string): void;
  /** Its draft saved: the text read is now `text`. */
  onSaved(text: string): void;
  /** Takes the draft back to the text read. */
  onRevert(): void;
  /** Opens the path dialog to rename or move it. */
  onMove(): void;
  /** Deleted: the pane closes. */
  onDeleted(): void;
  onBack(): void;
}

export const TEXT_ID = "lre-workspace-text";

/**
 * A file's pane: its chips, then its text to edit inline with Save and Revert and whether it is
 * saved; its actions (Pin or Unpin, Rename or move, Delete) and who may read it. A transcript is
 * read-only; the pins file isn't pinned; a learned file says a change lands at once.
 */
export function WorkspaceFilePane(props: WorkspaceFilePaneProps) {
  const { file, text, draft, busy } = props;
  const dirty = typeof text === "string" && draft !== text;
  const name = file.path.slice(folderOf(file.path).length);
  const area = workspaceArea(file.path);
  const save = () => props.run(() => props.controls.save(file.path, draft, () => props.onSaved(draft)));
  const remove = () =>
    props.run(async () => {
      if (file.learned && !(await props.confirm("Delete the learned note", `Delete ${file.path}? A learned note's change lands at once: there is no Undo.`, "Delete"))) return;
      await props.controls.remove(file.path, props.onDeleted);
    });
  return (
    <GmPage name="workspace-file" title={name} subtitle={<>{folderOf(file.path) || "The workspace's top"} · {sizeWords(file.size)}</>} backLabel="Workspace" onBack={props.onBack}>
      <div class="lre-stack lre-ws-pane" data-lre-workspace-file={file.path}>
        <ChipRow chips={fileChips(file)} label="About this file" />
        {text === null ? (
          <Empty icon="box">This file is gone: an Undo, a swipe or another change took it away.</Empty>
        ) : file.transcript ? (
          <>
            <p class="lre-gm-note">Everything the turn's agents did, as Live showed it: kept with the reply, read-only, and read by agents only with the GM's knowledge. A swipe has its own; it is no pin and no part of the main session.</p>
            {text === undefined ? <p class="lre-gm-note">Reading it…</p> : <pre class="lre-workspace-session-text" tabIndex={0} aria-label={`Text of ${file.path}, read-only`}>{text}</pre>}
          </>
        ) : text === undefined ? (
          <p class="lre-gm-note">Reading it…</p>
        ) : (
          <>
            <div class="lre-ws-editor-bar">
              <span class={dirty ? "lre-ws-saved dirty" : "lre-ws-saved"} role="status">
                {dirty ? "Not saved" : "Saved"} · {sizeWords(draft.length)}
              </span>
              <span class="lre-ws-editor-buttons">
                <Button size="sm" variant="ghost" icon="undo" disabled={busy || !dirty} onClick={props.onRevert}>
                  Revert
                </Button>
                <Button size="sm" variant="primary" icon="check" disabled={busy || !dirty} onClick={save}>
                  Save
                </Button>
              </span>
            </div>
            <textarea
              id={TEXT_ID}
              class="lre-input lre-workspace-text"
              aria-label={`Text of ${file.path}`}
              spellcheck={false}
              value={draft}
              onInput={(event) => props.onDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
                event.preventDefault();
                if (dirty && !busy) save();
              }}
            />
            <div class="lre-ws-actions" role="group" aria-label="This file">
              {area !== "pins" ? (
                <Button size="sm" icon="pin" disabled={busy} onClick={() => props.run(() => props.controls.pin(file.path, !file.pinned))}>
                  {file.pinned ? "Unpin" : "Pin"}
                </Button>
              ) : null}
              <Button size="sm" icon="route" disabled={busy} onClick={props.onMove}>
                Rename or move
              </Button>
              <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={remove}>
                Delete
              </Button>
            </div>
            <p class="lre-gm-note">
              {area === "pins"
                ? "The pins file says which files each role is shown first, and how much of them; only you change it."
                : file.pinned
                  ? "Pinned: it goes with every agent turn."
                  : "Pin it to send it with every agent turn; unpinned, the agents read it when they need it."}{" "}
              {file.learned ? "A learned note's change lands at once, with no Undo." : "Each change has its Undo, in the notice above."}
            </p>
            <div class="lre-stack">
              <Seg<AgentKnowledge> label="Who may read it" value={file.readers} options={READERS_OPTIONS} disabled={busy} onChange={(readers) => props.run(() => props.controls.readers(file.path, readers))} />
              <p class="lre-gm-note">{READERS_NOTES[file.readers]} A file an agent writes is read with the knowledge it wrote it under.</p>
            </div>
          </>
        )}
      </div>
    </GmPage>
  );
}

// ---------------------------------------------------------------- the path dialog

export const DIALOG_TITLE_ID = "lre-workspace-dialog-title";
export const PATH_ID = "lre-workspace-path";

/** A modal over the page (a native dialog: focus stays in it, Escape cancels), shown while it is mounted. */
function ModalDialog(props: { labelledBy: string; onCancel(): void; children: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector<HTMLInputElement>(`#${PATH_ID}`)?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      class="lre-ws-dialog"
      aria-labelledby={props.labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        props.onCancel();
      }}
      // Escape here is the dialog's: the page under it stays.
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      {props.children}
    </dialog>
  );
}

/**
 * The path dialog: a new note's path and who may read it, or a file's new path to rename or move
 * it; what's wrong with the path under it, once it is one you typed; Create or Move only for a path
 * that can take it.
 */
export function PathDialog(props: { state: PathDialogState; paths: readonly string[]; busy: boolean; onChange(state: PathDialogState): void; onSubmit(): void; onCancel(): void }) {
  const { state } = props;
  const fresh = state.mode === "new";
  const problem = fresh ? newNoteProblem(state.value, props.paths) : moveProblem(state.from ?? "", state.value, props.paths);
  // Nothing's wrong yet while the path is still the one it started at, or a folder waiting for a name.
  const said = (fresh ? state.value === "" || state.value.endsWith("/") : state.value === state.from) ? null : problem;
  return (
    <form
      class="lre-ws-dialog-form"
      data-lre-ws-dialog={state.mode}
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null && !props.busy) props.onSubmit();
      }}
    >
      <h2 id={DIALOG_TITLE_ID} class="lre-ws-dialog-title">
        {fresh ? "New note" : `Rename or move ${state.from ?? ""}`}
      </h2>
      <Field label="Path" for={PATH_ID} help={fresh ? "Folders and its name, joined by /, such as notes/marcus.md." : "Change its name, its folder or both, such as notes/people/marcus.md."} error={said}>
        <input id={PATH_ID} class="lre-input lre-ws-path" autoComplete="off" spellcheck={false} value={state.value} onInput={(event) => props.onChange({ ...state, value: event.currentTarget.value })} />
      </Field>
      {fresh ? (
        <div class="lre-stack">
          <Seg<AgentKnowledge> label="Who may read it" value={state.readers} options={READERS_OPTIONS} disabled={props.busy} onChange={(readers) => props.onChange({ ...state, readers })} />
          <p class="lre-gm-note">{READERS_NOTES[state.readers]}</p>
        </div>
      ) : null}
      <div class="lre-ws-dialog-actions">
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon={fresh ? "plus" : "route"} disabled={props.busy || problem !== null}>
          {fresh ? "Create" : "Move"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- the main session

/** Whose knowledge a part of the session was made under, as the session panel says it. */
const MADE_UNDER: Readonly<Record<AgentKnowledge, string>> = { gm: "the GM's knowledge", everyone: "everyone's knowledge, secrets marked", pov: "your character's knowledge" };

/** The same, short, for a message's chip. */
const KNOWLEDGE_SHORT: Readonly<Record<AgentKnowledge, string>> = { gm: "GM's knowledge", everyone: "Everyone's knowledge", pov: "Your character's knowledge" };

/** Who a message of the session is from: the engine's message to the main agent, or its answer; in a fixed pipeline's digest, the player's words or the reply. */
function speaker(m: SessionMessageView): string {
  if (m.main) return m.role === "user" ? "To the main agent" : "The main agent";
  return m.role === "user" ? "The player" : "The reply";
}

/** A message as a bubble: what's sent to the main agent (or the player's words) on one side, its answer (or the reply) on the other; its speaker and chips over it, the files its tools read and the digest's roles under it. */
function bubble(m: SessionMessageView, key: number) {
  return (
    <li key={key} class={m.role === "user" ? "lre-ws-msg to" : "lre-ws-msg from"} data-lre-session-read={m.read ? "read" : "unread"}>
      <div class="lre-ws-msg-meta">
        <span class="lre-ws-msg-who">{speaker(m)}</span>
        {m.knowledge ? (
          <span class="lre-ws-chip" data-chip="readers" title={`Made under ${MADE_UNDER[m.knowledge]}`}>
            {KNOWLEDGE_SHORT[m.knowledge]}
          </span>
        ) : null}
        {m.read ? null : (
          <span class="lre-ws-chip" data-chip="unsent" title="With its knowledge now, the main agent isn't sent this message">
            Not sent to the main agent now
          </span>
        )}
      </div>
      <div class="lre-ws-msg-bubble" tabIndex={0} aria-label={speaker(m)}>
        {m.text}
      </div>
      {m.files && m.files.length > 0 ? <p class="lre-ws-msg-foot">{`Files its tools read: ${m.files.join(", ")}`}</p> : null}
      {m.engine && (m.engine.roles.length > 0 || m.engine.committed.length > 0) ? <p class="lre-ws-msg-foot">{`Roles: ${m.engine.roles.map((r) => `${r.role} (${r.via === "prompt_only" ? "prompt-only" : "agent"}${r.ok ? "" : ", failed"})`).join(", ") || "none"} · landed: ${m.engine.committed.map((c) => `${c.role} ${c.type}`).join(", ") || "nothing"}`}</p> : null}
    </li>
  );
}

/**
 * The main agent's session at the head (INC2-SPEC C14; DESIGN §4.6), whole: how many turns it holds
 * and their size, what of it the main agent reads now with its knowledge, the compaction summary that
 * stands in for its older turns, and every turn's messages as bubbles, each saying whose knowledge it
 * was made under, the files the main agent's tools read for it, and, where the main agent doesn't
 * read it now, that it isn't sent; then its latest compaction's rollback: Roll back while one is
 * there to roll back, then that it waits for the next agent turn, whose record carries it. Nothing
 * while it is read; a read that failed says so.
 */
export function SessionPanel(props: { session: SessionView | null | undefined; busy: boolean; onRollback(): void }) {
  const { session } = props;
  if (session === undefined) return null;
  return (
    <div class="lre-stack" data-lre-workspace-session={session === null ? "failed" : session.rollback}>
      {session === null ? (
        <p class="lre-gm-note">The engine didn't answer with the main agent's session.</p>
      ) : (
        <>
          <p class="lre-gm-note">
            {`It holds ${session.turns} turn${session.turns === 1 ? "" : "s"} whole, about ${session.tokens.toLocaleString("en-US")} tokens. `}
            {session.summary === null ? "No compaction yet: nothing of it is summarized." : "A compaction summary stands in for its older turns."}
          </p>
          <p class="lre-gm-note">{`It is all here, whoever may know it. The main agent is sent only what ${MADE_UNDER[session.reads.knowledge]} reads: ${session.reads.turns} turn${session.reads.turns === 1 ? "" : "s"}, about ${session.reads.tokens.toLocaleString("en-US")} tokens${session.summary !== null ? (session.reads.summary ? ", with the summary" : ", without the summary") : ""}.`}</p>
          {session.missing > 0 ? <p class="lre-gm-note">{`${session.missing} of its parts are no longer stored, so what they held is missing here.`}</p> : null}
          {session.summary !== null ? (
            <Disclosure summary="The summary">
              <p class="lre-gm-note">{`Made under ${MADE_UNDER[session.summaryKnowledge]}.${session.reads.summary ? "" : " Not sent to the main agent now."}`}</p>
              <p class="lre-gm-note lre-workspace-summary">{session.summary}</p>
            </Disclosure>
          ) : null}
          {session.segments.map((s, i) => (
            <section key={i} class="lre-ws-turn" data-lre-workspace-segment={s.turn ?? "kept"}>
              <h3 class="lre-ws-turn-head">{s.turn === null ? "A turn kept by a compaction" : `Reply ${s.turn}`}</h3>
              <ol class="lre-ws-msgs">{s.messages.map((m, j) => bubble(m, j))}</ol>
            </section>
          ))}
          {session.rollback === "available" ? (
            <>
              <p class="lre-gm-note">Roll back the latest compaction, and the main agent reads the turns its summary replaced again, from its next turn. The next agent turn's record carries it, so no earlier turn changes.</p>
              <Button icon="undo" disabled={props.busy} onClick={props.onRollback}>
                Roll back the latest compaction
              </Button>
            </>
          ) : session.rollback === "pending" ? (
            <p class="lre-gm-note">
              <Badge tone="warn">Rollback waits</Badge> The next agent turn rolls the latest compaction back and records it.
            </p>
          ) : (
            <p class="lre-gm-note">No compaction to roll back.</p>
          )}
        </>
      )}
    </div>
  );
}

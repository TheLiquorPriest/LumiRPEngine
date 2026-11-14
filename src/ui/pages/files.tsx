// Files (plan §14, §5.1, §5.2, §5.4): the agents' files level by level (shipped, yours, this character's,
// this chat's), each with its kind and whether RPH takes it, takes a nearer file of its name in its
// place, or has its name switched off; or, for a file no agent reads (what the migration put under
// `imported/`, say), that it is kept, with how it comes into force. A file opens as text. It is saved as
// yours at a level (a file of another level becomes your own file of its name there); a file of yours is
// deleted, which for one in place of a shipped default is the reset; a name is switched off and on again;
// a file of yours shows how it differs from the shipped default, and what an update changed of that
// default under it. The agents' suggestions are listed with what each would change, and accepted as
// proposed or edited, or dismissed. What RPE refuses is shown in its words.

import type { FileKind, LayerLevel, StackLeft } from "rp-harness/contract";
import { useEffect, useState } from "preact/hooks";
import type { AgentStack, DiffLine, FileSwitch, FileWritten, SuggestionAccepted, SuggestionDismissed, SuggestionList, TreeFileDiff, TreeFileEntry, TreeFileText, TreeListing, TreeSuggestionView } from "../api";
import { useApp } from "../app";
import { Badge, Banner, Button, Empty, Fold, PageHeader, Pre, Section, type Tone } from "../atoms";
import type { RpeClient } from "../client";
import { bytesWords, errorWords, LEVEL_WORDS, when } from "../words";

/** The levels of the tree, farthest first, as the listing gives them. */
const LEVELS: readonly LayerLevel[] = ["shipped", "global", "character", "chat"];
/** The levels a file is written at, with no chat open and with one. */
export type WriteLevel = Exclude<LayerLevel, "shipped">;
const WRITE_WORDS: Readonly<Record<WriteLevel, string>> = { global: "Yours, for every chat", character: "This character's", chat: "This chat's" };
const KIND_WORDS: Readonly<Record<FileKind, string>> = { yours: "guidance", notes: "agents' notes", generated: "generated" };
/** Why a part is left out of an agent's stack, in the words of RPH's contract. */
const LEFT_WORDS: Readonly<Record<StackLeft, string>> = { missing: "no file at any level", off: "switched off", empty: "nothing in it but headings and comments", broken: "its header or text does not parse", needs: "a file its needs: names is not in force" };

/** The agents the listing holds a definition of, by name (a definition is listed as `agents/<name>`). */
export function agentsOf(files: readonly TreeFileEntry[]): string[] {
  return [...new Set(files.flatMap((f) => (f.item?.startsWith("agents/") === true ? [f.item.slice("agents/".length)] : [])))].sort();
}

/** The levels a file may be written at on this page: yours alone with no chat open, and the chat's levels with one. */
export function writeLevels(chat: string | null): WriteLevel[] {
  return chat === null ? ["global"] : ["global", "character", "chat"];
}

/** The levels an accepted suggestion may be written at: it is always a chat's. */
const SUGGESTION_LEVELS: readonly WriteLevel[] = ["global", "character", "chat"];

/** Where accepting a suggestion writes it unless another level is chosen: the level its path names (a chat's own file names none), and yours for a shipped file. */
export function suggestedLevel(path: string): WriteLevel {
  if (path.startsWith("@global/") || path.startsWith("@shipped/")) return "global";
  return path.startsWith("@character/") ? "character" : "chat";
}

/**
 * The files no agent reads, by path: guidance RPH loads by no name (the listing's `item` is null), other
 * than the files RPE and RPH read by place, which are a level's config (a file at the level's root that
 * is not markdown, as every markdown file there is loaded by its name) and what sits in a skill's folder
 * beside its SKILL.md, which the skill may send an agent to.
 */
export function unreadFiles(files: readonly TreeFileEntry[]): Set<string> {
  const skills = files.flatMap((f) => (f.item?.startsWith("skills/") === true ? [f.path.slice(0, f.path.lastIndexOf("/") + 1)] : []));
  return new Set(
    files
      .filter((f) => f.kind === "yours" && f.item === null)
      .filter((f) => (f.level === "chat" ? f.path : f.path.slice(f.path.indexOf("/") + 1)).includes("/"))
      .filter((f) => !skills.some((folder) => f.path.startsWith(folder)))
      .map((f) => f.path),
  );
}

/** Whether RPH takes a file, as the listing says, in words; a file no agent reads (`unreadFiles`) is said to be kept. */
export function standingOf(entry: TreeFileEntry, unread: boolean): { words: string; tone: Tone | undefined } {
  if (unread) return { words: "kept, read by no agent", tone: undefined };
  if (entry.off) return { words: "switched off", tone: "warn" };
  if (entry.replacedBy !== null) return { words: `replaced by ${entry.replacedBy}`, tone: undefined };
  return entry.applies ? { words: "in force", tone: "pos" } : { words: "not in force", tone: undefined };
}

// ---------------------------------------------------------------- the calls

/** The Files page's calls to RPE, for the chat it shows. */
export interface FilesCalls {
  list(): Promise<TreeListing>;
  read(path: string): Promise<TreeFileText>;
  diff(path: string): Promise<TreeFileDiff>;
  save(path: string, level: WriteLevel, text: string): Promise<FileWritten>;
  remove(path: string): Promise<{ removed: string }>;
  switchName(path: string, level: FileSwitch["level"], off: boolean): Promise<FileWritten>;
  /** The open suggestions: the chat's, or every chat's with none. */
  suggestions(): Promise<SuggestionList>;
  /** Accepts a suggestion at a level: its text as proposed, or as edited when `text` is given. */
  accept(id: number, level: WriteLevel, text: string | null): Promise<SuggestionAccepted>;
  dismiss(id: number): Promise<SuggestionDismissed>;
  /** The exact stack an agent gets in the chat, and where each part comes from. */
  stack(agent: string): Promise<AgentStack>;
}

/** The calls for `chat` (null: the shipped level and yours alone). */
export function filesCalls(client: Pick<RpeClient, "call">, chat: string | null): FilesCalls {
  const query = chat === null ? {} : { chat };
  return {
    list: () => client.call("GET /api/v1/files", {}, { query }),
    read: (path) => client.call("GET /api/v1/files/*", { "*": path }, { query }),
    diff: (path) => client.call("GET /api/v1/files-diff/*", { "*": path }, { query }),
    save: (path, level, text) => client.call("PUT /api/v1/files/*", { "*": path }, { body: { level, text, ...query } }),
    remove: (path) => client.call("DELETE /api/v1/files/*", { "*": path }, { query }),
    switchName: (path, level, off) => client.call("PUT /api/v1/files-off/*", { "*": path }, { body: { level, off, ...query } }),
    suggestions: () => client.call("GET /api/v1/suggestions", {}, { query: { ...query, state: "open" } }),
    accept: (id, level, text) => client.call("POST /api/v1/suggestions/:id/accept", { id: String(id) }, { body: text === null ? { level } : { level, text } }),
    dismiss: (id) => client.call("POST /api/v1/suggestions/:id/dismiss", { id: String(id) }),
    // With no chat open RPE refuses it in its own words; the page offers it only with one.
    stack: (agent) => client.call("GET /api/v1/files-stack", {}, { query: { chat: chat ?? "", agent } }),
  };
}

// ---------------------------------------------------------------- what the page holds

/** A file opened: its text once read, or RPE's reason it gave none; what is being done with it; the text being edited and where it is to be saved; and its difference from the shipped default once asked for. */
export interface OpenFile {
  path: string;
  file: TreeFileText | null;
  problem: string | null;
  mode: "read" | "edit" | "delete";
  draft: { text: string; level: WriteLevel };
  diff: { answer: TreeFileDiff | null; problem: string | null } | null;
}

/** The open suggestions once read, or why they could not be; the one being edited before it is accepted, and the level each is to be written at where another than its own was chosen. */
export interface SuggestionsShown {
  list: TreeSuggestionView[] | null;
  problem: string | null;
  editing: { id: number; text: string } | null;
  levels: Readonly<Record<number, WriteLevel>>;
}

/** An agent's stack, as asked for: the agent, and its parts once read, or why they could not be. */
export interface StackShown {
  agent: string;
  parts: AgentStack["parts"] | null;
  problem: string | null;
}

/**
 * What the page shows: the listing once read, or why it could not be; the file open; the suggestions;
 * the agent's stack asked for; whether a change is under way, and RPE's refusal of the last one, under
 * the file open or the suggestion it was asked for.
 */
export interface FilesShown {
  files: TreeFileEntry[] | null;
  loading: boolean;
  problem: string | null;
  open: OpenFile | null;
  suggestions: SuggestionsShown;
  stack: StackShown | null;
  busy: boolean;
  refusal: { at: "file" | number; words: string } | null;
}

export const NO_FILES: FilesShown = { files: null, loading: true, problem: null, open: null, suggestions: { list: null, problem: null, editing: null, levels: {} }, stack: null, busy: false, refusal: null };

export interface FilesControl {
  open(path: string): void;
  close(): void;
  mode(mode: OpenFile["mode"]): void;
  draft(draft: OpenFile["draft"]): void;
  save(): void;
  remove(): void;
  switchName(path: string, level: FileSwitch["level"], off: boolean): void;
  diff(): void;
  /** Starts editing a suggestion's text before accepting it, from the text proposed; null stops. */
  edit(id: number | null): void;
  editText(text: string): void;
  level(id: number, level: WriteLevel): void;
  /** Accepts a suggestion: as edited, when it is the one being edited. */
  accept(id: number): void;
  dismiss(id: number): void;
  /** Reads an agent's stack, by the name of its definition. */
  stack(agent: string): void;
  /** Reads the listing and the suggestions again. */
  refresh(): void;
  stop(): void;
}

/**
 * The page's state over its calls: the listing and the open suggestions at once, and again after each
 * change RPE makes; a file each time one is opened. Only the file open now is shown: an answer for one
 * opened before it, or closed since, is let go, and so is all that comes back once `stop()` is called
 * (the page has left, or moved to another chat).
 */
export function filesControl(calls: FilesCalls, onChange: (shown: FilesShown) => void): FilesControl {
  let shown = NO_FILES;
  let alive = true;
  /** The number of the file open now: each opening and closing counts one. */
  let opening = 0;
  const show = (next: FilesShown): void => {
    if (!alive) return;
    shown = next;
    onChange(next);
  };
  /** Changes the open file, if it is still the one opened as `n`. */
  const change = (n: number, next: (now: OpenFile) => Partial<OpenFile>): void => {
    const now = shown.open;
    if (n === opening && now !== null) show({ ...shown, open: { ...now, ...next(now) } });
  };
  const shut = (): void => {
    opening += 1;
    show({ ...shown, open: null });
  };
  const refresh = (): void => {
    calls.list().then(
      (got) => show({ ...shown, files: got.files, loading: false, problem: null }),
      (error: unknown) => show({ ...shown, loading: false, problem: errorWords(error) }),
    );
    calls.suggestions().then(
      (got) => show({ ...shown, suggestions: { ...shown.suggestions, list: got.suggestions, problem: null } }),
      (error: unknown) => show({ ...shown, suggestions: { ...shown.suggestions, problem: errorWords(error) } }),
    );
  };
  const open = (path: string): void => {
    opening += 1;
    const n = opening;
    // Saving writes a file at its own level unless another is chosen, and a shipped file as yours.
    const level = shown.files?.find((f) => f.path === path)?.level ?? "shipped";
    show({ ...shown, open: { path, file: null, problem: null, mode: "read", draft: { text: "", level: level === "shipped" ? "global" : level }, diff: null }, refusal: null });
    calls.read(path).then(
      (file) => change(n, (now) => ({ file, draft: { ...now.draft, text: file.text } })),
      (error: unknown) => change(n, () => ({ problem: errorWords(error) })),
    );
  };
  /** Asks RPE for a change; once it is made, `after`, and the listing and suggestions read again. A refusal is kept in RPE's words, under what it was asked for. */
  const ask = <T,>(at: "file" | number, run: () => Promise<T>, after: (answer: T) => void): void => {
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
  refresh();
  return {
    open,
    close() {
      opening += 1;
      show({ ...shown, open: null, refusal: null });
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
        (answer) => open(answer.file?.path ?? now.path),
      );
    },
    remove() {
      const now = shown.open;
      if (now === null) return;
      ask("file", () => calls.remove(now.path), shut);
    },
    switchName(path, level, off) {
      ask(
        "file",
        () => calls.switchName(path, level, off),
        () => undefined,
      );
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
        () => calls.accept(id, shown.suggestions.levels[id] ?? suggestedLevel(s.path), text),
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
      const asking: StackShown = { agent, parts: null, problem: null };
      show({ ...shown, stack: asking });
      // Only the stack asked for last is shown.
      const answered = (stack: StackShown): void => {
        if (shown.stack === asking) show({ ...shown, stack });
      };
      calls.stack(agent).then(
        (got) => answered({ agent, parts: got.parts, problem: null }),
        (error: unknown) => answered({ agent, parts: null, problem: errorWords(error) }),
      );
    },
    refresh,
    stop() {
      alive = false;
    },
  };
}

// ---------------------------------------------------------------- the view

const MARKS: Readonly<Record<DiffLine["op"], string>> = { same: "  ", added: "+ ", removed: "- " };

/** A difference, line by line: `+` only in the second text, `-` only in the first. */
export function DiffLines(props: { lines: readonly DiffLine[] }) {
  return (
    <pre class="rpe-pre rpe-diff">
      {props.lines.map((line, i) => (
        <span key={i} class={`rpe-diff-${line.op}`} data-op={line.op}>
          {MARKS[line.op]}
          {line.text}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function DiffShown(props: { diff: NonNullable<OpenFile["diff"]> }) {
  const { answer, problem } = props.diff;
  if (problem !== null) {
    return (
      <Banner tone="neg" icon="alert" title="The difference could not be read">
        <span>{problem}</span>
      </Banner>
    );
  }
  if (answer === null) return <p class="lre-muted rpe-line">Comparing with the default…</p>;
  const changed = answer.lines.some((line) => line.op !== "same");
  return (
    <div class="lre-stack" data-diff={answer.path}>
      {answer.shipped === null ? (
        <p class="rpe-line">There is no shipped file of its name.</p>
      ) : changed ? (
        <>
          <p class="rpe-line">From the shipped {answer.shipped} to this file:</p>
          <DiffLines lines={answer.lines} />
        </>
      ) : (
        <p class="rpe-line">It is the same as the shipped {answer.shipped}.</p>
      )}
      {answer.update === null ? null : (
        <>
          <p class="rpe-line">What the update of {when(answer.update.at)} changed in the shipped default:</p>
          <DiffLines lines={answer.update.lines} />
        </>
      )}
    </div>
  );
}

export interface FilesViewProps {
  chat: string | null;
  shown: FilesShown;
  onOpen(path: string): void;
  onClose(): void;
  onMode(mode: OpenFile["mode"]): void;
  onDraft(draft: OpenFile["draft"]): void;
  onSave(): void;
  onRemove(): void;
  onSwitch(path: string, level: FileSwitch["level"], off: boolean): void;
  onDiff(): void;
  onEdit(id: number | null): void;
  onEditText(text: string): void;
  onLevel(id: number, level: WriteLevel): void;
  onAccept(id: number): void;
  onDismiss(id: number): void;
  onStack(agent: string): void;
}

/** Switching a name off or on: in the user's own config with no chat open, and in theirs or the chat's with one. */
function SwitchButtons(props: { entry: TreeFileEntry; chat: string | null; busy: boolean; onSwitch: FilesViewProps["onSwitch"] }) {
  const { entry } = props;
  const off = !entry.off;
  const verb = off ? "Switch off" : "Switch on";
  if (props.chat === null) {
    return (
      <Button small busy={props.busy} onClick={() => props.onSwitch(entry.path, "global", off)}>
        {verb}
      </Button>
    );
  }
  return (
    <>
      <Button small busy={props.busy} onClick={() => props.onSwitch(entry.path, "global", off)}>
        {`${verb} for every chat`}
      </Button>
      <Button small busy={props.busy} onClick={() => props.onSwitch(entry.path, "chat", off)}>
        {`${verb} in this chat`}
      </Button>
    </>
  );
}

/** The file open, under its row: its text, and what can be done with it; for a file no agent reads, how it comes into force. */
function OpenPanel(props: FilesViewProps & { open: OpenFile; entry: TreeFileEntry | undefined; unread: boolean }) {
  const { open, entry, shown } = props;
  const file = open.file;
  const levels = writeLevels(props.chat);
  // A shipped file is not written where it is; it is saved as yours at a level.
  const editable = entry !== undefined && (entry.editable || entry.level === "shipped");
  const switchable = entry !== undefined && entry.item !== null && (entry.off || entry.level === "shipped");
  return (
    <div class="lre-stack rpe-open" data-open={open.path}>
      {entry === undefined || entry.defaultChanged === null ? null : (
        <p class="rpe-line" data-default-changed="true">
          An update changed the shipped default on {when(entry.defaultChanged)}, after this file was last written. Your file is as you left it.
        </p>
      )}
      {props.unread ? (
        <p class="rpe-line" data-unread="true">
          To put it in force, move it to where its kind is read from at the same level, or copy from it.
        </p>
      ) : null}
      {shown.refusal === null || shown.refusal.at !== "file" ? null : (
        <Banner tone="neg" icon="alert" title="RPE did not make that change">
          <span>{shown.refusal.words}</span>
        </Banner>
      )}
      {open.problem !== null ? (
        <Banner tone="neg" icon="alert" title="The file could not be read">
          <span>{open.problem}</span>
        </Banner>
      ) : file === null ? (
        <p class="lre-muted rpe-line">Reading {open.path}…</p>
      ) : open.mode === "edit" ? (
        <div class="lre-stack">
          <label class="lre-field">
            <span class="label">{open.path}</span>
            <textarea class="lre-input rpe-editor" spellcheck={false} value={open.draft.text} onInput={(event) => props.onDraft({ ...open.draft, text: event.currentTarget.value })} />
          </label>
          <label class="lre-field">
            <span class="label">Save it as</span>
            {/* A select's starting choice is its option marked selected: Preact gives a select no defaultValue. */}
            <select class="lre-input" onChange={(event) => props.onDraft({ ...open.draft, level: levels.find((l) => l === event.currentTarget.value) ?? open.draft.level })}>
              {levels.map((level) => (
                <option key={level} value={level} selected={level === open.draft.level}>
                  {WRITE_WORDS[level]}
                </option>
              ))}
            </select>
          </label>
          <div class="lre-inline rpe-wrap">
            <Button kind="primary" busy={shown.busy} onClick={props.onSave}>
              Save
            </Button>
            <Button kind="ghost" onClick={() => props.onMode("read")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p class="rpe-meta">
            {LEVEL_WORDS[file.level]} · {KIND_WORDS[file.kind]} · {bytesWords(file.bytes)}
          </p>
          <Pre text={file.text} />
        </>
      )}
      {open.mode === "delete" && entry !== undefined ? (
        <div class="lre-inline rpe-wrap">
          <span>{entry.shipped === null ? `Delete ${entry.path}?` : `Delete ${entry.path}? It takes the place of the shipped ${entry.shipped}, so deleting it is the reset to the default.`}</span>
          <Button small kind="danger" busy={shown.busy} onClick={props.onRemove}>
            Delete it
          </Button>
          <Button small kind="ghost" onClick={() => props.onMode("read")}>
            Keep it
          </Button>
        </div>
      ) : open.mode === "read" ? (
        <div class="lre-inline rpe-wrap">
          {editable && file !== null ? (
            <Button small onClick={() => props.onMode("edit")}>
              {entry?.level === "shipped" ? "Edit as yours" : "Edit"}
            </Button>
          ) : null}
          {entry?.editable === true ? (
            <Button small kind="ghost" onClick={() => props.onMode("delete")}>
              {entry.shipped === null ? "Delete" : "Reset to the default"}
            </Button>
          ) : null}
          {switchable && entry !== undefined ? <SwitchButtons entry={entry} chat={props.chat} busy={shown.busy} onSwitch={props.onSwitch} /> : null}
          {entry !== undefined && entry.shipped !== null ? (
            <Button small kind="ghost" onClick={props.onDiff}>
              Compare with the default
            </Button>
          ) : null}
          <Button small kind="ghost" onClick={props.onClose}>
            Close
          </Button>
        </div>
      ) : null}
      {open.diff === null ? null : <DiffShown diff={open.diff} />}
    </div>
  );
}

function FileRow(props: FilesViewProps & { entry: TreeFileEntry; unread: boolean }) {
  const { entry, shown } = props;
  const standing = standingOf(entry, props.unread);
  const open = shown.open !== null && shown.open.path === entry.path ? shown.open : null;
  return (
    <li class="rpe-file" data-file={entry.path}>
      <div class="lre-inline">
        <Button small kind="ghost" current={open !== null} onClick={() => (open === null ? props.onOpen(entry.path) : props.onClose())}>
          {entry.path}
        </Button>
        <Badge>{KIND_WORDS[entry.kind]}</Badge>
        <Badge tone={standing.tone}>{standing.words}</Badge>
        {entry.defaultChanged === null ? null : <Badge tone="warn">the default changed</Badge>}
        <span class="rpe-meta">{bytesWords(entry.bytes)}</span>
      </div>
      {open === null ? null : <OpenPanel {...props} open={open} entry={entry} unread={props.unread} />}
    </li>
  );
}

/** A suggestion: its file, who filed it and when, why, and what it would change; accepted at a level as proposed or edited, or dismissed. */
function SuggestionItem(props: FilesViewProps & { suggestion: TreeSuggestionView }) {
  const { suggestion: s, shown } = props;
  const editing = shown.suggestions.editing?.id === s.id ? shown.suggestions.editing : null;
  const level = shown.suggestions.levels[s.id] ?? suggestedLevel(s.path);
  const refusal = shown.refusal !== null && shown.refusal.at === s.id ? shown.refusal.words : null;
  const filed = [`From the ${s.agent.definition} (${s.agent.id}) ${s.turn === null ? "outside a turn" : `in ${s.turn}`}`, when(s.at), props.chat === null ? `chat ${s.chat}` : null].filter((part) => part !== null).join(" · ");
  return (
    <li class="lre-stack rpe-suggestion" data-suggestion={s.id}>
      <p class="rpe-line rpe-strong">{s.path}</p>
      <p class="rpe-meta">{filed}</p>
      <p class="rpe-line">{s.reason}</p>
      {editing === null ? (
        <>
          <p class="rpe-meta">What it would change:</p>
          <DiffLines lines={s.lines} />
        </>
      ) : (
        <label class="lre-field">
          <span class="label">The text you accept</span>
          <textarea class="lre-input rpe-editor" spellcheck={false} value={editing.text} onInput={(event) => props.onEditText(event.currentTarget.value)} />
        </label>
      )}
      <label class="lre-field">
        <span class="label">Write it as</span>
        <select class="lre-input" onChange={(event) => props.onLevel(s.id, SUGGESTION_LEVELS.find((l) => l === event.currentTarget.value) ?? level)}>
          {SUGGESTION_LEVELS.map((l) => (
            <option key={l} value={l} selected={l === level}>
              {WRITE_WORDS[l]}
            </option>
          ))}
        </select>
      </label>
      {refusal === null ? null : (
        <Banner tone="neg" icon="alert" title="RPE did not make that change">
          <span>{refusal}</span>
        </Banner>
      )}
      <div class="lre-inline rpe-wrap">
        {editing === null ? (
          <>
            <Button small kind="primary" busy={shown.busy} onClick={() => props.onAccept(s.id)}>
              Accept
            </Button>
            <Button small onClick={() => props.onEdit(s.id)}>
              Edit, then accept
            </Button>
          </>
        ) : (
          <>
            <Button small kind="primary" busy={shown.busy} onClick={() => props.onAccept(s.id)}>
              Accept as edited
            </Button>
            <Button small kind="ghost" onClick={() => props.onEdit(null)}>
              Cancel
            </Button>
          </>
        )}
        <Button small kind="ghost" busy={shown.busy} onClick={() => props.onDismiss(s.id)}>
          Dismiss
        </Button>
      </div>
    </li>
  );
}

/** For an agent chosen from those the chat's view defines: every part it is given, in order, and where each comes from. */
function StackSection(props: FilesViewProps) {
  const agents = agentsOf(props.shown.files ?? []);
  const stack = props.shown.stack;
  if (props.chat === null || agents.length === 0) return null;
  return (
    <Section title="An agent's stack" id="stack">
      <label class="lre-field">
        <span class="label">Agent</span>
        <select
          class="lre-input"
          onChange={(event) => {
            const agent = event.currentTarget.value;
            if (agent !== "") props.onStack(agent);
          }}
        >
          <option value="" selected={stack === null}>
            Choose an agent
          </option>
          {agents.map((agent) => (
            <option key={agent} value={agent} selected={stack?.agent === agent}>
              {agent}
            </option>
          ))}
        </select>
      </label>
      {stack === null ? null : stack.problem !== null ? (
        <Banner tone="neg" icon="alert" title="The stack could not be read">
          <span>{stack.problem}</span>
        </Banner>
      ) : stack.parts === null ? (
        <p class="lre-muted rpe-line">Reading the stack of {stack.agent}…</p>
      ) : (
        <ol class="rpe-reports" data-stack={stack.agent}>
          {stack.parts.map((p, i) => (
            <li key={`${i}:${p.part}`} data-part={p.part}>
              <span class="rpe-strong">{p.part}</span>
              {` · ${p.path} · ${LEVEL_WORDS[p.level]} · ${p.where === "opening" ? "in the opening block" : "with the briefing"}`}
              {p.left === undefined ? null : ` · left out: ${LEFT_WORDS[p.left]}`}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function SuggestionsSection(props: FilesViewProps) {
  const { list, problem } = props.shown.suggestions;
  if (list === null && problem === null) return null;
  return (
    <Section title={list === null ? "Suggestions" : `Suggestions (${list.length})`} id="suggestions">
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The suggestions could not be read">
          <span>{problem}</span>
        </Banner>
      )}
      {list === null ? null : list.length === 0 ? (
        <p class="lre-muted rpe-line">No suggestion is open.</p>
      ) : (
        <ul class="lre-stack rpe-plain">
          {list.map((s) => (
            <SuggestionItem key={s.id} {...props} suggestion={s} />
          ))}
        </ul>
      )}
    </Section>
  );
}

export function FilesView(props: FilesViewProps) {
  const { shown } = props;
  const files = shown.files;
  const unread = unreadFiles(files ?? []);
  // A file opened that the listing no longer holds (it was just deleted, or is not listed) is still shown, apart.
  const unlisted = shown.open !== null && files !== null && !files.some((f) => f.path === shown.open?.path) ? shown.open : null;
  return (
    <div class="lre-stack rpe-page" data-page="files" data-chat={props.chat ?? undefined}>
      <PageHeader title="Files" sub={props.chat === null ? "The agents' files: shipped, and yours." : "The agents' files by level: shipped, yours, and this chat's."} />
      {shown.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The files could not be read">
          <span>{shown.problem}</span>
        </Banner>
      )}
      <SuggestionsSection {...props} />
      <StackSection {...props} />
      {unlisted === null ? null : <OpenPanel {...props} open={unlisted} entry={undefined} unread={false} />}
      {files === null ? (
        shown.loading ? (
          <p class="lre-muted rpe-line">Reading the files…</p>
        ) : null
      ) : files.length === 0 ? (
        <Empty icon="folder" title="No files">
          <span>RPE lists no file here.</span>
        </Empty>
      ) : (
        LEVELS.map((level) => {
          const at = files.filter((f) => f.level === level);
          if (at.length === 0) return null;
          return (
            <Fold key={level} open={level !== "shipped" || shown.open?.path.startsWith("@shipped/") === true} summary={`${LEVEL_WORDS[level]} (${at.length})`}>
              <ul class="lre-stack rpe-plain" data-level={level}>
                {at.map((entry) => (
                  <FileRow key={entry.path} {...props} entry={entry} unread={unread.has(entry.path)} />
                ))}
              </ul>
            </Fold>
          );
        })
      )}
    </div>
  );
}

export function FilesPage(props: { chat: string | null }) {
  const app = useApp();
  const { chat } = props;
  const [shown, setShown] = useState<FilesShown>(NO_FILES);
  const [control, setControl] = useState<FilesControl | null>(null);
  useEffect(() => {
    setShown(NO_FILES);
    const made = filesControl(filesCalls(app.client, chat), setShown);
    setControl(made);
    return () => made.stop();
  }, [chat]);
  return (
    <FilesView
      chat={chat}
      shown={shown}
      onOpen={(path) => control?.open(path)}
      onClose={() => control?.close()}
      onMode={(mode) => control?.mode(mode)}
      onDraft={(draft) => control?.draft(draft)}
      onSave={() => control?.save()}
      onRemove={() => control?.remove()}
      onSwitch={(path, level, off) => control?.switchName(path, level, off)}
      onDiff={() => control?.diff()}
      onEdit={(id) => control?.edit(id)}
      onEditText={(text) => control?.editText(text)}
      onLevel={(id, level) => control?.level(id, level)}
      onAccept={(id) => control?.accept(id)}
      onDismiss={(id) => control?.dismiss(id)}
      onStack={(agent) => control?.stack(agent)}
    />
  );
}

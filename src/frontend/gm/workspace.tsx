// GM → Workspace (DESIGN §4.4; AGENT-LOOP-PLAN §9; INC1-SPEC R6b, contract C8): the notes the agents
// keep for this chat at its head, and its learned area, behind the GM gate. The list
// (`lre.workspace {op: "list"}`, asked again whenever the GM view reloads) shows each file's path,
// who wrote it and at which reply, its size, whether it is pinned, and whether it is a learned file.
// A file's page reads its text (`{op: "read"}`) into a draft; Save sends it (`{op: "write"}`), Pin or
// Unpin sets whether it goes with every agent turn once agent turns come (`{op: "pin"}`), Who may read
// it sets whose knowledge reads it (`{op: "readers"}`: GM only, everyone's with secrets marked, or
// your character's; a file you write is GM only until you choose), Move gives it a new path
// (`{op: "move"}`, the page following it) and Delete removes it (`{op: "delete"}`). Each change is one
// GM edit with its Undo chip, held while a reply is written: GmPanel says it (`changed`) with its
// Undo, as after an edit; a learned file's changes land at once, with none. Workspace content never
// goes to Play or the drawer's activity line.

import { useEffect, useState } from "preact/hooks";
import { AGENT_ROLES } from "../../shared/agent-settings";
import type { AgentKnowledge } from "../../shared/agent-tools";
import type { ChatId } from "../../shared/ids";
import type { ResultBodies, WorkspaceFileView } from "../../shared/protocol";
import { isLearnedPath, isWorkspacePath } from "../../shared/stores";
import { useApp } from "../app";
import { Badge, Button, Empty, Field, IdText, List, ListRow, Section, Seg, useBusy } from "../components";
import { humanize } from "../format";
import type { GmSectionProps, RequestBody } from "../registry";
import { GmPage, usePages } from "./ui";

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
  save(path: string, text: string, landed?: () => void): Promise<boolean>;
  pin(path: string, pinned: boolean, landed?: () => void): Promise<boolean>;
  readers(path: string, readers: AgentKnowledge, landed?: () => void): Promise<boolean>;
  move(from: string, to: string, landed?: () => void): Promise<boolean>;
  remove(path: string, landed?: () => void): Promise<boolean>;
}

/** Whose knowledge may read a file, as its page offers the choice: the GM's alone, everyone's (and so the GM's), or your character's (every agent's). */
export const READERS_LABELS: Readonly<Record<AgentKnowledge, string>> = { gm: "GM only", everyone: "Everyone's, secrets marked", pov: "Your character's" };

/** What each choice means, under the choice. */
export const READERS_NOTES: Readonly<Record<AgentKnowledge, string>> = {
  gm: "Only agents reading with the GM's knowledge see it.",
  everyone: "Agents reading with everyone's knowledge see it too, as the GM's do; agents reading as your character don't.",
  pov: "Every agent sees it, those reading as your character too: keep anything your character doesn't know out of it.",
};

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
    save: (path, text, landed) => change({ type: "lre.workspace", op: "write", chatId, path, text }, `Saved ${path}`, landed),
    pin: (path, pinned, landed) => change({ type: "lre.workspace", op: "pin", chatId, path, pinned }, `${pinned ? "Pinned" : "Unpinned"} ${path}`, landed),
    readers: (path, readers, landed) => change({ type: "lre.workspace", op: "readers", chatId, path, readers }, `Who may read ${path}: ${READERS_LABELS[readers]}`, landed),
    move: (from, to, landed) => change({ type: "lre.workspace", op: "move", chatId, from, to }, `Moved ${from} to ${to}`, landed),
    remove: (path, landed) => change({ type: "lre.workspace", op: "delete", chatId, path }, `Deleted ${path}`, landed),
  };
}

/**
 * Who wrote a file and when: "GM assistant · reply 4", "You · before the first reply" (you, or an
 * agent by its name in Settings → Agents). A file no agent wrote is the turn's own, or, when no
 * reply holds it yet, the turn under way's.
 */
export function provenanceWords(file: WorkspaceFileView): string {
  const { role, turn } = file.provenance;
  if (role === undefined) return turn === null ? "Written by the turn under way" : `The turn's own · reply ${turn}`;
  const who = role === "gm" ? "You" : (AGENT_ROLES.find((r) => r.id === role)?.label ?? humanize(role));
  return `${who} · ${turn === null ? "before the first reply" : `reply ${turn}`}`;
}

/** A size in characters: "1 character", "4,120 characters". */
export function sizeWords(size: number): string {
  return `${size.toLocaleString("en-US")} character${size === 1 ? "" : "s"}`;
}

/** Why a file can't move to `to` yet, in words, or null when it can: a new path, a valid one, one no listed file has, and one on the same side of the learned area. */
export function moveProblem(from: string, to: string, paths: readonly string[]): string | null {
  if (to === from) return "Type the path to move it to.";
  if (!isWorkspacePath(to)) return "A path is names joined by /: letters, digits, dots, dashes, underscores and single spaces, no name empty, . or .., such as notes/marcus.md.";
  if (paths.includes(to)) return `There is already a file at ${to}.`;
  if (isLearnedPath(from) !== isLearnedPath(to)) return "A file under learned/ stays there, and the others stay out of it: write the file at its new path, then delete this one.";
  return null;
}

// ---------------------------------------------------------------- the tab

export function WorkspaceSection(props: GmSectionProps) {
  const app = useApp();
  const pages = usePages<string>();
  const [working, run] = useBusy();
  const [files, setFiles] = useState<WorkspaceFileView[] | null>(null);
  // The text read for the page's file (null: no such file), and the draft and move path over it.
  const [opened, setOpened] = useState<{ path: string; text: string | null } | null>(null);
  const [draft, setDraft] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const controls = workspaceControls(props.chatId, (body) => app.request<"lre.workspace">(body), { files: setFiles, changed: props.changed });
  // Read again whenever the GM view reloads: an Undo, a turn or a swipe may have changed the files.
  useEffect(() => {
    let live = true;
    void controls.list().then((listed) => {
      if (live && listed !== null) setFiles(listed);
    });
    return () => {
      live = false;
    };
  }, [props.chatId, props.gm]);
  const page = pages.page;
  const selected = page === null || files === null ? undefined : files.find((f) => f.path === page);
  // A file no longer listed (an Undo took back its write, a swipe went back before it) gives way to the list.
  useEffect(() => {
    if (page !== null && files !== null && selected === undefined) pages.back();
  });
  // The page's text: read on open, and again when the GM view reloads unless the draft holds changes not saved.
  useEffect(() => {
    if (page === null) {
      setOpened(null);
      return;
    }
    // The same file read again: what the page holds now, kept when the draft has changes not saved.
    const held = opened !== null && opened.path === page ? opened : null;
    if (held !== null && held.text !== null && draft !== held.text) return;
    let live = true;
    void controls.read(page).then((text) => {
      if (!live) return;
      if (text === undefined) {
        if (held === null) pages.back();
        return;
      }
      setOpened({ path: page, text });
      // Typing since the read was asked for wins over it.
      setDraft((now) => (held !== null && now !== (held.text ?? "") ? now : (text ?? "")));
    });
    return () => {
      live = false;
    };
  }, [page, props.chatId, props.gm]);
  const open = (path: string) => {
    setMoveTo(path);
    pages.open(path);
  };
  return (
    <div ref={pages.host.ref} class="lre-gm-pages" onKeyDown={pages.host.onKeyDown} data-lre-gm-section="workspace">
      <div class="lre-stack lre-gm-list" hidden={selected !== undefined}>
        <WorkspaceList files={files} onOpen={open} />
      </div>
      {selected ? (
        <WorkspaceFilePage
          file={selected}
          text={opened !== null && opened.path === selected.path ? opened.text : undefined}
          draft={draft}
          moveTo={moveTo}
          paths={(files ?? []).map((f) => f.path)}
          busy={props.busy || working}
          controls={controls}
          run={run}
          onDraft={setDraft}
          onMoveTo={setMoveTo}
          onSaved={(text) => setOpened({ path: selected.path, text })}
          onMoved={(to) => {
            setOpened((o) => (o === null ? null : { path: to, text: o.text }));
            setMoveTo(to);
            pages.open(to);
          }}
          onBack={pages.back}
        />
      ) : null}
    </div>
  );
}

/** The list: what the workspace is, then its files in path order, each with who wrote it and when, who may read it, its size and badges for a pin and a learned file; empty, what it will hold. */
export function WorkspaceList(props: { files: readonly WorkspaceFileView[] | null; onOpen(path: string): void }) {
  const files = props.files === null ? null : [...props.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const pinned = files?.filter((f) => f.pinned).length ?? 0;
  return (
    <div class="lre-stack" data-lre-gm-list="workspace">
      {files === null ? (
        <p class="lre-gm-note">Reading the workspace…</p>
      ) : files.length === 0 ? (
        <Empty icon="box" title="Nothing in the workspace yet">
          The workspace holds the notes the agents keep for this chat as the story goes: what they've worked out, what they plan, drafts for you to look over. The notes follow the story: swipe back past a reply and what it wrote goes with it. Notes under learned/ are kept apart from the story: a swipe never changes them, and a Branch takes them along.
        </Empty>
      ) : (
        <>
          <p class="lre-gm-note">The notes the agents keep for this chat, and yours. They follow the story: swipe back past a reply and what it wrote goes with it, except the learned notes (learned/), which a swipe never changes. An agent reads a note only when its knowledge may: one it wrote, with the knowledge it wrote it under; one of yours, as you choose on its page (GM only until you do). A pinned note goes with every agent turn, once agent turns come; the agents read the rest when they need them. Each change you make here has its own Undo, except to a learned note, which changes at once.</p>
          <Section title={`${files.length} file${files.length === 1 ? "" : "s"}${pinned > 0 ? ` · ${pinned} pinned` : ""}`} flush>
            <List>
              {files.map((f) => (
                <ListRow
                  key={f.path}
                  id={f.provenance.key}
                  title={f.path}
                  subtitle={`${provenanceWords(f)} · ${READERS_LABELS[f.readers]}`}
                  value={sizeWords(f.size)}
                  badge={f.pinned || f.learned ? <Badge tone={f.pinned ? "accent" : undefined}>{[f.learned ? "Learned" : null, f.pinned ? "Pinned" : null].filter((w) => w !== null).join(" · ")}</Badge> : undefined}
                  chevron
                  onClick={() => props.onOpen(f.path)}
                />
              ))}
            </List>
          </Section>
        </>
      )}
    </div>
  );
}

/** What a file's page shows and what its controls do; the tab's wrapper keeps the state. */
export interface WorkspaceFilePageProps {
  file: WorkspaceFileView;
  /** The text read: undefined while it is read, null when the file is gone. */
  text: string | null | undefined;
  draft: string;
  moveTo: string;
  /** Every listed path, which Move can't take. */
  paths: readonly string[];
  busy: boolean;
  controls: WorkspaceControls;
  /** Runs a request with the busy flag (`useBusy`). */
  run(action: () => Promise<unknown>): void;
  onDraft(text: string): void;
  onMoveTo(path: string): void;
  /** Its draft saved: the text read is now `text`. */
  onSaved(text: string): void;
  /** Moved: the page follows it to `to`. */
  onMoved(to: string): void;
  onBack(): void;
}

const TEXT_ID = "lre-workspace-text";
const MOVE_ID = "lre-workspace-move";

/** A file's page: its text to edit and Save, Pin or Unpin, who may read it, Move to a new path, and Delete; a learned file says it is kept apart from the story. */
export function WorkspaceFilePage(props: WorkspaceFilePageProps) {
  const { file, text, draft, busy } = props;
  const dirty = typeof text === "string" && draft !== text;
  const problem = moveProblem(file.path, props.moveTo, props.paths);
  return (
    <GmPage
      name="workspace-file"
      title={file.path}
      subtitle={
        <>
          {provenanceWords(file)} · {sizeWords(file.size)}
          {file.learned ? " · learned: a swipe never changes it, and a change lands at once, with no Undo" : ""}
          {file.provenance.key !== undefined ? <IdText id={file.provenance.key} /> : null}
        </>
      }
      backLabel="Workspace"
      onBack={props.onBack}
      actions={file.pinned ? <Badge tone="accent">Pinned</Badge> : undefined}
    >
      <div class="lre-stack" data-lre-workspace-file={file.path}>
        {text === null ? (
          <Empty icon="box">This file is gone: an Undo, a swipe or another change took it away.</Empty>
        ) : (
          <>
            <Section>
              {text === undefined ? (
                <p class="lre-gm-note">Reading it…</p>
              ) : (
                <div class="lre-stack">
                  <Field label="Text" for={TEXT_ID} help={`${sizeWords(draft.length)}${dirty ? " · not saved" : ""}`}>
                    <textarea id={TEXT_ID} class="lre-input lre-workspace-text" rows={14} value={draft} onInput={(event) => props.onDraft(event.currentTarget.value)} />
                  </Field>
                  <Button variant="primary" icon="check" block disabled={busy || !dirty} onClick={() => props.run(() => props.controls.save(file.path, draft, () => props.onSaved(draft)))}>
                    Save
                  </Button>
                </div>
              )}
            </Section>
            <Section title="Pin">
              <div class="lre-stack">
                <p class="lre-gm-note">{file.pinned ? "Pinned: it goes with every agent turn, once agent turns come." : "Pin it to send it with every agent turn, once agent turns come; unpinned, the agents read it when they need it."}</p>
                <Button icon="pin" disabled={busy} onClick={() => props.run(() => props.controls.pin(file.path, !file.pinned))}>
                  {file.pinned ? "Unpin" : "Pin"}
                </Button>
              </div>
            </Section>
            <Section title="Who may read it">
              <div class="lre-stack">
                <Seg<AgentKnowledge> label="Who may read it" value={file.readers} options={(["gm", "everyone", "pov"] as const).map((k) => ({ value: k, label: READERS_LABELS[k] }))} disabled={busy} onChange={(readers) => props.run(() => props.controls.readers(file.path, readers))} />
                <p class="lre-gm-note">{READERS_NOTES[file.readers]} A file an agent writes is read with the knowledge it wrote it under.</p>
              </div>
            </Section>
            <Section title="Move">
              <Field label="New path" for={MOVE_ID} help="Where it goes, such as notes/marcus.md: names joined by /." error={props.moveTo === file.path ? null : problem}>
                <div class="lre-workspace-move">
                  <input id={MOVE_ID} class="lre-input" autoComplete="off" spellcheck={false} value={props.moveTo} onInput={(event) => props.onMoveTo(event.currentTarget.value)} />
                  <Button icon="route" disabled={busy || problem !== null} onClick={() => props.run(() => props.controls.move(file.path, props.moveTo, () => props.onMoved(props.moveTo)))}>
                    Move
                  </Button>
                </div>
              </Field>
            </Section>
            <Section title="Delete">
              <div class="lre-stack">
                <p class="lre-gm-note">{file.learned ? "Removes the file from this chat's learned notes, at once: it has no Undo." : "Removes the file from this chat's workspace. The change's Undo brings it back."}</p>
                <Button variant="danger" icon="trash" disabled={busy} onClick={() => props.run(() => props.controls.remove(file.path, props.onBack))}>
                  Delete
                </Button>
              </div>
            </Section>
          </>
        )}
      </div>
    </GmPage>
  );
}

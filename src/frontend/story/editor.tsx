// One file of the chat's workspace, read and edited on a story page: a file of someone's mind
// (Harness → Cast) or a page of the author's notebook (Harness → Notebook). Its text in a box; Save
// (Ctrl+S or ⌘S too) writes it on the version it was read at, Revert takes the text back. A file
// written elsewhere since it was read is read again, what was typed staying in the box, and the
// page says so: Save again puts the typed text in place of the new one. A file not written yet opens
// empty, and Save writes it. The page over it asks before leaving typed text unsaved (`dirty`).

import { useEffect, useRef, useState } from "preact/hooks";
import { Button, Empty, useBusy } from "../components";
import type { StoryFile, StoryFiles } from "./files";

/** What a save's answer leaves the editor saying. */
export function savedWords(out: { file: StoryFile } | { failed: string; code: string }): string {
  if (!("failed" in out)) return "Saved.";
  return out.code === "conflict" ? "This file was written elsewhere since you opened it, and is read again. Your text is still in the box: Save again to put it in place of the new one, or Revert to take the new one." : out.failed;
}

export function FileEditor(props: { files: StoryFiles; chatId: string; path: string; label: string; note?: string; dirty(dirty: boolean): void; onSaved(file: StoryFile): void }) {
  const { files, chatId, path } = props;
  const [read, setRead] = useState<{ text: string; version: string | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, run] = useBusy();
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const load = async (keepDraft: boolean) => {
    const got = await files.read(chatId, path);
    if (!live.current) return;
    if ("failed" in got && got.code !== "missing") {
      setFailed(got.failed);
      return;
    }
    const now = "failed" in got ? { text: "", version: null } : got;
    setFailed(null);
    setRead(now);
    if (!keepDraft) setDraft(now.text);
  };
  useEffect(() => {
    setRead(null);
    setNotice(null);
    void load(false);
  }, [chatId, path]);
  const changed = read !== null && draft !== read.text;
  useEffect(() => props.dirty(changed), [changed]);
  const save = () =>
    run(async () => {
      if (!read) return;
      const out = await files.write(chatId, path, draft, read.version);
      if (!live.current) return;
      setNotice(savedWords(out));
      if ("failed" in out) {
        if (out.code === "conflict") await load(true);
        return;
      }
      setRead({ text: draft, version: out.file.version });
      props.onSaved(out.file);
    });
  if (failed !== null) {
    return (
      <Empty
        icon="alert"
        action={
          <Button icon="refresh" onClick={() => void load(false)}>
            Try again
          </Button>
        }
      >
        {failed}
      </Empty>
    );
  }
  if (read === null) return <Empty icon="hourglass">Reading the file…</Empty>;
  return (
    <div class="lre-story-editor" data-lre-story-file={path}>
      {props.note !== undefined ? <p class="lre-story-note">{props.note}</p> : null}
      {read.version === null ? <p class="lre-story-note">Not written yet. What you write here is saved as this file.</p> : null}
      <textarea
        class="lre-input lre-story-text"
        rows={14}
        aria-label={props.label}
        value={draft}
        disabled={busy}
        onInput={(event) => {
          setDraft(event.currentTarget.value);
          setNotice(null);
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            if (changed) save();
          }
        }}
      />
      {notice !== null ? (
        <p class="lre-story-notice" role="status">
          {notice}
        </p>
      ) : null}
      <div class="lre-story-actions">
        <Button variant="primary" icon="check" disabled={!changed} busy={busy} onClick={save}>
          Save
        </Button>
        <Button
          icon="undo"
          disabled={!changed || busy}
          onClick={() => {
            setDraft(read.text);
            setNotice(null);
          }}
        >
          Revert
        </Button>
      </div>
    </div>
  );
}

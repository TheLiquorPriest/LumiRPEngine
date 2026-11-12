// Harness → Notebook (DEPTH2-PLAN §1.6, §4): the author's own understanding of the story, written by
// reflecting: its pages under `author/` in the chat's workspace (the index, which the author reads
// every turn, then threads, open questions, setups, arcs, the player, futures, the scene, and the
// prepared start's plan where there is one), each to read and edit, and when the author last
// reflected. Read through the workspace when the page opens and after each save.

import { useEffect, useRef, useState } from "preact/hooks";
import { AUTHOR_FILE } from "../../shared/harness-texts";
import { useApp } from "../app";
import { Button, Empty, List, ListRow, Section } from "../components";
import { GmPage, usePages } from "../gm/ui";
import { FileEditor } from "./editor";
import { fileTitle, lastReflected, notebookFiles, type StoryFile, type StoryFiles, writerWords } from "./files";
import { agentWords, agoText } from "./model";

export function NotebookPage(props: { chatId: string; files: StoryFiles }) {
  const app = useApp();
  const [files, setFiles] = useState<StoryFile[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const pages = usePages<string>();
  const dirty = useRef(false);
  const read = async () => {
    const listed = await props.files.list(props.chatId, "author/");
    if ("failed" in listed) setFailed(listed.failed);
    else {
      setFailed(null);
      setFiles(notebookFiles(listed));
    }
  };
  useEffect(() => {
    setFiles(null);
    void read();
  }, [props.chatId]);
  const leave = async () => {
    if (dirty.current && !(await app.host.confirm("Leave without saving?", "What you typed in this page isn't saved.", "warning", "Leave"))) return;
    dirty.current = false;
    pages.back();
  };
  if (failed !== null) {
    return (
      <Empty
        icon="alert"
        action={
          <Button icon="refresh" onClick={() => void read()}>
            Try again
          </Button>
        }
      >
        {failed}
      </Empty>
    );
  }
  if (files === null) return <Empty icon="hourglass">Reading the notebook…</Empty>;
  const open = pages.page;
  return (
    <div ref={pages.host.ref} class="lre-gm-pages lre-story-page" data-lre-story-page="notebook" onKeyDown={pages.host.onKeyDown}>
      <div class="lre-stack lre-gm-list" hidden={open !== null}>
        <NotebookList files={files} onOpen={(path) => pages.open(path)} />
      </div>
      {open !== null ? (
        <GmPage name="notebook-file" title={fileTitle(open, "author/")} subtitle="The author's notebook" backLabel="Notebook" onBack={() => void leave()}>
          <FileEditor files={props.files} chatId={props.chatId} path={open} label={`The author's notebook: ${fileTitle(open, "author/")}`} note={open === AUTHOR_FILE.notebook ? "The author reads this page at the start of every turn. What you write here, it reads too." : undefined} dirty={(d) => (dirty.current = d)} onSaved={() => void read()} />
        </GmPage>
      ) : null}
    </div>
  );
}

/** The notebook's pages and when the author last reflected, without hooks. */
export function NotebookList(props: { files: readonly StoryFile[]; now?: number; onOpen(path: string): void }) {
  const reflected = lastReflected(props.files);
  return (
    <>
      <p class="lre-story-lead">The author's own notes on the story, written as it reflects on each turn. You can read them and write in them.</p>
      <p class="lre-story-note" data-lre-reflected>
        {reflected === null ? "The author hasn't reflected yet." : `The author last reflected ${agoText(reflected, props.now)}.`}
      </p>
      {props.files.length === 0 ? (
        <Empty icon="book" title="The notebook is empty">
          The author writes its notebook as the story goes, reflecting after each turn on its threads, open questions, setups and arcs. Its pages show here once it does.
        </Empty>
      ) : (
        <Section title="Pages" flush>
          <List>
            {props.files.map((f) => (
              <ListRow key={f.path} row={f.path} icon={f.path === AUTHOR_FILE.notebook ? "pin" : "file"} title={fileTitle(f.path, "author/")} subtitle={`${f.chars.toLocaleString("en-US")} characters · written ${agoText(f.at, props.now)} by ${writerWords(f, (agent) => agentWords(agent, null, {}))}`} chevron onClick={() => props.onOpen(f.path)} />
            ))}
          </List>
        </Section>
      )}
    </>
  );
}

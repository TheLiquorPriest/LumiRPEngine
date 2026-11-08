// GM → Depth → Notebook (DEPTH-PLAN §4.5, §6.4, §7): the author's own notebook for this chat, whole:
// its files (the player's intent, each character's arc, threads, setups, the tone, whatever it
// keeps), each revision with the reasoning that produced it and what it changed, every poll with
// what it considered and whether it raised it, the jobs it asked for and the author's thinking, and
// the predictions it made with how they scored. Yours to read and to edit: an edit is a directive the
// author is told of, and the text you wrote is pinned. The body is hook-free; `NotebookView` holds
// the request.

import { useEffect, useState } from "preact/hooks";
import { DEPTH_POLL_JOB_LABEL, DEPTH_REVISION_LABEL, type DepthNotebookView, type DepthPoll } from "../../shared/depth-views";
import { useApp } from "../app";
import { Badge, Button, Disclosure, Empty, Field, List, ListRow, Seg, TextDiff, useBusy } from "../components";
import { ActionRow, ActionRows, GmCard, GmPage } from "../gm/ui";
import { markdown } from "../markdown";
import type { GmSectionProps } from "../registry";

export type NotebookTab = "files" | "revisions" | "poll" | "predictions";

const TAB_LABEL: Readonly<Record<NotebookTab, string>> = { files: "Files", revisions: "Revisions", poll: "Poll", predictions: "Predictions" };

const OUTCOME: Readonly<Record<DepthNotebookView["predictions"][number]["outcome"], { label: string; tone: "pos" | "neg" | "warn" | "neutral" }>> = {
  pending: { label: "Open", tone: "neutral" },
  hit: { label: "Came true", tone: "pos" },
  miss: { label: "Missed", tone: "neg" },
  partly: { label: "Partly", tone: "warn" },
};

/** A notebook file's name as the view says it: "notebook/arcs/mira.md" → "Arcs › Mira". */
export function notebookFileLabel(path: string): string {
  const parts = path.replace(/^notebook\//, "").replace(/\.md$/, "").split("/");
  return parts.map((p) => p.replace(/[-_]+/g, " ").replace(/^\w/, (ch) => ch.toUpperCase())).join(" › ");
}

/** A file being edited. */
export interface NotebookDraft {
  path: string;
  text: string;
}

/** What the notebook's controls do. */
export interface NotebookControls {
  busy: boolean;
  tab: NotebookTab;
  onTab(tab: NotebookTab): void;
  /** The file open as a page; null for the list. */
  open: string | null;
  onOpen(path: string | null): void;
  draft: NotebookDraft | null;
  onDraft(draft: NotebookDraft | null): void;
  onSave(draft: NotebookDraft): void;
}

function Revisions(props: { revisions: DepthNotebookView["revisions"]; named?: boolean }) {
  if (props.revisions.length === 0) return <Empty icon="edit">No revision yet.</Empty>;
  return (
    <div class="lre-stack" data-lre-depth-revisions>
      {props.revisions.map((r) => (
        <div key={r.id} data-lre-depth-revision={r.id}>
          <GmCard title={props.named ? `${notebookFileLabel(r.path)} · ${DEPTH_REVISION_LABEL[r.kind]}` : DEPTH_REVISION_LABEL[r.kind]} subtitle={r.at} badges={r.kind === "user" ? <Badge tone="accent">Yours</Badge> : undefined}>
            <Disclosure summary="Why it was revised">
              <p class="lre-depth-reasoning">{r.reasoning.trim() === "" ? "No reasoning was given." : r.reasoning}</p>
            </Disclosure>
            <TextDiff before={r.before} after={r.after} named={{ before: "the file before", after: "this revision" }} />
          </GmCard>
        </div>
      ))}
    </div>
  );
}

/** One notebook file as a page: its text, Edit, and its own revisions. */
function NotebookFilePage(props: { view: DepthNotebookView; path: string; c: NotebookControls }) {
  const { c } = props;
  const file = props.view.files.find((f) => f.path === props.path);
  const label = notebookFileLabel(props.path);
  const editing = c.draft?.path === props.path ? c.draft : null;
  return (
    <GmPage name="depth-notebook-file" title={label} subtitle={file ? `${file.revisions} ${file.revisions === 1 ? "revision" : "revisions"}` : undefined} backLabel="Notebook" onBack={() => c.onOpen(null)}>
      {!file ? (
        <Empty icon="file">This file is gone from the notebook.</Empty>
      ) : (
        <div class="lre-stack" data-lre-depth-notebook-file={file.path}>
          {file.pinned ? <Badge tone="accent">Your words, pinned</Badge> : null}
          {editing ? (
            <div class="lre-stack">
              <Field label={`Edit ${label}`}>
                <textarea class="lre-input lre-depth-editor" rows={12} value={editing.text} disabled={c.busy} aria-label={`${label}: text`} onInput={(event) => c.onDraft({ path: file.path, text: event.currentTarget.value })} />
              </Field>
              <p class="lre-small lre-muted lre-depth-note">Your edit is a directive: the author is told what changed, and your words stay. A re-read may comment on them but never rewrites them.</p>
              <div class="lre-inline">
                <Button variant="primary" icon="check" busy={c.busy} disabled={editing.text === file.text} onClick={() => c.onSave(editing)}>
                  Save
                </Button>
                <Button variant="ghost" disabled={c.busy} onClick={() => c.onDraft(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              {file.text.trim() === "" ? <p class="lre-small lre-muted">Empty.</p> : markdown(file.text, "lre-depth-md")}
              <div class="lre-inline">
                <Button size="sm" icon="edit" disabled={c.busy} onClick={() => c.onDraft({ path: file.path, text: file.text })}>
                  Edit
                </Button>
              </div>
            </>
          )}
          <h4 class="lre-depth-subhead">Revisions</h4>
          <Revisions revisions={props.view.revisions.filter((r) => r.path === file.path)} />
        </div>
      )}
    </GmPage>
  );
}

/** One poll: its account, the jobs it asked for, what it considered and whether it raised it, and the author's thinking. */
function PollCard(props: { poll: DepthPoll }) {
  const { poll } = props;
  return (
    <div data-lre-depth-poll-at={poll.at}>
      <GmCard title={`The poll ${poll.at}`} subtitle={`${poll.jobs.length} ${poll.jobs.length === 1 ? "job" : "jobs"} · ${poll.considered.length} considered`}>
        {poll.note !== "" ? <p class="lre-small">{poll.note}</p> : null}
        {poll.jobs.length > 0 ? (
          <ActionRows label="The jobs it asked for">
            {poll.jobs.map((j, k) => (
              <ActionRow key={k} title={j.subject} subtitle={j.why} value={<Badge tone="accent">{DEPTH_POLL_JOB_LABEL[j.kind]}</Badge>} />
            ))}
          </ActionRows>
        ) : (
          <p class="lre-small lre-muted">It asked for no job.</p>
        )}
        {poll.considered.length > 0 ? (
          <ActionRows label="What it considered">
            {poll.considered.map((x, k) => (
              <ActionRow key={k} title={x.what} subtitle={x.why} value={<Badge tone={x.raised ? "accent" : "neutral"}>{x.raised ? "Raised" : "Not raised"}</Badge>} />
            ))}
          </ActionRows>
        ) : null}
        <Disclosure summary="The author's thinking">
          <p class="lre-depth-reasoning">{poll.reasoning.trim() === "" ? "No thinking was kept." : poll.reasoning}</p>
        </Disclosure>
      </GmCard>
    </div>
  );
}

/** GM → Depth → Notebook's body, hook-free. */
export function NotebookBody(props: { view: DepthNotebookView; c: NotebookControls }) {
  const { view, c } = props;
  if (c.open !== null) return <NotebookFilePage view={view} path={c.open} c={c} />;
  if (!view.on && view.files.length === 0) {
    return (
      <Empty icon="layers" title="This chat doesn't run on depth">
        Opt in at GM → This chat → Depth: the author starts its notebook with the bootstrap, or with the first scene.
      </Empty>
    );
  }
  return (
    <div class="lre-stack lre-depth-notebook" data-lre-depth-notebook>
      <p class="lre-small lre-muted lre-depth-note">The author's own notebook: what the story means and where it points, in its words. Characters never read it; you may read and edit all of it.</p>
      <Seg<NotebookTab> label="Notebook" value={c.tab} options={(["files", "revisions", "poll", "predictions"] as const).map((t) => ({ value: t, label: TAB_LABEL[t] }))} onChange={c.onTab} />
      {c.tab === "files" ? (
        view.files.length === 0 ? (
          <Empty icon="book">The author hasn't written its notebook yet. The bootstrap builds it chapter by chapter; on a new chat, the first scenes start it.</Empty>
        ) : (
          <List>
            {view.files.map((f) => (
              <ListRow key={f.path} icon="file" title={notebookFileLabel(f.path)} subtitle={`${f.revisions} ${f.revisions === 1 ? "revision" : "revisions"}`} badge={f.pinned ? <Badge tone="accent">Pinned</Badge> : undefined} chevron onClick={() => c.onOpen(f.path)} />
            ))}
          </List>
        )
      ) : c.tab === "revisions" ? (
        <Revisions revisions={view.revisions} named />
      ) : c.tab === "poll" ? (
        view.poll.length === 0 ? (
          <Empty icon="list">The poll hasn't run yet: after each turn it decides who catches up and what it raises.</Empty>
        ) : (
          <div class="lre-stack" data-lre-depth-poll>
            {view.poll.map((p, i) => (
              <PollCard key={i} poll={p} />
            ))}
          </div>
        )
      ) : view.predictions.length === 0 ? (
        <Empty icon="star">No predictions yet.</Empty>
      ) : (
        <div data-lre-depth-predictions>
          <ActionRows label="Predictions">
            {view.predictions.map((p, i) => (
              <ActionRow key={i} title={p.text} subtitle={[p.at, p.note].filter(Boolean).join(" · ")} value={<Badge tone={OUTCOME[p.outcome].tone}>{OUTCOME[p.outcome].label}</Badge>} />
            ))}
          </ActionRows>
        </div>
      )}
    </div>
  );
}

/** GM → Depth → Notebook: the notebook read again when the chat moves on; a save is one GM edit with its Undo. */
export function NotebookView(props: { section: GmSectionProps }) {
  const { section } = props;
  const app = useApp();
  const [view, setView] = useState<DepthNotebookView | null | undefined>(undefined);
  const [tab, setTab] = useState<NotebookTab>("files");
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<NotebookDraft | null>(null);
  const [busy, run] = useBusy();
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    void app.request<"lre.depth">({ type: "lre.depth", chatId: section.chatId, op: "notebook" }).then((result) => {
      if (live) setView(result?.notebook ?? null);
    });
    return () => {
      live = false;
    };
  }, [section.chatId, section.reloadKey, nonce]);
  if (view === undefined) return <Empty icon="hourglass">Reading the notebook…</Empty>;
  if (view === null) return <Empty icon="book">The notebook couldn't be read.</Empty>;
  const c: NotebookControls = {
    busy,
    tab,
    onTab: setTab,
    open,
    onOpen: (path) => {
      setOpen(path);
      setDraft(null);
    },
    draft,
    onDraft: setDraft,
    onSave: (d) =>
      run(async () => {
        const result = await app.request<"lre.depth">({ type: "lre.depth", chatId: section.chatId, op: "notebook_edit", path: d.path, text: d.text });
        if (!result) return;
        setDraft(null);
        await section.changed(`Edited the notebook's ${notebookFileLabel(d.path)}`, { pending: result.pending, undo: result.undo ?? null });
        setNonce((k) => k + 1);
      }),
  };
  return <NotebookBody view={view} c={c} />;
}

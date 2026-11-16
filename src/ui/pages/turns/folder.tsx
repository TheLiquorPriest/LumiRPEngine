// A turn's folder on the Turn page: its files as RPE lists them, each opened on demand, and a model call's request rebuilt exactly as it was sent.

import type { RequestReply, TurnReply } from "../../../shared/api";
import { Badge, Banner, Button, Pre } from "../../atoms";
import { replyOf, type RpeClient } from "../../client";
import { bytesWords, errorWords } from "../../words";
import { type FolderShown, NO_FOLDER, type OpenShown, type RequestShown } from "./types";

/** What the page does with a turn's folder once it reads it: opens a file or a model call's request, closes it, and lets everything that comes back after it go. */
export interface FolderReader {
  open(name: string): void;
  openRequest(name: string, held: string | null): void;
  close(): void;
  stop(): void;
}

/**
 * Reads a turn's folder: its list at once, a file each time one is opened, by its path below the folder,
 * and a model call's request each time one is, by the file the run names it by (the harness keeps it as
 * pointers into the turn's files, and RPE rebuilds it exactly). Only the one open now is shown: the answer
 * for one opened before it is let go, and so is all that comes back once `stop()` is called (the page has
 * left the turn, or shut the spoiler gate).
 */
export function readFolder(client: Pick<RpeClient, "call">, chat: string, turn: string, onChange: (folder: FolderShown) => void): FolderReader {
  let shown = NO_FOLDER;
  let alive = true;
  const show = (next: FolderShown): void => {
    if (!alive) return;
    shown = next;
    onChange(next);
  };
  client.call("GET /api/v1/chats/:chat/turns/:turn/files", { chat, turn }).then(replyOf).then(
    (list) => show({ ...shown, files: list.files, problem: null }),
    (error: unknown) => show({ ...shown, problem: errorWords(error) }),
  );
  const begin = (name: string, read: () => Promise<Pick<OpenShown, "text" | "request">>): void => {
    const opening: OpenShown = { name, text: null, request: null, problem: null };
    show({ ...shown, open: opening });
    const answered = (open: OpenShown): void => {
      if (shown.open === opening) show({ ...shown, open });
    };
    read().then(
      (got) => answered({ name, ...got, problem: null }),
      (error: unknown) => answered({ name, text: null, request: null, problem: errorWords(error) }),
    );
  };
  return {
    open: (name) => begin(name, async () => ({ text: replyOf(await client.call("GET /api/v1/chats/:chat/turns/:turn/files/*", { chat, turn, "*": name })).text, request: null })),
    // A continue's own turn holds its files: its requests are read under that turn.
    openRequest: (name, held) =>
      begin(name, async () => {
        const { same, messages, tools } = replyOf(await client.call("GET /api/v1/chats/:chat/turns/:turn/requests/*", { chat, turn: held ?? turn, "*": name }));
        return { text: null, request: { same, messages, tools } };
      }),
    close() {
      show({ ...shown, open: null });
    },
    stop() {
      alive = false;
    },
  };
}


/** A request rebuilt exactly as it was sent, laid out as its messages: each by its role and block, the file of the turn's folder its text comes from where it comes from one, and whether it is text of the turn's files (the prompt, the briefing, a part given by name) or was added to them: the agent's opening block, the line that introduces the prompt, a brief, and the run's own conversation (a message with no block). */
export function RequestView(props: { request: RequestShown }) {
  const { request } = props;
  if (!request.same) {
    return (
      <Banner tone="warn" icon="alert" title="This request cannot be shown as it was sent">
        <span>What the harness kept of it does not rebuild to what it sent, so none of it is shown.</span>
      </Banner>
    );
  }
  return (
    <div class="lre-stack" data-request>
      {request.messages.map((m, i) => {
        const added = m.block === undefined || m.block === "opening" || m.block === "frame" || m.block === "brief";
        return (
          <div key={i} class="lre-stack" data-block={m.block ?? ""}>
            <span class="lre-inline">
              <span class="rpe-caption">{m.role}</span>
              <Badge tone={added ? "gm" : undefined}>{added ? "added" : "the turn's files"}</Badge>
              {m.block === undefined ? <span class="rpe-meta">its own conversation</span> : <span class="rpe-meta">{m.block}</span>}
              {m.file === undefined ? null : (
                <span class="rpe-meta" data-request-file>
                  from {m.file}
                </span>
              )}
            </span>
            <Pre text={m.text} mono={false} />
          </div>
        );
      })}
      {request.tools.length === 0 ? null : (
        <p class="rpe-meta" data-tools>
          Tools declared: {request.tools.map((t) => (t.file === undefined ? t.name : `${t.name} (${t.file})`)).join(", ")}
        </p>
      )}
    </div>
  );
}

/** The file open: a model call's request laid out as its messages, any other file as its text. */
export function OpenFile(props: { open: OpenShown | null; onClose(): void }) {
  const { open } = props;
  if (open === null) return null;
  return (
    <div class="lre-stack" data-file={open.name}>
      <div class="lre-spread">
        <code class="lre-id">{open.name}</code>
        <Button small kind="ghost" onClick={props.onClose}>
          Close
        </Button>
      </div>
      {open.problem !== null ? (
        <Banner tone="neg" icon="alert" title="The file could not be read">
          <span>{open.problem}</span>
        </Banner>
      ) : open.request !== null ? (
        <RequestView request={open.request} />
      ) : open.text === null ? (
        <p class="lre-muted rpe-line">Reading the file…</p>
      ) : (
        <Pre text={open.text} />
      )}
    </div>
  );
}

/** The turn's folder as RPE lists it, each file opened here on demand: its world state, its briefing with the lore map, the prompt and the rest. */
export function Folder(props: { folder: FolderShown; onOpenFile(name: string): void; onCloseFile(): void }) {
  const { files, problem, open } = props.folder;
  const shown = (files ?? []).filter((f) => !f.folder);
  return (
    <div class="lre-stack" data-folder>
      <span class="rpe-caption">The turn's folder</span>
      {problem !== null ? (
        <Banner tone="neg" icon="alert" title="The turn's folder could not be read">
          <span>{problem}</span>
        </Banner>
      ) : files === null ? (
        <p class="lre-muted rpe-line">Reading the turn's folder…</p>
      ) : shown.length === 0 ? (
        <p class="rpe-meta">RPE lists no file in it.</p>
      ) : (
        <ul class="rpe-files">
          {shown.map((f) => (
            <li key={f.name}>
              <Button small kind="ghost" current={open?.name === f.name} onClick={() => props.onOpenFile(f.name)}>
                {f.name}
              </Button>
              <span class="rpe-meta lre-num">{bytesWords(f.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
      <OpenFile open={open} onClose={props.onCloseFile} />
    </div>
  );
}

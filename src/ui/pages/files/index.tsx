// Files (plan §14, §5): the tree of the agents' files as a real folder, level by level (shipped, yours, this
// character's, this chat's), a folder at a time and a page at a time, with a search across every level by name
// and by text; any file opens in pieces however large and says truly what RPH does with it (in force, off and
// which lists name it, replaced, held out and why, an example, a config, read by no agent). A file is saved as
// yours at a level, deleted (for one in place of a shipped default, reset), switched off and on again,
// compared with the default and with each change an update made to it; files and folders are made, renamed,
// moved and copied; the agents' suggestions are accepted, edited or dismissed; an agent's stack is read, and
// "Apply now" starts the open session's opening block afresh. At 1440 pixels the folder stands beside the open
// file; at 390, one at a time. The folder and the file open are in the page's address (`at`): a folder as
// its path ending in `/`, a file as its path.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../../app";
import { Banner, Fold, PageHeader } from "../../atoms";
import type { PageEntry } from "../../page-entry";
import { useUiSetting } from "../../ui-settings";
import { Browser } from "./browse";
import { type MakeActions, MovePanel, NewFile } from "./make";
import { type FilesControl, type FilesLimits, type FilesShown, entryOf, filesCalls, filesControl, folderOf, NO_FILES } from "./model";
import { type OpenActions, OpenPanel } from "./open";
import { unreadIn } from "./standing";
import { StackSection } from "./stack";
import { type SuggestionActions, SuggestionsSection } from "./suggestions";
import { Waiting } from "./waiting";

export type { FilesCalls, FilesShown, OpenFile } from "./model";
export { filesCalls, filesControl, NO_FILES } from "./model";

export interface FilesViewProps extends OpenActions, SuggestionActions, MakeActions {
  chat: string | null;
  shown: FilesShown;
  onFolder(path: string): void;
  onSearch(words: string): void;
  onMore(): void;
  onOpen(path: string): void;
  onStack(agent: string): void;
  onApply(): void;
  /** What stands under the open file: what waits for the server, where it holds things that run (a hook file, a tool's manifest). */
  underOpen?: ComponentChildren;
}

export function FilesView(props: FilesViewProps) {
  const { shown } = props;
  const open = shown.open;
  const entry = open === null ? undefined : entryOf(shown.browse, open.path);
  const unread = unreadIn(shown.browse.items);
  return (
    <div class="lre-stack rpe-page" data-page="files" data-chat={props.chat ?? undefined}>
      <PageHeader title="Files" sub={props.chat === null ? "The agents' files: shipped, and yours." : "The agents' files by level: shipped, yours, and this chat's."} />
      {open !== null ? null : (
        <>
          <SuggestionsSection {...props} />
          <StackSection chat={props.chat} shown={shown} onStack={props.onStack} onApply={props.onApply} />
        </>
      )}
      <div class="rpe-files-split" data-open={open === null ? "no" : "yes"}>
        <Browser browse={shown.browse} openPath={open?.path ?? null} onFolder={props.onFolder} onSearch={props.onSearch} onMore={props.onMore} onOpen={props.onOpen} />
        {open === null ? null : (
          <div class="lre-stack rpe-files-open">
            <OpenPanel {...props} open={open} entry={entry} unread={unread.has(open.path)} />
            {entry === undefined || open.mode !== "read" ? null : <MovePanel {...props} entry={entry} />}
            {props.underOpen}
          </div>
        )}
      </div>
      {open !== null ? null : (
        <Fold summary="New file or folder">
          <NewFile {...props} folder={shown.browse.folder} />
        </Fold>
      )}
    </div>
  );
}

/** The folder and the file an address names: a folder ends in `/`, a file does not; none: the chat's top. */
export function startOf(at: readonly string[] | undefined): { folder: string; file: string | null } {
  const first = at?.[0];
  if (first === undefined || first === "") return { folder: "", file: null };
  return first.endsWith("/") ? { folder: first.slice(0, -1), file: null } : { folder: folderOf(first), file: first };
}

/** The address of a folder or a file, in the form `startOf` reads. */
export function addressOf(folder: string | null, file: string | null): string[] {
  if (file !== null) return [file];
  return folder === null || folder === "" ? [] : [`${folder}/`];
}

export function FilesPage(props: { chat: string | null; at?: readonly string[] }) {
  const app = useApp();
  const { chat } = props;
  const [shown, setShown] = useState<FilesShown>(NO_FILES);
  const [control, setControl] = useState<FilesControl | null>(null);
  const entries = useUiSetting("folderEntries");
  const bytes = useUiSetting("filePieceBytes");
  // What the page reads at a time is read when it is used, so a setting changed meanwhile holds at once.
  const limits = useRef<FilesLimits>({ entries, bytes });
  limits.current = { entries, bytes };
  /** The address this page itself last set, so an address that came from elsewhere (a link) is told apart. */
  const own = useRef<string | null>(null);
  const address = (props.at ?? []).join("/");
  useEffect(() => {
    setShown(NO_FILES);
    const made = filesControl(filesCalls(app.client, chat), () => limits.current, setShown, startOf(props.at));
    setControl(made);
    return () => made.stop();
  }, [chat]);
  useEffect(() => {
    if (control === null || own.current === address) return;
    const to = startOf(props.at);
    if (to.file !== null) control.open(to.file);
    else control.folder(to.folder);
  }, [address]);
  /** Keeps the address as the page stands: the folder shown, or the file open. */
  useEffect(() => {
    const next = addressOf(shown.browse.search === "" ? shown.browse.folder : null, shown.open?.path ?? null);
    const joined = next.join("/");
    if (joined === address || shown.browse.loading) return;
    own.current = joined;
    app.go({ page: "files", chat, at: next });
  }, [shown.browse.folder, shown.browse.search, shown.browse.loading, shown.open?.path]);
  const waiting = shown.open?.file == null ? null : <Waiting path={shown.open.path} text={shown.open.file.text} />;
  return (
    <FilesView
      chat={chat}
      shown={shown}
      underOpen={waiting}
      onFolder={(path) => control?.folder(path)}
      onMakeFolder={(path) => control?.makeFolder(path)}
      onSearch={(words) => control?.search(words)}
      onMore={() => control?.more()}
      onOpen={(path) => control?.open(path)}
      onClose={() => control?.close()}
      onPiece={() => control?.piece()}
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
      onApply={() => control?.applyNow()}
      onMake={(path, level, shippedPath) => control?.make(path, level, shippedPath)}
      onMove={(from, to) => control?.move(from, to)}
      onCopy={(from, to) => control?.copy(from, to)}
    />
  );
}

export const entry: PageEntry = { id: "files", title: "Files", icon: "folder", shells: ["web", "drawer"], needsChat: false, withChat: true, often: false, order: 90, render: (route) => <FilesPage chat={route.chat ?? null} at={route.at} /> };

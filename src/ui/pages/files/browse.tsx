// The tree as a folder on the Files page: where it stands as a trail of its folders, a search across every level
// by name and by text, and the folder's entries a page at a time, each file with whether RPH takes it.

import type { TreeListed } from "../../../shared/api";
import { Badge, Banner, Button, Empty } from "../../atoms";
import { bytesWords, LEVEL_WORDS } from "../../words";
import type { BrowseShown } from "./model";
import { KIND_WORDS } from "./open";
import { standingOf, unreadIn } from "./standing";

const LEVEL_OF: Readonly<Record<string, keyof typeof LEVEL_WORDS>> = { "@shipped": "shipped", "@global": "global", "@character": "character" };

/** A folder's name as the trail says it: a level's own folder by the level's words. */
function crumbWords(segment: string): string {
  const level = LEVEL_OF[segment];
  return level === undefined ? segment : LEVEL_WORDS[level];
}

/** The folders from the top to the one shown, each a way back to it. */
function Trail(props: { folder: string; onFolder(path: string): void }) {
  const parts = props.folder === "" ? [] : props.folder.split("/");
  return (
    <nav class="lre-inline rpe-wrap" aria-label="Folders" data-trail>
      <Button small kind="ghost" current={parts.length === 0} onClick={() => props.onFolder("")}>
        This chat's top
      </Button>
      {parts.map((segment, i) => (
        <Button key={`${i}:${segment}`} small kind="ghost" current={i === parts.length - 1} onClick={() => props.onFolder(parts.slice(0, i + 1).join("/"))}>
          {crumbWords(segment)}
        </Button>
      ))}
    </nav>
  );
}

function Entry(props: { item: TreeListed; open: boolean; unread: boolean; onFolder(path: string): void; onOpen(path: string): void }) {
  const { item } = props;
  if (item.folder) {
    return (
      <li class="rpe-file" data-folder={item.path}>
        <Button small kind="ghost" onClick={() => props.onFolder(item.path)}>
          {`${item.name}/`}
        </Button>
        <Badge>{LEVEL_WORDS[item.level]}</Badge>
      </li>
    );
  }
  const entry = item.entry;
  const standing = entry === null ? null : standingOf(entry, props.unread);
  return (
    <li class="rpe-file" data-file={item.path}>
      <div class="lre-inline rpe-wrap">
        <Button small kind="ghost" current={props.open} onClick={() => props.onOpen(item.path)}>
          {item.name}
        </Button>
        {entry === null ? null : <Badge>{KIND_WORDS[entry.kind]}</Badge>}
        {standing === null ? null : <Badge tone={standing.tone}>{standing.words}</Badge>}
        {entry === null || entry.defaultChanged === null ? null : <Badge tone="warn">the default changed</Badge>}
        {entry === null ? null : <span class="rpe-meta">{bytesWords(entry.bytes)}</span>}
      </div>
    </li>
  );
}

export interface BrowserProps {
  browse: BrowseShown;
  openPath: string | null;
  onFolder(path: string): void;
  onSearch(words: string): void;
  onMore(): void;
  onOpen(path: string): void;
}

export function Browser(props: BrowserProps) {
  const { browse } = props;
  const unread = unreadIn(browse.items);
  return (
    <div class="lre-stack rpe-files-browser" data-browser>
      <form
        class="rpe-point"
        onSubmit={(event) => {
          event.preventDefault();
          const words = new FormData(event.currentTarget).get("words");
          props.onSearch(typeof words === "string" ? words.trim() : "");
        }}
      >
        <label class="lre-field">
          <span class="label">Search every level, by name and by text</span>
          <input key={browse.search} name="words" class="lre-input" defaultValue={browse.search} spellcheck={false} autoComplete="off" />
        </label>
        <button type="submit" class="lre-btn">
          Search
        </button>
      </form>
      {browse.search === "" ? (
        <Trail folder={browse.folder} onFolder={props.onFolder} />
      ) : (
        <div class="lre-inline rpe-wrap">
          <span class="rpe-meta" data-searching>{`Found by "${browse.search}"`}</span>
          <Button small kind="ghost" onClick={() => props.onSearch("")}>
            Back to the folder
          </Button>
        </div>
      )}
      {browse.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The files could not be read">
          <span>{browse.problem}</span>
        </Banner>
      )}
      {browse.stopped === null ? null : (
        <Banner tone="warn" icon="alert" title="The search ran out of time">
          <span>It did not look everywhere. Narrow the words, or search in a folder.</span>
        </Banner>
      )}
      {browse.items.length === 0 ? (
        browse.loading ? (
          <p class="lre-muted rpe-line">Reading the files…</p>
        ) : browse.problem === null ? (
          <Empty icon="folder" title={browse.search === "" ? "Nothing here" : "No file found"}>
            <span>{browse.search === "" ? "RPE lists no file in this folder." : "No file's name or text holds those words."}</span>
          </Empty>
        ) : null
      ) : (
        <ul class="lre-stack rpe-plain">
          {browse.items.map((item) => (
            <Entry key={item.path} item={item} open={props.openPath === item.path} unread={unread.has(item.path)} onFolder={props.onFolder} onOpen={props.onOpen} />
          ))}
        </ul>
      )}
      {browse.next === null ? null : (
        <Button busy={browse.loading} onClick={props.onMore}>
          More
        </Button>
      )}
    </div>
  );
}

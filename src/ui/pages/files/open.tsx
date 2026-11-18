// The file open on the Files page: its text in pieces, what RPH does with it, and what can be done with it by
// what it is: yours edited or saved at a level, a shipped file edited as yours, a file of yours deleted (which for
// one in place of a default is the reset), a name switched off and on again, and a file compared with the default
// and with every change an update made to it.

import type { DiffRow, LayerLevel, TreeFileRow } from "../../../shared/api";
import { Badge, Banner, Button, Pre } from "../../../frontend/components";
import { bytesWords, counted, LEVEL_WORDS, when } from "../../words";
import type { FilesShown, OpenFile, WriteLevel } from "./model";
import { writeLevels } from "./model";
import { PinPanel } from "./pins";
import { isPart, PartPreview } from "./preview";
import { standingOf } from "./standing";

export const WRITE_WORDS: Readonly<Record<WriteLevel, string>> = { global: "Yours, for every chat", character: "This character's", chat: "This chat's" };
export const KIND_WORDS: Readonly<Record<TreeFileRow["kind"], string>> = { yours: "guidance", notes: "agents' notes", generated: "generated" };

const MARKS: Readonly<Record<DiffRow["op"], string>> = { same: "  ", added: "+ ", removed: "- " };

/** A difference, line by line: `+` only in the second text, `-` only in the first. */
export function DiffLines(props: { lines: readonly DiffRow[] }) {
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
      {(answer.updates ?? (answer.update === null ? [] : [answer.update])).map((update) => (
        <div key={update.at} class="lre-stack" data-update={update.at}>
          <p class="rpe-line">What the update of {when(update.at)} changed in the shipped default:</p>
          <DiffLines lines={update.lines} />
        </div>
      ))}
    </div>
  );
}

/** Whose `stack.off` list a level's is, as a sentence names it. */
const OFF_LIST_WORDS: Readonly<Record<LayerLevel, string>> = { shipped: "the shipped config", global: "your own config", character: "this character's config", chat: "this chat's config" };

/** The levels whose `stack.off` list this page writes: the user's own, and the chat's with one open. */
export const switchLevels = (chat: string | null): ("global" | "chat")[] => (chat === null ? ["global"] : ["global", "chat"]);

/**
 * Switching a name off, in the user's own config with no chat open and in theirs or the chat's with one; and on again where a
 * `stack.off` list names it, and only there: at a level whose list does not name it, the route writes nothing and the name stays off.
 */
function SwitchButtons(props: { entry: TreeFileRow; chat: string | null; busy: boolean; onSwitch(path: string, level: "global" | "chat", off: boolean): void }) {
  const { entry } = props;
  const levels = entry.off ? switchLevels(props.chat).filter((level) => entry.offIn.includes(level)) : switchLevels(props.chat);
  const verb = entry.off ? "Switch on" : "Switch off";
  return (
    <>
      {levels.map((level) => (
        <Button key={level} size="sm" busy={props.busy} onClick={() => props.onSwitch(entry.path, level, !entry.off)}>
          {props.chat === null ? verb : level === "global" ? `${verb} for every chat` : `${verb} in this chat`}
        </Button>
      ))}
    </>
  );
}

/** For a name switched off: which lists name it, where more than one does or one this page does not write does, so that a Switch on that leaves it off is not a surprise. */
function OffWhere(props: { entry: TreeFileRow; chat: string | null }) {
  const { offIn } = props.entry;
  const here = switchLevels(props.chat);
  const elsewhere = offIn.filter((level) => !here.some((l) => l === level));
  if (offIn.length < 2 && elsewhere.length === 0) return null;
  const named = offIn.map((level) => OFF_LIST_WORDS[level]).join(" and ");
  return (
    <p class="rpe-meta" data-off-in={offIn.join(" ")}>
      {`The off: list of ${named} names it. It is on again once no list does${elsewhere.length === 0 ? "" : `, and this page does not change ${elsewhere.map((level) => OFF_LIST_WORDS[level]).join(" or ")}`}.`}
    </p>
  );
}

export interface OpenActions {
  onClose(): void;
  onMode(mode: OpenFile["mode"]): void;
  onDraft(draft: OpenFile["draft"]): void;
  onSave(): void;
  onRemove(): void;
  onSwitch(path: string, level: "global" | "chat", off: boolean): void;
  onPin(path: string, level: "global" | "chat", agent: string, pinned: boolean): void;
  onPinning(next: FilesShown["pinning"]): void;
  onDiff(): void;
  onPiece(): void;
}

/** The file open: its text, and what can be done with it; for a file no agent reads, how it comes into force. */
export function OpenPanel(props: OpenActions & { chat: string | null; shown: FilesShown; open: OpenFile; entry: TreeFileRow | undefined; unread: boolean }) {
  const { open, entry, shown } = props;
  const file = open.file;
  const levels = writeLevels(props.chat);
  // A shipped file is not written where it is; it is saved as yours at a level.
  const editable = entry !== undefined && (entry.editable || entry.level === "shipped");
  const switchable = entry !== undefined && entry.item !== null && (entry.off || entry.level === "shipped");
  const standing = entry === undefined ? null : standingOf(entry, props.unread);
  return (
    <div class="lre-stack rpe-open" data-open={open.path}>
      <div class="lre-spread">
        <code class="lre-id">{open.path}</code>
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          Back to the folder
        </Button>
      </div>
      {standing === null || entry === undefined ? null : (
        <p class="lre-inline rpe-wrap" data-standing>
          <Badge tone={standing.tone}>{standing.words}</Badge>
          {entry.defaultChanged === null ? null : <Badge tone="warn">the default changed</Badge>}
          {entry.joins === undefined || entry.joins.length === 0 ? null : <span class="rpe-meta">in the stack of {entry.joins.join(", ")}</span>}
        </p>
      )}
      {entry?.problems === undefined || entry.problems.length === 0 ? null : (
        <ul class="rpe-reports" data-problems>
          {entry.problems.map((problem, i) => (
            <li key={i}>{problem}</li>
          ))}
        </ul>
      )}
      {entry === undefined || entry.defaultChanged === null ? null : (
        <p class="rpe-line" data-default-changed="true">
          An update changed the shipped default on {when(entry.defaultChanged)}, after this file was last written. Your file is as you left it.
        </p>
      )}
      {entry?.defaultRemoved === undefined || entry.defaultRemoved === null ? null : (
        <p class="rpe-line" data-default-removed="true">
          An update took away the default this file stands in place of, on {when(entry.defaultRemoved)}.
        </p>
      )}
      {entry === undefined ? null : <PinPanel entry={entry} chat={props.chat} agents={shown.agents} busy={shown.busy} pinning={shown.pinning} onPin={props.onPin} onPinning={props.onPinning} />}
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
          {file.more === true ? <p class="rpe-meta">Only the part read is here: saving writes the file as the part you see, so read it whole before editing.</p> : null}
          <div class="rpe-draft" data-beside={isPart(open.path) ? "yes" : "no"}>
            <label class="lre-field">
              <span class="label">{open.path}</span>
              <textarea class="lre-input rpe-editor" spellcheck={false} value={open.draft.text} onInput={(event) => props.onDraft({ ...open.draft, text: event.currentTarget.value })} />
            </label>
            {isPart(open.path) ? <PartPreview chat={props.chat} path={open.path} text={open.draft.text} /> : null}
          </div>
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
            <Button variant="primary" busy={shown.busy} onClick={props.onSave}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => props.onMode("read")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p class="rpe-meta">
            {LEVEL_WORDS[file.level]} · {KIND_WORDS[file.kind]} · {bytesWords(file.bytes)}
            {file.lines === undefined ? "" : ` · ${counted(file.lines, "line")}`}
            {file.more === true ? ` · ${bytesWords(file.to ?? 0)} read` : ""}
          </p>
          <Pre text={file.text} />
          {file.more === true ? (
            <Button size="sm" busy={open.piece} onClick={props.onPiece}>
              Read on
            </Button>
          ) : null}
        </>
      )}
      {open.mode === "delete" && entry !== undefined ? (
        <div class="lre-inline rpe-wrap">
          <span>{entry.shipped === null ? `Delete ${entry.path}?` : `Delete ${entry.path}? It takes the place of the shipped ${entry.shipped}, so deleting it is the reset to the default.`}</span>
          <Button size="sm" variant="danger" busy={shown.busy} onClick={props.onRemove}>
            Delete it
          </Button>
          <Button size="sm" variant="ghost" onClick={() => props.onMode("read")}>
            Keep it
          </Button>
        </div>
      ) : open.mode === "read" ? (
        <div class="lre-inline rpe-wrap">
          {editable && file !== null ? (
            <Button size="sm" onClick={() => props.onMode("edit")}>
              {entry?.level === "shipped" ? "Edit as yours" : "Edit"}
            </Button>
          ) : null}
          {entry?.editable === true ? (
            <Button size="sm" variant="ghost" onClick={() => props.onMode("delete")}>
              {entry.shipped === null ? "Delete" : "Reset to the default"}
            </Button>
          ) : null}
          {switchable && entry !== undefined ? <SwitchButtons entry={entry} chat={props.chat} busy={shown.busy} onSwitch={props.onSwitch} /> : null}
          {entry !== undefined && entry.shipped !== null ? (
            <Button size="sm" variant="ghost" onClick={props.onDiff}>
              Compare with the default
            </Button>
          ) : null}
        </div>
      ) : null}
      {open.mode === "read" && switchable && entry !== undefined && entry.off ? <OffWhere entry={entry} chat={props.chat} /> : null}
      {open.diff === null ? null : <DiffShown diff={open.diff} />}
    </div>
  );
}

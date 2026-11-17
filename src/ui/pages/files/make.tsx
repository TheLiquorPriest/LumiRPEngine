// Making files on the Files page: a new file of any kind the tree draws at any level that holds it (blank, or
// from the shipped default of its name), a new folder, and renaming, moving or copying one of his own; a file
// under `imported/` offers to be moved or copied to where its kind is read from. Only the levels where a file of
// that kind has a place are offered; what RPE still refuses it says in its words.

import { useState } from "preact/hooks";
import type { TreeFileRow } from "../../../shared/api";
import { Banner, Button, Section } from "../../../frontend/components";
import { type FileKind, importedTarget, KINDS, shippedPathFor, viewPathAt } from "./kinds";
import type { FilesShown, WriteLevel } from "./model";
import { WRITE_WORDS } from "./open";

export interface MakeActions {
  onMake(path: string, level: WriteLevel, shippedPath: string | null): void;
  onMakeFolder(path: string): void;
  onMove(from: string, to: string): void;
  onCopy(from: string, to: string): void;
}

/** A refusal of RPE's, in its words, where the page made or moved something. */
function Refused(props: { shown: FilesShown }) {
  const { refusal } = props.shown;
  if (refusal === null || refusal.at !== "make") return null;
  return (
    <Banner tone="neg" icon="alert" title="RPE did not make that change">
      <span>{refusal.words}</span>
    </Banner>
  );
}

/** "New": a file of a kind at a level, or a folder in the one shown. */
export function NewFile(props: MakeActions & { chat: string | null; shown: FilesShown; folder: string }) {
  const [kind, setKind] = useState<FileKind>(KINDS[0] as FileKind);
  const [name, setName] = useState("");
  const [fixed, setFixed] = useState<string>("");
  const [level, setLevel] = useState<WriteLevel | "">("");
  const [fromShipped, setFromShipped] = useState(true);
  const [folderName, setFolderName] = useState("");
  const levels = kind.levels(props.chat);
  const at = (level !== "" && levels.includes(level) ? level : (levels[0] ?? "")) as WriteLevel | "";
  const given = kind.names === undefined ? name.trim() : fixed === "" ? (kind.names[0] ?? "") : fixed;
  const ready = at !== "" && (kind.named ? given !== "" : true);
  const below = ready ? kind.at(given) : "";
  return (
    <Section title="New" id="new">
      <form
        class="lre-stack"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label class="lre-field">
          <span class="label">What kind of file</span>
          <select
            class="lre-input"
            onChange={(event) => {
              setKind(KINDS.find((k) => k.id === event.currentTarget.value) ?? kind);
              setFixed("");
            }}
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id} selected={k.id === kind.id}>
                {k.words}
              </option>
            ))}
          </select>
        </label>
        {kind.names !== undefined ? (
          <label class="lre-field">
            <span class="label">Which</span>
            <select class="lre-input" onChange={(event) => setFixed(event.currentTarget.value)}>
              {kind.names.map((n) => (
                <option key={n} value={n} selected={n === (fixed === "" ? kind.names?.[0] : fixed)}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : kind.named ? (
          <label class="lre-field">
            <span class="label">Its name</span>
            <input class="lre-input" value={name} spellcheck={false} autoComplete="off" onInput={(event) => setName(event.currentTarget.value)} />
          </label>
        ) : null}
        {levels.length === 0 ? (
          <p class="rpe-meta">No level holds this kind with {props.chat === null ? "no chat open" : "this chat open"}.</p>
        ) : (
          <label class="lre-field">
            <span class="label">Make it as</span>
            <select class="lre-input" onChange={(event) => setLevel(levels.find((l) => l === event.currentTarget.value) ?? "")}>
              {levels.map((l) => (
                <option key={l} value={l} selected={l === at}>
                  {WRITE_WORDS[l]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label class="lre-check">
          <input type="checkbox" checked={fromShipped} onChange={(event) => setFromShipped(event.currentTarget.checked)} /> <span>Start from the shipped file of its name, where there is one</span>
        </label>
        <Button variant="primary" busy={props.shown.busy} disabled={!ready} onClick={() => at !== "" && props.onMake(viewPathAt(at, below), at, fromShipped ? shippedPathFor(below) : null)}>
          Make the file
        </Button>
      </form>
      <label class="lre-field">
        <span class="label">{props.folder === "" ? "A new folder at this chat's top" : `A new folder in ${props.folder}`}</span>
        <input class="lre-input" value={folderName} spellcheck={false} autoComplete="off" onInput={(event) => setFolderName(event.currentTarget.value)} />
      </label>
      <Button disabled={folderName.trim() === ""} busy={props.shown.busy} onClick={() => props.onMakeFolder(props.folder === "" ? folderName.trim() : `${props.folder}/${folderName.trim()}`)}>
        Make the folder
      </Button>
      <Refused shown={props.shown} />
    </Section>
  );
}

/** What can be done to one of his own files that is open: renamed or moved, copied; and where it is under `imported/`, moved or copied to where its kind is read from. */
export function MovePanel(props: MakeActions & { entry: TreeFileRow; shown: FilesShown }) {
  const { entry } = props;
  const target = importedTarget(entry.path);
  if (!entry.editable && entry.level !== "shipped") return null;
  const mine = entry.editable;
  /** The place typed in the form: what Move and Copy are given, none where it is empty or is where the file stands. */
  const typed = (form: HTMLFormElement | null): string | null => {
    const to = form === null ? null : new FormData(form).get("to");
    return typeof to === "string" && to.trim() !== "" && to.trim() !== entry.path ? to.trim() : null;
  };
  return (
    <div class="lre-stack" data-move>
      {target === null || !mine ? null : (
        <div class="lre-inline rpe-wrap" data-imported>
          <span class="rpe-meta">Kept under imported/, where no agent reads it.</span>
          <Button size="sm" onClick={() => props.onMove(entry.path, target)}>
            Move it to where its kind is read from
          </Button>
          <Button size="sm" variant="ghost" onClick={() => props.onCopy(entry.path, target)}>
            Copy it to where its kind is read from
          </Button>
        </div>
      )}
      <form
        class="lre-stack"
        onSubmit={(event) => {
          event.preventDefault();
          const to = typed(event.currentTarget);
          if (to !== null) (mine ? props.onMove : props.onCopy)(entry.path, to);
        }}
      >
        <label class="lre-field">
          <span class="label">{mine ? "Rename, move or copy to" : "Copy as yours to"}</span>
          <input key={entry.path} name="to" class="lre-input" defaultValue={entry.path} spellcheck={false} autoComplete="off" />
        </label>
        <div class="lre-inline rpe-wrap">
          {mine ? (
            <button type="submit" class="lre-btn small">
              Move it there
            </button>
          ) : null}
          <button
            type="button"
            class={mine ? "lre-btn small ghost" : "lre-btn small"}
            onClick={(event) => {
              const to = typed(event.currentTarget.form);
              if (to !== null) props.onCopy(entry.path, to);
            }}
          >
            Copy it there
          </button>
        </div>
      </form>
      <Refused shown={props.shown} />
    </div>
  );
}

// The owner's five edits of the prompt map, each from a slice's own controls: rename its marker, change its
// kind, correct its line, merge it with another slice, split it at given words. RPH makes the edit and keeps
// it with the preset for every chat on it; what it answers (the map as it stands, or why it did not) is
// shown in its words.

import { useState } from "preact/hooks";
import { useApp } from "../../app";
import { Banner, Button } from "../../atoms";
import type { PromptEditAsk, PromptShown, PromptSliceShown, SliceKind, TurnId } from "../../../shared/api";
import { errorWords } from "../../words";
import { editPrompt } from "./read";

export const KINDS: readonly SliceKind[] = ["instructions", "style", "character", "persona", "world", "note", "lore", "history", "other"];

type Panel = "rename" | "line" | "merge" | "split" | null;

/** One slice's edit controls: each opens its own small form, and what RPH answers is the page's map from then on. */
export function SliceTools(props: { chat: string; turn: TurnId | null; slice: PromptSliceShown; all: readonly PromptSliceShown[]; onEdited(shown: PromptShown): void }) {
  const app = useApp();
  const { slice } = props;
  const [panel, setPanel] = useState<Panel>(null);
  const [text, setText] = useState("");
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const send = (edit: PromptEditAsk): void => {
    setBusy(true);
    setProblem(null);
    editPrompt(app.client, props.chat, edit, props.turn ?? undefined).then(
      (shown) => {
        setBusy(false);
        setPanel(null);
        props.onEdited(shown);
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  const open = (next: Exclude<Panel, null>, start: string): void => {
    setProblem(null);
    setText(start);
    setOther("");
    setPanel((now) => (now === next ? null : next));
  };
  const others = props.all.filter((s) => s.marker !== slice.marker);
  return (
    <div class="lre-stack" data-tools={slice.marker}>
      <div class="lre-inline rpe-wrap">
        <Button small kind="ghost" current={panel === "rename"} onClick={() => open("rename", slice.marker)}>
          Rename
        </Button>
        <Button small kind="ghost" current={panel === "line"} onClick={() => open("line", slice.line ?? "")}>
          Correct its line
        </Button>
        <Button small kind="ghost" current={panel === "merge"} disabled={others.length === 0} onClick={() => open("merge", slice.marker)}>
          Merge with another
        </Button>
        <Button small kind="ghost" current={panel === "split"} onClick={() => open("split", "")}>
          Split
        </Button>
        <label class="lre-inline">
          <span class="rpe-meta">Kind</span>
          <select class="lre-input" value={slice.kind} disabled={busy} onChange={(event) => send({ edit: "kind", marker: slice.marker, to: event.currentTarget.value as SliceKind })}>
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
      </div>
      {panel === null ? null : (
        <form
          class="rpe-open lre-stack"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          {panel === "rename" ? (
            <label class="lre-field">
              <span class="label">New marker</span>
              <input class="lre-input" value={text} spellcheck={false} onInput={(event) => setText(event.currentTarget.value)} />
            </label>
          ) : null}
          {panel === "line" ? (
            <label class="lre-field">
              <span class="label">What it is, in a line</span>
              <textarea class="lre-input" rows={2} value={text} onInput={(event) => setText(event.currentTarget.value)} />
            </label>
          ) : null}
          {panel === "merge" ? (
            <>
              <label class="lre-field">
                <span class="label">Merge {slice.marker} with</span>
                <select class="lre-input" value={other} onChange={(event) => setOther(event.currentTarget.value)}>
                  <option value="">Choose a part</option>
                  {others.map((s) => (
                    <option key={s.marker} value={s.marker}>
                      {s.marker}
                    </option>
                  ))}
                </select>
              </label>
              <label class="lre-field">
                <span class="label">Marker of the merged part</span>
                <input class="lre-input" value={text} spellcheck={false} onInput={(event) => setText(event.currentTarget.value)} />
              </label>
            </>
          ) : null}
          {panel === "split" ? (
            <>
              <label class="lre-field">
                <span class="label">The second part begins with these words</span>
                <textarea class="lre-input" rows={2} value={text} onInput={(event) => setText(event.currentTarget.value)} />
              </label>
              <label class="lre-field">
                <span class="label">Marker of the second part</span>
                <input class="lre-input" value={other} spellcheck={false} onInput={(event) => setOther(event.currentTarget.value)} />
              </label>
            </>
          ) : null}
          <div class="lre-inline">
            <Button
              kind="primary"
              busy={busy}
              disabled={text.trim() === "" || (panel === "merge" && other === "") || (panel === "split" && other.trim() === "")}
              onClick={() => {
                if (panel === "rename") send({ edit: "rename", marker: slice.marker, to: text.trim() });
                else if (panel === "line") send({ edit: "line", marker: slice.marker, line: text.trim() });
                else if (panel === "merge") send({ edit: "merge", markers: [slice.marker, other], as: text.trim() });
                else if (panel === "split") send({ edit: "split", marker: slice.marker, at: text, second: other.trim() });
              }}
            >
              Keep this edit
            </Button>
            <Button kind="ghost" onClick={() => setPanel(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The map was not changed">
          <span>{problem}</span>
        </Banner>
      )}
    </div>
  );
}

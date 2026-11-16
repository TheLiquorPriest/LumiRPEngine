// A prompt part's live preview (plan §5.4, R-44, PlanPages-22): as he types, the page asks RPH to render the draft with the values of the part's last use in
// the chat, and shows it beside the draft (under it on a phone); where the draft does not parse, RPH's words say why; a field the draft names that the
// part is never given is pointed out. The wait after he stops typing is a setting. A tool's description is previewed the same way.

import { useEffect, useState } from "preact/hooks";
import { useApp } from "../../app";
import { Badge, Pre, Section } from "../../atoms";
import { useUiSetting } from "../../ui-settings";
import { callWanted, type PartPreviewReply } from "../../wanted";
import { errorWords } from "../../words";

/** Whether a path is a prompt part or a tool's description, the two things RPH renders: the part's folder is in its path. */
export function isPart(path: string): boolean {
  return /(^|\/)\.(prompts|tools)\//.test(path);
}

export function PreviewView(props: { reply: PartPreviewReply | null; problem: string | null; asking: boolean }) {
  const { reply } = props;
  return (
    <Section id="preview" title="What it renders to">
      {props.problem === null ? null : <p class="rpe-line" data-preview-problem>{props.problem}</p>}
      {reply === null ? (
        props.problem === null ? <p class="lre-muted rpe-line">{props.asking ? "Rendering it…" : "Nothing rendered yet."}</p> : null
      ) : (
        <div class="lre-stack" data-preview>
          {reply.values === null ? <p class="rpe-meta">It has not been used in this chat yet, so its fields have no values.</p> : <p class="rpe-meta">With the values it was last used with in this chat.</p>}
          {reply.problems.length === 0 ? null : (
            <ul class="rpe-reports" data-problems>
              {reply.problems.map((p, i) => (
                <li key={i}>
                  {p.line === undefined ? "" : `Line ${p.line}: `}
                  {p.message}
                </li>
              ))}
            </ul>
          )}
          {reply.text === undefined ? <p class="rpe-line" data-no-render>It does not read as it stands, so nothing is rendered.</p> : <Pre text={reply.text} mono={false} />}
          {reply.fields.length === 0 ? null : (
            <p class="rpe-meta" data-fields>
              Fields it names: {reply.fields.join(", ")}
            </p>
          )}
          {reply.missing.length === 0 ? null : (
            <p class="rpe-line" data-missing>
              <Badge tone="warn">no value</Badge> {reply.missing.join(", ")}: the part is never given {reply.missing.length === 1 ? "this field" : "these fields"}.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

/** The preview of a draft: asked again once he has stopped typing for the setting's wait. */
export function PartPreview(props: { chat: string | null; path: string; text: string }) {
  const app = useApp();
  const wait = useUiSetting("previewWaitMs");
  const [reply, setReply] = useState<PartPreviewReply | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(true);
  useEffect(() => {
    let alive = true;
    setAsking(true);
    const handle = app.timers.setTimeout(() => {
      callWanted(app.client, "POST /api/v1/files-preview", {}, { body: { path: props.path, text: props.text, ...(props.chat === null ? {} : { chat: props.chat }) } }).then(
        (answer) => {
          if (!alive) return;
          setAsking(false);
          setReply(answer);
          setProblem(null);
        },
        (error: unknown) => {
          if (!alive) return;
          setAsking(false);
          setProblem(errorWords(error));
        },
      );
    }, wait);
    return () => {
      alive = false;
      app.timers.clearTimeout(handle);
    };
  }, [props.path, props.text, props.chat, wait]);
  return <PreviewView reply={reply} problem={problem} asking={asking} />;
}

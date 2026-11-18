// An agent's stack on the Files page: for an agent chosen from those the chat's view defines, every part it is
// given, in order, each with the file it comes from and where it sits, and "Apply now", which starts the open
// session's opening block afresh so a change holds now.

import type { StackLeft } from "rp-harness/contract";
import type { StackReply } from "../../../shared/api";
import { Banner, Button, Disclosure, Pre, Section } from "../../../frontend/components";
import { LEVEL_WORDS } from "../../words";
import type { ApplyShown, FilesShown } from "./model";

/** Why a part is left out of an agent's stack, in the words of RPH's contract. */
const LEFT_WORDS: Readonly<Record<StackLeft, string>> = { missing: "no file at any level", off: "switched off", empty: "nothing in it but headings and comments", broken: "its header or text does not parse", needs: "a file its needs: names is not in force" };

/** What "Apply now" came to: the session it started afresh, or that none was open and the next one opens with the files as they stand. */
function ApplyNote(props: { apply: ApplyShown }) {
  const { apply } = props;
  if (apply.problem !== null) {
    return (
      <Banner tone="neg" icon="alert" title="Apply now did not go through">
        <span>{apply.problem}</span>
      </Banner>
    );
  }
  return apply.note === null ? null : (
    <Banner tone="info" icon="check" title="Applied">
      <span data-apply-note>{apply.note}</span>
    </Banner>
  );
}

/** What the agent is handed whole at the start of each of its runs, after its stack, in the order it is handed, each with why it is there. */
export function Handed(props: { agent: string; handed: StackReply["handed"] }) {
  if (props.handed.length === 0) return null;
  return (
    <>
      <p class="rpe-meta">Then, at the start of each run, {props.agent} is handed whole:</p>
      <ol class="rpe-reports" data-handed={props.agent}>
        {props.handed.map((h, i) => (
          <li key={`${i}:${h.ref}`} data-handed-ref={h.ref}>
            <span class="rpe-strong">{h.ref}</span>
            {h.from === "definition" ? " · its definition gives it" : ` · pinned for ${props.agent}, in the config of ${LEVEL_WORDS[h.pinnedAt ?? "chat"].toLowerCase()}`}
            {h.path === undefined || h.level === undefined ? null : ` · ${h.path} · ${LEVEL_WORDS[h.level]}`}
            {h.problem === undefined ? null : ` · ${h.problem}`}
            {h.text === undefined ? null : (
              <Disclosure summary="Its text" class="rpe-open">
                <Pre text={h.text} mono={false} />
              </Disclosure>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

export function StackSection(props: { chat: string | null; shown: FilesShown; onStack(agent: string): void; onApply(): void }) {
  const agents = props.shown.agents ?? [];
  const stack = props.shown.stack;
  if (props.chat === null || agents.length === 0) return null;
  return (
    <Section
      title="An agent's stack"
      id="stack"
      aside={
        <Button size="sm" busy={props.shown.apply.busy} title="Starts the opening block of this chat's open session afresh from the files as they stand, so a changed tool list or what an agent is given holds now." onClick={props.onApply}>
          Apply now
        </Button>
      }
    >
      <ApplyNote apply={props.shown.apply} />
      <label class="lre-field">
        <span class="label">Agent</span>
        <select
          class="lre-input"
          onChange={(event) => {
            const agent = event.currentTarget.value;
            if (agent !== "") props.onStack(agent);
          }}
        >
          <option value="" selected={stack === null}>
            Choose an agent
          </option>
          {agents.map((agent) => (
            <option key={agent} value={agent} selected={stack?.agent === agent}>
              {agent}
            </option>
          ))}
        </select>
      </label>
      {stack === null ? null : stack.problem !== null ? (
        <Banner tone="neg" icon="alert" title="The stack could not be read">
          <span>{stack.problem}</span>
        </Banner>
      ) : stack.parts === null ? (
        <p class="lre-muted rpe-line">Reading the stack of {stack.agent}…</p>
      ) : (
        <>
          <ol class="rpe-reports" data-stack={stack.agent}>
            {stack.parts.map((p, i) => (
              <li key={`${i}:${p.part}`} data-part={p.part}>
                <span class="rpe-strong">{p.part}</span>
                {` · ${p.path} · ${LEVEL_WORDS[p.level]} · ${p.where === "opening" ? "in the opening block" : "with the briefing"}`}
                {p.left === undefined ? null : ` · left out: ${LEFT_WORDS[p.left]}`}
                {p.situations === undefined || p.situations.length === 0 ? null : ` · added by: ${p.situations.join(", ")}`}
                {p.text === undefined ? null : (
                  <Disclosure summary="Its text" class="rpe-open">
                    <Pre text={p.text} mono={false} />
                  </Disclosure>
                )}
              </li>
            ))}
          </ol>
          <Handed agent={stack.agent} handed={stack.handed ?? []} />
        </>
      )}
    </Section>
  );
}

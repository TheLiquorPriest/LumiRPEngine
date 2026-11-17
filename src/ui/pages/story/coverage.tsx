// What the record covers of the chat, and the story so far as the Author is given it (plan §8.1, §14 Story): every stretch of messages the
// record does not cover or has beats for and no summary of, in and out of the prompt's window, each by range with what it holds; a hidden
// message marked as hidden, and the ones above the window counted only where the chat lets agents read hidden messages; and the story so far
// exactly as the next briefing gives it, with its size against its budget and each stretch it had no room for. Behind the spoiler gate.

import { useState } from "preact/hooks";
import type { StoryCoverage } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Pre, Section } from "../../../frontend/components";
import { useRead } from "../../reading";
import { useUiSetting } from "../../ui-settings";
import { counted, num } from "../../words";

type Stretch = StoryCoverage["stretches"][number];

/** A stretch that needs the player's eye: not covered, or with beats and no summary. */
export function needsEye(s: Stretch): boolean {
  return !s.covered || (s.beats && !s.summarized);
}

/** How many of the hidden messages lie in a stretch. */
export function hiddenIn(s: Pick<Stretch, "from" | "to">, hidden: readonly number[]): number {
  return hidden.filter((n) => n >= s.from && n <= s.to).length;
}

function StretchLine(props: { s: Stretch; hidden: readonly number[] }) {
  const { s } = props;
  const hidden = hiddenIn(s, props.hidden);
  return (
    <li class="rpe-entry" data-stretch={`${s.from}-${s.to}`}>
      <p class="rpe-line">
        <span class="rpe-strong">{s.from === s.to ? `Message ${s.from}` : `Messages ${s.from} to ${s.to}`}</span>{" "}
        <Badge tone={s.covered ? undefined : "warn"}>{s.covered ? "covered" : "not covered"}</Badge>{" "}
        {s.beats ? <Badge>{s.summarized ? "beats, summarized" : "beats, no summary"}</Badge> : null} <Badge tone={s.window ? "pos" : undefined}>{s.window ? "in the window" : "out of the window"}</Badge>
        {hidden === 0 ? null : <Badge tone="gm">{counted(hidden, "hidden message")}</Badge>}
      </p>
    </li>
  );
}

export function CoverageView(props: { coverage: StoryCoverage; shownAtOnce: number; /** How many more pages of stretches were asked for. */ more?: number; onMore?(): void }) {
  const c = props.coverage;
  const eye = c.stretches.filter(needsEye);
  const shown = eye.slice(0, props.shownAtOnce * (1 + (props.more ?? 0)));
  return (
    <div class="lre-stack" data-coverage>
      <p class="rpe-line" data-edge>
        {counted(c.messages, "message")} on the chat's path. {c.edge === null ? "The prompt's window keeps them all." : `The prompt's window keeps messages from ${c.edge} on.`}
      </p>
      <p class="rpe-line" data-above>
        {c.above === 0 ? "The record covers everything above the window's edge." : `${counted(c.above, "message")} above the window's edge ${c.above === 1 ? "is" : "are"} not covered by the record.`}{" "}
        {c.hidden.length === 0 ? "" : `${counted(c.hidden.length, "message")} you hid; ${c.hiddenReadable ? "agents may read hidden messages in this chat, so an uncovered one above the edge is counted." : "agents may not read hidden messages in this chat, so one above the edge is not counted."}`}
      </p>
      {eye.length === 0 ? (
        <p class="lre-muted rpe-line" data-stretches-none>Every stretch is covered, and every stretch with beats has its summary.</p>
      ) : (
        <ul class="rpe-plain lre-stack" data-stretches>
          {shown.map((s) => (
            <StretchLine key={`${s.from}-${s.to}`} s={s} hidden={c.hidden} />
          ))}
        </ul>
      )}
      {shown.length < eye.length ? <Button onClick={props.onMore}>{`More stretches (${eye.length - shown.length} left)`}</Button> : null}
    </div>
  );
}

export function CoverageSection(props: { chat: string; stamp: number }) {
  const app = useApp();
  const perPage = useUiSetting("rowsAtOnce");
  const [more, setMore] = useState(0);
  const read = useRead(() => app.client.call("GET /api/v1/chats/:chat/story/coverage", { chat: props.chat }), [props.chat, props.stamp]);
  return (
    <Section id="coverage" title="What the record covers">
      {read.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The coverage could not be read">
          <span>{read.problem}</span>
        </Banner>
      )}
      {read.value === null ? read.problem === null ? <p class="lre-muted rpe-line">Reading what the record covers…</p> : null : <CoverageView coverage={read.value} shownAtOnce={perPage} more={more} onMore={() => setMore((n) => n + 1)} />}
    </Section>
  );
}

export function SoFarSection(props: { chat: string; stamp: number }) {
  const app = useApp();
  const read = useRead(() => app.client.call("GET /api/v1/chats/:chat/story/so-far", { chat: props.chat }), [props.chat, props.stamp]);
  const so = read.value;
  return (
    <Section id="so-far" title="The story so far, as the Author is given it">
      {read.problem === null ? null : (
        <Banner tone="info" icon="info" title="Not worked out yet">
          <span data-so-far-problem>{read.problem}</span>
        </Banner>
      )}
      {so === null ? (
        read.problem === null ? <p class="lre-muted rpe-line">Working it out…</p> : null
      ) : (
        <div class="lre-stack" data-so-far>
          <p class="rpe-meta">
            {num(so.tokens)} of at most {num(so.budget)} tokens.
          </p>
          {so.text === "" ? <p class="lre-muted rpe-line">Nothing: the window leaves nothing out, or the record holds nothing for it.</p> : <Pre text={so.text} mono={false} />}
          {so.leftOut.length === 0 ? null : (
            <div class="lre-stack" data-left-out>
              <span class="rpe-caption">Had no room for</span>
              <ul class="rpe-reports">
                {so.leftOut.map((l) => (
                  <li key={`${l.from}-${l.to}`}>
                    messages {l.from} to {l.to}: {counted(l.chapters, "chapter")}, {counted(l.scenes, "scene")}, {counted(l.beats, "beat")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

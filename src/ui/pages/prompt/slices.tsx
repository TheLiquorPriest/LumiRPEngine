// The prompt map's parts as the Prompt page draws them: every slice in order with its marker, kind, line,
// how it behaves, how it was found and whether the chat application's breakdown confirmed it or corrected
// it, its size and its text; text no slice claims; the front report; what Lumiverse's own clipping left out;
// and the old engines' blocks the preset still holds.

import type { ComponentChildren } from "preact";
import { Badge, Banner, Fold, Pre } from "../../atoms";
import type { NoticeLines } from "../../notice-words";
import { clippedWords, promptNoticeWords } from "../../notice-words";
import type { PromptClipped, PromptShown, PromptSliceShown } from "../../../shared/api";
import { counted, num } from "../../words";

const HOW_WORDS: Readonly<Record<NonNullable<PromptSliceShown["found"]>, string>> = {
  signature: "found by a signature of its text",
  block: "found by the chat application's block name",
  place: "found by its place among its neighbours",
};

const BREAKDOWN_WORDS: Readonly<Record<NonNullable<PromptSliceShown["breakdown"]>, string>> = {
  confirmed: "the chat application's breakdown confirmed it",
  corrected: "the chat application's breakdown corrected it",
};

/** What the page puts beside a slice: its edit controls, filled in by the page, which holds the state they need. */
export interface SliceSlots {
  tools?(slice: PromptSliceShown, all: readonly PromptSliceShown[]): ComponentChildren;
}

/** One slice: what it is, where and how it was found, and its text when the spoiler gate is open. */
export function SliceCard(props: { slice: PromptSliceShown; all: readonly PromptSliceShown[]; gateOpen: boolean; slots: SliceSlots }) {
  const { slice } = props;
  return (
    <li class="lre-section" data-slice={slice.marker}>
      <div class="lre-section-head">
        <h3 class="lre-section-title lre-id">{slice.marker}</h3>
        <span class="lre-inline rpe-wrap">
          <Badge>{slice.kind}</Badge>
          {slice.behaviour === undefined ? null : <Badge>{slice.behaviour}</Badge>}
          {slice.edited === true ? <Badge tone="accent">edited by you</Badge> : null}
        </span>
      </div>
      <div class="lre-section-body">
        {slice.line === undefined ? null : <p class="rpe-line">{slice.line}</p>}
        <p class="rpe-meta">
          {slice.found === undefined ? "Not found in this prompt." : `${counted(slice.length, "character")}, ${HOW_WORDS[slice.found]}${slice.breakdown === undefined ? "" : `; ${BREAKDOWN_WORDS[slice.breakdown]}`}.`}
          {slice.at.length === 0 ? "" : ` In ${slice.at.map((at) => `message ${at.message}, ${at.start} to ${at.end}`).join("; ")}.`}
        </p>
        {slice.found === undefined ? null : props.gateOpen ? (
          <Fold summary="Its text" class="rpe-open">
            <Pre text={slice.text} mono={false} />
          </Fold>
        ) : (
          <p class="rpe-meta">Open the spoiler gate to read its text.</p>
        )}
        {props.slots.tools?.(slice, props.all)}
      </div>
    </li>
  );
}

/** Text that belongs to no slice, each stretch by where it is. */
export function Unclaimed(props: { unclaimed: PromptShown["unclaimed"]; gateOpen: boolean }) {
  if (props.unclaimed.length === 0) return null;
  return (
    <div class="lre-stack" data-unclaimed>
      <span class="rpe-caption">Text no part claims</span>
      {props.unclaimed.map((u) => (
        <div key={`${u.message}-${u.start}`} class="lre-stack">
          <p class="rpe-meta">{`Message ${u.message}, characters ${u.start} to ${u.end} (${counted(u.end - u.start, "character")}).`}</p>
          {props.gateOpen ? <Pre text={u.text} mono={false} /> : null}
        </div>
      ))}
    </div>
  );
}

/** How much of the prompt's front was the same as the turn before, and the part that broke it. */
export function FrontLine(props: { front: PromptShown["front"] }) {
  const { front } = props;
  return (
    <p class="rpe-line" data-front>
      {front.brokenBy === undefined ? `The whole of the prompt's front held (${counted(front.length, "character")}).` : `The prompt's front held for ${counted(front.length, "character")}; ${front.brokenBy} broke it.`}
    </p>
  );
}

/** What Lumiverse's own clipping cut inside RPE's window, in the notices file's words. */
export function ClippedNote(props: { clipped: PromptClipped | null; lines: NoticeLines }) {
  const { clipped } = props;
  if (clipped === null) return null;
  return (
    <Banner tone="warn" icon="alert" title="Lumiverse cut the prompt inside RPE's window">
      <span>{clippedWords(props.lines, clipped)}</span>
    </Banner>
  );
}

/** The old engines' blocks the preset still holds, each by name; RPE does not edit presets. */
export function OldBlocks(props: { old: PromptShown["old"] }) {
  if (props.old.length === 0) return null;
  return (
    <Banner tone="warn" icon="alert" title="The old engines' blocks are still in this preset">
      <span>RPE does not edit presets: take these out of the preset in Lumiverse.</span>
      <ul class="rpe-reports" data-old-blocks>
        {props.old.map((block) => (
          <li key={`${block.kind}-${block.name}-${block.in}`}>
            {block.kind === "block" ? "Block" : "Outlet reference"} <span class="lre-id">{block.name}</span>, in {block.in}
          </li>
        ))}
      </ul>
    </Banner>
  );
}

/** What changed in the prompt's shape this turn, one line each, in the notices file's words. */
export function NoticeList(props: { notices: PromptShown["notices"]; lines: NoticeLines }) {
  if (props.notices.length === 0) return <p class="rpe-meta">Nothing changed in the prompt's shape.</p>;
  return (
    <ul class="rpe-reports" data-notices>
      {props.notices.map((notice, i) => (
        <li key={i}>{promptNoticeWords(props.lines, notice)}</li>
      ))}
    </ul>
  );
}

/** The size of the whole map in words. */
export function mapWords(shown: PromptShown): string {
  return `${counted(shown.slices.length, "part")}, ${num(shown.slices.reduce((sum, s) => sum + s.length, 0))} characters found`;
}

// The prompt map's parts as the Prompt page draws them: every slice in order with its marker, kind, line,
// how it behaves, how it was found and whether the chat application's breakdown confirmed it or corrected
// it, its size and its text; text no slice claims; the front report; what Lumiverse's own clipping left out;
// and the old engines' blocks the preset still holds.

import type { ComponentChildren } from "preact";
import { Badge, Banner, Fold, Pre } from "../../atoms";
import type { NoticeLines } from "../../notice-words";
import { clippedWords, promptNoticeWords } from "../../notice-words";
import type { ClippedShown, FrontShown, OldBlockShown, PromptShown, SliceShown, UnclaimedShown } from "../../wanted";
import { counted, num } from "../../words";

const HOW_WORDS: Readonly<Record<NonNullable<SliceShown["how"]>, string>> = {
  signature: "found by a signature of its text",
  block: "found by the chat application's block name",
  place: "found by its place among its neighbours",
};

const BREAKDOWN_WORDS: Readonly<Record<NonNullable<SliceShown["breakdown"]>, string>> = {
  confirmed: "the chat application's breakdown confirmed it",
  corrected: "the chat application's breakdown corrected it",
};

/** What the page puts beside a slice: its edit controls, filled in by the page, which holds the state they need. */
export interface SliceSlots {
  tools?(slice: SliceShown, all: readonly SliceShown[]): ComponentChildren;
}

/** One slice: what it is, where and how it was found, and its text when the spoiler gate is open. */
export function SliceCard(props: { slice: SliceShown; all: readonly SliceShown[]; gateOpen: boolean; slots: SliceSlots }) {
  const { slice } = props;
  return (
    <li class="lre-section" data-slice={slice.marker}>
      <div class="lre-section-head">
        <h3 class="lre-section-title lre-id">{slice.marker}</h3>
        <span class="lre-inline rpe-wrap">
          <Badge>{slice.kind}</Badge>
          <Badge>{slice.behaviour}</Badge>
          {slice.edited ? <Badge tone="accent">edited by you</Badge> : null}
        </span>
      </div>
      <div class="lre-section-body">
        <p class="rpe-line">{slice.line}</p>
        <p class="rpe-meta">
          {slice.how === null ? "Not found in this prompt." : `${counted(slice.length, "character")}, ${HOW_WORDS[slice.how]}${slice.breakdown === null ? "" : `; ${BREAKDOWN_WORDS[slice.breakdown]}`}.`}
          {slice.found.length === 0 ? "" : ` In ${slice.found.map((at) => `message ${at.message}, ${at.start} to ${at.end}`).join("; ")}.`}
        </p>
        {slice.text === null ? null : props.gateOpen ? (
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
export function Unclaimed(props: { unclaimed: readonly UnclaimedShown[]; gateOpen: boolean }) {
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
export function FrontLine(props: { front: FrontShown }) {
  const { front } = props;
  return (
    <p class="rpe-line" data-front>
      {front.brokenBy === null ? `The whole of the prompt's front held (${counted(front.length, "character")}).` : `The prompt's front held for ${counted(front.length, "character")}; ${front.brokenBy} broke it.`}
    </p>
  );
}

/** What Lumiverse's own clipping cut inside RPE's window, in the notices file's words, with the turns it was on. */
export function ClippedNote(props: { clipped: ClippedShown | null; lines: NoticeLines }) {
  const { clipped } = props;
  if (clipped === null) return null;
  return (
    <Banner tone="warn" icon="alert" title="Lumiverse cut the prompt inside RPE's window">
      <span>{clippedWords(props.lines, clipped)}</span>
      {clipped.turns.length === 0 ? null : <span class="rpe-meta"> On turns {clipped.turns.join(", ")}.</span>}
    </Banner>
  );
}

/** The old engines' blocks the preset still holds, each by name; RPE does not edit presets. */
export function OldBlocks(props: { old: readonly OldBlockShown[] }) {
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

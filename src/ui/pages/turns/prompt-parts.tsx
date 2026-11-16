// What the Author was given, as the Turn page draws it: the turn's prompt by slice (each under its marker and
// kind, the persona's and the rest's text opening from the request as it was sent), the text no slice owns, the
// lore map's entries each by its map id, book and title with how it activated, and the named parts of the
// turn's folder.

import type { LocatedSlices, TurnLoreRow, TurnReply } from "../../../shared/api";
import { Badge, Fold, Pre } from "../../atoms";
import { counted } from "../../words";
import type { RequestShown } from "./types";

type Slice = LocatedSlices["slices"][number];
type Span = { message: number; start: number; end: number };

/** The prompt's messages in the request the lead was sent, in order: each is a message of the assembled prompt (the request's `prompt` block). */
function promptMessages(lead: RequestShown | null | undefined): readonly string[] | null {
  return lead === null || lead === undefined || !lead.same ? null : lead.messages.filter((m) => m.block === "prompt").map((m) => m.text);
}

/** The words of a stretch of the prompt: the slice of the message's text it names; null where the request does not hold that message. */
function spanText(messages: readonly string[] | null, span: Span): string | null {
  const text = messages?.[span.message];
  return text === undefined ? null : text.slice(span.start, span.end);
}

/** The text of a slice, its places joined; null where the request was not kept or does not reach it. */
export function sliceText(lead: RequestShown | null | undefined, slice: Pick<Slice, "at">): string | null {
  const messages = promptMessages(lead);
  const parts = slice.at.map((span) => spanText(messages, span));
  return parts.length === 0 || parts.some((p) => p === null) ? null : parts.join("\n");
}

/** The turn's prompt by slice: every slice under its marker and kind, its size and where it was found, its text on opening; text no slice owns shown as such. */
export function PromptBySlice(props: { prompt: TurnReply["prompt"]; lead: RequestShown | null | undefined }) {
  const { prompt } = props;
  if (prompt === null) return <p class="rpe-meta">RPH kept no located prompt for this turn.</p>;
  const unmapped = prompt.notices.some((n) => n.kind === "unmapped");
  const messages = promptMessages(props.lead);
  return (
    <div class="lre-stack" data-prompt-slices>
      <span class="rpe-caption">The prompt, by slice</span>
      {unmapped ? <p class="rpe-meta">No prompt map has been learned for this preset: the parts are named by the chat application's blocks and by place.</p> : null}
      {prompt.slices.map((slice) => {
        const text = sliceText(props.lead, slice);
        return (
          <div key={slice.marker} class="lre-stack" data-slice={slice.marker}>
            <span class="lre-inline rpe-wrap">
              <code class="lre-id">{slice.marker}</code>
              <Badge>{slice.kind}</Badge>
              <span class="rpe-meta">
                {counted(slice.length, "character")}
                {slice.at.length === 0 ? ", not found in this prompt" : `, in ${slice.at.map((s) => `message ${s.message}`).join(", ")}`}
              </span>
            </span>
            {slice.at.length === 0 ? null : (
              <Fold summary="Its text" class="rpe-open">
                {text === null ? <p class="rpe-meta">The request this was found in was not kept, or cannot be rebuilt as it was sent.</p> : <Pre text={text} mono={false} />}
              </Fold>
            )}
          </div>
        );
      })}
      {prompt.unclaimed.length === 0 ? null : (
        <div class="lre-stack" data-unclaimed>
          <span class="rpe-caption">Text no slice owns</span>
          {prompt.unclaimed.map((span) => {
            const text = spanText(messages, span);
            return (
              <Fold key={`${span.message}-${span.start}`} summary={`Message ${span.message}, characters ${span.start} to ${span.end}`} class="rpe-open">
                {text === null ? <p class="rpe-meta">Its text is not shown: the request was not kept.</p> : <Pre text={text} mono={false} />}
              </Fold>
            );
          })}
        </div>
      )}
    </div>
  );
}

const HOW_WORDS: Readonly<Record<NonNullable<TurnLoreRow["how"]>, string>> = {
  constant: "always on",
  keyword: "by a key",
  vector: "by meaning",
  sticky: "still in force from earlier",
};

/** The lore Lumiverse activated for the turn's prompt, each entry by its map id, its book and its title, with how it activated or "not said" where the turn's tag does not say. */
export function LoreMapRows(props: { rows: readonly TurnLoreRow[] | null | undefined }) {
  const { rows } = props;
  if (rows === null || rows === undefined) return null;
  if (rows.length === 0) return <p class="rpe-meta">No lore entry was activated for this prompt.</p>;
  return (
    <div class="lre-stack" data-lore-map>
      <span class="rpe-caption">Its lore map</span>
      <ul class="rpe-reports">
        {rows.map((row) => (
          <li key={row.id}>
            <code class="lre-id">{row.id}</code> {row.title}
            <span class="rpe-meta">
              {" "}
              ({row.book === "" ? "book not said" : `book ${row.book}`}; {row.how === null ? "not said how it activated" : HOW_WORDS[row.how]})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The folder's files the Author's briefing and prompt are made of, by the names they are given under. */
export const NAMED_PARTS: Readonly<Record<string, string>> = {
  "world-state.md": "The world state",
  "briefing.md": "The briefing, with the lore map and the story brief",
  "active-wi-content.md": "The lore Lumiverse activated",
  "assembled-preset-prompt.md": "The assembled prompt",
  "PROMPT-MAP.md": "The prompt map as found",
  "persona.md": "The persona",
  "character.md": "The character",
  "preset-guidance.md": "The preset's instructions",
};

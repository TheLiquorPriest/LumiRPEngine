// One item of the story record as the page draws it (plan §8.1): its part, where it lies in the chat, its fields as written, struck or not, the
// way to strike it or take the strike back, and the way to correct it as his own change.

import type { StoryItemRow, StoryPartName } from "../../../shared/api";
import { Badge } from "../../../frontend/components";
import type { RpeClient } from "../../client";
import { type CorrectAsk, EntryCard, type StrikeAsk } from "../../records";

export const PART_WORDS: Readonly<Record<StoryPartName, string>> = {
  premise: "Premise",
  chapter: "Chapter",
  scene: "Scene",
  beat: "Beat",
  thread: "Thread",
  arc: "Arc",
  player: "Player",
  future: "Future",
  canon: "Canon",
  retcon: "Retcon",
  record: "Record",
};

/** Where an item lies in the chat. */
export function spanWords(item: Pick<StoryItemRow, "from" | "to">): string | null {
  if (item.from === null && item.to === null) return null;
  if (item.from === item.to) return `message ${item.from}`;
  return `messages ${item.from ?? "?"} to ${item.to ?? "open"}`;
}

export interface ItemActions {
  /** The id of the item a strike or a correction is out for now; null for none. */
  busy: string | null;
  onStrike(ask: StrikeAsk): void;
  onCorrect?(ask: CorrectAsk): Promise<string[]>;
}

export function StoryItemCard(props: ItemActions & { item: StoryItemRow; current?: boolean }) {
  const { item } = props;
  const span = spanWords(item);
  return (
    <EntryCard
      id={item.id}
      title={PART_WORDS[item.part]}
      marks={
        <>
          {span === null ? null : <span class="rpe-meta lre-num">{span}</span>}
          {props.current === true ? <Badge tone="accent">now</Badge> : null}
          {item.closed ? <Badge>closed</Badge> : null}
        </>
      }
      fields={item.fields}
      first={item}
      struck={item.struck}
      writes={item.writes}
      busy={props.busy === item.id}
      onStrike={props.onStrike}
      onCorrect={props.onCorrect}
    />
  );
}

/** Strikes an item, or takes its strike back, as his own change. */
export function strikeItem(client: Pick<RpeClient, "call">, chat: string, ask: StrikeAsk) {
  return client.call("POST /api/v1/chats/:chat/story/strike", { chat }, { body: ask });
}

/** Corrects an item's fields as his own change; answers what the record said of them and the item as it stands now. */
export function correctItem(client: Pick<RpeClient, "call">, chat: string, ask: CorrectAsk) {
  return client.call("POST /api/v1/chats/:chat/story/correct", { chat }, { body: ask });
}

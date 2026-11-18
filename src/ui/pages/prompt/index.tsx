// Prompt (plan §4.8, §14): how this chat's preset is cut into named parts. Every part of the preset's prompt
// map in order with its marker, kind, line, how it behaves, how it was found in the turn's prompt and
// whether the chat application's breakdown confirmed or corrected it, with its text behind the spoiler gate;
// text no part claims; and the owner's five edits to the map (rename, merge, split, correct a line, change a
// kind), which RPH keeps with the preset. Turn by turn it lists what changed in the prompt's shape, one line
// each in the notices file's words, and how much of the prompt's front stayed the same and which part broke
// it. It flags the old engines' blocks and outlet references the preset still holds, and says when
// Lumiverse's own clipping cut inside RPE's window. Before a map is learned it shows the raw layout's parts,
// and says so.

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { TurnId } from "../../../shared/api";
import { useApp } from "../../app";
import { Banner, Button, Empty, Gated, PageHeader, Section } from "../../../frontend/components";
import { onChatChange } from "../../live-watch";
import { type NoticeLines, useNoticeLines } from "../../notice-words";
import type { PageEntry } from "../../page-entry";
import { usePaged, useRead } from "../../reading";
import { useSelect } from "../../store";
import type { PromptShown, PromptTurnShown } from "../../../shared/api";
import { clock } from "../../words";
import { MapAgain } from "./map-again";
import { readPrompt, readPromptHistory } from "./read";
import { ClippedNote, FrontLine, NoticeList, OldBlocks, SliceCard, type SliceSlots, Unclaimed } from "./slices";
import { SliceTools } from "./tools";

const GATE_WHY = "The text of the prompt's parts holds the persona, the card and the lore the model was given, which can give away what comes next.";

export interface PromptViewProps {
  shown: PromptShown | null;
  loading: boolean;
  problem: string | null;
  lines: NoticeLines;
  history: { items: readonly PromptTurnShown[]; more: boolean; loading: boolean; problem: string | null; onOlder(): void };
  gateOpen: boolean;
  onOpenGate(): void;
  onCloseGate(): void;
  /** The turn the parts were found in, when it is not the chat's newest. */
  turn: TurnId | null;
  onPickTurn(turn: TurnId | null): void;
  onOpenTurn(turn: TurnId): void;
  slots?: SliceSlots;
  /** What stands beside the page's own parts (the Map again control). */
  actions?: ComponentChildren;
}

/** One past turn's notices and front, with the way to see the map as found in that turn's prompt. */
function HistoryLine(props: { entry: PromptTurnShown; lines: NoticeLines; current: boolean; onPick(): void; onOpenTurn(): void }) {
  const { entry } = props;
  return (
    <li class="rpe-entry" data-prompt-turn={entry.turn}>
      <div class="lre-spread">
        <span class="rpe-strong">
          {entry.n === null ? "A turn no longer on the path" : `Turn ${entry.n}`} · {clock(entry.at)}
        </span>
        <span class="lre-inline">
          <Button size="sm" variant="ghost" current={props.current} onClick={props.onPick}>
            Its parts
          </Button>
          <Button size="sm" variant="ghost" onClick={props.onOpenTurn}>
            Its page
          </Button>
        </span>
      </div>
      <FrontLine front={entry.front} />
      <NoticeList notices={entry.notices} lines={props.lines} />
    </li>
  );
}

export function PromptView(props: PromptViewProps) {
  const { shown } = props;
  const slots = props.slots ?? {};
  return (
    <div class="lre-stack rpe-page" data-page="prompt">
      <PageHeader title="Prompt" subtitle="How this chat's preset is cut into named parts." actions={props.actions} />
      <Gated open={props.gateOpen} onOpen={props.onOpenGate} onClose={props.onCloseGate} why={GATE_WHY}>
        {null}
      </Gated>
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The prompt could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {shown === null ? (
        props.loading ? (
          <p class="lre-muted rpe-line">Reading the prompt…</p>
        ) : props.problem === null ? (
          <Empty icon="list" title="No prompt kept yet">
            <span>RPE keeps the prompt of each turn it plays. This chat has none kept yet: its parts show here after its next turn on RPE.</span>
          </Empty>
        ) : null
      ) : (
        <>
          {shown.mapped ? null : (
            <Banner tone="info" icon="info" title="This preset has no prompt map yet">
              <span>The raw layout's parts are shown, named by the chat application's blocks and by place, until a map is learned.</span>
            </Banner>
          )}
          {shown.mapped && !shown.playedMapped ? (
            <Banner tone="info" icon="info" title="This turn was played before the preset had a map">
              <span>The parts below are cut by the map as it stands now. The front and the notices, further down, are as recorded when it was played, when its prompt was known only by the chat application's layout.</span>
            </Banner>
          ) : null}
          {shown.complete ? null : (
            <Banner tone="warn" icon="alert" title="The prompt could not be told apart">
              <span>The chat application joined parts of it in a way that cannot be undone, so its parts cannot be found by name.</span>
            </Banner>
          )}
          <OldBlocks old={shown.old} />
          <ClippedNote clipped={shown.clipped} lines={props.lines} />
          {props.turn === null ? null : (
            <Banner tone="info" icon="info" title="As found in an earlier turn's prompt" actions={<Button onClick={() => props.onPickTurn(null)}>The newest</Button>}>
              <span>The parts below are where they were found in turn {shown.turn}.</span>
            </Banner>
          )}
          <Section id="parts" title={shown.preset?.name === undefined ? "The parts" : `The parts of ${shown.preset.name}`}>
            {shown.slices.length === 0 ? (
              <Empty icon="list" title="No part found">
                <span>No part was found in this turn's prompt.</span>
              </Empty>
            ) : (
              <ul class="rpe-plain lre-stack">
                {shown.slices.map((slice) => (
                  <SliceCard key={slice.marker} slice={slice} all={shown.slices} gateOpen={props.gateOpen} slots={slots} />
                ))}
              </ul>
            )}
            <Unclaimed unclaimed={shown.unclaimed} gateOpen={props.gateOpen} />
          </Section>
          <Section id="front" title="How much of the front stayed the same">
            <FrontLine front={shown.front} />
          </Section>
          <Section id="notices" title="What changed when this turn was played">
            <NoticeList notices={shown.notices} lines={props.lines} />
          </Section>
        </>
      )}
      <Section id="history" title="Turn by turn">
        {props.history.problem === null ? null : (
          <Banner tone="neg" icon="alert" title="The notices could not be read">
            <span>{props.history.problem}</span>
          </Banner>
        )}
        {props.history.items.length === 0 ? (
          props.history.loading ? (
            <p class="lre-muted rpe-line">Reading the notices…</p>
          ) : props.history.problem === null ? (
            <p class="rpe-meta">No turn has laid out a prompt yet.</p>
          ) : null
        ) : (
          <ul class="rpe-plain lre-stack">
            {props.history.items.map((entry) => (
              <HistoryLine key={entry.turn} entry={entry} lines={props.lines} current={props.turn === entry.turn} onPick={() => props.onPickTurn(entry.turn)} onOpenTurn={() => props.onOpenTurn(entry.turn)} />
            ))}
          </ul>
        )}
        {props.history.more ? (
          <Button busy={props.history.loading} onClick={props.history.onOlder}>
            Older turns
          </Button>
        ) : null}
      </Section>
    </div>
  );
}

/** The Prompt page of a chat. */
export function PromptPage(props: { chat: string; actions?: ComponentChildren }) {
  const app = useApp();
  const { chat } = props;
  const gateOpen = useSelect(app.gate, (opened) => opened.has(chat));
  const lines = useNoticeLines(chat);
  const [turn, setTurn] = useState<TurnId | null>(null);
  const [edited, setEdited] = useState<PromptShown | null>(null);
  const read = useRead(() => readPrompt(app.client, chat, turn), [chat, turn]);
  const history = usePaged((cursor) => readPromptHistory(app.client, chat, cursor), [chat]);
  useEffect(() => {
    setTurn(null);
    setEdited(null);
  }, [chat]);
  useEffect(() => {
    setEdited(null);
  }, [turn, read.value]);
  // A run that begins or ends lays out a prompt of its own: the page reads both again then.
  useEffect(() => onChatChange(app.client, chat, () => {
    read.again();
    history.again();
  }), [chat]);
  const shown = edited ?? read.value;
  const slots: SliceSlots = { tools: (slice, all) => <SliceTools chat={chat} turn={turn} slice={slice} all={all} onEdited={setEdited} /> };
  return (
    <PromptView
      shown={shown}
      loading={read.loading}
      problem={read.problem}
      lines={lines}
      history={{ items: history.items, more: history.more, loading: history.loading, problem: history.problem, onOlder: history.older }}
      gateOpen={gateOpen}
      onOpenGate={() => app.gate.open(chat)}
      onCloseGate={() => app.gate.close(chat)}
      turn={turn}
      onPickTurn={setTurn}
      onOpenTurn={(id) => app.go({ page: "turns", chat, at: [id] })}
      slots={slots}
      actions={props.actions ?? (
        <MapAgain
          chat={chat}
          onLearned={() => {
            read.again();
            history.again();
          }}
        />
      )}
    />
  );
}

export const entry: PageEntry = { id: "prompt", title: "Prompt", icon: "list", shells: ["web", "drawer"], needsChat: true, often: false, order: 55, render: (route) => <PromptPage chat={route.chat} /> };

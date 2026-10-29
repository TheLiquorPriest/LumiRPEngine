// GM → This chat → Knowledge (DESIGN §6.11): this chat's own knowledge choices, knowledge tracking
// and the narrator's knowledge, each beside what it follows when the chat has none of its own.
// They're kept in the chat's metadata (`lre.chat.knowledge`), not as a GM edit: no Undo, no recorded
// turn changes, and a Branch of the chat keeps them.

import type { NarratorView } from "../../shared/settings";
import type { ControlsView } from "../../shared/state-view";
import { useApp } from "../app";
import { Empty, HostSwitch, Section, useBusy } from "../components";
import { NarratorViewControl, narratorViewSummary } from "../settings/narrator";

type Knowledge = ControlsView["knowledge"];

/** The narrator's knowledge in force in this chat: its own, else its world's default, else the user's. */
export function narratorInForce(knowledge: Knowledge): NarratorView {
  return knowledge.narrator.chat ?? knowledge.narrator.world ?? knowledge.narrator.user;
}

/** This chat's row in GM → This chat: whether it tracks knowledge, and the narrator's knowledge in force. */
export function knowledgeSummary(knowledge: Knowledge): string {
  return `Tracking ${(knowledge.tracking.chat ?? knowledge.tracking.user) ? "on" : "off"} · ${narratorViewSummary(narratorInForce(knowledge))}`;
}

export function KnowledgeThisChat(props: { chatId: string; controls: ControlsView | null }) {
  const app = useApp();
  const [busy, run] = useBusy();
  if (!props.controls) return <Empty icon="eye">Knowledge settings appear once the chat has started.</Empty>;
  const { tracking, narrator } = props.controls.knowledge;
  const send = (change: { knowledge?: boolean | null; narrator?: NarratorView | null }) =>
    run(async () => {
      if (await app.request({ type: "lre.chat.knowledge", chatId: props.chatId, ...change })) app.toast("Saved for this chat: it applies from the next turn.", "info");
    });
  const ownTracking = tracking.chat !== null;
  const ownNarrator = narrator.chat !== null;
  return (
    <div class="lre-stack" data-lre-knowledge="chat">
      <p class="lre-gm-note">What this chat keeps track of, and what its narrator is told. A change applies from the next turn; a Branch of the chat keeps these.</p>
      <Section title="Knowledge tracking">
        <div class="lre-stack" data-lre-knowledge-tracking>
          <p class="lre-gm-note">Whether the engine works out from each reply who learned what.</p>
          <HostSwitch label="This chat has its own setting" checked={ownTracking} disabled={busy} onChange={(on) => send({ knowledge: on ? tracking.user : null })} />
          {tracking.chat !== null ? (
            <HostSwitch label="Track who knows what in this chat" checked={tracking.chat} disabled={busy} onChange={(on) => send({ knowledge: on })} />
          ) : (
            <span class="lre-field-help">{`It follows your Settings → Minds → Knowledge, now ${tracking.user ? "On" : "Off"}.`}</span>
          )}
        </div>
      </Section>
      <Section title="What the narrator knows">
        <div class="lre-stack" data-lre-knowledge-narrator>
          <HostSwitch label="This chat has its own choice" checked={ownNarrator} disabled={busy} onChange={(on) => send({ narrator: on ? { ...(narrator.world ?? narrator.user) } : null })} />
          {narrator.chat !== null ? (
            <NarratorViewControl value={narrator.chat} disabled={busy} onChange={(next) => send({ narrator: next })} />
          ) : (
            <span class="lre-field-help">{narrator.world ? `It follows the world's default (Build → World): ${narratorViewSummary(narrator.world)}.` : `It follows your Settings → Narrator: ${narratorViewSummary(narrator.user)}.`}</span>
          )}
        </div>
      </Section>
    </div>
  );
}

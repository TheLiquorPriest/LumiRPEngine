// GM → This chat → Engine (AGENT-LOOP-PLAN §15; INC2-SPEC C12; INC3 3a): which engine plays this
// chat's turns, its classic steps or agents, and where that comes from: the chat's own choice, the
// default for new chats its first turn recorded, the default its first turn will record, or classic
// for a chat that played before it chose. Kept in the chat's metadata with its knowledge choices
// (`lre.chat.knowledge`'s `engine`), not as a GM edit: no Undo, no recorded turn changes, and a
// Branch of the chat keeps it. The page reads it on open (the request with no change) and sends the
// one picked, which is the chat's own from then on. A switch drops a turn the engine already
// prepared for the next reply, which the engine switched to works out again, and is refused while
// the chat's turn waits at a gate. `EngineSwitch` and `engineRequest` are hook-free, so tests press
// them without a DOM.

import { useEffect, useState } from "preact/hooks";
import { CHAT_ENGINE_LABELS, CHAT_ENGINES, type ChatEngine, type EngineSource } from "../../shared/agent-settings";
import type { ChatId } from "../../shared/ids";
import { useApp } from "../app";
import { Empty, Section, Seg, useBusy } from "../components";

/** A chat's engine as the page shows it: the engine its next turn plays, and where that comes from. */
export interface ChatEngineRead {
  engine: ChatEngine;
  from: EngineSource;
}

const ENGINE_HELP: Record<ChatEngine, string> = {
  classic: "Each turn runs the engine's classic steps, as Settings → Steps and connections sets them.",
  agents: "Each turn's steps are worked out by agents, as Settings → Agents, Roles and Main agent set them; the gates, cards and chips stay as they are.",
};

/** Where the engine comes from, in plain words. */
const SOURCE_TEXT: Record<EngineSource, string> = {
  chosen: "This chat's own choice.",
  default: "The default for new chats when this chat played its first turn (Settings → Agents → Pipeline → New chats start on). It stays this chat's whatever the default becomes; switching makes it a choice of the chat's own.",
  new: "This chat has played no turn yet: its first turn takes the default for new chats (Settings → Agents → Pipeline → New chats start on) and keeps it.",
  played: "This chat played before it chose an engine, so it plays classic until you switch it.",
};

/** The request that sets this chat's engine. */
export function engineRequest(chatId: ChatId, engine: ChatEngine): { type: "lre.chat.knowledge"; chatId: ChatId; engine: ChatEngine } {
  return { type: "lre.chat.knowledge", chatId, engine };
}

/** The switch, without hooks: the engine now and where it comes from (null while it is read), and what switching does, in plain words. */
export function EngineSwitch(props: { engine: ChatEngineRead | null; busy: boolean; onChange(engine: ChatEngine): void }) {
  if (props.engine === null) return <p class="lre-gm-note">Reading which engine plays this chat…</p>;
  const { engine, from } = props.engine;
  return (
    <div class="lre-stack" data-lre-chat-engine={engine} data-lre-chat-engine-from={from}>
      <p class="lre-gm-note">Which engine plays this chat's turns. A switch applies from the next turn; earlier turns stay as they were played, and a Branch of the chat keeps it.</p>
      <div class="lre-field">
        <Seg<ChatEngine> label="Which engine plays this chat's turns" value={engine} options={CHAT_ENGINES.map((value) => ({ value, label: CHAT_ENGINE_LABELS[value] }))} disabled={props.busy} onChange={props.onChange} />
        <span class="lre-field-help">{ENGINE_HELP[engine]}</span>
      </div>
      <span class="lre-small lre-muted" data-lre-chat-engine-source>
        {SOURCE_TEXT[from]}
      </span>
      <p class="lre-gm-note" data-lre-chat-engine-drops>Switching drops a turn the engine has already prepared for the next reply: the engine you switch to works it out again. While the chat's turn waits at a gate or on its review card, answer or cancel it first.</p>
    </div>
  );
}

/**
 * Reads a chat's engine (`lre.chat.knowledge` with no change): unknown and not failed at once, so
 * nothing of another chat's read stays, then the engine read, or failed. Returns the stop, after
 * which an answer is dropped.
 */
export function readEngine(request: () => Promise<{ engine: ChatEngine; engineFrom: EngineSource } | null>, out: { engine(engine: ChatEngineRead | null): void; failed(failed: boolean): void }): () => void {
  let live = true;
  out.engine(null);
  out.failed(false);
  void request().then((result) => {
    if (!live) return;
    if (result) out.engine({ engine: result.engine, from: result.engineFrom });
    else out.failed(true);
  });
  return () => {
    live = false;
  };
}

/** This chat's engine: read on open and on each chat it is opened for, and set from the switch. */
export function EngineThisChat(props: { chatId: ChatId }) {
  const app = useApp();
  const [busy, run] = useBusy();
  const [engine, setEngine] = useState<ChatEngineRead | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => readEngine(() => app.request<"lre.chat.knowledge">({ type: "lre.chat.knowledge", chatId: props.chatId }), { engine: setEngine, failed: setFailed }), [props.chatId]);
  if (failed) return <Empty icon="alert">The engine didn't say which engine plays this chat.</Empty>;
  return (
    <Section title="Engine">
      <EngineSwitch
        engine={engine}
        busy={busy}
        onChange={(next) =>
          run(async () => {
            const result = await app.request<"lre.chat.knowledge">(engineRequest(props.chatId, next));
            if (!result) return;
            setEngine({ engine: result.engine, from: result.engineFrom });
            app.toast(`This chat plays ${CHAT_ENGINE_LABELS[result.engine].toLowerCase()} from the next turn.`, "info");
          })
        }
      />
    </Section>
  );
}

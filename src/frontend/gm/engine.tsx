// GM → This chat → Engine (AGENT-LOOP-PLAN §15; INC2-SPEC C12): which engine plays this chat's
// turns, its classic steps or agents. Kept in the chat's metadata with its knowledge choices
// (`lre.chat.knowledge`'s `engine`), not as a GM edit: no Undo, no recorded turn changes, and a Branch
// of the chat keeps it. The page reads it on open (the request with no change) and sends the one
// picked. A switch drops a turn the engine already prepared for the next reply, which the engine
// switched to works out again. `EngineSwitch` and `engineRequest` are hook-free, so tests press them
// without a DOM.

import { useEffect, useState } from "preact/hooks";
import type { ChatId } from "../../shared/ids";
import { useApp } from "../app";
import { Empty, Section, Seg, useBusy } from "../components";

/** Which engine plays a chat's turns. */
export type ChatEngine = "classic" | "agents";

const ENGINE_LABEL: Record<ChatEngine, string> = { classic: "Classic steps", agents: "Agents" };

const ENGINE_HELP: Record<ChatEngine, string> = {
  classic: "Each turn runs the engine's classic steps, as Settings → Steps and connections sets them.",
  agents: "Each turn's steps are worked out by agents, as Settings → Agents, Roles and Main agent set them; the gates, cards and chips stay as they are.",
};

/** The request that sets this chat's engine. */
export function engineRequest(chatId: ChatId, engine: ChatEngine): { type: "lre.chat.knowledge"; chatId: ChatId; engine: ChatEngine } {
  return { type: "lre.chat.knowledge", chatId, engine };
}

/** The switch, without hooks: the engine now (null while it is read), and what switching does, in plain words. */
export function EngineSwitch(props: { engine: ChatEngine | null; busy: boolean; onChange(engine: ChatEngine): void }) {
  if (props.engine === null) return <p class="lre-gm-note">Reading which engine plays this chat…</p>;
  return (
    <div class="lre-stack" data-lre-chat-engine={props.engine}>
      <p class="lre-gm-note">Which engine plays this chat's turns. A switch applies from the next turn; earlier turns stay as they were played, and a Branch of the chat keeps it.</p>
      <div class="lre-field">
        <Seg<ChatEngine> label="Which engine plays this chat's turns" value={props.engine} options={(["classic", "agents"] as const).map((value) => ({ value, label: ENGINE_LABEL[value] }))} disabled={props.busy} onChange={props.onChange} />
        <span class="lre-field-help">{ENGINE_HELP[props.engine]}</span>
      </div>
      <p class="lre-gm-note" data-lre-chat-engine-drops>Switching drops a turn the engine has already prepared for the next reply: the engine you switch to works it out again.</p>
      <span class="lre-small lre-muted">A chat plays classic until you switch it.</span>
    </div>
  );
}

/**
 * Reads a chat's engine (`lre.chat.knowledge` with no change): unknown and not failed at once, so
 * nothing of another chat's read stays, then the engine read, or failed. Returns the stop, after
 * which an answer is dropped.
 */
export function readEngine(request: () => Promise<{ engine?: "agents" } | null>, out: { engine(engine: ChatEngine | null): void; failed(failed: boolean): void }): () => void {
  let live = true;
  out.engine(null);
  out.failed(false);
  void request().then((result) => {
    if (!live) return;
    if (result) out.engine(result.engine ?? "classic");
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
  const [engine, setEngine] = useState<ChatEngine | null>(null);
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
            setEngine(result.engine ?? "classic");
            app.toast(`This chat plays ${ENGINE_LABEL[result.engine ?? "classic"].toLowerCase()} from the next turn.`, "info");
          })
        }
      />
    </Section>
  );
}

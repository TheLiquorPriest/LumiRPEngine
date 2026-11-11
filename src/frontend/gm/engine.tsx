// GM → This chat → Engine (AGENT-LOOP-PLAN §15; INC2-SPEC C12; HARNESS-SLICE3): which engine plays
// this chat's turns: its classic steps, agents, or the harness. Kept in the chat's metadata with its
// knowledge choices (`lre.chat.knowledge`'s `engine`), not as a GM edit: no Undo, no recorded turn
// changes, and a Branch of the chat keeps it. The page reads it on open (the request with no change)
// and sends the one picked. A switch drops a turn the engine already prepared for the next reply,
// which the engine switched to works out again.
//
// The page says what each engine is before one is picked, in words for someone who has met none of
// them: what plays a turn, and what they will notice. Where the harness can't play the user's chats
// (`harnessBlocked`), its option can't be pressed, and the page says why and what to do. A chat on
// the harness also shows the harness engine's own settings (Settings: `agents.harness`), which are
// the user's for every chat. `EngineSwitch`, `HarnessRows` and `engineRequest` are hook-free, so
// tests press them without a DOM.

import { useEffect, useState } from "preact/hooks";
import { defaultAgentSettings, HARNESS_COMMIT_WAIT_DEF, HARNESS_REMEMBERED_DEF, type HarnessSettings } from "../../shared/agent-settings";
import type { ChatId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import { useApp } from "../app";
import { Banner, Empty, HostSwitch, Section, Seg, type SegOption, useBusy } from "../components";
import { LimitRow, SettingRow } from "../settings/kit";

/** Which engine plays a chat's turns. */
export type ChatEngine = "classic" | "agents" | "harness";

/** The engines, in the order the switch lists them. */
const ENGINES: readonly ChatEngine[] = ["classic", "agents", "harness"];

const ENGINE_LABEL: Record<ChatEngine, string> = { classic: "Classic steps", agents: "Agents", harness: "Harness" };

/** What each engine is, a line each; the harness's two say what changes for someone who has never met one: who plays the turn, and what they will notice. */
export const ENGINE_HELP: Record<ChatEngine, readonly string[]> = {
  classic: ["Each turn runs the engine's classic steps, as Settings → Steps and connections sets them."],
  agents: ["Each turn's steps are worked out by agents, as Settings → Agents, Roles and Main agent set them; the gates, cards and chips stay as they are."],
  harness: [
    "An AI author plays each turn before the reply is written: it reads the world, lets each character think for themselves, rolls what needs a roll, records what changed, and tells the writer what happened.",
    "Nothing to set up: it works on this chat's own connection, and your preset still writes the reply. The reply starts once the author is done, so it begins later; changes you set to ask first still ask.",
  ],
};

/** What the page says once a switch is kept. */
const ENGINE_SWITCHED: Record<ChatEngine, string> = {
  classic: "This chat plays its classic steps from the next turn.",
  agents: "This chat plays on agents from the next turn.",
  harness: "From the next turn an AI author plays this chat. There is nothing else to set up.",
};

/** The defaults the harness rows' Default goes back to. */
const HARNESS_DEFAULTS = defaultAgentSettings().harness;

const TICK_HELP = {
  on: "A turn whose author never says how much time it took takes the scene's usual time for a turn, as a turn on the other engines does.",
  off: "A turn takes only the time its author says: one whose author says nothing takes none.",
};

const onOff = (on: boolean): string => (on ? "on" : "off");

/** The request that sets this chat's engine. */
export function engineRequest(chatId: ChatId, engine: ChatEngine): { type: "lre.chat.knowledge"; chatId: ChatId; engine: ChatEngine } {
  return { type: "lre.chat.knowledge", chatId, engine };
}

/**
 * The switch, without hooks: the engine now (null while it is read), what each engine is, and what
 * switching does, in plain words. `blocked`: why the harness can't play the user's chats now and
 * what to do about it; its option can't be pressed then, and a chat already on it is warned.
 */
export function EngineSwitch(props: { engine: ChatEngine | null; busy: boolean; blocked?: string | null; onChange(engine: ChatEngine): void }) {
  if (props.engine === null) return <p class="lre-gm-note">Reading which engine plays this chat…</p>;
  const blocked = props.blocked ?? null;
  const closed = blocked !== null && props.engine !== "harness";
  const options = ENGINES.map((value): SegOption<ChatEngine> => ({ value, label: ENGINE_LABEL[value], ...(closed && value === "harness" ? { disabled: true, title: blocked } : {}) }));
  return (
    <div class="lre-stack" data-lre-chat-engine={props.engine}>
      <p class="lre-gm-note">Which engine plays this chat's turns. A switch applies from the next turn; earlier turns stay as they were played, and a Branch of the chat keeps it.</p>
      <div class="lre-field">
        <Seg<ChatEngine> label="Which engine plays this chat's turns" value={props.engine} options={options} disabled={props.busy} onChange={props.onChange} />
        {ENGINES.map((value) => (
          <span key={value} class="lre-field-help" data-lre-engine-help={value}>
            <strong>{ENGINE_LABEL[value]}.</strong> {ENGINE_HELP[value].join(" ")}
          </span>
        ))}
      </div>
      {blocked === null ? null : closed ? (
        <Banner tone="info" icon="alert" title="Harness can't be chosen yet">
          {blocked}
        </Banner>
      ) : (
        <Banner tone="warn" icon="alert" title="The harness can't play this chat now">
          {blocked} Until then its replies are written with no turn played: nothing is rolled, no time passes, and nothing they tell is recorded. Switch to another engine to go on playing meanwhile.
        </Banner>
      )}
      <p class="lre-gm-note" data-lre-chat-engine-drops>Switching drops a turn the engine has already prepared for the next reply: the engine you switch to works it out again.</p>
      <span class="lre-small lre-muted">A chat new to its world plays on the harness where the harness can play it. A chat made before keeps the engine it had until you switch it.</span>
    </div>
  );
}

/** The harness engine's own settings, without hooks: the user's, for every chat they play on the harness. A Default sends null, as every setting's does. */
export function HarnessRows(props: { harness: HarnessSettings; busy: boolean; patch(patch: JsonObject): void }) {
  const on = props.harness.defaultTick;
  const standard = HARNESS_DEFAULTS.defaultTick;
  return (
    <div class="lre-set-rows" data-lre-harness-settings>
      <p class="lre-set-note">The harness's settings, for every chat you play on it.</p>
      <SettingRow id="harness-default-tick" label="Time for a turn whose author says none" bare changed={on !== standard} help={on ? TICK_HELP.on : TICK_HELP.off} reset={{ label: `Reset the time for a turn whose author says none to its default, ${onOff(standard)}`, to: onOff(standard), onClick: () => props.patch({ agents: { harness: { defaultTick: null } } }) }} busy={props.busy}>
        <HostSwitch label="Pass the scene's usual time when the author says none" checked={on} disabled={props.busy} onChange={(defaultTick) => props.patch({ agents: { harness: { defaultTick } } })} />
      </SettingRow>
      <LimitRow id="harness-commit-wait" def={HARNESS_COMMIT_WAIT_DEF} value={props.harness.commitWaitMs} standard={HARNESS_DEFAULTS.commitWaitMs} busy={props.busy} set={(commitWaitMs) => props.patch({ agents: { harness: { commitWaitMs } } })} />
      <LimitRow id="harness-runs-remembered" def={HARNESS_REMEMBERED_DEF} value={props.harness.runsRemembered} standard={HARNESS_DEFAULTS.runsRemembered} busy={props.busy} set={(runsRemembered) => props.patch({ agents: { harness: { runsRemembered } } })} />
    </div>
  );
}

/**
 * Reads a chat's engine (`lre.chat.knowledge` with no change): unknown and not failed at once, so
 * nothing of another chat's read stays, then the engine read, or failed. `blocked`, where the page
 * listens, takes why the harness can't be chosen (null: it can). Returns the stop, after which an
 * answer is dropped.
 */
export function readEngine(request: () => Promise<{ engine?: "agents" | "harness"; harnessBlocked?: string } | null>, out: { engine(engine: ChatEngine | null): void; failed(failed: boolean): void; blocked?(why: string | null): void }): () => void {
  let live = true;
  out.engine(null);
  out.failed(false);
  out.blocked?.(null);
  void request().then((result) => {
    if (!live) return;
    if (!result) return out.failed(true);
    out.blocked?.(result.harnessBlocked ?? null);
    out.engine(result.engine ?? "classic");
  });
  return () => {
    live = false;
  };
}

/** This chat's engine: read on open and on each chat it is opened for, and set from the switch; on the harness, its settings beneath. */
export function EngineThisChat(props: { chatId: ChatId }) {
  const app = useApp();
  const [busy, run] = useBusy();
  const [engine, setEngine] = useState<ChatEngine | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [harness, setHarness] = useState<HarnessSettings | null>(null);
  useEffect(() => readEngine(() => app.request<"lre.chat.knowledge">({ type: "lre.chat.knowledge", chatId: props.chatId, engines: true }), { engine: setEngine, failed: setFailed, blocked: setBlocked }), [props.chatId]);
  // The harness's settings are the user's, read once a chat on the harness shows them.
  const shows = engine === "harness" && harness === null;
  useEffect(() => {
    if (!shows) return;
    let live = true;
    void app.request({ type: "lre.settings.get" }).then((result) => {
      if (live && result) setHarness(result.settings.agents.harness);
    });
    return () => {
      live = false;
    };
  }, [shows]);
  if (failed) return <Empty icon="alert">The engine didn't say which engine plays this chat.</Empty>;
  return (
    <Section title="Engine">
      <EngineSwitch
        engine={engine}
        busy={busy}
        blocked={blocked}
        onChange={(next) =>
          run(async () => {
            const result = await app.request<"lre.chat.knowledge">(engineRequest(props.chatId, next));
            if (!result) return;
            setEngine(result.engine ?? "classic");
            app.toast(ENGINE_SWITCHED[result.engine ?? "classic"], "info");
          })
        }
      />
      {engine === "harness" && harness !== null ? (
        <HarnessRows
          harness={harness}
          busy={busy}
          patch={(patch) =>
            run(async () => {
              const result = await app.request({ type: "lre.settings.set", patch });
              if (result) setHarness(result.settings.agents.harness);
            })
          }
        />
      ) : null}
    </Section>
  );
}

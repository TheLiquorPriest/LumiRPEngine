// GM → This chat → Things (ITEMS-SPEC §9, §11): this chat's own Tidy up switch, whether its
// impossible holds are tidied automatically (an older chat's one-time Things tidied fix), beside the
// world's (Build → Packs → gear → Tidy up), which it follows while it has none of its own. Kept in the
// chat's metadata with its knowledge choices (`lre.chat.knowledge`'s `tidy`), not as a GM edit: no
// Undo, no recorded turn changes, and a Branch of the chat keeps it. `TidySwitch` and `tidyRequest`
// are hook-free, so tests press them without a DOM.

import type { ChatId } from "../../shared/ids";
import type { ControlsView } from "../../shared/state-view";
import { useApp } from "../app";
import { Empty, HostSwitch, Section, useBusy } from "../components";

type Tidy = ControlsView["things"]["tidy"];

/** Whether this chat's impossible holds are tidied automatically: its own switch, else the world's. */
export function tidyInForce(tidy: Tidy): boolean {
  return tidy.chat ?? tidy.world;
}

/** This chat's row in GM → This chat: whether it tidies, and whose setting that is. */
export function thingsSummary(tidy: Tidy): string {
  return `Tidy impossible holds automatically ${tidyInForce(tidy) ? "on" : "off"} · ${tidy.chat === null ? "the world's setting" : "this chat's own"}`;
}

/** The request that sets this chat's switch: on, off, or null to follow the world's again. */
export function tidyRequest(chatId: ChatId, tidy: boolean | null): { type: "lre.chat.knowledge"; chatId: ChatId; tidy: boolean | null } {
  return { type: "lre.chat.knowledge", chatId, tidy };
}

/** The switch, without hooks: the chat's own setting and the world's, and what tidying does, in plain words. */
export function TidySwitch(props: { tidy: Tidy; busy: boolean; onChange(tidy: boolean | null): void }) {
  const { tidy } = props;
  return (
    <div class="lre-stack" data-lre-chat-tidy={tidyInForce(tidy) ? "on" : "off"}>
      <p class="lre-gm-note">Once, on its first turn under this build, an older chat puts down what someone has on them that is too big to carry (a fridge in someone's hands): at the buyer's home when it was bought, else where they stand, as Things tidied with its Undo. Everything else waits in GM → Things → Tidy up.</p>
      <HostSwitch label="This chat has its own setting" checked={tidy.chat !== null} disabled={props.busy} onChange={(on) => props.onChange(on ? tidy.world : null)} />
      {tidy.chat !== null ? (
        <HostSwitch label="Tidy impossible holds automatically in this chat" checked={tidy.chat} disabled={props.busy} onChange={(on) => props.onChange(on)} />
      ) : (
        <span class="lre-field-help">{`It follows the world's setting (Build → Packs → gear → Tidy up), now ${tidy.world ? "On" : "Off"}.`}</span>
      )}
      <span class="lre-small lre-muted">A change applies from the next turn. A chat tidied once is tidied no more, even after its Undo; a Branch of the chat keeps this.</span>
    </div>
  );
}

/** This chat's things choices, from its controls; set from the switch. */
export function ThingsThisChat(props: { chatId: ChatId; controls: ControlsView | null }) {
  const app = useApp();
  const [busy, run] = useBusy();
  if (!props.controls) return <Empty icon="box">Things settings appear once the chat has started.</Empty>;
  const send = (tidy: boolean | null) =>
    run(async () => {
      if (await app.request(tidyRequest(props.chatId, tidy))) app.toast("Saved for this chat: it applies from the next turn.", "info");
    });
  return (
    <Section title="Tidy up">
      <TidySwitch tidy={props.controls.things.tidy} busy={busy} onChange={send} />
    </Section>
  );
}

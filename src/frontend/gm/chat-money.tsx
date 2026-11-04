// GM → This chat → Money (DESIGN §25.8): where cash needs a machine or a branch in this chat. The
// world's switch (Build → Economy → Cash, `features.atm`) stands until the chat sets its own, which
// is one GM edit (`economy.cash_rule`, recorded as `economy.config`) with its Undo; "As the world"
// sends null and returns the chat to the world's switch. Hook-free parts (`cashSummary`,
// `cashRuleEdit`, `CashRuleControl`) so tests press them without a DOM.

import type { ChatId } from "../../shared/ids";
import type { ControlsView } from "../../shared/state-view";
import { useApp } from "../app";
import { Empty, Section, Seg, useBusy } from "../components";
import { toastQueued } from "../queued";
import { editRequest, type Req } from "../requests";

type Cash = NonNullable<ControlsView["cash"]>;

/** The chat's choice, as its control offers it. */
export type CashChoice = "world" | "machine" | "free";

const CHOICES: readonly { value: CashChoice; label: string }[] = [
  { value: "world", label: "As the world" },
  { value: "machine", label: "Needs a machine" },
  { value: "free", label: "Anywhere" },
];

/** Whether cash needs a machine or a branch for the player character now: the chat's rule, else the world's switch, else its usual Money level. */
export function cashNeedsMachine(cash: Cash): boolean {
  return cash.chat ?? cash.world ?? cash.level >= cash.usual;
}

/** The world's rule in words: its switch, or the Money level it runs from. */
function worldRule(cash: Cash): string {
  return cash.world === null ? `from Money ${cash.usual} (now ${cash.level})` : cash.world ? "on" : "off";
}

/** This chat's row in GM → This chat: whether cash needs a machine, and whose rule that is. */
export function cashSummary(cash: Cash): string {
  return `Cash ${cashNeedsMachine(cash) ? "needs a machine or a branch" : "comes and goes anywhere"} · ${cash.chat === null ? "the world's rule" : "this chat's own"}`;
}

/** The GM edit that sets this chat's rule: on, off, or null to follow the world's again. */
export function cashRuleEdit(chatId: ChatId, choice: CashChoice): Req<"lre.edit"> {
  return editRequest(chatId, [{ op: "effect", effect: "economy.cash_rule", args: { atm: choice === "world" ? null : choice === "machine" } }]);
}

/** The control, without hooks: the chat's choice beside the world's rule, and what each means. */
export function CashRuleControl(props: { cash: Cash; busy: boolean; onChange(choice: CashChoice): void }) {
  const { cash } = props;
  const choice: CashChoice = cash.chat === null ? "world" : cash.chat ? "machine" : "free";
  return (
    <div class="lre-stack" data-lre-chat-cash={choice}>
      <p class="lre-gm-note">Where cash needs a machine, drawing or paying in cash takes a cash machine or a branch of the account's bank where the player character is (a card for a machine, its limits and fees); anywhere, cash moves freely. Paying a card or moving money between accounts never needs one.</p>
      <div class="lre-field">
        <span class="label">Cash in this chat</span>
        <Seg<CashChoice> label="Cash in this chat" value={choice} options={CHOICES} disabled={props.busy} onChange={props.onChange} />
        <span class="lre-field-help">{`The world's rule (Build → Economy → Cash): ${worldRule(cash)}. ${choice === "world" ? "This chat follows it." : "This chat's own rule comes first."}`}</span>
      </div>
      <span class="lre-small lre-muted">Saved as a GM edit with its Undo; it applies at once, and earlier turns keep what they did.</span>
    </div>
  );
}

/** This chat's money rules, from its controls; set from the control. */
export function MoneyThisChat(props: { chatId: ChatId; controls: ControlsView | null }) {
  const app = useApp();
  const [busy, run] = useBusy();
  const cash = props.controls?.cash;
  if (!props.controls) return <Empty icon="coins">Money settings appear once the chat has started.</Empty>;
  if (!cash) return <Empty icon="coins">Money is off for the player character in this chat.</Empty>;
  const send = (choice: CashChoice) =>
    run(async () => {
      toastQueued(app, await app.request(cashRuleEdit(props.chatId, choice)));
    });
  return (
    <Section title="Cash">
      <CashRuleControl cash={cash} busy={busy} onChange={send} />
    </Section>
  );
}

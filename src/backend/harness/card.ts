// A harness tool's change that asks first, as a review card holds it (HARNESS-SLICE3 step 5:
// "A write set to Confirm goes to the review card"). A write tool's operation goes on the card as an
// agent turn's does, and Apply makes it through the writer. A change one of the harness engine's own
// tools staged has no operation: the card holds it as a confirm chip of its own, hidden from the
// chips area, whose Apply makes the change.
//
// - A change with a proposal (a learning, a reveal, time passing) is worded as the player character
//   may read it, and Apply makes it again from that proposal on the chat as it then stands, as a
//   reply's own confirm is made.
// - A change with none is told in the plain words its tool gave it, and Apply lands the events the
//   engine's validator made of the call, whole or not at all. It asks first like any other: a type
//   set to Confirm is never refused for want of a form.

import type { MessageId } from "../../shared/ids";
import type { JsonObject, JsonValue } from "../../shared/json";
import type { ChangeType } from "../../shared/settings";
import type { ReadContext } from "../../engine/registry";
import type { StoredReviewItem } from "../agents/review";
import type { HarnessChange } from "../agents/tools/harness-turn";
import type { StoredChip } from "../chips";
import type { Runtime } from "../runtime";

/** The lines a card tells a change in: its proposal as the player character may read it, or, where it has none, the plain words its tool gave it. */
export function cardLines(rt: Runtime, change: HarnessChange, view: Pick<ReadContext, "registry" | "world" | "state">): string[] {
  if (change.proposal) return [rt.proposalLabel(change.proposal, view)];
  return change.lines.length > 0 ? [...change.lines] : [String(change.changeType)];
}

/** The confirm chip a reply's card holds for a change, and the card's item for it: `at` says which chip, on which swipe of which reply, under whose connection its answer counts, and what the chip says of itself. */
export function cardedChange(rt: Runtime, change: HarnessChange, type: ChangeType, view: Pick<ReadContext, "registry" | "world" | "state">, at: { id: string; messageId: MessageId; swipeId: number; connection: string; detail: string }): { chip: StoredChip; item: StoredReviewItem } {
  const lines = cardLines(rt, change, view);
  const form: JsonObject = change.proposal ? { proposal: change.proposal } : { staged: JSON.parse(JSON.stringify(change.events)) as JsonValue };
  const chip: StoredChip = { id: at.id, kind: "confirm", messageId: at.messageId, swipeId: at.swipeId, label: lines[0] ?? type, detail: at.detail, actions: [{ id: "confirm", label: "Apply", style: "primary" }, { id: "reject", label: "No" }], expires: "next_send", payload: { type, connection: at.connection, ...form, review: true } };
  return { chip, item: { key: at.id, source: "read", role: "read", changeType: type, lines, status: "open", chipId: at.id } };
}

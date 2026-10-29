// Play → Story → What you know (DESIGN §24.11): the facts the player character holds, newest
// first, each with how and since when they came by it, what they make of it and whom they keep it
// from. The view is the minds pack's `KnownView`, built from the player character's own holdings
// only: nothing here comes from anyone else's. Styles: styles/minds.ts.

import type { HoldingBelief, HoldingHow, KnownItem, KnownView } from "../../../shared/minds";
import { HOLDING_BELIEFS, HOLDING_HOWS } from "../../../shared/minds";
import { isRecord } from "../../../shared/json";
import { Badge, Empty, JsonView, Section } from "../../../frontend/components";
import { list, num, oneOf, str, strings } from "../../../frontend/decode";
import { ActionRow, ActionRows } from "../../../frontend/gm/ui";
import type { PanelProps } from "../../../frontend/registry";

export function decodeKnownView(value: unknown): KnownView | null {
  if (!isRecord(value) || typeof value.tracking !== "boolean") return null;
  return {
    tracking: value.tracking,
    items: list(value.items, (i) =>
      typeof i.key === "string" && typeof i.claim === "string"
        ? {
            key: i.key,
            claim: i.claim,
            how: oneOf(i.how, HOLDING_HOWS, "authored"),
            byName: typeof i.byName === "string" ? i.byName : null,
            sinceText: str(i.sinceText),
            belief: oneOf(i.belief, HOLDING_BELIEFS, "true"),
            confidence: num(i.confidence),
            suspicion: i.suspicion === true,
            open: i.open === true,
            keptFrom: i.keptFrom === "everyone" ? "everyone" : Array.isArray(i.keptFrom) ? strings(i.keptFrom) : null,
          }
        : null,
    ),
  };
}

/** How they came by it, in Play's words. */
function howText(item: Pick<KnownItem, "how" | "byName">): string {
  const how: Record<HoldingHow, string> = { authored: "From the start", witnessed: "You saw it", told: item.byName ? `Told by ${item.byName}` : "You were told", inferred: "You worked it out", guessed: "A guess" };
  return how[item.how];
}

const BELIEF_BADGE: Record<HoldingBelief, string | null> = { true: null, false: "You don't believe it", uncertain: "Unsure" };

/** Whom they keep it from, by name: "Marcus Delgado", "Marcus Delgado and Priya Nair", or everyone. */
function keptText(keptFrom: KnownItem["keptFrom"]): string | null {
  if (keptFrom === null || (keptFrom !== "everyone" && keptFrom.length === 0)) return null;
  if (keptFrom === "everyone") return "You keep it from everyone";
  const names = keptFrom.length === 1 ? keptFrom[0] : `${keptFrom.slice(0, -1).join(", ")} and ${keptFrom.at(-1) ?? ""}`;
  return `You keep it from ${names}`;
}

export function KnownPanel(props: PanelProps) {
  const view = decodeKnownView(props.view);
  if (props.view !== null && props.view !== undefined && !view) return <JsonView value={props.view} />;
  if (view && !view.tracking) {
    return (
      <Empty icon="eye-off" title="Knowledge tracking is off for this chat">
        Turn it on in Settings → Minds → Knowledge, or for this chat in GM → This chat.
      </Empty>
    );
  }
  if (!view || view.items.length === 0) return <Empty icon="book">You haven't learned anything the story tracks yet.</Empty>;
  return (
    <div class="lre-stack lre-world" data-lre-panel="minds.known">
      <Section>
        <ActionRows label="What you know">
          {view.items.map((item) => {
            const belief = BELIEF_BADGE[item.belief];
            const kept = keptText(item.keptFrom);
            const badges = item.suspicion || item.open || belief !== null;
            return (
              <ActionRow key={item.key} title={item.claim} subtitle={[howText(item), item.sinceText].filter((part) => part !== "").join(" · ")}>
                {badges || kept ? (
                  <div class="lre-known-tags" data-lre-known={item.key}>
                    {item.suspicion ? <Badge tone="warn">Suspicion</Badge> : null}
                    {item.open ? <Badge tone="accent">Open question</Badge> : null}
                    {belief !== null ? <Badge>{belief}</Badge> : null}
                    {kept ? <span class="lre-known-kept">{kept}</span> : null}
                  </div>
                ) : null}
              </ActionRow>
            );
          })}
        </ActionRows>
      </Section>
    </div>
  );
}

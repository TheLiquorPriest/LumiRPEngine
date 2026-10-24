// GM → This chat → Sections (DESIGN §6.11): each section's feed in this chat over the world's, as
// a GM edit (`feed` op) with its own Undo. Settings only: what a section holds never shows here.

import { useState } from "preact/hooks";
import type { ControlsView } from "../../shared/state-view";
import type { FeedScope, SectionFeed } from "../../shared/world";
import { FEED_SCOPES } from "../../shared/world";
import { useApp } from "../app";
import { Button, Empty, Field, HostSelect, HostSwitch, List, ListRow, NumberStepper, Section, useBusy } from "../components";
import { editRequest } from "../requests";

export const SCOPE_LABEL: Record<FeedScope, string> = {
  player: "What the player character knows",
  scene: "Also what the people with him know",
  gm: "Everything, marked for the narrator",
};

type SectionRow = ControlsView["sections"][number];

/** A one-line summary of a feed: what differs from a section's plain delivery. */
export function feedSummary(feed: SectionFeed): string {
  const parts: string[] = [];
  if (feed.enabled === false) parts.push("off");
  if (feed.scope && feed.scope !== "player") parts.push(feed.scope === "scene" ? "scene scope" : "GM scope");
  if (feed.maxLines !== undefined) parts.push(`≤ ${feed.maxLines} lines`);
  if (feed.maxTokens !== undefined) parts.push(`≤ ${feed.maxTokens} tokens`);
  if (feed.include) parts.push(`sources: ${feed.include.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : "as the world has it";
}

/** One section's settings in this chat, saved whole as one edit; "Use the world's" clears them. */
function SectionFeedForm(props: { chatId: string; row: SectionRow; onDone(): void }) {
  const app = useApp();
  const [busy, run] = useBusy();
  const start: SectionFeed = { ...props.row.world, ...(props.row.chat ?? {}) };
  const [draft, setDraft] = useState<SectionFeed>(start);
  const [sources, setSources] = useState((start.include ?? []).join(", "));
  const set = (patch: Partial<SectionFeed>): void => setDraft((d) => ({ ...d, ...patch }));
  const send = (to: SectionFeed | null): void =>
    run(async () => {
      const result = await app.request(editRequest(props.chatId, [{ op: "feed", section: props.row.id, to }]));
      if (result?.pending) app.toast("Saved — it applies when the reply finishes.", "info");
      if (result) props.onDone();
    });
  const save = (): void => {
    const include = sources
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    const to: SectionFeed = {};
    if (draft.enabled === false) to.enabled = false;
    if (draft.scope && draft.scope !== "player") to.scope = draft.scope;
    if (draft.maxLines !== undefined) to.maxLines = draft.maxLines;
    if (draft.maxTokens !== undefined) to.maxTokens = draft.maxTokens;
    if (include.length > 0) to.include = include;
    // The chat's settings replace the world's whole, so a part left at its plain value is said outright.
    if (props.row.world.enabled === false && to.enabled === undefined) to.enabled = true;
    if (props.row.world.scope && props.row.world.scope !== "player" && to.scope === undefined) to.scope = "player";
    send(to);
  };
  return (
    <div class="lre-stack" data-lre-feed-form={props.row.id}>
      <HostSwitch checked={draft.enabled !== false} label="In the prompt" onChange={(on) => set({ enabled: on })} />
      <Field label="Whose knowledge">
        <HostSelect label="Whose knowledge" value={draft.scope ?? "player"} options={FEED_SCOPES.map((s) => ({ value: s, label: SCOPE_LABEL[s] }))} onChange={(v) => set({ scope: FEED_SCOPES.find((s) => s === v) ?? "player" })} />
      </Field>
      <Field label="At most lines" help="Empty: no cap">
        <NumberStepper label="At most lines" value={draft.maxLines ?? null} min={1} integer onChange={(v) => set({ maxLines: v })} />
      </Field>
      <Field label="At most tokens" help="Lines past it are cut from the end">
        <NumberStepper label="At most tokens" value={draft.maxTokens ?? null} min={1} integer onChange={(v) => set({ maxTokens: v })} />
      </Field>
      <Field label="Sources" help="Comma-separated renderer sources; empty: its own section's">
        <input class="lre-input" aria-label="Sources" value={sources} onInput={(e) => setSources(e.currentTarget.value)} />
      </Field>
      <div class="lre-row">
        <Button variant="primary" busy={busy} onClick={save}>
          Save for this chat
        </Button>
        <Button variant="secondary" disabled={busy || props.row.chat === null} onClick={() => send(null)}>
          Use the world's
        </Button>
      </div>
    </div>
  );
}

/** The chat's sections, each opening its settings. */
export function FeedThisChat(props: { chatId: string; controls: ControlsView | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = props.controls?.sections ?? [];
  if (rows.length === 0) return <Empty icon="scroll">Section settings appear once the chat has started.</Empty>;
  const row = rows.find((r) => r.id === open);
  return (
    <div class="lre-stack">
      <span class="lre-small lre-muted">What goes into each section the narrator reads in this chat. A change is a GM edit with its own Undo; the world's settings are in Build → Sections.</span>
      <Section flush>
        <List>
          {rows.map((r) => (
            <ListRow key={r.id} icon="scroll" title={r.label} subtitle={`${r.chat ? "This chat: " : "World: "}${feedSummary(r.chat ?? r.world)}`} chevron onClick={() => setOpen(open === r.id ? null : r.id)} />
          ))}
        </List>
      </Section>
      {row ? (
        <Section title={row.label}>
          <SectionFeedForm key={row.id} chatId={props.chatId} row={row} onDone={() => setOpen(null)} />
        </Section>
      ) : null}
    </div>
  );
}

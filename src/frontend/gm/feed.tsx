// GM → This chat → Sections (DESIGN §6.11): each section's feed in this chat over the world's, as
// a GM edit (`feed` op) with its own Undo. Settings only: what a section holds never shows here.

import { useState } from "preact/hooks";
import type { ControlsView } from "../../shared/state-view";
import type { FeedScope, SectionFeed } from "../../shared/world";
import { FEED_SCOPES } from "../../shared/world";
import { useApp } from "../app";
import { CheckField } from "../build/form-kit";
import { Button, Empty, HostSelect, HostSwitch, List, ListRow, NumberStepper, Section, useBusy } from "../components";
import { editRequest } from "../requests";
import { GmPage, usePages } from "./ui";

/** The "Whose knowledge" choices; a row's summary says the scope in these same words. */
export const SCOPE_LABEL: Record<FeedScope, string> = {
  player: "What your character knows",
  scene: "Also what the people with your character know",
  gm: "Everything, with what your character doesn't know marked",
};

type SectionRow = ControlsView["sections"][number];
type SourceRow = ControlsView["sources"][number];

/**
 * A feed in the form's own words, for its row: whether it's in the prompt, whose knowledge, its
 * caps and whether it takes sources other than its own. Off says only that, since nothing else applies.
 */
export function feedSummary(feed: SectionFeed): string {
  if (feed.enabled === false) return "Left out of the prompt";
  const caps = [feed.maxLines !== undefined ? `${feed.maxLines} lines` : null, feed.maxTokens !== undefined ? `${feed.maxTokens} tokens` : null].filter((c) => c !== null);
  const parts = ["In the prompt", SCOPE_LABEL[feed.scope ?? "player"], caps.length > 0 ? `at most ${caps.join(", ")}` : "no cap"];
  if (feed.include) parts.push(`${feed.include.length} picked ${feed.include.length === 1 ? "source" : "sources"}`);
  return parts.join(" · ");
}

/** The sources a section takes by itself: every renderer filling its own slot. */
export function ownSources(sources: readonly SourceRow[], section: string): string[] {
  return sources.filter((s) => s.slot === section).map((s) => s.id);
}

/** The sources a feed takes: its picked ones, else the section's own. */
export function sourcesTaken(feed: SectionFeed, sources: readonly SourceRow[], section: string): string[] {
  return feed.include ?? ownSources(sources, section);
}

/**
 * The settings a save sends: the form's, whole, since the chat's settings replace the world's for
 * the section. A part left plain (on, the player's knowledge, no cap, its own sources) is left out,
 * so a section keeps taking a source a pack adds later unless the GM picked its sources.
 */
export function chatFeedOf(draft: SectionFeed, picked: readonly string[], own: readonly string[]): SectionFeed {
  const to: SectionFeed = {};
  if (draft.enabled === false) to.enabled = false;
  if (draft.scope && draft.scope !== "player") to.scope = draft.scope;
  if (draft.maxLines !== undefined) to.maxLines = draft.maxLines;
  if (draft.maxTokens !== undefined) to.maxTokens = draft.maxTokens;
  const same = picked.length === own.length && own.every((id) => picked.includes(id));
  if (!same && picked.length > 0) to.include = [...picked];
  return to;
}

/**
 * Whether the boxes leave a section that is on with nothing it would take: none ticked though it has
 * sources of its own, which the engine would read as "its own", the opposite of what they show. A
 * section with no sources of its own (Outline and Montage, which the turn writes; a world's section
 * no pack fills) takes nothing from them either way, so its other settings save as they are.
 */
export function sourcesMissing(draft: SectionFeed, picked: readonly string[], own: readonly string[]): boolean {
  return draft.enabled !== false && own.length > 0 && picked.length === 0;
}

/** A cap's default when it is switched on. */
const CAP_START = { maxLines: 12, maxTokens: 400 } as const;

/** One section's settings in this chat, saved whole as one edit in place of the world's; "Use the world's" clears them. */
function SectionFeedForm(props: { chatId: string; row: SectionRow; sources: readonly SourceRow[]; onDone(): void }) {
  const app = useApp();
  const [busy, run] = useBusy();
  // The settings in force: the chat's when it has its own, else the world's.
  const start: SectionFeed = props.row.chat ?? props.row.world;
  const [draft, setDraft] = useState<SectionFeed>(start);
  const own = ownSources(props.sources, props.row.id);
  const [picked, setPicked] = useState<string[]>(sourcesTaken(start, props.sources, props.row.id));
  const set = (patch: Partial<SectionFeed>): void => setDraft((d) => ({ ...d, ...patch }));
  // Own sources first, then the rest, in the order packs register them.
  const offered = [...props.sources.filter((s) => s.slot === props.row.id), ...props.sources.filter((s) => s.slot !== props.row.id)];
  const send = (to: SectionFeed | null): void =>
    run(async () => {
      const result = await app.request(editRequest(props.chatId, [{ op: "feed", section: props.row.id, to }]));
      if (result?.pending) app.toast("Saved — it applies when the reply finishes.", "info");
      if (result) props.onDone();
    });
  const noneTaken = sourcesMissing(draft, picked, own);
  return (
    <div class="lre-stack" data-lre-feed-form={props.row.id}>
      <span class="lre-small lre-muted">{props.row.chat ? "This chat has its own settings for this section." : "This chat follows the world's settings for this section."}</span>
      <HostSwitch checked={draft.enabled !== false} label="In the prompt" onChange={(on) => set({ enabled: on })} />
      <HostSelect label="Whose knowledge" value={draft.scope ?? "player"} options={FEED_SCOPES.map((s) => ({ value: s, label: SCOPE_LABEL[s] }))} onChange={(v) => set({ scope: FEED_SCOPES.find((s) => s === v) ?? "player" })} />
      <HostSwitch checked={draft.maxLines !== undefined} label="Cap its lines" onChange={(on) => set({ maxLines: on ? (draft.maxLines ?? CAP_START.maxLines) : undefined })} />
      {draft.maxLines !== undefined ? <NumberStepper label="At most lines" value={draft.maxLines} min={1} integer onChange={(v) => set({ maxLines: v })} /> : null}
      <HostSwitch checked={draft.maxTokens !== undefined} label="Cap its tokens" onChange={(on) => set({ maxTokens: on ? (draft.maxTokens ?? CAP_START.maxTokens) : undefined })} />
      {draft.maxTokens !== undefined ? (
        <>
          <NumberStepper label="At most tokens" value={draft.maxTokens} min={1} integer onChange={(v) => set({ maxTokens: v })} />
          <span class="lre-small lre-muted">Lines past it are cut from the end.</span>
        </>
      ) : null}
      <Section title="What it tells" flush>
        <div class="lre-stack" data-lre-feed-sources>
          {own.length === 0 ? <span class="lre-small lre-muted">No source fills this section by itself (the turn writes Outline and Montage). A source you tick here adds its lines.</span> : null}
          {offered.map((s) => (
            <CheckField key={s.id} label={s.label} help={own.includes(s.id) ? "Its own" : undefined} checked={picked.includes(s.id)} onChange={(on) => setPicked((p) => (on ? [...p, s.id] : p.filter((id) => id !== s.id)))} />
          ))}
        </div>
      </Section>
      {noneTaken ? <span class="lre-small lre-muted">Tick at least one, or switch the section out of the prompt.</span> : null}
      <div class="lre-row">
        <Button variant="primary" busy={busy} disabled={noneTaken} onClick={() => send(chatFeedOf(draft, picked, own))}>
          Save for this chat
        </Button>
        <Button variant="secondary" disabled={busy || props.row.chat === null} onClick={() => send(null)}>
          Use the world's
        </Button>
      </div>
    </div>
  );
}

/** The chat's sections; each opens its settings as a page of its own, at its top. */
export function FeedThisChat(props: { chatId: string; controls: ControlsView | null }) {
  const pages = usePages<string>();
  const rows = props.controls?.sections ?? [];
  if (rows.length === 0) return <Empty icon="scroll">Section settings appear once the chat has started.</Empty>;
  const row = rows.find((r) => r.id === pages.page);
  return (
    <div ref={pages.host.ref} class="lre-gm-pages" onKeyDown={pages.host.onKeyDown} data-lre-gm-feed>
      <div class="lre-stack lre-gm-list" hidden={row !== undefined}>
        <span class="lre-small lre-muted">What goes into each section the narrator reads in this chat. A change is a GM edit with its own Undo; the world's settings are in Build → Sections.</span>
        <Section flush>
          <List>
            {rows.map((r) => (
              <ListRow key={r.id} icon="scroll" title={r.label} subtitle={`${r.chat ? "This chat" : "The world's"}: ${feedSummary(r.chat ?? r.world)}`} chevron onClick={() => pages.open(r.id)} />
            ))}
          </List>
        </Section>
      </div>
      {row ? (
        <GmPage name="section" title={row.label} subtitle="Section, this chat" backLabel="Sections" onBack={pages.back}>
          <SectionFeedForm key={row.id} chatId={props.chatId} row={row} sources={props.controls?.sources ?? []} onDone={pages.back} />
        </GmPage>
      ) : null}
    </div>
  );
}

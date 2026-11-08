// GM → Depth → Drafts (DEPTH-PLAN §4.6, §7): every off-screen draft on this chat's chain, newest
// first, as the fold reads it here: open, settled or dropped, and stale where an open one read
// something that has changed since (someone's mind, the notebook). A draft opens as a page: its
// episode (when, how long, where, who, why), each part's treatment with the author's grade, its beats
// dated when they happen with who perceived them, the world changes it would make, whom it holds from
// when, the reply it was drafted at, its pins, the author's thinking, and its settlement or drop with
// his reasoning. On an open draft: Settle now, Drop and Re-draft, the player's own presses, which run
// whatever the ceilings. Nothing is withheld (§1.4, D-9). The body is hook-free; `DraftsView` holds
// the requests.

import { useEffect, useState } from "preact/hooks";
import { DEPTH_TREATMENT_LABEL } from "../../shared/depth-settings";
import { DEPTH_DRAFT_STATE_LABEL, type DepthAt, type DepthDraft, type DepthDraftsView, type DepthDraftState } from "../../shared/depth-views";
import type { MessageId } from "../../shared/ids";
import { useApp } from "../app";
import { Badge, Banner, Button, Disclosure, Empty, List, ListRow, Section, useBusy } from "../components";
import { ActionRow, ActionRows, GmCard, GmPage } from "../gm/ui";
import type { GmSectionProps } from "../registry";

const STATE_TONE: Readonly<Record<DepthDraftState, "accent" | "pos" | "neutral">> = { open: "accent", settled: "pos", dropped: "neutral" };

/** What the Drafts view's controls do. */
export interface DraftsControls {
  busy: boolean;
  /** The draft open as a page; null for the list. */
  open: string | null;
  onOpen(id: string | null): void;
  /** The author reads the open draft against everything since its time now, and settles, drops or redrafts it. */
  onSettle(id: string): void;
  /** Your verdict that the open draft won't happen. */
  onDrop(id: string): void;
  /** The open draft dropped, and its episode drafted again from where the story is now. */
  onRedraft(id: string): void;
  onJump(messageId: MessageId): void;
}

/** A draft's state as its badges say it: open, settled or dropped, and stale where an open one read what has changed since. */
function StateBadges(props: { draft: DepthDraft }) {
  const { draft } = props;
  return (
    <span class="lre-gm-badges">
      <Badge tone={STATE_TONE[draft.state]}>{DEPTH_DRAFT_STATE_LABEL[draft.state]}</Badge>
      {draft.state === "open" && draft.changed.length > 0 ? <Badge tone="warn">Stale</Badge> : null}
    </span>
  );
}

/** The reply a record rides at, with a jump to it. */
function AtLine(props: { label: string; at: DepthAt; onJump(id: MessageId): void }) {
  return (
    <div class="lre-depth-at">
      <span class="lre-small lre-muted">{`${props.label} message ${props.at.index}`}</span>
      <Button size="sm" variant="ghost" icon="external" label={`Go to message ${props.at.index}`} onClick={() => props.onJump(props.at.messageId)}>
        Go to the message
      </Button>
    </div>
  );
}

/** The author's thinking, folded. */
function Thinking(props: { text: string }) {
  return (
    <Disclosure summary="The author's thinking">
      <p class="lre-depth-reasoning">{props.text.trim() === "" ? "No thinking was kept." : props.text}</p>
    </Disclosure>
  );
}

/** One draft as a page over the list. */
function DraftPage(props: { draft: DepthDraft; c: DraftsControls }) {
  const { draft: d, c } = props;
  const open = d.state === "open";
  return (
    <GmPage name="depth-draft" title={d.summary} subtitle={d.at} backLabel="Drafts" onBack={() => c.onOpen(null)}>
      <div class="lre-stack lre-depth-draft" data-lre-depth-draft={d.id}>
        <div class="lre-depth-at">
          <StateBadges draft={d} />
        </div>
        <AtLine label="Drafted at" at={d.basis} onJump={c.onJump} />
        {open && d.changed.length > 0 ? (
          <Banner tone="warn" title="Stale">
            {`What it read has changed since it was drafted: ${d.changed.join(", ")}. The author reads it as stale when it settles it.`}
          </Banner>
        ) : null}
        {open ? (
          <div class="lre-stack" data-lre-depth-draft-actions>
            <div class="lre-inline">
              <Button variant="primary" icon="check" busy={c.busy} onClick={() => c.onSettle(d.id)}>
                Settle now
              </Button>
              <Button icon="refresh" disabled={c.busy} onClick={() => c.onRedraft(d.id)}>
                Re-draft
              </Button>
              <Button variant="ghost" icon="trash" disabled={c.busy} onClick={() => c.onDrop(d.id)}>
                Drop
              </Button>
            </div>
            <p class="lre-small lre-muted lre-depth-note">{`Settle now: the author reads it against everything since its time (${d.pins} ${d.pins === 1 ? "beat" : "beats"} so far), as the poll does, and settles, drops or redrafts it. Re-draft: dropped, and drafted again from where the story is now. Drop: your verdict that it won't happen.`}</p>
          </div>
        ) : null}
        {d.settle ? (
          <div data-lre-depth-draft-settle>
            <GmCard title={`Settled at message ${d.settle.index}`} subtitle={`${d.settle.beats} ${d.settle.beats === 1 ? "beat" : "beats"} made canon, read against ${d.pins} ${d.pins === 1 ? "pin" : "pins"}`}>
              <p class="lre-depth-reasoning">{d.settle.why.trim() === "" ? "No reason was given." : d.settle.why}</p>
              <Thinking text={d.settle.reasoning} />
              <div class="lre-inline">
                <Button size="sm" variant="ghost" icon="external" label={`Go to message ${d.settle.index}`} onClick={() => c.onJump(d.settle?.messageId ?? d.basis.messageId)}>
                  Go to the message
                </Button>
              </div>
            </GmCard>
          </div>
        ) : null}
        {d.drop ? (
          <div data-lre-depth-draft-drop>
            <GmCard title={`Dropped at message ${d.drop.index}`}>
              <p class="lre-depth-reasoning">{d.drop.why.trim() === "" ? "No reason was given." : d.drop.why}</p>
              <Thinking text={d.drop.reasoning} />
              <div class="lre-inline">
                <Button size="sm" variant="ghost" icon="external" label={`Go to message ${d.drop.index}`} onClick={() => c.onJump(d.drop?.messageId ?? d.basis.messageId)}>
                  Go to the message
                </Button>
              </div>
            </GmCard>
          </div>
        ) : null}
        <Section title="The episode" flush>
          <ActionRows label="The episode">
            <ActionRow title="When" subtitle={d.span} />
            <ActionRow title="Where" subtitle={d.places.join(", ") || "Nowhere named"} />
            <ActionRow title="Who" subtitle={d.people.join(", ") || "No one named"} />
            <ActionRow title="Why it matters" subtitle={d.why.trim() || "No reason was given."} />
          </ActionRows>
        </Section>
        <Section title="Treatments" flush>
          <ActionRows label="Each part's treatment, with the author's grade">
            {d.parts.map((p, i) => (
              <ActionRow key={i} title={p.subject} subtitle={p.rationale.trim() || "No reason was given."} value={DEPTH_TREATMENT_LABEL[p.treatment]} />
            ))}
          </ActionRows>
        </Section>
        <Section title={`Beats (${d.beats.length})`}>
          {d.beats.length === 0 ? (
            <p class="lre-small lre-muted">No beats.</p>
          ) : (
            <ol class="lre-depth-draft-beats" data-lre-depth-draft-beats>
              {d.beats.map((b, i) => (
                <li key={i} class="lre-depth-draft-beat">
                  <span class="lre-small lre-muted">{`${b.at} · ${b.perceived.length > 0 ? `perceived by ${b.perceived.join(", ")}` : "no one perceived it"}`}</span>
                  <p class="lre-depth-reasoning">{b.what}</p>
                  {b.surface.trim() !== "" && b.surface !== b.what ? <p class="lre-depth-snippet">{`What there was to sense: ${b.surface}`}</p> : null}
                  {b.quotes ? <p class="lre-depth-quote">{`“${b.quotes}”`}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </Section>
        <Section title="What it would change">
          {d.effects.length === 0 ? (
            <p class="lre-small lre-muted">Nothing in the world.</p>
          ) : (
            <ul class="lre-depth-notes">
              {d.effects.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Whom and what it holds">
          {d.holds.length === 0 ? (
            <p class="lre-small lre-muted">No one.</p>
          ) : (
            <ul class="lre-depth-notes">
              {d.holds.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
          {open ? <p class="lre-small lre-muted lre-depth-note">Until it settles or is dropped, no one plays or catches up past it from these times.</p> : null}
        </Section>
        <Thinking text={d.reasoning} />
      </div>
    </GmPage>
  );
}

/** GM → Depth → Drafts' body, hook-free. */
export function DraftsBody(props: { view: DepthDraftsView; c: DraftsControls }) {
  const { view, c } = props;
  if (c.open !== null) {
    const draft = view.drafts.find((d) => d.id === c.open);
    if (draft) return <DraftPage draft={draft} c={c} />;
    return (
      <GmPage name="depth-draft" title="Draft" backLabel="Drafts" onBack={() => c.onOpen(null)}>
        <Empty icon="file">This draft is no longer on this chat's chain.</Empty>
      </GmPage>
    );
  }
  if (!view.on && view.drafts.length === 0) {
    return (
      <Empty icon="layers" title="This chat doesn't run on depth">
        Opt in at GM → This chat → Depth: after each turn the author's poll then drafts what happens off screen.
      </Empty>
    );
  }
  const open = view.drafts.filter((d) => d.state === "open").length;
  return (
    <div class="lre-stack lre-depth-drafts" data-lre-depth-drafts>
      <p class="lre-small lre-muted lre-depth-note">What the author drafted off screen: the world beyond your view, played at each part's treatment. A draft isn't canon until it settles; you may settle, drop or redraft an open one.</p>
      <Section title={open > 0 ? `Drafts (${view.drafts.length}, ${open} open)` : `Drafts (${view.drafts.length})`} flush>
        {view.drafts.length === 0 ? (
          <Empty icon="file">No drafts yet. After each turn the author's poll opens an episode off screen where the world must move beyond your view.</Empty>
        ) : (
          <List>
            {view.drafts.map((d) => (
              <ListRow key={d.id} title={d.summary} subtitle={[d.at, d.people.join(", ")].filter((s) => s !== "").join(" · ")} badge={<StateBadges draft={d} />} chevron onClick={() => c.onOpen(d.id)} />
            ))}
          </List>
        )}
      </Section>
    </div>
  );
}

/** GM → Depth → Drafts: the drafts read again when the chat moves on; Settle now and Re-draft go on in the background, and the view reads them again once they land. `opening`: a draft a link asked to open (Settled off screen's Read), opened as its page each time it is asked. */
export function DraftsView(props: { section: GmSectionProps; opening?: { draft: string } | null }) {
  const { section, opening } = props;
  const app = useApp();
  const [view, setView] = useState<DepthDraftsView | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(opening?.draft ?? null);
  useEffect(() => {
    if (opening) setOpen(opening.draft);
  }, [opening]);
  const [busy, run] = useBusy();
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    void app.request<"lre.depth">({ type: "lre.depth", chatId: section.chatId, op: "drafts" }).then((result) => {
      if (live) setView(result?.drafts ?? null);
    });
    return () => {
      live = false;
    };
  }, [section.chatId, section.reloadKey, nonce]);
  if (view === undefined) return <Empty icon="hourglass">Reading the drafts…</Empty>;
  if (view === null) return <Empty icon="file">The drafts couldn't be read.</Empty>;
  /** One of the player's presses on an open draft: what it did, said, then the drafts read again. */
  const press = async (op: "draft_settle" | "draft_drop" | "draft_redraft", draft: string): Promise<void> => {
    const result = await app.request<"lre.depth">({ type: "lre.depth", chatId: section.chatId, op, draft });
    if (!result) return;
    app.toast([...(result.said ?? []), ...(result.pending ? ["It lands once the reply being written is kept."] : [])].join(" ") || "Done.", "info");
    setNonce((k) => k + 1);
  };
  const c: DraftsControls = {
    busy,
    open,
    onOpen: setOpen,
    onSettle: (id) => run(() => press("draft_settle", id)),
    onRedraft: (id) => run(() => press("draft_redraft", id)),
    onDrop: (id) =>
      run(async () => {
        if (await app.host.confirm("Drop this draft", "Your verdict that it won't happen: its beats never become canon, and the author reads your drop beside its own. A swipe of this reply takes it back.", "warning", "Drop")) await press("draft_drop", id);
      }),
    onJump: (messageId) => {
      if (!app.host.revealMessage(messageId)) app.toast("That message isn't on screen in this chat.", "info");
    },
  };
  return <DraftsBody view={view} c={c} />;
}

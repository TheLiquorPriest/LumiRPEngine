// GM → Minds on a depth chat (DEPTH-PLAN §4.4, §7): every character with a mind, and whose point of
// view the player drives (owner D-10: the player character has no agent, and the player may switch
// whom he plays). A character opens as a page: its mind files (core, self, now, on my mind,
// memories, beliefs, people, plans), each yours to edit (an edit is a directive its agent never
// rewrites); every write its agent made, newest first, with its reasoning, the beats it lived and
// what it changed; its working memory (each private take from its plays that it hasn't remembered
// yet, which its next plays read); its beliefs beside the truth with the GM's links; the points of
// view it received and those still waiting; the effort it played at, scene by scene; and Interview,
// with every interview kept. Nothing is hidden (§1.4, D-9). A chat that hasn't opted into depth shows
// today's Minds (`GmMindsSection`). Bodies are hook-free, so tests press what they render; the
// sections hold the requests.

import { useEffect, useId, useState } from "preact/hooks";
import { DEPTH_ASKER_LABEL, DEPTH_EFFORT_LABEL, DEPTH_WRITE_LABEL, type DepthInterview, type DepthMindsView, type DepthMindView, mindFileLabel, mindFileOrder } from "../../shared/depth-views";
import type { EntityId, MessageId } from "../../shared/ids";
import { GmMindsSection } from "../../packs/minds/ui/gm";
import { useApp } from "../app";
import { Badge, Button, Disclosure, Empty, Field, HostSwitch, List, ListRow, Section, Tabs, tabPanel, TextDiff, useBusy } from "../components";
import { ActionRow, ActionRows, GmCard, GmPage, useGmFocus } from "../gm/ui";
import { markdown } from "../markdown";
import type { GmSectionProps } from "../registry";

/** A mind page's tabs. */
export const MIND_TABS = ["files", "writes", "takes", "beliefs", "povs", "effort", "interview"] as const;
export type MindTab = (typeof MIND_TABS)[number];

const MIND_TAB_LABEL: Readonly<Record<MindTab, string>> = { files: "Files", writes: "Writes", takes: "Working memory", beliefs: "Beliefs", povs: "Seen", effort: "Effort", interview: "Interview" };

const VERDICT: Readonly<Record<DepthMindView["beliefs"][number]["verdict"], { label: string; tone: "pos" | "neg" | "warn" | "neutral" }>> = {
  true: { label: "True", tone: "pos" },
  false: { label: "False", tone: "neg" },
  partly: { label: "Partly true", tone: "warn" },
  unlinked: { label: "Not linked yet", tone: "neutral" },
};

/** The Minds list: whose point of view you play (Play as isn't supported yet), then every character with a mind. */
export function MindsList(props: { view: DepthMindsView; onOpen(id: EntityId): void }) {
  const { view } = props;
  return (
    <div class="lre-stack lre-depth-minds" data-lre-depth-minds>
      <Section title="Your point of view">
        <p class="lre-small lre-muted lre-depth-note">{view.pov ? `You play ${view.pov.name}. The player character has no agent: you drive him, and what reached him is what his scenes exposed him to.` : "No one is the player character yet."}</p>
      </Section>
      <Section title={`Minds (${view.characters.length})`} flush>
        {view.characters.length === 0 ? (
          <Empty icon="sparkle">No character has a mind yet. The bootstrap forms them from the history; on a new chat, the first scenes do.</Empty>
        ) : (
          <List>
            {view.characters.map((c) => (
              <ListRow
                key={c.id}
                id={c.id}
                title={c.name}
                subtitle={c.last ? `${c.files} ${c.files === 1 ? "file" : "files"} · last: ${mindFileLabel(c.last.path)}, ${c.last.at}` : "No writes yet"}
                value={c.effort ? DEPTH_EFFORT_LABEL[c.effort] : undefined}
                badge={
                  c.pending > 0 || c.review ? (
                    <span class="lre-gm-badges">
                      {c.pending > 0 ? <Badge tone="accent">{`${c.pending} to live`}</Badge> : null}
                      {c.review ? <Badge tone="warn">Core to review</Badge> : null}
                    </span>
                  ) : undefined
                }
                chevron
                onClick={() => props.onOpen(c.id)}
              />
            ))}
          </List>
        )}
      </Section>
    </div>
  );
}

/** A file being edited: its path and the draft. */
export interface MindDraft {
  path: string;
  text: string;
}

/** What the mind page's controls do. */
export interface MindControls {
  busy: boolean;
  tab: MindTab;
  onTab(tab: MindTab): void;
  draft: MindDraft | null;
  /** Starts editing a file, or (null) stops without saving. */
  onDraft(draft: MindDraft | null): void;
  onSave(draft: MindDraft): void;
  question: string;
  neutral: boolean;
  answer: DepthInterview | null;
  onQuestion(text: string): void;
  onNeutral(neutral: boolean): void;
  onAsk(): void;
  onJump(messageId: MessageId): void;
  /** Its agent lives the points of view waiting for it now. */
  onCatchUp(): void;
  /** Its agent reflects now. */
  onReflect(): void;
  onBack(): void;
}

/** A beat a write or a point of view cites, with a jump to its message, named by the chat's number for it. */
function BeatLine(props: { label: string; messageId?: MessageId; index?: number; onJump(id: MessageId): void }) {
  const { messageId, index } = props;
  return (
    <li class="lre-depth-beat">
      <span class="lre-depth-beat-text">{props.label}</span>
      {messageId ? (
        <Button size="sm" variant="ghost" icon="external" label={`Go to ${index !== undefined ? `message ${index}` : "the message"} of: ${props.label}`} onClick={() => props.onJump(messageId)}>
          {index !== undefined ? `Message ${index}` : "Message"}
        </Button>
      ) : null}
    </li>
  );
}

function FilesTab(props: { mind: DepthMindView; c: MindControls }) {
  const { mind, c } = props;
  const files = [...mind.files].sort((a, b) => mindFileOrder(a.path) - mindFileOrder(b.path) || a.path.localeCompare(b.path));
  if (files.length === 0) return <Empty icon="file">No mind files yet.</Empty>;
  return (
    <div class="lre-stack" data-lre-depth-files>
      {files.map((f) => {
        const editing = c.draft?.path === f.path ? c.draft : null;
        const core = f.path.endsWith("/core.md") || f.path === "core.md";
        return (
          <div key={f.path} data-lre-depth-file={f.path}>
            <GmCard
              title={mindFileLabel(f.path)}
              subtitle={[f.at ? `Written ${f.at}` : null, `${f.revisions} ${f.revisions === 1 ? "revision" : "revisions"}`].filter(Boolean).join(" · ")}
              badges={
                f.pinned || f.out || f.review ? (
                  <>
                    {f.pinned ? <Badge tone="accent">Your edit, pinned</Badge> : null}
                    {f.out ? <Badge tone="warn">{f.reflection ? "A reflection, out of mind" : "Out of mind"}</Badge> : null}
                    {f.review ? <Badge tone="warn">To review</Badge> : null}
                  </>
                ) : undefined
              }
            >
              {core ? <p class="lre-small lre-muted lre-depth-note">Who they are at root: read first, and never rewritten by their agent. Only you edit it.</p> : null}
              {f.out ? <p class="lre-small lre-muted lre-depth-note" data-lre-depth-out>Out of their mind and recall: it drew on a beat that went otherwise, and they haven't kept or rewritten it since. It stays here to read; your edit brings it back.</p> : null}
              {editing ? (
                <div class="lre-stack">
                  <Field label={`Edit ${mindFileLabel(f.path)}`}>
                    <textarea class="lre-input lre-depth-editor" rows={10} value={editing.text} disabled={c.busy} aria-label={`${mindFileLabel(f.path)}: text`} onInput={(event) => c.onDraft({ path: f.path, text: event.currentTarget.value })} />
                  </Field>
                  <p class="lre-small lre-muted lre-depth-note">Your edit is a directive: the file keeps your words, and its agent may remark on them but never rewrites them.</p>
                  <div class="lre-inline">
                    <Button variant="primary" icon="check" busy={c.busy} disabled={editing.text === f.text} onClick={() => c.onSave(editing)}>
                      Save
                    </Button>
                    <Button variant="ghost" disabled={c.busy} onClick={() => c.onDraft(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {f.text.trim() === "" ? <p class="lre-small lre-muted">Empty.</p> : markdown(f.text, "lre-depth-md")}
                  <div class="lre-inline">
                    <Button size="sm" icon="edit" disabled={c.busy || c.draft !== null} onClick={() => c.onDraft({ path: f.path, text: f.text })}>
                      Edit
                    </Button>
                    {f.review ? (
                      <Button size="sm" variant="ghost" icon="check" disabled={c.busy || c.draft !== null} onClick={() => c.onSave({ path: f.path, text: f.text })}>
                        Keep as it is
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
            </GmCard>
          </div>
        );
      })}
    </div>
  );
}

function WritesTab(props: { mind: DepthMindView; c: MindControls }) {
  const { mind, c } = props;
  if (mind.writes.length === 0) return <Empty icon="edit">Nothing written yet.</Empty>;
  return (
    <div class="lre-stack" data-lre-depth-writes>
      {mind.writes.map((w) => (
        <div key={w.id} data-lre-depth-write={w.id}>
          <GmCard title={`${DEPTH_WRITE_LABEL[w.mode]} · ${mindFileLabel(w.path)}`} subtitle={w.at} badges={w.superseded ? <Badge>Replaced by an amended beat</Badge> : undefined}>
            <Disclosure summary="Why they wrote it">
              <p class="lre-depth-reasoning">{w.reasoning.trim() === "" ? "No reasoning was given." : w.reasoning}</p>
            </Disclosure>
            {w.lived.length > 0 ? (
              <div class="lre-stack">
                <span class="lre-small lre-muted">{`From what they lived (${w.lived.length})`}</span>
                <ul class="lre-depth-beats">
                  {w.lived.map((b) => (
                    <BeatLine key={b.id} label={b.label} messageId={b.messageId} index={b.index} onJump={c.onJump} />
                  ))}
                </ul>
              </div>
            ) : null}
            {w.before === null ? markdown(w.text, "lre-depth-md") : <TextDiff before={w.before} after={w.text} named={{ before: "the file before", after: "this write" }} />}
          </GmCard>
        </div>
      ))}
    </div>
  );
}

function BeliefsTab(props: { mind: DepthMindView }) {
  const { mind } = props;
  if (mind.beliefs.length === 0) return <Empty icon="link">No belief linked to the world's truth yet. The GM links them after each scene, out of world.</Empty>;
  return (
    <div data-lre-depth-beliefs>
      <ActionRows label={`${mind.name}'s beliefs`}>
        {mind.beliefs.map((b, i) => (
          <ActionRow key={i} title={b.belief} subtitle={[b.truth ? `The truth: ${b.truth}` : null, b.why].filter(Boolean).join(" · ")} value={<Badge tone={VERDICT[b.verdict].tone}>{VERDICT[b.verdict].label}</Badge>} />
        ))}
      </ActionRows>
    </div>
  );
}

function PovsTab(props: { mind: DepthMindView; c: MindControls }) {
  const { mind, c } = props;
  if (mind.povs.length === 0) return <Empty icon="eye">Nothing has reached them yet.</Empty>;
  const ordered = [...mind.povs.filter((p) => p.pending), ...mind.povs.filter((p) => !p.pending)];
  return (
    <div class="lre-stack" data-lre-depth-povs>
      {ordered.map((p) => (
        <div key={p.beat.id} data-lre-depth-pov={p.beat.id}>
          <GmCard title={p.beat.label} subtitle={`${p.at} · ${p.reach === "whole" ? "Perceived whole" : "In part: their own view of it"}`} badges={p.pending ? <Badge tone="accent">Waiting to be lived</Badge> : undefined}>
            <p class="lre-depth-pov-text">{p.text}</p>
            {p.beat.messageId ? (
              <ul class="lre-depth-beats">
                <BeatLine label="Where it happened" messageId={p.beat.messageId} index={p.beat.index} onJump={c.onJump} />
              </ul>
            ) : null}
          </GmCard>
        </div>
      ))}
    </div>
  );
}

/** Its takes not yet remembered, in the order it played them: the private working memory its next plays read, until it remembers the scene. */
function TakesTab(props: { mind: DepthMindView; c: MindControls }) {
  const { mind, c } = props;
  if (mind.takes.length === 0) return <Empty icon="layers">Nothing in working memory: they have remembered every scene they played.</Empty>;
  return (
    <div class="lre-stack" data-lre-depth-takes>
      <p class="lre-small lre-muted lre-depth-note">{`${mind.name}'s private take on each moment they played, which their next plays read as the scene so far. Remembering the scene takes them up into a memory.`}</p>
      {mind.takes.map((t, i) => (
        <div key={i} data-lre-depth-take={i}>
          <GmCard title={t.at} subtitle={t.beat ? `Played: ${t.beat.label}` : "Let the moment pass"}>
            <p class="lre-depth-take-text">{t.text}</p>
            {t.beat || t.lived.length > 0 ? (
              <ul class="lre-depth-beats">
                {t.beat ? <BeatLine label={`Played: ${t.beat.label}`} {...(t.beat.messageId ? { messageId: t.beat.messageId } : {})} onJump={c.onJump} /> : null}
                {t.lived.map((b) => (
                  <BeatLine key={b.id} label={`Lived: ${b.label}`} {...(b.messageId ? { messageId: b.messageId } : {})} onJump={c.onJump} />
                ))}
              </ul>
            ) : null}
          </GmCard>
        </div>
      ))}
    </div>
  );
}

function EffortTab(props: { mind: DepthMindView }) {
  const { mind } = props;
  if (mind.efforts.length === 0) return <Empty icon="layers">They haven't played a scene yet.</Empty>;
  return (
    <div data-lre-depth-efforts>
      <ActionRows label={`${mind.name}'s effort, scene by scene`}>
        {mind.efforts.map((e, i) => (
          <ActionRow key={i} title={e.scene} subtitle={[e.at, e.why].filter(Boolean).join(" · ")} value={DEPTH_EFFORT_LABEL[e.effort]} />
        ))}
      </ActionRows>
    </div>
  );
}

function InterviewTab(props: { mind: DepthMindView; c: MindControls }) {
  const { mind, c } = props;
  return (
    <div class="lre-stack" data-lre-depth-interview>
      <p class="lre-small lre-muted lre-depth-note">{`Ask ${mind.name} something in voice. The answer comes from their own mind and stays a probe, unless you mark the question neutral to the world: asked in its own terms and revealing nothing they haven't lived. Only then may it join how they see themselves.`}</p>
      <Field label={`Ask ${mind.name}`}>
        <textarea class="lre-input" rows={3} value={c.question} disabled={c.busy} aria-label={`Your question to ${mind.name}`} onInput={(event) => c.onQuestion(event.currentTarget.value)} />
      </Field>
      <HostSwitch label="Neutral to the world" checked={c.neutral} disabled={c.busy} onChange={c.onNeutral} />
      <div class="lre-inline">
        <Button variant="primary" icon="send" busy={c.busy} disabled={c.question.trim() === ""} onClick={c.onAsk}>
          Ask
        </Button>
      </div>
      {c.answer ? (
        <div data-lre-depth-answer>
          <GmCard title={`${mind.name} answers`} badges={<Badge tone={c.answer.folded ? "accent" : "neutral"}>{c.answer.folded ? "Joined their self" : "Kept as a probe"}</Badge>}>
            <p class="lre-depth-answer-text">{c.answer.answer}</p>
          </GmCard>
        </div>
      ) : null}
      <h4 class="lre-depth-subhead">{`Every interview (${mind.interviews.length})`}</h4>
      {mind.interviews.length === 0 ? (
        <p class="lre-small lre-muted">No one has interviewed them yet.</p>
      ) : (
        mind.interviews.map((p, i) => (
          <div key={i} data-lre-depth-probe={i}>
            <GmCard title={p.question} subtitle={`${p.at} · ${DEPTH_ASKER_LABEL[p.by]}`} badges={<Badge tone={p.neutral ? "accent" : "neutral"}>{p.neutral ? "Joined their self" : "Kept as a probe"}</Badge>}>
              <p class="lre-depth-answer-text">{p.answer}</p>
            </GmCard>
          </div>
        ))
      )}
    </div>
  );
}

/** One character's mind as a page over the list, hook-free: `panelId` ties the tabs to their panel. */
export function MindPage(props: { mind: DepthMindView; c: MindControls; panelId: string }) {
  const { mind, c } = props;
  const pending = mind.povs.filter((p) => p.pending).length;
  const body =
    c.tab === "files" ? <FilesTab mind={mind} c={c} /> : c.tab === "writes" ? <WritesTab mind={mind} c={c} /> : c.tab === "takes" ? <TakesTab mind={mind} c={c} /> : c.tab === "beliefs" ? <BeliefsTab mind={mind} /> : c.tab === "povs" ? <PovsTab mind={mind} c={c} /> : c.tab === "effort" ? <EffortTab mind={mind} /> : <InterviewTab mind={mind} c={c} />;
  return (
    <GmPage
      name="depth-mind"
      title={mind.name}
      subtitle={`${mind.files.length} ${mind.files.length === 1 ? "file" : "files"} · ${mind.writes.length} ${mind.writes.length === 1 ? "write" : "writes"}`}
      backLabel="Minds"
      onBack={c.onBack}
      actions={
        <>
          <Button size="sm" icon="eye" busy={c.busy} disabled={pending === 0} onClick={c.onCatchUp}>
            {pending > 0 ? `Catch up (${pending})` : "Caught up"}
          </Button>
          <Button size="sm" variant="ghost" icon="sparkle" disabled={c.busy} onClick={c.onReflect}>
            Reflect now
          </Button>
        </>
      }
    >
      <div class="lre-stack lre-depth-mind" data-lre-depth-mind={mind.id}>
        <p class="lre-small lre-muted lre-depth-note">{`Written only by ${mind.name}'s own agent, from what they lived, and by you. Catch up has them live what reached them now; Reflect has them revise what they hold, rather than when the author judges.`}</p>
        <Tabs<MindTab> label={`${mind.name}'s mind`} panelId={props.panelId} value={c.tab} tabs={MIND_TABS.map((id) => ({ id, label: MIND_TAB_LABEL[id], ...(id === "povs" && pending > 0 ? { dot: true } : {}) }))} onChange={c.onTab} />
        <div {...tabPanel(props.panelId, c.tab)} class="lre-stack">
          {body}
        </div>
      </div>
    </GmPage>
  );
}

/** GM → Minds on a depth chat: the list and one character's page, read again when the chat moves on. */
export function MindsV2(props: { section: GmSectionProps; view: DepthMindsView; reload(): void }) {
  const { section } = props;
  const app = useApp();
  const chatId = section.chatId;
  const [busy, run] = useBusy();
  const [open, setOpen] = useState<EntityId | null>(null);
  const [mind, setMind] = useState<DepthMindView | null>(null);
  const [tab, setTab] = useState<MindTab>("files");
  const [draft, setDraft] = useState<MindDraft | null>(null);
  const [question, setQuestion] = useState("");
  const [neutral, setNeutral] = useState(false);
  const [answer, setAnswer] = useState<DepthInterview | null>(null);
  const panelId = useId();
  // A link from a character's sheet opens their mind here.
  useGmFocus((id) => setOpen(id));
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (open === null) return setMind(null);
    let live = true;
    void app.request<"lre.depth">({ type: "lre.depth", chatId, op: "mind", who: open }).then((result) => {
      if (live) setMind(result?.mind ?? null);
    });
    return () => {
      live = false;
    };
  }, [open, chatId, section.reloadKey, nonce]);
  /** Has their agent catch up or reflect now, then reads their mind again; one asked while a reply is written lands once it is kept. */
  const act = (op: "catch_up" | "reflect") =>
    run(async () => {
      if (open === null) return;
      const result = await app.request<"lre.depth">({ type: "lre.depth", chatId, op, who: open });
      if (!result) return;
      app.toast(result.pending ? "It lands once the reply being written is kept." : op === "catch_up" ? `Lived ${result.lived ?? 0} ${result.lived === 1 ? "point of view" : "points of view"}.` : "They reflected.", "info");
      setNonce((k) => k + 1);
      props.reload();
    });
  const c: MindControls = {
    busy,
    tab,
    onTab: setTab,
    draft,
    onDraft: setDraft,
    onSave: (d) =>
      run(async () => {
        if (open === null) return;
        const result = await app.request<"lre.depth">({ type: "lre.depth", chatId, op: "mind_edit", who: open, path: d.path, text: d.text });
        if (!result) return;
        setDraft(null);
        await section.changed(`Edited ${mindFileLabel(d.path)}`, { pending: result.pending, undo: result.undo ?? null });
      }),
    question,
    neutral,
    answer,
    onQuestion: setQuestion,
    onNeutral: setNeutral,
    onAsk: () =>
      run(async () => {
        if (open === null) return;
        const result = await app.request<"lre.depth">({ type: "lre.depth", chatId, op: "interview", who: open, question: question.trim(), neutral });
        if (result?.interview) setAnswer(result.interview);
        // The interview is kept: its page lists it with the others.
        setNonce((k) => k + 1);
      }),
    onJump: (messageId) => {
      if (!app.host.revealMessage(messageId)) app.toast("That message isn't on screen in this chat.", "info");
    },
    onCatchUp: () => act("catch_up"),
    onReflect: () => act("reflect"),
    onBack: () => {
      setOpen(null);
      setDraft(null);
      setAnswer(null);
      setQuestion("");
      setTab("files");
    },
  };
  if (open !== null) return mind ? <MindPage mind={mind} c={c} panelId={panelId} /> : <Empty icon="hourglass">Reading their mind…</Empty>;
  return <MindsList view={props.view} onOpen={setOpen} />;
}

/**
 * GM → Minds: a depth chat's minds (`MindsV2`), else today's (`GmMindsSection`), which keep running
 * on chats that haven't opted in (§9.2 A1).
 */
export function MindsSection(props: GmSectionProps) {
  const app = useApp();
  const [view, setView] = useState<DepthMindsView | null | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    void app.request<"lre.depth">({ type: "lre.depth", chatId: props.chatId, op: "minds" }).then((result) => {
      if (live) setView(result?.minds ?? null);
    });
    return () => {
      live = false;
    };
  }, [props.chatId, props.reloadKey, nonce]);
  if (view === undefined) return <Empty icon="hourglass">Reading the minds…</Empty>;
  return view?.on ? <MindsV2 section={props} view={view} reload={() => setNonce((k) => k + 1)} /> : <GmMindsSection {...props} />;
}

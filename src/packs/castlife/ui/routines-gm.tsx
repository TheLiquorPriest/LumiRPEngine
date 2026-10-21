// GM → Routines (DESIGN §8): every character's routine and schedules as this chat has them, behind
// the GM gate. The list marks whom this chat changed, by you or by the story (`lre.routine {op:
// "changed"}`); a character's page reads their day (`lre.routine {op: "day", view: "gm"}`): their
// routine's role and how much it binds them now, from their level's role or this chat's; their routine block
// by block, each with its source and whose it is; their schedules, with which owner wins; today as
// the planner laid it, with reasons; the invitations they made and received, with their grounds;
// and the changes the story made, with their turns. Each control (how they follow their routine and
// its role, one block, one schedule) is one `lre.edit`, so one Corrected chip with its Undo. A routine or a
// schedule is only ever a default: the story leads whoever shares a scene with the player. The
// world's own routines and schedules are Build's.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { EntityId, ScheduleId } from "../../../shared/ids";
import { nameOfId } from "../../../shared/maps";
import type { EditOp } from "../../../shared/protocol";
import type { EffectiveBlock, EffectiveSchedule, InvitationView, RoutineAwareness, RoutineBlock, RoutineBlockId, RoutineChangeSummary, RoutineGmView, RoutineMode, RoutineRole, SourceView } from "../../../shared/routines";
import { AWARENESS_LABEL, BLOCK_KIND_LABEL, isOff, ROUTINE_AWARENESS, ROUTINE_MODE_LABEL, ROUTINE_MODES, ROUTINE_ROLE_LABEL, ROUTINE_ROLES, routineSettingsOf, storySourceLabel } from "../../../shared/routines";
import type { GmView } from "../../../shared/state-view";
import type { ScheduleDef, WorldDoc } from "../../../shared/world";
import { useApp, useView } from "../../../frontend/app";
import { blankBlock, RoutineBlockForm } from "../../../frontend/build/routine-editor";
import { EVERY, ScheduleForm } from "../../../frontend/build/schedule-form";
import { deriveId } from "../../../frontend/build/schema";
import { Badge, Banner, Button, Empty, IdText, List, ListRow, NumberStepper, Section, Seg } from "../../../frontend/components";
import { nameOf } from "../../../frontend/gm/editor";
import { GmPage, usePages } from "../../../frontend/gm/ui";
import { Icon } from "../../../frontend/icons";
import type { GmSectionProps, Send } from "../../../frontend/registry";
import type { RoutineBinding, RoutineRow, StoryChange } from "./routines-ops";
import {
  AWARENESS_NOTE,
  BINDING_LABEL,
  bindingNote,
  bindingOf,
  blockDraft,
  blockOffOp,
  blockOp,
  blockWhen,
  CHANGED_LABEL,
  daysWords,
  dropBlockOp,
  dropScheduleOp,
  effectiveRole,
  followOp,
  HOLD_BY,
  invitationGround,
  MODE_NOTE,
  originWords,
  ownerWords,
  placeWords,
  ROLE_NOTE,
  routineRows,
  scheduleDraft,
  scheduleOffOp,
  scheduleOwnOp,
  scheduleRows,
  shadowWords,
  sourceWords,
  storyChanges,
  targetWords,
  TIER_LABEL,
  untilWords,
} from "./routines-ops";

type Tone = "neutral" | "accent" | "pos" | "neg" | "warn" | "gm";

/** A change to one character, each its own page over theirs; a block's `id` is null while adding one. */
export type RoutineChange = { kind: "follow" } | { kind: "block"; id: RoutineBlockId | null } | { kind: "schedule"; id: ScheduleId };

type Filter = "" | "changed" | RoutineBinding;

const BINDING_TONE: Record<RoutineBinding, Tone> = { routine: "neutral", story: "accent", none: "warn" };

interface Ctx {
  chatId: string;
  gm: GmView;
  busy: boolean;
  send: Send;
  edit(ops: EditOp[]): Promise<boolean>;
}

/** Sends one change; back to the page it came from once it is accepted. */
function sendOp(ctx: Ctx, op: EditOp, onDone: () => void): void {
  void ctx.edit([op]).then((ok) => {
    if (ok) onDone();
  });
}

/** A flush section's note where its rows would be. */
function None(props: { children: ComponentChildren }) {
  return <p class="lre-gm-routines-none">{props.children}</p>;
}

// ---------------------------------------------------------------- the list

export function GmRoutinesSection(props: GmSectionProps) {
  const app = useApp();
  const worldId = useView()?.worldId ?? null;
  const pages = usePages<EntityId>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("");
  const [changed, setChanged] = useState<RoutineChangeSummary[] | null>(null);
  // Read again whenever the GM view reloads: an edit, an Undo or a turn may have changed someone.
  useEffect(() => {
    let live = true;
    void props.send({ type: "lre.routine", chatId: props.chatId, op: "changed" }).then((m) => {
      if (live && m.type === "lre.result" && m.request === "lre.routine") setChanged(m.body.changed ?? []);
    });
    return () => {
      live = false;
    };
  }, [props.chatId, props.gm]);
  const ctx: Ctx = { chatId: props.chatId, gm: props.gm, busy: props.busy, send: props.send, edit: props.edit };
  // The world's roles for each level; until the world is read, the defaults stand in.
  const roles = routineSettingsOf(useChatWorld(props.send) ?? {}).roles;
  const rows = routineRows(props.gm.minds.characters, props.gm.entities, changed ?? [], roles);
  const page = pages.page;
  const selected = page === null ? undefined : rows.find((r) => r.entity === page);
  // Someone no longer among the characters (an Undo took back a spawn) gives way to the list.
  useEffect(() => {
    if (page !== null && selected === undefined) pages.back();
  });
  const q = query.trim().toLowerCase();
  const list = rows.filter((r) => (filter === "" || (filter === "changed" ? r.changed !== null : r.binding === filter)) && (q === "" || r.name.toLowerCase().includes(q)));
  const changedCount = rows.filter((r) => r.changed !== null).length;
  return (
    <div ref={pages.host.ref} class="lre-gm-pages" onKeyDown={pages.host.onKeyDown} data-lre-gm-section="routines">
      <div class="lre-stack lre-gm-list" hidden={selected !== undefined}>
        <Section flush>
          <List>
            <ListRow icon="clock" title="Now" value={props.gm.minds.nowText} />
            <ListRow icon="edit" title="Changed in this chat" subtitle="By you or by the story" value={changed === null ? "…" : String(changedCount)} />
          </List>
          <p class="lre-gm-routines-intro">A routine or a schedule is never a script. By default it only informs: the story and planning decide what people do, and only Background characters keep an enforced routine. Even then the story leads whoever shares a scene with you, and no routine interrupts play. What you change here is this chat's alone; each change has its own Undo.</p>
          {worldId ? (
            <div class="lre-gm-routines-build">
              <Button size="sm" variant="ghost" icon="hammer" onClick={() => app.ui.update((ui) => ({ ...ui, mode: "build", build: { view: "collection", worldId, collection: "routines" } }))}>
                The world's routines are in Build
              </Button>
            </div>
          ) : null}
        </Section>
        <div class="lre-gm-tools">
          <label class="lre-gm-search">
            <Icon name="search" size={16} />
            <input class="lre-input" type="search" aria-label="Search by name" placeholder="Search by name" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
          </label>
          <select class="lre-input" aria-label="Show" value={filter} onChange={(event) => setFilter(event.currentTarget.value as Filter)}>
            <option value="">Everyone</option>
            <option value="changed">Changed in this chat</option>
            <option value="routine">{BINDING_LABEL.routine}</option>
            <option value="story">{BINDING_LABEL.story}</option>
            <option value="none">{BINDING_LABEL.none}</option>
          </select>
        </div>
        <Section title={`${list.length} of ${rows.length}`} flush>
          {rows.length === 0 ? <Empty icon="users">No characters yet.</Empty> : list.length === 0 ? <Empty icon="search">No one matches.</Empty> : <CharacterRows rows={list} onOpen={pages.open} />}
        </Section>
      </div>
      {selected ? <CharacterPages key={selected.entity} ctx={ctx} row={selected} summary={changed?.find((s) => s.entity === selected.entity)} onBack={pages.back} /> : null}
    </div>
  );
}

/** The characters as rows: their fidelity, how much their routine binds them, and a badge when this chat changed their routine or schedules. */
export function CharacterRows(props: { rows: readonly RoutineRow[]; onOpen(entity: EntityId): void }) {
  return (
    <div data-lre-gm-list="routines">
      <List>
        {props.rows.map((r) => (
          <ListRow
            key={r.entity}
            id={r.entity}
            title={r.name}
            subtitle={
              <span class="lre-gm-routines-sub">
                <span>{BINDING_LABEL[r.binding]}</span>
                {r.changed ? <Badge tone="gm">{CHANGED_LABEL[r.changed]}</Badge> : null}
              </span>
            }
            badge={<Badge tone={r.tier === "live" ? "accent" : "neutral"}>{TIER_LABEL[r.tier]}</Badge>}
            chevron
            onClick={() => props.onOpen(r.entity)}
          />
        ))}
      </List>
    </div>
  );
}

// ---------------------------------------------------------------- a character's page

/**
 * A character's page and the change open over it. To the list's pages this is one page (it carries
 * `lre-gm-page`, so opening it focuses its Back); inside, it hosts the change pages the same way, so
 * Back or Escape on a change returns to the row that opened it, and Escape here goes to the list.
 */
function CharacterPages(props: { ctx: Ctx; row: RoutineRow; summary: RoutineChangeSummary | undefined; onBack(): void }) {
  const { ctx, row } = props;
  const changes = usePages<RoutineChange>();
  const [view, setView] = useState<RoutineGmView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read again whenever the GM view reloads, so an edit or its Undo shows at once.
  useEffect(() => {
    let live = true;
    void ctx.send({ type: "lre.routine", chatId: ctx.chatId, op: "day", entity: row.entity, view: "gm" }).then((m) => {
      if (!live) return;
      if (m.type === "lre.error") return setError(m.message);
      if (m.request !== "lre.routine") return;
      setError(null);
      setView(m.body.gm ?? null);
    });
    return () => {
      live = false;
    };
  }, [ctx.chatId, row.entity, ctx.gm]);
  const change = changes.page;
  const block = change?.kind === "block" && change.id !== null ? view?.blocks.find((b) => b.block.id === change.id) : undefined;
  const schedule = change?.kind === "schedule" ? view?.schedules.find((s) => s.schedule === change.id) : undefined;
  // A block or schedule they no longer have (an Undo took back a block the chat added) takes its page with it.
  const gone = view !== null && change !== null && ((change.kind === "block" && change.id !== null && block === undefined) || (change.kind === "schedule" && schedule === undefined));
  useEffect(() => {
    if (gone) changes.back();
  });
  // A removed block's row can't take focus back: keep it on this page rather than lose it.
  const was = useRef(change);
  useEffect(() => {
    const before = was.current;
    was.current = change;
    const root = changes.host.ref.current;
    if (before === null || change !== null || !root || root.contains(document.activeElement)) return;
    root.querySelector<HTMLElement>(".lre-page-header button")?.focus();
  }, [change]);
  const binding = view ? bindingOf(view.follow.role, view.follow.mode, view.planned) : row.binding;
  return (
    <div ref={changes.host.ref} class="lre-gm-page lre-gm-pages lre-gm-routines-pages" onKeyDown={changes.host.onKeyDown}>
      <div class="lre-gm-list" hidden={change !== null}>
        <GmPage
          name="routine"
          title={row.name}
          subtitle={
            <>
              {TIER_LABEL[row.tier]} · {BINDING_LABEL[binding]}
              <IdText id={row.entity} />
            </>
          }
          backLabel="Routines"
          onBack={props.onBack}
        >
          {error ? (
            <Banner tone="neg" title="Their routine couldn't be read">
              {error}
            </Banner>
          ) : null}
          {view ? <RoutineSections view={view} gm={ctx.gm} summary={props.summary} busy={ctx.busy} open={changes.open} /> : error ? null : <None>Reading their routine…</None>}
        </GmPage>
      </div>
      {view && change?.kind === "follow" ? <FollowPage ctx={ctx} view={view} onBack={changes.back} /> : null}
      {view && change?.kind === "block" && (change.id === null || block) ? <BlockPage key={change.id ?? ""} ctx={ctx} view={view} block={block ?? null} onBack={changes.back} /> : null}
      {view && change?.kind === "schedule" && schedule ? <SchedulePage key={change.id} ctx={ctx} view={view} schedule={schedule} onBack={changes.back} /> : null}
    </div>
  );
}

/** Everything the GM reads of one character's routine, in the page's order; `summary` is what this chat changed of them (`changed`), the story's changes listed from it; `open` opens a change over it. */
export function RoutineSections(props: { view: RoutineGmView; gm: GmView; summary: RoutineChangeSummary | undefined; busy: boolean; open(change: RoutineChange): void }) {
  const { view, gm, busy, open } = props;
  return (
    <div class="lre-gm-routines" data-lre-gm-routine={view.entity}>
      <BindingSection view={view} busy={busy} open={open} />
      <StoryHolds view={view} now={gm.minds.now} />
      <Blocks view={view} gm={gm} busy={busy} open={open} />
      <Schedules view={view} now={gm.minds.now} busy={busy} open={open} />
      <Today view={view} gm={gm} />
      <Invitations view={view} />
      <StoryMade changes={storyChanges(view, props.summary)} now={gm.minds.now} busy={busy} open={open} />
    </div>
  );
}

/** What their routine is to the engine now and how much it binds them, why, and how they follow it in this chat. */
function BindingSection(props: { view: RoutineGmView; busy: boolean; open(change: RoutineChange): void }) {
  const { view } = props;
  const binding = bindingOf(view.follow.role, view.follow.mode, view.planned);
  const chat = view.follow.chat;
  return (
    <Section title="How much their routine binds them" aside={<Badge tone={BINDING_TONE[binding]}>{BINDING_LABEL[binding]}</Badge>} flush>
      <div class="lre-gm-routines-binding" data-lre-binding={binding}>
        {bindingNote(view).map((line) => (
          <p key={line} class="lre-gm-note">
            {line}
          </p>
        ))}
      </div>
      <List>
        <ListRow icon="users" title="Fidelity now" subtitle="From the minds ladder: Near and Live are the cast on screen" value={view.tier ? TIER_LABEL[view.tier] : "No minds"} />
        <ListRow icon="sliders" title="In this chat" subtitle={chat?.mode ? "Set for them in this chat" : "As the world has it"} value={ROUTINE_MODE_LABEL[view.follow.mode]} chevron disabled={props.busy} onClick={() => props.open({ kind: "follow" })} />
        <ListRow icon="route" title="Their routine's role" subtitle={chat?.role ? "Set for them in this chat" : "Their level's default"} value={ROUTINE_ROLE_LABEL[view.follow.role]} chevron disabled={props.busy} onClick={() => props.open({ kind: "follow" })} />
        <ListRow icon="book" title="Story and lore awareness" subtitle={chat?.awareness ? "Set for them in this chat" : "The world's setting"} value={AWARENESS_LABEL[view.follow.awareness]} chevron disabled={props.busy} onClick={() => props.open({ kind: "follow" })} />
      </List>
    </Section>
  );
}

/** What the story established about them now, which their routine yields to. */
function StoryHolds(props: { view: RoutineGmView; now: number }) {
  const { story } = props.view;
  return (
    <Section title="What the story holds now" flush>
      {story.length === 0 ? <None>Nothing the story set holds them now.</None> : null}
      <List>
        {story.map((h, i) => (
          <ListRow key={`${h.field}:${i}`} icon="flag" title={h.label} subtitle={`${HOLD_BY[h.by]} · ${untilWords(h.until, props.now)}`} />
        ))}
      </List>
    </Section>
  );
}

/** Their effective routine, block by block: when and where, whose it is and what it rests on, and what it replaces. */
function Blocks(props: { view: RoutineGmView; gm: GmView; busy: boolean; open(change: RoutineChange): void }) {
  const { view, gm } = props;
  return (
    <Section title="Their routine" aside={<Badge>{view.blocks.filter((b) => !b.off).length} blocks</Badge>} flush>
      {view.blocks.length === 0 ? <None>No routine blocks: their day is the story, their commitments and their basic needs.</None> : null}
      <div data-lre-gm-list="routine-blocks">
        <List>
          {view.blocks.map((b) => (
            <ListRow
              key={b.block.id}
              id={b.block.id}
              title={isOff(b.block) || b.off ? nameOfId(b.block.id) : b.block.label}
              subtitle={
                <span class="lre-gm-routines-lines">
                  {isOff(b.block) || b.off ? <span>Off for them</span> : <span>{[blockWhen(b.block), daysWords(b.block), placeWords(b.block.place, (id) => nameOf(gm, id))].filter((part) => part !== null).join(" · ")}</span>}
                  <span>
                    {b.owner.level === "builtin" ? ownerWords(b.owner) : `${ownerWords(b.owner)} · ${sourceWords(b.source, gm.minds.now)}`}
                  </span>
                  {shadowWords(b) ? <span>{shadowWords(b)}</span> : null}
                </span>
              }
              badge={isOff(b.block) || b.off ? <Badge tone="warn">Off</Badge> : <Badge tone={b.owner.level === "chat" ? "gm" : "neutral"}>{BLOCK_KIND_LABEL[b.block.kind]}</Badge>}
              chevron
              disabled={props.busy}
              onClick={() => props.open({ kind: "block", id: b.block.id })}
            />
          ))}
          <ListRow icon="plus" title="Add a block for this chat" disabled={props.busy} onClick={() => props.open({ kind: "block", id: null })} />
        </List>
      </div>
    </Section>
  );
}

/** A schedule's change in this chat, in words. */
function chatScheduleWords(chat: NonNullable<EffectiveSchedule["chat"]>, now: number): string {
  return "off" in chat ? `Off for them ${untilWords(chat.until, now)}` : "Their own version in this chat";
}

/** Their schedules, the most specific owner first for each thing a schedule sets: whose each is, what it rests on, and whether it is in force. */
function Schedules(props: { view: RoutineGmView; now: number; busy: boolean; open(change: RoutineChange): void }) {
  const rows = scheduleRows(props.view);
  return (
    <Section title="Their schedules" flush>
      {rows.length === 0 ? <None>No schedules apply to them.</None> : <None>For each thing schedules set, the most specific owner wins where both run: a change in this chat, their own, a group's, a kind's, then a selector's.</None>}
      <div data-lre-gm-list="routine-schedules">
        <List>
          {rows.map(({ schedule: s, over }) => (
            <ListRow
              key={s.schedule}
              id={s.schedule}
              icon="calendar"
              title={nameOfId(s.schedule)}
              subtitle={
                <span class="lre-gm-routines-lines">
                  <span>
                    Sets {targetWords(s.target)} · {EVERY[s.recurrence.every]}
                  </span>
                  <span>
                    {ownerWords(s.owner)} · {sourceWords(s.source, props.now)}
                  </span>
                  {over.length > 0 ? <span>Shadowed where {over.map(nameOfId).join(", ")} also run</span> : null}
                  {s.chat ? (
                    <span>
                      {chatScheduleWords(s.chat, props.now)} · {sourceWords(s.chat.source, props.now)}
                    </span>
                  ) : null}
                </span>
              }
              badge={s.chat ? <Badge tone="gm">{"off" in s.chat ? "Off here" : "Changed here"}</Badge> : over.length > 0 ? <Badge>Shadowed</Badge> : <Badge tone="pos">In force</Badge>}
              chevron
              disabled={props.busy}
              onClick={() => props.open({ kind: "schedule", id: s.schedule })}
            />
          ))}
        </List>
      </div>
    </Section>
  );
}

/** Today as the planner laid it: each block with where, why it is there, and the reasons it gave. */
function Today(props: { view: RoutineGmView; gm: GmView }) {
  const { view, gm } = props;
  const name = (id: string) => gm.tracks.find((t) => t.id === id)?.label ?? nameOf(gm, id);
  return (
    <Section title={`Today, ${view.day.label}`} flush>
      {!view.planned ? <None>The planner doesn't lay their day.</None> : view.day.blocks.length === 0 ? <None>Nothing laid for today yet.</None> : null}
      <div data-lre-gm-list="routine-day">
        <List>
          {view.day.blocks.map((b, i) => (
            <ListRow
              key={`${b.start}:${i}`}
              title={
                <span class="lre-gm-routines-slot">
                  <span class="lre-gm-routines-time">
                    {b.from}–{b.to}
                  </span>
                  <span>{b.label}</span>
                </span>
              }
              subtitle={
                <span class="lre-gm-routines-lines">
                  {b.placeName ? <span>At {b.placeName}</span> : null}
                  <span>{originWords(b.origin, name)}</span>
                  {b.reasons.length > 0 ? <span>{b.reasons.join(" · ")}</span> : null}
                </span>
              }
            />
          ))}
        </List>
      </div>
    </Section>
  );
}

function InvitationRow(props: { inv: InvitationView; made: boolean }) {
  const { inv } = props;
  return (
    <ListRow
      icon="message"
      title={inv.text}
      subtitle={
        <span class="lre-gm-routines-lines">
          <span>{[inv.when, inv.placeName, props.made ? null : `From ${inv.hostName}`].filter((part) => part !== null).join(" · ")}</span>
          <span>{invitationGround(inv.origin)}</span>
        </span>
      }
      badge={<Badge tone={inv.status === "sent" ? "pos" : "neutral"}>{inv.status === "sent" ? "Sent" : "Planned"}</Badge>}
    />
  );
}

/** The invitations they made and received, each with where it came from. */
function Invitations(props: { view: RoutineGmView }) {
  const { made, received } = props.view.invitations;
  return (
    <Section title="Invitations" flush>
      {made.length + received.length === 0 ? <None>None made or received.</None> : null}
      {made.length > 0 ? (
        <>
          <div class="lre-gm-routines-head">Made</div>
          <List>
            {made.map((inv) => (
              <InvitationRow key={inv.key} inv={inv} made />
            ))}
          </List>
        </>
      ) : null}
      {received.length > 0 ? (
        <>
          <div class="lre-gm-routines-head">Received</div>
          <List>
            {received.map((inv) => (
              <InvitationRow key={inv.key} inv={inv} made={false} />
            ))}
          </List>
        </>
      ) : null}
    </Section>
  );
}

/**
 * The changes the story made to their routine and schedules in this chat, each with its turn. A tap
 * opens one in force to keep, change or drop; a block the story added is in force from the next day,
 * and its row says so until then.
 */
function StoryMade(props: { changes: StoryChange[]; now: number; busy: boolean; open(change: RoutineChange): void }) {
  return (
    <Section title="Changes the story made" flush>
      {props.changes.length === 0 ? <None>The story hasn't changed their routine or schedules in this chat.</None> : null}
      <div data-lre-gm-list="routine-story">
        <List>
          {props.changes.map((c) => {
            const block = c.kind === "block" ? c.block : null;
            // The story's block once in force; before then, the block it will replace, if any.
            const shown = block && !isOff(block.block) && !c.off ? block.block : null;
            const live = c.kind === "block" ? block?.owner.level === "chat" : c.schedule !== null;
            const what = c.kind === "schedule" ? (c.schedule?.chat ? chatScheduleWords(c.schedule.chat, props.now) : c.off ? "Off for them" : "Their own version in this chat") : c.off ? "Switched off for them" : live && shown ? blockWhen(shown) : "In force from the day after the story made it";
            return (
              <ListRow
                key={`${c.kind}:${c.id}`}
                id={c.id}
                icon={c.kind === "schedule" ? "calendar" : "clock"}
                title={shown?.label ?? (c.kind === "block" ? c.label : undefined) ?? nameOfId(c.id)}
                subtitle={
                  <span class="lre-gm-routines-lines">
                    <span>{what}</span>
                    <span>{sourceWords({ ...c.source, label: storySourceLabel(c.source) }, props.now)}</span>
                    {c.source.turn ? <IdText id={c.source.turn} /> : null}
                  </span>
                }
                chevron={live}
                disabled={props.busy}
                onClick={live ? () => props.open(c.kind === "schedule" ? { kind: "schedule", id: c.id } : { kind: "block", id: c.id }) : undefined}
              />
            );
          })}
        </List>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- the change pages

/** A change's page over the character's: their name under its title, Back to them. */
function ChangePage(props: { name: string; title: string; view: RoutineGmView; onBack(): void; children: ComponentChildren }) {
  return (
    <GmPage name={props.name} title={props.title} subtitle={props.view.name} backLabel={props.view.name} onBack={props.onBack}>
      {props.children}
    </GmPage>
  );
}

/** The page's one primary button, and why it can't save yet. */
function Submit(props: { busy: boolean; ready: boolean; problems?: readonly string[]; children: string }) {
  return (
    <div class="lre-gm-routines-submit">
      <Button type="submit" variant="primary" icon="check" block disabled={props.busy || !props.ready}>
        {props.children}
      </Button>
      {(props.problems ?? []).map((p) => (
        <p key={p} class="lre-gm-note">
          {p}
        </p>
      ))}
    </div>
  );
}

/** One choice of a radio list, with what it means and whether it is the one now. */
interface Choice<T> {
  value: T;
  label: string;
  help: string;
  now: boolean;
}

function Choices<T extends string | null>(props: { legend: string; value: T; choices: readonly Choice<T>[]; disabled: boolean; onChange(value: T): void }) {
  const group = useId();
  return (
    <fieldset class="lre-gm-routines-choices">
      <legend class="lre-sr">{props.legend}</legend>
      {props.choices.map((c) => (
        <label key={c.value ?? ""} class="lre-gm-routines-choice">
          <input type="radio" name={group} value={c.value ?? ""} checked={props.value === c.value} disabled={props.disabled} onChange={() => props.onChange(c.value)} />
          <span class="lre-gm-routines-choice-text">
            <span class="lre-gm-routines-choice-name">
              {c.label}
              {c.now ? <Badge>Now</Badge> : null}
            </span>
            <span class="lre-gm-routines-choice-help">{c.help}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** How they follow their routine in this chat, its role, and how aware of the story they are: each part the world's unless set here. */
function FollowPage(props: { ctx: Ctx; view: RoutineGmView; onBack(): void }) {
  const { ctx, view } = props;
  const chat = view.follow.chat;
  const [mode, setMode] = useState<RoutineMode>(chat?.mode ?? "follows");
  const [role, setRole] = useState<RoutineRole | null>(chat?.role ?? null);
  const [awareness, setAwareness] = useState<RoutineAwareness | null>(chat?.awareness ?? null);
  const changed = mode !== (chat?.mode ?? "follows") || role !== (chat?.role ?? null) || awareness !== (chat?.awareness ?? null);
  const levelRole = effectiveRole(view.tier, view.settings.roles, null);
  return (
    <ChangePage name="routine-follow" title="How they follow their routine" view={view} onBack={props.onBack}>
      <form
        class="lre-stack"
        data-lre-routine-form="follow"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) sendOp(ctx, followOp(view.entity, mode, awareness, role), props.onBack);
        }}
      >
        <Section title="In this chat">
          <Choices<RoutineMode> legend="In this chat" value={mode} choices={ROUTINE_MODES.map((m) => ({ value: m, label: ROUTINE_MODE_LABEL[m], help: MODE_NOTE[m], now: m === view.follow.mode }))} disabled={ctx.busy} onChange={setMode} />
        </Section>
        <Section title="Their routine's role">
          <p class="lre-gm-note">What their routine and their own schedules are to the engine. Routines inform by default; the world's schedules and pay run whatever you pick.</p>
          <Choices<RoutineRole | null>
            legend="Their routine's role"
            value={role}
            choices={[{ value: null, label: `Their level's default: ${ROUTINE_ROLE_LABEL[levelRole]}`, help: ROLE_NOTE[levelRole], now: chat?.role == null }, ...ROUTINE_ROLES.map((r) => ({ value: r, label: ROUTINE_ROLE_LABEL[r], help: ROLE_NOTE[r], now: chat?.role === r }))]}
            disabled={ctx.busy}
            onChange={setRole}
          />
        </Section>
        <Section title="Story and lore awareness">
          <p class="lre-gm-note">How strictly an enforced routine keeps to itself against what the story and its lore establish. Whatever you pick, nobody is moved out of a scene with you.</p>
          <Choices<RoutineAwareness | null>
            legend="Story and lore awareness"
            value={awareness}
            choices={[{ value: null, label: `As the world has it: ${AWARENESS_LABEL[view.settings.awareness]}`, help: AWARENESS_NOTE[view.settings.awareness], now: chat?.awareness == null }, ...ROUTINE_AWARENESS.map((a) => ({ value: a, label: AWARENESS_LABEL[a], help: AWARENESS_NOTE[a], now: chat?.awareness === a }))]}
            disabled={ctx.busy}
            onChange={setAwareness}
          />
        </Section>
        <Submit busy={ctx.busy} ready={changed}>
          Save for this chat
        </Submit>
      </form>
      {chat ? (
        <Section title="Back to the world's">
          <p class="lre-gm-note">They follow their routine as the world has it again. The edit's Undo brings your setting back.</p>
          <Button icon="undo" disabled={ctx.busy} onClick={() => sendOp(ctx, followOp(view.entity, "follows", null, null), props.onBack)}>
            Use the world's settings
          </Button>
        </Section>
      ) : null}
    </ChangePage>
  );
}

/** The chat's world, as its revision has it, with the packs' kinds: what Build's forms read for places, owners and fields. */
function useChatWorld(send: Send): WorldDoc | null {
  const view = useView();
  const worldId = view?.worldId ?? null;
  const revision = view?.revision ?? null;
  const [doc, setDoc] = useState<WorldDoc | null>(null);
  useEffect(() => {
    if (worldId === null) return;
    let live = true;
    void send({ type: "lre.world", op: "get", worldId, ...(revision ? { revision } : {}) }).then((m) => {
      if (!live || m.type !== "lre.result" || m.request !== "lre.world" || !m.body.world) return;
      const world = m.body.world;
      setDoc({ ...world, kinds: { ...m.body.packKinds, ...world.kinds } });
    });
    return () => {
      live = false;
    };
  }, [worldId, revision]);
  return doc;
}

/** What a block or schedule rests on, and the way to its lore entry or sheet in Build. */
function SourceRow(props: { source: SourceView; now: number }) {
  const app = useApp();
  const worldId = useView()?.worldId ?? null;
  const s = props.source;
  const target = s.type === "lore" ? { collection: "lore" as const, id: s.entry } : s.type === "sheet" ? { collection: "entities" as const, id: s.entity } : null;
  return (
    <div class="lre-gm-routines-source" data-lre-source={s.type}>
      <span class="lre-gm-routines-lines">
        <span class="lre-gm-routines-source-label">{sourceWords(s, props.now)}</span>
        {s.type === "story" && s.turn ? <IdText id={s.turn} /> : null}
        {(s.type === "lore" || s.type === "sheet") && s.quote ? <q class="lre-gm-routines-quote">{s.quote}</q> : null}
      </span>
      {target && worldId ? (
        <Button size="sm" variant="ghost" icon="external" onClick={() => app.ui.update((ui) => ({ ...ui, mode: "build", build: { view: "item", worldId, collection: target.collection, id: target.id } }))}>
          {s.type === "lore" ? "Open the entry" : "Open their sheet"}
        </Button>
      ) : null}
    </div>
  );
}

/** One block of their routine for this chat: change it, switch it off, or drop the chat's change; or a new block the chat adds. */
function BlockPage(props: { ctx: Ctx; view: RoutineGmView; block: EffectiveBlock | null; onBack(): void }) {
  const { ctx, view, block } = props;
  const doc = useChatWorld(ctx.send);
  const taken = new Set(view.blocks.map((b) => b.block.id));
  const [draft, setDraft] = useState<RoutineBlock>(() => blockDraft(block ?? undefined, blankBlock(deriveId("New block", taken), "New block")));
  // A new block's id follows its label as it's typed; an existing one keeps its own.
  const value: RoutineBlock = block ? draft : { ...draft, id: deriveId(draft.label.trim() || "block", taken) };
  const result = blockOp(view.entity, value);
  const off = block !== null && (isOff(block.block) || block.off);
  const chatOwned = block?.owner.level === "chat";
  const changed = block === null || off || JSON.stringify(value) !== JSON.stringify(block.block);
  const title = block === null ? "Add a block for this chat" : isOff(block.block) ? `${nameOfId(block.block.id)}: off` : off ? `${block.block.label}: off` : block.block.label;
  return (
    <ChangePage name="routine-block" title={title} view={view} onBack={props.onBack}>
      {block ? (
        <Section title="Whose it is and what it rests on">
          <div class="lre-stack">
            <span>{ownerWords(block.owner)}</span>
            <SourceRow source={block.source} now={ctx.gm.minds.now} />
            {block.shadowed.map((s) => (
              <div key={`${s.owner.level}:${s.owner.id ?? ""}`} class="lre-gm-routines-shadow">
                <span class="lre-gm-note">Replaces {s.owner.level === "builtin" ? "the basic need" : ownerWords(s.owner).toLowerCase()}:</span>
                <SourceRow source={s.source} now={ctx.gm.minds.now} />
              </div>
            ))}
          </div>
        </Section>
      ) : (
        <Section>
          <p class="lre-gm-note">A block only this chat has, yours: their routine leads it as far as the story lets them, and it never moves them out of a scene with you.</p>
        </Section>
      )}
      <form
        class="lre-stack"
        data-lre-routine-form="block"
        onSubmit={(event) => {
          event.preventDefault();
          if ("op" in result && changed) sendOp(ctx, result.op, props.onBack);
        }}
      >
        {doc ? <RoutineBlockForm value={value} doc={doc} path={`routine.${value.id}`} onChange={setDraft} /> : <None>Reading the world…</None>}
        <Submit busy={ctx.busy} ready={doc !== null && "op" in result && changed} problems={"problems" in result ? result.problems : undefined}>
          {block ? (off ? "Switch it back on, as here" : "Save for this chat") : "Add for this chat"}
        </Submit>
      </form>
      {block && !off ? (
        <Section title="Switch it off">
          <p class="lre-gm-note">They don't keep this block in this chat{block.owner.level === "builtin" ? ": it's a basic need, so their day makes no room for it" : ""}. The edit's Undo brings it back.</p>
          <Button variant="danger" icon="close" disabled={ctx.busy} onClick={() => sendOp(ctx, blockOffOp(view.entity, block.block.id), props.onBack)}>
            Switch it off for them
          </Button>
        </Section>
      ) : null}
      {block && chatOwned ? (
        <Section title={block.shadowed.length === 0 ? "Remove it" : "Back to the world's"}>
          <p class="lre-gm-note">{block.shadowed.length === 0 ? "Only this chat has this block: removing it takes it out of their routine." : "Drops this chat's change: the block is the world's again."} The edit's Undo brings it back.</p>
          <Button variant={block.shadowed.length === 0 ? "danger" : "secondary"} icon={block.shadowed.length === 0 ? "trash" : "undo"} disabled={ctx.busy} onClick={() => sendOp(ctx, dropBlockOp(view.entity, block.block.id), props.onBack)}>
            {block.shadowed.length === 0 ? "Remove the block" : "Use the world's block"}
          </Button>
        </Section>
      ) : null}
    </ChangePage>
  );
}

/** One of their schedules in this chat: their own version of it, or off for a while; or back to the world's. */
function SchedulePage(props: { ctx: Ctx; view: RoutineGmView; schedule: EffectiveSchedule; onBack(): void }) {
  const { ctx, view, schedule: s } = props;
  const doc = useChatWorld(ctx.send);
  const now = ctx.gm.minds.now;
  const [how, setHow] = useState<"own" | "off">(s.chat && "off" in s.chat ? "off" : "own");
  const [draft, setDraft] = useState<ScheduleDef>(() => scheduleDraft(s, view.entity));
  const [hours, setHours] = useState<number | null>(s.chat && "off" in s.chat && s.chat.until !== null ? Math.max(1, Math.round((s.chat.until - now) / 60)) : null);
  const own = scheduleOwnOp(view.entity, s.schedule, draft.slots, draft.recurrence, s.recurrence);
  const op = how === "own" ? ("op" in own ? own.op : null) : scheduleOffOp(view.entity, s.schedule, hours === null ? null : now + hours * 60);
  const over = scheduleRows(view).find((r) => r.schedule.schedule === s.schedule)?.over ?? [];
  return (
    <ChangePage name="routine-schedule" title={nameOfId(s.schedule)} view={view} onBack={props.onBack}>
      <Section title="Whose it is and what it rests on">
        <div class="lre-stack">
          <span>
            {ownerWords(s.owner)} · sets {targetWords(s.target)} · {EVERY[s.recurrence.every]}
          </span>
          <SourceRow source={s.source} now={now} />
          {over.length > 0 ? <span class="lre-gm-note">Where {over.map(nameOfId).join(", ")} also run, they win: they're more specific.</span> : <span class="lre-gm-note">No more specific schedule of the world's runs over it.</span>}
          {s.chat ? (
            <span class="lre-gm-note">
              In this chat: {chatScheduleWords(s.chat, now).toLowerCase()} · {sourceWords(s.chat.source, now)}
            </span>
          ) : null}
        </div>
      </Section>
      <form
        class="lre-stack"
        data-lre-routine-form="schedule"
        onSubmit={(event) => {
          event.preventDefault();
          if (op) sendOp(ctx, op, props.onBack);
        }}
      >
        <Section title="Change it for this chat">
          <Seg<"own" | "off">
            label="Change it for this chat"
            value={how}
            options={[
              { value: "own", label: "Their own version" },
              { value: "off", label: "Off for them" },
            ]}
            disabled={ctx.busy}
            onChange={setHow}
          />
        </Section>
        {how === "own" ? (
          doc ? (
            <ScheduleForm value={draft} doc={doc} path={`schedules.${s.schedule}`} fixed={<span class="lre-gm-note">{view.name}'s own in this chat, ranked as their own: it sets {targetWords(s.target)}.</span>} onChange={setDraft} />
          ) : (
            <None>Reading the world…</None>
          )
        ) : (
          <Section title="For how long">
            <div class="lre-stack">
              <Seg<"cleared" | "hours">
                label="For how long"
                value={hours === null ? "cleared" : "hours"}
                options={[
                  { value: "cleared", label: "Until you clear it" },
                  { value: "hours", label: "For some hours" },
                ]}
                disabled={ctx.busy}
                onChange={(v) => setHours(v === "cleared" ? null : (hours ?? 24))}
              />
              {hours !== null ? <NumberStepper label="Hours" value={hours} min={1} max={24 * 60} integer disabled={ctx.busy} onChange={setHours} /> : null}
            </div>
          </Section>
        )}
        <Submit busy={ctx.busy || (how === "own" && doc === null)} ready={op !== null} problems={how === "own" && "problems" in own ? own.problems : undefined}>
          Save for this chat
        </Submit>
      </form>
      {s.chat ? (
        <Section title="Back to the world's">
          <p class="lre-gm-note">Drops this chat's change: they follow the world's schedule again. The edit's Undo brings it back.</p>
          <Button icon="undo" disabled={ctx.busy} onClick={() => sendOp(ctx, dropScheduleOp(view.entity, s.schedule), props.onBack)}>
            Use the world's schedule
          </Button>
        </Section>
      ) : null}
    </ChangePage>
  );
}

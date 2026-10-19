// GM view → Minds (DESIGN §24.9): every character's place on the fidelity ladder and why, their
// latest mind (monologue, depiction, intent, reactions), plans, notes, commitments, what they
// witnessed and their summary. It lives inside the GM view, so the spoiler gate covers it, and its
// data comes with `lre.gm` only. Pin, refresh and every edit is one `lre.edit`, one Corrected chip.

import { useState } from "preact/hooks";
import type { EntityId, PlaceId } from "../../../shared/ids";
import type { CommitmentKind, CommitmentStatus, Fidelity, MindsGmCharacter, MindsGmView, PlanKind, PlanStatus } from "../../../shared/minds";
import { COMMITMENT_KINDS, COMMITMENT_STATUSES, FIDELITIES, MIND_TEXT_CAPS, PLAN_KINDS, PLAN_PRIORITY } from "../../../shared/minds";
import type { EditOp } from "../../../shared/protocol";
import { Card, Empty, Row, Seg } from "../../../frontend/components";
import type { GmSectionProps } from "../../../frontend/registry";
import type { CommitmentDraft, NoteDraft, PlanFormDraft } from "./ops";
import { COMMITMENT_KIND_LABEL, COMMITMENT_STATUS_LABEL, commitmentDraft, commitmentOp, deleteOp, FIDELITY_LABEL, narratorGets, noteDraft, noteOp, pinOp, PLAN_KIND_LABEL, PLAN_STATUS_LABEL, planDraft, planLasts, planOp, refreshOp, startPlanIn } from "./ops";

const LEVEL_TONE: Record<Fidelity, string> = { live: "accent", near: "", far: "", background: "" };

const SECRECY_NOTE: Record<MindsGmView["secrecy"], string> = {
  full: "Full: the narrator gets each mind whole (monologue, intent, reactions, mood and depiction), told to show it and never state it.",
  brief: "Brief: the narrator gets only the depiction, checked for leaks; the monologue and intent stay here.",
};

/** The people a commitment or plan can be with: the characters, and the player's own. */
interface Person {
  id: EntityId;
  name: string;
}

interface Ctx {
  section: GmSectionProps;
  view: MindsGmView;
  people: Person[];
  places: { id: PlaceId; name: string }[];
  edit(ops: EditOp[]): Promise<boolean>;
}

function nameIn(list: readonly { id: string; name: string }[], id: string | null): string {
  if (id === null) return "—";
  return list.find((p) => p.id === id)?.name ?? id;
}

function points(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** People picked one at a time from a list, each removable. */
function PeoplePicker(props: { label: string; value: readonly EntityId[]; people: readonly Person[]; exclude: EntityId; disabled: boolean; onChange(next: EntityId[]): void }) {
  const left = props.people.filter((p) => p.id !== props.exclude && !props.value.includes(p.id));
  return (
    <div class="lre-field">
      <span class="label">{props.label}</span>
      <div class="lre-inline">
        {props.value.map((id) => (
          <button key={id} type="button" class="lre-btn small" aria-label={`Remove ${nameIn(props.people, id)}`} disabled={props.disabled} onClick={() => props.onChange(props.value.filter((v) => v !== id))}>
            {nameIn(props.people, id)} ×
          </button>
        ))}
        {left.length > 0 ? (
          <select class="lre-input" aria-label={`Add to ${props.label}`} value="" disabled={props.disabled} onChange={(event) => event.currentTarget.value && props.onChange([...props.value, event.currentTarget.value])}>
            <option value="">Add someone…</option>
            {left.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}

function FormButtons(props: { op: EditOp | null; ctx: Ctx; onDone(): void; invalid: string }) {
  return (
    <div class="lre-inline">
      <button type="button" class="lre-btn primary" disabled={props.ctx.section.busy || props.op === null} onClick={() => props.op && void props.ctx.edit([props.op]).then((ok) => ok && props.onDone())}>
        Save
      </button>
      <button type="button" class="lre-btn ghost" onClick={props.onDone}>
        Cancel
      </button>
      {props.op === null ? <span class="lre-small lre-muted">{props.invalid}</span> : null}
    </div>
  );
}

function NoteForm(props: { ctx: Ctx; entity: EntityId; id: string | null; initial: NoteDraft; onDone(): void }) {
  const [draft, setDraft] = useState(props.initial);
  return (
    <div class="lre-stack" data-lre-minds-form="note">
      <textarea class="lre-input" rows={3} style={{ fontFamily: "inherit" }} aria-label="Note" maxLength={MIND_TEXT_CAPS.note} value={draft.text} onInput={(event) => setDraft({ ...draft, text: event.currentTarget.value })} />
      <Seg<string> label="Salience" value={draft.salience} options={["1", "2", "3", "4", "5"].map((s) => ({ value: s, label: s }))} onChange={(salience) => setDraft({ ...draft, salience })} />
      <FormButtons ctx={props.ctx} op={noteOp(props.entity, props.id, draft)} invalid="A note needs its text." onDone={props.onDone} />
    </div>
  );
}

function CommitmentForm(props: { ctx: Ctx; entity: EntityId; id: string | null; initial: CommitmentDraft; dueText: string | null; onDone(): void }) {
  const [draft, setDraft] = useState(props.initial);
  const [dueIn, setDueIn] = useState("");
  const now = props.ctx.view.now;
  const setDue = (text: string) => {
    setDueIn(text);
    const hours = Number(text);
    setDraft({ ...draft, due: text.trim() === "" ? props.initial.due : Number.isFinite(hours) ? Math.round(now + hours * 60) : Number.NaN });
  };
  return (
    <div class="lre-stack" data-lre-minds-form="commitment">
      <select class="lre-input" aria-label="Kind" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.currentTarget.value as CommitmentKind })}>
        {COMMITMENT_KINDS.map((k) => (
          <option key={k} value={k}>
            {COMMITMENT_KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <textarea class="lre-input" rows={2} style={{ fontFamily: "inherit" }} aria-label="What it is" maxLength={MIND_TEXT_CAPS.commitment} value={draft.text} onInput={(event) => setDraft({ ...draft, text: event.currentTarget.value })} />
      <PeoplePicker label="With" value={draft.with} people={props.ctx.people} exclude={props.entity} disabled={props.ctx.section.busy} onChange={(next) => setDraft({ ...draft, with: next })} />
      <div class="lre-inline">
        <input class="lre-input" inputMode="decimal" aria-label="Due in hours from now" placeholder={props.dueText ? `Due ${props.dueText}` : "Due in (hours), blank for none"} value={dueIn} onInput={(event) => setDue(event.currentTarget.value)} />
        {draft.due !== null ? (
          <button type="button" class="lre-btn small ghost" onClick={() => (setDueIn(""), setDraft({ ...draft, due: null }))}>
            No due time
          </button>
        ) : null}
      </div>
      <select class="lre-input" aria-label="Status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.currentTarget.value as CommitmentStatus })}>
        {COMMITMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {COMMITMENT_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <FormButtons ctx={props.ctx} op={commitmentOp(props.entity, props.id, draft)} invalid="A commitment needs its text and someone it is with." onDone={props.onDone} />
    </div>
  );
}

function PlanForm(props: { ctx: Ctx; entity: EntityId; id: string | null; initial: PlanFormDraft; onDone(): void }) {
  const [draft, setDraft] = useState(props.initial);
  const now = props.ctx.view.now;
  const [startIn, setStartIn] = useState(String(Math.round(((draft.from - now) / 60) * 4) / 4));
  const [lasts, setLasts] = useState(String(draft.to - draft.from));
  return (
    <div class="lre-stack" data-lre-minds-form="plan">
      <input class="lre-input" aria-label="What" placeholder="What they mean to do" maxLength={MIND_TEXT_CAPS.planWhat} value={draft.what} onInput={(event) => setDraft({ ...draft, what: event.currentTarget.value })} />
      <select class="lre-input" aria-label="Kind" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.currentTarget.value as PlanKind })}>
        {PLAN_KINDS.map((k) => (
          <option key={k} value={k}>
            {PLAN_KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <label class="lre-field">
        <span class="label">Starts in (hours from now; negative for earlier)</span>
        <input
          class="lre-input"
          inputMode="decimal"
          value={startIn}
          onInput={(event) => {
            const text = event.currentTarget.value;
            setStartIn(text);
            const hours = Number(text);
            if (text.trim() !== "" && Number.isFinite(hours)) setDraft(startPlanIn(draft, now, hours));
          }}
        />
      </label>
      <label class="lre-field">
        <span class="label">Lasts (minutes)</span>
        <input
          class="lre-input"
          inputMode="numeric"
          value={lasts}
          onInput={(event) => {
            const text = event.currentTarget.value;
            setLasts(text);
            const minutes = Number(text);
            if (Number.isInteger(minutes) && minutes > 0) setDraft(planLasts(draft, minutes));
          }}
        />
      </label>
      <select class="lre-input" aria-label="Where" value={draft.where ?? ""} onChange={(event) => setDraft({ ...draft, where: event.currentTarget.value || null })}>
        <option value="">Anywhere</option>
        {props.ctx.places.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <PeoplePicker label="With" value={draft.with} people={props.ctx.people} exclude={props.entity} disabled={props.ctx.section.busy} onChange={(next) => setDraft({ ...draft, with: next })} />
      <Seg<number> label="Priority" value={draft.priority} options={Array.from({ length: PLAN_PRIORITY.max - PLAN_PRIORITY.min + 1 }, (_, i) => ({ value: PLAN_PRIORITY.min + i, label: String(PLAN_PRIORITY.min + i), title: i === 0 ? "Whenever it fits" : i === PLAN_PRIORITY.max - PLAN_PRIORITY.min ? "It must happen" : undefined }))} onChange={(priority) => setDraft({ ...draft, priority })} />
      <select class="lre-input" aria-label="Status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.currentTarget.value as PlanStatus })}>
        {(["open", "done", "dropped"] as const).map((s) => (
          <option key={s} value={s}>
            {PLAN_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <FormButtons ctx={props.ctx} op={planOp(props.entity, props.id, draft)} invalid="A plan needs what it is, and a length." onDone={props.onDone} />
    </div>
  );
}

function ItemActions(props: { ctx: Ctx; onEdit(): void; remove: EditOp; noun: string }) {
  return (
    <span class="lre-inline">
      <button type="button" class="lre-btn small" aria-label={`Edit ${props.noun}`} disabled={props.ctx.section.busy} onClick={props.onEdit}>
        ✎
      </button>
      <button type="button" class="lre-btn small danger" aria-label={`Delete ${props.noun}`} disabled={props.ctx.section.busy} onClick={() => void props.ctx.edit([props.remove])}>
        ✕
      </button>
    </span>
  );
}

type Pin = Fidelity | "score";

function Ladder(props: { ctx: Ctx; c: MindsGmCharacter }) {
  const { ctx, c } = props;
  const f = c.fidelity;
  return (
    <Card title="Fidelity" aside={<span class={`lre-badge ${LEVEL_TONE[f.level]}`}>{FIDELITY_LABEL[f.level]}</span>}>
      <Row k="Score" v={String(Math.round(f.score))} />
      {f.reasons.length === 0 ? <div class="lre-small lre-muted">Nothing adds to their score now.</div> : f.reasons.map((r, i) => <Row key={`${r.label}:${i}`} k={r.label} v={r.points === 0 ? "pin" : points(r.points)} />)}
      {f.pin.author ? <Row k="The author's pin" v={FIDELITY_LABEL[f.pin.author]} sub="Build → World → Minds: Always Live or Never a mind" /> : null}
      <Seg<Pin>
        label="Pin their fidelity"
        value={f.pin.gm ?? "score"}
        options={[{ value: "score", label: "By score" }, ...FIDELITIES.map((level) => ({ value: level, label: FIDELITY_LABEL[level] }))]}
        disabled={ctx.section.busy}
        onChange={(pin) => void ctx.edit([pinOp(c.entity, pin === "score" ? null : pin)])}
      />
      <div class="lre-inline">
        <button type="button" class="lre-btn" disabled={ctx.section.busy || c.refreshQueued} onClick={() => void ctx.edit([refreshOp(c.entity)])}>
          Refresh their mind next turn
        </button>
        {c.refreshQueued ? <span class="lre-badge accent">Fresh mind next turn</span> : null}
      </div>
    </Card>
  );
}

function LatestMind(props: { ctx: Ctx; c: MindsGmCharacter }) {
  const { ctx, c } = props;
  const m = c.mind;
  if (!m) return <Card title="Latest mind">{<Empty>No mind yet.</Empty>}</Card>;
  const sent = narratorGets(ctx.view.secrecy, m);
  const toNarrator = <span class="lre-badge">to the narrator</span>;
  return (
    <Card title="Latest mind" aside={<span class="lre-badge">{FIDELITY_LABEL[m.level]}</span>}>
      <Row k="When" v={m.clock} sub={`${m.moment === "beat" ? "At a time-skip beat" : "On a turn"} · ${m.reason}${m.place ? ` · at ${nameIn(ctx.places, m.place)}` : ""}`} />
      {m.mood ? <Row k={<span class="lre-inline">Mood {sent.mood ? toNarrator : null}</span>} v={m.mood} /> : null}
      <Row k={<span class="lre-inline">Monologue {sent.monologue ? toNarrator : null}</span>} sub={m.monologue || "—"} />
      <Row k={<span class="lre-inline">Depiction {sent.depiction ? toNarrator : null}</span>} sub={m.depiction || "—"} />
      {m.withheld ? <div class="lre-banner warn">The depiction gave away a secret or a name you haven't met, so the narrator got none of it this time.</div> : null}
      <Row k={<span class="lre-inline">Intent {sent.intent ? toNarrator : null}</span>} sub={m.intent || "—"} />
      {m.reactions.length > 0 ? <Row k={<span class="lre-inline">Reactions {sent.reactions ? toNarrator : null}</span>} sub={m.reactions.join(" · ")} /> : null}
      {m.interrupt ? <Row k={<span class="lre-inline">Interrupted the skip {sent.interrupt ? toNarrator : null}</span>} v={m.interrupt} tone="warn" /> : null}
    </Card>
  );
}

function Plans(props: { ctx: Ctx; c: MindsGmCharacter }) {
  const { ctx, c } = props;
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Card title="Plans" aside={<span class="lre-badge">{c.plans.filter((p) => p.status === "open").length} open</span>}>
      {c.plans.length === 0 && editing === null ? <Empty>No plans.</Empty> : null}
      {c.plans.map((p) =>
        editing === p.id ? (
          <PlanForm key={p.id} ctx={ctx} entity={c.entity} id={p.id} initial={planDraft(ctx.view.now, p)} onDone={() => setEditing(null)} />
        ) : (
          <Row
            key={p.id}
            k={p.what}
            sub={`${PLAN_KIND_LABEL[p.kind]} · ${p.fromText} – ${p.toText}${p.where ? ` · ${nameIn(ctx.places, p.where)}` : ""}${p.with.length > 0 ? ` · with ${p.with.map((w) => nameIn(ctx.people, w)).join(", ")}` : ""} · priority ${p.priority} · ${PLAN_STATUS_LABEL[p.status]}${p.reason ? ` (${p.reason})` : ""} · from ${p.source === "gm" ? "you" : `their ${p.source}`}`}
            tone={p.status === "open" ? undefined : "muted"}
            v={<ItemActions ctx={ctx} noun={`plan ${p.what}`} onEdit={() => setEditing(p.id)} remove={deleteOp(c.entity, "plan", p.id)} />}
          />
        ),
      )}
      {editing === "" ? (
        <PlanForm ctx={ctx} entity={c.entity} id={null} initial={planDraft(ctx.view.now)} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" class="lre-btn small" disabled={ctx.section.busy} onClick={() => setEditing("")}>
          Add a plan
        </button>
      )}
    </Card>
  );
}

function Commitments(props: { ctx: Ctx; c: MindsGmCharacter }) {
  const { ctx, c } = props;
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Card title="Commitments" aside={<span class="lre-badge">{c.commitments.filter((x) => x.status === "open").length} open</span>}>
      {c.commitments.length === 0 && editing === null ? <Empty>No commitments.</Empty> : null}
      {c.commitments.map((x) =>
        editing === x.id ? (
          <CommitmentForm key={x.id} ctx={ctx} entity={c.entity} id={x.id} initial={commitmentDraft(x)} dueText={x.dueText} onDone={() => setEditing(null)} />
        ) : (
          <Row
            key={x.id}
            k={x.text}
            sub={`${COMMITMENT_KIND_LABEL[x.kind]} with ${x.withNames.join(", ") || "—"}${x.dueText ? ` · due ${x.dueText}` : ""} · ${COMMITMENT_STATUS_LABEL[x.status]}`}
            tone={x.status === "open" ? undefined : "muted"}
            v={<ItemActions ctx={ctx} noun={`commitment ${x.text}`} onEdit={() => setEditing(x.id)} remove={deleteOp(c.entity, "commitment", x.id)} />}
          />
        ),
      )}
      {editing === "" ? (
        <CommitmentForm ctx={ctx} entity={c.entity} id={null} initial={commitmentDraft()} dueText={null} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" class="lre-btn small" disabled={ctx.section.busy} onClick={() => setEditing("")}>
          Add a commitment
        </button>
      )}
    </Card>
  );
}

function Notes(props: { ctx: Ctx; c: MindsGmCharacter }) {
  const { ctx, c } = props;
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Card title="Memory notes" aside={<span class="lre-badge">{c.notes.filter((n) => !n.faded).length} remembered</span>}>
      {c.notes.length === 0 && editing === null ? <Empty>No notes.</Empty> : null}
      {c.notes.map((n) =>
        editing === n.id ? (
          <NoteForm key={n.id} ctx={ctx} entity={c.entity} id={n.id} initial={noteDraft(n)} onDone={() => setEditing(null)} />
        ) : (
          <Row
            key={n.id}
            k={n.text}
            sub={`${n.clock} · salience ${n.salience}, now ${n.now.toFixed(1)}${n.faded ? " · faded" : ""}`}
            tone={n.faded ? "muted" : undefined}
            v={<ItemActions ctx={ctx} noun={`note ${n.text}`} onEdit={() => setEditing(n.id)} remove={deleteOp(c.entity, "note", n.id)} />}
          />
        ),
      )}
      {editing === "" ? (
        <NoteForm ctx={ctx} entity={c.entity} id={null} initial={noteDraft()} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" class="lre-btn small" disabled={ctx.section.busy} onClick={() => setEditing("")}>
          Add a note
        </button>
      )}
    </Card>
  );
}

function CharacterMinds(props: { ctx: Ctx; c: MindsGmCharacter; onClose(): void }) {
  const { ctx, c } = props;
  return (
    <div class="lre-stack" data-lre-gm-minds={c.entity}>
      <div class="lre-spread">
        <span class="lre-h2">{c.name}</span>
        <button type="button" class="lre-btn small ghost" onClick={props.onClose}>
          All
        </button>
      </div>
      <Ladder ctx={ctx} c={c} />
      <LatestMind ctx={ctx} c={c} />
      <Plans ctx={ctx} c={c} />
      <Commitments ctx={ctx} c={c} />
      <Notes ctx={ctx} c={c} />
      <Card title="Summary">{c.summary ? <div class="lre-small">{c.summary}</div> : <Empty>No summary yet.</Empty>}</Card>
      <Card title="Witnessed">
        {c.witness.length === 0 ? <Empty>Nothing recorded.</Empty> : c.witness.map((w, i) => <Row key={`${w.at}:${i}`} k={w.what} sub={`${w.clock} · ${w.how === "told" ? `told${w.by ? ` by ${nameIn(ctx.people, w.by)}` : ""}` : "saw it"}${w.place ? ` · ${nameIn(ctx.places, w.place)}` : ""}`} />)}
      </Card>
    </div>
  );
}

export function GmMindsSection(props: GmSectionProps) {
  const view = props.gm.minds;
  const [open, setOpen] = useState<EntityId | null>(null);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<Fidelity | "">("");
  const pov = props.gm.entities.find((e) => e.pov);
  const ctx: Ctx = {
    section: props,
    view,
    people: [...(pov ? [{ id: pov.id, name: pov.name }] : []), ...view.characters.map((c) => ({ id: c.entity, name: c.name }))],
    places: props.gm.places.map((p) => ({ id: p.id, name: p.name })),
    edit: props.edit,
  };
  const selected = view.characters.find((c) => c.entity === open);
  const q = query.trim().toLowerCase();
  const list = view.characters.filter((c) => (level === "" || c.fidelity.level === level) && (q === "" || c.name.toLowerCase().includes(q)));
  return (
    <div class="lre-stack" data-lre-gm-section="minds">
      {view.enabled ? null : <div class="lre-banner info">Character minds are off in Settings → Minds. What they recorded before stays here, and edits still apply.</div>}
      <Row k="Now" v={view.nowText} />
      <Row k="This world's secrecy" sub={SECRECY_NOTE[view.secrecy]} />
      {selected ? (
        <CharacterMinds ctx={ctx} c={selected} onClose={() => setOpen(null)} />
      ) : (
        <>
          <div class="lre-inline">
            <input class="lre-input" type="search" aria-label="Search" placeholder="Search by name" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
            <select class="lre-input" aria-label="Fidelity" value={level} onChange={(event) => setLevel(event.currentTarget.value as Fidelity | "")}>
              <option value="">Every level</option>
              {FIDELITIES.map((f) => (
                <option key={f} value={f}>
                  {FIDELITY_LABEL[f]}
                </option>
              ))}
            </select>
          </div>
          <Card title={`${list.length} of ${view.characters.length}`}>
            {view.characters.length === 0 ? <Empty>No characters yet.</Empty> : null}
            <div class="lre-list" data-lre-gm-list="minds">
              {list.map((c) => (
                <button key={c.entity} type="button" class="lre-item" onClick={() => setOpen(c.entity)}>
                  <span class="grow">
                    {c.name}
                    <span class="sub">{c.mind ? `Last mind ${c.mind.clock}` : "No mind yet"} · score {Math.round(c.fidelity.score)}</span>
                  </span>
                  <span class={`lre-badge ${LEVEL_TONE[c.fidelity.level]}`}>{FIDELITY_LABEL[c.fidelity.level]}</span>
                  {c.fidelity.pin.gm || c.fidelity.pin.author ? <span class="lre-badge warn">Pinned</span> : null}
                  {c.refreshQueued ? <span class="lre-badge">Refresh</span> : null}
                </button>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

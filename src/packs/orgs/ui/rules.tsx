// An organization's Rules (ORG-SPEC §4.4): its positions, each with its powers in words, seats, whom
// it reports to, its reach, limits and successor, marked when new members join in it or when it is
// the type's own (a household's Head, the party's Leader); the delegations in force, who acts for it
// with what powers and limits, until when, granted by whom; and its dues. Where the reader may change
// them (`rulesControls`; in GM → Orgs, always) the tab offers Add position and Edit (`org.govern`, at
// once), Delegate… and each delegation's page (`delegate`, as a turn; Revoke for its granter too)
// and Set dues, each opening its editor over the page (`org_edit`). The editors' fields are here,
// shared by Play's sheets, GM → Orgs and Build: a position's (title, powers by family, seats,
// reports to, reach, limits, successor, new members), a delegation's and the dues'.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { useView, type SheetRoute } from "../../../frontend/app";
import { CheckField, Chip, FormGroup, RefPicker } from "../../../frontend/build/form-kit";
import { Badge, Button, Card, Empty, Field, List, ListRow, PageHeader, Row, Section, Seg } from "../../../frontend/components";
import { MoneyInput } from "../../../frontend/money-input";
import { DUES_EVERY, ORG_POWER_FAMILIES, ORG_POWERS, POWER_FAMILY_LABELS, POWER_WORDS, type OrgPower, type OrgPowerFamily, type Position } from "../../../shared/org";
import type { OrgRef, OrgView } from "../../../shared/org-view";
import { DEFAULT_CURRENCY, type WorldCurrency } from "../../../shared/world";
import { OFFSTAGE_DEFAULTS, OFFSTAGE_NOTE, TELL_HELP, TELL_LABEL, tellPreset } from "../../../shared/offstage";
import {
  appointAction,
  appointable,
  appointees,
  delegateAction,
  delegationDraft,
  delegationProblem,
  duesAction,
  duesDraft,
  duesProblem,
  duesWords,
  givable,
  mayRevoke,
  moveTargets,
  orgEditRoute,
  positionAction,
  positionDraft,
  positionOfView,
  positionProblem,
  positionRemoveAction,
  revokeAction,
  rulesControls,
  type DelegationDraft,
  type DuesDraft,
  type OrgAction,
  type PositionDraft,
} from "./edit";
import { limitWords, powersText, seatWords, successorWords } from "./words";

export function OrgRules(props: { org: OrgView; currency?: WorldCurrency | null; open?(route: SheetRoute): void }) {
  const { org } = props;
  const can = rulesControls(org);
  const open = props.open;
  const currency = props.currency ?? DEFAULT_CURRENCY;
  const editor = (form: "position" | "delegate" | "dues", id: string | null = null) => (open ? () => open(orgEditRoute(org.id, form, id)) : undefined);
  const positions = org.positions.length > 0 || (can.positions && open !== undefined);
  const delegations = org.delegations.length > 0 || (can.delegate && open !== undefined);
  const dues = org.dues !== null || (can.dues && open !== undefined);
  if (!positions && !delegations && !dues) return <Empty icon="scroll">It has no positions or delegations.</Empty>;
  return (
    <div class="lre-stack" data-lre-org-rules={org.id}>
      {positions ? (
        <Section
          title="Positions"
          aside={
            can.positions && open ? (
              <Button variant="ghost" size="sm" icon="plus" onClick={editor("position")}>
                Add position
              </Button>
            ) : undefined
          }
        >
          <div class="lre-stack">
            {org.positions.length === 0 ? <span class="lre-small lre-muted">It has no positions yet.</span> : null}
            {org.positions.map((p) => {
              const limits = p.limits ? limitWords(p.limits) : [];
              return (
                <div key={p.id} data-lre-org-rule={p.id}>
                  <Card
                    title={p.title}
                    aside={
                      p.implied || p.joinsIn ? (
                        <span class="lre-world-badges">
                          {p.implied ? <Badge>Built in</Badge> : null}
                          {p.joinsIn ? <Badge tone="accent">New members</Badge> : null}
                        </span>
                      ) : undefined
                    }
                  >
                    <div class="lre-stack">
                      <Row k="May" v={powersText(p.powers)} />
                      <Row k="Seats" v={seatWords(p)} />
                      {p.reportsTo ? <Row k="Reports to" v={p.reportsTo.title} /> : null}
                      {p.scope === "below" ? <Row k="Reach" v="Only the positions below it" /> : null}
                      {limits.length > 0 ? <Row k="Limits" v={limits.join(" · ")} /> : null}
                      <Row k="When vacant" v={successorWords(p.successor)} />
                      {can.positions && open && !p.implied ? (
                        <Button size="sm" icon="edit" onClick={editor("position", p.id)}>
                          Edit
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}
      {delegations ? (
        <div data-lre-org-delegations>
          <Section
            title="Delegations"
            aside={
              can.delegate && open ? (
                <Button variant="ghost" size="sm" icon="key" onClick={editor("delegate")}>
                  Delegate…
                </Button>
              ) : undefined
            }
            flush
          >
            {org.delegations.length === 0 ? (
              <span class="lre-small lre-muted">No one acts for it.</span>
            ) : (
              <List>
                {org.delegations.map((d, i) => {
                  const opens = open !== undefined && (can.delegate || mayRevoke(org, d));
                  return <ListRow key={`${d.who.id}:${i}`} id={d.who.id} icon="key" title={d.who.name} subtitle={[powersText(d.powers), ...(d.limits ? limitWords(d.limits) : []), d.by ? `granted by ${d.by.name}` : null].filter((part) => part !== null).join(" · ")} value={d.until ? `until ${d.until}` : "until revoked"} valueTone="muted" chevron={opens} onClick={opens ? editor("delegate", d.who.id) : undefined} />;
                })}
              </List>
            )}
          </Section>
        </div>
      ) : null}
      {dues ? (
        <div data-lre-org-dues>
          <Section title="Dues" flush>
            <List>
              <ListRow icon="coins" title={org.dues ? duesWords(org.dues, currency) : "None"} chevron={can.dues && open !== undefined} onClick={can.dues ? editor("dues") : undefined} />
            </List>
          </Section>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- the editors' fields

/** Each power as a chip names it: what it lets one do, its first word capitalized. */
function chipWords(power: OrgPower): string {
  const words = POWER_WORDS[power];
  return words[0]?.toUpperCase() + words.slice(1);
}

/** Powers to give, as chips by family (§6.3): only those offered (what the giver holds), each toggled on or off. */
export function PowerChips(props: { powers: readonly OrgPower[]; offer: readonly OrgPower[]; onChange(next: OrgPower[]): void }) {
  const families = (Object.keys(ORG_POWER_FAMILIES) as OrgPowerFamily[]).flatMap((family) => {
    const powers = (ORG_POWER_FAMILIES[family] as readonly OrgPower[]).filter((p) => props.offer.includes(p));
    return powers.length > 0 ? [{ family, powers }] : [];
  });
  const toggle = (p: OrgPower) => props.onChange(props.powers.includes(p) ? props.powers.filter((q) => q !== p) : [...props.powers, p]);
  return (
    <div class="lre-stack" data-lre-power-chips>
      {families.map(({ family, powers }) => (
        <FormGroup key={family} title={POWER_FAMILY_LABELS[family]}>
          <div class="lre-form-chips" role="group" aria-label={`${POWER_FAMILY_LABELS[family]} powers`} data-lre-power-family={family}>
            {powers.map((p) => (
              <Chip key={p} pressed={props.powers.includes(p)} onToggle={() => toggle(p)}>
                {chipWords(p)}
              </Chip>
            ))}
          </div>
        </FormGroup>
      ))}
    </div>
  );
}

function TextField(props: { label: string; value: string; type?: "text" | "number" | "date"; help?: string; placeholder?: string; onInput(value: string): void }) {
  const id = useId();
  return (
    <Field label={props.label} help={props.help} for={id}>
      {props.type === "number" ? (
        <input id={id} class="lre-input" type="number" placeholder={props.placeholder} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
      ) : props.type === "date" ? (
        <input id={id} class="lre-input" type="date" value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
      ) : (
        <input id={id} class="lre-input" type="text" placeholder={props.placeholder} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
      )}
    </Field>
  );
}

function MoneyField(props: { label: string; value: string; currency: WorldCurrency; help?: string; onInput(value: string): void }) {
  return (
    <Field label={props.label} help={props.help}>
      <MoneyInput currency={props.currency} value={props.value} label={props.label} placeholder="No limit" onInput={props.onInput} />
    </Field>
  );
}

/**
 * A position's fields (§3.3, §6.3): its title, powers by family, seats (0 any number), whom it
 * reports to (another of `positions`), whom its staff and member powers reach, its limits on each
 * payment and each month, who fills it when it falls vacant (nobody, the next in rank, or one of
 * `people`), and whether new members join in it.
 */
export function PositionFields(props: { draft: PositionDraft; positions: readonly Position[]; people: readonly OrgRef[]; offer: readonly OrgPower[]; currency: WorldCurrency; onChange(next: PositionDraft): void }) {
  const d = props.draft;
  const set = (patch: Partial<PositionDraft>) => props.onChange({ ...d, ...patch });
  const successors = [{ value: "vacant", label: "Nobody: it stays vacant" }, { value: "next", label: "The next in rank" }, ...props.people.map((p) => ({ value: p.id, label: p.name }))];
  return (
    <div class="lre-stack" data-lre-position-fields>
      <TextField label="Title" value={d.title} placeholder="Head Mechanic" onInput={(title) => set({ title })} />
      <FormGroup title="Powers">
        <PowerChips powers={d.powers} offer={props.offer} onChange={(powers) => set({ powers })} />
      </FormGroup>
      <TextField label="Seats" type="number" help="How many may hold it; 0 is any number." value={d.seats} onInput={(seats) => set({ seats })} />
      <RefPicker label="Reports to" value={d.reportsTo} options={props.positions.filter((p) => p.id !== d.id).map((p) => ({ value: p.id, label: p.title }))} none="No one" onChange={(reportsTo) => set({ reportsTo })} />
      <Seg
        label="Its staff and member powers reach"
        value={d.scope}
        options={[
          { value: "org", label: "Everyone" },
          { value: "below", label: "Those below it" },
        ]}
        onChange={(scope) => set({ scope })}
      />
      <MoneyField label="Each payment up to" value={d.payment} currency={props.currency} onInput={(payment) => set({ payment })} />
      <MoneyField label="Each month up to" value={d.month} currency={props.currency} onInput={(month) => set({ month })} />
      <RefPicker label="When it falls vacant" value={d.successor === "" ? "vacant" : d.successor} options={successors} onChange={(successor) => set({ successor })} />
      <CheckField label="New members join in it" checked={d.joinsIn} onChange={(joinsIn) => set({ joinsIn })} />
    </div>
  );
}

/**
 * A delegation's fields (§3.5): who acts for it (`people`; none when the page names them), the powers
 * `offer`ed, its limits, until when (`kept`: the end it has, in words), and, for the GM, who granted it.
 */
export function DelegationFields(props: { draft: DelegationDraft; people: readonly OrgRef[] | null; offer: readonly OrgPower[]; granters: readonly OrgRef[] | null; kept: string | null; currency: WorldCurrency; onChange(next: DelegationDraft): void }) {
  const d = props.draft;
  const set = (patch: Partial<DelegationDraft>) => props.onChange({ ...d, ...patch });
  const ends = d.until !== "" ? "It ends at the end of that day." : props.kept !== null && d.kept !== null ? `Now until ${props.kept}; a date here moves it.` : "Empty, it stands until revoked.";
  return (
    <div class="lre-stack" data-lre-delegation-fields>
      {props.people ? <RefPicker label="Who acts for it" value={d.to} options={props.people.map((p) => ({ value: p.id, label: p.name }))} onChange={(to) => set({ to })} /> : null}
      <FormGroup title="Powers">
        <PowerChips powers={d.powers} offer={props.offer} onChange={(powers) => set({ powers })} />
      </FormGroup>
      <MoneyField label="Each payment up to" value={d.payment} currency={props.currency} onInput={(payment) => set({ payment })} />
      <MoneyField label="Each month up to" value={d.month} currency={props.currency} onInput={(month) => set({ month })} />
      <TextField label="Until" type="date" help={ends} value={d.until} onInput={(until) => set({ until })} />
      {d.kept !== null && d.until === "" ? (
        <Button size="sm" variant="ghost" icon="close" onClick={() => set({ kept: null })}>
          Until revoked
        </Button>
      ) : null}
      {props.granters ? <RefPicker label="Granted by" value={d.by} options={props.granters.map((p) => ({ value: p.id, label: p.name }))} none="No one named" onChange={(by) => set({ by })} /> : null}
    </div>
  );
}

/** The dues' fields (§3.8): what each member pays, how often, and on which day. */
export function DuesFields(props: { draft: DuesDraft; currency: WorldCurrency; onChange(next: DuesDraft): void }) {
  const d = props.draft;
  const set = (patch: Partial<DuesDraft>) => props.onChange({ ...d, ...patch });
  return (
    <div class="lre-stack" data-lre-dues-fields>
      <Field label="Each member pays">
        <MoneyInput currency={props.currency} value={d.amount} label="Each member pays" placeholder="Nothing" onInput={(amount) => set({ amount })} />
      </Field>
      <Seg label="How often" value={d.every} options={DUES_EVERY.map((every) => ({ value: every, label: `Each ${every}` }))} onChange={(every) => set({ every })} />
      {d.every !== "year" ? <TextField label={d.every === "week" ? "Weekday (0 is Sunday)" : "Day of the month (-1 is its last)"} type="number" value={d.day} placeholder="1" onInput={(day) => set({ day })} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Play's sheets

/** What an editor sheet in Play acts through: the world's money, whether a request is out, playing the reader's action (at once, or staged as their next turn), a confirmation, and Back. */
export interface PlayHost {
  currency: WorldCurrency;
  busy: boolean;
  /** Plays `action`; `done` once it was taken; `tell`, its confirm step's Tell switch, when it has one. */
  play(action: OrgAction, done?: () => void, tell?: boolean): void;
  confirm(title: string, message: string, ok: string): Promise<boolean>;
  back(): void;
}

/**
 * An editor's page: Back, its fields, why it can't be sent yet, when it plays, its button and, for
 * one that has one, its danger button. Naming the action it sends (`action`), one done at once, off
 * screen (DESIGN §11), it shows the Tell switch above its button, preset from Settings → Narrator →
 * Out-of-play actions until it is pressed; its setting goes to `onGo`.
 */
export function EditFrame(props: { name: string; title: string; subtitle?: string; onBack(): void; go: string; problem: string | null; busy: boolean; note: string; action?: OrgAction | null; onGo(tell?: boolean): void; danger?: { label: string; onClick(): void }; children: ComponentChildren }) {
  const view = useView();
  const [told, setTold] = useState<boolean | null>(null);
  const preset = props.action ? tellPreset(props.action.action, props.action.params, view?.controls?.offstage ?? OFFSTAGE_DEFAULTS, (view?.currency ?? DEFAULT_CURRENCY).decimals) : null;
  const tell = preset === null ? undefined : (told ?? preset);
  return (
    <div class="lre-stack" data-lre-org-edit={props.name}>
      <PageHeader title={props.title} subtitle={props.subtitle} onBack={props.onBack} />
      <form
        class="lre-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (props.problem === null) props.onGo(tell);
        }}
      >
        {props.children}
        {props.problem !== null ? (
          <span class="lre-small lre-muted" role="status">
            {props.problem}
          </span>
        ) : null}
        <span class="lre-small lre-muted">{props.note}</span>
        {tell !== undefined ? <CheckField label={TELL_LABEL} help={TELL_HELP} checked={tell} disabled={props.busy} onChange={setTold} /> : null}
        <Button type="submit" variant="primary" block disabled={props.busy || props.problem !== null}>
          {props.go}
        </Button>
        {props.danger ? (
          <Button variant="danger" icon="close" block disabled={props.busy} onClick={props.danger.onClick}>
            {props.danger.label}
          </Button>
        ) : null}
      </form>
    </div>
  );
}

/** When an editor's change plays (§4.6; DESIGN §11): every one is done at once, off screen, with its Undo; typed words play it as a turn. */
export const AT_ONCE = "Done at once, off screen, with Undo.";

/** Add position (under the position `under`, when the chart names one), or a position's Edit (`org_position`, at once), with Remove. */
export function PositionSheet(props: { org: OrgView; id: string | null; under?: string; host: PlayHost }) {
  const { org, host } = props;
  const view = props.id === null ? null : (appointable(org).find((p) => p.id === props.id) ?? null);
  const before = view ? positionOfView(view) : null;
  const [draft, setDraft] = useState(() => ({ ...positionDraft(before, host.currency), ...(props.under !== undefined && before === null ? { reportsTo: props.under } : {}) }));
  if (props.id !== null && !before) {
    return (
      <div class="lre-stack">
        <PageHeader title="Position" subtitle={org.name} onBack={host.back} />
        <Empty icon="scroll">It has no such position any more.</Empty>
      </div>
    );
  }
  const positions = appointable(org).map(positionOfView);
  const remove = before
    ? {
        label: "Remove the position",
        onClick: () => void host.confirm("Remove position", `Remove ${before.title}? Those holding it stay, without it.`, "Remove").then((yes) => (yes ? host.play(positionRemoveAction(org.id, before.id), host.back) : undefined)),
      }
    : undefined;
  const over = props.under === undefined ? undefined : appointable(org).find((p) => p.id === props.under)?.title;
  return (
    <EditFrame name="position" title={before ? before.title : over ? `Add a position under ${over}` : "Add position"} subtitle={org.name} onBack={host.back} go={before ? "Save" : "Add the position"} problem={positionProblem(draft, positions, host.currency)} busy={host.busy} note={AT_ONCE} action={positionAction(org.id, draft, before, host.currency)} onGo={(tell) => host.play(positionAction(org.id, draft, before, host.currency), host.back, tell)} {...(remove ? { danger: remove } : {})}>
      <PositionFields draft={draft} positions={positions} people={org.people.map((p) => ({ id: p.id, name: p.name }))} offer={ORG_POWERS} currency={host.currency} onChange={setDraft} />
    </EditFrame>
  );
}

/** A position the chart's sheets name, as the record it was read from; null once it is gone. */
function chartPosition(org: OrgView, id: string | null): Position | null {
  const view = id === null ? undefined : appointable(org).find((p) => p.id === id);
  return view ? positionOfView(view) : null;
}

/** A position gone since its sheet was opened. */
function GonePosition(props: { org: OrgView; onBack(): void }) {
  return (
    <div class="lre-stack">
      <PageHeader title="Position" subtitle={props.org.name} onBack={props.onBack} />
      <Empty icon="scroll">It has no such position any more.</Empty>
    </div>
  );
}

/** Where a position goes in the chart: the positions it may report to (never one under it), or no one. */
export function MoveFields(props: { org: OrgView; id: string; value: string; onChange(to: string): void }) {
  return <RefPicker label="Reports to" value={props.value} options={moveTargets(props.org, props.id).map((p) => ({ value: p.id, label: p.title }))} none="No one: it goes to the top" onChange={props.onChange} />;
}

/** Move it (the chart's menu): whom the position reports to, nothing else changed (`org_position`, at once). */
export function MoveSheet(props: { org: OrgView; id: string | null; host: PlayHost }) {
  const { org, host } = props;
  const before = chartPosition(org, props.id);
  const [to, setTo] = useState(before?.reports_to ?? "");
  if (!before) return <GonePosition org={org} onBack={host.back} />;
  const draft = { ...positionDraft(before, host.currency), reportsTo: to };
  const action = positionAction(org.id, draft, before, host.currency);
  return (
    <EditFrame name="move" title={`Move ${before.title}`} subtitle={org.name} onBack={host.back} go="Move it" problem={to === (before.reports_to ?? "") ? "Choose where it goes." : positionProblem(draft, appointable(org).map(positionOfView), host.currency)} busy={host.busy} note={AT_ONCE} action={action} onGo={(tell) => host.play(action, host.back, tell)}>
      <MoveFields org={org} id={before.id} value={to} onChange={setTo} />
    </EditFrame>
  );
}

/** Whom a position may be given to, as a picker: the people and organizations on the page who don't hold it. */
export function AppointFields(props: { org: OrgView; id: string; value: string; onChange(who: string): void }) {
  return <RefPicker label="Whom" value={props.value} options={appointees(props.org, props.id).map((p) => ({ value: p.id, label: p.you ? `${p.name} (you)` : p.name, ...(p.title !== "" ? { sublabel: p.title } : {}) }))} onChange={props.onChange} />;
}

/** Appoint someone to it (the chart's menu): one of its people or organizations into the position, by their membership or their job (`org_appoint`, `job_position`). */
export function AppointSheet(props: { org: OrgView; id: string | null; host: PlayHost }) {
  const { org, host } = props;
  const before = chartPosition(org, props.id);
  const [who, setWho] = useState("");
  if (!before) return <GonePosition org={org} onBack={host.back} />;
  const person = org.people.find((p) => p.id === who);
  const action = person ? appointAction(org, person, before.id) : null;
  return (
    <EditFrame name="appoint" title={`Appoint to ${before.title}`} subtitle={org.name} onBack={host.back} go="Appoint" problem={appointees(org, before.id).length === 0 ? "Everyone you know here holds it already." : person ? null : "Choose whom to appoint."} busy={host.busy} note={AT_ONCE} action={action} onGo={(tell) => (action ? host.play(action, host.back, tell) : undefined)}>
      <AppointFields org={org} id={before.id} value={who} onChange={setWho} />
    </EditFrame>
  );
}

/** Remove the position (the chart's menu): its holders stay without it, and those under it report to no one. */
export function RemovePositionSheet(props: { org: OrgView; id: string | null; host: PlayHost }) {
  const { org, host } = props;
  const before = chartPosition(org, props.id);
  if (!before) return <GonePosition org={org} onBack={host.back} />;
  const action = positionRemoveAction(org.id, before.id);
  return (
    <EditFrame name="remove" title={`Remove ${before.title}`} subtitle={org.name} onBack={host.back} go="Remove the position" problem={null} busy={host.busy} note={`Those holding it stay, without it; positions under it report to no one. ${AT_ONCE}`} action={action} onGo={(tell) => host.play(action, host.back, tell)}>
      <span>{`${before.title} · ${powersText(before.powers)}`}</span>
    </EditFrame>
  );
}

/**
 * Delegate… (`org_delegate`, as a turn): someone acts for it with powers the reader holds there,
 * within limits, until a date; on someone's delegation, what it gives, changed where the reader may
 * delegate, and Revoke for its granter or a holder of `delegate`.
 */
export function DelegateSheet(props: { org: OrgView; who: string | null; host: PlayHost }) {
  const { org, host } = props;
  const existing = props.who === null ? undefined : org.delegations.find((d) => d.who.id === props.who);
  const [draft, setDraft] = useState(() => delegationDraft(props.who ?? "", existing ? { powers: existing.powers, ...(existing.limits?.payment !== undefined ? { payment: existing.limits.payment } : {}), ...(existing.limits?.month !== undefined ? { month: existing.limits.month } : {}) } : null, host.currency));
  const can = rulesControls(org);
  const name = existing?.who.name ?? org.people.find((p) => p.id === props.who)?.name ?? org.candidates.find((c) => c.id === props.who)?.name ?? null;
  const revoke = existing && mayRevoke(org, existing) ? { label: "Revoke", onClick: () => void host.confirm("Revoke", `End ${existing.who.name}'s delegation? ${OFFSTAGE_NOTE}`, "Revoke").then((yes) => (yes ? host.play(revokeAction(org, existing.who.id), host.back) : undefined)) } : undefined;
  const title = name ? `${name} acts for it` : "Delegate";
  if (!can.delegate) {
    if (!existing) return null;
    return (
      <div class="lre-stack" data-lre-org-edit="delegation">
        <PageHeader title={title} subtitle={org.name} onBack={host.back} />
        <Card>
          <div class="lre-stack">
            <Row k="May" v={powersText(existing.powers)} />
            {existing.limits ? <Row k="Limits" v={limitWords(existing.limits).join(" · ") || "None"} /> : null}
            <Row k="Until" v={existing.until ?? "It is revoked"} />
            {existing.by ? <Row k="Granted by" v={existing.by.name} /> : null}
          </div>
        </Card>
        {revoke ? (
          <Button variant="danger" icon="close" block disabled={host.busy} onClick={revoke.onClick}>
            Revoke
          </Button>
        ) : null}
      </div>
    );
  }
  const people = props.who === null ? [...new Map([...org.people.filter((p) => !p.you).map((p): OrgRef => ({ id: p.id, name: p.name })), ...org.candidates].map((p) => [p.id, p])).values()].sort((a, b) => a.name.localeCompare(b.name)) : null;
  return (
    <EditFrame name="delegation" title={title} subtitle={org.name} onBack={host.back} go={existing ? "Change it" : "Delegate"} problem={delegationProblem(draft, host.currency)} busy={host.busy} note={AT_ONCE} action={delegateAction(org.id, draft, host.currency)} onGo={(tell) => host.play(delegateAction(org.id, draft, host.currency), host.back, tell)} {...(revoke ? { danger: revoke } : {})}>
      <DelegationFields draft={draft} people={people} offer={givable(org)} granters={null} kept={existing?.until ?? null} currency={host.currency} onChange={setDraft} />
    </EditFrame>
  );
}

/** Set dues (`org_dues`, at once); No dues ends them. */
export function DuesSheet(props: { org: OrgView; host: PlayHost }) {
  const { org, host } = props;
  const [draft, setDraft] = useState(() => duesDraft(org.dues, host.currency));
  const none = org.dues ? { label: "No dues", onClick: () => host.play(duesAction(org.id, { ...draft, amount: "" }, host.currency), host.back) } : undefined;
  return (
    <EditFrame name="dues" title="Dues" subtitle={org.name} onBack={host.back} go="Set dues" problem={duesProblem(draft, host.currency)} busy={host.busy} note={AT_ONCE} action={duesAction(org.id, draft, host.currency)} onGo={(tell) => host.play(duesAction(org.id, draft, host.currency), host.back, tell)} {...(none ? { danger: none } : {})}>
      <DuesFields draft={draft} currency={host.currency} onChange={setDraft} />
    </EditFrame>
  );
}

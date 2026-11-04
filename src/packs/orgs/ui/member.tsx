// Play's editors of an organization, each a sheet over its page (`org_edit`, ORG-SPEC §4.4, §4.6):
// - a member's sheet: their positions, title, rank and since, how they belong, the powers they hold
//   with what each rests on, the delegations they hold, and their job (pay, hours, schedule and
//   status, where the reader may see its money); then each control the reader may use there:
//   Appoint…, Change title…, Delegate…, Revoke…, Raise, Change hours, Put on leave (Back from
//   leave), Let go and Remove;
// - Hire someone and Admit a member;
// - a position, a delegation and the dues (Rules' editors).
// Each plays as the reader's action, through the palette's request: bookkeeping at once with its
// Undo, anything done to or with another person staged as their next turn. The engine judges each
// again, in its own words.

import { useId, useState } from "preact/hooks";
import { useApp, type SheetRoute } from "../../../frontend/app";
import { RefPicker } from "../../../frontend/build/form-kit";
import { Button, Card, Empty, Field, List, ListRow, PageHeader, Row, Section, useBusy } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { MoneyInput } from "../../../frontend/money-input";
import type { SheetProps } from "../../../frontend/registry";
import { PAY_BASES, PAY_CHOICE_LABELS, PAY_CHOICES } from "../../../shared/finance";
import { OFFSTAGE_NOTE } from "../../../shared/offstage";
import { toastQueued } from "../../../frontend/queued";
import { formatMoneyInput } from "../../../shared/money";
import type { OrgPowerView, OrgPersonView, OrgView } from "../../../shared/org-view";
import { ORGS_ORG_PANEL } from "../../../shared/org-view";
import { DEFAULT_CURRENCY } from "../../../shared/world";
import { decodeOrgPage } from "./decode";
import {
  admitAction,
  appointAction,
  appointable,
  hireAction,
  hireProblem,
  hoursAction,
  jobAction,
  MEMBER_CONTROL_LABELS,
  memberControls,
  newcomers,
  orgEditOf,
  orgEditRoute,
  payoutAction,
  payoutProblem,
  raiseAction,
  removeAction,
  revokeAction,
  staffJobOf,
  titleAction,
  type AdmitForm,
  type HireForm,
  type MemberControl,
  type StaffJobInfo,
} from "./edit";
import { AT_ONCE, DelegateSheet, DuesSheet, EditFrame, PositionSheet, type PlayHost } from "./rules";
import { andList, limitWords, powerFamilies, powersText } from "./words";

/** How someone belongs there, in words: "Owner (100%)", "Staff", "Member", a party tier. */
const HOW_LABELS: Readonly<Record<string, string>> = { member: "Member", owner: "Owner", staff: "Staff", leader: "Leader", core: "Core", companion: "Companion", hired: "Hired", ally: "Ally" };

/** What a person's powers rest on, in words, each basis once: "as owner", "as Shop foreman", "by delegation from Marcus Delgado", "as a member". */
export function heldWords(org: OrgView, person: OrgPersonView, held: readonly OrgPowerView[]): string {
  const words = held.map((h) => {
    if (h.basis === "owner") return "as owner";
    if (h.basis === "position") return `as ${org.positions.find((p) => p.id === h.id)?.title ?? person.position?.title ?? "its officer"}`;
    if (h.basis === "delegate") {
      const by = org.delegations.find((d) => d.who.id === person.id && d.by?.id === h.id)?.by?.name;
      return by ? `by delegation from ${by}` : "by delegation";
    }
    return "as a member";
  });
  const text = andList([...new Set(words)]);
  return text === "" ? "" : text[0]?.toUpperCase() + text.slice(1);
}

/**
 * A member's sheet's facts (§4.4), as rows and lists: their title, position, rank and since, how they
 * belong (an owner's share), the powers they hold by family with what each rests on, the
 * delegations they hold, and their job: its pay, hours, schedule, next payday and status where the
 * reader may see its money (`job`), else whether they're working or on leave.
 */
export function MemberDetails(props: { org: OrgView; person: OrgPersonView; job: StaffJobInfo | null }) {
  const { org, person, job } = props;
  const families = powerFamilies(person.powers.map((p) => p.power));
  const theirs = org.delegations.filter((d) => d.who.id === person.id);
  const how = person.hows.map((h) => (h === "owner" && person.share !== null ? `Owner (${Number(person.share.toFixed(2))}%)` : (HOW_LABELS[h] ?? humanize(h))));
  return (
    <div class="lre-stack" data-lre-org-member-details={person.id}>
      <Card>
        <div class="lre-stack">
          <Row k="Title" v={person.title} />
          {person.position ? <Row k="Position" v={person.position.title} /> : null}
          {person.rank !== null ? <Row k="Rank" v={String(person.rank)} /> : null}
          {person.since ? <Row k="Since" v={person.since} /> : null}
          <Row k="Belongs as" v={how.join(", ") || "—"} />
          {person.via ? <Row k="Through" v={person.via.name} /> : null}
        </div>
      </Card>
      <Section title="What they may do" flush>
        <List>
          {families.length === 0 ? (
            <ListRow title="None of its powers" />
          ) : (
            families.map((f) => <ListRow key={f.family} title={f.family} subtitle={f.words.length > 0 ? f.words.join(", ") : undefined} value={heldWords(org, person, person.powers.filter((p) => f.powers.includes(p.power)))} valueTone="muted" />)
          )}
        </List>
      </Section>
      {theirs.length > 0 ? (
        <Section title="Delegations they hold" flush>
          <List>
            {theirs.map((d, i) => (
              <ListRow key={i} icon="key" title={powersText(d.powers)} subtitle={[d.until ? `Until ${d.until}` : "Until it is revoked", d.by ? `from ${d.by.name}` : null, ...(d.limits ? limitWords(d.limits) : [])].filter((p) => p !== null).join(" · ")} />
            ))}
          </List>
        </Section>
      ) : null}
      {person.job !== null ? (
        <div data-lre-org-member-job={person.job}>
          <Section title="Their job" flush>
            <List>
              {job ? <ListRow icon="coins" title="Pay" value={job.pay} /> : null}
              {job?.hoursPerWeek !== null && job?.hoursPerWeek !== undefined ? <ListRow icon="clock" title="Hours" value={`${job.hoursPerWeek} a week`} /> : null}
              {job ? <ListRow icon="calendar" title="Paid" value={job.schedule} subtitle={job.nextPay ? `Next payday ${job.nextPay}` : undefined} /> : null}
              <ListRow icon="briefcase" title="Status" value={person.status === "leave" ? "On leave" : "Working"} />
            </List>
          </Section>
        </div>
      ) : null}
    </div>
  );
}

/** A control that takes nothing more asks first: what it does, in words. */
function confirmWords(control: MemberControl, person: OrgPersonView, org: OrgView): string {
  switch (control) {
    case "revoke":
      return `End ${person.name}'s delegation to act for ${org.name}?`;
    case "leave":
      return `Put ${person.name} on leave? They keep the job and are paid nothing while it lasts.`;
    case "back":
      return `Bring ${person.name} back from leave? They're paid again from their next payday.`;
    case "let_go":
      return `Let ${person.name} go from ${org.name}? Their last paycheck pays through today.`;
    default:
      return `Remove ${person.name} from ${org.name}?`;
  }
}

function TextField(props: { label: string; value: string; type?: "text" | "number"; help?: string; placeholder?: string; onInput(value: string): void }) {
  const id = useId();
  return (
    <Field label={props.label} help={props.help} for={id}>
      {props.type === "number" ? (
        <input id={id} class="lre-input" type="number" placeholder={props.placeholder} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
      ) : (
        <input id={id} class="lre-input" type="text" placeholder={props.placeholder} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
      )}
    </Field>
  );
}

/** One of the member sheet's own forms: Appoint…, Change title…, Raise or Change hours. */
function MemberForm(props: { org: OrgView; person: OrgPersonView; control: "appoint" | "title" | "raise" | "hours"; job: StaffJobInfo | null; host: PlayHost; onBack(): void }) {
  const { org, person, control, host } = props;
  const [position, setPosition] = useState(person.position?.id ?? "");
  const [title, setTitle] = useState(person.title);
  const [rate, setRate] = useState(props.job && props.job.rate > 0 ? formatMoneyInput(props.job.rate, host.currency) : "");
  const [hours, setHours] = useState(props.job?.hoursPerWeek !== null && props.job?.hoursPerWeek !== undefined ? String(props.job.hoursPerWeek) : "");
  const job = person.job ?? "";
  const action = control === "appoint" ? appointAction(org, person, position) : control === "title" ? titleAction(org, person, title) : control === "raise" ? raiseAction(job, rate, host.currency) : hoursAction(job, hours);
  const problem =
    action === null ? (control === "raise" ? "Type the new rate." : "Hours a week are more than none and at most 168.") : control === "appoint" && position === (person.position?.id ?? "") ? "Choose another position." : control === "title" && title.trim() === person.title ? "Type a new title, or none." : null;
  const go = { appoint: "Appoint", title: "Change title", raise: "Give the raise", hours: "Change hours" }[control];
  return (
    <EditFrame name={`member-${control}`} title={MEMBER_CONTROL_LABELS[control].replace("…", "")} subtitle={`${person.name} · ${org.name}`} onBack={props.onBack} go={go} problem={problem} busy={host.busy} note={AT_ONCE} action={action} onGo={(tell) => (action ? host.play(action, props.onBack, tell) : undefined)}>
      {control === "appoint" ? <RefPicker label="Position" value={position} options={appointable(org).map((p) => ({ value: p.id, label: p.title }))} none="No position" onChange={setPosition} /> : null}
      {control === "title" ? <TextField label="Title" value={title} help="Empty, they go by their position's title, or their job's." onInput={setTitle} /> : null}
      {control === "raise" ? (
        <Field label={props.job ? `New rate (now ${props.job.pay})` : "New rate"}>
          <MoneyInput currency={host.currency} value={rate} label="New rate" onInput={setRate} />
        </Field>
      ) : null}
      {control === "hours" ? <TextField label="Hours a week" type="number" value={hours} onInput={setHours} /> : null}
    </EditFrame>
  );
}

/** A member's sheet (§4.4): their facts, then each control the reader may use there, a form for those that take more, a confirmation for the rest. */
function MemberSheet(props: { org: OrgView; who: string | null; host: PlayHost; open(route: SheetRoute): void }) {
  const { org, host } = props;
  const [doing, setDoing] = useState<"appoint" | "title" | "raise" | "hours" | null>(null);
  const person = org.people.find((p) => p.id === props.who);
  if (!person) {
    return (
      <div class="lre-stack">
        <PageHeader title="Member" subtitle={org.name} onBack={host.back} />
        <Empty icon="users">They aren't in it any more, as far as you know.</Empty>
      </div>
    );
  }
  const job = staffJobOf(org, person.job);
  if (doing !== null) return <MemberForm org={org} person={person} control={doing} job={job} host={host} onBack={() => setDoing(null)} />;
  const controls = memberControls(org, person);
  const press = (control: MemberControl) => {
    if (control === "appoint" || control === "title" || control === "raise" || control === "hours") return setDoing(control);
    if (control === "delegate") return props.open(orgEditRoute(org.id, "delegate", person.id));
    const action = control === "revoke" ? revokeAction(org, person.id) : control === "remove" ? removeAction(org, person.id) : jobAction(control, person.job ?? "");
    void host.confirm(MEMBER_CONTROL_LABELS[control].replace("…", ""), `${confirmWords(control, person, org)} ${OFFSTAGE_NOTE}`, MEMBER_CONTROL_LABELS[control].replace("…", "")).then((yes) => (yes ? host.play(action) : undefined));
  };
  return (
    <div class="lre-stack" data-lre-org-member={person.id}>
      <PageHeader title={person.you ? `${person.name} (you)` : person.name} subtitle={[person.title, org.name].filter((part) => part !== "").join(" · ")} onBack={host.back} />
      <MemberDetails org={org} person={person} job={job} />
      {controls.length > 0 ? (
        <div data-lre-org-member-controls>
          <Section title="What you may do">
            <div class="lre-stack">
              {controls.map((control) => (
                <Button key={control} variant={control === "let_go" || control === "remove" || control === "revoke" ? "danger" : "secondary"} block disabled={host.busy} onClick={() => press(control)}>
                  {MEMBER_CONTROL_LABELS[control]}
                </Button>
              ))}
            </div>
          </Section>
        </div>
      ) : null}
      {!person.you ? (
        <Button variant="ghost" icon="user" block onClick={() => props.open({ kind: "person", id: person.id })}>
          {`${person.name}'s page`}
        </Button>
      ) : null}
    </div>
  );
}

const BASIS_LABELS: Readonly<Record<string, string>> = { salary: "A salary", hourly: "By the hour", per_shift: "By the shift", commission: "On commission", tips: "On tips", stipend: "A stipend" };

/** Hire someone (`job_hire`, as a turn): whom, as what, in which position, and their pay; what it leaves out comes from their occupation and the employer's pay schedule. */
function HireSheet(props: { org: OrgView; host: PlayHost }) {
  const { org, host } = props;
  const [form, setForm] = useState<HireForm>({ worker: "", title: "", position: "", basis: "hourly", rate: "", hours: "", every: "" });
  const set = (patch: Partial<HireForm>) => setForm((f) => ({ ...f, ...patch }));
  const people = newcomers(org, "hire");
  const action = hireAction(org, form, host.currency);
  return (
    <EditFrame name="hire" title="Hire someone" subtitle={org.name} onBack={host.back} go="Hire" problem={people.length === 0 ? "There's no one you know to hire." : hireProblem(form, host.currency)} busy={host.busy} note={AT_ONCE} action={action} onGo={(tell) => (action ? host.play(action, host.back, tell) : undefined)}>
      <RefPicker label="Whom" value={form.worker} options={people.map((p) => ({ value: p.id, label: p.name }))} onChange={(worker) => set({ worker })} />
      <TextField label="As" value={form.title} placeholder="Receptionist" onInput={(title) => set({ title })} />
      {appointable(org).length > 0 ? <RefPicker label="Position" value={form.position} options={appointable(org).map((p) => ({ value: p.id, label: p.title }))} none="No position" onChange={(position) => set({ position })} /> : null}
      <RefPicker label="Paid" value={form.basis} options={PAY_BASES.map((b) => ({ value: b, label: BASIS_LABELS[b] ?? humanize(b) }))} onChange={(basis) => set({ basis })} />
      <Field label="Rate (a year, an hour or a shift)">
        <MoneyInput currency={host.currency} value={form.rate} label="Rate" placeholder="As their trade pays" onInput={(rate) => set({ rate })} />
      </Field>
      <TextField label="Hours a week" type="number" value={form.hours} placeholder="As their trade works" onInput={(hours) => set({ hours })} />
      <RefPicker label="Paydays" value={form.every} options={PAY_CHOICES.filter((e) => e !== "custom").map((e) => ({ value: e, label: PAY_CHOICE_LABELS[e] }))} none="As the others are paid" onChange={(every) => set({ every })} />
    </EditFrame>
  );
}

/** Admit a member (`org_admit`, as a turn): whom, with a title of their own, into a position or its default one. */
function AdmitSheet(props: { org: OrgView; host: PlayHost }) {
  const { org, host } = props;
  const [form, setForm] = useState<AdmitForm>({ who: "", title: "", position: "" });
  const set = (patch: Partial<AdmitForm>) => setForm((f) => ({ ...f, ...patch }));
  const people = newcomers(org, "admit");
  const action = admitAction(org, form);
  const joins = appointable(org).find((p) => p.id === org.defaultPosition)?.title;
  return (
    <EditFrame name="admit" title="Admit a member" subtitle={org.name} onBack={host.back} go="Admit" problem={people.length === 0 ? "There's no one you know to admit." : form.who === "" ? "Choose whom to admit." : null} busy={host.busy} note={AT_ONCE} action={action} onGo={(tell) => (action ? host.play(action, host.back, tell) : undefined)}>
      <RefPicker label="Whom" value={form.who} options={people.map((p) => ({ value: p.id, label: p.name }))} onChange={(who) => set({ who })} />
      <TextField label="Title" value={form.title} placeholder="Member" onInput={(title) => set({ title })} />
      {appointable(org).length > 0 ? <RefPicker label="Position" value={form.position} options={appointable(org).map((p) => ({ value: p.id, label: p.title }))} none={joins ? `${joins}, as new members join` : "No position"} onChange={(position) => set({ position })} /> : null}
    </EditFrame>
  );
}

/** A trust's payout (`distribute_profit` with an amount, DESIGN §29.7): a stated amount of its money, to its beneficiaries by their shares. */
function PayoutSheet(props: { org: OrgView; host: PlayHost }) {
  const { org, host } = props;
  const [text, setText] = useState("");
  const beneficiaries = org.people.filter((p) => p.role === "beneficiary");
  const action = payoutAction(org.id, text, host.currency);
  return (
    <EditFrame name="payout" title="Pay out to its beneficiaries" subtitle={org.name} onBack={host.back} go="Pay it out by share" problem={payoutProblem(text, host.currency)} busy={host.busy} note={AT_ONCE} action={action} onGo={(tell) => (action ? host.play(action, host.back, tell) : undefined)}>
      {beneficiaries.length > 0 ? (
        <List>
          {beneficiaries.map((p) => (
            <ListRow key={p.id} icon="user" title={p.you ? `${p.name} (you)` : p.name} value={p.share !== null ? `${Number(p.share.toFixed(2))}%` : undefined} valueTone="muted" />
          ))}
        </List>
      ) : null}
      <Field label="Amount">
        <MoneyInput currency={host.currency} value={text} label="Amount" onInput={setText} invalid={text.trim() !== "" && action === null} />
      </Field>
    </EditFrame>
  );
}

/** The `org_edit` sheet: the editor its route names, over the organization's page as the player character may see it. */
export function OrgEditSheet(props: SheetProps) {
  const app = useApp();
  const [busy, run] = useBusy();
  const target = orgEditOf(props.id);
  const org = target ? decodeOrgPage(props.state.panels[ORGS_ORG_PANEL], target.org) : null;
  if (!target || !org) {
    return (
      <div class="lre-stack">
        <PageHeader title="Organization" onBack={props.close} />
        <Empty icon="briefcase">You don't know of it any more.</Empty>
      </div>
    );
  }
  const host: PlayHost = {
    currency: props.state.currency ?? DEFAULT_CURRENCY,
    busy,
    play: (a, done, tell) =>
      run(async () => {
        const result = await app.request({ type: "lre.action", chatId: props.chatId, action: a.action, params: a.params, source: "palette", ...(tell !== undefined ? { tell } : {}) });
        if (result && "pending" in result) toastQueued(app, result);
        if (result !== null) done?.();
      }),
    confirm: (title, message, ok) => app.host.confirm(title, message, "danger", ok),
    back: props.close,
  };
  switch (target.form) {
    case "member":
      return <MemberSheet org={org} who={target.id} host={host} open={props.open} />;
    case "hire":
      return <HireSheet org={org} host={host} />;
    case "admit":
      return <AdmitSheet org={org} host={host} />;
    case "position":
      return <PositionSheet org={org} id={target.id} host={host} />;
    case "delegate":
      return <DelegateSheet org={org} who={target.id} host={host} />;
    case "dues":
      return <DuesSheet org={org} host={host} />;
    case "payout":
      return <PayoutSheet org={org} host={host} />;
  }
}

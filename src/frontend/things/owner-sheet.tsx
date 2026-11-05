// Owner & use… (Play → Me → Belongings, the item sheet, the Garage): whose a thing of the player's is
// and who may use it, changed at once, off screen, each change one ✎ fix with its Undo in the
// notice at the top. Whose: theirs, their household's or nobody's (DESIGN §9.3; anyone else's is a
// Give, a Lend or a sale, never a ✎). Who may use it: each ground as the engine names it, then each
// grant with its end and Stop, then Let someone use it… with an optional end. Hand it over: Give,
// Lend (until an end) or Hand to hold, to someone here; the story is told of those.

import { useState } from "preact/hooks";
import type { ChatId, EntityId } from "../../shared/ids";
import type { LoanChoice } from "../../shared/thing-gm";
import type { FixHandBasis, FixOwner, GrantBasis, ItemFix } from "../../shared/things";
import { GRANT_WORDS, partyPossessive } from "../../shared/thing-view";
import { FormSheet } from "../build/form-kit";
import { Badge, Button, Empty, HostSelect, List, ListRow, Section, Seg } from "../components";
import { AtOnceNotice, thingsFix, useAtOnce } from "./at-once";

/** A thing as Owner & use… shows it: whose it is now (`other`: someone else's, named), who may use it on what ground, and its grants. */
export interface OwnerUseThing {
  id: EntityId;
  name: string;
  owner: "self" | "household" | "nobody" | "other";
  ownerName?: string;
  use: readonly { label: string; who: readonly string[] }[];
  grants: readonly { who: EntityId; name: string; basis: GrantBasis; until?: string; overdue?: true }[];
}

/** A person or household as the sheet names them. */
export interface Named {
  id: EntityId;
  name: string;
}

/** The owner choices: the player's own, their household's when they have one, nobody's. */
export type OwnerChoice = "self" | "household" | "nobody";

const OWNER_FIX: Readonly<Record<OwnerChoice, FixOwner>> = { self: "self", household: "household", nobody: null };

/** What making it someone's says. */
export function ownerWords(name: string, owner: OwnerChoice, household: Named | null): string {
  if (owner === "self") return `${name} is yours now.`;
  if (owner === "household") return `${name} is ${household ? partyPossessive({ name: household.name, is: "household" }) : "your household's"} now.`;
  return `${name} is nobody's now: anyone may use it.`;
}

/** What a handover says: a gift, a loan with its end, or held for you. */
export function handWords(name: string, to: string, basis: FixHandBasis, until?: string): string {
  if (basis === "gift") return `${name} is ${partyPossessive({ name: to, is: "person" })} now, a gift.`;
  if (basis === "loan") return `${to} has ${name} on loan${until ? `, ${until.charAt(0).toLowerCase()}${until.slice(1)}` : ""}.`;
  if (basis === "return") return `${name} is back with ${to}.`;
  return `${to} is holding ${name} for you.`;
}

/** A grant's line: on what ground, until when, overdue. */
function grantLine(g: OwnerUseThing["grants"][number]): string {
  return [GRANT_WORDS[g.basis], g.until ? `until ${g.until}` : null].filter((p) => p !== null).join(" · ");
}

export function OwnerUseSheet(props: { chatId: ChatId; thing: OwnerUseThing; people: readonly Named[]; loans: readonly LoanChoice[]; household: Named | null; onClose(): void; onDone?(): void }) {
  const { thing } = props;
  const atOnce = useAtOnce(props.chatId);
  const [who, setWho] = useState(props.people[0]?.id ?? "");
  const [end, setEnd] = useState("");
  const [to, setTo] = useState(props.people[0]?.id ?? "");
  const [loan, setLoan] = useState(0);
  const person = (id: string): Named | undefined => props.people.find((p) => p.id === id);
  const send = (fix: ItemFix, text: string): void => atOnce.send(thingsFix(props.chatId, [fix], text), text, props.onDone);
  const owners: { value: OwnerChoice; label: string }[] = [{ value: "self", label: "Mine" }, ...(props.household ? [{ value: "household" as const, label: "Household" }] : []), { value: "nobody", label: "Nobody's" }];
  const loanEnd = props.loans[loan];
  const busy = atOnce.busy;
  return (
    <FormSheet title="Owner & use" subtitle={thing.name} onClose={props.onClose}>
      <div class="lre-stack" data-lre-owner-sheet={thing.id}>
        <AtOnceNotice done={atOnce.done} busy={busy} onUndo={atOnce.undo} onDismiss={atOnce.dismiss} />
        <Section title="Whose">
          {thing.owner === "other" ? (
            <span class="lre-small lre-muted">{`${thing.ownerName ?? "Someone else"}'s. Giving it away is theirs to do.`}</span>
          ) : (
            <div class="lre-stack">
              <Seg<OwnerChoice> label="Whose it is" value={thing.owner} options={owners} disabled={busy} onChange={(next) => next !== thing.owner && send({ do: "own", item: thing.id, owner: OWNER_FIX[next] }, ownerWords(thing.name, next, props.household))} />
              <span class="lre-field-help">{props.household ? `Household: ${props.household.name}. ` : ""}To make it someone else's, give it, lend it or sell it.</span>
            </div>
          )}
        </Section>
        <Section title="Who may use it" flush>
          {thing.use.length === 0 && thing.grants.length === 0 ? <Empty icon="user">Only its owner.</Empty> : null}
          <List>
            {thing.use.map((chip) => (
              <ListRow key={chip.label} icon="users" title={chip.label} subtitle={chip.who.length > 0 ? chip.who.join(", ") : undefined} />
            ))}
            {thing.grants.map((g) => (
              <ListRow
                key={g.who}
                icon="user-plus"
                title={g.name}
                subtitle={grantLine(g)}
                badge={g.overdue ? <Badge tone="warn">Overdue</Badge> : undefined}
                value={
                  <Button size="sm" variant="ghost" icon="close" disabled={busy} label={`Stop ${g.name} using it`} onClick={() => send({ do: "revoke", item: thing.id, who: g.who }, `${g.name} may no longer use ${thing.name}.`)}>
                    Stop
                  </Button>
                }
              />
            ))}
          </List>
        </Section>
        {props.people.length === 0 ? (
          <Empty icon="users">Nobody is here to let use it or hand it to.</Empty>
        ) : (
          <>
            <Section title="Let someone use it">
              <div class="lre-stack" data-lre-owner-grant="">
                <HostSelect label="Who" value={who} options={props.people.map((p) => ({ value: p.id, label: p.name }))} onChange={setWho} />
                <HostSelect label="Until" value={end} options={[{ value: "", label: "No end" }, ...props.loans.map((l, i) => ({ value: String(i), label: l.label }))]} onChange={setEnd} />
                <Button
                  icon="user-plus"
                  disabled={busy || !person(who) || thing.owner === "other"}
                  onClick={() => {
                    const choice = end === "" ? undefined : props.loans[Number(end)];
                    send({ do: "grant", item: thing.id, who, ...(choice ? { until: choice.until } : {}) }, `${person(who)?.name ?? who} may use ${thing.name}${choice ? `, ${choice.label.charAt(0).toLowerCase()}${choice.label.slice(1)}` : ""}.`);
                  }}
                >
                  Let them use it
                </Button>
              </div>
            </Section>
            <Section title="Hand it over">
              <div class="lre-stack" data-lre-owner-hand="">
                <HostSelect label="To" value={to} options={props.people.map((p) => ({ value: p.id, label: p.name }))} onChange={setTo} />
                {props.loans.length > 0 ? <HostSelect label="A loan until" value={String(loan)} options={props.loans.map((l, i) => ({ value: String(i), label: l.label }))} onChange={(next) => setLoan(Number(next))} /> : null}
                <div class="lre-inline">
                  <Button size="sm" icon="user-plus" disabled={busy || !person(to) || thing.owner === "other"} onClick={() => send({ do: "hand", item: thing.id, to, basis: "gift" }, handWords(thing.name, person(to)?.name ?? to, "gift"))}>
                    Give
                  </Button>
                  <Button size="sm" icon="clock" disabled={busy || !person(to) || !loanEnd || thing.owner === "other"} onClick={() => loanEnd && send({ do: "hand", item: thing.id, to, basis: "loan", until: loanEnd.until }, handWords(thing.name, person(to)?.name ?? to, "loan", loanEnd.label))}>
                    Lend
                  </Button>
                  <Button size="sm" icon="bag" disabled={busy || !person(to)} onClick={() => send({ do: "hand", item: thing.id, to, basis: "hold" }, handWords(thing.name, person(to)?.name ?? to, "hold"))}>
                    Hand to hold
                  </Button>
                </div>
                <span class="lre-field-help">Done at once, off screen; the story hears of it.</span>
              </div>
            </Section>
          </>
        )}
      </div>
    </FormSheet>
  );
}

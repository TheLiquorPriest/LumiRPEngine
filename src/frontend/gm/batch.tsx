// GM → World, Change the selected (DESIGN §7): one change for everyone picked in the list, each its
// GM edit op per entity, sent in chunks of `EDIT_OPS_MAX`, each chunk one edit with its own Undo.
// Every control starts on "Choose…", so nothing applies until the GM picks a value, and each card
// says how those it reaches stand now. A tier and a domain's level go to the people picked unless the
// GM widens them to everything picked; their routine's role, a fidelity pin and an intent to the
// characters among them (never the player character, who has no mind here); a move to anything not
// removed. Once applied, the GM view says what changed, with one Undo for all of it. GM data, behind
// the gate.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import type { DomainId, EntityId, Level, PlaceId, TierId } from "../../shared/ids";
import type { Fidelity, MindApproach } from "../../shared/minds";
import { FIDELITIES, MIND_APPROACHES, MIND_TEXT_CAPS } from "../../shared/minds";
import type { RoutineRole } from "../../shared/routines";
import { ROUTINE_ROLE_LABEL, ROUTINE_ROLES } from "../../shared/routines";
import type { GmView } from "../../shared/state-view";
import { APPROACH_LABEL, FIDELITY_LABEL } from "../../packs/minds/ui/ops";
import type { BulkChange } from "../batch";
import { bulkOps, forCharacters, mixOf } from "../batch";
import { Banner, Button, Field, HostSwitch, Section } from "../components";
import { LEVEL_LABEL } from "../settings/realism";
import type { BulkEditor, Editor } from "./editor";
import { GmPage } from "./ui";

const LEVELS: readonly Level[] = [0, 1, 2, 3, 4];

/**
 * What the GM has chosen on each card; null is "Choose…": nothing chosen, so the card can't apply.
 * A choice that hands a setting back is its own value ("tier", "world", "score", "mind"), never null.
 */
export interface BatchChoices {
  tier: TierId | null;
  domain: DomainId | null;
  level: Level | "tier" | null;
  role: RoutineRole | "world" | null;
  pin: Fidelity | "score" | null;
  text: string;
  approach: MindApproach | "mind" | null;
  to: PlaceId | null;
  /** A tier or a level reaches the people picked, unless widened to everything picked. */
  tierAll: boolean;
  levelAll: boolean;
}

export const BLANK_CHOICES: BatchChoices = { tier: null, domain: null, level: null, role: null, pin: null, text: "", approach: null, to: null, tierAll: false, levelAll: false };

type Card = BulkChange["kind"];

/** Each card's change as chosen so far: null until its every control has a value (an intent over its length cap stays null). */
export function batchChanges(c: BatchChoices): Record<Card, BulkChange | null> {
  const intent: BulkChange | null = c.text.trim() === "" && c.approach === null ? null : { kind: "intent", text: c.text, approach: c.approach === "mind" || c.approach === null ? null : c.approach };
  return {
    tier: c.tier === null ? null : { kind: "tier", tier: c.tier },
    level: c.domain === null || c.level === null ? null : { kind: "level", domain: c.domain, level: c.level === "tier" ? null : c.level },
    role: c.role === null ? null : { kind: "role", role: c.role === "world" ? null : c.role },
    pin: c.pin === null ? null : { kind: "pin", level: c.pin === "score" ? null : c.pin },
    intent: intent && bulkOps([], intent) !== null ? intent : null,
    move: c.to === null ? null : { kind: "move", to: c.to },
  };
}

/**
 * Who a kind of change reaches among those picked: the characters for a mind or routine change,
 * anyone not removed for a move; for a tier or a level, the people picked, or everything picked
 * when `everything`.
 */
export function bulkTargets(editor: Pick<Editor, "gm">, ids: readonly EntityId[], kind: Card, everything = false): EntityId[] {
  if (forCharacters(kind)) return ids.filter((id) => editor.gm.minds.characters.some((c) => c.entity === id));
  if (kind === "move") return ids.filter((id) => editor.gm.entities.some((e) => e.id === id && !e.gone));
  return everything ? [...ids] : ids.filter((id) => editor.gm.entities.some((e) => e.id === id && e.person));
}

/** Who is picked, in words: how many people (and whether the player character is one of them) and how many things. */
export function pickedSummary(gm: Pick<GmView, "entities">, ids: readonly EntityId[]): string {
  const picked = gm.entities.filter((e) => ids.includes(e.id));
  const people = picked.filter((e) => e.person);
  const you = people.some((e) => e.pov);
  const things = picked.length - people.length;
  const who = people.length === 0 ? null : you ? (people.length === 1 ? "you" : `${people.length} people, you among them`) : people.length === 1 ? "1 person" : `${people.length} people`;
  return [who, things === 0 ? null : things === 1 ? "1 thing" : `${things} things`].filter((part) => part !== null).join(" and ");
}

/** How a character's routine stands in this chat, in the routine card's own values: the role this chat set for them, else "world" (their level's, as the world sets it). */
export function routineStanding(gm: Pick<GmView, "routineRoles">, entity: EntityId): RoutineRole | "world" {
  return gm.routineRoles.find((r) => r.entity === entity)?.role ?? "world";
}

/** What a change did, for the notice it leaves: "Pinned 3 to Near", "Moved 2 to The Rusty Anchor". */
export function bulkDone(gm: Pick<GmView, "tiers" | "domains" | "places">, change: BulkChange, count: number): string {
  switch (change.kind) {
    case "tier":
      return `Set ${count} to ${gm.tiers.find((t) => t.id === change.tier)?.label ?? change.tier}`;
    case "level": {
      const area = gm.domains.find((d) => d.id === change.domain)?.label ?? change.domain;
      return change.level === null ? `${area} back to the tier for ${count}` : `${area} set to ${change.level} · ${LEVEL_LABEL[change.level]} for ${count}`;
    }
    case "role":
      return change.role === null ? `Routine back to the world's for ${count}` : `Routine set to ${ROUTINE_ROLE_LABEL[change.role]} for ${count}`;
    case "pin":
      return change.level === null ? `Unpinned ${count}` : `Pinned ${count} to ${FIDELITY_LABEL[change.level]}`;
    case "intent":
      return change.text.trim() === "" && change.approach === null ? `Cleared the intent of ${count}` : `Gave ${count} your intent`;
    case "move":
      return `Moved ${count} to ${gm.places.find((p) => p.id === change.to)?.name ?? change.to}`;
  }
}

/** One change's card: its controls, how those it reaches stand now, and Apply, which stays off until every control has a value and someone picked fits it. */
export function ChangeCard(props: { title: string; note: string; change: BulkChange | null; reach: number; now: string | null; busy: boolean; onApply(change: BulkChange): void; children: ComponentChildren }) {
  const { change } = props;
  return (
    <Section title={props.title}>
      <div class="lre-stack">
        {props.children}
        {props.now ? <p class="lre-batch-now">Now: {props.now}</p> : null}
        <p class="lre-gm-note">{props.note}</p>
        <Button variant="primary" icon="check" disabled={props.busy || change === null || props.reach === 0} onClick={() => change && props.onApply(change)}>
          {change === null ? "Apply" : props.reach === 0 ? "None of them fit" : `Apply to ${props.reach}`}
        </Button>
      </div>
    </Section>
  );
}

export function BatchPage(props: { editor: BulkEditor; ids: readonly EntityId[]; onBack(): void }) {
  const { editor, ids } = props;
  const gm = editor.gm;
  const [choices, setChoices] = useState<BatchChoices>(BLANK_CHOICES);
  const [outcome, setOutcome] = useState<string | null>(null);
  const field = { tier: useId(), domain: useId(), level: useId(), role: useId(), pin: useId(), text: useId(), approach: useId(), place: useId() };
  const choose = (patch: Partial<BatchChoices>) => setChoices((c) => ({ ...c, ...patch }));
  const changes = batchChanges(choices);
  const everything: Record<Card, boolean> = { tier: choices.tierAll, level: choices.levelAll, role: false, pin: false, intent: false, move: false };
  // Who each card reaches as it stands: the "Now" line and Apply's count read them before anything is chosen.
  const reach = (card: Card) => bulkTargets(editor, ids, card, everything[card]);
  const entities = (targets: readonly EntityId[]) => gm.entities.filter((e) => targets.includes(e.id));
  const characters = (targets: readonly EntityId[]) => gm.minds.characters.filter((c) => targets.includes(c.entity));
  const tiered = entities(reach("tier"));
  const leveled = entities(reach("level"));
  const others = ids.length - bulkTargets(editor, ids, "tier").length;
  const chars = characters(reach("pin"));
  const placed = entities(reach("move"));
  const tierOf = (id: string) => gm.tiers.find((t) => t.id === id)?.label ?? id;
  const levelOf = (e: (typeof leveled)[number]): string => {
    const level = LEVELS.find((n) => n === e.levels.find((l) => l.domain === choices.domain)?.override);
    return level === undefined ? "from the tier" : `set to ${level} · ${LEVEL_LABEL[level]}`;
  };
  const routineOf = (id: EntityId): string => {
    const standing = routineStanding(gm, id);
    return standing === "world" ? "as the world has it" : `set to ${ROUTINE_ROLE_LABEL[standing]}`;
  };
  const apply = (card: Card, change: BulkChange) => {
    const ops = bulkOps(reach(card), change);
    if (!ops || ops.length === 0) return;
    void editor.editAll(ops, (count) => bulkDone(gm, change, count)).then(({ applied, of }) => {
      if (applied === of) props.onBack();
      else setOutcome(applied === 0 ? "Nothing changed: the first edit was refused." : `${applied} of ${of} edits applied; the next was refused, so the rest weren't sent. Each applied edit has its own Undo.`);
    });
  };
  const card = (name: Card) => ({ change: changes[name], busy: editor.busy, onApply: (change: BulkChange) => apply(name, change) });
  const widen = (key: "tierAll" | "levelAll") =>
    others > 0 ? <HostSwitch checked={choices[key]} label={others === 1 ? "Also the 1 picked that isn't a person" : `Also the ${others} picked that aren't people`} onChange={(checked) => choose({ [key]: checked })} /> : null;
  const charactersOnly = "It reaches the characters picked, never your own character.";
  return (
    <GmPage name="batch" title={ids.length === 1 ? "Change 1 selected" : `Change ${ids.length} selected`} subtitle={pickedSummary(gm, ids)} backLabel="World" onBack={props.onBack}>
      <div class="lre-stack" data-lre-gm-batch={ids.length}>
        <p class="lre-gm-note">Pick a value, then Apply. Each change is saved as one edit you can undo (one for every 64 it changes).</p>
        {outcome ? <Banner tone="warn">{outcome}</Banner> : null}
        <ChangeCard title="Tier" note="How important they are to the story, which sets how much detail the engine keeps on them." reach={tiered.length} now={tiered.length > 0 ? mixOf(tiered.map((e) => tierOf(e.tier))) : null} {...card("tier")}>
          <Field label="Tier" for={field.tier}>
            <select id={field.tier} class="lre-input" value={choices.tier ?? ""} onChange={(event) => choose({ tier: event.currentTarget.value === "" ? null : event.currentTarget.value })}>
              <option value="">Choose a tier…</option>
              {gm.tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          {widen("tierAll")}
        </ChangeCard>
        <ChangeCard
          title="Detail in one area"
          note="How closely the engine follows them in one area, over what their tier gives. “From the tier” goes back to the tier's."
          reach={leveled.length}
          now={choices.domain === null || leveled.length === 0 ? null : mixOf(leveled.map(levelOf))}
          {...card("level")}
        >
          <Field label="Area" for={field.domain}>
            <select id={field.domain} class="lre-input" value={choices.domain ?? ""} onChange={(event) => choose({ domain: gm.domains.find((d) => d.id === event.currentTarget.value)?.id ?? null })}>
              <option value="">Choose an area…</option>
              {gm.domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Level" for={field.level}>
            <select id={field.level} class="lre-input" value={choices.level === null ? "" : String(choices.level)} onChange={(event) => choose({ level: event.currentTarget.value === "tier" ? "tier" : (LEVELS.find((n) => String(n) === event.currentTarget.value) ?? null) })}>
              <option value="">Choose a level…</option>
              <option value="tier">From the tier</option>
              {LEVELS.map((n) => (
                <option key={n} value={String(n)}>
                  {n} · {LEVEL_LABEL[n]}
                </option>
              ))}
            </select>
          </Field>
          {widen("levelAll")}
        </ChangeCard>
        <ChangeCard
          title="Their routine"
          note={`How much their usual day steers them in this chat. “As the world has it” undoes this chat's choice. ${charactersOnly}`}
          reach={chars.length}
          now={chars.length > 0 ? mixOf(chars.map((c) => routineOf(c.entity))) : null}
          {...card("role")}
        >
          <Field label="Routine role" for={field.role}>
            <select id={field.role} class="lre-input" value={choices.role ?? ""} onChange={(event) => choose({ role: event.currentTarget.value === "world" ? "world" : (ROUTINE_ROLES.find((r) => r === event.currentTarget.value) ?? null) })}>
              <option value="">Choose…</option>
              <option value="world">As the world has it</option>
              {ROUTINE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROUTINE_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
        </ChangeCard>
        <ChangeCard
          title="Pin their fidelity"
          note={`Keeps their mind at one level of attention in this chat, whatever happens. “By score” lets the engine decide again. ${charactersOnly}`}
          reach={chars.length}
          now={chars.length > 0 ? mixOf(chars.map((c) => (c.fidelity.pin.gm === null ? "by score" : `pinned to ${FIDELITY_LABEL[c.fidelity.pin.gm]}`))) : null}
          {...card("pin")}
        >
          <Field label="Fidelity" for={field.pin}>
            <select id={field.pin} class="lre-input" value={choices.pin ?? ""} onChange={(event) => choose({ pin: event.currentTarget.value === "score" ? "score" : (FIDELITIES.find((f) => f === event.currentTarget.value) ?? null) })}>
              <option value="">Choose…</option>
              <option value="score">By score</option>
              {FIDELITIES.map((f) => (
                <option key={f} value={f}>
                  {FIDELITY_LABEL[f]}
                </option>
              ))}
            </select>
          </Field>
        </ChangeCard>
        <ChangeCard
          title="Your intent for them"
          note={`What each of them means to do now; only their own mind reads it. Leave the text blank and choose “Their mind decides” to clear it. ${charactersOnly}`}
          reach={chars.length}
          now={chars.length > 0 ? mixOf(chars.map((c) => (c.intent ? "with your intent" : "without your intent"))) : null}
          {...card("intent")}
        >
          <Field label="What they mean to do" for={field.text} help={`${choices.text.length} / ${MIND_TEXT_CAPS.gmIntent}`}>
            <textarea id={field.text} class="lre-input lre-gm-prose" rows={3} maxLength={MIND_TEXT_CAPS.gmIntent} value={choices.text} onInput={(event) => choose({ text: event.currentTarget.value })} />
          </Field>
          <Field label="How they go about it" for={field.approach}>
            <select id={field.approach} class="lre-input" value={choices.approach ?? ""} onChange={(event) => choose({ approach: event.currentTarget.value === "mind" ? "mind" : (MIND_APPROACHES.find((a) => a === event.currentTarget.value) ?? null) })}>
              <option value="">Choose…</option>
              <option value="mind">Their mind decides</option>
              {MIND_APPROACHES.map((a) => (
                <option key={a} value={a}>
                  {APPROACH_LABEL[a]}
                </option>
              ))}
            </select>
          </Field>
        </ChangeCard>
        <ChangeCard
          title="Move to a place"
          note="Moves each of them there, as Move on their page does. Anyone removed stays where they are."
          reach={placed.length}
          now={placed.length > 0 ? mixOf(placed.map((e) => (e.place === null ? "nowhere" : `at ${gm.places.find((p) => p.id === e.place)?.name ?? e.place}`))) : null}
          {...card("move")}
        >
          <Field label="Place" for={field.place}>
            <select id={field.place} class="lre-input" value={choices.to ?? ""} onChange={(event) => choose({ to: event.currentTarget.value === "" ? null : event.currentTarget.value })}>
              <option value="">Choose a place…</option>
              {gm.places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </ChangeCard>
      </div>
    </GmPage>
  );
}

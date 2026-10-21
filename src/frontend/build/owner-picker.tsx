// Who a schedule or a routine is for, at the levels the engine ranks them (DESIGN §8): one person or
// thing, a group (its members: a family, a household, a crew), a kind (with inheritance), a selector,
// or no owner (a schedule's world process, a routine's world default). The level is picked first,
// then who at that level, so the form reads as the engine decides: where two set the same thing for
// someone, the most specific owner wins. Styles: styles/forms.ts.

import { useState } from "preact/hooks";
import { hasOwn, isRecord } from "../../shared/json";
import type { Selector, WorldDoc } from "../../shared/world";
import { Field, Seg } from "../components";
import { RefPicker, type RefOption } from "./form-kit";
import { kindIs, SelectorEditor, selectorOf } from "./selector-editor";

/** An owner as the world file keeps it: an entity or kind id, a selector, or none. */
export type Owner = string | Selector | undefined;

export type OwnerLevel = "entity" | "group" | "kind" | "selector" | "none";

/** The kind every group extends (the relationships pack's `group`). */
const GROUP_KIND = "group";

const LEVELS: readonly OwnerLevel[] = ["entity", "group", "kind", "selector", "none"];

/**
 * An owner's level as the engine ranks it (`ownerRank`): a selector; an entity, a group when its
 * kind is one; else a kind; none when unset. An id naming both an entity and a kind is the entity.
 */
export function ownerLevel(doc: WorldDoc, owner: unknown): OwnerLevel {
  if (isRecord(owner)) return "selector";
  if (typeof owner !== "string" || owner === "") return "none";
  const entity = hasOwn(doc.entities, owner) ? doc.entities[owner] : undefined;
  if (entity) return kindIs(doc, entity.kind, GROUP_KIND) ? "group" : "entity";
  return "kind";
}

/** Who can own at a level, by name: groups apart from everyone else, kinds by label. */
export function ownerOptions(doc: WorldDoc, level: OwnerLevel): RefOption[] {
  const kindLabel = (id: string): string => (hasOwn(doc.kinds, id) ? doc.kinds[id]?.label || id : id);
  const byName = (a: RefOption, b: RefOption): number => a.label.localeCompare(b.label) || a.value.localeCompare(b.value);
  switch (level) {
    case "entity":
    case "group":
      return Object.values(doc.entities)
        .filter((e) => kindIs(doc, e.kind, GROUP_KIND) === (level === "group"))
        .map((e) => ({ value: e.id, label: e.name || e.id, sublabel: kindLabel(e.kind) }))
        .sort(byName);
    case "kind":
      return Object.keys(doc.kinds)
        .map((id) => ({ value: id, label: kindLabel(id) }))
        .sort(byName);
    default:
      return [];
  }
}

/** An owner in words: "Maya Chen", "the Okafor household (a group)", "every Person", "a selector", or the none label. */
export function ownerWords(doc: WorldDoc, owner: unknown, none: string): string {
  const level = ownerLevel(doc, owner);
  if (level === "none") return none;
  if (level === "selector" || typeof owner !== "string") return "People a selector picks";
  if (level === "kind") return `Every ${hasOwn(doc.kinds, owner) ? doc.kinds[owner]?.label || owner : owner}`;
  const name = hasOwn(doc.entities, owner) ? doc.entities[owner]?.name || owner : owner;
  return level === "group" ? `${name} (a group)` : name;
}

/**
 * The owner control: the level as a segmented choice, then the one at that level (a picker by name,
 * or the selector editor). `noneLabel` names the level without an owner ("No one", "Everyone") and
 * `noneHelp` says what it means. Changing the level starts it empty: a selector matching everyone,
 * else nothing picked yet, which the form remembers until something is picked. Give it a new `key`
 * when the form reverts, so a level picked but never filled goes with the rest.
 */
export function OwnerPicker(props: { label: string; value: Owner; doc: WorldDoc; noneLabel: string; noneHelp: string; onChange(next: Owner): void }) {
  const stored = ownerLevel(props.doc, props.value);
  // An owner picked decides the level; with none yet, the level last chosen does.
  const [pending, setPending] = useState<OwnerLevel | null>(null);
  const level = stored !== "none" ? stored : (pending ?? "none");
  const names: Record<OwnerLevel, string> = { entity: "Someone", group: "Group", kind: "Kind", selector: "Selector", none: props.noneLabel };
  const help: Record<OwnerLevel, string> = {
    entity: "Someone or something of their own: it wins over every level after it.",
    group: "Every member of a group (a family, a household, a crew), through member groups too.",
    kind: "Everyone of a kind, or of a kind that inherits from it.",
    selector: "Everyone a rule picks: by kind, tier, class, tag or group.",
    none: props.noneHelp,
  };
  return (
    <div class="lre-stack" data-lre-owner={level}>
      <Field label={props.label} help={help[level]}>
        <Seg<OwnerLevel>
          label={props.label}
          value={level}
          options={LEVELS.map((l) => ({ value: l, label: names[l] }))}
          onChange={(next) => {
            setPending(next === "none" || next === "selector" ? null : next);
            props.onChange(next === "selector" ? {} : undefined);
          }}
        />
      </Field>
      {level === "selector" ? (
        <SelectorEditor label="Picks" value={selectorOf(props.value) ?? {}} doc={props.doc} onChange={(next) => props.onChange(next ?? {})} />
      ) : level === "none" ? null : (
        <RefPicker label={level === "entity" ? "Who or what" : level === "group" ? "Which group" : "Which kind"} value={typeof props.value === "string" ? props.value : ""} options={ownerOptions(props.doc, level)} onChange={(next) => props.onChange(next || undefined)} />
      )}
    </div>
  );
}

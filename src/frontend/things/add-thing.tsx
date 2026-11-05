// Add a thing in play (Play → Me → Belongings' + Add, GM → Things' + Add a thing, a container's Add
// here…): one sheet of what it's called, what kind of thing it is (Item, Clothing, Container, Kit,
// Weapon, Armor, Ammo or Vehicle) with its type from the catalogs or a size in words (a vehicle's
// class from the vehicle picker), how many, and where it is. The caller makes it: Play as the
// player's ✎ fix under the chat's claims policy (`askFor` puts a confirm step before it), GM as a GM
// edit. A thing too big for where it would go, or a holder already full, says why and waits.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { VehiclePicker } from "../../packs/vehicles/ui/picker";
import { THING_NAME_MAX } from "../../shared/things";
import type { ThingType, WhereChoice } from "../../shared/thing-view";
import type { VehicleClassChoice, VehiclePick } from "../../shared/vehicles";
import { FormSheet } from "../build/form-kit";
import { Banner, Button, NumberStepper } from "../components";
import { cannotHold } from "./where";
import { WherePicker, type WhereSuggestion } from "./where-picker";
import { KindChips, sizeOfWhat, suggestedName, THING_KIND_LABEL, TypeSheet, whatWords, type ThingKind, type WhatItIs } from "./what-it-is";

/** What Add hands its caller: the name, the kind and what it is, how many, and where. */
export interface AddDraft {
  name: string;
  kind: ThingKind;
  what: WhatItIs;
  qty: number;
  at: WhereChoice;
}

/** The most of one thing Add makes at once (a box of rounds, a stack of plates). */
export const ADD_QTY_MAX = 999;

/** Why Add can't make it yet, in words, or null when it can: a name, a vehicle's class, somewhere for it that takes it. */
export function addBlocked(parts: { name: string; kind: ThingKind; what: WhatItIs; at: WhereChoice | null; blocked?: string | null }): string | null {
  const name = parts.name.trim();
  if (name === "") return "Give it a name.";
  if (name.length > THING_NAME_MAX) return `A name of at most ${THING_NAME_MAX} characters.`;
  if (parts.kind === "vehicle" && (parts.what === null || !("vehicle" in parts.what))) return "Pick what vehicle it is.";
  if (parts.at === null) return "Pick where it is.";
  if (parts.kind === "vehicle" && parts.at.is !== "place") return "A vehicle stands at a place.";
  return cannotHold(parts.at, sizeOfWhat(parts.what)) ?? parts.blocked ?? null;
}

export function AddThingSheet(props: {
  title: string;
  subtitle?: string;
  types: readonly ThingType[] | null;
  classes: readonly VehicleClassChoice[] | null;
  choices: readonly WhereChoice[];
  start?: { at?: WhereChoice | null; kind?: ThingKind };
  suggestions?: readonly WhereSuggestion[];
  blocked?(choice: WhereChoice): string | null;
  kinds?: readonly ThingKind[];
  busy: boolean;
  action: string;
  help?: ComponentChildren;
  askFor?(draft: AddDraft): string | null;
  onSubmit(draft: AddDraft): void;
  onClose(): void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ThingKind>(props.start?.kind ?? "item");
  const [what, setWhat] = useState<WhatItIs>(null);
  const [qty, setQty] = useState(1);
  const [at, setAt] = useState<WhereChoice | null>(props.start?.at ?? null);
  const [choosing, setChoosing] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const nameId = useId();
  const vehicle = kind === "vehicle";
  const choices = vehicle ? props.choices.filter((c) => c.is === "place") : props.choices;
  const why = addBlocked({ name, kind, what, at, blocked: at ? (props.blocked?.(at) ?? null) : null });
  const draft: AddDraft | null = why === null && at !== null ? { name: name.trim(), kind, what, qty: vehicle ? 1 : qty, at } : null;
  const pickKind = (next: ThingKind): void => {
    if (next === kind) return;
    setKind(next);
    // A type of another kind, or a vehicle for a thing, no longer says what it is.
    setWhat(null);
    setAsking(null);
    if (next === "vehicle" && at !== null && at.is !== "place") setAt(null);
  };
  const pick = (next: WhatItIs): void => {
    setWhat(next);
    setChoosing(false);
    setAsking(null);
    const named = suggestedName(next);
    if (named !== null && name.trim() === "") setName(named.slice(0, THING_NAME_MAX));
  };
  const submit = (): void => {
    if (!draft || props.busy) return;
    const ask = props.askFor?.(draft) ?? null;
    if (ask !== null && asking === null) setAsking(ask);
    else props.onSubmit(draft);
  };
  return (
    <FormSheet
      title={props.title}
      subtitle={props.subtitle ?? "What it's called, what it is, how many, where"}
      onClose={props.onClose}
      actions={
        <Button size="sm" variant="primary" disabled={draft === null || asking !== null} busy={props.busy} onClick={submit}>
          {props.action}
        </Button>
      }
    >
      <div class="lre-stack" data-lre-add-sheet={kind}>
        {asking !== null && draft ? (
          <Banner
            tone="warn"
            title={`Add ${draft.name}?`}
            actions={
              <>
                <Button size="sm" variant="primary" disabled={props.busy} onClick={() => props.onSubmit(draft)}>
                  Add it
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
                  Not now
                </Button>
              </>
            }
          >
            <span data-lre-add-ask="">{asking}</span>
          </Banner>
        ) : null}
        <div class="lre-field">
          <label class="label" for={nameId}>
            Name
          </label>
          <input id={nameId} class="lre-input" value={name} maxLength={THING_NAME_MAX} placeholder={vehicle ? "Dad's old pickup" : "Pocketknife"} onInput={(event) => setName(event.currentTarget.value)} />
        </div>
        <div class="lre-field" data-lre-add-kind="">
          <span class="label">What kind of thing</span>
          <KindChips value={kind} kinds={props.kinds} onPick={pickKind} />
        </div>
        <div class="lre-field" data-lre-what="">
          <span class="label">{vehicle ? "What vehicle" : `What ${THING_KIND_LABEL[kind].toLowerCase()} it is`}</span>
          <div class="lre-cp-value">
            <span class="lre-cp-path">{what === null ? <span class="lre-muted">{vehicle ? "Not picked yet" : "Not picked: its name may say"}</span> : whatWords(what)}</span>
            <Button size="sm" icon={vehicle ? "car" : "search"} onClick={() => setChoosing(true)}>
              {what === null ? "Pick…" : "Change…"}
            </Button>
          </div>
          <span class="lre-field-help">{vehicle ? "Its class gives its fuel, range and price; its make, model and year are yours to set." : "A type from the catalogs gives its size and details; Something else asks how big it is."}</span>
        </div>
        {vehicle ? null : <NumberStepper label="How many" value={qty} min={1} max={ADD_QTY_MAX} integer onChange={setQty} />}
        <WherePicker title="Where is it?" choices={choices} value={at ? { choice: at } : null} size={sizeOfWhat(what)} blocked={props.blocked} suggestions={props.suggestions} onPick={(next) => setAt(next && "choice" in next ? next.choice : null)} action={at ? "Change…" : "Pick…"} empty="Not picked yet" help={vehicle ? "A place it stands at." : "On you, in something that holds it, or at a place."} />
        {why !== null && name.trim() !== "" ? <span class="lre-small lre-muted" data-lre-add-why="">{why}</span> : null}
        {props.help !== undefined ? <span class="lre-field-help">{props.help}</span> : null}
      </div>
      {choosing && vehicle ? <VehiclePicker classes={props.classes ?? []} value={what !== null && "vehicle" in what ? what.vehicle.id : null} title="What vehicle?" onClose={() => setChoosing(false)} onPick={(vehiclePick: VehiclePick) => pick({ vehicle: vehiclePick })} /> : null}
      {choosing && !vehicle ? <TypeSheet types={props.types} kind={kind} value={what} onClose={() => setChoosing(false)} onPick={pick} /> : null}
    </FormSheet>
  );
}

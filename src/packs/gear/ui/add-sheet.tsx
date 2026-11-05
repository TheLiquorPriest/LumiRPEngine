// Play → Me → Belongings' + Add (and a container's Add here…; DESIGN §9.4, ITEMS-SPEC §10.3): a thing
// the player says they have, made at once, off screen, as their ✎ fix with its Undo, under the
// chat's claims policy. Make it real makes it at once (a key, a weapon or a document, or under a
// capped policy anything the catalogs price over the chat's claim cap, asks first); Ask first asks
// in the sheet before it is made; Hold me to the world has no Add at all. The catalogs' types and
// the vehicle classes come from `lre.things` in Play scope.

import { useEffect, useState } from "preact/hooks";
import type { ClaimsPolicy } from "../../../shared/claims";
import type { ChatId } from "../../../shared/ids";
import { hasOwn } from "../../../shared/json";
import type { StateView } from "../../../shared/state-view";
import type { ItemFix } from "../../../shared/things";
import type { ThingType, WhereChoice } from "../../../shared/thing-view";
import type { VehicleClassChoice } from "../../../shared/vehicles";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { AddThingSheet, type AddDraft } from "../../../frontend/things/add-thing";
import { thingsFix, type AtOnce } from "../../../frontend/things/at-once";
import type { ThingKind } from "../../../frontend/things/what-it-is";
import type { GearView } from "../core/view";
import { playChoices } from "./choices";

/** What Add is under the chat's claims policy: made at once, asked about first, or not offered (Hold me to the world). */
export type AddPolicy = "real" | "ask" | "hidden";

export function addPolicy(claims: ClaimsPolicy | null): AddPolicy {
  return claims === null || claims.mode === "real" ? "real" : claims.mode === "ask" ? "ask" : "hidden";
}

/** What always asks first, whatever the policy but Hold me to the world: what opens or proves things, or arms someone. */
const RESTRICTED: Readonly<Record<string, true>> = { weapon: true, key: true, document: true };

/** The typical price of what a draft is, in minor units, where the catalogs or the vehicle classes give one. */
function priceOf(draft: AddDraft, classes: readonly VehicleClassChoice[]): number | null {
  const what = draft.what;
  if (what === null || "size" in what) return null;
  const cents = "type" in what ? what.type.priceCents : classes.find((c) => c.id === what.vehicle.id)?.priceCents;
  return typeof cents === "number" && Number.isFinite(cents) ? cents : null;
}

/**
 * The question Add asks before it makes a thing, or null to make it at once: always under Ask
 * first; under Make it real only for a key, a weapon or a document, or, capped, for what costs more
 * than the claim cap (`cap`, minor units, when the chat's policy is capped).
 */
export function addAsk(claims: ClaimsPolicy | null, draft: AddDraft, opts: { classes: readonly VehicleClassChoice[]; cap: number | null; currency: WorldCurrency | null }): string | null {
  const policy = addPolicy(claims);
  if (policy === "hidden") return null;
  if (policy === "ask") return "This chat asks before it makes real something you say you have.";
  const category = draft.what !== null && "type" in draft.what ? draft.what.type.categoryId : draft.kind;
  if (category !== null && hasOwn(RESTRICTED, category)) return "Keys, weapons and documents always ask first.";
  const price = priceOf(draft, opts.classes);
  if (claims?.capped && opts.cap !== null && price !== null && price > opts.cap && opts.currency) return `It costs about ${formatMoney(price, opts.currency)}, over this world's ${formatMoney(opts.cap, opts.currency)} for what you say you have.`;
  return null;
}

/** The ✎ fix a draft makes: its type, or a vehicle's class with its make, model and year, or else what it is said to be (`is`) and how big; how many; where. */
export function playMake(draft: AddDraft): ItemFix {
  const what = draft.what;
  const at = draft.at.is === "place" ? { place: draft.at.id } : { in: draft.at.id };
  const base = { do: "make" as const, name: draft.name, at, ...(draft.qty !== 1 ? { qty: draft.qty } : {}) };
  if (what !== null && "vehicle" in what) return { ...base, class: what.vehicle.id, details: { make: what.vehicle.make, model: what.vehicle.model, year: what.vehicle.year } };
  if (what !== null && "type" in what) return { ...base, type: what.type.id };
  return { ...base, ...(draft.kind !== "item" && draft.kind !== "vehicle" ? { is: draft.kind } : {}), ...(what !== null && "size" in what ? { size: what.size } : {}) };
}

/** What Add says it made. */
export function madeWords(draft: AddDraft): string {
  const count = draft.qty !== 1 ? ` ×${draft.qty}` : "";
  const where = draft.at.is === "place" ? `at ${draft.at.name}` : draft.at.is === "person" ? (draft.at.name === "You" ? "on you" : `with ${draft.at.name}`) : `in ${draft.at.name}`;
  return `Added: ${draft.name}${count}, ${where}.`;
}

/** What `lre.things` answers in Play scope for Add: the catalogs' types, the vehicle classes and, under a capped Make it real, the claim cap. */
interface PlayTypes {
  types: ThingType[];
  classes: VehicleClassChoice[];
  cap: number | null;
}

/**
 * Add's sheet in Play: the types read once it opens, the player-safe choices of where (`start`: the
 * container it opens from, else On you), and what it makes sent at once, its notice and Undo the
 * caller's (`atOnce`).
 */
export function PlayAddSheet(props: { chatId: ChatId; state: StateView; view: GearView; start?: { at?: WhereChoice | null; kind?: ThingKind }; atOnce: AtOnce; onClose(): void }) {
  const app = useApp();
  const [read, setRead] = useState<PlayTypes | null>(null);
  useEffect(() => {
    let live = true;
    void app.request({ type: "lre.things", scope: "play", chatId: props.chatId, op: "types" }).then((answer) => {
      if (live) setRead({ types: answer?.types ?? [], classes: answer?.classes ?? [], cap: answer?.cap ?? null });
    });
    return () => {
      live = false;
    };
  }, [props.chatId]);
  const where = playChoices(props.view, props.state);
  const claims = props.state.controls?.realism.claims ?? null;
  const start = props.start?.at ?? where.choices.find((c) => c.id === where.at.pov) ?? null;
  const policy = addPolicy(claims);
  return (
    <AddThingSheet
      title="Add a thing"
      subtitle="Something you have that the story hasn't shown"
      types={read?.types ?? null}
      classes={read?.classes ?? null}
      choices={where.choices}
      start={{ at: start, ...(props.start?.kind ? { kind: props.start.kind } : {}) }}
      blocked={where.blocked}
      busy={props.atOnce.busy}
      action={policy === "ask" ? "Ask…" : "Add"}
      help={policy === "ask" ? "This chat asks first; once you say yes it is made at once, off screen, with its Undo." : "Made at once, off screen, with its Undo. Keys, weapons and documents ask first."}
      askFor={(draft) => addAsk(claims, draft, { classes: read?.classes ?? [], cap: read?.cap ?? null, currency: props.state.currency })}
      onClose={props.onClose}
      onSubmit={(draft) => {
        const words = madeWords(draft);
        props.atOnce.send(thingsFix(props.chatId, [playMake(draft)], words), words, props.onClose);
      }}
    />
  );
}

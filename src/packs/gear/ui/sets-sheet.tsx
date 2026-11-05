// Outfits and loadouts (Play → Me → Belongings' outfit bar; DESIGN §28.16): the player character's
// saved sets, each with its pieces (a missing one named) and one-tap Change into, which swaps what
// they wear at once, off screen, and is told to the story (the gear pack's `set_apply`, with its
// Undo); Forget drops one. Save what I'm wearing as… keeps what they wear now as an outfit, or what
// they have ready (in hand, holstered, sheathed, their armor) as a loadout. Saving and forgetting
// are bookkeeping, never told. From Gear 3, where slots are tracked.

import { useId, useState } from "preact/hooks";
import type { ChatId } from "../../../shared/ids";
import { SET_KIND_LABEL, SET_KINDS, SET_NAME_MAX, type SetKind } from "../../../shared/things";
import { FormSheet } from "../../../frontend/build/form-kit";
import { Badge, Button, Empty, Section, Seg } from "../../../frontend/components";
import type { Req } from "../../../frontend/requests";
import { AtOnceNotice, type AtOnce } from "../../../frontend/things/at-once";
import type { GearSet, GearView } from "../core/view";

/** A set's action, sent at once, off screen: Change into (told), Save and Forget (bookkeeping). A set goes by its name, so the action's words, its chip and the story's line name it, never its id. */
function setAction(chatId: ChatId, action: "set_apply" | "set_save" | "set_drop", params: Record<string, string>): Req<"lre.action"> {
  return { type: "lre.action", chatId, action, params, source: "palette", offstage: true };
}

export function setApplyRequest(chatId: ChatId, set: string): Req<"lre.action"> {
  return setAction(chatId, "set_apply", { set });
}

export function setSaveRequest(chatId: ChatId, name: string, kind: SetKind): Req<"lre.action"> {
  return setAction(chatId, "set_save", { name, kind });
}

export function setDropRequest(chatId: ChatId, set: string): Req<"lre.action"> {
  return setAction(chatId, "set_drop", { set });
}

/** The saved outfit worn now, every piece of it on: the outfit bar's name. */
export function currentOutfit(view: GearView): GearSet | null {
  return view.sets.find((s) => s.kind === "outfit" && s.on === true) ?? null;
}

/** What the outfit bar says: the outfit worn now, else that what is worn isn't a saved one, or that none is saved yet. */
export function outfitBarText(view: GearView): string {
  const on = currentOutfit(view);
  if (on) return on.name;
  return view.sets.some((s) => s.kind === "outfit") ? "Not a saved outfit" : "No saved outfits yet";
}

/** A set's pieces in a line, the missing ones named apart. */
export function piecesLine(set: GearSet): string {
  const here = set.pieces.filter((p) => p.missing !== true).map((p) => p.name);
  const missing = set.pieces.filter((p) => p.missing === true).map((p) => p.name);
  const parts = [here.length > 0 ? here.join(", ") : set.pieces.length === 0 ? "Nothing in it" : null, missing.length > 0 ? `missing ${missing.join(", ")}` : null];
  return parts.filter((p) => p !== null).join(" · ");
}

/** The saved sets of one kind as rows: name, pieces, On now, Change into and Forget. Hook-free. */
export function SetRows(props: { sets: readonly GearSet[]; kind: SetKind; busy: boolean; onApply(set: GearSet): void; onDrop(set: GearSet): void }) {
  const sets = props.sets.filter((s) => s.kind === props.kind);
  if (sets.length === 0) return <Empty icon="layers">{props.kind === "outfit" ? "No outfit saved yet." : "No loadout saved yet."}</Empty>;
  return (
    <div class="lre-bel-sets" role="list" aria-label={props.kind === "outfit" ? "Outfits" : "Loadouts"}>
      {sets.map((set) => (
        <div key={set.id} class="lre-bel-set" role="listitem" data-lre-set={set.id}>
          <span class="lre-bel-set-text">
            <span class="lre-bel-set-name">
              {set.name}
              {set.on ? <Badge tone="accent">On now</Badge> : null}
            </span>
            <span class="lre-bel-set-sub">{piecesLine(set)}</span>
          </span>
          <span class="lre-bel-set-actions">
            <Button size="sm" variant={set.on ? "ghost" : "primary"} disabled={props.busy || set.on === true} onClick={() => props.onApply(set)}>
              Change into
            </Button>
            <Button size="sm" variant="ghost" icon="trash" disabled={props.busy} label={`Forget ${set.name}`} onClick={() => props.onDrop(set)}>
              Forget
            </Button>
          </span>
        </div>
      ))}
    </div>
  );
}

/** The outfits and loadouts sheet: the notice with its Undo, each kind's sets, and Save what I'm wearing as…. */
export function SetsSheet(props: { chatId: ChatId; view: GearView; atOnce: AtOnce; onClose(): void }) {
  const { atOnce } = props;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SetKind>("outfit");
  const nameId = useId();
  const trimmed = name.trim();
  const apply = (set: GearSet): void => atOnce.send(setApplyRequest(props.chatId, set.name), `You changed into ${set.name}.`, props.onClose);
  const drop = (set: GearSet): void => atOnce.send(setDropRequest(props.chatId, set.name), `${set.name} is no longer saved.`);
  return (
    <FormSheet title="Outfits & loadouts" subtitle={`Wearing: ${outfitBarText(props.view)}`} onClose={props.onClose}>
      <div class="lre-stack" data-lre-sets-sheet="">
        <AtOnceNotice done={atOnce.done} busy={atOnce.busy} onUndo={atOnce.undo} onDismiss={atOnce.dismiss} />
        <span class="lre-small lre-muted">Change into swaps what you wear at once, off screen, and the story hears of it; what else you wear comes off, and at home goes back where it is kept.</span>
        {SET_KINDS.map((k) => (
          <Section key={k} title={k === "outfit" ? "Outfits" : "Loadouts"} flush>
            <SetRows sets={props.view.sets} kind={k} busy={atOnce.busy} onApply={apply} onDrop={drop} />
          </Section>
        ))}
        <Section title="Save what I'm wearing as…">
          <div class="lre-stack" data-lre-set-save="">
            <Seg<SetKind> label="Save as" value={kind} options={SET_KINDS.map((k) => ({ value: k, label: SET_KIND_LABEL[k] }))} onChange={setKind} />
            <div class="lre-field">
              <label class="label" for={nameId}>
                Name
              </label>
              <input id={nameId} class="lre-input" value={name} maxLength={SET_NAME_MAX} placeholder={kind === "outfit" ? "Work clothes" : "Range day"} onInput={(event) => setName(event.currentTarget.value)} />
              <span class="lre-field-help">{kind === "outfit" ? "Keeps what you wear now." : "Keeps what you have ready: in hand, holstered, sheathed, and your armor."}</span>
            </div>
            <Button variant="primary" icon="check" disabled={atOnce.busy || trimmed === ""} onClick={() => atOnce.send(setSaveRequest(props.chatId, trimmed, kind), `Saved ${trimmed}.`, () => setName(""))}>
              Save
            </Button>
          </div>
        </Section>
      </div>
    </FormSheet>
  );
}

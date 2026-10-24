// GM → a character's sheet (the Character model, DESIGN §7): a person as the GM runs them, in place
// of the generic entity sheet. What they're doing now and where, with moves and the party; where
// they live and sleep; their mind and routine, each linking to its own GM page; what they carry,
// their money and relations; then the existing Simulation, Life, Classes and tags and Remove; and
// every field last, folded, under plain labels. It reads the character from `lre.character` (GM
// scope, behind the gate as `lre.gm` is) and asks again whenever the GM view reloads. Every change
// is one `lre.edit` with its own Undo.

import { useEffect, useState } from "preact/hooks";
import type { CharacterBed, CharacterResult, PlaceRef } from "../../shared/character";
import type { EditOp } from "../../shared/protocol";
import type { RoutineGmView } from "../../shared/routines";
import type { GmEntity, GmField } from "../../shared/state-view";
import { APPROACH_LABEL, FIDELITY_LABEL } from "../../packs/minds/ui/ops";
import { useApp } from "../app";
import { Badge, Banner, Button, Disclosure, Empty, HostSwitch, IdText, Section } from "../components";
import { BedPicker } from "../character/bed-picker";
import { PlacePicker, PlaceSheet } from "../character/place-picker";
import { bringOp, characterRequest, partyOf } from "../requests";
import { bedOp, homeOp, moveOp, partySwitchOp } from "./character-ops";
import { formatMoney } from "../../shared/world";
import type { Editor } from "./editor";
import { nameOf } from "./editor";
import { Classification, FieldRow, Life, Relations, Simulation } from "./entity";
import { gmOpen } from "./gate";
import { ActionRow, ActionRows, GmPage } from "./ui";

/** A place as the sheet says it: its path, outermost first, ending in its name. */
export function placePath(place: PlaceRef | null): string {
  return place ? [...place.path, place.name].join(" › ") : "Nowhere";
}

/** Where they sleep, in words. */
export function bedText(bed: CharacterBed): string {
  if (bed.kind === "item" && bed.item) return `${bed.item.name}${bed.item.place ? ` (${placePath(bed.item.place)})` : ""}`;
  if (bed.kind === "place" && bed.place) return placePath(bed.place);
  return "At home";
}

/** The fields the sheet shows through its own controls, so All fields doesn't show them twice. */
const SHOWN_ABOVE: Record<string, true> = { place: true, home: true, bed: true };

/** What a person holds on them: worn or equipped first, then carried, by name. */
function carried(entity: GmEntity, editor: Editor): { id: string; name: string; how: string }[] {
  const how = (e: GmEntity): string | null => {
    for (const r of e.relations) {
      if (r.to !== entity.id) continue;
      if (r.type === "worn_by") return "worn";
      if (r.type === "equipped") return "equipped";
      if (r.type === "in") return "carried";
    }
    return null;
  };
  const order: Record<string, number> = { worn: 0, equipped: 1, carried: 2 };
  return editor.gm.entities
    .flatMap((e) => {
      const h = e.gone ? null : how(e);
      return h ? [{ id: e.id, name: e.name, how: h }] : [];
    })
    .sort((a, b) => (order[a.how] ?? 3) - (order[b.how] ?? 3) || a.name.localeCompare(b.name));
}

/** The character's GM page, over World's list (or wherever a person's GM page opens). */
export function CharacterSheet(props: { entity: GmEntity; editor: Editor; chatId: string; onBack(): void; backLabel?: string; onOpen?(entity: string): void }) {
  const { entity, editor } = props;
  const app = useApp();
  const [read, setRead] = useState<CharacterResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routine, setRoutine] = useState<RoutineGmView | null>(null);
  const [moving, setMoving] = useState(false);
  // Read again whenever the GM view reloads (an edit, its Undo, a turn), so the sheet shows them at once.
  useEffect(() => {
    let live = true;
    void app.request(characterRequest(entity.id, { chatId: props.chatId })).then((result) => {
      if (!live) return;
      if (result === null) return setError("This character couldn't be read.");
      setError(null);
      setRead(result);
    });
    void app.request({ type: "lre.routine", chatId: props.chatId, op: "day", entity: entity.id, view: "gm" }).then((result) => {
      if (live) setRoutine(result?.gm ?? null);
    });
    return () => {
      live = false;
    };
  }, [entity.id, props.chatId, editor.gm]);
  const edit = (ops: EditOp[]): void => void editor.edit(ops);
  const pov = editor.gm.entities.find((e) => e.pov) ?? null;
  const party = partyOf(entity, editor.gm);
  const bring = bringOp(entity, editor.gm);
  const mind = editor.gm.minds.characters.find((c) => c.entity === entity.id) ?? null;
  const money = editor.gm.money.find((m) => m.party === entity.id) ?? null;
  const things = carried(entity, editor);
  const character = read?.character ?? null;
  const places = read?.places ?? [];
  const placeOf = (id: string | null): PlaceRef | null => (id === null ? null : (places.find((p) => p.id === id) ?? null));
  const povPlace = placeOf(pov?.place ?? null);
  const suggestions = [
    ...(character?.home ? [{ label: "Their home", place: character.home }] : []),
    ...(pov && !entity.pov && povPlace ? [{ label: `Where ${pov.name} is`, place: povPlace }] : []),
  ];
  // Plain labels and help for the field list, from the character model; the GM view's otherwise.
  const plain = new Map((character?.sections ?? []).flatMap((s) => s.fields).map((f) => [f.id, f]));
  const fields: GmField[] = entity.fields.filter((f) => !SHOWN_ABOVE[f.id]).map((f) => ({ ...f, label: plain.get(f.id)?.label ?? f.label }));
  const minutes = editor.gm.minds.now;
  const current = routine?.day.blocks.find((b) => b.start <= minutes && b.end > minutes) ?? null;
  const next = routine?.day.blocks.find((b) => b.start > minutes) ?? null;
  return (
    <GmPage
      name="character"
      title={entity.name}
      subtitle={
        <>
          {character?.kind.label ?? entity.kind} · {editor.gm.tiers.find((t) => t.id === entity.tier)?.label ?? entity.tier}
          <IdText id={entity.id} />
        </>
      }
      backLabel={props.backLabel ?? "World"}
      onBack={props.onBack}
    >
      <div class="lre-gm-entity lre-gm-character" data-lre-gm-character={entity.id}>
        <div class="lre-gm-badges start" aria-label="About them">
          {entity.pov ? <Badge tone="accent">Player character</Badge> : null}
          {mind ? <Badge tone={mind.fidelity.level === "live" ? "accent" : "neutral"}>{FIDELITY_LABEL[mind.fidelity.level]}</Badge> : null}
          <Badge>{editor.gm.tiers.find((t) => t.id === entity.tier)?.label ?? entity.tier}</Badge>
          {entity.gone ? <Badge tone="neg">Removed</Badge> : entity.life.state !== "alive" ? <Badge tone="neg">{entity.life.label}</Badge> : null}
          {party?.travels ? <Badge tone="pos">Travels with {party.pov.name}</Badge> : null}
          {entity.agent ? <Badge>Lives their own day</Badge> : null}
          {entity.visibility !== "public" ? <Badge tone="gm">{entity.visibility === "secret" ? "Secret" : entity.visibility === "known_by" ? "Known by some" : "Discoverable"}</Badge> : null}
        </div>
        {entity.gone && !entity.pov ? (
          <Banner
            tone="neg"
            title="Removed from the world"
            actions={
              <Button variant="primary" icon="undo" disabled={editor.busy} onClick={() => edit([{ op: "restore", entity: entity.id }])}>
                Restore
              </Button>
            }
          >
            Out of the world until restored; their relations were unlinked.
          </Banner>
        ) : null}
        {error ? <Banner tone="warn">{error}</Banner> : null}
        <Section title="Now">
          <ActionRows label="Now">
            <ActionRow title="Where" value={character ? placePath(character.place) : nameOf(editor.gm, entity.place)} />
            {character?.now ? <ActionRow title="Doing" value={`${character.now.activityLabel}${character.now.until ? `, until ${character.now.until}` : ""}`} /> : null}
            {entity.holder ? (
              <ActionRow
                title="Inside"
                value={character?.inside?.name ?? nameOf(editor.gm, entity.holder)}
                actions={
                  <Button size="sm" disabled={editor.busy} onClick={() => edit([{ op: "put", entity: entity.id, into: null }])}>
                    Take out
                  </Button>
                }
              />
            ) : null}
            {(character?.now?.holds ?? []).map((h) => (
              <ActionRow key={h.label} title="The story holds" value={`${h.label}${h.until ? `, until ${h.until}` : ""}`} />
            ))}
          </ActionRows>
          <div class="lre-inline">
            <Button icon="pin" disabled={editor.busy || character === null} onClick={() => setMoving(true)}>
              Move them…
            </Button>
            {bring && pov ? (
              <Button disabled={editor.busy} onClick={() => edit([bring])}>
                Bring to {pov.name}'s place
              </Button>
            ) : null}
          </div>
          {party ? (
            <HostSwitch
              checked={party.travels}
              label={`Travels with ${party.pov.name}: goes wherever ${party.pov.name} goes`}
              disabled={editor.busy}
              onChange={(on) => {
                const op = partySwitchOp(entity, editor.gm, on);
                if (op) edit([op]);
              }}
            />
          ) : null}
          {moving ? (
            <PlaceSheet
              title={`Move ${entity.name}`}
              places={places}
              value={character?.place?.id ?? null}
              suggestions={suggestions}
              onClose={() => setMoving(false)}
              onPick={(place) => {
                setMoving(false);
                const op = moveOp(entity, place);
                if (op) edit([op]);
              }}
            />
          ) : null}
        </Section>
        {character ? (
          <Section title="Where they live">
            <PlacePicker title="Their home" label="Home" places={places} value={character.home?.id ?? null} suggestions={suggestions.filter((s) => s.label !== "Their home")} disabled={editor.busy} onPick={(place) => edit([homeOp(entity, place)])} />
            <BedPicker character={character} places={places} things={read?.things ?? []} disabled={editor.busy} onPick={(bed) => edit([bedOp(entity, bed)])} />
          </Section>
        ) : null}
        {mind ? (
          <Section title="Mind" aside={<Badge tone={mind.fidelity.level === "live" ? "accent" : "neutral"}>{FIDELITY_LABEL[mind.fidelity.level]}</Badge>}>
            <ActionRows label="Mind">
              <ActionRow title="Means to" value={mind.intent?.text ? `${mind.intent.text}${mind.intent.approach ? ` (${APPROACH_LABEL[mind.intent.approach].toLowerCase()})` : ""}` : "Nothing the GM set"} />
              {mind.mind ? <ActionRow title="Latest mind" value={mind.mind.clock} /> : null}
            </ActionRows>
            <Button variant="secondary" iconAfter="chevron-right" onClick={() => app.ui.update((ui) => gmOpen(ui, "minds.gm", entity.id))}>
              Open their mind
            </Button>
          </Section>
        ) : null}
        {entity.pov ? null : (
          <Section title="Routine">
            <ActionRows label="Routine">
              {current ? <ActionRow title="Now" value={`${current.label}, ${current.from}–${current.to}${current.placeName ? ` at ${current.placeName}` : ""}`} /> : null}
              {next ? <ActionRow title="Next" value={`${next.label}, ${next.from}–${next.to}${next.placeName ? ` at ${next.placeName}` : ""}`} /> : null}
              {!current && !next ? <ActionRow title="Today" value={routine ? "Nothing more today" : "—"} /> : null}
            </ActionRows>
            <Button variant="secondary" iconAfter="chevron-right" onClick={() => app.ui.update((ui) => gmOpen(ui, "castlife.routines", entity.id))}>
              Open their routine
            </Button>
          </Section>
        )}
        <Section title="Carrying">
          {things.length === 0 ? (
            <p class="lre-gm-none">Nothing.</p>
          ) : (
            <ActionRows label="Carrying">
              {things.map((t) => (
                <ActionRow
                  key={t.id}
                  title={t.name}
                  value={t.how}
                  actions={
                    props.onOpen ? (
                      <Button size="sm" variant="ghost" onClick={() => props.onOpen?.(t.id)}>
                        Open
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </ActionRows>
          )}
        </Section>
        {money ? (
          <Section title="Money">
            <ActionRows label="Money">
              {money.cash && "cents" in money.cash ? <ActionRow title="Cash" value={formatMoney(money.cash.cents, editor.currency)} /> : null}
              {money.band ? <ActionRow title="Wealth" value={money.band} /> : null}
              {money.accounts.length > 0 ? <ActionRow title="Accounts" value={String(money.accounts.length)} /> : null}
            </ActionRows>
            <Button variant="secondary" iconAfter="chevron-right" onClick={() => app.ui.update((ui) => gmOpen(ui, "economy.money", entity.id))}>
              Open their money
            </Button>
          </Section>
        ) : null}
        <Relations entity={entity} editor={editor} />
        <Simulation key={`${entity.tier}:${entity.agent}:${JSON.stringify(entity.levels)}`} entity={entity} editor={editor} />
        <Life key={JSON.stringify(entity.life)} entity={entity} editor={editor} />
        <Classification key={JSON.stringify([entity.class, entity.tags])} entity={entity} editor={editor} />
        {entity.pov || entity.gone ? null : (
          <Section title="Remove">
            <span class="lre-field-help">Takes {entity.name} out of the world and unlinks their relations. The edit's Undo, or Restore here, brings them back.</span>
            <Button variant="danger" icon="trash" disabled={editor.busy} onClick={() => edit([{ op: "despawn", entity: entity.id }])}>
              Remove from the world
            </Button>
          </Section>
        )}
        <Section title="All fields">
          <Disclosure summary={`Every field (${fields.length})`}>
            {fields.length === 0 ? (
              <Empty>None.</Empty>
            ) : (
              <ActionRows label="All fields">
                {fields.map((f) => (
                  <FieldRow key={f.id} entity={entity} field={f} editor={editor} />
                ))}
              </ActionRows>
            )}
          </Disclosure>
        </Section>
      </div>
    </GmPage>
  );
}

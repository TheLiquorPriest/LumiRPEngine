// The bed picker (DESIGN §7, the Character model; beds §8): where someone sleeps, as a path, and a
// sheet to change it. It offers what's likely first: sleeping at home (no bed of their own, the
// default), the rooms in their home, then the things lying there, the likely beds first (as
// `lre.character` orders them); then any other place through the place picker, and any thing
// elsewhere found by its name or where it lies. `bedValue` is what the `bed` field takes for a choice.

import { useId, useMemo, useState } from "preact/hooks";
import type { CharacterBed, CharacterDTO, PlaceRef, ThingRef } from "../../shared/character";
import { FormSheet } from "../build/form-kit";
import { Badge, Button, Empty, List, ListRow, Section } from "../components";
import { Icon } from "../icons";
import { PlaceBadge, PlacePath, PlaceSheet } from "./place-picker";
import { bedOf, bedOptions, isBed, pathLabel, SEARCH_LIMIT, searchThings, type BedOption } from "./places";

/** The `bed` field's value for a bed: none for sleeping at home, else the place's or the thing's id. What both pages write. */
export function bedValue(bed: CharacterBed): string | null {
  if (bed.kind === "item") return bed.item?.id ?? null;
  if (bed.kind === "place") return bed.place?.id ?? null;
  return null;
}

/** The bed in words, for the field and the sheet's subtitle. */
function bedWords(character: Pick<CharacterDTO, "bed" | "home">): string {
  const bed = character.bed;
  if (bed.kind === "item" && bed.item) return bed.item.place ? `${bed.item.name}, in ${pathLabel(bed.item.place)}` : bed.item.name;
  if (bed.kind === "place" && bed.place) return pathLabel(bed.place);
  return character.home ? `At home: ${pathLabel(character.home)}` : "At home (they have no home set)";
}

/** One of the sheet's choices as a row. A room or a thing in their home says where in it, from the home down. */
function OptionRow(props: { option: BedOption; home: PlaceRef | null; bed: CharacterBed; onPick(bed: CharacterBed): void }) {
  const { option, home } = props;
  const now = isBed(props.bed, option);
  if (option.kind === "home") {
    return <ListRow icon="home" title="Sleeps at home" subtitle={option.place ? `No bed of their own · ${pathLabel(option.place)}` : "No bed of their own"} badge={now ? <Badge tone="accent">Now</Badge> : undefined} current={now} onClick={() => props.onPick(bedOf(option))} />;
  }
  if (option.kind === "place") {
    return <ListRow icon="pin" title={option.place.name} subtitle={option.place.path.length > 0 ? option.place.path.join(" › ") : "In their home"} badge={now ? <Badge tone="accent">Now</Badge> : <PlaceBadge place={option.place} />} current={now} onClick={() => props.onPick(bedOf(option))} />;
  }
  const at = option.item.place;
  // `bedChoices.items` lie in the home's subtree, so the home's depth is where their path enters it.
  const where = at === null ? "Nowhere" : home ? [...at.path, at.name].slice(home.path.length).join(" › ") : pathLabel(at);
  return <ListRow icon="box" title={option.item.name} subtitle={where} badge={now ? <Badge tone="accent">Now</Badge> : undefined} current={now} onClick={() => props.onPick(bedOf(option))} />;
}

/** A thing anywhere, found by its name or where it lies; each result with its place's path. */
function ThingSheet(props: { things: readonly ThingRef[]; bed: CharacterBed; onPick(item: ThingRef): void; onClose(): void }) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const results = useMemo(() => searchThings(props.things, query), [props.things, query]);
  return (
    <FormSheet title="A thing somewhere else" subtitle="A bed, a sofa, a hammock: anything they could sleep in" onClose={props.onClose}>
      <div class="lre-cp-sheet" data-lre-thing-sheet="">
        <label class="lre-cp-search" for={searchId}>
          <Icon name="search" size={16} />
          <input
            id={searchId}
            class="lre-input"
            type="search"
            placeholder="Search by name or where it is"
            aria-label="Search things by name or where they are"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              const first = results[0];
              if (event.key !== "Enter" || !first) return;
              event.preventDefault();
              props.onPick(first);
            }}
          />
        </label>
        {query.trim() === "" ? (
          <p class="lre-cp-note">Type a word of its name ("bed", "sofa") or of where it is.</p>
        ) : results.length === 0 ? (
          <Empty icon="search">Nothing matches “{query.trim()}”.</Empty>
        ) : (
          <Section title={results.length === 1 ? "1 thing" : `${results.length} things${results.length === SEARCH_LIMIT ? ", keep typing to narrow" : ""}`} flush>
            <List>
              {results.map((t) => (
                <ListRow key={t.id} icon="box" title={t.name} subtitle={t.place ? pathLabel(t.place) : "Nowhere"} current={props.bed.kind === "item" && props.bed.item?.id === t.id} onClick={() => props.onPick(t)} />
              ))}
            </List>
          </Section>
        )}
      </div>
    </FormSheet>
  );
}

/** The bed field and its sheet. `things` (every thing with where it lies) enables "A thing somewhere else…". */
export function BedPicker(props: { character: CharacterDTO; places: readonly PlaceRef[]; things?: readonly ThingRef[]; onPick(bed: CharacterBed): void; label?: string; disabled?: boolean }) {
  const { character } = props;
  const [open, setOpen] = useState<"bed" | "place" | "thing" | null>(null);
  const options = bedOptions(character);
  const rooms = options.filter((o) => o.kind === "place");
  const homeThings = options.filter((o) => o.kind === "item");
  const pick = (bed: CharacterBed) => {
    setOpen(null);
    props.onPick(bed);
  };
  const bed = character.bed;
  return (
    <div class="lre-cp-field" data-lre-bed-picker={character.id}>
      <div class="lre-field">
        <span class="label">{props.label ?? "Sleeps"}</span>
        <div class="lre-cp-value">
          {bed.kind === "place" ? (
            <PlacePath place={bed.place} />
          ) : (
            // The bed's name over where it is, so the path never starts a line with a stray comma.
            <span class="lre-cp-bed">
              <span class="lre-cp-path-name">{bed.kind === "item" && bed.item ? bed.item.name : "At home"}</span>
              {bed.kind === "item" && bed.item ? (
                bed.item.place ? <span class="lre-cp-path-up">in {pathLabel(bed.item.place)}</span> : null
              ) : character.home ? (
                <span class="lre-cp-path-up">{pathLabel(character.home)}</span>
              ) : null}
            </span>
          )}
          <Button size="sm" icon="moon" disabled={props.disabled} onClick={() => setOpen("bed")}>
            Change…
          </Button>
        </div>
      </div>
      {open === "bed" ? (
        <FormSheet title={`Where ${character.name} sleeps`} subtitle={bedWords(character)} onClose={() => setOpen(null)}>
          <div class="lre-cp-sheet" data-lre-bed-sheet="">
            <Section flush>
              <List>
                <OptionRow option={options[0] ?? { kind: "home", place: character.home }} home={character.home} bed={bed} onPick={pick} />
              </List>
            </Section>
            {rooms.length > 0 ? (
              <Section title="Rooms in their home" flush>
                <List>
                  {rooms.map((o) => (
                    <OptionRow key={o.kind === "place" ? o.place.id : ""} option={o} home={character.home} bed={bed} onPick={pick} />
                  ))}
                </List>
              </Section>
            ) : null}
            {homeThings.length > 0 ? (
              <Section title="Things in their home" flush>
                <List>
                  {homeThings.map((o) => (
                    <OptionRow key={o.kind === "item" ? o.item.id : ""} option={o} home={character.home} bed={bed} onPick={pick} />
                  ))}
                </List>
              </Section>
            ) : null}
            {rooms.length + homeThings.length === 0 ? <p class="lre-cp-note">{character.home ? "Nothing inside their home to sleep in yet." : "They have no home set, so there's nowhere nearer to offer."}</p> : null}
            <Section title="Somewhere else" flush>
              <List>
                <ListRow icon="map" title="Another place…" subtitle="Any place, by search or by browsing" chevron onClick={() => setOpen("place")} />
                {props.things ? <ListRow icon="search" title="A thing somewhere else…" subtitle="A bed, sofa or hammock anywhere, by its name or where it is" chevron onClick={() => setOpen("thing")} /> : null}
              </List>
            </Section>
          </div>
        </FormSheet>
      ) : null}
      {open === "place" ? (
        <PlaceSheet
          places={props.places}
          value={bed.kind === "place" ? (bed.place?.id ?? null) : null}
          title={`Where ${character.name} sleeps`}
          suggestions={character.home ? [{ label: "Their home", place: character.home }] : []}
          onClose={() => setOpen("bed")}
          onPick={(place) => (place ? pick({ kind: "place", place, item: null }) : pick({ kind: "home", place: character.home, item: null }))}
        />
      ) : null}
      {open === "thing" && props.things ? <ThingSheet things={props.things} bed={bed} onClose={() => setOpen("bed")} onPick={(item) => pick({ kind: "item", place: item.place, item })} /> : null}
    </div>
  );
}

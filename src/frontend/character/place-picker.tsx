// The place picker (DESIGN §7, the Character model), for Build, GM mode and any place choice: the
// value as a path, and a sheet to change it. The sheet finds a place by any word of its name or of
// the places around it, each result with its path; browses from the roots (or the current place's
// neighbours) down, each row with how many places it holds, › to open it and Choose to pick it; and
// puts the caller's suggestions on top. Secret places carry a badge: these are author and GM views.

import type { ComponentChildren } from "preact";
import { useId, useMemo, useState } from "preact/hooks";
import type { PlaceRef } from "../../shared/character";
import type { PlaceId } from "../../shared/ids";
import { FormSheet } from "../build/form-kit";
import { Badge, Button, Empty, IconButton, List, ListRow, Section } from "../components";
import { Icon } from "../icons";
import { browseStart, pathLabel, placeIndex, searchPlaces, trailTo, type PlaceIndex } from "./places";

/** A suggestion on top of the sheet: "Where they are", "Their home", "Where Sam is". */
export interface PlaceSuggestion {
  label: string;
  place: PlaceRef;
}

/** The badge a place carries in a picker: secret, or discoverable (hidden until found). */
export function PlaceBadge(props: { place: Pick<PlaceRef, "visibility"> }) {
  if (props.place.visibility === "secret") return <Badge tone="gm">Secret</Badge>;
  if (props.place.visibility === "discoverable") return <Badge>Hidden until found</Badge>;
  return null;
}

/** A place as its path: the places around it muted, its own name last; "Not set" without one. */
export function PlacePath(props: { place: PlaceRef | null; empty?: ComponentChildren }) {
  const { place } = props;
  if (!place) return <span class="lre-cp-path lre-muted">{props.empty ?? "Not set"}</span>;
  return (
    <span class="lre-cp-path" title={pathLabel(place)}>
      {place.path.map((name, i) => (
        <span key={`${i}:${name}`} class="lre-cp-path-up">
          {name}
          <span class="lre-cp-sep" aria-hidden="true">
            ›
          </span>
        </span>
      ))}
      <span class="lre-cp-path-name">{place.name}</span>
      <PlaceBadge place={place} />
    </span>
  );
}

/**
 * A place field: the value as a path, and the button that opens the sheet (`action`, "Change…" by
 * default). `clearLabel` offers clearing it in the sheet ("No home"); `onPick` gets null for that.
 */
export function PlacePicker(props: { places: readonly PlaceRef[]; value: PlaceId | null; onPick(place: PlaceRef | null): void; suggestions?: readonly PlaceSuggestion[]; title: string; label?: string; action?: string; clearLabel?: string; help?: ComponentChildren; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const current = useMemo(() => (props.value === null ? null : (props.places.find((p) => p.id === props.value) ?? null)), [props.places, props.value]);
  return (
    <div class="lre-cp-field" data-lre-place-picker={props.title}>
      <div class="lre-field">
        <span class="label">{props.label ?? props.title}</span>
        <div class="lre-cp-value">
          <PlacePath place={current} empty={props.value !== null ? `A place this list doesn't have (${props.value})` : undefined} />
          <Button size="sm" icon="pin" disabled={props.disabled} onClick={() => setOpen(true)}>
            {props.action ?? "Change…"}
          </Button>
        </div>
        {props.help !== undefined ? <span class="lre-field-help">{props.help}</span> : null}
      </div>
      {open ? (
        <PlaceSheet
          places={props.places}
          value={props.value}
          suggestions={props.suggestions}
          title={props.title}
          clearLabel={props.clearLabel}
          onClose={() => setOpen(false)}
          onPick={(place) => {
            setOpen(false);
            props.onPick(place);
          }}
        />
      ) : null}
    </div>
  );
}

/** One level of the browse: the places in `at` (the roots for null), each with how many it holds. */
function BrowseLevel(props: { index: PlaceIndex; at: PlaceId | null; value: PlaceId | null; onOpen(id: PlaceId | null): void; onPick(place: PlaceRef): void }) {
  const { index } = props;
  const trail = trailTo(index, props.at);
  const rows = index.children.get(props.at) ?? [];
  return (
    <Section title="Browse" flush>
      <nav class="lre-cp-trail" aria-label="Where you are browsing">
        <button type="button" class="lre-cp-crumb" aria-current={props.at === null ? "location" : undefined} onClick={() => props.onOpen(null)}>
          All places
        </button>
        {trail.map((p) => (
          <span key={p.id} class="lre-cp-crumb-step">
            <span class="lre-cp-sep" aria-hidden="true">
              ›
            </span>
            <button type="button" class="lre-cp-crumb" aria-current={p.id === props.at ? "location" : undefined} onClick={() => props.onOpen(p.id)}>
              {p.name}
            </button>
          </span>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p class="lre-cp-note">Nothing inside.</p>
      ) : (
        <div class="lre-cp-rows" role="list" data-lre-browse={props.at ?? ""}>
          {rows.map((p) => {
            const inside = index.children.get(p.id)?.length ?? 0;
            return (
              <div key={p.id} class="lre-cp-row" role="listitem" aria-current={p.id === props.value ? "true" : undefined}>
                <span class="lre-cp-row-text">
                  <span class="lre-cp-row-name">
                    {p.name}
                    <PlaceBadge place={p} />
                    {p.id === props.value ? <Badge tone="accent">Now</Badge> : null}
                  </span>
                  <span class="lre-cp-row-sub">{inside === 0 ? "No places inside" : inside === 1 ? "1 place inside" : `${inside} places inside`}</span>
                </span>
                <Button size="sm" onClick={() => props.onPick(p)}>
                  Choose
                </Button>
                {inside > 0 ? <IconButton icon="chevron-right" label={`Open ${p.name}`} onClick={() => props.onOpen(p.id)} /> : <span class="lre-cp-row-gap" aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/**
 * The picker's sheet alone, for an action rather than a field ("Move them…"): search, the caller's
 * suggestions, and the browse. Enter in the search picks its first result.
 */
export function PlaceSheet(props: { places: readonly PlaceRef[]; value: PlaceId | null; onPick(place: PlaceRef | null): void; onClose(): void; suggestions?: readonly PlaceSuggestion[]; title: string; clearLabel?: string }) {
  const index = useMemo(() => placeIndex(props.places), [props.places]);
  const current = props.value === null ? null : (index.byId.get(props.value) ?? null);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState<PlaceId | null>(() => browseStart(index, props.value));
  const searchId = useId();
  const results = useMemo(() => searchPlaces(index, query), [index, query]);
  const searching = query.trim() !== "";
  return (
    <FormSheet title={props.title} subtitle={current ? pathLabel(current) : "Not set"} onClose={props.onClose}>
      <div class="lre-cp-sheet" data-lre-place-sheet="">
        <div class="lre-cp-now">
          <span class="lre-cp-now-label">Now</span>
          <PlacePath place={current} />
        </div>
        <label class="lre-cp-search" for={searchId}>
          <Icon name="search" size={16} />
          <input
            id={searchId}
            class="lre-input"
            type="search"
            placeholder="Search by name or where it is"
            aria-label="Search places by name or where they are"
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
        {searching ? (
          results.length === 0 ? (
            <Empty icon="search">No place matches “{query.trim()}”.</Empty>
          ) : (
            <Section title={results.length === 1 ? "1 place" : `${results.length} places${results.length === 60 ? ", keep typing to narrow" : ""}`} flush>
              <div data-lre-place-results="">
                <List>
                  {results.map((p) => (
                    <ListRow key={p.id} icon="pin" title={p.name} subtitle={p.path.length > 0 ? p.path.join(" › ") : "At the top"} badge={<PlaceBadge place={p} />} current={p.id === props.value} onClick={() => props.onPick(p)} />
                  ))}
                </List>
              </div>
            </Section>
          )
        ) : (
          <>
            {(props.suggestions ?? []).length > 0 ? (
              <Section title="Suggestions" flush>
                <List>
                  {(props.suggestions ?? []).map((s) => (
                    <ListRow key={`${s.label}:${s.place.id}`} icon="star" title={s.label} subtitle={pathLabel(s.place)} badge={<PlaceBadge place={s.place} />} current={s.place.id === props.value} onClick={() => props.onPick(s.place)} />
                  ))}
                </List>
              </Section>
            ) : null}
            <BrowseLevel index={index} at={at} value={props.value} onOpen={setAt} onPick={props.onPick} />
            {props.clearLabel !== undefined && props.value !== null ? (
              <Button variant="ghost" icon="close" onClick={() => props.onPick(null)}>
                {props.clearLabel}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </FormSheet>
  );
}

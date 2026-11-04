// The where picker (ITEMS-SPEC §10.1, "Where is it?"): one picker for where a thing is or is kept,
// for Build's Add a thing, a thing's page and the Character page's Move, Give and Lend, and for any
// page that places a thing: places by their path, people, and the things that hold things, each with
// whose it is and where. The field shows the value as a path with Change…; the sheet finds a choice
// by any word of its name or whereabouts, browses from the top down (places, then who and what is
// there), offers the caller's suggestions and extra choices on top, and holds back what can't take
// the thing (a holder too small, a person past the ceiling), saying why. Secret ones carry a badge:
// these are author and GM views. Styles: the place picker's (styles/character.ts).

import type { ComponentChildren } from "preact";
import { useId, useMemo, useState } from "preact/hooks";
import type { SizeClass } from "../../shared/things";
import { SIZE_LABELS } from "../../shared/things";
import type { WhereChoice } from "../../shared/thing-view";
import { whoseWords } from "../../shared/thing-view";
import { FormSheet } from "../build/form-kit";
import { Badge, Button, Empty, IconButton, List, ListRow, Section } from "../components";
import { Icon } from "../icons";
import { cannotHold, pathText, searchWhere, WHERE_LIMIT, whereIndex, whereLabel, type WhereIndex } from "./where";

/** What the picker holds: one of its choices, or one of the caller's extra choices ("On its owner"). */
export type WherePick = { choice: WhereChoice } | { extra: string };

/** A choice the caller adds beyond places and holders: its value, its label and a line on what it means. */
export interface WhereExtra {
  value: string;
  label: string;
  help?: string;
}

/** A suggestion on top of the sheet: "On them", "Their home", "Where it was". */
export interface WhereSuggestion {
  label: string;
  choice: WhereChoice;
}

/** A choice as its path: the places and holders around it muted, its own name last; `empty` without one. */
export function WherePath(props: { choice: WhereChoice | null; empty?: ComponentChildren }) {
  const { choice } = props;
  if (!choice) return <span class="lre-cp-path lre-muted">{props.empty ?? "Nowhere"}</span>;
  return (
    <span class="lre-cp-path" title={whereLabel(choice)}>
      {choice.path.map((step, i) => (
        <span key={`${i}:${step.id}`} class="lre-cp-path-up">
          {step.name}
          <span class="lre-cp-sep" aria-hidden="true">
            ›
          </span>
        </span>
      ))}
      <span class="lre-cp-path-name">{choice.name}</span>
      {choice.secret ? <Badge tone="gm">Secret</Badge> : null}
    </span>
  );
}

/** What a choice holds or is, on its row's second line. */
function choiceLine(index: WhereIndex, choice: WhereChoice): string {
  const inside = index.children.get(choice.id)?.length ?? 0;
  const count = inside === 0 ? "" : inside === 1 ? "1 inside" : `${inside} inside`;
  if (choice.is === "place") return count || "Nothing inside";
  const holds = choice.holds !== null ? (choice.is === "person" ? `Carries up to ${SIZE_LABELS[choice.holds]}` : `Takes up to ${SIZE_LABELS[choice.holds]}`) : "";
  const whose = choice.whose && choice.whose.owners.length > 0 ? whoseWords(choice.whose) : "";
  return [whose, holds, count].filter((p) => p !== "").join(" · ");
}

/**
 * A where field: the value as a path, and the button that opens the sheet (`action`, "Change…" by
 * default). `size` holds back what can't take the thing; `extras` add choices of the caller's own;
 * `clearLabel` offers clearing it ("Nowhere"), for which `onPick` gets null.
 */
export function WherePicker(props: { choices: readonly WhereChoice[]; value: WherePick | null; onPick(next: WherePick | null): void; title: string; label?: string; size?: SizeClass | null; extras?: readonly WhereExtra[]; suggestions?: readonly WhereSuggestion[]; action?: string; clearLabel?: string; empty?: string; help?: ComponentChildren; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const extra = props.value && "extra" in props.value ? (props.extras ?? []).find((x) => "extra" in props.value! && x.value === props.value.extra) : undefined;
  return (
    <div class="lre-cp-field" data-lre-where-picker={props.title}>
      <div class="lre-field">
        <span class="label">{props.label ?? props.title}</span>
        <div class="lre-cp-value">
          {extra ? <span class="lre-cp-path">{extra.label}</span> : <WherePath choice={props.value && "choice" in props.value ? props.value.choice : null} empty={props.empty} />}
          <Button size="sm" icon="pin" disabled={props.disabled} onClick={() => setOpen(true)}>
            {props.action ?? "Change…"}
          </Button>
        </div>
        {props.help !== undefined ? <span class="lre-field-help">{props.help}</span> : null}
      </div>
      {open ? (
        <WhereSheet
          choices={props.choices}
          value={props.value}
          size={props.size ?? null}
          extras={props.extras}
          suggestions={props.suggestions}
          title={props.title}
          clearLabel={props.clearLabel}
          empty={props.empty}
          onClose={() => setOpen(false)}
          onPick={(next) => {
            setOpen(false);
            props.onPick(next);
          }}
        />
      ) : null}
    </div>
  );
}

/** One choice as a row of the sheet: what it is, Choose (held back, with why, when it can't take the thing), and › into it. */
function ChoiceRow(props: { index: WhereIndex; choice: WhereChoice; size: SizeClass | null; current: boolean; onPick(choice: WhereChoice): void; onOpen?(id: string): void }) {
  const { choice } = props;
  const why = cannotHold(choice, props.size);
  const inside = props.index.children.get(choice.id)?.length ?? 0;
  const onOpen = props.onOpen;
  return (
    <div class="lre-cp-row" role="listitem" aria-current={props.current ? "true" : undefined} data-lre-where-choice={choice.id}>
      <span class="lre-cp-row-text">
        <span class="lre-cp-row-name">
          {choice.is === "person" ? <Icon name="user" size={14} /> : choice.is === "thing" ? <Icon name="box" size={14} /> : null}
          {choice.name}
          {choice.secret ? <Badge tone="gm">Secret</Badge> : null}
          {props.current ? <Badge tone="accent">Now</Badge> : null}
        </span>
        <span class="lre-cp-row-sub">{why ?? choiceLine(props.index, choice)}</span>
      </span>
      <Button size="sm" disabled={why !== null} label={why !== null ? `${choice.name}: ${why}` : `Choose ${choice.name}`} onClick={() => props.onPick(choice)}>
        Choose
      </Button>
      {onOpen && inside > 0 ? <IconButton icon="chevron-right" label={`Open ${choice.name}`} onClick={() => onOpen(choice.id)} /> : <span class="lre-cp-row-gap" aria-hidden="true" />}
    </div>
  );
}

/** Where browsing starts: among the current choice's neighbours, else at the top. */
function browseStart(index: WhereIndex, value: WherePick | null): string | null {
  const id = value && "choice" in value ? value.choice.id : null;
  const parent = id !== null ? index.byId.get(id)?.parent : null;
  return parent !== null && parent !== undefined && index.byId.has(parent) ? parent : null;
}

/** The choices around one being browsed, outermost first, by id. */
function trail(index: WhereIndex, id: string | null): WhereChoice[] {
  const out: WhereChoice[] = [];
  const seen = new Set<string>();
  for (let at = id === null ? undefined : index.byId.get(id); at && !seen.has(at.id); at = at.parent === null ? undefined : index.byId.get(at.parent)) {
    seen.add(at.id);
    out.unshift(at);
  }
  return out;
}

/**
 * The picker's sheet alone, for an action rather than a field ("Move…", "Give…"): search, the
 * caller's suggestions and extra choices, and the browse. Enter in the search picks its first
 * result that can take the thing.
 */
export function WhereSheet(props: { choices: readonly WhereChoice[]; value: WherePick | null; onPick(next: WherePick | null): void; onClose(): void; title: string; size?: SizeClass | null; extras?: readonly WhereExtra[]; suggestions?: readonly WhereSuggestion[]; clearLabel?: string; empty?: string }) {
  const index = useMemo(() => whereIndex(props.choices), [props.choices]);
  const size = props.size ?? null;
  const [query, setQuery] = useState("");
  const [at, setAt] = useState<string | null>(() => browseStart(index, props.value));
  const searchId = useId();
  const results = useMemo(() => searchWhere(index, query), [index, query]);
  const current = props.value && "choice" in props.value ? props.value.choice : null;
  const extra = props.value && "extra" in props.value ? (props.extras ?? []).find((x) => "extra" in props.value! && x.value === props.value.extra) : undefined;
  const pick = (choice: WhereChoice): void => props.onPick({ choice });
  const steps = trail(index, at);
  const rows = index.children.get(at) ?? [];
  return (
    <FormSheet title={props.title} subtitle={extra ? extra.label : current ? whereLabel(current) : (props.empty ?? "Nowhere")} onClose={props.onClose}>
      <div class="lre-cp-sheet" data-lre-where-sheet="">
        <div class="lre-cp-now">
          <span class="lre-cp-now-label">Now</span>
          {extra ? <span class="lre-cp-path">{extra.label}</span> : <WherePath choice={current} empty={props.empty} />}
        </div>
        <label class="lre-cp-search" for={searchId}>
          <Icon name="search" size={16} />
          <input
            id={searchId}
            class="lre-input"
            type="search"
            placeholder="Search places, people and what holds things"
            aria-label="Search places, people and what holds things"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              const first = results.find((c) => cannotHold(c, size) === null);
              if (event.key !== "Enter" || !first) return;
              event.preventDefault();
              pick(first);
            }}
          />
        </label>
        {query.trim() !== "" ? (
          results.length === 0 ? (
            <Empty icon="search">Nothing matches “{query.trim()}”.</Empty>
          ) : (
            <Section title={results.length === 1 ? "1 match" : `${results.length} matches${results.length === WHERE_LIMIT ? ", keep typing to narrow" : ""}`} flush>
              <div class="lre-cp-rows" role="list" data-lre-where-results="">
                {results.map((c) => (
                  <ChoiceRow key={c.id} index={index} choice={c} size={size} current={c.id === current?.id} onPick={pick} />
                ))}
              </div>
            </Section>
          )
        ) : (
          <>
            {(props.suggestions ?? []).length > 0 || (props.extras ?? []).length > 0 ? (
              <Section title="Suggestions" flush>
                <List>
                  {(props.extras ?? []).map((x) => (
                    <ListRow key={`extra:${x.value}`} icon="star" title={x.label} subtitle={x.help} current={extra?.value === x.value} onClick={() => props.onPick({ extra: x.value })} />
                  ))}
                  {(props.suggestions ?? []).map((s) => {
                    const why = cannotHold(s.choice, size);
                    return <ListRow key={`${s.label}:${s.choice.id}`} icon="star" title={s.label} subtitle={why ?? pathText([...s.choice.path, { id: s.choice.id, name: s.choice.name, is: s.choice.is }])} disabled={why !== null} current={s.choice.id === current?.id} onClick={() => pick(s.choice)} />;
                  })}
                </List>
              </Section>
            ) : null}
            <Section title="Browse" flush>
              <nav class="lre-cp-trail" aria-label="Where you are browsing">
                <button type="button" class="lre-cp-crumb" aria-current={at === null ? "location" : undefined} onClick={() => setAt(null)}>
                  Everywhere
                </button>
                {steps.map((c) => (
                  <span key={c.id} class="lre-cp-crumb-step">
                    <span class="lre-cp-sep" aria-hidden="true">
                      ›
                    </span>
                    <button type="button" class="lre-cp-crumb" aria-current={c.id === at ? "location" : undefined} onClick={() => setAt(c.id)}>
                      {c.name}
                    </button>
                  </span>
                ))}
              </nav>
              {rows.length === 0 ? (
                <p class="lre-cp-note">Nothing inside.</p>
              ) : (
                <div class="lre-cp-rows" role="list" data-lre-where-browse={at ?? ""}>
                  {rows.map((c) => (
                    <ChoiceRow key={c.id} index={index} choice={c} size={size} current={c.id === current?.id} onPick={pick} onOpen={setAt} />
                  ))}
                </div>
              )}
            </Section>
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

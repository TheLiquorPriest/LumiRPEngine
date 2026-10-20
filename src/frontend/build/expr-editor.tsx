// The expression editor (DESIGN §13 special widget): a monospace input
// with suggestions for the word at the caret, a plain-words readout of what the formula reads, a
// bracket and quote balance check, and the backend's lint for this field. Its palette (operators,
// functions and the world's names) opens inline on desktop; the full-page formula editor holds the
// same parts, and is where ƒx goes on a phone. Parsing and evaluation stay in the engine; the
// backend lints. The functions are the backend's own list (`lre.world get` `functions`: the math
// built-ins, the engine's and the registered packs' formulas), so the editor never offers a name
// the engine lacks.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import { DOMAINS } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import type { LintIssue } from "../../shared/protocol";
import type { WorldDoc } from "../../shared/world";
import { EFFECT_ONLY_FUNCTIONS } from "../../shared/world";
import { useApp } from "../app";
import { Button, IconButton, IdText } from "../components";
import { Icon } from "../icons";
import { isMobile } from "../layout";
import { useSelect } from "../store";
import { Chip, FormSheet, Issues } from "./form-kit";

/** The word operators: they go in with a space either side. */
const WORD_OPERATORS: readonly string[] = ["and", "or", "not"];

/** The palette's operators in their groups, each with the name assistive tech reads and the tooltip shows. */
const OPERATOR_GROUPS: readonly { title: string; keys: readonly (readonly [token: string, name: string])[] }[] = [
  {
    title: "Arithmetic",
    keys: [
      ["+", "Plus"],
      ["-", "Minus"],
      ["*", "Times"],
      ["/", "Divided by"],
      ["%", "Remainder"],
      ["(", "Open bracket"],
      [")", "Close bracket"],
    ],
  },
  {
    title: "Compare",
    keys: [
      ["==", "Equals"],
      ["!=", "Doesn't equal"],
      ["<", "Less than"],
      ["<=", "At most"],
      [">", "More than"],
      [">=", "At least"],
    ],
  },
  {
    title: "Logic",
    keys: [
      ["and", "And"],
      ["or", "Or"],
      ["not", "Not"],
      ["?", "Then"],
      [":", "Otherwise"],
    ],
  },
];

/**
 * Where an expression sits: a `formula` (a modifier, requirement, derived field, rule condition or
 * sheet row) or an `effect` argument, the only place `roll()` and the other effect-only functions
 * work (DESIGN §11).
 */
export type ExprMode = "formula" | "effect";

/** The function names the editor offers in a mode: the backend's list, plus the effect-only ones in an effect argument. */
export function exprFunctions(functions: readonly string[], mode: ExprMode): string[] {
  const names = new Set(functions);
  for (const name of EFFECT_ONLY_FUNCTIONS) {
    if (mode === "effect") names.add(name);
    else names.delete(name);
  }
  return [...names].sort();
}

/** Suggestions for the word being typed: identifiers that extend it, then functions (as `name(`) that do. */
export function exprCompletions(word: string, identifiers: readonly string[], functions: readonly string[]): string[] {
  if (word === "") return [];
  const ids = identifiers.filter((id) => id.startsWith(word) && id !== word);
  const calls = functions.filter((name) => name.startsWith(word)).map((name) => `${name}(`);
  return [...ids, ...calls].slice(0, 8);
}

export interface Balance {
  ok: boolean;
  message: string | null;
}

/** Bracket and string balance only; real parse errors come from the backend lint. */
export function checkBalance(text: string): Balance {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== pairs[ch]) return { ok: false, message: `Unexpected ${ch} at ${i + 1}` };
    }
  }
  if (quote) return { ok: false, message: "Unclosed string" };
  if (stack.length > 0) return { ok: false, message: `${stack.length} unclosed ${stack.at(-1)}` };
  return { ok: true, message: null };
}

// ---------------------------------------------------------------- the readout

/** What a formula reads, as engine/scope looks names up. */
export type ExprReadKind = "entity field" | "entity" | "place field" | "place" | "track stage" | "track" | "check" | "own field" | "level" | "the clock" | "self" | "pov" | "here" | "param";

/** One thing a formula reads: the name as the formula writes it, the thing in words, and what it is. */
export interface ExprRead {
  id: string;
  label: string;
  what: ExprReadKind;
}

/** What a formula reads and the functions it calls, each once, in the order the formula first uses it. */
export interface ExprReads {
  reads: ExprRead[];
  functions: string[];
}

/** Literals and operators the engine's tokenizer reads as names: never a read. */
const KEYWORDS: Readonly<Record<string, true>> = { and: true, or: true, not: true, true: true, false: true, null: true };

/** The clock's names (engine/scope), in words. */
const CLOCK_WORDS: Readonly<Record<string, string>> = {
  clock: "the time",
  minute: "the minute of the day",
  hour: "the hour",
  day: "the day number",
  weekday: "the weekday",
  date: "the day of the month",
  month: "the month",
  year: "the year",
  daypart: "the part of the day",
};

/** The bindings an action gives its formulas besides `self` (engine/scope), in words. */
const BINDING_WORDS: Readonly<Record<string, string>> = { actor: "the actor", target: "the target" };

/** The realism domains `level.<domain>` reads, as plain strings to look a written name up in. */
const DOMAIN_IDS: readonly string[] = DOMAINS;

/** A name's first character and the rest of it, as the engine's tokenizer reads them (engine/expr). */
const NAME_START = /[A-Za-z_]/;
const NAME_PART = /\w/;

/**
 * The names and calls in a formula, found as the engine's tokenizer finds them (engine/expr):
 * quoted strings, with their backslash escapes, are skipped; a dotted path is one name (spaces
 * around its dots allowed); a name followed by `(` is a call.
 */
function formulaNames(text: string): { path: string[]; call: boolean }[] {
  const out: { path: string[]; call: boolean }[] = [];
  const skipSpace = (from: number): number => {
    let j = from;
    while (/\s/.test(text.charAt(j))) j += 1;
    return j;
  };
  const nameEnd = (from: number): number => {
    let j = from + 1;
    while (NAME_PART.test(text.charAt(j))) j += 1;
    return j;
  };
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '"' || c === "'") {
      i += 1;
      while (i < text.length && text.charAt(i) !== c) i += text.charAt(i) === "\\" ? 2 : 1;
      i += 1;
    } else if (NAME_START.test(c)) {
      let end = nameEnd(i);
      const path = [text.slice(i, end)];
      for (;;) {
        const dot = skipSpace(end);
        // A dot before a digit starts a number (`.5`), not the path's next name.
        if (text.charAt(dot) !== "." || /[0-9]/.test(text.charAt(dot + 1))) break;
        const start = skipSpace(dot + 1);
        if (!NAME_START.test(text.charAt(start))) break;
        end = nameEnd(start);
        path.push(text.slice(start, end));
      }
      out.push({ path, call: path.length === 1 && text.charAt(skipSpace(end)) === "(" });
      i = end;
    } else {
      // Digits never start a name, so a number is skipped a character at a time.
      i += 1;
    }
  }
  return out;
}

/** A field's label: from `kind` when it labels the field, else from any kind that does. */
function fieldLabel(doc: WorldDoc | undefined, field: string, kind?: string): string | undefined {
  if (!doc) return undefined;
  const preferred = kind !== undefined && hasOwn(doc.kinds, kind) ? doc.kinds[kind] : undefined;
  for (const def of preferred ? [preferred, ...Object.values(doc.kinds)] : Object.values(doc.kinds)) {
    const label = hasOwn(def.fields, field) ? def.fields[field]?.label : undefined;
    if (label) return label;
  }
  return undefined;
}

/** A field path in words: the first field's label (or its id), then any deeper keys. */
function fieldWords(doc: WorldDoc | undefined, path: readonly string[], kind?: string): string {
  const [field = "", ...deeper] = path;
  const label = fieldLabel(doc, field, kind);
  // Inside a sentence "Cash" reads "cash", while an abbreviation ("HP", "XP total") stays as written.
  const words = label === undefined ? field : /^[A-Z](?![A-Z])/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
  return [words, ...deeper].join(".");
}

/** What the world calls an identifier: an entity's or a place's name, a track's label or a field's label. */
function nameOf(doc: WorldDoc | undefined, id: string): string | undefined {
  if (!doc) return undefined;
  if (hasOwn(doc.entities, id)) return doc.entities[id]?.name || undefined;
  if (hasOwn(doc.places, id)) return doc.places[id]?.name || undefined;
  if (hasOwn(doc.tracks, id)) return doc.tracks[id]?.label || undefined;
  return fieldLabel(doc, id);
}

/** One read in words, sorted in engine/scope's lookup order; without the world its ids stand in for names. */
function readOf(path: readonly string[], doc: WorldDoc | undefined): ExprRead {
  const id = path.join(".");
  const [head = "", ...rest] = path;
  const [second = ""] = rest;
  if (head === "self") return rest.length === 0 ? { id, label: "self", what: "self" } : { id, label: `own ${fieldWords(doc, rest)}`, what: "own field" };
  const binding = hasOwn(BINDING_WORDS, head) ? BINDING_WORDS[head] : undefined;
  if (binding !== undefined) return { id, label: rest.length === 0 ? binding : `${binding}'s ${fieldWords(doc, rest)}`, what: "param" };
  if (head === "pov") {
    const kind = doc && hasOwn(doc.entities, doc.pov) ? doc.entities[doc.pov]?.kind : undefined;
    return { id, label: rest.length === 0 ? "the POV character" : `the POV character's ${fieldWords(doc, rest, kind)}`, what: "pov" };
  }
  if (head === "here") return { id, label: rest.length === 0 ? "the current place" : `the ${fieldWords(doc, rest)} here`, what: "here" };
  if (head === "stage" && rest.length === 1) {
    const track = (doc && hasOwn(doc.tracks, second) ? doc.tracks[second]?.label : undefined) || second;
    return { id, label: `the stage of “${track}”`, what: "track stage" };
  }
  if (head === "level" && rest.length === 1 && DOMAIN_IDS.includes(second)) return { id, label: `the ${second} level`, what: "level" };
  if (rest.length === 0 && hasOwn(CLOCK_WORDS, head)) return { id, label: CLOCK_WORDS[head] ?? head, what: "the clock" };
  if (doc && hasOwn(doc.entities, head)) {
    const entity = doc.entities[head];
    const name = entity?.name || head;
    return rest.length === 0 ? { id, label: name, what: "entity" } : { id, label: `${name}'s ${fieldWords(doc, rest, entity?.kind)}`, what: "entity field" };
  }
  if (doc && hasOwn(doc.places, head)) {
    const name = doc.places[head]?.name || head;
    return rest.length === 0 ? { id, label: name, what: "place" } : { id, label: `${name}'s ${fieldWords(doc, rest)}`, what: "place field" };
  }
  if (doc && rest.length === 0) {
    if (hasOwn(doc.tracks, head)) return { id, label: `the track “${doc.tracks[head]?.label || head}”`, what: "track" };
    if (hasOwn(doc.checks, head)) return { id, label: `the ${head} check`, what: "check" };
    // A bare field name reads the field of `self` (a sheet row's or a derived field's own).
    if (Object.values(doc.kinds).some((def) => hasOwn(def.fields, head))) return { id, label: `own ${fieldWords(doc, path)}`, what: "own field" };
  }
  return { id, label: id, what: "param" };
}

/**
 * What a formula reads, each thing once, in the order it first reads it: entities, places and
 * their fields, a track's stage, tracks and checks, its own fields (`self.cash`, or a bare field
 * name), levels, the clock, `self`, `pov`, `here`, and any other name as a param (an action's
 * params, `event.*`, `track.*`). Plus the functions it calls, once each. Quoted strings, numbers
 * and operators are not reads. Names come from `doc`; without it the ids stand in.
 */
export function exprReads(text: string, doc?: WorldDoc): ExprReads {
  const reads: ExprRead[] = [];
  const functions: string[] = [];
  for (const { path, call } of formulaNames(text)) {
    const head = path[0] ?? "";
    if (hasOwn(KEYWORDS, head)) continue;
    if (call) {
      if (!functions.includes(head)) functions.push(head);
    } else {
      const id = path.join(".");
      if (!reads.some((read) => read.id === id)) reads.push(readOf(path, doc));
    }
  }
  return { reads, functions };
}

/** A formula in one short sentence: "Reads Sam's cash and the hour; uses min." A constant "Reads nothing." */
export function exprSummary(text: string, doc?: WorldDoc): string {
  const { reads, functions } = exprReads(text, doc);
  // Two ways of writing the same thing (`self.cash` and a bare `cash`) say it once.
  const labels = [...new Set(reads.map((read) => read.label))];
  // Each as a list: "a", "a and b", "a, b and c".
  const [reading = "", using = ""] = [labels, functions].map((words) => (words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`));
  const sentence = reading === "" ? "Reads nothing" : `Reads ${reading}`;
  return using === "" ? `${sentence}.` : `${sentence}; uses ${using}.`;
}

/** A formula in plain words, as a quiet line, so every formula carries a readout; nothing while it is empty. */
export function ExprReadout(props: { text: string; doc?: WorldDoc }) {
  if (props.text.trim() === "") return null;
  return <p class="lre-expr-readout">{exprSummary(props.text, props.doc)}</p>;
}

// ---------------------------------------------------------------- editing

/** The value with `token` put in at the caret, over the `replace` characters before it; a word operator gets a space either side. */
function withToken(value: string, start: number, end: number, token: string, replace: number): { value: string; caret: number } {
  const before = value.slice(0, Math.max(0, start - replace));
  const text = WORD_OPERATORS.includes(token) ? ` ${token} ` : token;
  return { value: before + text + value.slice(end), caret: before.length + text.length };
}

/**
 * A formula's textarea: the word at its caret, and putting a token in there with the caret after
 * it. `press` runs on any press in the editor, before focus moves. On a phone a token tapped while
 * the keyboard was down leaves it down: focusing the formula would bring it up over the palette.
 */
function useFormula(value: string, onChange: (value: string) => void, mobile: boolean) {
  const input = useRef<HTMLTextAreaElement>(null);
  const typing = useRef(false);
  const [caret, setCaret] = useState<number | null>(null);
  const word = /[A-Za-z_][\w.]*$/.exec(value.slice(0, Math.min(caret ?? value.length, value.length)))?.[0] ?? "";
  const track = () => setCaret(input.current?.selectionStart ?? null);
  return {
    input,
    word,
    track,
    press: () => {
      typing.current = document.activeElement === input.current;
    },
    edit: (text: string) => {
      onChange(text);
      track();
    },
    insert: (token: string, replace = 0) => {
      const el = input.current;
      const next = withToken(value, el?.selectionStart ?? value.length, el?.selectionEnd ?? value.length, token, replace);
      const focus = !mobile || typing.current;
      typing.current = false;
      onChange(next.value);
      setCaret(next.caret);
      queueMicrotask(() => {
        if (focus) el?.focus({ preventScroll: true });
        el?.setSelectionRange(next.caret, next.caret);
      });
    },
  };
}

/** Chips for the word at the caret; an identifier the world names shows its name beside it. On a phone the row scrolls sideways. */
function Suggestions(props: { word: string; identifiers: readonly string[]; functions: readonly string[]; doc?: WorldDoc; scroll: boolean; onPick(token: string): void }) {
  const tokens = exprCompletions(props.word, props.identifiers, props.functions);
  if (tokens.length === 0) return null;
  return (
    <div class={props.scroll ? "lre-form-chips lre-expr-suggest scroll" : "lre-form-chips lre-expr-suggest"} role="group" aria-label="Suggestions">
      {tokens.map((token) => {
        const name = token.endsWith("(") ? undefined : nameOf(props.doc, token);
        // A name that says no more than its id ("Old mill" for `old_mill`) isn't repeated beside it.
        const shown = name !== undefined && name.toLowerCase().replace(/[_\s]+/g, " ").trim() !== token.toLowerCase().replace(/_/g, " ") ? name : undefined;
        return (
          <Chip key={token} label={shown !== undefined ? `${token}, ${shown}` : undefined} onPress={() => props.onPick(token)}>
            <span class="lre-expr-token">{token}</span>
            {shown !== undefined ? <span class="lre-expr-chip-name">{shown}</span> : null}
          </Chip>
        );
      })}
    </div>
  );
}

/** A palette group under its quiet title. */
function KeyGroup(props: { title: string; children: ComponentChildren }) {
  const id = useId();
  return (
    <div class="lre-expr-group" role="group" aria-labelledby={id}>
      <span id={id} class="lre-expr-group-title">
        {props.title}
      </span>
      {props.children}
    </div>
  );
}

/** A find box over a long group of keys. Escape empties it first, so a full page closes only on the next Escape. */
function KeyFilter(props: { label: string; value: string; onInput(value: string): void }) {
  return (
    <div class="lre-build-search">
      <Icon name="search" size={16} />
      <input
        class="lre-input"
        type="search"
        placeholder={props.label}
        aria-label={props.label}
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || props.value === "") return;
          event.preventDefault();
          props.onInput("");
        }}
      />
    </div>
  );
}

/**
 * The ƒx palette: the operators in groups, every function the field may call (as `name(`) and the
 * names it can read, with find boxes. A name shows what the world calls it, its id with Show ids.
 */
function Palette(props: { functions: readonly string[]; identifiers: readonly string[]; doc?: WorldDoc; inline?: boolean; onInsert(token: string): void }) {
  const [callQuery, setCallQuery] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const names = useMemo(() => props.identifiers.map((id) => ({ id, name: nameOf(props.doc, id) })), [props.identifiers, props.doc]);
  const callNeedle = callQuery.trim().toLowerCase();
  const nameNeedle = nameQuery.trim().toLowerCase();
  const calls = props.functions.filter((name) => name.toLowerCase().includes(callNeedle));
  const shown = names.filter((n) => n.id.toLowerCase().includes(nameNeedle) || (n.name ?? "").toLowerCase().includes(nameNeedle));
  return (
    <div class={props.inline ? "lre-expr-palette inline" : "lre-expr-palette"}>
      {OPERATOR_GROUPS.map((group) => (
        <KeyGroup key={group.title} title={group.title}>
          <div class="lre-expr-keys">
            {group.keys.map(([token, name]) => (
              <button key={token} type="button" class="lre-expr-key" aria-label={name} title={name} onClick={() => props.onInsert(token)}>
                {token}
              </button>
            ))}
          </div>
        </KeyGroup>
      ))}
      {props.functions.length > 0 ? (
        <KeyGroup title="Functions">
          <KeyFilter label="Find a function" value={callQuery} onInput={setCallQuery} />
          {calls.length > 0 ? (
            <div class="lre-expr-words">
              {calls.map((name) => (
                <button key={name} type="button" class="lre-expr-key" onClick={() => props.onInsert(`${name}(`)}>
                  {name}(
                </button>
              ))}
            </div>
          ) : (
            <p class="lre-expr-none">No function matches.</p>
          )}
        </KeyGroup>
      ) : null}
      {names.length > 0 ? (
        <KeyGroup title="Names">
          {names.length > 8 ? <KeyFilter label="Find a name" value={nameQuery} onInput={setNameQuery} /> : null}
          {shown.length > 0 ? (
            <div class="lre-expr-words">
              {shown.map((n) => (
                <button key={n.id} type="button" class="lre-expr-key name" onClick={() => props.onInsert(n.id)}>
                  {n.name !== undefined ? <span>{n.name}</span> : <span class="lre-expr-token">{n.id}</span>}
                  {n.name !== undefined ? <IdText id={n.id} /> : null}
                </button>
              ))}
            </div>
          ) : (
            <p class="lre-expr-none">No name matches.</p>
          )}
        </KeyGroup>
      ) : null}
    </div>
  );
}

/**
 * The full-page formula editor (a sub-editor opens as its own page): the formula
 * large, with its suggestions, readout and problems kept in view while the palette scrolls under
 * them. Edits apply as they are made; Done and Back both close it.
 */
function ExprPage(props: { label: string; hint?: string; value: string; identifiers: readonly string[]; functions: readonly string[]; doc?: WorldDoc; issues: readonly LintIssue[]; invalid: boolean; mobile: boolean; onChange(value: string): void; onClose(): void }) {
  const formula = useFormula(props.value, props.onChange, props.mobile);
  useEffect(() => {
    // After FormSheet has put focus on Back (its effect runs in this same pass): the formula is what the page is for.
    const timer = setTimeout(() => {
      const el = formula.input.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
      formula.track();
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <FormSheet
      title={props.label}
      subtitle={props.hint}
      onClose={props.onClose}
      actions={
        <Button variant="primary" size="sm" onClick={() => props.onClose()}>
          Done
        </Button>
      }
    >
      <div class="lre-expr-page" onPointerDown={formula.press}>
        <div class="lre-expr-compose">
          <textarea
            ref={formula.input}
            class={props.invalid ? "lre-input lre-expr-input page invalid" : "lre-input lre-expr-input page"}
            rows={6}
            spellcheck={false}
            autocapitalize="off"
            autocorrect="off"
            aria-label={props.label}
            value={props.value}
            onInput={(event) => formula.edit(event.currentTarget.value)}
            onKeyUp={formula.track}
            onClick={formula.track}
          />
          <Suggestions word={formula.word} identifiers={props.identifiers} functions={props.functions} doc={props.doc} scroll={props.mobile} onPick={(token) => formula.insert(token, formula.word.length)} />
          <ExprReadout text={props.value} doc={props.doc} />
          <Issues issues={props.issues} />
        </div>
        <Palette functions={props.functions} identifiers={props.identifiers} doc={props.doc} onInsert={(token) => formula.insert(token)} />
      </div>
    </FormSheet>
  );
}

/**
 * A formula field. ƒx toggles the palette under it on desktop and opens the full-page editor on a
 * phone, where the inline palette would not fit; the expand button opens that page at any width.
 * `doc` names what the formula reads in its readout and the palette; `hint` is the field's help.
 */
export function ExprEditor(props: { label: string; value: string; identifiers: readonly string[]; functions: readonly string[]; mode?: ExprMode; lint: readonly LintIssue[]; optional?: boolean; doc?: WorldDoc; hint?: string; onChange(value: string): void }) {
  const app = useApp();
  const mobile = useSelect(app.host.viewport, isMobile);
  const [tools, setTools] = useState(false);
  const [page, setPage] = useState(false);
  const functions = useMemo(() => exprFunctions(props.functions, props.mode ?? "formula"), [props.functions, props.mode]);
  const formula = useFormula(props.value, props.onChange, mobile);
  const balance = checkBalance(props.value);
  const invalid = !balance.ok || props.lint.length > 0;
  const issues: readonly LintIssue[] = balance.message ? [{ severity: "error", path: "", code: "balance", message: balance.message }, ...props.lint] : props.lint;
  return (
    <div class="lre-field" data-lre-expr onPointerDown={formula.press}>
      <div class="label lre-expr-head">
        <span class="lre-expr-label">
          {props.label}
          {props.optional ? <span class="lre-form-optional"> · optional</span> : null}
        </span>
        <span class="lre-expr-actions">
          <IconButton icon="function" label="Operators and functions" pressed={mobile ? undefined : tools} onClick={() => (mobile ? setPage(true) : setTools(!tools))} />
          <IconButton icon="expand" label="Open the formula editor" onClick={() => setPage(true)} />
        </span>
      </div>
      <textarea
        ref={formula.input}
        class={invalid ? "lre-input lre-expr-input invalid" : "lre-input lre-expr-input"}
        rows={2}
        spellcheck={false}
        autocapitalize="off"
        autocorrect="off"
        aria-label={props.label}
        value={props.value}
        onInput={(event) => formula.edit(event.currentTarget.value)}
        onKeyUp={formula.track}
        onClick={formula.track}
      />
      <Suggestions word={formula.word} identifiers={props.identifiers} functions={functions} doc={props.doc} scroll={mobile} onPick={(token) => formula.insert(token, formula.word.length)} />
      {tools && !mobile ? <Palette functions={functions} identifiers={props.identifiers} doc={props.doc} inline onInsert={(token) => formula.insert(token)} /> : null}
      <ExprReadout text={props.value} doc={props.doc} />
      {props.hint ? <span class="lre-field-help">{props.hint}</span> : null}
      <Issues issues={issues} />
      {page ? <ExprPage label={props.label} hint={props.hint} value={props.value} identifiers={props.identifiers} functions={functions} doc={props.doc} issues={issues} invalid={invalid} mobile={mobile} onChange={props.onChange} onClose={() => setPage(false)} /> : null}
    </div>
  );
}

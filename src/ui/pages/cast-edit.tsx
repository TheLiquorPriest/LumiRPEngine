// The Cast page's own hands (plan §14 Cast, §7.1): what the owner does to a character from the page. Each form sends one edit.
// What is being typed is the page's (`cast.tsx` keeps it as drafts and gives it back), so these hold nothing; what came of an
// edit is the page's too. Every edit is his own change, which the Author is told of in the next briefing.

import type { BaseAsk, BaseDocument, BaseNow, CastingAsk, CastMemberRow, CastRole, PerceptionAsk, PersonAsk, SourceAsk, SourceBindingKind, SourceBindingRow } from "../../shared/api";
import { Badge, Button, Fold } from "../atoms";

/** One edit the page sends: by the route that makes it. */
export type CastEdit =
  | { what: "casting"; body: CastingAsk }
  | { what: "base"; body: BaseAsk }
  | { what: "sources"; body: SourceAsk }
  | { what: "person"; body: PersonAsk }
  | { what: "perception"; body: PerceptionAsk };

/** What he has typed and not sent, by the name of the field. */
export type Drafts = Readonly<Record<string, string | boolean>>;

export const CASTING_ROLES: readonly CastRole[] = ["principal", "supporting", "extra"];
export const BASE_DOCUMENTS: readonly BaseDocument[] = ["seed", "soul", "inner_voice", "background"];
export const BASE_WORDS: Readonly<Record<BaseDocument, string>> = { seed: "Seed", soul: "Soul", inner_voice: "Inner voice", background: "Background" };
export const SOURCE_KINDS: readonly SourceBindingKind[] = ["card", "persona", "entry", "memory"];
export const SOURCE_WORDS: Readonly<Record<SourceBindingKind, string>> = { card: "character card", persona: "persona", entry: "lore entry", memory: "memory entity" };

const typed = (e: Event): string => (e.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;

/** What a form is given: what is typed and how to keep it, and whether an edit is out now. */
interface FormProps {
  drafts: Drafts;
  onDraft(name: string, value: string | boolean): void;
  busy: boolean;
  onEdit(edit: CastEdit): void;
}

const text = (drafts: Drafts, name: string, fallback: string): string => {
  const held = drafts[name];
  return typeof held === "string" ? held : fallback;
};

/** Sets how large a part it plays, pinned so it stands over the Author's or not; takes a pin away. */
export function CastingEditor(props: FormProps & { member: CastMemberRow }) {
  const { casting } = props.member;
  const as = text(props.drafts, "casting.as", casting?.as ?? "supporting") as CastRole;
  const pinned = props.drafts["casting.pin"];
  const pin = typeof pinned === "boolean" ? pinned : (casting?.pinned ?? false);
  const line = text(props.drafts, "casting.line", casting?.line ?? "");
  return (
    <Fold summary="Set its casting">
      <div class="lre-stack" data-edit="casting">
        <label class="lre-field">
          <span class="label">How large a part it plays</span>
          <select class="lre-input" value={as} onChange={(e) => props.onDraft("casting.as", typed(e))}>
            {CASTING_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <label class="lre-inline">
          <input type="checkbox" checked={pin} onChange={(e) => props.onDraft("casting.pin", (e.currentTarget as HTMLInputElement).checked)} /> <span>Pin it: it stands over the Author's casting until you take the pin away</span>
        </label>
        <label class="lre-field">
          <span class="label">Its line, the part it plays in a few words (optional)</span>
          <input class="lre-input" value={line} spellcheck={false} onInput={(e) => props.onDraft("casting.line", typed(e))} />
        </label>
        <div class="lre-inline rpe-wrap">
          <Button busy={props.busy} onClick={() => props.onEdit({ what: "casting", body: { as, pin, ...(line.trim() === "" ? {} : { line: line.trim() }) } })}>
            Set casting
          </Button>
          {casting?.pinned === true ? (
            <Button kind="ghost" busy={props.busy} onClick={() => props.onEdit({ what: "casting", body: { as: null, pin: false } })}>
              Take the pin away
            </Button>
          ) : null}
        </div>
      </div>
    </Fold>
  );
}

/** Redraws one document of the base: written as the next version of its part. */
export function BaseEditor(props: FormProps & { now: BaseNow }) {
  const part = text(props.drafts, "base.part", "seed") as BaseDocument;
  const standing = props.now.parts.find((p) => p.part === part)?.text ?? "";
  const shown = text(props.drafts, `base.text.${part}`, standing);
  return (
    <Fold summary="Redraw the base">
      <div class="lre-stack" data-edit="base">
        <label class="lre-field">
          <span class="label">Document</span>
          <select class="lre-input" value={part} onChange={(e) => props.onDraft("base.part", typed(e))}>
            {BASE_DOCUMENTS.map((p) => (
              <option key={p} value={p}>
                {BASE_WORDS[p]}
              </option>
            ))}
          </select>
        </label>
        <label class="lre-field">
          <span class="label">Its text</span>
          <textarea class="lre-input rpe-editor" value={shown} spellcheck={false} onInput={(e) => props.onDraft(`base.text.${part}`, typed(e))} />
        </label>
        <div class="lre-inline rpe-wrap">
          <Button busy={props.busy} disabled={shown === standing} onClick={() => props.onEdit({ what: "base", body: { [part]: shown } })}>
            Save as the next version
          </Button>
        </div>
      </div>
    </Fold>
  );
}

const FRESHNESS_WORDS = { current: "current", changed: "changed since the base was drawn", unseen: "not drawn from yet", gone: "gone from Lumiverse", unread: "Lumiverse could not be asked" } as const;

/** One bound source: its title in Lumiverse now, how it stands against the base, which side of the character it defines, and the way to take it away. */
export function SourceLine(props: FormProps & { source: SourceBindingRow }) {
  const { source: s } = props;
  const name = `source.defines.${s.kind}:${s.ref}`;
  const side = text(props.drafts, name, s.defines ?? "");
  return (
    <li class="lre-stack" data-source={`${s.kind}:${s.ref}`} data-state={s.state}>
      <div class="lre-spread rpe-wrap">
        <span class="lre-inline rpe-wrap">
          <span class="rpe-strong">{s.title ?? s.ref}</span>
          <Badge>{SOURCE_WORDS[s.kind]}</Badge>
          <Badge tone={s.state === "current" ? "pos" : "warn"}>{FRESHNESS_WORDS[s.state]}</Badge>
        </span>
        <Button small kind="ghost" busy={props.busy} onClick={() => props.onEdit({ what: "sources", body: { kind: s.kind, ref: s.ref, drop: true } })}>
          Take it away
        </Button>
      </div>
      <span class="rpe-meta">{s.ref}</span>
      <div class="lre-inline rpe-wrap">
        <label class="lre-field">
          <span class="label">The side of it that it defines</span>
          <input class="lre-input" value={side} spellcheck={false} onInput={(e) => props.onDraft(name, typed(e))} />
        </label>
        <Button small busy={props.busy} disabled={side === (s.defines ?? "")} onClick={() => props.onEdit({ what: "sources", body: { kind: s.kind, ref: s.ref, defines: side.trim() === "" ? null : side.trim() } })}>
          Say it
        </Button>
      </div>
    </li>
  );
}

/** Binds a source Lumiverse holds: a card, a persona, a lore entry or a memory entity, by its id. */
export function SourceBinder(props: FormProps) {
  const kind = text(props.drafts, "source.kind", "entry") as SourceBindingKind;
  const ref = text(props.drafts, "source.ref", "");
  const defines = text(props.drafts, "source.defines", "");
  return (
    <Fold summary="Bind a source">
      <div class="lre-stack" data-edit="source">
        <label class="lre-field">
          <span class="label">What it is</span>
          <select class="lre-input" value={kind} onChange={(e) => props.onDraft("source.kind", typed(e))}>
            {SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {SOURCE_WORDS[k]}
              </option>
            ))}
          </select>
        </label>
        <label class="lre-field">
          <span class="label">Its id in Lumiverse</span>
          <input class="lre-input" value={ref} spellcheck={false} onInput={(e) => props.onDraft("source.ref", typed(e))} />
        </label>
        <label class="lre-field">
          <span class="label">The side of the character it defines (optional)</span>
          <input class="lre-input" value={defines} spellcheck={false} onInput={(e) => props.onDraft("source.defines", typed(e))} />
        </label>
        <div class="lre-inline rpe-wrap">
          <Button busy={props.busy} disabled={ref.trim() === ""} onClick={() => props.onEdit({ what: "sources", body: { kind, ref: ref.trim(), ...(defines.trim() === "" ? {} : { defines: defines.trim() }) } })}>
            Bind it
          </Button>
        </div>
      </div>
    </Fold>
  );
}

/** Says which of the world's people the character is, by id or name. */
export function PersonEditor(props: FormProps & { member: CastMemberRow }) {
  const shown = text(props.drafts, "person", props.member.person ?? "");
  return (
    <div class="lre-stack" data-edit="person">
      <label class="lre-field">
        <span class="label">The world's person it is, by name or id</span>
        <input class="lre-input" value={shown} spellcheck={false} onInput={(e) => props.onDraft("person", typed(e))} />
      </label>
      <div class="lre-inline rpe-wrap">
        <Button small busy={props.busy} disabled={shown.trim() === "" || shown.trim() === (props.member.person ?? "")} onClick={() => props.onEdit({ what: "person", body: { person: shown.trim() } })}>
          Say who
        </Button>
        {props.member.person === null ? null : (
          <Button small kind="ghost" busy={props.busy} onClick={() => props.onEdit({ what: "person", body: { person: null } })}>
            Take it away
          </Button>
        )}
      </div>
    </div>
  );
}

/** A perception of a turn the character has none of: what it saw, written as his own change. */
export function PerceptionWriter(props: FormProps & { turn: string; message: number | null }) {
  const content = text(props.drafts, `perception.${props.turn}`, "");
  return (
    <div class="lre-stack" data-edit="perception" data-turn={props.turn}>
      <label class="lre-field">
        <span class="label">What it perceived of {props.message === null ? `turn ${props.turn}` : `message ${props.message}`}</span>
        <textarea class="lre-input rpe-editor" value={content} spellcheck={false} onInput={(e) => props.onDraft(`perception.${props.turn}`, typed(e))} />
      </label>
      <div class="lre-inline rpe-wrap">
        <Button small busy={props.busy} disabled={content.trim() === ""} onClick={() => props.onEdit({ what: "perception", body: { turn: props.turn, content: content.trim() } })}>
          Write it
        </Button>
      </div>
    </div>
  );
}

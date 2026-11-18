// The tabletop rules' sheet on Play (RULESET-DESIGN §7): Play → Me → You shows the player's character's, a person's sheet shows theirs
// under their details, and Now's glance the conditions and the state hit points put the character in. Each total says where its
// number comes from on a press, and on a hover; each stored value the player may correct has its ✎, a fix with its own Undo. The view
// is the pack's (`d20.sheet`), the same sheet the agents read with the tool `sheet`.

import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { FieldFixTarget } from "../../../shared/state-view";
import { Avatar, Badge, Disclosure, Empty, IconButton, JsonView, List, ListRow, Meter, Section } from "../../../frontend/components";
import { list, num, obj, optNum, optStr, str } from "../../../frontend/decode";
import { decodeFix, FixEditor } from "../../../frontend/fix-editor";
import { GlanceCard } from "../../../frontend/play/glance";
import type { PanelProps, PersonPartProps } from "../../../frontend/registry";
import type { Sheet, SheetLine, SheetsView, SheetWeapon } from "../core/sheet";

/** The panel the sheets are read from. */
const PANEL = "d20.sheet";

function lineOf(value: unknown): SheetLine | null {
  const o = obj(value);
  return o && typeof o.total === "number" ? { total: o.total, parts: str(o.parts) } : null;
}

function fixIn(value: unknown): { fix?: FieldFixTarget } {
  const fix = decodeFix(value);
  return fix ? { fix } : {};
}

/** A sheet from JSON; null when it isn't one. */
function decodeSheet(value: unknown): Sheet | null {
  const o = obj(value);
  if (!o || typeof o.who !== "string") return null;
  const defence = obj(o.defence);
  const hp = obj(o.hp) ?? {};
  const hpFix = obj(hp.fix);
  const xp = obj(o.experience);
  return {
    who: o.who,
    ...(o.off === true ? { off: true as const } : {}),
    classes: str(o.classes),
    levels: num(o.levels),
    size: str(o.size),
    abilities: list(o.abilities, (a) => ({ ability: str(a.ability), score: num(a.score), mod: str(a.mod), ...fixIn(a.fix) })),
    defence: { ac: lineOf(defence?.ac), touch: lineOf(defence?.touch), flat_footed: lineOf(defence?.flat_footed) },
    initiative: lineOf(o.initiative),
    weapons: list(o.weapons, (w): SheetWeapon => ({
      with: str(w.with),
      attack: lineOf(w.attack),
      damage: str(w.damage),
      threat: num(w.threat, 20),
      multiplier: num(w.multiplier, 1),
      ...(typeof w.range === "number" ? { range: w.range } : {}),
      ...(optStr(w.types) !== undefined ? { types: str(w.types) } : {}),
      ...(optStr(w.rounds) !== undefined ? { rounds: str(w.rounds) } : {}),
      ...(optStr(w.fire) !== undefined ? { fire: str(w.fire) } : {}),
    })),
    saves: list(o.saves, (s) => ({ save: str(s.save), ...(lineOf(s) ?? {}) })),
    skills: list(o.skills, (s) => ({ skill: str(s.skill), ranks: num(s.ranks), ...(s.class_skill === true ? { class_skill: true as const } : {}), ...(lineOf(s) ?? {}) })),
    hp: {
      ...(optNum(hp.now) !== undefined ? { now: num(hp.now) } : {}),
      ...(optNum(hp.most) !== undefined ? { most: num(hp.most) } : {}),
      ...(optNum(hp.temporary) !== undefined ? { temporary: num(hp.temporary) } : {}),
      ...(optNum(hp.nonlethal) !== undefined ? { nonlethal: num(hp.nonlethal) } : {}),
      ...(optStr(hp.state) !== undefined ? { state: str(hp.state) } : {}),
      ...(optStr(hp.wound) !== undefined ? { wound: str(hp.wound) } : {}),
      ...(hpFix ? { fix: { ...(decodeFix(hpFix.now) ? { now: decodeFix(hpFix.now) } : {}), ...(decodeFix(hpFix.temporary) ? { temporary: decodeFix(hpFix.temporary) } : {}), ...(decodeFix(hpFix.nonlethal) ? { nonlethal: decodeFix(hpFix.nonlethal) } : {}) } } : {}),
    },
    ...(xp ? { experience: { level: num(xp.level), xp: num(xp.xp), next: typeof xp.next === "number" ? xp.next : null, ...fixIn(xp.fix) } } : {}),
    conditions: list(o.conditions, (c) => ({ condition: str(c.condition), left: str(c.left), ...(optStr(c.does) !== undefined ? { does: str(c.does) } : {}) })),
    effects: list(o.effects, (e) => ({ effect: str(e.effect), mods: str(e.mods), left: str(e.left) })),
    daily: list(o.daily, (d) => ({ gauge: str(d.gauge), now: num(d.now), most: typeof d.most === "number" ? d.most : null, ...fixIn(d.fix) })),
    traits: list(o.traits, (t) => ({ trait: str(t.trait), ...(optStr(t.kind) !== undefined ? { kind: str(t.kind) } : {}), ...(optStr(t.does) !== undefined ? { does: str(t.does) } : {}) })),
  };
}

/** Play's sheets from JSON; null when they aren't. */
export function decodeSheetsView(value: unknown): SheetsView | null {
  const o = obj(value);
  const you = o ? decodeSheet(o.you) : null;
  if (!o || !you) return null;
  const people = list(o.people, (p) => {
    const sheet = typeof p.id === "string" ? decodeSheet(p) : null;
    return sheet ? { ...sheet, id: str(p.id) } : null;
  });
  return { you, people };
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** The range of the die a weapon threatens a critical on, and what a critical multiplies. */
function criticalWords(w: SheetWeapon): string {
  const range = w.threat >= 20 ? "20" : `${w.threat}–20`;
  return w.multiplier > 1 ? `critical on ${range}, ×${w.multiplier}` : `critical on ${range}`;
}

/** A total with where its number comes from: shown on a press, and on a hover. */
function Total(props: { label: ComponentChildren; line: SheetLine | null; sign?: boolean; sub?: ComponentChildren }) {
  const { line } = props;
  if (!line) return null;
  return (
    <div class="lre-me-stat">
      <div class="lre-me-stat-main">
        <Disclosure
          summary={
            <span class="lre-me-stat-line" title={line.parts}>
              <span class="lre-me-stat-k">
                {props.label}
                {props.sub !== undefined ? <span class="lre-me-stat-sub">{props.sub}</span> : null}
              </span>
              <span class="lre-me-stat-v">{props.sign === true ? signed(line.total) : line.total}</span>
            </span>
          }
        >
          <span class="lre-me-stat-sub">{line.parts === "" ? "Nothing adds to it." : line.parts}</span>
        </Disclosure>
      </div>
    </div>
  );
}

/** A value with its ✎ when it has a fix target: the fix editor in its place while it is open. */
function Fixable(props: { label: string; fix?: FieldFixTarget; children: ComponentChildren }) {
  const [fixing, setFixing] = useState(false);
  if (fixing && props.fix) {
    return (
      <div class="lre-me-stat fixing">
        <FixEditor label={props.label} target={props.fix} onDone={() => setFixing(false)} />
      </div>
    );
  }
  return (
    <div class="lre-me-stat">
      <div class="lre-me-stat-main">{props.children}</div>
      {props.fix ? <IconButton icon="edit" label={`Fix ${props.label}`} onClick={() => setFixing(true)} /> : null}
    </div>
  );
}

/** A plain label and value, as the sheet's other rows. */
function Plain(props: { label: string; value: ComponentChildren }) {
  return (
    <div class="lre-me-stat-line">
      <span class="lre-me-stat-k">{props.label}</span>
      <span class="lre-me-stat-v">{props.value}</span>
    </div>
  );
}

/** A save's word as the page names it. */
function saveLabel(id: string): string {
  return id === "" ? "Save" : `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

/** Hit points: a gauge of what is left (or the wound alone, where the ruleset shows no more), temporary hit points, nonlethal harm, the state they bring. */
function HitPoints(props: { sheet: Sheet }) {
  const { hp } = props.sheet;
  const states = hp.state === undefined || hp.state === "" ? [] : hp.state.split(", ");
  return (
    <Section title="Hit points" aside={states.length > 0 ? <span class="lre-inline">{states.map((s) => <Badge key={s} tone="neg">{s}</Badge>)}</span> : undefined} flush>
      <div class="lre-me-stats">
        {hp.wound !== undefined ? (
          <Fixable label="How hurt">
            <Plain label="How hurt" value={<Badge tone={hp.wound === "badly hurt" ? "warn" : "neutral"}>{hp.wound}</Badge>} />
          </Fixable>
        ) : hp.now !== undefined ? (
          <Fixable label="Hit points" fix={hp.fix?.now}>
            {hp.most !== undefined && hp.most > 0 ? <Meter label="Hit points" value={hp.now} min={Math.min(0, hp.now)} max={hp.most} tone={hp.now / hp.most <= 0.25 ? "neg" : "accent"} showValue /> : <Plain label="Hit points" value={hp.now} />}
          </Fixable>
        ) : null}
        {hp.temporary !== undefined || hp.fix?.temporary ? (
          <Fixable label="Temporary hit points" fix={hp.fix?.temporary}>
            <Plain label="Temporary hit points" value={hp.temporary ?? 0} />
          </Fixable>
        ) : null}
        {hp.nonlethal !== undefined || hp.fix?.nonlethal ? (
          <Fixable label="Nonlethal harm" fix={hp.fix?.nonlethal}>
            <Plain label="Nonlethal harm" value={hp.nonlethal ?? 0} />
          </Fixable>
        ) : null}
      </div>
    </Section>
  );
}

/** One weapon in hand or attack of one's own: its attack with its parts, and under it the damage, the critical, the range and the rounds. */
function Weapon(props: { weapon: SheetWeapon }) {
  const w = props.weapon;
  const sub = [w.damage === "" ? "" : `${w.damage}${w.types !== undefined ? ` ${w.types}` : ""}`, criticalWords(w), w.range !== undefined ? `range ${w.range}` : "", w.rounds ?? "", w.fire !== undefined ? `fires ${w.fire}` : ""].filter((part) => part !== "").join(" · ");
  return w.attack ? (
    <Total label={w.with} line={w.attack} sign sub={sub} />
  ) : (
    <Fixable label={w.with}>
      <Plain label={w.with} value={sub} />
    </Fixable>
  );
}

/** A whole sheet: who, hit points, experience, defence, initiative, attacks, saves, abilities, skills, what one is under, daily gauges, traits. */
function SheetBody(props: { sheet: Sheet }) {
  const s = props.sheet;
  const under = [...s.conditions.map((c) => ({ key: `c:${c.condition}`, title: c.condition, subtitle: [c.left, c.does ?? ""].filter((x) => x !== "").join(" · ") })), ...s.effects.map((e) => ({ key: `e:${e.effect}`, title: e.effect, subtitle: [e.mods, e.left].filter((x) => x !== "").join(" · ") }))];
  return (
    <>
      <HitPoints sheet={s} />
      {s.experience ? (
        <Section title="Experience" flush>
          <div class="lre-me-stats">
            <Fixable label="Experience" fix={s.experience.fix}>
              <Plain label={`Level ${s.experience.level}`} value={s.experience.next === null ? `${s.experience.xp}, the top level` : `${s.experience.xp} / ${s.experience.next}`} />
              {s.experience.next !== null && s.experience.next > 0 ? <Meter label="Toward the next level" value={s.experience.xp} max={s.experience.next} /> : null}
            </Fixable>
          </div>
        </Section>
      ) : null}
      {s.defence.ac || s.initiative ? (
        <Section title="Defence" flush>
          <div class="lre-me-stats">
            <Total label="Defence" line={s.defence.ac} />
            <Total label="Touch" line={s.defence.touch} />
            <Total label="Flat-footed" line={s.defence.flat_footed} />
            <Total label="Initiative" line={s.initiative} sign />
          </div>
        </Section>
      ) : null}
      {s.weapons.length > 0 ? (
        <Section title="Attacks" flush>
          <div class="lre-me-stats">
            {s.weapons.map((w, i) => (
              <Weapon key={`${i}:${w.with}`} weapon={w} />
            ))}
          </div>
        </Section>
      ) : null}
      {s.saves.length > 0 ? (
        <Section title="Saves" flush>
          <div class="lre-me-stats">
            {s.saves.map((save) => (
              <Total key={save.save} label={saveLabel(save.save)} line={save.total !== undefined ? { total: save.total, parts: save.parts ?? "" } : null} sign />
            ))}
          </div>
        </Section>
      ) : null}
      {s.abilities.length > 0 ? (
        <Section title="Abilities" flush>
          <div class="lre-me-stats">
            {s.abilities.map((a) => (
              <Fixable key={a.ability} label={a.ability} fix={a.fix}>
                <Plain label={a.ability} value={`${a.score} (${a.mod})`} />
              </Fixable>
            ))}
          </div>
        </Section>
      ) : null}
      {s.skills.length > 0 ? (
        <Section title="Skills" flush>
          <div class="lre-me-stats">
            {s.skills.map((k) => (
              <Total key={k.skill} label={k.skill} line={k.total !== undefined ? { total: k.total, parts: k.parts ?? "" } : null} sign sub={[k.ranks > 0 ? `${k.ranks} rank${k.ranks === 1 ? "" : "s"}` : "", k.class_skill === true ? "class skill" : ""].filter((x) => x !== "").join(" · ") || undefined} />
            ))}
          </div>
        </Section>
      ) : null}
      {under.length > 0 ? (
        <Section title="Conditions and effects" flush>
          <List>
            {under.map((u) => (
              <ListRow key={u.key} icon="pulse" title={u.title} subtitle={u.subtitle || undefined} />
            ))}
          </List>
        </Section>
      ) : null}
      {s.daily && s.daily.length > 0 ? (
        <Section title="Daily" flush>
          <div class="lre-me-stats">
            {s.daily.map((d) => (
              <Fixable key={d.gauge} label={d.gauge} fix={d.fix}>
                {d.most !== null && d.most > 0 ? <Meter label={d.gauge} value={d.now} max={d.most} showValue /> : <Plain label={d.gauge} value={d.now} />}
              </Fixable>
            ))}
          </div>
        </Section>
      ) : null}
      {s.traits.length > 0 ? (
        <Section title="Traits" flush>
          <List>
            {s.traits.map((t) => (
              <ListRow key={t.trait} icon="star" title={t.trait} subtitle={t.does} value={t.kind} valueTone="muted" />
            ))}
          </List>
        </Section>
      ) : null}
    </>
  );
}

/** Classes and levels, and size, as the sheet's head says them. */
function standing(s: Sheet): string {
  return [s.classes, s.levels > 0 ? `level ${s.levels}` : "", s.size].filter((part) => part !== "").join(" · ");
}

/** Play → Me → You under the rules: the player's character's sheet. */
export function D20YouPanel(props: PanelProps) {
  if (props.view === null || props.view === undefined) return <Empty icon="user">No character sheet yet.</Empty>;
  const view = decodeSheetsView(props.view);
  if (!view) return <JsonView value={props.view} />;
  const you = view.you;
  return (
    <div class="lre-stack lre-me" data-lre-panel={PANEL}>
      <section class="lre-me-hero">
        <Avatar name={you.who} size={48} />
        <div class="lre-me-hero-text">
          <h2 class="lre-me-hero-name">{you.who}</h2>
          {standing(you) !== "" ? <span class="lre-me-hero-sub">{standing(you)}</span> : null}
        </div>
      </section>
      <SheetBody sheet={you} />
    </div>
  );
}

/** A person's sheet under the rules, under their details: for one the player may look at, as the ruleset shows them. */
export function D20PersonPart(props: PersonPartProps) {
  const view = decodeSheetsView(props.state.panels[PANEL]);
  const sheet = view?.people.find((p) => p.id === props.person);
  if (!sheet) return null;
  return (
    <Section title="Their sheet" aside={standing(sheet) !== "" ? <span class="lre-me-stat-sub">{standing(sheet)}</span> : undefined}>
      <div class="lre-stack">
        <SheetBody sheet={sheet} />
      </div>
    </Section>
  );
}

/** Now's glance: what the character is under and the state hit points put it in, when there is any. */
export function D20Glance(props: PanelProps) {
  const view = decodeSheetsView(props.view);
  if (!view) return null;
  const { you } = view;
  const states = you.hp.state === undefined || you.hp.state === "" ? [] : you.hp.state.split(", ");
  const under = [...you.conditions.map((c) => c.condition).filter((c) => !states.includes(c)), ...you.effects.map((e) => e.effect)];
  if (states.length === 0 && under.length === 0) return null;
  return (
    <GlanceCard title="You" panel={PANEL}>
      <ListRow
        icon="pulse"
        title="Conditions"
        badge={
          <span class="lre-me-badges">
            {states.map((s) => (
              <Badge key={s} tone="neg">
                {s}
              </Badge>
            ))}
            {under.map((c) => (
              <Badge key={c} tone="warn">
                {c}
              </Badge>
            ))}
          </span>
        }
      />
    </GlanceCard>
  );
}

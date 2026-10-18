// Cues for the Stance section (DESIGN §6.6): behaviour the author wrote for someone's secrets,
// never the secrets themselves, given to the narrator while the secret is kept. Two sources: the
// current stage's `cue` of the tracks a person owns, and the person's own `cues`, each standing for
// one secret (a lore entry, a track or a story flag). Read live from the world, so an Upgrade
// changes them in a running chat. The lint (`castlife.cues`) checks them where they are written.

import type { EntityId } from "../../../shared/ids";
import { isRecord } from "../../../shared/json";
import { loreIsSecret, lorePhrases } from "../../../shared/lore";
import type { LintIssue } from "../../../shared/protocol";
import type { WorldDoc } from "../../../shared/world";
import { optionalQuery, own } from "../../../engine/pack-kit";
import { trackKeepsSecret } from "../../../engine/player-events";
import type { ReadContext } from "../../../engine/registry";
import { currentStage } from "../../../engine/tracks";
import { loreGateReader, namesAny, visibilityOf } from "../../../engine/visibility";

const SECRET_KINDS = ["lore", "track", "flag"] as const;

interface Cue {
  text: string;
  secret: { kind: (typeof SECRET_KINDS)[number]; id: string };
}

/** A cue as the engine reads it: text and the one secret it stands for; anything else is no cue, so it never shows. */
function readCue(raw: unknown): Cue | null {
  if (!isRecord(raw) || typeof raw.text !== "string" || raw.text.trim() === "") return null;
  const keyed = SECRET_KINDS.filter((kind) => raw[kind] !== undefined);
  const kind = keyed[0];
  const id = kind === undefined ? undefined : raw[kind];
  return keyed.length === 1 && kind !== undefined && typeof id === "string" && id !== "" ? { text: raw.text.trim(), secret: { kind, id } } : null;
}

/**
 * The cues the narrator may play for `who` now, in order: their own, then the current stage's cue of
 * each track they own other than a public agenda, whose cue Stance tells as intent. Each shows only
 * while its secret is kept from the POV, and only where `safe` passes it (no unrevealed secret,
 * nothing hidden named); the same text once.
 */
export function cuesFor(ctx: ReadContext, who: EntityId, safe: (text: string) => boolean): string[] {
  const { registry: reg, world, state } = ctx;
  const pov = world.pov;
  const out: string[] = [];
  const add = (text: string): void => {
    if (safe(text) && !out.includes(text)) out.push(text);
  };
  const gateHolds = loreGateReader(reg, world, state);
  const flag = optionalQuery(ctx, "story.flag");
  const cues = own(world.entities, who)?.cues;
  for (const raw of Array.isArray(cues) ? cues : []) {
    const cue = readCue(raw);
    if (!cue) continue;
    const { kind, id } = cue.secret;
    let kept = false;
    if (kind === "lore") {
      const entry = own(world.lore, id);
      kept = entry !== undefined && loreIsSecret(entry) && !gateHolds(entry);
    } else if (kind === "track") kept = trackKeepsSecret(reg, world, state, pov, id);
    else if (flag) {
      // The flag is the reveal: the cue holds until it is set, read as formulas read a flag.
      const value = flag(ctx, id);
      kept = value === null || value === false || value === 0 || value === "";
    }
    if (kept) add(cue.text);
  }
  for (const id of Object.keys(world.tracks).sort()) {
    const t = own(world.tracks, id);
    if (t?.owner !== who || (t.kind === "agenda" && visibilityOf(t.visibility) === "public")) continue;
    const stage = currentStage(world, state, id);
    const cue = stage === null ? undefined : own(t.stages, stage)?.cue;
    if (typeof cue === "string" && cue.trim() !== "" && trackKeepsSecret(reg, world, state, pov, id)) add(cue.trim());
  }
  return out;
}

// ---------------------------------------------------------------- lint

/** Whether a kind is a person's, following the world's own kinds (pack kinds that extend `person` aside). */
function personKind(world: WorldDoc, kind: string): boolean {
  let id: string | undefined = kind;
  for (let guard = 0; id !== undefined && guard < 32; guard++) {
    if (id === "person") return true;
    id = own(world.kinds, id)?.extends;
  }
  return false;
}

/** A name the player may not know, with how the runtime's check (`namesHidden`) finds it in a text. */
interface HiddenName {
  name: string;
  /** A secret entity or place (by the `visibility` `story.leaky_label` reads), whose whole name that lint reports in any label or cue. */
  secret: boolean;
  /** The entity it names, so a person's own cue may name them. */
  entity?: EntityId;
  said(text: string): boolean;
}

/**
 * Every name the player may not know: entities, places and tracks that aren't public (a place to be
 * discovered included) and secret lore's titles. A person counts by any word of their name, anything
 * else by all its words, as `namesAny` reads them.
 */
function hiddenNames(world: WorldDoc): HiddenName[] {
  const out: HiddenName[] = [];
  const label = (name: string, secret: boolean, entity?: EntityId): void => void out.push({ name, secret, ...(entity !== undefined ? { entity } : {}), said: (text) => namesAny(text, [], [name]) });
  for (const e of Object.values(world.entities)) {
    const v = visibilityOf(e.visibility);
    if (v === "public") continue;
    if (personKind(world, e.kind)) out.push({ name: e.name, secret: e.visibility === "secret", entity: e.id, said: (text) => namesAny(text, [e.name]) });
    else label(e.name, e.visibility === "secret", e.id);
  }
  for (const p of Object.values(world.places)) if (visibilityOf(p.visibility) !== "public") label(p.name, p.visibility === "secret");
  for (const t of Object.values(world.tracks)) {
    if (visibilityOf(t.visibility) === "public") continue;
    label(t.label, false);
    for (const s of Object.values(t.stages)) if (s.label.length >= 6) label(s.label, false);
  }
  for (const l of Object.values(world.lore)) if (loreIsSecret(l)) label(l.title, false);
  return out.filter((h) => h.name.trim() !== "");
}

/**
 * Lint (`castlife.cues`, DESIGN §6.6). An entity's cue with no text, standing for no secret, for
 * several or for one the world doesn't have or that hides nothing never shows. A cue that holds a
 * track's truth or a phrase of secret lore gives the secret away. A cue that names something the
 * player may not know is dropped while they don't, and so is an owned track's stage cue. A stage cue
 * that says a secret's name any other way than whole ("Vex" for Vex Morrow) gives it away, since it
 * can also show in the Quest panel and section; its truths and whole secret names are
 * `story.leaky_label`'s to report.
 */
export function cueIssues(world: WorldDoc): LintIssue[] {
  const issues: LintIssue[] = [];
  const issue = (severity: LintIssue["severity"], path: string, message: string): void => void issues.push({ severity, path, code: "castlife.cues", message });
  const secrets = [...Object.values(world.tracks).flatMap((t) => Object.values(t.stages).flatMap((s) => (s.truth ? [s.truth] : []))), ...Object.values(world.lore).flatMap((l) => (loreIsSecret(l) && typeof l.content === "string" ? lorePhrases(l.content) : []))];
  const hidden = hiddenNames(world);
  for (const e of Object.values(world.entities)) {
    if (e.cues === undefined) continue;
    const at = `entities.${e.id}.cues`;
    if (!Array.isArray(e.cues)) {
      issue("error", at, `${e.name}'s cues should be a list.`);
      continue;
    }
    if (e.cues.length > 0 && !personKind(world, e.kind)) issue("warning", at, `${e.name} isn't a person, so its cues never show: the Stance section tells people.`);
    e.cues.forEach((raw: unknown, i) => {
      const path = `${at}.${i}`;
      const text = isRecord(raw) && typeof raw.text === "string" ? raw.text.trim() : "";
      if (text === "") return issue("error", `${path}.text`, `A cue of ${e.name}'s has no text: say what the narrator sees them do.`);
      const cue = readCue(raw);
      if (!cue) return issue("error", path, `${e.name}'s cue "${text}" needs exactly one secret it stands for: a lore entry, a track or a story flag.`);
      const { kind, id } = cue.secret;
      if (kind === "lore") {
        const entry = own(world.lore, id);
        if (!entry) issue("error", `${path}.lore`, `${e.name}'s cue "${text}" is for lore "${id}", which this world doesn't have.`);
        else if (!loreIsSecret(entry)) issue("warning", `${path}.lore`, `${e.name}'s cue "${text}" is for "${entry.title}", which isn't secret lore, so it never shows.`);
      } else if (kind === "track") {
        const track = own(world.tracks, id);
        if (!track) issue("error", `${path}.track`, `${e.name}'s cue "${text}" is for track "${id}", which this world doesn't have.`);
        else if (visibilityOf(track.visibility) === "public" && !Object.values(track.stages).some((s) => s.truth)) issue("warning", `${path}.track`, `${e.name}'s cue "${text}" is for "${track.label}", a public track with no truth to reveal, so it never shows.`);
      }
      const lower = text.toLowerCase();
      const secret = secrets.find((s) => s.trim() !== "" && lower.includes(s.toLowerCase()));
      // A cue that gives its secret away is the error to fix; what else it names can wait for that.
      const named = secret === undefined ? hidden.find((h) => h.entity !== e.id && h.said(text)) : undefined;
      if (secret !== undefined) issue("error", `${path}.text`, `${e.name}'s cue "${text}" gives away a secret ("${secret}"): a cue says how they act, never what they hide.`);
      else if (named) issue("warning", `${path}.text`, `${e.name}'s cue "${text}" names "${named.name}", which the player may not know; it is left out while they don't.`);
    });
  }
  for (const t of Object.values(world.tracks)) {
    // Only a person's tracks reach Stance; a puzzle a thing owns keeps its cue to the Quest section.
    const owner = t.owner === undefined ? undefined : own(world.entities, t.owner);
    if (!owner || !personKind(world, owner.kind)) continue;
    for (const [stage, s] of Object.entries(t.stages)) {
      if (typeof s.cue !== "string") continue;
      const cue = s.cue;
      const lower = cue.toLowerCase();
      // Names read as the runtime reads them (`namesAny`), so a part of a name counts; a secret's whole
      // name, as `story.leaky_label` reads it (longer than three letters), is that lint's to report.
      const named = hidden.find((h) => h.entity !== owner.id && h.said(cue) && !(h.secret && h.name.length > 3 && lower.includes(h.name.toLowerCase()) && lower !== h.name.toLowerCase()));
      if (!named) continue;
      const path = `tracks.${t.id}.stages.${stage}.cue`;
      if (named.secret) issue("error", path, `The cue of "${t.label}" at "${s.label}" gives away a secret ("${named.name}"): a cue says how someone acts, never who or what is hidden.`);
      else issue("warning", path, `The cue of "${t.label}" at "${s.label}" names "${named.name}", which the player may not know; ${owner.name}'s Stance leaves it out while they don't.`);
    }
  }
  return issues;
}

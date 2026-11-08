// The author's amendment of a beat the user marked wrong on a spot check (DEPTH-PLAN §8.6): a wrong
// beat is a directive. The author reads the beat beside the message it came from and the user's word
// on what is wrong, and answers with the beat as the message really has it, or a drop where the
// message holds no such beat. The bootstrap lands the amended beat at the same source message,
// superseding the old one (a `story.strike` for a drop), and the characters who lived it live the
// corrected beat (`run.ts`). Who did what stays the author's reading; this only reads its answer,
// through the shared `Reading`, so whatever of it isn't kept as written is told to the call's keeper
// (an answer that isn't JSON fails, kept with why), and someone listed as perceiving the beat
// several ways is one entry with every way (`addExposure`).

import type { EntityId, MessageId } from "../../shared/ids";
import type { PromptTexts } from "../../shared/prompts";
import { BOOTSTRAP_TEXT } from "../../shared/bootstrap-prompts";
import { addExposure, BEAT_ACTS, beatId, EXPOSURE_CHANNELS, EXPOSURE_REACHES, type Beat, type Exposure } from "../../shared/story";
import type { WorldDoc } from "../../shared/world";
import type { WorldState } from "../../engine/state";
import { own } from "../../engine/pack-kit";
import { renderPrompt } from "../prompts";
import type { ModelPort } from "../depth/port";
import { bareId, beatLine, DepthAnswerError, personNamed, putText, readAnswer, sameName, type Blobs } from "../depth/common";

export interface AmendInput {
  world: WorldDoc;
  /** The fold the author reads names from. */
  state: Readonly<WorldState>;
  texts: PromptTexts;
  beat: Beat;
  /** The texts the beat cites, by hash. */
  blobs: Readonly<Record<string, string>>;
  /** The message it came from, as the spool holds it. */
  message: { id: MessageId; name: string; isUser: boolean; text: string };
  /** The user's word on what is wrong. */
  note: string;
  cast: readonly { id: EntityId; name: string }[];
  /** The player character in force at the message (D-10). */
  pov: EntityId;
  /** The answer's key: the amended beat's id is made from it, so the same answer lands the same beat. */
  key: string;
}

export interface AmendOut {
  /** The beat as amended, superseding the old one; null when the author dropped it. */
  beat: Beat | null;
  why: string;
  blobs: Blobs;
  reasoning?: string;
}

/** Asks the author to amend `beat` against its message and the user's note. */
export async function amendBeat(model: ModelPort, i: AmendInput): Promise<AmendOut> {
  const { world, state, beat: old } = i;
  const nameOf = (id: EntityId): string => i.cast.find((p) => p.id === id)?.name ?? own(state.entities, id)?.name ?? id;
  const system = `${renderPrompt(BOOTSTRAP_TEXT.amend, i.texts, { world: world.name, pov: nameOf(i.pov) })}\n\n${renderPrompt(BOOTSTRAP_TEXT.amendAnswer, i.texts, {})}`;
  const what = i.blobs[old.what] ?? "";
  const surface = i.blobs[old.surface] ?? "";
  const deed = old.deed !== undefined ? i.blobs[old.deed] : undefined;
  const quotes = old.quotes !== undefined ? i.blobs[old.quotes] : undefined;
  const user = [
    `People (name each by the id given here):\n${i.cast.map((p) => `- ${p.name} (id: ${p.id})${p.id === i.pov ? ": the player character" : ""}`).join("\n") || "- (none)"}`,
    `The beat as the historian recorded it:\n${beatLine(world, state, { beat: old, what, surface, ...(quotes !== undefined ? { quotes } : {}) })}${deed !== undefined ? `\nWhat its actors did, as they did it: ${deed}` : ""}\nWhat there was to sense: ${surface || "(nothing said)"}`,
    `The player's word on what is wrong: ${i.note.trim() || "(none given)"}`,
    `The message it came from, [${i.message.id}] ${i.message.isUser ? `${nameOf(i.pov)} (id: ${i.pov}), the player` : i.message.name}:\n${i.message.text}`,
  ].join("\n\n");
  const reply = await model("author", [{ role: "system", content: system }, { role: "user", content: user }], { json: true });
  const { answer: a, read } = readAnswer("author", reply);
  if (!a) throw new DepthAnswerError("author", reply.text, reply);
  const why = read.text("why", a.why);
  const reasoning = reply.reasoning ? { reasoning: reply.reasoning } : {};
  if (read.flag("drop", a.drop)) return { beat: null, why, blobs: {}, ...reasoning };
  const amended = read.text("what", a.what);
  if (amended === "") throw new Error("the author's amendment said neither what happened nor to drop the beat");
  // A person as the answer names them: an id or a name of the cast, or the player character; anyone else is left out.
  const ids = new Set(i.cast.map((p) => p.id));
  const person = (field: string, v: unknown): EntityId | null => {
    const t = typeof v === "string" ? bareId(v) : "";
    const who = t === "" ? null : ids.has(t) || own(state.entities, t) ? t : /^(you|the player character|player character|the player)$/i.test(t) ? i.pov : (i.cast.find((p) => sameName(t, p.name))?.id ?? personNamed(state, t));
    if (who === null) read.drop(field, v, "it names no one of the story");
    return who;
  };
  const actors = [...new Set(read.list("actors", a.actors).flatMap((x, k) => person(`actors[${k}]`, x) ?? []))];
  const exposure: Exposure[] = [];
  for (const [k, x] of read.list("exposure", a.exposure).entries()) {
    const e = read.record(`exposure[${k}]`, x);
    const who = e ? person(`exposure[${k}].who`, e.who) : null;
    if (!e || !who) continue;
    // Someone listed again is one entry, with every way it reached them.
    addExposure(exposure, { who, channel: read.pick(`exposure[${k}].channel`, e.channel, EXPOSURE_CHANNELS, "sight"), reach: read.pick(`exposure[${k}].reach`, e.reach, EXPOSURE_REACHES, "whole"), ...(who !== i.pov ? { pending: true as const } : {}) });
  }
  // Whoever acts in it perceives their own act, where the answer left them out (whole, by sight), as the historian's beats have it.
  for (const who of actors) if (!exposure.some((e) => e.who === who)) exposure.push({ who, channel: "sight", reach: "whole", ...(who !== i.pov ? { pending: true as const } : {}) });
  const blobs: Blobs = {};
  const words = read.words("quotes", a.quotes);
  const sensed = read.text("surface", a.surface) || words || surface;
  // What its actors did as they did it, which each lives as its own act; never the old beat's, which the amendment may have changed.
  const did = read.text("deed", a.deed);
  if (did !== "" && actors.length === 0) read.drop("deed", a.deed, "no one acts in it");
  const beat: Beat = {
    id: beatId("bootstrap", "amend", old.id, i.key),
    at: old.at,
    ...(old.approx ? { approx: true as const } : {}),
    order: old.order,
    ...(old.scene !== undefined ? { scene: old.scene } : {}),
    place: old.place,
    actors,
    act: read.pick("act", a.act, BEAT_ACTS, old.act),
    about: old.about,
    what: putText(blobs, amended),
    ...(did !== "" && actors.length > 0 ? { deed: putText(blobs, did) } : {}),
    surface: putText(blobs, sensed),
    ...(words !== "" ? { quotes: putText(blobs, words) } : {}),
    ...(old.addressed ? { addressed: old.addressed } : {}),
    exposure,
    by: old.by,
    supersedes: [old.id],
  };
  return { beat, why, blobs, ...reasoning };
}

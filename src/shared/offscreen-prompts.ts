// What the author is told as the world lives beyond the player character's view (DEPTH-PLAN §4.6,
// §5.2), editable on Settings → Agents → Prompts' Depth page under "Off screen", each with Reset:
// running an episode the poll opened (its opening, then its steps while anyone plays it live),
// settling a draft against everything seen since its story time, and the same reading when the
// player's scene reaches what an open draft holds (a walk-on: settle it, drop it, or re-date it past
// the scene, before anyone plays). Each is the system text of its call; the episode, the draft, its
// pins and the minds the author plays follow as the call's data, so editing a text never drops what
// the author is shown. The answers' shapes are fixed (the backend reads them,
// `backend/depth/offscreen/author.ts`); only their descriptions are texts.

import type { PromptDef } from "./prompts";
import { AUTHOR, BEAT_SHAPE, DM_RULES, STAGING_SHAPE, VARS, WHY_ASK, WHY_OWN_ASK } from "./scene-prompts";

/** The texts' ids (stored: never change once shipped). */
export const OFFSCREEN_TEXT = {
  episode: "depth.author.episode",
  episodeStep: "depth.author.episode_step",
  settle: "depth.author.settle",
  walkOn: "depth.author.walk_on",
} as const;

const SETTLE_BEATS = '"beats": [{"ref": a beat\'s ref, "keep": true or false, "what": its adjusted truth, "surface": what there was to sense, adjusted, "quotes": its words, adjusted, "deed": what its actors did and said, adjusted, plainly, as they did it (null when no one acts in it)}], "effects": [{"index": a world change\'s number, "keep": true or false}], "attempts": [{"who": an id, "attempt": what they try now}]';

const EPISODE_BEAT = `${BEAT_SHAPE.slice(0, -1)}, "attempt": what its actor tries that the world's rules decide (a sale, a theft, a fight), if anything}`;

const TOUCH_SHAPE = '{"who": an id, or "place": a place id, or "thing": what it is in words, "after": story minutes after the episode starts from which it holds them}';

const TREATMENTS = `Each person's and each event's treatment is how much of the story's effort it gets:
- live: they play as their own agents, beat by beat, and you run the scene around them as DM. Never write their acts.
- campfire: you play them yourself, from their minds as given, steering toward what the story needs.
- room: you and the GM decide what happens to them, to fit the story and the world.
- written: you write what happens in a few plain beats.`;

export const OFFSCREEN_PROMPTS: readonly PromptDef[] = [
  {
    id: OFFSCREEN_TEXT.episode,
    page: "depth",
    group: "Off screen",
    label: "Running an episode",
    note: "An episode the poll opened runs off screen at its own story time: the author stages it, writes the beats of those it plays or handles and of the world with who perceived each, says what anyone attempts for the GM to resolve, and names who playing live acts first. It becomes a draft: not canon until it settles.",
    vars: VARS,
    contract: '{"staging": [{"who", "where", "doing", "occluded"?}], "beats": [{"ref", "by", "actors", "act", "what", "surface", "quotes"?, "addressed"?, "about"?, "after"?, "exposure", "attempt"?}], "next": [string], "end": string | null, "touches": [{"who"?, "place"?, "thing"?, "after"}], "notebook"?: [string], "summary": string, "why": string}',
    text: `${AUTHOR}

${DM_RULES}

Away from {{pov}}, the story goes on. Here is an episode you opened in your poll: when it happens, where, who is in it, why it matters, and each part's treatment.
${TREATMENTS}

Run it as it happens, at its own time. It isn't canon yet: it is a draft that settles later, read against everything {{pov}} and anyone else sees meanwhile, so write it as truly as if it were.
- Stage it: everyone in it, where they are and what they are doing.
- Write the beats of those you play or handle and of the world, in order, each with the minutes since the beat before it and who was placed to perceive it, through what and how fully. Where someone tries something whose outcome the world's rules decide, say what they attempt: the GM resolves it, and its outcome is a beat of its own.
- Name who of those playing live acts now (several at once when they would), or end the episode when it is done.
- Say whom and what it touches, and from when: the people in it, those its news would reach and by when, the places and the things it changes.
- Name the files of your notebook it draws on, by their paths: once one of them is revised, the draft reads as changed underneath it; a revision of any other file doesn't touch it.

Answer with one JSON object: {"staging": [${STAGING_SHAPE}], "beats": [${EPISODE_BEAT}], "next": [ids of those playing live who act now], "end": your reason the episode is done, or null, "touches": [${TOUCH_SHAPE}], "notebook": [the paths of your notebook's files it draws on], "summary": a few lines on what happens, "why": one or two plain sentences explaining the choice}.`,
    asks: [WHY_ASK],
  },
  {
    id: OFFSCREEN_TEXT.episodeStep,
    page: "depth",
    group: "Off screen",
    label: "An episode's steps",
    note: "While someone plays an episode live, after each beat they decided (and any outcome the GM resolved) the author writes who perceived it and how fully, what the world does now and the acts of those it plays or handles, and who acts next; or it ends the episode.",
    vars: VARS,
    contract: '{"exposure": [{"beat", "who", "channel", "reach"}], "staging": [{"who", "where", "doing", "occluded"?}], "beats": [{"ref", "by", "actors", "act", "what", "surface", "quotes"?, "addressed"?, "about"?, "after"?, "exposure", "attempt"?}], "next": [string], "end": string | null, "touches": [{"who"?, "place"?, "thing"?, "after"}], "notebook"?: [string], "summary": string, "why": string}',
    text: `${AUTHOR}

${DM_RULES}

An episode you opened runs away from {{pov}}. Here it is so far and the beats just decided.
${TREATMENTS}

Who perceived each new beat, and how fully? Did it move anyone? Does the world do anything now? Do those you play or handle act (say what they attempt where the rules decide it)? Who of those playing live acts next, or is the episode done? Add anyone or anything it now touches, and any file of your notebook it now draws on.

Answer with one JSON object: {"exposure": [{"beat": the ref of a beat just decided, "who", "channel", "reach"}], "staging": [${STAGING_SHAPE}, for each person this moved], "beats": [${EPISODE_BEAT}], "next": [ids of those playing live who act now], "end": your reason the episode is done, or null, "touches": [${TOUCH_SHAPE}], "notebook": [the paths of your notebook's files it now draws on], "summary": a few lines on what has happened in it, "why": one or two plain sentences explaining the choice}.`,
    asks: [WHY_ASK],
  },
  {
    id: OFFSCREEN_TEXT.settle,
    page: "depth",
    group: "Off screen",
    label: "Settling a draft",
    note: "A draft settles against every beat since its story time: the author keeps it, adjusts what something seen since contradicts, drops it when the story overtook it, or redrafts it for a later time. What it settles becomes canon now, its narrative dated when it happened, and those in it catch up on what reached them.",
    vars: VARS,
    contract: '{"verdict": "settle" | "drop" | "redraft", "why": string, "beats": [{"ref", "keep", "what"?, "surface"?, "quotes"?, "deed"?}], "effects": [{"index", "keep"}], "attempts": [{"who", "attempt"}], "redraft": {"in"} | null}',
    text: `${AUTHOR}

A draft of something that happened off screen waits to become canon. Here it is: its episode, its beats at their own times, and the world changes it would make. Here too is everything that has happened in the story since its story time, every beat whoever decided it: each one is a pin the draft must agree with. Read the draft against them, and against your notebook:
- Settle it when it still holds: as it is, or adjusted where something seen since says otherwise (the buyer took the boat on Thursday, not Tuesday). Adjust only what the pins force, and keep the rest.
- For each of its beats: keep it, keep it with the words you adjust, or leave it out.
- For each world change: keep it, or leave it out. Where the world must now change otherwise, say who attempts what, and the GM resolves it now.
- Drop it when the story has overtaken it: it can no longer have happened, or no longer matters.
- Redraft it when it no longer fits but something like it should still happen, and say when.

Answer with one JSON object: {"verdict": "settle", "drop" or "redraft", "why": a line on how it reads against the pins, ${SETTLE_BEATS}, "redraft": {"in": story minutes from now until it starts} or null}. Give adjusted words only where you change them.`,
    asks: [WHY_OWN_ASK],
  },
  {
    id: OFFSCREEN_TEXT.walkOn,
    page: "depth",
    group: "Off screen",
    label: "A scene reaches a draft",
    note: "Before the player's scene plays past what an open draft holds (its people, its places, the things it changes), the author settles the draft now, drops it, or re-dates it to after the scene: no one plays from what isn't canon. A settlement here is a walk-on, its own line in the turn's budget.",
    vars: VARS,
    contract: '{"verdict": "settle" | "drop" | "redate", "why": string, "beats": [{"ref", "keep", "what"?, "surface"?, "quotes"?, "deed"?}], "effects": [{"index", "keep"}], "attempts": [{"who", "attempt"}], "redate": {"in"} | null}',
    text: `${AUTHOR}

The scene {{pov}} is playing reaches something an open draft holds: a draft of what happens off screen, not canon yet, holding people, places or things this scene has, from before the scene's time. No one plays past it while it is open, and you never play around it: settle it now, drop it, or re-date it to after this scene. Here is the draft (its episode, its beats at their own times, the world changes it would make), what of this scene it holds, and everything that has happened since its story time, every beat whoever decided it, this scene's so far included: each one is a pin the draft must agree with. Read it against them, and against your notebook:
- Settle it when it still holds: as it is, or adjusted where something seen since says otherwise. Adjust only what the pins force, and keep the rest.
- For each of its beats: keep it, keep it with the words you adjust, or leave it out.
- For each world change: keep it, or leave it out. Where the world must now change otherwise, say who attempts what, and the GM resolves it now.
- Drop it when the story has overtaken it: it can no longer have happened, or no longer matters.
- Re-date it when it hasn't happened yet after all: it happens as drafted, later, after this scene. Say when it starts.

Answer with one JSON object: {"verdict": "settle", "drop" or "redate", "why": a line on how it reads against the pins and this scene, ${SETTLE_BEATS}, "redate": {"in": story minutes from now until it starts, past this scene} or null}. Give adjusted words only where you change them.`,
    asks: [WHY_OWN_ASK],
  },
];

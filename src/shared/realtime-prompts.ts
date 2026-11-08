// Real-time dialogue's texts (DEPTH-PLAN §2.5, §4.2, §5.2, §6.6), on Settings → Agents → Prompts'
// Depth page under "Real-time dialogue", each with Reset: the author's watch, which reads each line
// beside the character it is spoken to, and its answer's shape; the author's call on who perceived an
// answer that is more than words said back to the player character, and its shape; the chips that say
// whom the player is talking with (Leave) and offer real time (Talk); and the thinking block's lines
// for entering, leaving, a line the author takes into a scene, who perceived an answer, and each
// line's latency. The answers' shapes are fixed (the backend reads them,
// `backend/depth/scene/realtime.ts`); only their descriptions are texts.

import { ACCOUNT_ASK, DEPTH_PROMPT_PAGE } from "./depth-prompts";
import type { PromptDef } from "./prompts";

/** The texts' ids (stored: never change once shipped). */
export const REALTIME_TEXT = {
  watch: "depth.realtime.watch",
  watchAnswer: "depth.realtime.watch.answer",
  exposure: "depth.realtime.exposure",
  exposureAnswer: "depth.realtime.exposure.answer",
  chipOn: "depth.realtime.chip.on",
  chipOnDetail: "depth.realtime.chip.on.detail",
  chipLeave: "depth.realtime.chip.leave",
  chipOffer: "depth.realtime.chip.offer",
  chipOfferDetail: "depth.realtime.chip.offer.detail",
  chipTalk: "depth.realtime.chip.talk",
  lineEntered: "depth.realtime.line.entered",
  lineEnded: "depth.realtime.line.ended",
  lineTaken: "depth.realtime.line.taken",
  lineHears: "depth.realtime.line.hears",
  lineExposure: "depth.realtime.line.exposure",
  lineLatency: "depth.realtime.line.latency",
  lineLatencyGm: "depth.realtime.line.latency.gm",
} as const;

const page = DEPTH_PROMPT_PAGE.id;
const group = "Real-time dialogue";
const NAME = { name: "name", text: "The name of the character the player talks with.", required: true as const };
const WHY = { name: "why", text: "The author's reason, in its words." };
const SECONDS = (name: string, text: string) => ({ name, text, required: true as const });

export const REALTIME_WATCH =
  "You are the author of this story, running it like a game master while the player talks with {{name}} in real time. His message goes straight to {{name}}, who is answering it from their own mind right now. You read it beside them, never in front of them: you don't see their answer, and nothing you decide changes what they heard.\n" +
  "Decide, briefly:\n" +
  "1. Can {{name}} simply hear this message and answer it? Not when it holds more than words said aloud and small visible acts that need no outcome: an attempt the rules or the world must resolve, the player character's inner thoughts or feelings, an out-of-character note, a move elsewhere, time passing, or anything else that needs you as the game master. Then take the line, and say why: the turn becomes a full scene you set, and {{name}}'s answer is dropped unrecorded, so nothing they read reaches their mind.\n" +
  "2. When you don't take it, write the player's line as the beat it is, from his message: what he says and does in plain words, and his exact spoken words. Say who else, if anyone, is placed to perceive this exchange from where everyone is, and how fully. Should {{name}}'s answer be more than words said back to him, you write who perceived it once they have answered.\n" +
  "3. Does the world do anything now, between this line and the next (the phone rings, someone knocks)? Only what the story and the world call for; most lines, nothing. Say who is placed to perceive what you add, {{name}} and the player character included where they are; the narration renders what reaches him.\n" +
  "4. Has the conversation ended, or does the world intrude enough to need a scene? Then end real-time dialogue after this line.\n" +
  "5. Should your poll of the wider world run after this line as after any turn, or wait for the conversation's end?\n" +
  "Your notebook leads: what the player wants, and where the story points. Defer to the player wherever he was explicit.";

export const REALTIME_WATCH_ANSWER =
  'Answer with one JSON object and nothing else:\n{"takeover": null, or why this line needs you as the game master, in a sentence,\n "line": {"what": "what he says and does, in plain words", "said": "his exact words said aloud, or null", "did": "what he visibly does, or null"},\n "others": [{"who": "the id of someone besides the two of them placed to perceive this exchange", "channel": "hearing", "sight" or "touch", "reach": "whole" or "partial"}],\n "world": [{"what": "what happens, in plain words", "surface": "what there is to sense of it, as anyone there could sense it, from no one\'s side", "said": "exact words someone says aloud in it, or null", "by": ["the ids of anyone who acts in it"], "deed": "what they did and said, plainly, as they did it, never as anyone saw or heard it: each lives it as their own act; null when no one acts in it", "perceived": [{"who": "an id", "channel": "hearing", "sight" or "touch", "reach": "whole" or "partial"}]}],\n "end": null, or why real-time dialogue ends after this line,\n "poll": "now" or "later",\n "why": "one or two plain sentences explaining your reading"}\nWith a takeover, the rest may be null.';

export const REALTIME_EXPOSURE =
  "You are the author of this story, running it like a game master while the player talks with {{name}} in real time. {{name}} has just answered his line from their own mind, and their answer is more than words said back to him: something they did, words meant for someone else, or something they tried to bring about, which the GM has resolved. As for every beat, you write who was placed to perceive it, through what, and how fully, grounded in where everyone is:\n" +
  "1. Who perceived {{name}}'s answer, besides {{name}}: by sight, hearing or touch, whole or only in part (a glance from across the room, a hand half hidden by the desk). The player character too, only where he could: an act meant to go unseen reaches only those placed to catch it, and what doesn't reach him, the narration never shows him.\n" +
  "2. Where they tried to bring something about, who perceived how it turned out, {{name}} included where they did (they may not see all of it), in the same way.\n" +
  "What happened is decided already: decide only who perceived it.";

export const REALTIME_EXPOSURE_ANSWER =
  'Answer with one JSON object and nothing else:\n{"answer": [{"who": "the id of someone who perceived the answer, the player character included where he did", "channel": "hearing", "sight" or "touch", "reach": "whole" or "partial"}],\n "outcome": [{"who": "the id of someone who perceived how the attempt turned out", "channel": "hearing", "sight" or "touch", "reach": "whole" or "partial"}], or [] when nothing was attempted,\n "why": "one or two plain sentences explaining your reading"}\nAn empty "answer": no one perceived it but the one who did it.';

export const REALTIME_PROMPTS: readonly PromptDef[] = [
  { id: REALTIME_TEXT.watch, page, group, label: "The author's watch", note: "Read beside each line the player speaks in real time, while the character answers it: whether the character can simply hear and answer it or the author takes it into a full scene, the player's line as a beat, who else perceives the exchange, whether the world does anything, whether the conversation ends, and whether the poll waits for its end.", text: REALTIME_WATCH, vars: [NAME] },
  { id: REALTIME_TEXT.watchAnswer, page, group, label: "The watch's answer", note: "The answer's shape, which the backend reads: a takeover or the player's line, who else perceives the exchange, the world's beats, the end, and the poll.", text: REALTIME_WATCH_ANSWER, vars: [], asks: [ACCOUNT_ASK] },
  { id: REALTIME_TEXT.exposure, page, group, label: "Who perceived an answer", note: "Asked once the character has answered, when the answer is more than words said back to the player character (something they did, words meant for someone else, an attempt the GM resolved): who perceived it, and how the attempt turned out, as for every beat.", text: REALTIME_EXPOSURE, vars: [NAME] },
  { id: REALTIME_TEXT.exposureAnswer, page, group, label: "Who perceived an answer: the answer", note: "The answer's shape, which the backend reads: who perceived the answer and its outcome, by what and how fully.", text: REALTIME_EXPOSURE_ANSWER, vars: [], asks: [ACCOUNT_ASK] },
  { id: REALTIME_TEXT.chipOn, page, group, label: "Chip: talking with someone", note: "The chip under the last reply while real-time dialogue runs.", text: "Talking with {{name}}", vars: [NAME] },
  { id: REALTIME_TEXT.chipOnDetail, page, group, label: "Chip: what real time does", note: "The line under the chip while real-time dialogue runs.", text: "Your lines go straight to {{name}}, who answers from their own mind. The author reads each line beside them and takes it into a full scene when it needs one.", vars: [NAME] },
  { id: REALTIME_TEXT.chipLeave, page, group, label: "Chip: Leave", note: "The button that ends real-time dialogue; your next line plays as a scene.", text: "Leave", vars: [] },
  { id: REALTIME_TEXT.chipOffer, page, group, label: "Chip: the offer", note: "The chip under the last reply when the author judged the moment a conversation and Settings → Depth starts real time only from the chip.", text: "Talk with {{name}} in real time?", vars: [NAME] },
  { id: REALTIME_TEXT.chipOfferDetail, page, group, label: "Chip: why it is offered", note: "The line under the offer: the author's reason.", text: "{{why}}", vars: [WHY] },
  { id: REALTIME_TEXT.chipTalk, page, group, label: "Chip: Talk", note: "The button that starts real-time dialogue from your next line.", text: "Talk", vars: [] },
  { id: REALTIME_TEXT.lineEntered, page, group, label: "Thinking block: real time starts", note: "The thinking block's line when real-time dialogue starts.", text: "Real-time dialogue with {{name}}: your lines go straight to them. {{why}}", vars: [NAME, WHY] },
  { id: REALTIME_TEXT.lineEnded, page, group, label: "Thinking block: real time ends", note: "The thinking block's line when real-time dialogue ends.", text: "Real-time dialogue with {{name}} ends. {{why}}", vars: [NAME, WHY] },
  { id: REALTIME_TEXT.lineTaken, page, group, label: "Thinking block: a line taken into a scene", note: "The thinking block's line when the author takes a line into a full scene; the character's answer is dropped unrecorded.", text: "The author takes this line into a scene; {{name}}'s answer is dropped, and nothing of it reaches their mind. {{why}}", vars: [NAME, WHY] },
  { id: REALTIME_TEXT.lineHears, page, group, label: "Thinking block: the line goes through", note: "The progress line while the character answers and the author watches.", text: "{{name}} hears your line; the author watches beside them.", vars: [NAME] },
  { id: REALTIME_TEXT.lineExposure, page, group, label: "Thinking block: who perceived an answer", note: "The line before a line's latency when the author wrote who perceived the character's answer.", text: "The author wrote who perceived {{name}}'s answer in {{exposure}}.", vars: [NAME, SECONDS("exposure", "The author's call on who perceived the answer, in seconds.")] },
  {
    id: REALTIME_TEXT.lineLatency,
    page,
    group,
    label: "Thinking block: the line's latency",
    note: "The line each real-time exchange ends with: how long it took, call by call, on the models Settings → Depth gives real time.",
    text: "{{name}} answered in {{play}} beside the author's watch ({{watch}}); the narrator rendered the exchange in {{render}} and the GM checked it in {{check}}. The line took {{total}}.",
    vars: [NAME, SECONDS("play", "The character's answer, in seconds."), SECONDS("watch", "The author's watch, in seconds."), SECONDS("render", "The narrator's render, redrafts included, in seconds."), SECONDS("check", "The GM's check of the passage, in seconds."), SECONDS("total", "The whole line, in seconds.")],
  },
  {
    id: REALTIME_TEXT.lineLatencyGm,
    page,
    group,
    label: "Thinking block: the line's latency, with an attempt",
    note: "As the line's latency, when the character's answer held an attempt the GM resolved.",
    text: "{{name}} answered in {{play}} beside the author's watch ({{watch}}); the GM resolved the attempt in {{gm}}, the narrator rendered the exchange in {{render}} and the GM checked it in {{check}}. The line took {{total}}.",
    vars: [NAME, SECONDS("play", "The character's answer, in seconds."), SECONDS("watch", "The author's watch, in seconds."), SECONDS("gm", "The GM's resolution, in seconds."), SECONDS("render", "The narrator's render, redrafts included, in seconds."), SECONDS("check", "The GM's check of the passage, in seconds."), SECONDS("total", "The whole line, in seconds.")],
  },
];

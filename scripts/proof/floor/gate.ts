// The floor test (STANDALONE-PLAN §17.1; PlanGates-4), as a gate the proof runner plays
// (PlanScenarios-1, `scripts/proof/run.ts`): live at wave 1's checkpoint and again last, in the formal
// round, on the final build; its rig form at the wave's checkpoint in the rig. Both forms play the same
// ten pairs through Lumiverse's chat page and read the same records (`play.ts`); the table is
// `scripts/testbed/floor-measure.ts`. A row the plan reports rather than gates is judged met once it is
// reported with its figures; a row that cannot be judged on this run is left unjudged, and the floor's own
// table, kept beside the screens, says why.

import { gate } from "../route/form";
import { CHAT_PAGE, FILES_PAGE, playFloor, seeReplies, seeStack } from "./play";

export default gate({
  id: "floor",
  waves: [1, 5],
  parts: [
    { id: "first-words", words: "First words on screen: from the request to the reply's first word, less the time the model spent writing its intent record: median within 3 s of plain generation's time from request to first word, on the same model at the same thinking effort. Thinking time is reported for both, and the intent record's own time beside them", mark: "code", measured: "per turn on the chat page, from Send to the reply's first word (tag form) or to its message shown whole (two-step form), less timings.intent; the median of ten RPE turns against plain's to its first word (tag) or last word (two-step)" },
    { id: "per-token", words: "Time per output token: median within 15% of plain", mark: "code", measured: "tag form: first word to last word on the page over Lumiverse's token count less one; two-step form: the reply call's streamed pieces over its output tokens, reported, not gated" },
    { id: "calls", words: "Model calls on the reply's path: exactly 1 in at least 9 of 10", mark: "as shipped", wants: { hits: 9, of: 10 }, measured: "each RPE turn: calls begun by any agent before the reply's first piece left RPE (tag form) or before its release (two-step form, exactly 2)" },
    { id: "sent", words: "What the model was sent: the Author's first request, as recorded at the model layer, contains every message Lumiverse sent that the window kept, in the same order with the same roles, right after the opening block", mark: "code", measured: "every RPE turn: the lead's first kept request against the prompt Lumiverse stored with the reply" },
    { id: "lore", words: "Activated lore: every activated entry appears in the lore map", mark: "code", measured: "every RPE turn: Lumiverse's activated entries against the lore map, through the lore route's ids" },
    { id: "tools", words: "The Author's tools: under 8,000 tokens", mark: "code", measured: "the largest call_started.toolTokens over every call of the Author in the run" },
    { id: "stack", words: "The Author's guidance stack: reported at every wave, against a target of about 6,000 tokens", mark: "code", measured: "call_started.openingTokens of the Author's first call in each turn" },
    { id: "after-reply", words: "The run after the reply: its time is reported on its own, with how long a next message would have waited", mark: "code", measured: "timings.released to timings.ended of each RPE turn, median and longest" },
    { id: "replies-shown", words: "Same chat, same preset, same model, under the shipped guidance, where the Author writes. Plain generation against a simple turn: ten pairs, interleaved, each turn sent after the previous one has finished", mark: "code", on: [{ page: CHAT_PAGE, check: seeReplies }] },
    { id: "stack-shown", words: "The Author's guidance stack: reported at every wave", mark: "code", on: [{ page: FILES_PAGE, check: seeStack }] },
  ],
  fixtures: [],
  bed: [
    "two connections in Lumiverse on the same model: plain generation calling the model directly, and RPE's",
    "the floor fixture made by `bun scripts/testbed/floor.ts setup`: its invented card, persona, preset and book",
    "plain generation's reasoning set to the effort the shipped Author definition names (`floor.ts setup` sets it)",
    "RPE's connection in its shipped form: not named in reply.streamAnyway",
    "the lead driving one run at a time",
  ],
  rig: playFloor,
  live: playFloor,
});

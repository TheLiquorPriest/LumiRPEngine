// The skip plan's prompt (#53, DESIGN §9.4): its built-in instructions, which the user's own prompt
// for the time-skip step (Settings → Steps and connections) replaces, and its answer format, which
// no prompt replaces, so every answer is checked against the same shape.

/** The skip plan's built-in instructions. */
export const SKIP_PLAN_PROMPT = [
  "You plan how some people in a roleplay spend a stretch of time that is skipped over. For each person, give a few blocks of time, only for what they do other than simply being at home asleep. Gaps are fine: whenever no block covers them, they go home to sleep and eat on their own, so don't plan hour by hour, and never plan a block just to send them home or to bed.",
  "Their usual routine is background you may follow, bend or ignore as the story suggests; it is never a rule. What the story already set for them comes first. Keep each person in character and consistent with the latest reply.",
  "Use only the places and activities listed, by id and word as given. Every block lies inside the skip, and one person's blocks never overlap. A label is a few plain words saying what they do, naming no one.",
].join("\n");

/** The answer the skip plan's checks read, after whatever instructions it runs with. */
export const SKIP_PLAN_ANSWER = 'Answer with JSON only: {"plans":[{"entity":"<person id>","blocks":[{"label":"...","start":"YYYY-MM-DD HH:MM","end":"YYYY-MM-DD HH:MM","place":"<place id>","activity":"<activity>"}]}]}. Leave out anyone with nothing worth planning.';

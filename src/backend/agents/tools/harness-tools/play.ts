// An action played for real on the harness engine: `action_play` stands in for the classic turn's
// plan step playing the action the player's message named (`engine/turn.ts`), and for an action done
// at once outside a turn (`offstage`, `backend/dispatch.ts`).
//
// It reads the attempt as `checks_stakes` reads it (`askedOf`, `attemptOf`: the same policy, the
// same judgement) and then rolls it, once (`playAttempt`). The read shows no roll, so the first an
// agent learns of the dice is a roll the turn already holds. What the engine applied (the
// participants' detail, the attempt as the retry rule keeps it, the roll, the outcome's effects, the
// activity, and what the world's rules do on hearing of them) is staged as one change of the type
// "What the author plays" (`play`): refused where the player set that to Never, on the review card
// under Confirm.
//
// Nothing is played in part: an action the rules refuse any effect of records none of what it does,
// as one done outside a turn records none. Where its dice had fallen by then, the attempt and its
// roll are recorded all the same, alone: the refusal tells which outcome the dice came to, and a
// roll that is known and not recorded could be thrown away, or kept for another attempt. A failed
// attempt tried again before anything changed is the engine's to answer: no new roll, the earlier
// failure's outcome again (`verdictOf`).

import { HARNESS_FAMILY, HARNESS_NOTE } from "../../../../shared/harness-texts";
import { PLAY_NOTE, PLAY_TOOL } from "../../../../shared/harness-texts-play";
import { hashJson } from "../../../../shared/hash";
import { optionalQuery } from "../../../../engine/pack-kit";
import { authorLines } from "../../../../engine/player-events";
import type { Resolution } from "../../../../engine/resolve";
import { runRulesOnEvents } from "../../../../engine/rules";
import { Working } from "../../../../engine/working";
import type { ToolOutcome } from "../../runtime";
import type { HarnessTurn } from "../harness-turn";
import type { ToolReadView } from "../read-view";
import type { ToolEnv } from "../registry";
import { objectSchema } from "../schema";
import { type Attempt, askedOf, attemptOf, attemptProperties, marker, playAttempt, type Played, rollAnswer } from "./checks";
import { type HarnessToolDefinition, stageChange } from "./kit";

const PLAY = PLAY_TOOL.actionPlay;

/**
 * The turn of a call that only the author makes, and only before the reply: the reply tells how
 * what was played went, and the author is the one agent that briefs its writer. Or the answer that
 * says whose call `tool` is.
 */
export function authorTurn(view: ToolReadView, env: ToolEnv, tool: string): HarnessTurn | ToolOutcome {
  const turn = env.turn;
  if (!turn) return view.refuse(HARNESS_NOTE.noTurn);
  return turn.main && turn.reply === null ? turn : view.refuse(PLAY_NOTE.author, { tool });
}

/**
 * An attempt played on `w` as a turn plays its action: resolved through the rules, then heard by the
 * world's rules (the plan step's `runRulesOnEvents`). Or the answer that says it can't be tried
 * after all, which the engine finds before any dice fall. What the rules refused of its outcome
 * (`res.rejected`) is the caller's to answer: by then the roll is made.
 */
export function playOn(view: ToolReadView, w: Working, turn: HarnessTurn, attempt: Attempt): Played | ToolOutcome {
  const played = playAttempt(w, turn, attempt);
  const { res } = played;
  if (!res.ok) return view.refuse(HARNESS_NOTE.rollUnavailable, { why: res.failed?.reason ?? "" });
  if (res.events.length > 0) runRulesOnEvents(w.reg, w, res.events, { seed: played.seed });
  return played;
}

/** What a played attempt's answer says of a retry the chat's rule didn't roll again: what a new roll takes. Nothing for any other attempt. */
export function retryNote(view: ToolReadView, attempt: Attempt, res: Resolution): { retry: string } | Record<string, never> {
  if (res.adjudged?.why !== "retry") return {};
  const name = view.name(attempt.asked.actor);
  return { retry: attempt.policy.retry === "once" ? view.text(PLAY_NOTE.retryOnce, { name }) : view.text(PLAY_NOTE.retryChanged, { name, minutes: String(attempt.policy.retryAfter) }) };
}

export const PLAY_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: PLAY,
    family: HARNESS_FAMILY.checks,
    tier: "write",
    parameters: (world) => objectSchema(attemptProperties(world), ["action"]),
    async run(args, env) {
      const view = await env.reader.view();
      const turn = authorTurn(view, env, PLAY);
      if ("text" in turn) return turn;
      const attempt = view.read(() => {
        const asked = askedOf(view, PLAY, args);
        if (!("request" in asked)) return asked;
        // A fighter's act is the fight's to record: its round spends the act, settles who is down and moves the turn on.
        if (optionalQuery(view.ctx, "combat.engaged")?.(view.ctx, asked.actor) === true) return view.refuse(PLAY_NOTE.inFight, { name: view.name(asked.actor) });
        return attemptOf(view, asked, args);
      });
      if (!("asked" in attempt)) return attempt;
      const w = new Working(view.registry, view.world, view.state);
      const played = view.read(() => playOn(view, w, turn, attempt));
      if (!("res" in played)) return played;
      const { res, seed } = played;
      const why = res.rejected[0]?.rejection.reason;
      // Refused whole where nothing was drawn for it (no dice, and no outcome the story's odds picked): the call learned nothing it could use.
      if (why !== undefined && res.check === null && res.adjudged?.why !== "story") return view.refuse(PLAY_NOTE.rejected, { why });
      const events = why === undefined ? [...w.events] : played.record;
      const lines = authorLines(view.registry, view.world, w.state, events, events.length);
      const tell = view.read(() => marker(view));
      const told = { ...rollAnswer(view, attempt, res, tell), ...retryNote(view, attempt, res), recorded: lines.map(tell) };
      const note = { minutes: String(res.duration) };
      if (events.length === 0) return view.answer({ ...told, note: view.text(PLAY_NOTE.playedNothing, note) });
      const staged = await stageChange(view, turn, { key: hashJson(["lre.harness.play", seed, events]), changeType: "play", events, lines });
      if ("refused" in staged) return staged.refused;
      return view.answer({ ...told, ...(why !== undefined ? { refused: why } : {}), lands: staged.lands, note: why === undefined ? view.text(PLAY_NOTE.played, note) : view.text(PLAY_NOTE.rolledOnly, { ...note, why }) });
    },
  },
];

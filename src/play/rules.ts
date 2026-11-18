// The press on the World page that puts a tabletop rule set on this chat's world (RULESET-DESIGN §5.2): the same work as the agents' `rules_apply`
// (`src/worlds/rules.ts`), asked of a person. It makes the rule set the world's next revision this chat alone is moved to, switches the rules on
// for this chat, and says who has no sheet yet; what it did is answered in the words of `.prompts/play-answers.md`, a refusal with nothing changed.
// The Undo it gives is the Upgrade's (`POST /api/v1/chats/:chat/upgrade/undo`), which takes the revision and the level back together.

import { type Infer, route, shape, type WriteQueue } from "../app";
import { RulesRefused, applyRules, type RulesDeps } from "../worlds/rules";
import type { WorldService } from "../worlds/service";
import { WorldError } from "../worlds/worlds";
import type { Store } from "../store";
import { answerWords, playAnswers } from "./service";

export const RULES_PATH = "/api/v1/chats/:chat/rule-set";

const T = shape.text();
const opt = shape.optional;

const rulesAsk = shape.named(
  "RulesAsk",
  "A rule set to put on a chat's world, by its id, and whether to only say what it would add and keep, with nothing changed.",
  shape.object({ rules: T, preview: opt(shape.yesNo()) }),
);

const rulesAnswer = shape.named(
  "RulesAnswer",
  "What putting a rule set on the chat's world came to: whether the world has a new revision this chat moves to or the chat's rules were switched on, the id the Undo of the Upgrade takes (null where nothing was recorded), and the answer in words, one sentence each.",
  shape.object({ made: shape.yesNo(), undo: shape.nullable(T), words: shape.list(T) }),
);

/** A rule set to put on a chat's world. */
export type RulesPut = Infer<typeof rulesAsk>;
/** What putting it came to. */
export type RulesPutAnswer = Infer<typeof rulesAnswer>;

export interface RulesPutDeps {
  worlds: WorldService;
  store: Store;
  writes: WriteQueue;
  /** The guidance folder whose `.prompts/` holds the words. */
  guidance: string;
}

/** Puts a rule set on a chat's world, for the page. */
export class RulesService {
  constructor(private readonly deps: RulesPutDeps) {}

  async put(user: string, chat: string, ask: RulesPut): Promise<RulesPutAnswer> {
    const part = await playAnswers(this.deps.guidance);
    const say = (line: string, fields: Record<string, unknown> = {}): string => answerWords(part, line, fields);
    const work: RulesDeps = { worlds: this.deps.worlds, s: this.deps.store.user(user), registry: this.deps.store.env.registry, writes: this.deps.writes, user, chat };
    try {
      const made = await applyRules(work, { rules: ask.rules, take: [], preview: ask.preview === true });
      const words: string[] = [];
      if (made.preview) words.push(say("rules_plan", { rules: made.rules.label, added: made.added.length, same: made.same, kept: made.kept.length }));
      else if (made.revision !== null) words.push(say("rules_done", { rules: made.rules.label, added: made.added.length }));
      else words.push(say("rules_already", { rules: made.rules.label }));
      if (made.kept.length > 0) words.push(say("rules_kept", { rules: made.rules.label, labels: made.kept.map((i) => i.label).join(", ") }));
      if (made.level !== null) words.push(say("rules_on"));
      if (!made.preview && made.noSheet.count > 0) words.push(say("rules_no_sheet", { count: made.noSheet.count, one: made.noSheet.count === 1, names: made.noSheet.names.join(", "), more: made.noSheet.count - made.noSheet.names.length }));
      return { made: made.revision !== null || made.level !== null, undo: made.edit, words };
    } catch (error) {
      if (error instanceof RulesRefused) return { made: false, undo: null, words: [say(`rules_${error.code}`, error.fields)] };
      if (error instanceof WorldError) return { made: false, undo: null, words: [say("rules_world_refused", { why: error.message })] };
      throw error;
    }
  }
}

/** The route of the press. */
export function rulesRoutes(rules: RulesService) {
  return [
    route({
      method: "POST",
      path: RULES_PATH,
      access: "page",
      group: "state",
      does: "Puts a ready-made tabletop rule set on the chat's world as the world's next revision, which this chat alone moves to from its next turn, switches the rules on for this chat and says who has no sheet yet; with preview, only says what it would add and keep. What the world has of its own is kept. A refusal is answered in words with nothing changed. The Undo is the Upgrade's.",
      body: rulesAsk,
      reply: rulesAnswer,
      handle: ({ user, params, body }) => rules.put(user, params.chat, body),
    }),
  ] as const;
}

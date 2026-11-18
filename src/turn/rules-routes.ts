// The Rules page's routes (plan §14 the Rules row, §5.4 l.524-558, C-10): every rule of a chat's stack (or, with no chat, of the
// shipped and global levels a new chat takes) with whether it is in force and why not (a rule is switched on the Files routes' own switch,
// `POST /api/v1/rules/:name/switch`, which writes the one list the Files page writes); the facts a trigger can name, RPH's and RPE's, each with its value in the open
// chat where RPE counts it and the rules whose text names it; the rules that fired in a chat, newest first, a job's among them, with
// what the agent did next; and a rule run against a past turn, which writes nothing. Each mirrors RPH's own type. RPH's hooks are
// listed by the switches route until RPH gives a reader of them.

import type { ListedFact, RuleTest } from "rp-harness/contract";
import { type Exactly, type Holds, type Infer, route, RouteError, ruleFiring, shape } from "../app";
import { JoinedTurnError } from "../store";
import { NO_CHAT } from "../tree/layout";
import { ruleView } from "../tree/shapes";
import type { Turns } from "./lane";
import { CARRIED_SESSION } from "./runs";
import { turnSettings } from "./settings";
import { NO_SESSION } from "./turns";

const T = shape.text();
const N = shape.number();
const opt = shape.optional;

const factValue = shape.object({ count: N, names: opt(shape.list(T)), by: opt(shape.record(N)), namesBy: opt(shape.record(shape.list(T))), fields: opt(shape.record(shape.json())) });
const listedFields = { name: T, counts: T, by: opt(shape.list(T)), fields: opt(shape.list(T)), from: shape.oneOf("rph", "host"), clash: opt(shape.literal(true)) };
const listedBase = shape.object(listedFields);
type FactMirrored = Holds<Exactly<Infer<typeof listedBase>, ListedFact>>;
const factShown = shape.named(
  "FactShown",
  "A fact a rule's trigger can name, RPH's or RPE's: what it counts, its groups and fields, its value in the open chat where RPE counts it (null with no chat, or for one of RPH's), and the rules whose text names it.",
  shape.object({ ...listedFields, value: shape.nullable(factValue), rules: shape.list(T) }),
);

const testBase = shape.object({ rule: T, turn: T, fired: shape.yesNo(), firings: shape.list(ruleFiring) });
type TestMirrored = Holds<Exactly<Infer<typeof testBase>, RuleTest>>;
const ruleTest = shape.named("RuleTest", "A rule run against a past turn: whether it would have fired, and each firing with what matched.", testBase);

const firingShown = shape.named(
  "FiringShown",
  "A rule that fired in the chat, as kept: the firing whole, with its id, when, and the turn or the job of his it was told in (run and talk: not kept, so null).",
  shape.object({ firing: ruleFiring, id: T, at: N, turn: shape.nullable(T), run: shape.nullable(T), job: shape.nullable(T), talk: shape.nullable(T) }),
);

/** The checks above hold, and are read by no one. */
export type Mirrors = [FactMirrored, TestMirrored];

export function rulesRoutes(turns: Turns) {
  /** The scope the rules are read in: a chat's, or with none the shipped and global levels a new chat takes. */
  const scopeOf = (user: string, chat: string | undefined) => ({ user, chat: chat ?? NO_CHAT, session: NO_SESSION });
  return [
    route({
      method: "GET",
      path: "/api/v1/rules",
      access: "page",
      group: "rules",
      does: "Every rule of a chat's stack, in force or not and why; with no chat, those of the shipped and global levels, as a new chat takes them.",
      query: { chat: opt(T, "The chat whose stack is read; left out, the shipped and global levels.") },
      reply: shape.named("RulesReply", "The rules of a chat's stack, or of the levels every chat shares.", shape.object({ chat: shape.nullable(T), rules: shape.list(ruleView) })),
      handle: async ({ user, query }) => {
        return { chat: query.chat ?? null, rules: await turns.harness.rules.list(scopeOf(user, query.chat)) };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/rules/facts",
      access: "page",
      group: "rules",
      does: "Every fact a rule's trigger can name, RPH's and RPE's, with its value in the chat where RPE counts it and the rules whose text names it.",
      query: { chat: opt(T, "The chat whose values are read; left out, no value is given.") },
      reply: shape.named("FactsReply", "The facts a trigger can name.", shape.object({ facts: shape.list(factShown) })),
      handle: async ({ user, query }) => {
        const scope = scopeOf(user, query.chat);
        const [listed, rules] = await Promise.all([turns.harness.rules.facts(scope), turns.harness.rules.list(scope)]);
        // Each rule's own text, as its file holds it: a fact is the rule's where the text names it.
        const texts = await Promise.all(rules.map(async (rule) => ({ name: rule.name, text: await turns.files.read(scope, rule.path).then((read) => (read.status === "read" ? read.text : "")) })));
        const host = listed.filter((fact) => fact.from === "host").map((fact) => fact.name);
        const values = query.chat === undefined || host.length === 0 ? {} : await turns.facts.read(scope, host);
        return {
          facts: listed.map((fact) => ({
            ...fact,
            value: fact.from === "host" && Object.hasOwn(values, fact.name) ? (values[fact.name] ?? null) : null,
            rules: texts.flatMap((rule) => (rule.text.includes(fact.name) ? [rule.name] : [])),
          })),
        };
      },
    }),
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/rules/firings",
      access: "page",
      group: "rules",
      does: "The rules that fired in a chat, newest first, a page at a time (a job's of his among them), each with what the agent did next; `cursor` is the last id read. The setting `turns.page` gives a page's length.",
      query: {
        rule: opt(T, "Only this rule's firings."),
        limit: opt(shape.whole({ least: 1 }), "How many to give: the setting `turns.page` when left out, and at most `turns.maxPage`."),
        cursor: opt(T, "The id of the last firing read: older ones follow it."),
      },
      reply: shape.named("FiringsReply", "A page of a chat's firings, newest first, and the cursor of the next page (null: none).", shape.object({ items: shape.list(firingShown), next: shape.nullable(T) })),
      handle: async ({ user, params, query }) => {
        const { turnsPage } = await turnSettings(turns.files, { user, chat: params.chat, session: NO_SESSION }, turns.env.log);
        const limit = Math.min(query.limit ?? turnsPage.size, turnsPage.most);
        const before = query.cursor === undefined ? Number.MAX_SAFE_INTEGER : Number(query.cursor);
        if (!Number.isFinite(before)) throw new RouteError(400, `${query.cursor} is no firing's id.`);
        const rows = turns.store.db
          .query<{ seq: number; body: string; turn: string | null; job: string | null; at: number }, (string | number)[]>(
            `SELECT seq, body, turn, job, at FROM rule_firing WHERE user = ? AND chat = ? AND seq < ?${query.rule !== undefined ? " AND rule = ?" : ""} ORDER BY seq DESC LIMIT ?`,
          )
          .all(user, params.chat, before, ...(query.rule !== undefined ? [query.rule] : []), limit + 1);
        const page = rows.slice(0, limit);
        return {
          items: page.map((r) => ({ firing: JSON.parse(r.body), id: String(r.seq), at: r.at, turn: r.turn, run: null, job: r.job, talk: null })),
          next: rows.length > limit && page.length > 0 ? String(page[page.length - 1]?.seq) : null,
        };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/chats/:chat/rules/:name/test",
      access: "page",
      group: "rules",
      long: true,
      does: "Runs a rule, as it reads now, against a past turn of the chat, with that turn's facts; writes nothing. A turn joined to another is answered as such.",
      body: shape.named("RuleTestAsk", "The past turn to run the rule against.", shape.object({ turn: T })),
      reply: ruleTest,
      // It writes nothing: a chat RPE does not hold is not taken on, and has no turn to test against.
      takesChat: false,
      handle: async ({ user, params, body }) => {
        const row = turns.store.user(user).turn(body.turn);
        if (row === null || row.chat !== params.chat) throw new RouteError(404, `Chat ${params.chat} has no turn ${body.turn}.`);
        if (row.joined !== null) throw new JoinedTurnError(body.turn, row.joined);
        // The turn is read in the session it played in: its session file and its folder are there. A turn a migration carried played in none.
        const run = turns.runs.record(user, body.turn);
        if (run === null) throw new RouteError(404, `Chat ${params.chat} has no turn ${body.turn}.`);
        if (run.session === CARRIED_SESSION) throw new RouteError(404, `Turn ${body.turn} was carried by the migration and played in no session of RPE's, so no rule can be tested against it.`);
        try {
          return await turns.harness.rules.test({ user, chat: params.chat, session: run.session, turn: body.turn }, params.name, body.turn);
        } catch (error) {
          throw new RouteError(404, error instanceof Error ? error.message : String(error));
        }
      },
    }),
  ] as const;
}

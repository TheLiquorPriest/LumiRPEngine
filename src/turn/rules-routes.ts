// The Rules page's routes (plan §14 the Rules row, §5.4 l.524-558, C-10): every rule of a chat's stack (or, with no chat, of the
// shipped and global levels a new chat takes) with whether it is in force and why not; one switched at the chat's or the global level
// (RPH writes the level's `off:` list, his own press); the facts a trigger can name, RPH's and RPE's, each with its value in the open
// chat where RPE counts it and the rules whose text names it; the rules that fired in a chat, newest first, a job's among them, with
// what the agent did next; and a rule run against a past turn, which writes nothing. Each mirrors RPH's own type. RPH's hooks are
// listed by the switches route until RPH gives a reader of them.

import type { ListedFact, RuleTest, RuleView } from "rp-harness/contract";
import { type Exactly, type Holds, type Infer, layerLevel, route, RouteError, ruleFiring, shape } from "../app";
import { JoinedTurnError } from "../store";
import { NO_CHAT } from "../tree/layout";
import type { Turns } from "./lane";
import { turnSettings } from "./settings";
import { NO_SESSION } from "./turns";

const T = shape.text();
const N = shape.number();
const opt = shape.optional;

const ruleFields = {
  name: T,
  path: T,
  level: layerLevel,
  description: T,
  agents: shape.union(shape.literal("all"), shape.list(T)),
  trigger: opt(shape.oneOf("always", "pattern", "question", "moment", "command", "interval")),
  command: opt(shape.object({ runs: T, state: shape.oneOf("on", "waiting", "off") })),
  inForce: shape.yesNo(),
  why: opt(shape.oneOf("off", "needs", "example", "broken", "judge")),
  judge: opt(shape.oneOf("part", "yes", "connection")),
  replaces: shape.list(shape.object({ level: layerLevel, path: T })),
};
const ruleBase = shape.object(ruleFields);
type RuleMirrored = Holds<Exactly<Infer<typeof ruleBase>, RuleView>>;
const ruleView = shape.named("RuleView", "A rule as the Rules page lists it: where it is, whom it is for, how it is triggered, a command rule's command and where its switch stands, whether it is in force and why not, and the farther files it replaces.", ruleBase);

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
export type Mirrors = [RuleMirrored, FactMirrored, TestMirrored];

export function rulesRoutes(turns: Turns) {
  /** The scope the rules are read in: a chat's, or with none the shipped and global levels a new chat takes. */
  const scopeOf = (user: string, chat: string | undefined) => ({ user, chat: chat ?? NO_CHAT, session: NO_SESSION });
  /** A chat RPE holds; another is not there. */
  const held = (user: string, chat: string): void => {
    if (turns.store.user(user).chat(chat) === null) throw new RouteError(404, `RPE holds no chat ${chat}.`);
  };
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
        if (query.chat !== undefined) held(user, query.chat);
        return { chat: query.chat ?? null, rules: await turns.harness.rules.list(scopeOf(user, query.chat)) };
      },
    }),
    route({
      method: "POST",
      path: "/api/v1/rules/:name/switch",
      access: "page",
      group: "rules",
      does: "Switches a rule on or off at a chat's level or the global one (the level's off: list); one switched off at a farther level stays off.",
      body: shape.named("RuleSwitch", "On or off, at which level, and the chat for the chat's level.", shape.object({ on: shape.yesNo(), level: shape.oneOf("chat", "global"), chat: opt(T) })),
      reply: shape.named("RuleSwitched", "The rule as it stands after the switch.", shape.object({ rule: ruleView })),
      handle: async ({ user, params, body }) => {
        if (body.level === "chat" && body.chat === undefined) throw new RouteError(400, "A rule is switched at a chat's level for a chat: name it.");
        if (body.chat !== undefined) held(user, body.chat);
        const rule = await turns.harness.rules.switch(scopeOf(user, body.chat), params.name, body.on, body.level);
        if (rule === undefined) throw new RouteError(404, `No rule is named ${params.name}.`);
        return { rule };
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
        if (query.chat !== undefined) held(user, query.chat);
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
        limit: opt(shape.whole({ least: 1 }), "How many to give: the setting `turns.page` when left out, and at most `turns.pageMost`."),
        cursor: opt(T, "The id of the last firing read: older ones follow it."),
      },
      reply: shape.named("FiringsReply", "A page of a chat's firings, newest first, and the cursor of the next page (null: none).", shape.object({ items: shape.list(firingShown), next: shape.nullable(T) })),
      handle: async ({ user, params, query }) => {
        held(user, params.chat);
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
      handle: async ({ user, params, body }) => {
        const row = turns.store.user(user).turn(body.turn);
        if (row === null || row.chat !== params.chat) throw new RouteError(404, `Chat ${params.chat} has no turn ${body.turn}.`);
        if (row.joined !== null) throw new JoinedTurnError(body.turn, row.joined);
        try {
          return await turns.harness.rules.test({ user, chat: params.chat, session: NO_SESSION, turn: body.turn }, params.name, body.turn);
        } catch (error) {
          throw new RouteError(404, error instanceof Error ? error.message : String(error));
        }
      },
    }),
  ] as const;
}

// The editable texts at work (DESIGN §6.12). Resolution: the user's own text, the world's where the
// text has a world level, else the shipped default, in the order its registry entry gives; a text is
// filled from its own placeholders only. Each turn records the set of texts its narrator prompt was
// made from (`PromptSets`), content-addressed in the user's storage, so a later Re-narrate can be
// sent the same ones. Test checks a text as Settings would save it and, where its answer keeps an
// output contract, runs it once and checks the answer against that contract.

import type { UserId } from "../shared/ids";
import { hashJson } from "../shared/hash";
import { hasOwn, isRecord } from "../shared/json";
import type { PromptDef, PromptProblem, PromptTexts } from "../shared/prompts";
import { MARK_TEXT_IDS, PROMPT_BRACES, promptDef, promptProblems, PROMPTS, sendable, TURN_PROMPT_PAGES } from "../shared/prompts";
import type { SecretMarkWording } from "../shared/secret-marks";
import type { Schema } from "../shared/schema-check";
import { checkSchema, pathText } from "../shared/schema-check";
import type { HostPort } from "./host";
import { parseJsonReply } from "./steps";
import { readStoredJson } from "./stored-json";

/** Whose a resolved text is. */
export type PromptSource = "user" | "world" | "default";

export interface ResolvedPrompt {
  text: string;
  source: PromptSource;
}

function defOf(id: string): PromptDef {
  const def = promptDef(id);
  if (!def) throw new Error(`LumiRPEngine has no editable text "${id}"`);
  return def;
}

/**
 * The user's own text for `def` among `texts`, when it can be sent (`sendable`): one missing a
 * placeholder its text requires, or blank where the text can't be, never is (Settings refuses to
 * save one; a prompt set read back from storage is checked too).
 */
function ownText(def: PromptDef, texts: PromptTexts): string | undefined {
  if (!hasOwn(texts, def.id)) return undefined;
  const text = texts[def.id];
  return typeof text === "string" && sendable(def, text) ? text : undefined;
}

/**
 * The text sent for `id` (DESIGN §6.12): the user's own (`texts`: their settings, or a turn's prompt
 * set), the world's (`world`, by id) where the text has a world level, else the shipped default. A
 * world's text comes first where its entry says so (`world: "first"`, the sections a world words for
 * its own story), else after the user's. The world's is taken as the world stores it: its writes and
 * lint check it.
 */
export function resolvePrompt(id: string, texts: PromptTexts, world?: PromptTexts | null): ResolvedPrompt {
  const def = defOf(id);
  const own = ownText(def, texts);
  const worlds = def.world !== undefined && world && hasOwn(world, id) && typeof world[id] === "string" ? world[id] : undefined;
  if (def.world === "first" && worlds !== undefined) return { text: worlds, source: "world" };
  if (own !== undefined) return { text: own, source: own === def.text ? "default" : "user" };
  if (worlds !== undefined) return { text: worlds, source: "world" };
  return { text: def.text, source: "default" };
}

/** `text` with each of `def`'s placeholders filled from `vars` (one without a value is empty), and anything else in double braces left out, as step templates leave an unknown name. */
export function fillPrompt(def: PromptDef, text: string, vars: Readonly<Record<string, string>>): string {
  const names = new Set(def.vars.map((v) => v.name));
  return text.replace(PROMPT_BRACES, (token) => {
    const name = token.slice(2, -2);
    return names.has(name) && hasOwn(vars, name) ? (vars[name] ?? "") : "";
  });
}

/** The text sent for `id`, resolved (`resolvePrompt`) and filled (`fillPrompt`). */
export function renderPrompt(id: string, texts: PromptTexts, vars: Readonly<Record<string, string>>, world?: PromptTexts | null): string {
  return fillPrompt(defOf(id), resolvePrompt(id, texts, world).text, vars);
}

/**
 * The wording of a secret's mark in `texts` (DESIGN §6.11, §6.12): each of the registry's Secret
 * marks texts as `resolvePrompt` reads it, the user's own (or a turn's prompt set's) where it can be
 * sent, else the shipped one. A turn's sections, its narrator rules and the World Info entries in its
 * prompt mark a secret in it, and so do the agents' tools in the user's own.
 */
export function markWording(texts: PromptTexts): SecretMarkWording {
  return {
    known: resolvePrompt(MARK_TEXT_IDS.known, texts).text,
    kept: resolvePrompt(MARK_TEXT_IDS.kept, texts).text,
    both: resolvePrompt(MARK_TEXT_IDS.both, texts).text,
    everyone: resolvePrompt(MARK_TEXT_IDS.everyone, texts).text,
    rule: resolvePrompt(MARK_TEXT_IDS.rule, texts).text,
  };
}

// ---------------------------------------------------------------- prompt sets

/** The texts a turn was made from (DESIGN §6.12): every text on the turn's pages as the user had it, their own or the shipped one. */
export interface PromptSet {
  v: 1;
  texts: Record<string, string>;
}

/**
 * The prompt set a turn made with `texts` records: each text on the pages a turn reads
 * (`TURN_PROMPT_PAGES`), the user's own where it can be sent, else the shipped one. A world's own
 * wording isn't in it: that comes with the world revision the turn reads.
 */
export function turnPromptSet(texts: PromptTexts): PromptSet {
  const out: Record<string, string> = {};
  for (const def of PROMPTS) if (TURN_PROMPT_PAGES.includes(def.page)) out[def.id] = ownText(def, texts) ?? def.text;
  return { v: 1, texts: out };
}

/**
 * The texts a Re-narrate or a Re-run is sent for its source turn (DESIGN §6.12): the turn's prompt
 * set's (`set`; none for a turn recorded before records named one, which was made with the shipped
 * texts), except a secret mark's wording (`MARK_TEXT_IDS`) the set doesn't hold: before it was a
 * registry text it came from Settings, whatever the turn, and the user's settings now hold it
 * (`current`, where a settings file's old wording moved), so it is theirs.
 */
export function sourceTexts(set: PromptSet | null, current: PromptTexts): PromptTexts {
  const texts: Record<string, string> = { ...set?.texts };
  for (const id of Object.values(MARK_TEXT_IDS)) if (!hasOwn(texts, id) && hasOwn(current, id)) texts[id] = current[id] ?? "";
  return texts;
}

function isPromptSet(raw: unknown): raw is PromptSet {
  return isRecord(raw) && raw.v === 1 && isRecord(raw.texts) && Object.values(raw.texts).every((t) => typeof t === "string");
}

/** A prompt set's hash as a record carries it: the shared 128-bit hash, in hex. A record is outside data, so nothing else names a file. */
const SET_HASH = /^[0-9a-f]{32}$/;

function setPath(hash: string): string {
  return `prompts/sets/${hash}.json`;
}

/**
 * Prompt sets in the user's storage, by hash (`prompts/sets/<hash>.json`): written once, never changed,
 * shared by every chat of the user's, so a swipe, a Re-run and a Lumiverse Branch all find the set
 * their record names.
 */
export class PromptSets {
  /** The set each user's last turn stored: the next turn's is the same until a text changes, so it isn't written again. */
  private readonly last = new Map<UserId, string>();

  constructor(private readonly host: Pick<HostPort, "storage" | "log">) {}

  /** Stores `set` unless it already is; its hash. */
  async put(userId: UserId, set: PromptSet): Promise<string> {
    const hash = hashJson(set);
    if (this.last.get(userId) === hash) return hash;
    const path = setPath(hash);
    if ((await this.host.storage.read(path, userId)) === null) {
      await this.host.storage.write(`${path}.tmp`, JSON.stringify(set), userId);
      await this.host.storage.move(`${path}.tmp`, path, userId);
    }
    this.last.set(userId, hash);
    return hash;
  }

  /** The set a record names, or null when it is gone or isn't the set its hash names. */
  async get(userId: UserId, hash: string): Promise<PromptSet | null> {
    if (!SET_HASH.test(hash)) return null;
    const raw = await readStoredJson(this.host, setPath(hash), userId, "prompt set", (r) => isPromptSet(r) && hashJson(r) === hash);
    return isPromptSet(raw) ? raw : null;
  }
}

// ---------------------------------------------------------------- Test

/** An output contract (§16): the JSON schema a text's answer keeps, which Test checks an answer against. */
export interface PromptContract {
  id: string;
  schema: Schema;
}

/** What Test found: the text's own problems, and where it keeps a contract, the answer it got and what in it breaks the contract. */
export interface PromptTestResult {
  problems: PromptProblem[];
  contract: { answer: string; problems: string[] } | null;
}

/**
 * Test (DESIGN §6.12): `text` checked as Settings would save it as `def`'s; then, for a text whose
 * answer keeps an output contract, run once through `run` (its role, on the current chat) and the
 * answer checked against `contract`, so an edit that breaks the role's contract fails here rather
 * than in play. A text with problems isn't run.
 */
export async function testPrompt(def: PromptDef, text: string, input: { maxChars: number; contract: PromptContract | null; run(text: string): Promise<string> }): Promise<PromptTestResult> {
  const problems = promptProblems(def, text, input.maxChars);
  if (problems.length > 0 || def.contract === undefined) return { problems, contract: null };
  const contract = input.contract;
  if (!contract || contract.id !== def.contract) throw new Error(`the text "${def.id}" keeps the contract "${def.contract}", which Test wasn't given`);
  const answer = await input.run(text);
  let value: unknown;
  try {
    value = parseJsonReply(answer);
  } catch {
    return { problems, contract: { answer, problems: ["the answer holds no JSON"] } };
  }
  const broken = checkSchema(contract.schema, value).map((p) => (p.path.length > 0 ? `${pathText(p.path)}: ${p.message}` : p.message));
  return { problems, contract: { answer, problems: broken } };
}

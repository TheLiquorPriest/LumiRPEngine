// The inspector's history (DESIGN §6.5): the last engine runs per chat with their sections,
// clipping and delivery badges (set when the reply's World Info activates), the lore each model step
// read (§5.4) and the minds calls (§24.5, no text). Kept in `userStorage/runs/<chatId>/inspector.json` and
// read when the chat is first viewed or generates, so the inspector shows the same history after a
// restart. A history written before the traces withheld a secret-reading step's lookups (`v: 1`)
// keeps its searches' kinds and counts but not their text: there is no telling now which of them
// carried what.

import type { ChatId, UserId } from "../shared/ids";
import { runDir } from "../shared/ids";
import { hasOwn, isRecord } from "../shared/json";
import { LORE_AUDIENCE } from "../shared/lore";
import { LORE_POLICIES } from "../shared/settings";
import type { ContextGeneration, LoreStepTrace } from "../shared/state-view";
import type { MindCallTrace, PinnedTrace } from "../shared/minds";
import { FIDELITIES, MIND_PURPOSES } from "../shared/minds";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

/** One engine run's sections (`core.context`, DESIGN §6.5), with what the activation check needs. */
export interface InspectorRecord extends ContextGeneration {
  /** Entries the turn switched on, for the activation check (not shown). */
  forced: string[];
  /** Each section's entry, by slot, for its delivery badge (not shown). */
  entries?: Record<string, string>;
}

/** Engine runs kept per chat; the oldest go first. */
export const INSPECTOR_RUNS = 10;

/** The history's format; a `v: 1` history is read with its queries' text dropped (see above). */
const FORMAT = 2;

interface ChatLog {
  userId: UserId;
  records: InspectorRecord[];
}

const ACTIVATIONS: Record<ContextGeneration["activation"], true> = { confirmed: true, unconfirmed: true };
const DELIVERIES: Record<ContextGeneration["sections"][number]["delivery"], true> = { verified: true, unverified: true, unchecked: true };

function strings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === "string");
}

function isInspectorRecord(raw: unknown): raw is InspectorRecord {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.at !== "number" || typeof raw.activation !== "string" || !hasOwn(ACTIVATIONS, raw.activation)) return false;
  if (!isRecord(raw.budget) || typeof raw.budget.sections !== "number" || typeof raw.budget.used !== "number" || !strings(raw.forced)) return false;
  if (raw.entries !== undefined && !(isRecord(raw.entries) && Object.values(raw.entries).every((e) => typeof e === "string"))) return false;
  return Array.isArray(raw.sections) && raw.sections.every((s) => isRecord(s) && typeof s.slot === "string" && typeof s.label === "string" && typeof s.tokens === "number" && typeof s.clipped === "boolean" && typeof s.delivery === "string" && hasOwn(DELIVERIES, s.delivery));
}

const TRANSPORTS: readonly LoreStepTrace["transport"][] = ["none", "tools", "need"];
const QUERY_KINDS: readonly LoreStepTrace["queries"][number]["kind"][] = ["prefetch", "search", "get", "list"];

/**
 * A record's lore traces as stored: the well-formed ones, so a damaged trace costs only itself;
 * `legacy` drops the queries' text. Whenever it was kept, a trace reads as one kept now would: one
 * listing a secret entry isn't shown, and `npc.choose`'s (an NPC's private options) is `private`,
 * its lookups without their text, its searches uncounted and its entries unlisted.
 */
function loreTracesOf(raw: unknown, legacy: boolean): LoreStepTrace[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: LoreStepTrace[] = [];
  for (const t of raw) {
    if (!isRecord(t) || !Array.isArray(t.queries) || !Array.isArray(t.entries) || typeof t.lookups !== "number" || !strings(t.notes)) continue;
    const step = LORE_AUDIENCE.find((p) => p === t.step);
    const policy = LORE_POLICIES.find((p) => p === t.policy);
    const transport = TRANSPORTS.find((x) => x === t.transport);
    if (!step || !policy || !transport || (t.phase !== "pre" && t.phase !== "post")) continue;
    // A trace kept before secret entries were left out lists them, and its counts include them.
    if (t.entries.some((e) => isRecord(e) && e.secret === true)) continue;
    const privateInputs = step === "npc.choose";
    const queries = t.queries.flatMap((q) => {
      const kind = isRecord(q) ? QUERY_KINDS.find((k) => k === q.kind) : undefined;
      if (!kind || !isRecord(q) || typeof q.text !== "string") return [];
      if (privateInputs) return [{ kind, text: legacy || kind !== "prefetch" ? "" : q.text }];
      return typeof q.matched === "number" ? [{ kind, text: legacy ? "" : q.text, matched: q.matched }] : [];
    });
    const entries = privateInputs ? [] : t.entries.flatMap((e) => (isRecord(e) && typeof e.title === "string" && typeof e.tokens === "number" && typeof e.cut === "boolean" ? [{ title: e.title, tokens: e.tokens, cut: e.cut, ...(e.pinned === true ? { pinned: true as const } : {}) }] : []));
    out.push({ step, phase: t.phase, policy, transport, queries, entries, ...(privateInputs ? { private: true as const } : {}), lookups: t.lookups, notes: [...t.notes] });
  }
  return out;
}

const MIND_PHASES: readonly MindCallTrace["phase"][] = ["pre", "post", "skip"];
const MIND_OUTCOMES: readonly MindCallTrace["outcome"][] = ["recorded", "failed"];
const MIND_PROMPTS: readonly MindCallTrace["prompt"][] = ["world", "override", "default"];
/** How an older build named a person the POV didn't know in a trace; such a trace is no longer kept. */
const UNKNOWN_PERSON = "Someone";

/**
 * A record's minds call traces as stored: the well-formed ones, each with only the fields a trace has,
 * so nothing else a damaged or older file carries (a mind's text) can reach the inspector. An older
 * file's traces are screened as new ones are made: a call for someone the POV didn't know is left
 * out, and one whose depiction was kept from the narrator reads as recorded.
 */
export function mindTracesOf(raw: unknown): MindCallTrace[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.flatMap((t): MindCallTrace[] => {
    if (!isRecord(t) || typeof t.who !== "string" || t.who === UNKNOWN_PERSON || typeof t.ms !== "number" || typeof t.tokens !== "number") return [];
    const purpose = MIND_PURPOSES.find((p) => p === t.purpose);
    const phase = MIND_PHASES.find((p) => p === t.phase);
    // The `skip` step's call thinks as no one, so it has no level; every other has one.
    const level = purpose === "skip" && t.level === null ? null : FIDELITIES.find((f) => f === t.level);
    const outcome = t.outcome === "leak_blocked" ? "recorded" : MIND_OUTCOMES.find((o) => o === t.outcome);
    const prompt = MIND_PROMPTS.find((p) => p === t.prompt);
    if (!purpose || !phase || level === undefined || !outcome || !prompt) return [];
    // The lore as the call listed it (DESIGN §24.5), pinned and activated: titles and costs only, never an entry's text.
    const lore = (v: unknown): PinnedTrace[] => (Array.isArray(v) ? v.flatMap((p) => (isRecord(p) && typeof p.title === "string" && typeof p.tokens === "number" && typeof p.cut === "boolean" ? [{ title: p.title, tokens: p.tokens, cut: p.cut }] : [])) : []);
    const pinned = lore(t.pinned);
    const activated = lore(t.activated);
    const notes = strings(t.notes) ? [...t.notes] : [];
    const count = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : 0);
    const routine = count(t.routine);
    const plans = count(t.plans);
    const history = count(t.history);
    return [{ purpose, phase, who: t.who, level, outcome, ms: t.ms, tokens: t.tokens, prompt, ...(pinned.length > 0 ? { pinned } : {}), ...(activated.length > 0 ? { activated } : {}), ...(routine > 0 ? { routine } : {}), ...(plans > 0 ? { plans } : {}), ...(history > 0 ? { history } : {}), ...(notes.length > 0 ? { notes } : {}) }];
  });
}

export class InspectorLog {
  /**
   * Each chat's log, by chat: `WORLD_INFO_ACTIVATED` may arrive without a user, and a chat has one
   * owner. The owner is kept with the log, and another user's lookup reads that user's own file.
   */
  private readonly logs = new Map<ChatId, ChatLog>();
  /** Writes in order per chat; the engine run queues its write rather than waiting on storage. */
  private readonly writes = new Map<ChatId, Promise<void>>();

  constructor(private readonly host: HostPort) {}

  private path(chatId: ChatId): string {
    return `${runDir(chatId)}inspector.json`;
  }

  /** The chat's log, read from storage the first time it is asked for. */
  async load(chatId: ChatId, userId: UserId): Promise<ChatLog> {
    const known = this.logs.get(chatId);
    if (known?.userId === userId) return known;
    // Another owner's log may still be being written; read this one after it.
    await this.writes.get(chatId);
    const raw = await readStoredJson(this.host, this.path(chatId), userId, "inspector history", (r) => isRecord(r) && (r.v === 1 || r.v === FORMAT) && Array.isArray(r.records));
    // Two first looks at once (a view and a generation) share the log the first one read.
    const raced = this.logs.get(chatId);
    if (raced?.userId === userId) return raced;
    const records = isRecord(raw) && Array.isArray(raw.records) ? raw.records.filter(isInspectorRecord).slice(-INSPECTOR_RUNS) : [];
    const legacy = isRecord(raw) && raw.v !== FORMAT;
    const log: ChatLog = {
      userId,
      records: records.map(({ lore, minds, ...r }) => {
        const traces = loreTracesOf(lore, legacy);
        const calls = mindTracesOf(minds);
        return { ...r, ...(traces ? { lore: traces } : {}), ...(calls ? { minds: calls } : {}) };
      }),
    };
    this.logs.delete(chatId);
    this.logs.set(chatId, log);
    if (this.logs.size > 256) this.logs.delete(this.logs.keys().next().value ?? "");
    return log;
  }

  /** The chat's records when its log is loaded (newest last). */
  records(chatId: ChatId): readonly InspectorRecord[] | undefined {
    return this.logs.get(chatId)?.records;
  }

  /** Adds a run, keeping the last `INSPECTOR_RUNS`. */
  async add(chatId: ChatId, userId: UserId, record: InspectorRecord): Promise<void> {
    const log = await this.load(chatId, userId);
    log.records.push(record);
    if (log.records.length > INSPECTOR_RUNS) log.records.splice(0, log.records.length - INSPECTOR_RUNS);
    this.save(chatId);
  }

  /** Queues a write of the chat's log as it stands (a change made to a loaded record). */
  save(chatId: ChatId): void {
    const log = this.logs.get(chatId);
    if (!log) return;
    const path = this.path(chatId);
    const write = (this.writes.get(chatId) ?? Promise.resolve())
      .then(async () => {
        await this.host.storage.write(`${path}.tmp`, JSON.stringify({ v: FORMAT, records: log.records }), log.userId);
        await this.host.storage.move(`${path}.tmp`, path, log.userId);
      })
      .catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] chat ${chatId}: the inspector history wasn't saved (${error instanceof Error ? error.message : String(error)})`, log.userId));
    this.writes.set(chatId, write);
    void write.finally(() => {
      if (this.writes.get(chatId) === write) this.writes.delete(chatId);
    });
  }

  /** Resolves once every queued write is done. */
  async settle(): Promise<void> {
    while (this.writes.size > 0) await Promise.all([...this.writes.values()]);
  }
}

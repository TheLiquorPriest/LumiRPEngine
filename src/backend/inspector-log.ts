// The inspector's history (DESIGN §6.5): the last interceptor runs per chat with their sections,
// clipping and delivery badges, the lore each model step read (§5.4), and the last delivery check
// by slot. Kept in `userStorage/runs/<chatId>/inspector.json` and read when the chat is first
// viewed or generates, so the inspector shows the same history after a restart. A history written
// before the traces withheld a secret-reading step's lookups (`v: 1`) keeps its searches' kinds and
// counts but not their text: there is no telling now which of them carried what.

import type { ChatId, UserId } from "../shared/ids";
import { runDir } from "../shared/ids";
import { hasOwn, isRecord } from "../shared/json";
import { LORE_AUDIENCE } from "../shared/lore";
import { LORE_POLICIES } from "../shared/settings";
import type { ContextGeneration, LoreStepTrace } from "../shared/state-view";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

/** One interceptor run (`core.context`, DESIGN §6.5), with what the activation check and warnings need. */
export interface InspectorRecord extends ContextGeneration {
  /** Entries forced, for the activation check (not shown). */
  forced: string[];
  warnings?: string[];
}

export type Delivery = Record<string, "verified" | "unverified">;

/** Interceptor runs kept per chat; the oldest go first. */
export const INSPECTOR_RUNS = 10;

/** The history's format; a `v: 1` history is read with its queries' text dropped (see above). */
const FORMAT = 2;

interface ChatLog {
  userId: UserId;
  records: InspectorRecord[];
  delivery: Delivery;
}

const ACTIVATIONS: Record<ContextGeneration["activation"], true> = { confirmed: true, unconfirmed: true };
const DELIVERIES: Record<ContextGeneration["sections"][number]["delivery"], true> = { verified: true, unverified: true, unchecked: true };

function strings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === "string");
}

function isInspectorRecord(raw: unknown): raw is InspectorRecord {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.at !== "number" || typeof raw.activation !== "string" || !hasOwn(ACTIVATIONS, raw.activation)) return false;
  if (!isRecord(raw.budget) || typeof raw.budget.sections !== "number" || typeof raw.budget.used !== "number" || !strings(raw.forced)) return false;
  if (raw.warnings !== undefined && !strings(raw.warnings)) return false;
  return Array.isArray(raw.sections) && raw.sections.every((s) => isRecord(s) && typeof s.slot === "string" && typeof s.label === "string" && typeof s.tokens === "number" && typeof s.clipped === "boolean" && typeof s.delivery === "string" && hasOwn(DELIVERIES, s.delivery));
}

const TRANSPORTS: readonly LoreStepTrace["transport"][] = ["none", "tools", "need"];
const QUERY_KINDS: readonly LoreStepTrace["queries"][number]["kind"][] = ["prefetch", "search", "get", "list"];

/**
 * A record's lore traces as stored: the well-formed ones, so a damaged trace costs only itself;
 * `legacy` drops the queries' text. Whenever it was kept, a trace reads as one kept now would: one
 * listing a secret entry isn't shown, and `npc.choose`'s (an NPC's private options) shows its
 * lookups without their text and its entries without titles.
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
      return kind && isRecord(q) && typeof q.text === "string" && typeof q.matched === "number" ? [{ kind, text: legacy || (privateInputs && kind !== "prefetch") ? "" : q.text, matched: q.matched }] : [];
    });
    const entries = t.entries.flatMap((e) => (isRecord(e) && typeof e.title === "string" && typeof e.tokens === "number" && typeof e.cut === "boolean" ? [{ title: privateInputs ? "" : e.title, tokens: e.tokens, cut: e.cut }] : []));
    out.push({ step, phase: t.phase, policy, transport, queries, entries, lookups: t.lookups, notes: [...t.notes] });
  }
  return out;
}

function deliveryOf(raw: unknown): Delivery {
  const out: Delivery = {};
  if (!isRecord(raw)) return out;
  for (const slot of Object.keys(raw)) {
    const v = raw[slot];
    if (v === "verified" || v === "unverified") out[slot] = v;
  }
  return out;
}

export class InspectorLog {
  /**
   * Each chat's log, by chat: `WORLD_INFO_ACTIVATED` may arrive without a user, and a chat has one
   * owner. The owner is kept with the log, and another user's lookup reads that user's own file.
   */
  private readonly logs = new Map<ChatId, ChatLog>();
  /** Writes in order per chat; the interceptor queues its write rather than waiting on storage. */
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
      records: records.map(({ lore, ...r }) => {
        const traces = loreTracesOf(lore, legacy);
        return traces ? { ...r, lore: traces } : r;
      }),
      delivery: isRecord(raw) ? deliveryOf(raw.delivery) : {},
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

  /** Queues a write of the chat's log as it stands (a change made to a loaded record or its delivery). */
  save(chatId: ChatId): void {
    const log = this.logs.get(chatId);
    if (!log) return;
    const path = this.path(chatId);
    const write = (this.writes.get(chatId) ?? Promise.resolve())
      .then(async () => {
        await this.host.storage.write(`${path}.tmp`, JSON.stringify({ v: FORMAT, records: log.records, delivery: log.delivery }), log.userId);
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

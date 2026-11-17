// Build's five model jobs (plan §14, App. C; PlanChatUI-B5): Import from lore, Index this text, Refine with AI, Describe a map and Propose
// routines. Each kind says what its input is kept as (`bound`, each value cut or refused at its setting), and, when a job of it starts,
// what its agent is given by name (data, no words: the words are its definition's and its brief's, in `guidance/`), what one call of
// `world_propose` is checked as against the draft and the registry, and what the job ends with. Every proposal is kept with the job as
// it is made, so an interrupted job keeps what it proposed; nothing reaches the draft but by his Apply.

import type { EntityId, UserId, WorldId } from "../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../shared/json";
import type { JobProposal, JobResult } from "../../shared/jobs";
import { loreBooksOf } from "../../shared/lore";
import { publicText } from "../../shared/secret-marks";
import type { LoreEntryDef, WorldDoc } from "../../shared/world";
import type { WorldService } from "../../worlds/service";
import type { BuildBooks } from "../lore/books";
import { addDrop, checkProposals, type DropCounts, dropSummary, dropWords, entryTitle, kindsGiven, type ProposalMode, readProposals, type Say } from "./checks";
import { JobError } from "./home";
import { checkIndexProposals, keptText, readIndexProposals } from "./index-text";
import type { JobLimits } from "./limits";
import { mapGiven, mapProposal, type MapAnswer, problemLines, readMapAnswer, readMapRequest } from "./map";
import { checkRoutineReply, finishRoutines, laterOver, loreCutMessage, type RoutineCandidate, type RoutineJobInput, routineGiven, routinePass, routineScope } from "./routines";

export type ModelKind = "import_lore" | "index_text" | "refine" | "describe_map" | "propose_routines";

/** What one call of `world_propose` came to: what the agent is answered (data), and whether nothing in it could be used. */
export interface Proposed {
  answer: JsonObject;
  unusable: boolean;
}

/** One model job's work while it runs. */
export interface KindRun {
  /** What its agent is given by name (`build:job`), as data. */
  given: JsonObject;
  /** The fields its brief's line is filled with, beside the world's id and name. */
  fields: Record<string, string | number>;
  /** One call of `world_propose`, checked against the draft as it stands now; what it made is kept. What it says is in the words of `say`. */
  propose(args: JsonObject, say: Say): Promise<Proposed>;
  /** The proposals so far, checked, as the review shows them. */
  proposals(): JobProposal[];
  /** What the job ends with; `cut`: its agent stopped at one of RPH's limits. */
  end(cut: boolean, say: Say): { result: JobResult; notes: string[] };
}

/** What a kind's job starts from. */
export interface KindStart {
  user: UserId;
  world: WorldId;
  input: JsonObject;
  limits: JobLimits;
  worlds: WorldService;
  books: BuildBooks;
}

export interface ModelKindDef {
  /** The agent definition the job runs as (`guidance/.agents/<agent>.md`). */
  agent: string;
  bound(input: JsonObject, limits: JobLimits): JsonObject;
  start(from: KindStart): Promise<KindRun>;
}

function idOf(v: JsonValue | undefined, limits: JobLimits): string {
  if (typeof v !== "string") return "";
  if (v.length > limits.idChars) throw new JobError("bad_request", `an id is at most ${limits.idChars} characters`);
  return v;
}

function textOf(v: JsonValue | undefined, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function stringsOf(v: JsonValue | undefined): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

/** Each reason's count in `after` beyond what `before` counted, in the words of its line: what one call added. */
function droppedBy(before: DropCounts, after: DropCounts, say: Say): JsonObject[] {
  return [...after].flatMap(([key, d]) => (d.count > (before.get(key)?.count ?? 0) ? [{ why: dropWords(say, d), count: d.count - (before.get(key)?.count ?? 0) }] : []));
}

/**
 * Import and Refine: proposals of people, places, routes and every pack's kinds, each call's checked with all the job made so far (a
 * later proposal of the same id stands over the earlier), answered with how many stand and what was dropped and why.
 */
function proposing(from: KindStart, mode: ProposalMode, review: (draft: WorldDoc, raw: readonly JobProposal[], drops: DropCounts) => JobProposal[], given: JsonObject, fields: Record<string, string | number>): KindRun {
  const raw: JobProposal[] = [];
  let calls = 0;
  let last: WorldDoc | null = null;
  const draft = async (): Promise<WorldDoc> => (last = await from.worlds.worlds.working(from.world, from.user));
  return {
    given,
    fields,
    async propose(args, say) {
      const doc = await draft();
      const call = `call${++calls}`;
      // A proposal that cites no source stays unlinked rather than borrowing the call's name.
      const fresh = readProposals(args.proposals, call).map((p) => ({ ...p, source: p.source === call ? (mode === "import" ? "lore" : "refine") : p.source }));
      const before: DropCounts = new Map();
      review(doc, raw, before);
      raw.push(...fresh);
      const after: DropCounts = new Map();
      const kept = review(doc, raw, after);
      return { answer: { read: fresh.length, standing: kept.length, dropped: droppedBy(before, after, say) }, unusable: fresh.length === 0 };
    },
    proposals: () => (last === null ? [] : review(last, raw, new Map())),
    end(_cut, say) {
      const drops: DropCounts = new Map();
      const proposals = last === null ? [] : review(last, raw, drops);
      const said = dropSummary(raw.length, proposals.length, drops, say);
      return { result: { proposals }, notes: said === null ? [] : [said] };
    },
  };
}

const importLore: ModelKindDef = {
  agent: "build-import-lore",
  bound(input, limits) {
    const bookIds = stringsOf(input.bookIds).map((id) => idOf(id, limits));
    if (bookIds.length > limits.books) throw new JobError("bad_request", `pick at most ${limits.books} lore books (Settings: build.import.books)`);
    return { bookIds };
  },
  async start(from) {
    const bookIds = stringsOf(from.input.bookIds);
    if (bookIds.length === 0) throw new Error("pick at least one lore book");
    const index = await from.worlds.worlds.index(from.world, from.user);
    const entries: { source: string; book: string; title: string; text: string }[] = [];
    // Back-links (DESIGN §9.7): a proposal cites its entry's id; a title works too.
    const links = new Map<string, string>();
    const titles = new Map<string, string>();
    for (const bookId of bookIds) {
      // The world's own book is not read again.
      if (bookId === index?.loreBookId) continue;
      for (const e of await from.books.entries(from.user, bookId)) {
        // What anyone may read of an entry: its secret marks left out (DESIGN §4.2), so none reaches a proposal.
        const text = publicText(e.content);
        if (text.trim() === "" || e.disabled) continue;
        const title = entryTitle(e);
        const link = `${e.book}/${e.id}`;
        entries.push({ source: e.id, book: e.book, title, text });
        links.set(e.id, link);
        if (title !== "") titles.set(link, title);
        if (title !== "" && !links.has(title.toLowerCase())) links.set(title.toLowerCase(), link);
      }
    }
    if (entries.length === 0) throw new Error("the chosen books have no entries with text");
    const linkOf = (source: string): string | null => links.get(source.trim()) ?? links.get(source.trim().toLowerCase()) ?? null;
    const draft = await from.worlds.worlds.working(from.world, from.user);
    const review = (doc: WorldDoc, raw: readonly JobProposal[], drops: DropCounts): JobProposal[] =>
      checkProposals(doc, from.worlds.registry, raw, "import", from.limits.proposals, { linkOf }, drops).map((p) => {
        // The review names each cited entry by its title; it adds its book's name.
        const cited = isRecord(p.value) && Array.isArray(p.value.sources) ? p.value.sources.filter((link): link is string => typeof link === "string") : [];
        const named = cited.flatMap((link) => {
          const title = titles.get(link);
          return title ? [[link, title] as const] : [];
        });
        return named.length > 0 ? { ...p, sourceNames: Object.fromEntries(named) } : p;
      });
    return proposing(from, "import", review, { ...kindsGiven(draft, from.worlds.registry), entries }, { entries: entries.length, books: bookIds.length });
  },
};

const refine: ModelKindDef = {
  agent: "build-refine",
  bound: (input, limits) => ({ instructions: textOf(input.instructions, limits.refineChars) }),
  async start(from) {
    const request = textOf(from.input.instructions, from.limits.refineChars);
    if (request === "") throw new Error("say what to build or change");
    const draft = await from.worlds.worlds.working(from.world, from.user);
    const review = (doc: WorldDoc, raw: readonly JobProposal[], drops: DropCounts): JobProposal[] => checkProposals(doc, from.worlds.registry, raw, "refine", from.limits.proposals, undefined, drops);
    return proposing(from, "refine", review, { ...kindsGiven(draft, from.worlds.registry), request }, {});
  },
};

const indexText: ModelKindDef = {
  agent: "build-index-text",
  bound(input, limits) {
    const kept = keptText(typeof input.text === "string" ? input.text : "", limits.indexChars);
    return { text: kept.text, ...(kept.cut > 0 ? { cut: kept.cut } : {}) };
  },
  async start(from) {
    const text = textOf(from.input.text, from.limits.indexChars);
    if (text === "") throw new Error("paste the text to index");
    const cut = typeof from.input.cut === "number" ? from.input.cut : 0;
    // Indexing reads the draft, so entries already there (applied from an earlier run) are not proposed again.
    const draft = await from.worlds.worlds.working(from.world, from.user);
    const raw: JobProposal[] = [];
    let calls = 0;
    let last = draft;
    return {
      given: {
        world: draft.id,
        name: draft.name,
        lore: Object.values(draft.lore).map((l) => l.title),
        entities: Object.values(draft.entities).map((e) => ({ id: e.id, name: e.name })),
        places: Object.values(draft.places).map((p) => ({ id: p.id, name: p.name })),
        text,
      },
      fields: { chars: text.length },
      async propose(args, say) {
        last = await from.worlds.worlds.working(from.world, from.user);
        const fresh = readIndexProposals(args.entries, `call${++calls}`);
        const before: DropCounts = new Map();
        checkIndexProposals(last, raw, from.limits.proposals, before);
        raw.push(...fresh);
        const after: DropCounts = new Map();
        const kept = checkIndexProposals(last, raw, from.limits.proposals, after);
        return { answer: { read: fresh.length, standing: kept.length, dropped: droppedBy(before, after, say) }, unusable: fresh.length === 0 };
      },
      proposals: () => checkIndexProposals(last, raw, from.limits.proposals),
      end(_cut, say) {
        const drops: DropCounts = new Map();
        const proposals = checkIndexProposals(last, raw, from.limits.proposals, drops);
        const said = dropSummary(raw.length, proposals.length, drops, say);
        const notes = [...(cut > 0 ? [`The last ${cut.toLocaleString("en-US")} characters of the text were past build.index.chars and were not read; index them in another job.`] : []), ...(said === null ? [] : [said])];
        return { result: { proposals }, notes };
      },
    };
  },
};

const describeMap: ModelKindDef = {
  agent: "build-describe-map",
  bound(input, limits) {
    const mapId = idOf(input.mapId, limits);
    return { scope: idOf(input.scope, limits), prose: textOf(input.prose, limits.proseChars), ...(mapId !== "" ? { mapId } : {}) };
  },
  async start(from) {
    // On the draft, where he is working: the place may be new, and the map applies there.
    const draft = await from.worlds.worlds.working(from.world, from.user);
    const request = readMapRequest(draft, from.input);
    let best: (MapAnswer & { map: NonNullable<MapAnswer["map"]> }) | null = null;
    return {
      given: mapGiven(draft, request),
      fields: { place: request.scope, map: request.mapId },
      async propose(args) {
        const doc = await from.worlds.worlds.working(from.world, from.user);
        const answer = readMapAnswer(doc, request, args.map ?? null);
        const errors = answer.problems.filter((p) => p.severity === "error");
        // The last map that reads stands; the problems it has are the agent's to fix.
        if (answer.map !== null) best = { ...answer, map: answer.map };
        return { answer: { map: answer.map !== null, errors: problemLines(errors), warnings: problemLines(answer.problems.filter((p) => p.severity !== "error")) }, unusable: answer.map === null };
      },
      proposals: () => (best === null ? [] : [mapProposal(request, best)]),
      end() {
        if (best === null) throw new Error("the job's agent proposed no map that reads");
        const errors = best.problems.some((p) => p.severity === "error");
        return { result: { proposals: [mapProposal(request, best)] }, notes: errors ? ["The map still has problems; its note lists them, and it starts unticked."] : [] };
      },
    };
  },
};

/** The draft with the entries of the books it reads (`loreBooks`) beside its own lore, as a chat of it reads them: each by `book:<book>/<entry>`, its secret marks left out. */
async function withBookLore(draft: WorldDoc, from: KindStart): Promise<WorldDoc> {
  const lore: Record<string, LoreEntryDef> = { ...draft.lore };
  for (const book of loreBooksOf(draft)) {
    for (const e of await from.books.entries(from.user, book)) {
      const content = publicText(e.content);
      if (e.disabled || content.trim() === "") continue;
      const id = `book:${book}/${e.id}`;
      lore[id] = { id, title: entryTitle(e) || e.id, content, keys: [], links: [], source: { kind: "book", bookId: book, entryId: e.id, hash: String(e.revision) } };
    }
  }
  return { ...draft, lore };
}

const proposeRoutines: ModelKindDef = {
  agent: "build-propose-routines",
  bound(input, limits) {
    const owners = Array.isArray(input.owners) ? [...new Set(stringsOf(input.owners).map((id) => idOf(id, limits)))].filter((o) => o !== "") : null;
    if (owners && owners.length > limits.owners) throw new JobError("bad_request", `name at most ${limits.owners} people and groups (Settings: build.routines.owners)`);
    const after = idOf(input.after, limits);
    return { ...(owners ? { owners } : {}), ...(after !== "" ? { after } : {}) };
  },
  async start(from) {
    // On the draft, where he is working: what an earlier pass proposed and was applied counts as the world's.
    const draft = await withBookLore(await from.worlds.worlds.working(from.world, from.user), from);
    const scope = routineScope(from.worlds.registry, draft);
    const request: RoutineJobInput = { ...(Array.isArray(from.input.owners) ? { owners: stringsOf(from.input.owners) } : {}), ...(typeof from.input.after === "string" ? { after: from.input.after } : {}) };
    const pass = routinePass(scope, request, from.limits.loreTokens, from.limits.perPass);
    const unread = pass.unread.length > 0 ? `${pass.unread.length} named weren't read: they aren't people or groups the job may read (${pass.unread.slice(0, 6).join(", ")}${pass.unread.length > 6 ? "…" : ""}).` : null;
    if (pass.owners.length === 0) throw new Error(request.owners ? `none of the named people or groups is one the job may read; secret ones and the player character aren't proposed for${unread ? `. ${unread}` : ""}` : request.after ? `no one comes after ${request.after}: the last pass read everyone` : "the world has no people or groups the job may read; secret ones and the player character aren't proposed for");
    if (pass.batch.owners.length === 0) throw new Error(loreCutMessage(scope, pass.cut, from.limits.loreTokens) ?? "no one has a sheet field or a lore entry to go on: write about their days in the lore or their sheets first");
    let candidates: RoutineCandidate[] = [];
    return {
      given: routineGiven(scope, pass),
      fields: { people: pass.batch.owners.length },
      async propose(args, say) {
        const check = checkRoutineReply(scope, pass.batch, args);
        candidates = laterOver(candidates, check.candidates);
        return { answer: { ...(check.problem === null ? {} : { problem: say(`unusable_${check.problem.why}`, check.problem.fields) ?? check.problem.why }), read: check.candidates.length, toFix: check.fixable }, unusable: check.problem !== null };
      },
      proposals: () => finishRoutines(scope, candidates).slice(0, from.limits.proposals),
      end(_cut, say) {
        const drops: DropCounts = new Map();
        const all = finishRoutines(scope, candidates, drops);
        const proposals = all.slice(0, from.limits.proposals);
        if (all.length > proposals.length) addDrop(drops, "past_limit", { max: from.limits.proposals }, all.length - proposals.length);
        const last: EntityId | undefined = pass.owners.at(-1);
        const next: JsonObject | null = pass.rest > 0 && last !== undefined ? { ...(request.owners ? { owners: request.owners } : {}), after: last } : null;
        const bare = pass.bare.length > 0 ? `${pass.bare.length} had nothing in their sheets or the lore to go on (${pass.bare.slice(0, 6).join(", ")}${pass.bare.length > 6 ? "…" : ""}), so they get none.` : null;
        const flagged = proposals.filter((p) => (p.problems?.length ?? 0) > 0).length;
        const notes = [
          next !== null ? `${pass.rest} people and groups come after this pass (build.routines.perPass); continue for the rest.` : null,
          unread,
          loreCutMessage(scope, pass.cut, from.limits.loreTokens),
          bare,
          dropSummary(candidates.length, proposals.length, drops, say),
          flagged > 0 ? `${flagged} proposal(s) have problems to look at; they start unticked.` : null,
        ].filter((m): m is string => m !== null);
        return { result: { proposals, ...(next ? { next } : {}) }, notes };
      },
    };
  },
};

/** The five kinds, by the job kind Build starts them as. */
export const MODEL_KINDS: Readonly<Record<ModelKind, ModelKindDef>> = {
  import_lore: importLore,
  index_text: indexText,
  refine,
  describe_map: describeMap,
  propose_routines: proposeRoutines,
};

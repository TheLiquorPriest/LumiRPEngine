// The one way the agent tools read a chat (AGENT-LOOP-PLAN §6; INC1-SPEC C6): `ToolReadView`, the
// chat's head as the agent's knowledge lets it read it. Outside a turn it is built from the head
// without the ledger's queue (`outsideReader`: what the GM view and the narrator's preview read), so a
// long agent run never waits behind, or stales, a turn. The three knowledge settings:
//
// - `pov` reads as Play's player scope: the people and things the player character may know of
//   (`povMayKnow`), the places it can see, the tracks of its quest log under the ids Play knows them
//   by, and the fields it may see, each as Play shows it: plain, with no hint of how hidden anything is.
// - `everyone` reads as the narrator's `scene` view: everything in the world, with every secret (a
//   restricted person, thing, place, field, track or lore entry, a fact someone keeps) marked in the
//   user's wording of a secret's mark (the prompt registry's Secret marks texts), naming who knows it.
// - `gm` reads everything, unmarked; a tool gives each restricted thing's visibility instead.
//
// A user's entry text (World Info) is handed on through `applyMarks` for the view (`entryText`). What
// the view may name (`seesEntity`, `seesPlace`, `seesTrack`) is all the resolver (`tools/resolve.ts`)
// resolves to, so a hidden name reads as one that doesn't exist.

import type { ReadContext } from "../../../engine/registry";
import type { Registry } from "../../../engine/registry-impl";
import type { WorldState } from "../../../engine/state";
import { loreHeldBy, loreReadable } from "../../../engine/lore";
import { labelOf, own } from "../../../engine/pack-kit";
import { povMayKnow } from "../../../engine/player-events";
import { readPass } from "../../../engine/read-pass";
import { fieldDef, isGone, kindIs } from "../../../engine/scope";
import { canSeeEntity, canSeeField, canSeePlace, entityVisibility, HIDDEN_PLACE_NAME, isDiscoverable, loreGateReader, playerTrack, type PlayerTrack, shownTrackId, trackKnown, visibilityOf } from "../../../engine/visibility";
import { factsOf, holdingsOf } from "../../../packs/minds/core/knowledge";
import { readSlice } from "../../../packs/minds/core/state";
import type { AgentKnowledge } from "../../../shared/agent-tools";
import type { EntityId, PlaceId, TrackId } from "../../../shared/ids";
import { hasOwn } from "../../../shared/json";
import { engineWroteEntry, loreIsSecret, loreSourceOf } from "../../../shared/lore";
import { effectiveMemory, type FactId, type FidelityTexts, type MindsMemoryConfig } from "../../../shared/minds";
import type { PromptTexts } from "../../../shared/prompts";
import { applyMarks, type SecretMarkWording, secretMarkText } from "../../../shared/secret-marks";
import type { LoreEntryDef, WorldDoc } from "../../../shared/world";
import { loreBookIds } from "../../book-lore";
import { markWording } from "../../prompts";
import type { HostBookEntry } from "../../host";
import { latestTexts } from "../../gm";
import { toChain } from "../../ledger-io";
import { renderPrompt } from "../../prompts";
import type { Runtime } from "../../runtime";
import type { ToolOutcome } from "../runtime";
import type { ToolEnv } from "./registry";
import { listWorkspace, type WorkspaceFile } from "./workspace";

/** Where the tools read a chat (`ToolEnv.reader`): the engine's registry, and the chat as the agent's knowledge reads it now. */
export interface ToolReader {
  /** The engine's registry: its kinds and actions fill the tools' schemas (`toolsFor`). */
  readonly registry: Registry;
  /** The chat as the tools read it now; each call reads it afresh, so a turn that lands in between is seen. */
  view(): Promise<ToolReadView>;
}

/** Who knows a restricted thing besides the GM, by name, and whom it is kept from: `"everyone"`, every one else. */
export interface Secrecy {
  known: readonly string[];
  kept: readonly string[] | "everyone";
}

/** A person, thing, place or track as a view names it: its id (a secret track's stand-in under `pov`), its name (marked under `everyone`), and its visibility under `gm` when it isn't public. */
export interface ViewRef {
  id: string;
  name: string;
  visibility?: string;
}

/** A lore entry as a view gives it: its text marked under `everyone`, its secrecy spelled out under `gm`. */
export interface ViewLore {
  id: string;
  title: string;
  text: string;
  secret?: true;
  holders?: string[];
  visibility?: string;
}

export interface ReadViewInput {
  knowledge: AgentKnowledge;
  registry: Registry;
  world: WorldDoc;
  state: WorldState;
  /** The user's own texts: the tool layer's notes are sent in them. */
  texts: PromptTexts;
  /** The user's wording of a secret's mark (the prompt registry's Secret marks texts, `markWording`). */
  wording: SecretMarkWording;
  /** Settings → Minds → Knowledge: a holding less sure than this is a suspicion. */
  threshold: number;
  /** What GM → Minds reads besides the state: the user's minds switch, the chat's memory config (the world's, the user's overrides over it) and the chat's latest message and reply, which fidelity reads (`latestTexts`); absent, minds off, the world's memory and no texts. */
  minds?: ViewMinds;
  /** The world with the lore its World Info books hold now (`Runtime.readLore`); absent, the world's own lore. */
  lore?: (world: WorldDoc) => Promise<WorldDoc>;
  /** A workspace file's body by its blob hash (`BlobStore.get`); absent, none. */
  blob?: (hash: string) => Promise<string | null>;
  /** The entries of the World Info books the chat reads lore from, as written; absent, none. */
  books?: (world: WorldDoc) => Promise<HostBookEntry[]>;
  /** The chat's workspace files the agent's knowledge may read, with their provenance (`listWorkspace`); absent, none. */
  workspace?: () => Promise<WorkspaceFile[]>;
}

/** What GM → Minds reads besides the state (`buildMindsGm`). */
export interface ViewMinds {
  enabled: boolean;
  memory: MindsMemoryConfig;
  latest: FidelityTexts;
}

/** The narrator reads lore as the steps that write for it do (`engine/place-lore.ts`): a secret only once its gate holds, a Known by entry by what the player character knows. */
const NARRATOR_READS = "brief";

export class ToolReadView {
  readonly knowledge: AgentKnowledge;
  readonly registry: Registry;
  readonly world: WorldDoc;
  readonly state: Readonly<WorldState>;
  readonly ctx: ReadContext;
  /** The player character. */
  readonly pov: EntityId;
  readonly texts: PromptTexts;
  readonly wording: SecretMarkWording;
  readonly threshold: number;
  readonly minds: ViewMinds;
  private readonly readLore: (world: WorldDoc) => Promise<WorldDoc>;
  private readonly readBlob: (hash: string) => Promise<string | null>;
  private readonly readBooks: (world: WorldDoc) => Promise<HostBookEntry[]>;
  private readonly readWorkspace: () => Promise<WorkspaceFile[]>;
  private loreRead: Promise<WorldDoc> | null = null;
  private booksRead: Promise<HostBookEntry[]> | null = null;
  private persons: EntityId[] | null = null;
  private gates: ((entry: LoreEntryDef) => boolean) | null = null;

  constructor(input: ReadViewInput) {
    this.knowledge = input.knowledge;
    this.registry = input.registry;
    this.world = input.world;
    this.state = input.state;
    this.ctx = input.registry.context(input.world, input.state);
    this.pov = input.world.pov;
    this.texts = input.texts;
    this.wording = input.wording;
    this.threshold = input.threshold;
    this.minds = input.minds ?? { enabled: false, memory: effectiveMemory(input.world, { memory: {} }), latest: { user: "", reply: "" } };
    this.readLore = input.lore ?? (async (world) => world);
    this.readBlob = input.blob ?? (async () => null);
    this.readBooks = input.books ?? (async () => []);
    this.readWorkspace = input.workspace ?? (async () => []);
  }

  /** `read` inside one read pass, so the engine's readers share their work (`readPass`). */
  read<T>(read: () => T): T {
    return readPass(read);
  }

  // ---------------------------------------------------------------- the player character's knowledge

  /** Whether the player character may know of an entity (Play's player scope, `povMayKnow`): itself, someone it has met, its own thing, or one it can see where it stands. */
  povKnowsEntity(id: EntityId): boolean {
    return povMayKnow(this.registry, this.world, this.state, id);
  }

  povSeesPlace(id: PlaceId): boolean {
    return canSeePlace(this.registry, this.world, this.state, this.pov, id);
  }

  /** A track as the player character's quest log has it (`playerTrack`), or null when it is hidden from it. */
  povTrack(id: TrackId): PlayerTrack | null {
    return playerTrack(this.registry, this.world, this.state, this.pov, id);
  }

  povSeesField(entity: EntityId, field: string): boolean {
    return canSeeField(this.registry, this.world, this.state, this.pov, entity, field);
  }

  /** Whether the player character reads a lore entry: as the narrator does (a secret once its gate holds), or as one of its own secrets' holders. */
  povReadsLore(entry: LoreEntryDef): boolean {
    return loreReadable(this.registry, this.world, this.state, entry, NARRATOR_READS, false, this.gate()) || (loreIsSecret(entry) && loreHeldBy(this.world, entry, this.pov));
  }

  // ---------------------------------------------------------------- what this view may name

  /** An entity this view may name: under `gm` every one, a removed one too; under `everyone` every one in the world; under `pov`, as Play would. */
  seesEntity(id: EntityId): boolean {
    if (!hasOwn(this.state.entities, id)) return false;
    if (this.knowledge === "gm") return true;
    if (this.knowledge === "everyone") return !isGone(this.state, id);
    return this.povKnowsEntity(id);
  }

  seesPlace(id: PlaceId): boolean {
    if (!hasOwn(this.world.places, id)) return false;
    return this.knowledge === "pov" ? this.povSeesPlace(id) : true;
  }

  seesTrack(id: TrackId): boolean {
    if (!hasOwn(this.world.tracks, id)) return false;
    return this.knowledge === "pov" ? this.povTrack(id) !== null : true;
  }

  /** A fact this view may name, by its id: under `pov` one the player character holds; else any the chat records. One it may not name reads as one that doesn't exist. */
  seesFact(id: FactId): boolean {
    const slice = readSlice(this.state);
    return this.knowledge === "pov" ? own(holdingsOf(slice, this.pov), id) !== undefined : own(factsOf(slice), id) !== undefined;
  }

  /** A field of an entity this view may read: under `pov`, one the player character may see of one it may know of. */
  seesField(entity: EntityId, field: string): boolean {
    if (!this.seesEntity(entity)) return false;
    return this.knowledge === "pov" ? this.povSeesField(entity, field) : true;
  }

  /** Whether an entity is a person (its kind is or extends `person`). */
  isPerson(id: EntityId): boolean {
    const e = own(this.state.entities, id);
    return e !== undefined && kindIs(this.registry, this.world, e.kind, "person");
  }

  // ---------------------------------------------------------------- secrecy and marks

  /** Everyone in the world who acts as a knower: the people not removed. */
  private people(): EntityId[] {
    this.persons ??= Object.keys(this.state.entities).filter((id) => this.isPerson(id) && !isGone(this.state, id));
    return this.persons;
  }

  private gate(): (entry: LoreEntryDef) => boolean {
    this.gates ??= loreGateReader(this.registry, this.world, this.state);
    return this.gates;
  }

  /** The names of the people, the subject aside, for whom `knows` holds: who knows a restricted thing. */
  private knowers(subject: string | null, knows: (who: EntityId) => boolean): string[] {
    return this.people()
      .filter((who) => who !== subject && knows(who))
      .map((who) => own(this.state.entities, who)?.name ?? who);
  }

  /** A restricted entity's secrecy (secret, Known by or discoverable), or null for a public one. */
  entitySecrecy(id: EntityId): Secrecy | null {
    if (!hasOwn(this.state.entities, id) || id === this.pov) return null;
    if (!isDiscoverable(this.world, this.state, id) && entityVisibility(this.world, this.state, id) === "public") return null;
    return { known: this.knowers(id, (who) => canSeeEntity(this.registry, this.world, this.state, who, id)), kept: "everyone" };
  }

  /** A restricted place's secrecy: one that isn't public, or inside one that isn't, which hides it as much. */
  placeSecrecy(id: PlaceId): Secrecy | null {
    let restricted = false;
    const seen = new Set<PlaceId>();
    for (let at: PlaceId | undefined = id; at !== undefined && !seen.has(at); at = own(this.world.places, at)?.parent) {
      seen.add(at);
      const def = own(this.world.places, at);
      if (!def) break;
      if (def.visibility === "discoverable" || visibilityOf(def.visibility) !== "public") restricted = true;
    }
    if (!restricted) return null;
    return { known: this.knowers(null, (who) => canSeePlace(this.registry, this.world, this.state, who, id)), kept: "everyone" };
  }

  /** A restricted track's secrecy: a secret one is the GM's, known only to its owner (an agenda is its owner's own); a Known by one, to whoever knows it (`trackKnown`). */
  trackSecrecy(id: TrackId): Secrecy | null {
    const t = own(this.world.tracks, id);
    if (!t) return null;
    const visibility = visibilityOf(t.visibility);
    if (visibility === "public") return null;
    return { known: this.knowers(null, visibility === "secret" ? (who) => who === t.owner : (who) => trackKnown(this.registry, this.world, this.state, who, t)), kept: "everyone" };
  }

  /** A restricted field's secrecy: who may see it of its entity (`canSeeField`). */
  fieldSecrecy(entity: EntityId, field: string): Secrecy | null {
    const e = own(this.state.entities, entity);
    if (!e || visibilityOf(fieldDef(this.registry, this.world, e.kind, field)?.visibility) === "public") return null;
    return { known: this.knowers(entity, (who) => canSeeField(this.registry, this.world, this.state, who, entity, field)), kept: "everyone" };
  }

  /** A restricted lore entry's secrecy: a secret whose gate doesn't hold, read by its holders, or one read only by those who know what it links. */
  loreSecrecy(entry: LoreEntryDef): Secrecy | null {
    if (loreIsSecret(entry)) return this.gate()(entry) ? null : { known: this.knowers(null, (who) => loreHeldBy(this.world, entry, who)), kept: "everyone" };
    const v: unknown = entry.visibility;
    if (v === undefined || v === "public") return null;
    return { known: v === "known_by" ? this.knowers(null, (who) => loreReadable(this.registry, this.world, this.state, entry, NARRATOR_READS, false, this.gate(), who)) : [], kept: "everyone" };
  }

  /** `text` as this view gives it: under `everyone`, marked in the user's wording when `secrecy` makes it a secret; under `pov` and `gm`, as it is. */
  mark(text: string, secrecy: Secrecy | null): string {
    return this.knowledge === "everyone" && secrecy ? secretMarkText(text, secrecy.known, secrecy.kept, this.wording) : text;
  }

  /**
   * A user's entry text (World Info) as this view may have it (`applyMarks`): under `pov` as the
   * player character holds its marks, each mark it holds marked and every other left out; under
   * `everyone` and `gm` every mark marked.
   */
  entryText(text: string): string {
    return applyMarks(text, { world: this.world, state: this.state, wording: this.wording }, this.knowledge === "pov" ? `holder:${this.pov}` : "marked");
  }

  // ---------------------------------------------------------------- names and refs

  /** The name of an entity or place, as stored; the caller has checked the view may name it. */
  name(id: string): string {
    return labelOf(this.ctx, id);
  }

  /** The id this view gives a track: under `pov` the one Play knows it by (a secret track's stand-in, `shownTrackId`). */
  trackRef(id: TrackId): string {
    return this.knowledge === "pov" ? shownTrackId(this.world, id) : id;
  }

  /** An entity as this view names it, or null when it may not name it. */
  entity(id: EntityId): ViewRef | null {
    if (!this.seesEntity(id)) return null;
    const name = own(this.state.entities, id)?.name ?? id;
    if (this.knowledge !== "gm") return { id, name: this.mark(name, this.entitySecrecy(id)) };
    const visibility = isDiscoverable(this.world, this.state, id) ? "discoverable" : entityVisibility(this.world, this.state, id);
    return { id, name, ...(visibility !== "public" ? { visibility } : {}), ...(isGone(this.state, id) ? { visibility: "removed" } : {}) };
  }

  /** A place as this view names it, or null when it may not name it. */
  place(id: PlaceId): ViewRef | null {
    if (!this.seesPlace(id)) return null;
    const def = own(this.world.places, id);
    const name = def?.name ?? id;
    if (this.knowledge !== "gm") return { id, name: this.mark(name, this.placeSecrecy(id)) };
    const visibility = def?.visibility === "discoverable" ? "discoverable" : visibilityOf(def?.visibility);
    return { id, name, ...(visibility !== "public" ? { visibility } : {}) };
  }

  /** What this view calls a place it may not name: never its name. */
  get hiddenPlace(): string {
    return HIDDEN_PLACE_NAME;
  }

  /** A track as this view names it: under `pov` as the quest log has it (a secret one under its stand-in and, until something of it is revealed, a label that tells nothing); null when the view may not name it. */
  track(id: TrackId): ViewRef | null {
    const t = own(this.world.tracks, id);
    if (!t) return null;
    if (this.knowledge === "pov") {
      const shown = this.povTrack(id);
      return shown ? { id: shown.id, name: shown.label } : null;
    }
    if (this.knowledge === "everyone") return { id, name: this.mark(t.label, this.trackSecrecy(id)) };
    const visibility = visibilityOf(t.visibility);
    return { id, name: t.label, ...(visibility !== "public" ? { visibility } : {}) };
  }

  // ---------------------------------------------------------------- lore

  /** The world with the lore its World Info books hold now, read once for this view. */
  lore(): Promise<WorldDoc> {
    this.loreRead ??= this.readLore(this.world);
    return this.loreRead;
  }

  /**
   * A lore entry of `world` (the world as it reads lore, `lore()`) as this view gives it, its text
   * handed on through `entryText`: under `pov` only one the player character reads, under `everyone`
   * every one, a secret marked with who holds it, under `gm` every one with its secrecy spelled out.
   * An AI-written entry still waiting for review reaches no one but the GM.
   */
  loreEntry(entry: LoreEntryDef): ViewLore | null {
    const title = typeof entry.title === "string" && entry.title.trim() !== "" ? entry.title : entry.id;
    const text = this.entryText(typeof entry.content === "string" ? entry.content : "");
    const source = loreSourceOf(entry.source);
    if (this.knowledge === "gm") {
      const secrecy = this.loreSecrecy(entry);
      const visibility: unknown = entry.visibility;
      return { id: entry.id, title, text, ...(loreIsSecret(entry) ? { secret: true as const } : {}), ...(secrecy && secrecy.known.length > 0 ? { holders: [...secrecy.known] } : {}), ...(typeof visibility === "string" && visibility !== "public" ? { visibility } : {}), ...(source.kind === "ai" && source.status === "pending" ? { visibility: "pending review" } : {}) };
    }
    if (source.kind === "ai" && source.status === "pending") return null;
    if (this.knowledge === "pov") return this.povReadsLore(entry) ? { id: entry.id, title, text } : null;
    return { id: entry.id, title, text: this.mark(text, this.loreSecrecy(entry)) };
  }

  // ---------------------------------------------------------------- what the host keeps

  /** A workspace file's body by its blob hash, or null when there is none. */
  blob(hash: string): Promise<string | null> {
    return this.readBlob(hash);
  }

  /**
   * The entries of the World Info books the chat reads lore from (the world's list, the chat's books,
   * the global ones), as written, read once for this view; never one the engine wrote. Their text is
   * the user's: hand it on only through `entryText`.
   */
  bookEntries(): Promise<HostBookEntry[]> {
    this.booksRead ??= this.readBooks(this.world).then((entries) => entries.filter((e) => !engineWroteEntry(e.extensions)));
    return this.booksRead;
  }

  /** The chat's workspace files the agent's knowledge may read, with their provenance. */
  workspace(): Promise<WorkspaceFile[]> {
    return this.readWorkspace();
  }

  // ---------------------------------------------------------------- answers

  /** A tool's answer: a typed answer object as compact JSON, a part left `undefined` left out. */
  answer(value: object): ToolOutcome {
    return { text: JSON.stringify(value) };
  }

  /** A tool's refusal: one of the tool layer's notes (`TOOL_NOTE`), in the user's own words where they wrote them. */
  refuse(id: string, vars: Readonly<Record<string, string>> = {}): ToolOutcome {
    return { text: renderPrompt(id, this.texts, vars), error: true };
  }

  /** A registry text in the user's own words, filled: an argument's description, say. */
  text(id: string, vars: Readonly<Record<string, string>> = {}): string {
    return renderPrompt(id, this.texts, vars);
  }
}

/** A view over `input`, for a context that has the state in hand (a test, a turn's working state). */
export function readView(input: ReadViewInput): ToolReadView {
  return new ToolReadView(input);
}

/**
 * The reader outside a turn (C6): the chat's head as the GM view reads it (`renderState`, a planned
 * turn included), never through the ledger's queue; the user's settings for their texts, their mark
 * wording and the suspicion threshold; and the World Info books the chat reads lore from, read only
 * when a tool asks for lore.
 */
export function outsideReader(rt: Runtime, env: Pick<ToolEnv, "userId" | "chatId" | "knowledge">): ToolReader {
  return {
    registry: rt.registry,
    async view() {
      const core = await rt.ledger.core(env.chatId, env.userId);
      if (!core) throw new Error("this chat plays no LumiRPEngine world");
      const chain = toChain(await rt.host.chats.messages(env.chatId, env.userId));
      const head = core.renderState(chain);
      if (!head) throw new Error("this chat's world isn't loaded");
      const settings = await rt.settings.get(env.userId);
      return readView({
        knowledge: env.knowledge,
        registry: rt.registry,
        world: head.world,
        state: head.state,
        texts: settings.prompts.texts,
        wording: markWording(settings.prompts.texts),
        threshold: settings.minds.knowledge.threshold,
        minds: { enabled: settings.minds.enabled, memory: effectiveMemory(head.world, settings.minds), latest: latestTexts(chain) },
        lore: (world) => rt.readLore(env.chatId, env.userId, world),
        blob: (hash) => rt.blobs.get(env.userId, hash),
        books: async (world) => {
          const { read } = await loreBookIds(rt.host, world, env.chatId, env.userId);
          return (await Promise.all(read.map((book) => rt.host.books.entries(book, env.userId)))).flat();
        },
        workspace: () => listWorkspace(rt, env),
      });
    },
  };
}

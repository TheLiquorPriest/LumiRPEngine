// What the real run carries besides the chats' turns (STANDALONE-PLAN §15.3 item 6), and where each
// row of the plan's table now is in RPE (§15.2). The chats are carried into RPE's store by
// `import-chats.ts`; here the worlds, the connections, the settings and the user's own files, and of
// each chat the import carried, what today's build recorded beside its turns: the characters' mind
// files onto their records in the cast (`minds.ts`), the story record into RPE's story record and
// cast (`story-record.ts`). Before anything is written, `placesOf` says where the run will put each
// thing found, so that the report counts each where it really lands and the gate can refuse a run
// that has no place for something this build carries. A row this build has no place for yet
// (`NO_PLACE_YET`) is kept in the backup only.

import type { Database } from "bun:sqlite";
import { modelsPort } from "../app/connections";
import type { DataPaths } from "../app/config";
import { SecretsFile } from "../app/secrets";
import { dropLeftoverCast } from "../cast";
import type { Store, UserStore } from "../store";
import { dropLeftoverStory } from "../story";
import { bookTrouble, carryConnections, type ConnectionsCarried } from "./connections";
import { carriedAreas, TurnAreas } from "./history";
import { carryMinds, type MindsCarried } from "./minds";
import { carryOwnFiles, IMPORTED as IMPORTED_FOLDER, type OwnFilesCarried, PROMPT_SETS, type TreePlaces, VERSIONS } from "./own-files";
import { People } from "./people";
import type { Item, MigrationReport } from "./report";
import { NO_PLACE_YET, type RowId } from "./rows";
import { carrySettings, lumiahSettings, oneToolAtATime, type SettingsCarried } from "./settings";
import { carryStory, type StoryCarried } from "./story-record";
import type { Today } from "./today";
import { carryWorlds, type WorldsCarried } from "./worlds";

export interface CarryInput {
  today: Today;
  report: MigrationReport;
  paths: DataPaths;
  /** RPE's database, the migration's, the store's, the cast's and the story's tables up to date. */
  db: Database;
  /** RPE's store, and the user's in it, holding the chats this run imported. */
  store: Store;
  s: UserStore;
  /** This run's id. */
  run: string;
  /** When the run writes, in milliseconds. */
  now: number;
  /** Where the user's own files go in the file tree, as its layout names it; null: the run was not given it, and they stay in the backup. */
  tree: TreePlaces | null;
}

/** What the run carried besides the chats, counted: never a value of a key. */
export interface CarriedReport {
  worlds: WorldsCarried;
  settings: SettingsCarried;
  /** Null: the run took no runtime of today's build (none is this user's here), or it keeps no connections; `why`: its files can't be read, and nothing of them is carried. */
  connections: ConnectionsCarried | { why: string } | null;
  /** Null: the run was not given the file tree's places, and the user's own files are in the backup only. */
  ownFiles: OwnFilesCarried | null;
  /** The characters' mind files attached to their records in the cast, of the chats this run imported. */
  minds: MindsCarried;
  /** The story record carried into RPE's story record and cast, of the chats this run imported. */
  story: StoryCarried;
}

/** What the chats' import carried, and where it now is. */
const IMPORTED: Partial<Record<RowId, string>> = {
  "chat-run": "RPE's store: each chat with the world and revision it plays",
  ledger: "RPE's store: a turn tied to its message for every reply and swipe, its changes what today's fold applied there; each swipe's record as today's build kept it in the migration's imported_record, beside its turn, read-only",
  "pack-state": "RPE's store: the changes of each turn, folded by the same packs' handlers",
  "secret-holdings": "RPE's store: the knowledge events among each turn's changes, folded into the minds state as today",
  "chat-places": "RPE's store: the chat's own place and map events among each turn's changes",
  "story-record": "RPE's story record and cast, each on the turn whose record held it; each swipe's record also kept word for word beside its turn in the migration's imported_record, read-only",
  unplayed: "Inside each swipe's record, kept word for word beside its turn in the migration's imported_record, read-only",
  departures: "Inside each swipe's record, kept word for word beside its turn in the migration's imported_record, read-only",
};

/** Where a run puts a thing found that is carried or attached: into RPE; nowhere yet, its row having no place in this build; or nowhere, with why, though this build carries its row. */
export type Place = "lands" | "later" | { none: string };

/**
 * Where this run puts each thing that is carried or attached, decided before anything is written: a
 * row this build has no place for yet is `later`. Two rows can be without a place in a run: the
 * connections, where the book of the runtime the run took doesn't read; and the user's own files and
 * each chat's notes, where the run is not given the file tree's places (`tree`).
 */
export async function placesOf(today: Today, items: readonly Item[], tree: boolean): Promise<(item: Item) => Place> {
  // The runtime the run took (`runtime-folders.ts`): the one this user registered with this Lumiverse, its book theirs.
  const runtime = today.runtime.runtimes[0]?.name ?? null;
  const trouble = runtime === null ? null : await bookTrouble(runtime, today.runtime.files);
  return (item) => {
    if (item.row === "connections") return trouble === null ? "lands" : { none: `the runtime ${runtime}: ${trouble}` };
    if ((item.row === "learned-and-home" || item.row === "author-notes" || item.row === "texts") && !tree) return { none: "this run was not given the file tree's places" };
    return item.row !== null && Object.hasOwn(NO_PLACE_YET, item.row) ? "later" : "lands";
  };
}

/**
 * Carries the worlds, the connections, the settings and the user's own files into RPE's data folder,
 * and of each chat the import carried, the mind files and the story record onto the records they
 * belong to; and says where each row now lands.
 */
export async function carry(input: CarryInput): Promise<{ landed: Partial<Record<RowId, string>>; carried: CarriedReport }> {
  const { today, report, paths, db, store, s, run, now, tree } = input;
  const user = today.sources.userId;
  const worlds = await carryWorlds(db, user, today.user, report.items, run);

  // The connections of the runtime the run took, the user's, through the models port the app gives RPH.
  const runtime = today.runtime.runtimes[0]?.name ?? null;
  const serial = oneToolAtATime(await lumiahSettings(today));
  const connections = runtime === null ? null : await carryConnections(modelsPort(paths, new SecretsFile(paths.secrets)), runtime, today.runtime.files, serial);
  const settings = await carrySettings(today, report.items, paths.globalConfig);
  // Each chat's area as each turn left it, read once for its notes and its characters' mind files.
  const areas = carriedAreas(report.items);
  const turnAreas = new TurnAreas(today, db, s, areas);
  const ownFiles = tree === null ? null : await carryOwnFiles(today, report.items, tree, { db, s, areas: turnAreas });

  // Each chat the import carried: the earlier import's rows on the turns it replaced or removed go with those turns, as the cast's and the story's clean-up has it; then what today's build recorded beside each turn.
  const chats = (report.imports ?? []).filter((c) => c.outcome === "imported" || c.outcome === "replaced").map((c) => c.chatId);
  db.transaction(() => {
    dropLeftoverStory(store, s.id);
    dropLeftoverCast(store, s.id);
  })();
  const people = new People(db, s, now);
  const minds = await carryMinds({ today, db, s, chats, areas: turnAreas, people, carried: areas, now });
  const story = db.transaction(() => carryStory({ db, store, s, chats, people, now }))();

  const landed: Partial<Record<RowId, string>> = {
    ...IMPORTED,
    worlds: `RPE's database (world_file): ${worlds.worlds} world(s) with ${worlds.revisions} revision(s), ${worlds.drafts} draft(s) and ${worlds.histories} history file(s), byte for byte, each with its checksum`,
    "world-contents": "Inside the world documents, as they were: RPE reads them with today's world store, so each world holds what it held",
    pins: "Inside the world documents they pin, carried with them",
    settings: `RPE-global.yml: ${settings.carried.length} setting(s) carried; ${settings.noHome.length} with no setting of the same meaning in RPE yet, listed by name`,
    "model-choices": `Listed for you: ${settings.lumiverseConnections.length} setting(s) name a connection that lives in Lumiverse, which RPE can't use; that work uses RPE's default connection until you pick one of RPE's`,
    "runtime-settings": "Listed by name: RPE's config has no setting for the runtime's tuning, memory limit or update choice yet",
    "mind-files": `On each character's record in the cast, word for word, per turn, marked imported and not yet filed (the cast's mind part): ${minds.versions} version(s) of ${minds.characters.reduce((n, c) => n + c.files.length, 0)} file(s) of ${minds.characters.length} character(s)${minds.untied > 0 ? `; ${minds.untied} version(s) in areas no imported turn names (before any turn, or a generation that left no reply) are in the backup only` : ""}`,
    "story-record": `${IMPORTED["story-record"]}: ${story.beats} beat(s), ${story.struck} struck, ${story.futures} draft(s) as proposed futures, ${story.castings} casting(s) in the cast${story.pinned > 0 ? `, ${story.pinned} pinned as the player pinned them` : ""}${story.leftOut > 0 ? `; ${story.leftOut} damaged entr(ies) today's reader leaves out are in imported_record only` : ""}`,
  };
  if (connections !== null && !("why" in connections)) landed.connections = `RPH's two documents, through the models port: ${connections.connections.length} connection(s) in RPE-global.yml's models; ${connections.keys} key(s), ${connections.signins} sign-in(s) and ${connections.headerValues} header value(s) in the secrets file and nowhere else`;
  if (tree !== null && ownFiles !== null) {
    const at = `The user's level of the file tree, under ${IMPORTED_FOLDER}/, switched off`;
    const inChat = `that chat's own notes folder, under ${tree.notes}/${IMPORTED_FOLDER}/, which no other chat's agents read`;
    const alone = ownFiles.leftAlone > 0 ? `; ${ownFiles.leftAlone} chat(s) played on RPE keep the notes they have` : "";
    landed["own-agents"] = `${at}: ${ownFiles.agents} agent(s) in ${tree.agents}/ and ${ownFiles.skills} skill(s) in ${tree.skills}/, each in the new header format with the original beside it`;
    landed.texts = `${at}: ${ownFiles.texts} edited text(s) in ${tree.prompts}/, each named for what it was; ${ownFiles.promptSets} prompt set(s) today's turns recorded, word for word, in ${PROMPT_SETS}/, each named by the hash the turns' records give it`;
    landed.guidance = `${at}: GUIDANCE.md (${ownFiles.guidance})`;
    landed["author-notes"] = `Each chat's area at its latest turn, in ${inChat} (${ownFiles.notes} file(s)); every version before it, by the turn that wrote it, under ${VERSIONS}/ there (${ownFiles.versions} file(s))${alone}`;
    landed["learned-and-home"] = `${at}: your ~/ files in home/ (${ownFiles.home} file(s)); each chat's learned/ in ${inChat}, as learned/ (${ownFiles.learned} file(s))${alone}`;
  }
  return { landed, carried: { worlds, settings, connections, ownFiles, minds, story } };
}

// What the real run carries besides the chats (STANDALONE-PLAN §15.3 item 6), and where each row of
// the plan's table now is in RPE (§15.2). The chats are carried into RPE's store by
// `import-chats.ts`; the worlds, the connections, the settings and the user's own files here. Before
// anything is written, `placesOf` says where the run will put each thing found, so that the report
// counts each where it really lands and the gate can refuse a run that has no place for something
// this build carries. A row this build has no place for yet (`NO_PLACE_YET`) is kept in the backup
// only.

import type { Database } from "bun:sqlite";
import { modelsPort } from "../app/connections";
import type { DataPaths } from "../app/config";
import { SecretsFile } from "../app/secrets";
import { bookTrouble, carryConnections, type ConnectionsCarried } from "./connections";
import { carryOwnFiles, IMPORTED as IMPORTED_FOLDER, latestAreas, type OwnFilesCarried, type TreePlaces } from "./own-files";
import type { Item, MigrationReport } from "./report";
import { NO_PLACE_YET, type RowId } from "./rows";
import { carrySettings, lumiahSettings, oneToolAtATime, type SettingsCarried } from "./settings";
import type { Today } from "./today";
import { carryWorlds, type WorldsCarried } from "./worlds";

export interface CarryInput {
  today: Today;
  report: MigrationReport;
  paths: DataPaths;
  /** RPE's database, its migration area's tables up to date. */
  db: Database;
  /** This run's id. */
  run: string;
  /** Where the user's own files go in the file tree, as its layout names it; null: the run was not given it, and they stay in the backup. */
  tree: TreePlaces | null;
}

/** What the run carried besides the chats, counted: never a value of a key. */
export interface CarriedReport {
  worlds: WorldsCarried;
  settings: SettingsCarried;
  /** Null: no runtime of this extension signs in as the user, or it keeps no connections; `why`: its files can't be read, and nothing of them is carried. */
  connections: ConnectionsCarried | { why: string } | null;
  /** Null: the run was not given the file tree's places, and the user's own files are in the backup only. */
  ownFiles: OwnFilesCarried | null;
}

/** What the chats' import carried, and where it now is. */
const IMPORTED: Partial<Record<RowId, string>> = {
  "chat-run": "RPE's store: each chat with the world and revision it plays",
  ledger: "RPE's store: a turn tied to its message for every reply and swipe, its changes what today's fold applied there; each swipe's record as today's build kept it in the migration's imported_record, beside its turn, read-only",
  "pack-state": "RPE's store: the changes of each turn, folded by the same packs' handlers",
  "secret-holdings": "RPE's store: the knowledge events among each turn's changes, folded into the minds state as today",
  "chat-places": "RPE's store: the chat's own place and map events among each turn's changes",
  "story-record": "Inside each swipe's record, kept word for word beside its turn in the migration's imported_record, read-only; RPE's story record is not made from them yet",
  unplayed: "Inside each swipe's record, kept word for word beside its turn in the migration's imported_record, read-only",
  departures: "Inside each swipe's record, kept word for word beside its turn in the migration's imported_record, read-only",
};

/** The runtime that signs in to Lumiverse as the user: its connections and keys are the user's. */
function userRuntime(today: Today): string | null {
  return today.runtime.runtimes.find((r) => r.config.session.username === today.username)?.name ?? null;
}

/** Where a run puts a thing found that is carried or attached: into RPE; nowhere yet, its row having no place in this build; or nowhere, with why, though this build carries its row. */
export type Place = "lands" | "later" | { none: string };

/**
 * Where this run puts each thing that is carried or attached, decided before anything is written. A
 * row this build has no place for yet is `later`, but for each chat's area at its latest turn, which
 * lands as notes. Two rows can be without a place in a run: the connections, where they are not the
 * book of the runtime that signs in as the user, or that book doesn't read; and the user's own files,
 * where the run is not given the file tree's places (`tree`).
 */
export async function placesOf(today: Today, items: readonly Item[], tree: boolean): Promise<(item: Item) => Place> {
  const runtime = userRuntime(today);
  const trouble = runtime === null ? null : await bookTrouble(runtime, today.runtime.files);
  const latest = new Set((await latestAreas(today, items)).values());
  return (item) => {
    if (item.row === "connections") {
      const of = /^runtimes\/([^/]+)\//.exec(item.path)?.[1] ?? "";
      if (of !== runtime) return { none: `the runtime ${of} is not known to sign in to Lumiverse as this user, so its connections and keys are not theirs` };
      return trouble === null ? "lands" : { none: `the runtime ${of}: ${trouble}` };
    }
    if ((item.row === "learned-and-home" || item.row === "author-notes") && !tree) return { none: "this run was not given the file tree's places" };
    if (item.row === "author-notes" && latest.has(item.path)) return "lands";
    return item.row !== null && Object.hasOwn(NO_PLACE_YET, item.row) ? "later" : "lands";
  };
}

/** Carries the worlds, the connections, the settings and the user's own files into RPE's data folder, and says where each row now lands. */
export async function carry(input: CarryInput): Promise<{ landed: Partial<Record<RowId, string>>; carried: CarriedReport }> {
  const { today, report, paths, db, run, tree } = input;
  const user = today.sources.userId;
  const worlds = await carryWorlds(db, user, today.user, report.items, run);

  // The connections of the runtime that signs in to Lumiverse as this user, through the models port the app gives RPH.
  const runtime = userRuntime(today);
  const serial = oneToolAtATime(await lumiahSettings(today));
  const connections = runtime === null ? null : await carryConnections(modelsPort(paths, new SecretsFile(paths.secrets)), runtime, today.runtime.files, serial);
  const settings = await carrySettings(today, report.items, paths.globalConfig);
  const ownFiles = tree === null ? null : await carryOwnFiles(today, report.items, tree);

  const landed: Partial<Record<RowId, string>> = {
    ...IMPORTED,
    worlds: `RPE's database (world_file): ${worlds.worlds} world(s) with ${worlds.revisions} revision(s), ${worlds.drafts} draft(s) and ${worlds.histories} history file(s), byte for byte, each with its checksum`,
    "world-contents": "Inside the world documents, as they were: RPE reads them with today's world store, so each world holds what it held",
    pins: "Inside the world documents they pin, carried with them",
    settings: `RPE-global.yml: ${settings.carried.length} setting(s) carried; ${settings.noHome.length} with no setting of the same meaning in RPE yet, listed by name`,
    "model-choices": `Listed for you: ${settings.lumiverseConnections.length} setting(s) name a connection that lives in Lumiverse, which RPE can't use; that work uses RPE's default connection until you pick one of RPE's`,
    "runtime-settings": "Listed by name: RPE's config has no setting for the runtime's tuning, memory limit or update choice yet",
  };
  if (connections !== null && !("why" in connections)) landed.connections = `RPH's two documents, through the models port: ${connections.connections.length} connection(s) in RPE-global.yml's models; ${connections.keys} key(s), ${connections.signins} sign-in(s) and ${connections.headerValues} header value(s) in the secrets file and nowhere else`;
  if (tree !== null && ownFiles !== null) {
    const at = `The user's level of the file tree, under ${IMPORTED_FOLDER}/, switched off`;
    const inChat = `that chat's own notes folder, under ${tree.notes}/${IMPORTED_FOLDER}/, which no other chat's agents read`;
    const alone = ownFiles.leftAlone > 0 ? `; ${ownFiles.leftAlone} chat(s) played on RPE keep the notes they have` : "";
    landed["own-agents"] = `${at}: ${ownFiles.agents} agent(s) in ${tree.agents}/ and ${ownFiles.skills} skill(s) in ${tree.skills}/, each in the new header format with the original beside it`;
    landed.texts = `${at}: ${ownFiles.texts} edited text(s) in ${tree.prompts}/, each named for what it was; the prompt sets turns recorded are in the backup only`;
    landed.guidance = `${at}: GUIDANCE.md (${ownFiles.guidance})`;
    landed["author-notes"] = `Each chat's area at its latest turn, in ${inChat} (${ownFiles.notes} file(s)); earlier turns' versions are in the backup only${alone}`;
    landed["learned-and-home"] = `${at}: your ~/ files in home/ (${ownFiles.home} file(s)); each chat's learned/ in ${inChat}, as learned/ (${ownFiles.learned} file(s))${alone}`;
  }
  return { landed, carried: { worlds, settings, connections, ownFiles } };
}

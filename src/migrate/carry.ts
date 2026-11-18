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
import { attachTexts } from "./old-records";
import { join } from "node:path";
import { modelsPort } from "../app/connections";
import type { Setting } from "../app/setting-list";
import { type DataPaths, SHIPPED_FOLDER } from "../app/config";
import { SecretsFile } from "../app/secrets";
import type { Store, UserStore } from "../store";
import { carryChatSettings, type ChatSettingsCarried } from "./chat-settings";
import { bookTrouble, carryConnections, type ConnectionsCarried } from "./connections";
import { TurnAreas } from "./history";
import { carryMinds, type MindsCarried } from "./minds";
import { carryOwnFiles, IMPORTED as IMPORTED_FOLDER, IMPORTED_AGENTS, IMPORTED_SKILLS, LUMIAH_TEXTS, type OwnFilesCarried, PROMPT_SETS, SET_APART, type TreePlaces } from "./own-files";
import { carryPins, type PinsCarried } from "./pins";
import { People } from "./people";
import { apartText, type ChatFate, type Item, type MigrationReport } from "./report";
import { NO_PLACE_YET, type RowId } from "./rows";
import { carrySettings, lumiahSettings, oneToolAtATime, type SettingsCarried } from "./settings";
import { connectionsOf, findChoices, type ModelChoice, matcherOf } from "./model-choices";
import { carryStory, type StoryCarried } from "./story-record";
import { keepPutPrints, putPrints } from "./tables";
import type { Today } from "./today";
import { carryWorlds, type WorldsCarried } from "./worlds";
import { carryTurnThings, type TurnThingsCarried } from "./turn-things";
import { carryJobs, type JobsCarried, type KeepCarriedJob } from "./history-things";
import { type BuildCarried, carryBuildThings } from "./build-things";

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
  /** Every setting RPE's areas and RPH declare, which takes each value a run carries as its own reader takes it (`carrySettings`); absent: RPH's and the update's only. */
  settings?: readonly Setting[];
  /** The ids of the world revisions the chats this run imports play: a world today's side has deleted is kept while one of its revisions is among them. */
  plays?: ReadonlySet<string>;
  /** The turn lane's writer of a carried job, which the migration may not import (`carryJob`); absent: his jobs stay in the backup only. */
  keepJob?: KeepCarriedJob;
}

/** What the run carried besides the chats, counted: never a value of a key. */
export interface CarriedReport {
  worlds: WorldsCarried;
  settings: SettingsCarried;
  /** Every place today's settings and agents of his own name a connection, each with the connection of RPE's it is carried to and how it was found, or why none. */
  modelChoices: ModelChoice[];
  /** Null: the run took no runtime of today's build (none is this user's here), or it keeps no connections; `why`: its files can't be read, and nothing of them is carried. */
  connections: ConnectionsCarried | { why: string } | null;
  /** Null: the run was not given the file tree's places, and the user's own files are in the backup only. */
  ownFiles: OwnFilesCarried | null;
  /** The pins written for the files pinned in today's build; null where no file tree was given. */
  pins: PinsCarried | null;
  /** The characters' mind files attached to their records in the cast, of the chats this run imported. */
  minds: MindsCarried;
  /** The story record carried into RPE's story record and cast, of the chats this run imported. */
  story: StoryCarried;
  /** What he asked through a panel, his stored chips and review cards, his staged change and the tools he approved, in the turn lane's tables. */
  turnThings: TurnThingsCarried & { jobs: JobsCarried };
  /** Each chat's own choices put into its `RPE.yml`; null where no file tree was given. */
  chatSettings: ChatSettingsCarried | null;
  /** Build's jobs and their proposals, and the secrecy page's undo copies, in Build's tables. */
  build: BuildCarried;
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
export async function placesOf(today: Today, items: readonly Item[], tree: boolean, lane = false): Promise<(item: Item) => Place> {
  // The runtime the run took (`runtime-folders.ts`): the one this user registered with this Lumiverse, its book theirs.
  const runtime = today.runtime.runtimes[0]?.name ?? null;
  const trouble = runtime === null ? null : await bookTrouble(runtime, today.runtime.files);
  return (item) => {
    if (item.row === "connections") return trouble === null ? "lands" : { none: `the runtime ${runtime}: ${trouble}` };
    if ((item.row === "learned-and-home" || item.row === "author-notes" || item.row === "texts") && !tree) return { none: "this run was not given the file tree's places" };
    // What the turn lane's tables hold (his panel requests, chips, staged change, approvals, and his jobs through its writer of a carried job) lands where the run is given the lane (`lane`); without it, it waits in the backup.
    if (item.row === "panel-requests" || item.row === "chips-staged" || item.row === "approvals-jobs") return lane ? "lands" : "later";
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
  const worlds = await carryWorlds(db, user, today.user, report.items, run, input.plays);

  // The connections of the runtime the run took, the user's, through the models port the app gives RPH, into his own documents (he is the install's user: the run refuses another's); each, the default and each setting replaced only where RPE's copy is still what a run put there.
  const earlier = putPrints(db, user);
  const runtime = today.runtime.runtimes[0]?.name ?? null;
  const serial = oneToolAtATime(await lumiahSettings(today));
  const port = modelsPort(paths, new SecretsFile(paths.secrets), () => user);
  const carriedConnections = runtime === null ? null : await carryConnections(port, user, runtime, today.runtime.files, serial, earlier);
  const connections = carriedConnections === null || "why" in carriedConnections ? carriedConnections : carriedConnections.carried;
  if (carriedConnections !== null && !("why" in carriedConnections)) keepPutPrints(db, user, carriedConnections.put, carriedConnections.drop);
  // Each place today's settings and definitions name a connection, matched with the connections RPE now holds (the runtime's carried under their own ids) or, for one of Lumiverse's, with RPE's of the same provider and model; those with none are listed for him to pick.
  const matcher = matcherOf(today.db.connectionProfiles(), connectionsOf(await port.loadConnections({ user })));
  const carriedSettings = await carrySettings(today, report.items, paths.globalConfig, earlier, input.settings, (id) => matcher({ where: id, connection: id, model: null, to: null }).carried?.id ?? null);
  keepPutPrints(db, user, carriedSettings.put, carriedSettings.drop);
  const readJson = async (path: string): Promise<unknown> => {
    try {
      return JSON.parse((await today.userView.read(path)) ?? "null") as unknown;
    } catch {
      return null;
    }
  };
  const choices = findChoices(await readJson("settings.json"), await readJson("harness/settings.json")).map(matcher);
  const listed = choices.filter((c) => c.carried === null);
  const settings = { ...carriedSettings.carried, lumiverseConnections: listed.map((c) => ({ setting: c.where, connection: c.connection })) };
  // Each chat the import carried; and each chat's area as each turn left it, read once for its notes and its characters' mind files.
  const chats = (report.imports ?? []).filter((c) => c.outcome === "imported" || c.outcome === "replaced").map((c) => c.chatId);
  const turnAreas = new TurnAreas(today, db, s, report.items);
  const ownFiles = tree === null ? null : await carryOwnFiles(today, report.items, tree, { db, s, areas: turnAreas, carried: new Set(chats) }, matcher);
  // The files pinned in today's build as pins, each for the agent that is handed it (R-174).
  const pinned = tree === null || ownFiles === null ? null : await carryPins({ wanted: ownFiles.pins, globalConfig: paths.globalConfig, shipped: join(paths.files, SHIPPED_FOLDER, tree.agents), own: new Set(ownFiles.agentIds), earlier });
  if (pinned !== null) keepPutPrints(db, user, pinned.put);
  // A chat's config is a path in the file tree, which names the chat and its character: the report holds no such name, and the pins are written now (the report keeps each pin's file and role, `pins`).
  if (ownFiles !== null) ownFiles.pins = [];
  // Each chat's own choices into its `RPE.yml`, where its setting stands over the user's.
  const chatSettings = tree === null ? null : await carryChatSettings({ today, chats, places: tree, globalConfig: paths.globalConfig, earlier, ...(input.settings ? { registry: input.settings } : {}) });
  if (chatSettings !== null) keepPutPrints(db, user, chatSettings.put, chatSettings.drop);

  // The earlier import's changes on the turns it replaced or removed (the cast's and the story's among them) went with those turns; what today's build recorded beside each turn is carried next.
  const people = new People(db, store, s, now);
  // What came of each chat this run did not import, for what of it the run did not carry: its outcome, and whether an earlier run's import of it stands.
  const fate = (chat: string): ChatFate => {
    const c = report.imports?.find((i) => i.chatId === chat);
    const why = c !== undefined ? `${c.outcome}${c.why ? `: ${c.why}` : ""}` : today.chats.some((row) => row.id === chat) ? "not read: today's build plays no world in it" : "gone from Lumiverse";
    return { why, kept: s.chat(chat) !== null };
  };
  const minds = await carryMinds({ db, store, s, chats, areas: turnAreas, people, now, fate });
  const story = db.transaction(() => carryStory({ db, store, s, chats, people, now, inside: new Map(report.chats.map((c) => [c.chatId, c.story])), fate, earlier }))();
  keepPutPrints(db, user, story.put);
  // What the old engines recorded on each carried reply, with every text it names, word for word beside its turn (read after the minds and the story took the records as they were).
  const old = await attachTexts(today, db, user, chats);
  const turnThings = await carryTurnThings({ today, db, s, chats, now });
  const jobs = await carryJobs({ today, items: report.items, db, s, user, chats: new Set(chats), keep: input.keepJob });
  // Build's jobs with their proposals to review, and the secrecy page's undo copies, where Build keeps them.
  const build = await carryBuildThings({ today, report, db, user, earlier });
  keepPutPrints(db, user, build.put);
  const [mindsFound, storyFound] = (["mind-files", "story-record"] as const).map((row) => report.rows.find((r) => r.row === row)?.inside?.count ?? 0);
  const files = new Set(minds.characters.flatMap((c) => c.files.map((f) => `${c.character}\u0000${f}`))).size;
  const characters = new Set(minds.characters.map((c) => c.character)).size;

  const landed: Partial<Record<RowId, string>> = {
    ...IMPORTED,
    worlds: `RPE's database (world_file): ${worlds.worlds} world(s) with ${worlds.revisions} revision(s), ${worlds.drafts} draft(s) and ${worlds.histories} history file(s), byte for byte, each with its checksum`,
    "world-contents": "Inside the world documents, as they were: RPE reads them with today's world store, so each world holds what it held",
    pins: "Inside the world documents they pin, carried with them",
    settings: `RPE-global.yml: ${settings.carried.length} setting(s) carried; ${(settings.notCarried ?? []).length > 0 ? `${(settings.notCarried ?? []).length} not carried, as RPE's like setting means something else or takes no such value; ` : ""}${(settings.archived ?? []).length > 0 ? `${(settings.archived ?? []).length} archived in the backup, as they steered only an old engine, each named with why; ` : ""}${settings.noHome.length} with no setting of the same meaning in RPE, listed by name`,
    "model-choices": `${choices.length} place(s) name a connection: ${choices.length - listed.length} carried to a connection RPE holds (the same id, or the same provider, model and address), ${listed.length} listed for you to pick a connection of RPE's, that work using RPE's default connection until you do`,
    "runtime-settings": "RPE-global.yml: the runtime's memory limit as service.memory, and each field of its tuning as the setting of the same meaning (the door's, the calls', the update's and the service's), a time in milliseconds as seconds; those with none are named, and the old link's are archived; its update choice is update.restart",
    "chat-switch": "On each chat's own record in RPE: its seed, when it started, whether the engine was switched on for it, and the engine that played it",
    loopback: "At the swap (rpe up): the hash of its key among RPE's provider keys, RPE answering at today's address under today's model name; the connection in Lumiverse is left as it is",
    sessions: `In the migration's imported_record, beside each carried turn and read-only, with the words of every text its record names word for word: ${old.texts} text(s) on ${old.turns} turn(s)${old.missing.length > 0 ? `; ${old.missing.length} text(s) today's clean-up had removed are listed by path as not read` : ""}`,
    // What this run carried, against what the rehearsal found, and where the rest is: each part named.
    "mind-files": [
      `On each character's record in the cast, word for word, per turn, marked imported and not yet filed (the cast's mind part): ${minds.versions} version(s) of ${files} file(s) of ${characters} character(s), ${minds.versions - minds.unlisted} of the ${mindsFound} found in today's areas${minds.unlisted > 0 ? ` and ${minds.unlisted} read from the area a turn's record names, which no area document of its chat holds` : ""}`,
      ...(minds.untied > 0 ? [`${minds.untied} version(s) in areas no imported turn ended with (before any turn, a generation that left no reply, or a reply's that a Continue then changed) are in the backup only`] : []),
      ...(minds.shared > 0 ? [`${minds.shared} version(s) in a branch's own areas, the same as the chat it was made from holds, are on the records of the turns the two share`] : []),
      ...(minds.gone > 0 ? [`${minds.gone} version(s) whose text today's clean-up had removed are listed as not read`] : []),
      ...apartText(minds.apart, "version(s)"),
    ].join("; "),
    "story-record": [
      `${IMPORTED["story-record"]}: ${story.beats} beat(s), ${story.struck} struck, ${story.futures} draft(s) as proposed futures, ${story.castings} casting(s) in the cast${story.pinned > 0 ? `, ${story.pinned} pinned as the player pinned them` : ""}, ${story.beats + story.struck + story.futures + story.castings} of the ${storyFound} entr(ies) found in today's records`,
      ...(story.perceptions + story.takenIn + story.exposureLeft + story.digestedUnknown > 0 ? [`${story.perceptions} perception(s) in the cast for whom each beat reached, as its exposure says, and ${story.takenIn} of them marked taken in, for the principals whose mind had taken the beats in (so only later beats reach them as not yet taken in)${story.exposureLeft > 0 ? `; ${story.exposureLeft} exposure(s) naming the world itself or no point of view are in imported_record only` : ""}${story.digestedUnknown > 0 ? `; ${story.digestedUnknown} casting(s) name a beat no carried record holds as the last their mind took in, and mark none` : ""}`] : []),
      ...(story.pinsKept.length > 0 ? [`${story.pinsKept.length} casting pin(s) you set or took away in RPE since a run put the one it left stand as you set them: ${story.pinsKept.map((p) => `${p.character} in ${p.chat} (${p.standing ?? "none"})`).join(", ")}`] : []),
      ...(story.leftOut > 0 ? [`${story.leftOut} damaged entr(ies) today's reader leaves out are in imported_record only`] : []),
      ...(story.shared > 0 ? [`${story.shared} entr(ies) in the records a branch copied from the chat it was made from are carried once, with the turns the two share`] : []),
      ...(story.unheld > 0 ? [`${story.unheld} entr(ies) on records no imported turn holds are in the backup only`] : []),
      ...apartText(story.apart, "entr(ies)"),
    ].join("; "),
    // What today's build kept beside a reply that belongs to its turn, in the turn lane's tables.
    "panel-requests": turnThings.tables ? `The turn lane's request table: ${turnThings.requests} request(s) of the ${report.rows.find((r) => r.row === "panel-requests")?.count.found ?? 0} found, each on the turn that answered it, as the request he made${turnThings.requestsUnplaced.length > 0 ? `; ${turnThings.requestsUnplaced.length} on a message whose reply has no turn here are in the backup only` : ""}` : "This run was not given the turn lane's tables: in the backup only",
    "chips-staged": turnThings.tables ? `The turn lane's chip table: ${turnThings.chips} stored chip(s) and review card(s), each on its turn as today's build kept it, its items and statuses with it${turnThings.chipsLoose > 0 ? ` (${turnThings.chipsLoose} on no turn, their message having none)` : ""}; ${turnThings.staged} change(s) staged for his next message waiting as held requests that go with it` : "This run was not given the turn lane's tables: in the backup only",
    "approvals-jobs": turnThings.tables ? `Approvals: the turn lane's chip table, ${turnThings.approvals} tool(s) he approved for a chat, each on the turn running then, as history. Jobs: ${jobs.written ? `${jobs.carried} in the job history marked carried, with task, report and transcript, ${jobs.onTurn} of them on the turn that started them${jobs.unfinished > 0 ? `, ${jobs.unfinished} that had not finished as cancelled` : ""}${jobs.left > 0 ? `; ${jobs.left} of chats not carried or no job in the backup only` : ""}` : "in the backup only: this run was not given the turn lane's writer of a carried job"}` : "This run was not given the turn lane's tables: in the backup only",
    "build-jobs": `Build's own tables: ${build.carried.jobs} job(s) ended with what they had, their proposals still to review${build.carried.interrupted > 0 ? ` (${build.carried.interrupted} cut off while running, as interrupted)` : ""}, and ${build.carried.secrecy} secrecy undo cop(ies) as their books', so Restore still puts a book back${build.carried.keptInRpe > 0 ? `; ${build.carried.keptInRpe} you changed or removed in RPE since a run put them stand as you left them` : ""}${build.carried.unreadable > 0 ? `; ${build.carried.unreadable} file(s) that do not read are listed under what could not be read and archived` : ""}; ${build.carried.loreIds} id(s) of today's lore index kept for the entries they name, so an id one of your notes or mind files names still reaches its entry${build.carried.loreIdsKnown > 0 ? ` (${build.carried.loreIdsKnown} already kept by an earlier run)` : ""}${build.carried.loreIdsLeftOut > 0 ? `; ${build.carried.loreIdsLeftOut} pair(s) of the file that are no id of an entry stay in the backup` : ""}`,
  };
  if (connections !== null && !("why" in connections)) landed.connections = `RPH's two documents, through the models port: ${connections.connections.length} connection(s) in RPE-global.yml's models; ${connections.keys} key(s), ${connections.signins} sign-in(s) and ${connections.headerValues} header value(s) in the secrets file and nowhere else`;
  if (tree !== null && ownFiles !== null) {
    const at = `The user's level of the file tree, under ${IMPORTED_FOLDER}/, switched off`;
    const inChat = `that chat's own notes folder, ${tree.notes}/`;
    const alone = `${ownFiles.leftAlone > 0 ? `; ${ownFiles.leftAlone} chat(s) played on RPE keep the notes they have` : ""}${ownFiles.kept > 0 ? `; ${ownFiles.kept} chat(s) this run did not import keep the notes an earlier run wrote` : ""}${ownFiles.heldAsHis > 0 ? `; ${ownFiles.heldAsHis} file(s) RPE already holds as something else (made or changed there since) were left as they are` : ""}`;
    landed["own-agents"] = `${at}: ${ownFiles.agents} agent(s) in ${IMPORTED_AGENTS}/ and ${ownFiles.skills} skill(s) in ${IMPORTED_SKILLS}/, each in the new header format with the model it is carried to, its effort, tools, limits and what it is given, and the original beside it${ownFiles.toolsChecked ? (ownFiles.deadTools.length > 0 ? `; ${ownFiles.deadTools.length} tool name(s) that no longer exist are left out of the headers and listed` : "; every tool name still exists") : "; the tool names were not checked, the run not being given them"}`;
    landed.texts = `${at}: ${ownFiles.texts - ownFiles.textsLumiah - ownFiles.textsSetApart.length} edited text(s) of the engine's in ${tree.prompts}/, each named for what it was${ownFiles.textsSetApart.length > 0 ? `; ${ownFiles.textsSetApart.length} set apart in ${tree.prompts}/${SET_APART}/ under the reason, as today's build would not send them or had no text of that id` : ""}${ownFiles.textsShipped.length > 0 ? `; ${ownFiles.textsShipped.length} word for word the shipped text, not his edit, kept in the backup and listed` : ""}${ownFiles.textsLumiah > 0 ? `; ${ownFiles.textsLumiah} of LumiAH's in ${tree.prompts}/${LUMIAH_TEXTS}/` : ""}${ownFiles.textsNotText.length > 0 ? `; ${ownFiles.textsNotText.length} that are no text, in the backup only` : ""}; ${ownFiles.promptSets} prompt set(s) today's turns recorded, word for word, in ${PROMPT_SETS}/, each named by the hash the turns' records give it`;
    landed.guidance = `${at}: GUIDANCE.md (${ownFiles.guidance})`;
    landed["author-notes"] = `Each chat's notes as the reply it shows left them, in ${inChat} (${ownFiles.notes} file(s)); every change a turn made to them is recorded on that turn in RPE's own history of notes (${ownFiles.versions} version(s), ${ownFiles.removals} of them a note removed), so showing an earlier reply puts its notes back${ownFiles.untied > 0 ? `; ${ownFiles.untied} area(s) no imported turn ended with are in the backup only` : ""}${alone}`;
    landed["learned-and-home"] = `Your ~/ files in the global notes folder, ${tree.notes}/ at the user's level, which every chat's agents read and none writes (${ownFiles.home} file(s)); each chat's learned/ in ${inChat}, as learned/ (${ownFiles.learned} file(s))${ownFiles.oldLayout > 0 ? `; ${ownFiles.oldLayout} file(s) an earlier build's run left under ${IMPORTED_FOLDER}/chats/ at the user's level were taken out` : ""}${alone}`;
    landed["agents-workspace"] = `As notes: the agents engine's chat workspace in ${inChat} (${ownFiles.workspace} file(s)), each turn's writes and removals among its versions, and its global workspace in the global notes folder (${ownFiles.global} file(s))${alone}`;
    if (pinned !== null) landed.pins = `${landed.pins ?? "Inside the world documents they pin, carried with them"}; and the files pinned in today's build as pins in \`stack.pins\` of the level's config, each for the agent it is handed to at the start of each run: ${pinned.carried.carried} written${pinned.carried.removed > 0 ? `, ${pinned.carried.removed} taken out that today's side no longer pins` : ""}${pinned.carried.takenOut > 0 ? `, ${pinned.carried.takenOut} not put again, taken out in RPE` : ""}${pinned.carried.forAuthor.length > 0 ? `; ${pinned.carried.forAuthor.length} pinned for the Author, the role they were for having no agent in RPE` : ""}${pinned.carried.forOwn.length > 0 ? `; ${pinned.carried.forOwn.length} for his own definitions, which are carried switched off` : ""}`;
  }
  return { landed, carried: { worlds, settings, modelChoices: choices, connections, ownFiles, pins: pinned?.carried ?? null, minds, story, turnThings: { ...turnThings, jobs }, chatSettings: chatSettings?.carried ?? null, build: build.carried } };
}

// RPE's agent file tree (plan §5): its layout on disk, the agents' view of it, the file port RPH reads
// guidance through, the notes that follow the turn, the shipped level laid out from RPH's and RPE's
// shipped folders with what an update changed of it, and the Files page's listing and routes.

export { type TreeFileEntry, treeListing } from "./catalog";
export { type ChatFolders, type ChatNames, TREE_MIGRATIONS, TREE_TABLES, TreeChats, type TreeWrites } from "./chats";
export { type DefaultStanding, type DefaultUpdate, type DefaultsDeps, defaultStanding, type DiffLine, type FileWritten, layDefaults, lineDiff, recordWritten } from "./defaults";
export { cut, type TreeFiles, type TreeFilesDeps, treeFiles } from "./files";
export { GeneratedFiles, type GeneratedDeps, type GeneratedWrite, type PromptMapFields, promptMapFields } from "./generated";
export { cacheFileName, type CacheKept, type CacheKind, SessionCache, type SessionCacheDeps } from "./session-cache";
export { CHAT_CONFIG, CHATS_FOLDER, FILE_KEYS, folderFor, GLOBAL_CONFIG, id8, MOUNTS, NO_CHAT, NOTE_FOLDERS, NOTES_FOLDER, SESSIONS_FOLDER, SHIPPED_FOLDER, slug, TURN_TRACE, TURN_TRANSCRIPTS, turnFolderName, TURNS_FOLDER } from "./layout";
export { type NotesAt, type NotesDeps, type NotesMoved, TreeNotes } from "./notes";
export { KEPT_IN_OLD_TURNS, type Pruned, pruneChat, pruneTurnFolders, type RetentionSettings, retentionOf } from "./retention";
export { OwnFiles, type OwnFilesDeps } from "./own-files";
export { treeRoutes, type TreeRoutesDeps } from "./routes";
export { type TreeFileDiff, type TreeFileText, type TreeSuggestionView } from "./shapes";
export { FILE_SETTINGS, levelFiles, levelTexts, sharedLevels, TREE_DEFAULTS, TREE_SETTING_DEFS, TREE_SETTINGS, type TreeReaderDeps, treeReader, type TreeSettings, treeSettingsOf } from "./settings";
export { CHAT_DEFAULTS, layShipped, layShippedChanges, RPE_GUIDANCE, type ShippedChange } from "./shipped";
export { type ChatStorage, ChatMeasurer, type MeasurerDeps, measureFolder, type NoteFile, type NoteFiles, noteFiles, type StorageDeps, treeStorage, type TreeStorage } from "./storage";
export { SUGGESTION_STATES, type SuggestionFiled, type SuggestionState, type SuggestionsDeps, type TreeSuggestion, TreeSuggestions } from "./suggestions";
export { mergedTurnRecord, mergeTurnRecord, receivedOf, TURN_RECORD, type TurnRecordChange, type TurnRecordMessage, type TurnRecordRun, type TurnRecordTokens } from "./turn-record";
export { type ChatLocation, locate, placesOf, treeLayers } from "./view";

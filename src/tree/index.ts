// RPE's agent file tree (plan §5): its layout on disk, the agents' view of it, the file port RPH reads
// guidance through, the notes that follow the turn, the shipped level laid out from RPH's and RPE's
// shipped folders with what an update changed of it, and the Files page's listing and routes.

export { type TreeFileEntry, treeListing } from "./catalog";
export { type ChatFolders, type ChatNames, TREE_MIGRATIONS, TreeChats, type TreeWrites } from "./chats";
export { type DefaultChange, defaultChanges, type DefaultsDeps, DIFF_CELLS, type DiffLine, layDefaults, lineDiff } from "./defaults";
export { cut, FIND_LIMIT, GREP_LINE_MAX, GREP_MAX_BYTES, type TreeFiles, type TreeFilesDeps, treeFiles } from "./files";
export { CHAT_CONFIG, CHATS_FOLDER, folderFor, GLOBAL_CONFIG, id8, MOUNTS, NOTES_FOLDER, SESSIONS_FOLDER, SHIPPED_FOLDER, slug, turnFolderName, TURNS_FOLDER } from "./layout";
export { type NotesAt, type NotesDeps, type NotesMoved, TreeNotes } from "./notes";
export { KEPT_IN_OLD_TURNS, type Pruned, pruneChat, pruneTurnFolders, RETENTION_DEFAULTS, RETENTION_KEY, type RetentionSettings, retentionOf } from "./retention";
export { type TreeFileDiff, type TreeFileText, treeRoutes, type TreeRoutesDeps, type TreeSuggestionView } from "./routes";
export { CHAT_DEFAULTS, layShipped, layShippedChanges, RPE_GUIDANCE, type ShippedChange } from "./shipped";
export { type ChatStorage, NOTE_LIST, type NoteFile, type NoteFiles, noteFiles, type StorageDeps, treeStorage, type TreeStorage } from "./storage";
export { SUGGESTION_STATES, type SuggestionState, type SuggestionsDeps, type TreeSuggestion, TreeSuggestions } from "./suggestions";
export { type ChatLocation, locate, placesOf, treeLayers } from "./view";

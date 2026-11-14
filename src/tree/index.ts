// RPE's agent file tree (plan §5): its layout on disk, the agents' view of it, the file port RPH reads
// guidance through, and the shipped level laid out from RPH's and RPE's shipped folders.

export { type ChatFolders, type ChatNames, TREE_MIGRATIONS, TreeChats, type TreeWrites } from "./chats";
export { cut, FIND_LIMIT, GREP_LINE_MAX, GREP_MAX_BYTES, type TreeFiles, type TreeFilesDeps, treeFiles } from "./files";
export { CHAT_CONFIG, CHATS_FOLDER, folderFor, GLOBAL_CONFIG, id8, MOUNTS, NOTES_FOLDER, SESSIONS_FOLDER, SHIPPED_FOLDER, slug, turnFolderName, TURNS_FOLDER } from "./layout";
export { CHAT_DEFAULTS, layShipped, RPE_GUIDANCE } from "./shipped";
export { type ChatLocation, locate, placesOf, treeLayers } from "./view";

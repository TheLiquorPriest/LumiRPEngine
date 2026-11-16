// What the Files and Storage pages' routes take and answer (plan §5, §14), declared field by field and
// held to the tree's own types, so that the pages' types and the API reference say what a page sends and
// is sent, and a change to one stops this compiling until the declaration says the same.

import type { FileKind, GuidanceKind, StackPart } from "rp-harness/contract";
import { agentRef, type Exactly, type Holds, type Infer, layerLevel, shape } from "../app";
import type { TreeFileEntry } from "./catalog";
import type { DiffLine } from "./defaults";
import type { Listed, ListedPage } from "./listing";
import type { StorageKind } from "./kinds";
import type { PruneItem } from "./prune";
import type { Pruned } from "./retention";
import type { ChatStorage, NoteFile, NoteFiles, TreeStorage } from "./storage";
import type { SuggestionState, TreeSuggestion } from "./suggestions";

const T = shape.text();
const N = shape.number();
const field = shape.field;
const opt = shape.optional;
const nullable = shape.nullable;

const fileKind = shape.named("TreeFileKind", "What a file of the tree is: one the user writes, a note an agent keeps, or one RPE makes again.", shape.oneOf("yours", "notes", "generated"));
type KindMirrored = Holds<Exactly<Infer<typeof fileKind>, FileKind>>;

/** The chat a route names, where it names one: a chat's id; left out, none (the shipped level and the user's own). */
export const chatQuery = opt(T, "The chat whose view of the tree is read; left out, the shipped level and the user's own.");

// ---------------------------------------------------------------- files

const treeFileRow = shape.named(
  "TreeFileRow",
  "One file of the agents' tree as the Files page lists it: its path in the chat's view, its level and kind, its size, whether RPH takes it, and what stands beside it at other levels.",
  shape.object({
    path: field(T, "Its path in the chat's view, as the file routes take it: `@shipped/…`, `@global/…`, `@character/…`, or below the chat's folder."),
    level: layerLevel,
    kind: fileKind,
    bytes: N,
    item: field(nullable(T), "The name RPH loads it by, and an `off:` list names it by; null for a file RPH does not load by its name."),
    applies: field(shape.yesNo(), "Whether RPH takes it: a named file when it is the nearest of its name, not switched off and not an example; any other file as it is."),
    replacedBy: field(nullable(T), "The nearer file of the same name taken in its place; null when none is."),
    off: field(shape.yesNo(), "Its name is in a config's `off:` list, which switches it off at every level."),
    offIn: field(shape.list(layerLevel), "The levels whose config's `off:` list names it, farthest first: switching it on at one of these takes the name out there; at any other level it changes nothing."),
    editable: field(shape.yesNo(), "Whether the user may write it where it is: never a shipped file or a generated one."),
    shipped: field(nullable(T), "The shipped file of the same name, for a file of another level that has one; null otherwise."),
    defaultChanged: field(nullable(N), "For a file of the user's in place of a shipped one: when the latest update that changed that shipped file did so, if it did since this file was last written; null otherwise."),
    defaultRemoved: opt(nullable(N), "For a file of the user's in place of a default an update has since taken away: when the update that removed it ran, if it did since this file was last written."),
    isConfig: opt(shape.yesNo(), "Whether it is a level's config file, which the Settings page edits too."),
    placeable: opt(shape.list(layerLevel), "The levels where a file of its kind and name has a place that the user may write: \"save as\" offers only those."),
    editedOn: opt(nullable(T), "For a generated file, the page where what it shows is edited, if one is; null otherwise."),
    held: opt(nullable(shape.oneOf("needs", "broken")), "Why RPH leaves it out though it is the nearest of its name and not switched off: what its `needs:` names is not in force, or its header does not parse; null when nothing does."),
    problems: opt(shape.list(T), "What RPH found wrong with it, in its own words, line by line."),
    joins: opt(shape.list(T), "The agents whose stacks it joins: a file `instructions:` names or an agent reads."),
  }),
);
type EntryMirrored = Holds<Exactly<Infer<typeof treeFileRow>, TreeFileEntry>>;

const listedRow = shape.named(
  "TreeListed",
  "One entry of a folder, or of a search: a folder, or a file with its entry.",
  shape.object({ name: T, path: field(T, "Its path in the chat's view, as the file routes take it."), folder: shape.yesNo(), level: layerLevel, entry: field(nullable(treeFileRow), "The file as the listing shows it; null for a folder.") }),
);
type ListedMirrored = Holds<Exactly<Infer<typeof listedRow>, Listed>>;
export const treeListedReply = shape.named(
  "TreeListedReply",
  "A page of a folder of the chat's view, folders first and each by name, or of a search across every level: its entries, where the next page starts, the levels the view has, and whether a search stopped before it had looked everywhere.",
  shape.object({
    folder: field(T, "The folder listed, \"\" for the chat's own top (which holds the other levels' folders beside its files); empty for a search."),
    items: shape.list(listedRow),
    next: field(nullable(T), "Where the next page starts: send it as `after`; null at the end."),
    levels: field(shape.list(layerLevel), "The levels the view has now: a chat's and its character's once the chat has its folders."),
    stopped: field(nullable(shape.oneOf("time")), "A search that ran out of its time with the entries it had found, and did not look everywhere."),
  }),
);
type ListedPageMirrored = Holds<Exactly<Infer<typeof treeListedReply>, ListedPage>>;

export const treeListingReply = shape.named("TreeListingReply", "Every file of the chat's view of the tree; with no chat, of the shipped level and the user's own.", shape.object({ files: shape.list(treeFileRow) }));

export const treeFileReply = shape.named(
  "TreeFileReply",
  "One file of the tree, as text: the whole of a short one, and of a long one the lines or bytes asked for (the page's setting `files.readLines` of its lines when none is asked), with its size and its count of lines.",
  shape.object({
    path: T,
    level: layerLevel,
    kind: fileKind,
    bytes: field(N, "The file's size in bytes."),
    editable: shape.yesNo(),
    text: field(T, "The part read, whole lines or the bytes asked for."),
    lines: opt(N, "The file's lines in all."),
    from: opt(N, "The first line the text holds; with `offset`, the first byte."),
    to: opt(N, "The last line the text holds; with `offset`, the byte after the last."),
    more: opt(shape.yesNo(), "Whether the file goes on past what was read."),
  }),
);
/** A file the Files page reads. */
export type TreeFileText = Infer<typeof treeFileReply>;

const diffRow = shape.named("DiffRow", "One line of a difference between two texts: in both, only in the second, or only in the first.", shape.object({ op: shape.oneOf("same", "added", "removed"), text: T }));
type DiffMirrored = Holds<Exactly<Infer<typeof diffRow>, DiffLine>>;

export const treeDiffReply = shape.named(
  "TreeDiffReply",
  "A file's differences: from the shipped file of its name to this one; and what the updates that changed the shipped file since this one was written changed of it, together and one by one.",
  shape.object({
    path: T,
    shipped: field(nullable(T), "The shipped file of the same name; null when there is none, or the file is the shipped one."),
    lines: field(shape.list(diffRow), "From the shipped file to this one, line by line; none without a shipped file."),
    update: field(nullable(shape.object({ at: N, lines: shape.list(diffRow) })), "Every change to the shipped file since this one was last written, as one difference: when the latest update ran, and from the shipped file as it stood when this one was written to the shipped file now."),
    updates: opt(shape.list(shape.object({ at: N, lines: shape.list(diffRow) })), "The same changes one update at a time, oldest first: when each ran, and from the shipped file before it to the shipped file after it."),
  }),
);

/** A file's differences (plan §5.4 "Defaults"). */
export type TreeFileDiff = Infer<typeof treeDiffReply>;

export const fileWriteBody = shape.named(
  "FileWriteAsk",
  "The whole text of a file, written as the user at a level (for a file of another level, the user's own file of its name there); a chat's level names the chat.",
  shape.object({ level: layerLevel, chat: opt(nullable(T)), text: T }),
);
export const fileSwitchBody = shape.named(
  "FileSwitchAsk",
  "A file's name switched off or on again in the `off:` list of a level's config: the global level's, or a chat's, which names the chat.",
  shape.object({ level: shape.oneOf("global", "chat"), chat: opt(nullable(T)), off: shape.yesNo() }),
);
export const fileWrittenReply = shape.named("FileWrittenReply", "What writing a file or switching its name answers: the file as the listing now shows it.", shape.object({ file: nullable(treeFileRow) }));
export const fileRemovedReply = shape.object({
  removed: field(T, "The path of the file removed; for a shipped file, the path of the one switched off."),
  switchedOff: opt(layerLevel, "For a shipped file: the level whose `off:` list now names it. The file itself stays."),
});

const guidanceKind = shape.named("GuidanceKind", "A kind of guidance a folder of the tree holds: the agents' definitions, skills, rules, hooks, prompt parts or tools.", shape.oneOf("agents", "skills", "rules", "hooks", "prompts", "tools"));
type GuidanceMirrored = Holds<Exactly<Infer<typeof guidanceKind>, GuidanceKind>>;
export const folderBody = shape.named("FolderAsk", "A folder of the user's to make, by its path in the chat's view; a chat's level names the chat.", shape.object({ chat: opt(nullable(T)), path: T }));
export const folderMadeReply = shape.object({ path: field(T, "The path of the folder, as the view names it.") });
export const fileMoveBody = shape.named(
  "FileMoveAsk",
  "A file or folder of the user's to rename, move or copy: its path in the chat's view, and the path it goes to, which nothing stands at; a chat's level names the chat.",
  shape.object({ chat: opt(nullable(T)), from: T, to: T }),
);
export const fileMovedReply = shape.named(
  "FileMovedReply",
  "Where a file or folder went: its path, the file as the listing now shows it (none for a folder), and the kind of guidance it now is when it went into a folder of one.",
  shape.object({ path: T, file: nullable(treeFileRow), guidance: field(nullable(guidanceKind), "The kind of guidance the place is a folder of: a file moved into `rules/` is a rule; null for any other.") }),
);
export const applyBody = shape.named("ApplyNowAsk", "The chat whose open session starts its opening block afresh.", shape.object({ chat: shape.text({ blank: false }) }));
export const applyReply = shape.named(
  "ApplyNowReply",
  "What \"Apply now\" did: the session whose opening block starts afresh with the next run of each agent, or none when no session is open, and what that means in words.",
  shape.object({ session: nullable(T), note: T }),
);

// ---------------------------------------------------------------- suggestions

export const suggestionState = shape.named("SuggestionStatus", "Where an agent's suggestion stands: waiting on the user, accepted, or dismissed.", shape.oneOf("open", "accepted", "dismissed"));
type StateMirrored = Holds<Exactly<Infer<typeof suggestionState>, SuggestionState>>;

const suggestionFields = {
  id: N,
  chat: T,
  turn: field(nullable(shape.turnId()), "The turn it was filed in; null for one filed outside a turn."),
  agent: agentRef,
  path: field(T, "The file it would change, as the agent named it in the chat's view."),
  text: field(T, "The proposed text, whole."),
  reason: T,
  at: N,
  state: suggestionState,
  decided: field(nullable(N), "When the user accepted or dismissed it; null while open."),
} as const;
const suggestionRow = shape.named("SuggestionRow", "An agent's suggestion for a file: the file as the agent named it in the chat's view, the text proposed whole, and why.", shape.object(suggestionFields));
type SuggestionMirrored = Holds<Exactly<Infer<typeof suggestionRow>, TreeSuggestion>>;

const suggestionShown = shape.named(
  "SuggestionShown",
  "A suggestion with what it would change: from the file as it is now to the text proposed.",
  shape.object({
    ...suggestionFields,
    lines: shape.list(diffRow),
    level: opt(layerLevel, "The level accepting it writes at when no level is named: its file's own, or for a shipped file the chat's."),
    levels: opt(shape.list(layerLevel), "The levels that have a place for its file, any of which accepting it may name."),
  }),
);
/** An agent's suggestion as the Files page shows it: with the difference from its file as it is now to the text proposed. */
export type TreeSuggestionView = Infer<typeof suggestionShown>;
export const suggestionsReply = shape.named("SuggestionsReply", "A chat's suggestions (every chat's when none is named), newest first.", shape.object({ suggestions: shape.list(suggestionShown) }));
export const suggestionAcceptBody = shape.named(
  "SuggestionAcceptAsk",
  "The text as accepted, when it was edited, and the level it is written at (absent: the file's own).",
  shape.object({ text: opt(nullable(T)), level: opt(layerLevel) }),
);
export const suggestionAcceptedReply = shape.named("SuggestionAcceptedReply", "A suggestion accepted: it as it now stands, and the file as the listing now shows it.", shape.object({ suggestion: nullable(suggestionRow), file: nullable(treeFileRow) }));
export const suggestionDismissedReply = shape.named("SuggestionDismissedReply", "A suggestion dismissed: it as it now stands.", shape.object({ suggestion: nullable(suggestionRow) }));

// ---------------------------------------------------------------- storage

const chatStorageRow = shape.named(
  "ChatStorageRow",
  "What a chat's folder takes in all, and by area: its notes, its turn folders, its sessions' own files, and the rest of its files.",
  shape.object({ chat: T, folder: field(T, "Its folder below the tree's `chats/`."), bytes: N, areas: shape.object({ notes: N, turns: N, sessions: N, files: N }), deleted: opt(nullable(N), "When RPE heard that Lumiverse deleted the chat, epoch milliseconds; its session files are gone and its other files stay until he prunes them.") }),
);
type ChatStorageMirrored = Holds<Exactly<Infer<typeof chatStorageRow>, ChatStorage>>;

export const storageReply = shape.named(
  "StorageReply",
  "Each chat's folder; the user's own level, its notes and the shipped level; and RPE's database file, with its write-ahead log.",
  shape.object({
    chats: shape.list(chatStorageRow),
    global: field(N, "The user's own level, the chats' folders, the shipped level and its notes apart."),
    globalNotes: field(N, "The global level's notes, which every chat's agents read."),
    shipped: N,
    database: field(N, "RPE's database file, with its write-ahead log."),
  }),
);
type StorageMirrored = Holds<Exactly<Infer<typeof storageReply>, TreeStorage>>;

const noteRow = shape.named(
  "NoteRow",
  "A note file of a chat: its path in the chat's view, its size now (0 for one no longer there), and how many times agents wrote it in turns.",
  shape.object({ path: T, bytes: N, writes: N }),
);
type NoteMirrored = Holds<Exactly<Infer<typeof noteRow>, NoteFile>>;
export const notesReply = shape.named("NotesReply", "A chat's largest notes, and those agents rewrote most.", shape.object({ largest: shape.list(noteRow), rewritten: shape.list(noteRow) }));
type NotesMirrored = Holds<Exactly<Infer<typeof notesReply>, NoteFiles>>;

const prunedShown = shape.named("PrunedShown", "What pruning a chat's old turn folders took away: of how many folders, how many files, how many bytes.", shape.object({ folders: N, files: N, bytes: N }));
type PrunedMirrored = Holds<Exactly<Infer<typeof prunedShown>, Pruned>>;
export const pruneBody = shape.named("PruneAsk", "The chat whose old turn folders are pruned.", shape.object({ chat: shape.text({ blank: false }) }));
export const pruneReply = shape.object({ pruned: prunedShown });

const keptFor = shape.named(
  "KeptFor",
  "How long a kind is kept: for good, until the chat is deleted or he prunes it, or by a setting, which gives its key and what it is now (null: none, all kept).",
  shape.union(shape.object({ by: shape.literal("never") }), shape.object({ by: shape.literal("chat") }), shape.object({ by: shape.literal("setting"), setting: T, value: nullable(N) })),
);
const storageKindRow = shape.named(
  "StorageKindRow",
  "One kind RPE keeps: how many, how big, the oldest of it, and how long it is kept.",
  shape.object({ kind: T, count: field(N, "How many: files, rows, folders or backups, by what the kind is."), bytes: N, oldest: field(nullable(N), "When the oldest of it was made, epoch milliseconds; null where there is none."), kept: keptFor }),
);
type KindMirrored2 = Holds<Exactly<Infer<typeof storageKindRow>, StorageKind>>;
export const storageKindsReply = shape.named(
  "StorageKindsReply",
  "Each kind RPE keeps, with its count, size, oldest and how long it is kept, and when the user last pruned.",
  shape.object({ kinds: shape.list(storageKindRow), lastPrune: field(nullable(N), "When the user last pruned anything the page offers, epoch milliseconds; null when never.") }),
);

const pruneItem = shape.named(
  "PruneItem",
  "One place a prune takes from: a turn folder's snapshots, a closed session, a deleted chat's folder, or a backup; its path below the tree's folder (a backup's, its name), and the files and bytes that go.",
  shape.object({ kind: shape.oneOf("turn-folder", "session", "chat", "backup"), path: T, files: N, bytes: N }),
);
type PruneItemMirrored = Holds<Exactly<Infer<typeof pruneItem>, PruneItem>>;
export const storagePruneBody = shape.named(
  "StoragePruneAsk",
  "What to prune: a chat's old turn folders, its closed sessions' files, a deleted chat's other files, or the backup or copy of the database named. Without `plan` it only says what would go; with the `plan` that answer gave, it takes exactly that.",
  shape.object({ what: shape.oneOf("turns", "sessions", "chat", "backup"), chat: opt(nullable(T)), name: opt(nullable(T)), plan: opt(T) }),
);
export const storagePruneReply = shape.named(
  "StoragePruneReply",
  "What a prune would take (its places, files and bytes, and the `plan` that stands for exactly that), or, when asked with the plan, took.",
  shape.object({ plan: T, removed: field(shape.yesNo(), "False: this is what would go. True: this went."), files: N, bytes: N, items: shape.list(pruneItem) }),
);

const stackPartRow = shape.named(
  "StackPartRow",
  "One part of an agent's stack: its kind, which part, the file it came from, its level, whether it sits in the opening block or comes with the briefing, its text, and the situations that hand it to the briefing; a part left out is listed with why.",
  shape.object({
    kind: field(shape.oneOf("definition", "instruction", "rule", "contract", "guide", "description", "skills", "given"), "What the part is."),
    part: field(T, "Its name as `off:` lists name it; for `given`, the item as `opening:` writes it."),
    path: field(T, "The file it came from; for a part left out as `missing`, where it would be; for `given`, the definition that names it."),
    level: layerLevel,
    hash: opt(T, "SHA-256 of the file (for `given`, of its text), lower-case hex; absent for a part left out as `missing`."),
    where: field(shape.oneOf("opening", "briefing"), "Where it sits, or for a part left out, where it would."),
    left: opt(shape.oneOf("missing", "off", "empty", "broken", "needs"), "Why it is left out; absent for a part in the stack."),
    text: opt(T, "Its text as the agent gets it; absent when left out, and for `given` outside a session."),
    situations: opt(shape.list(T), "For a part the briefing is handed: the situations that add it."),
  }),
);
export const stackReply = shape.named("StackReply", "The exact stack an agent gets in the chat, part by part in order, each with the file it comes from, its level, and whether it sits in the opening block or comes with the briefing; a part left out is listed with why.", shape.object({ agent: T, parts: shape.list(stackPartRow) }));
type StackMirrored = Holds<Exactly<Infer<typeof stackPartRow>, StackPart>>;

/** The checks above hold, and are read by no one. */
export type Mirrors = [KindMirrored, GuidanceMirrored, EntryMirrored, ListedMirrored, ListedPageMirrored, DiffMirrored, StateMirrored, SuggestionMirrored, ChatStorageMirrored, StorageMirrored, KindMirrored2, PruneItemMirrored, NoteMirrored, NotesMirrored, PrunedMirrored, StackMirrored];

// The stores of today's build, one row each, as the plan's table of what is carried has them
// (STANDALONE-PLAN §15.2), and the fate each row's things meet by default: carried into RPE's own
// stores, attached word for word beside what they belong to, or archived (kept in the archive and
// listed, not loaded). A thing found that no row names is "found, not classified". And the rows this
// build has no place for in RPE yet, whose things a run keeps in the backup only (`NO_PLACE_YET`).

export type Fate = "carried" | "attached" | "archived";

/**
 * How the migration finds a row's things: as files and database entries of their own (`own`),
 * only inside other rows' files and entries (`inside`: counted from them, never on their own), or
 * not at all (`not read`), where the row's things sit outside the three places the migration reads.
 */
export type Found = "own" | "inside" | "not read";

export interface Row {
  id: RowId;
  /** What the row holds, in the plan's words. */
  what: string;
  fate: Fate;
  found: Found;
  /** For a row the migration doesn't read: why. */
  why?: string;
}

export const ROWS = [
  { id: "worlds", what: "Worlds: the index, every revision, the draft, the history notes", fate: "carried", found: "own" },
  { id: "world-contents", what: "What a world holds: packs, entities, places, maps, rules, lore and the rest of each world document", fate: "carried", found: "inside" },
  { id: "build-jobs", what: "Build jobs and their proposals; lore ids; secrecy backups", fate: "carried", found: "own" },
  { id: "chat-run", what: "Which world and revision each chat plays, its seed and when it started", fate: "carried", found: "own" },
  { id: "chat-switch", what: "Which chats the engine is switched on for, which engine each used, and each chat's story choice", fate: "carried", found: "own" },
  { id: "ledger", what: "Each chat's ledger, for every reply and every swipe, and its journal", fate: "carried", found: "own" },
  { id: "panel-requests", what: "What you asked for through a panel, recorded on your own messages", fate: "carried", found: "own" },
  { id: "pack-state", what: "All pack state, folded from the ledger", fate: "carried", found: "inside" },
  { id: "secret-holdings", what: "Who holds which lore secret", fate: "carried", found: "inside" },
  { id: "chat-places", what: "A chat's own places, paths and maps", fate: "carried", found: "inside" },
  { id: "story-record", what: "The story record: beats, struck beats, cast, drafts", fate: "carried", found: "inside" },
  { id: "unplayed", what: "A reply that stands with no turn played, and why", fate: "carried", found: "inside" },
  { id: "departures", what: "Where a reply says something against what its turn decided", fate: "carried", found: "inside" },
  { id: "mind-files", what: "Mind files per character", fate: "attached", found: "inside" },
  { id: "author-notes", what: "The Author's notebook, scene, prepare.md, story.md, saved lore and lore drafts: the harness's chat area, turn by turn", fate: "carried", found: "own" },
  { id: "learned-and-home", what: "learned/ and your own ~/ files", fate: "carried", found: "own" },
  { id: "guidance", what: "Your GUIDANCE.md", fate: "attached", found: "inside" },
  { id: "agents-workspace", what: "The agents engine's workspace, global workspace and learned area", fate: "carried", found: "own" },
  { id: "assistant-threads", what: "GM assistant threads", fate: "carried", found: "own" },
  { id: "sessions", what: "Sessions, compaction summaries and transcripts of all three engines, and what else an old engine recorded on a reply; both blob stores", fate: "attached", found: "own" },
  { id: "rollback", what: "A rollback of the agents engine's last compaction that you asked for and that had not been applied", fate: "archived", found: "own" },
  { id: "chips-staged", what: "Review cards and stored chips; staged changes", fate: "carried", found: "own" },
  { id: "old-engine-notes", what: "The classic pipeline's re-narrate lines and the agents engine's kept scene", fate: "archived", found: "own" },
  // Not in the plan's table, which predates it: the depth engine's files, found by the rehearsal on the test instance. Archived for the plan's own reason (it steered only an engine that is gone); see `DEPTH_GONE` in classify.ts.
  { id: "depth-engine", what: "The depth engine's files, left by a build before the previous one: each chat's switch to it, its bootstrap of the chat, the layer of what it landed, its search index of the chat, its loopback registry and its day's spend", fate: "archived", found: "own" },
  // Not in the plan's table either: RPE's own files, which its light extension writes once it has run, so a run after the swap finds them. Never carried, and no reason to refuse.
  { id: "rpe-own", what: "RPE's own files, written by the new build of the extension: its registration with RPE", fate: "archived", found: "own" },
  { id: "pins", what: "Pins", fate: "carried", found: "inside" },
  { id: "settings", what: "Your settings", fate: "carried", found: "own" },
  { id: "model-choices", what: "Which model each kind of work uses, where a setting names a connection that lives in Lumiverse", fate: "carried", found: "inside" },
  { id: "texts", what: "Your edited prompts and texts", fate: "attached", found: "own" },
  { id: "own-agents", what: "Your own agents and skills", fate: "attached", found: "inside" },
  { id: "approvals-jobs", what: "Approvals and jobs", fate: "carried", found: "own" },
  { id: "spend", what: "Spend history and upkeep records", fate: "archived", found: "own" },
  { id: "connections", what: "Connections and keys", fate: "carried", found: "own" },
  { id: "loopback", what: "The loopback connection in Lumiverse, and the hash of its key", fate: "carried", found: "own" },
  { id: "runtime-settings", what: "The runtime's own settings: tuning, memory limit, update choice; its service unit", fate: "carried", found: "own" },
  { id: "link-credentials", what: "The old link's own credentials: the runtime's Lumiverse session token, the relay secrets and their hashes", fate: "archived", found: "inside" },
  { id: "chat-copy", what: "Which runtime held the working copy; the chat copy's own state", fate: "archived", found: "own" },
  { id: "forget-list", what: "LumiAH's list of chats to forget", fate: "archived", found: "own" },
  { id: "mcp-clients", what: "Check-ins of outside harnesses that run LumiRPEngine's own MCP server, and the update notice kept beside them", fate: "archived", found: "own" },
  { id: "cli-signins", what: "Command-line sign-ins", fate: "carried", found: "not read", why: "They sit in a file on the machine the command line ran from, and stay there: the command line becomes a client of RPE." },
  { id: "browser-prefs", what: "Browser preferences", fate: "carried", found: "not read", why: "They sit in the browser's own storage, which the new pages read under the same keys." },
  { id: "derived", what: "Search vectors, caches and snapshots", fate: "archived", found: "own" },
  { id: "logs", what: "Logs, diagnostics and small working files", fate: "archived", found: "own" },
  { id: "working-copy", what: "The runtime's working copy and its temporary folder; the installed copy of the previous runtime", fate: "archived", found: "own" },
  { id: "deleted-chats", what: "Run data of chats since deleted in Lumiverse", fate: "archived", found: "own" },
  // Not in the plan's table either: where today's build keeps two copies of one thing (§15.2 l.1641), the copy that is not the authority, counted from inside the file it rides in, which is carried whole.
  { id: "second-copies", what: "Where the previous build keeps two copies of one thing: the copy that is not the authority, left in the file it is in", fate: "attached", found: "inside" },
  // Not in the plan's table either: what he gives a row to (the setting `migration.rows`, §22 l.2117): a file nothing names, kept in the backup as he says, with his own line.
  { id: "owner-rows", what: "Files you gave a row to: each kept as you said, with your line saying what it is", fate: "archived", found: "own" },
] as const satisfies readonly { id: string; what: string; fate: Fate; found: Found; why?: string }[];

export type RowId = (typeof ROWS)[number]["id"];

export const ROW: Readonly<Record<RowId, Row>> = Object.fromEntries(ROWS.map((r) => [r.id, r])) as Record<RowId, Row>;

/**
 * The rows this build has no place for in RPE yet, each with what will carry it later. A thing of one
 * of them that a run doesn't land is kept in the backup only: counted in a column of its own, never as
 * carried or archived, and named at the end of the report, and the run goes ahead. A lane that gives
 * a row its place deletes the row's line here. A row not named here can never be kept in the backup
 * only: where a run can't land its things, the gate refuses the run.
 */
export const NO_PLACE_YET: Readonly<Partial<Record<RowId, string>>> = {
  "panel-requests": "the turn lane's tables, which a run is given by its caller (`MigrateOptions.runs`); without them it is kept in the backup only",
  "assistant-threads": "the pages lane",
  "chips-staged": "the turn lane's tables, which a run is given by its caller (`MigrateOptions.runs`); without them it is kept in the backup only",
  "approvals-jobs": "the turn lane's tables, and its writer of a carried job (`MigrateOptions.runs.keepJob`), which a run is given by its caller",
  "owner-rows": "nothing reads a file you name (§22): an attached one stays in the backup, with your line, until a reader of it is built",
};

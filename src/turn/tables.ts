// The turn lane's tables, as steps for the application's migration runner. Every table carries the
// user.
//
// Area `prompt` (plan Appendix B, "Prompt"): what each turn's request carried (its raw layout, the lore
// that activated for it, the history window's cut), the prompt map of each preset, and where RPH found
// each slice in a turn's prompt.
//
// Area `harness` (Appendix B, "Harness"): RPH's small durable state (`kv`), each turn's run as the Turn
// page shows it (`turn_run`: where it stands, its timings and usage, what went to the chat), what RPH
// told RPE about the run (`turn_told`: rules that fired, consents, gap checks, suggestions, attachments
// asked for), the player's messages as RPE read them (`player_text`), and what the player asked for
// through a panel (`panel_request`).

export type TableStep = { readonly version: number; readonly name: string; readonly sql: string };

export const PROMPT_MIGRATIONS: readonly TableStep[] = [
  {
    version: 1,
    name: "turn prompts, prompt maps and located slices",
    sql: `
CREATE TABLE turn_prompt (
  user TEXT NOT NULL,
  turn TEXT NOT NULL,
  chat TEXT NOT NULL,
  preset TEXT,
  layout TEXT NOT NULL,
  lore TEXT NOT NULL,
  cut TEXT NOT NULL,
  received INTEGER NOT NULL,
  summarized TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (user, turn)
);
CREATE INDEX turn_prompt_chat ON turn_prompt (user, chat, received);
CREATE TABLE prompt_map (
  user TEXT NOT NULL,
  preset TEXT NOT NULL,
  map TEXT NOT NULL,
  by TEXT NOT NULL,
  saved INTEGER NOT NULL,
  PRIMARY KEY (user, preset)
);
CREATE TABLE prompt_located (
  user TEXT NOT NULL,
  turn TEXT NOT NULL,
  located TEXT NOT NULL,
  saved INTEGER NOT NULL,
  PRIMARY KEY (user, turn)
);
`,
  },
];

export const HARNESS_MIGRATIONS: readonly TableStep[] = [
  {
    version: 1,
    name: "harness state, turn runs and what RPH told",
    sql: `
CREATE TABLE kv (
  user TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user, key)
);
CREATE TABLE turn_run (
  user TEXT NOT NULL,
  turn TEXT NOT NULL,
  chat TEXT NOT NULL,
  session TEXT NOT NULL,
  generation TEXT,
  target TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  received INTEGER NOT NULL,
  started INTEGER,
  first_word INTEGER,
  released INTEGER,
  ended INTEGER,
  usage TEXT,
  reply TEXT NOT NULL DEFAULT '',
  progress TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  base TEXT NOT NULL DEFAULT '',
  saved TEXT,
  PRIMARY KEY (user, turn)
);
CREATE INDEX turn_run_chat ON turn_run (user, chat, received);
CREATE INDEX turn_run_generation ON turn_run (user, generation);
CREATE TABLE turn_told (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  turn TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX turn_told_turn ON turn_told (user, turn);
`,
  },
  {
    version: 2,
    name: "a run of its own for each continue of a turn",
    sql: `
CREATE TABLE turn_run_by_id (
  user TEXT NOT NULL,
  id TEXT NOT NULL,
  turn TEXT NOT NULL,
  chat TEXT NOT NULL,
  session TEXT NOT NULL,
  generation TEXT,
  target TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  received INTEGER NOT NULL,
  started INTEGER,
  first_word INTEGER,
  released INTEGER,
  ended INTEGER,
  usage TEXT,
  reply TEXT NOT NULL DEFAULT '',
  progress TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  base TEXT NOT NULL DEFAULT '',
  saved TEXT,
  PRIMARY KEY (user, id)
);
INSERT INTO turn_run_by_id (user, id, turn, chat, session, generation, target, kind, status, received, started, first_word, released, ended, usage, reply, progress, error, base, saved)
  SELECT user, turn, turn, chat, session, generation, target, kind, status, received, started, first_word, released, ended, usage, reply, progress, error, base, saved FROM turn_run ORDER BY rowid;
DROP TABLE turn_run;
ALTER TABLE turn_run_by_id RENAME TO turn_run;
CREATE INDEX turn_run_chat ON turn_run (user, chat, received);
CREATE INDEX turn_run_generation ON turn_run (user, generation);
CREATE INDEX turn_run_turn ON turn_run (user, turn, received);
`,
  },
  {
    version: 3,
    name: "the swipe each run's generation writes, when its end was recorded, and where a continue's changes begin",
    // A run kept before: a new reply's swipe is its message's first; its end counts as recorded once it is over and its turn is no
    // longer open (the store's `turn`, an earlier area's table).
    sql: `
ALTER TABLE turn_run ADD COLUMN swipe INTEGER;
ALTER TABLE turn_run ADD COLUMN settled INTEGER;
ALTER TABLE turn_run ADD COLUMN mark INTEGER;
UPDATE turn_run SET swipe = 0 WHERE kind = 'new' AND target IS NOT NULL;
UPDATE turn_run SET settled = COALESCE(ended, received)
  WHERE status <> 'running' AND NOT EXISTS (SELECT 1 FROM turn t WHERE t.user = turn_run.user AND t.id = turn_run.turn AND t.status = 'open');
CREATE INDEX turn_run_unsettled ON turn_run (user, chat) WHERE settled IS NULL AND generation IS NOT NULL;
`,
  },
  {
    version: 4,
    name: "where a continue's cast and story rows begin",
    // A continue kept before has no such mark: should it save nothing, its store changes are taken back and its cast and story rows stay.
    sql: `
ALTER TABLE turn_run ADD COLUMN cast_mark INTEGER;
ALTER TABLE turn_run ADD COLUMN story_mark INTEGER;
`,
  },
  {
    version: 5,
    name: "the player's messages as RPE read them, and what the player asked for through a panel",
    // `player_text`: a message's text by the hash it had, so an edit of it can be told with the text it had before.
    // `panel_request`: a tap that is part of the player's next message (plan §10.10 "A panel action"), held for every turn that
    // follows the turn whose reply was the chat's newest when it was made (`after`; null before the chat's first turn).
    sql: `
CREATE TABLE player_text (
  user TEXT NOT NULL,
  chat TEXT NOT NULL,
  message TEXT NOT NULL,
  hash TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (user, chat, message, hash)
);
CREATE TABLE panel_request (
  user TEXT NOT NULL,
  id TEXT NOT NULL,
  chat TEXT NOT NULL,
  after TEXT,
  what TEXT NOT NULL,
  "on" TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (user, id)
);
CREATE INDEX panel_request_after ON panel_request (user, chat, after);
`,
  },
];

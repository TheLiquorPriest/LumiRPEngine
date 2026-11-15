// The turn lane's tables, as steps for the application's migration runner. Every table carries the
// user.
//
// Area `prompt` (plan Appendix B, "Prompt"): what each turn's request carried (its raw layout, the lore
// that activated for it, the history window's cut), the prompt map of each preset, and where RPH found
// each slice in a turn's prompt.
//
// Area `harness` (Appendix B, "Harness"): RPH's small durable state (`kv`, and its job records, `job`), each turn's run as the Turn
// page shows it (`turn_run`: where it stands, its timings and usage, what went to the chat), what RPH
// told RPE about the run (`turn_told`: rules that fired, consents, gap checks, suggestions, attachments
// asked for), the player's messages as RPE read them (`player_text`), what the player asked for
// through a panel (`panel_request`), what a comparison of a chat's path found (`since_found`), which
// of these a turn was told (`since_told`), and each job as RPH last told of it (`turn_job`).

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
  {
    version: 6,
    name: "what a comparison of a chat's path found, which turn was told what, and panel requests told by who was told them",
    // `since_found`: one thing a comparison found, as data (`since.ts`), filed under the turn at the head of the chat's path when it
    // was found (`after`; null while no turn is on it). `since_told`: a found thing or a panel request, and a turn it was told to. A
    // panel request is told by who was told it, no longer by the turn noted when it was made, so `panel_request.after` goes.
    sql: `
CREATE TABLE since_found (
  user TEXT NOT NULL,
  id TEXT NOT NULL,
  chat TEXT NOT NULL,
  after TEXT,
  at INTEGER NOT NULL,
  item TEXT NOT NULL,
  PRIMARY KEY (user, id)
);
CREATE INDEX since_found_after ON since_found (user, chat, after);
CREATE TABLE since_told (
  user TEXT NOT NULL,
  turn TEXT NOT NULL,
  item TEXT NOT NULL,
  PRIMARY KEY (user, turn, item)
);
CREATE INDEX since_told_item ON since_told (user, item);
DROP INDEX panel_request_after;
ALTER TABLE panel_request DROP COLUMN after;
CREATE INDEX panel_request_chat ON panel_request (user, chat, at);
`,
  },
  {
    version: 7,
    name: "each job as RPH last told of it",
    // `turn_job`: a job's view as the harness last told it (`TurnEvents.job`), with its chat and the turn that started it (null for one
    // the user started). When it ended is the store's record of it (`job_end`, an earlier area's table).
    sql: `
CREATE TABLE turn_job (
  user TEXT NOT NULL,
  job TEXT NOT NULL,
  chat TEXT NOT NULL,
  turn TEXT,
  view TEXT NOT NULL,
  PRIMARY KEY (user, job)
);
CREATE INDEX turn_job_chat ON turn_job (user, chat);
`,
  },
  {
    version: 8,
    name: "each run's intake by step, its waits for the turn before, and how its turn's folder was written",
    // JSON, as `runs.ts` reads them: `intake` the steps in order, each `{ step, from, to }`; `wait` the waits, each `{ from, to }`;
    // `folder` `{ from, to, error }`. A run kept before has none of them, and each reads as null.
    sql: `
ALTER TABLE turn_run ADD COLUMN intake TEXT;
ALTER TABLE turn_run ADD COLUMN wait TEXT;
ALTER TABLE turn_run ADD COLUMN folder TEXT;
`,
  },
  {
    version: 9,
    name: "RPH's own id for each run",
    // The `run` its trace records and streaming text carry (`runs.ts` `traceRun`). A run kept before has none, and reads as null.
    sql: `
ALTER TABLE turn_run ADD COLUMN trace_run TEXT;
`,
  },
  {
    version: 10,
    name: "the intent record's own time and the thinking of each run, and whether its reply went out before its record",
    // JSON, as `runs.ts` reads them: `intent_time` `{ from, to }`, `thinking` a list of them. A run kept before has neither, and no mark.
    sql: `
ALTER TABLE turn_run ADD COLUMN intent_time TEXT;
ALTER TABLE turn_run ADD COLUMN thinking TEXT;
ALTER TABLE turn_run ADD COLUMN without_intent INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    version: 11,
    name: "what stopped each run where it stood, and whether its reply was the Author's last plain text",
    // `stopped_by` JSON, as `runs.ts` reads it: `{ limit }` or `{ hold }`. A run kept before has neither, and no mark.
    sql: `
ALTER TABLE turn_run ADD COLUMN stopped_by TEXT;
ALTER TABLE turn_run ADD COLUMN last_text INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    version: 12,
    name: "when each run's reply went out whole",
    // `runs.ts` `finished`. A run kept before has none, and reads as one whose reply did not go out whole.
    sql: `
ALTER TABLE turn_run ADD COLUMN finished INTEGER;
`,
  },
  {
    version: 13,
    name: "RPH's job records in a table of their own",
    // `kv.ts` `jobRecords`: each record whole as JSON in `value`, with the columns a page is chosen and ordered by. The records RPH kept
    // before as plain keys (`jobs/all/<id>`) are moved here, so the jobs listed before are listed still.
    sql: `
CREATE TABLE job (
  user TEXT NOT NULL,
  id TEXT NOT NULL,
  started INTEGER NOT NULL,
  chat TEXT NOT NULL,
  state TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user, id)
);
CREATE INDEX job_by_start ON job (user, started DESC, id DESC);
INSERT OR REPLACE INTO job (user, id, started, chat, state, value)
  SELECT user, json_extract(value, '$.id'), json_extract(value, '$.started'), json_extract(value, '$.scope.chat'), json_extract(value, '$.state'), value
  FROM kv
  WHERE substr(key, 1, 9) = 'jobs/all/' AND json_valid(value)
    AND json_type(value, '$.id') = 'text' AND json_type(value, '$.started') IN ('integer', 'real')
    AND json_type(value, '$.scope.chat') = 'text' AND json_type(value, '$.state') = 'text';
DELETE FROM kv WHERE substr(key, 1, 9) = 'jobs/all/' AND EXISTS (SELECT 1 FROM job WHERE job.user = kv.user AND job.id = substr(kv.key, 10));
`,
  },
  {
    version: 14,
    name: "what each run's lead was not given of its prompt and its briefing",
    // JSON, as `runs.ts` reads it: a list of `NotGiven`. A run kept before has none, and reads as one given all.
    sql: `
ALTER TABLE turn_run ADD COLUMN not_given TEXT;
`,
  },
];

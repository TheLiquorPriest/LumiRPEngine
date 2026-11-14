// The turn lane's tables, as steps for the application's migration runner. Every table carries the
// user.
//
// Area `prompt` (plan Appendix B, "Prompt"): what each turn's request carried (its raw layout, the lore
// that activated for it, the history window's cut), the prompt map of each preset, and where RPH found
// each slice in a turn's prompt.
//
// Area `harness` (Appendix B, "Harness"): RPH's small durable state (`kv`), each turn's run as the Turn
// page shows it (`turn_run`: where it stands, its timings and usage, what went to the chat), and what
// RPH told RPE about the run (`turn_told`: rules that fired, consents, gap checks, suggestions,
// attachments asked for).

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
];

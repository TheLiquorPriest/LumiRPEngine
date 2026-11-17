// The app area's own tables (plan Appendix B, "App"): `provider_key` (the key Lumiverse sends on RPE's
// connection), `page_token` (the page tokens, the web UI's token and the extension's registration,
// each with its kind, who made it and when it ends), and the switches for anything that runs a
// command or calls out. Every key and token is kept as its SHA-256 alone; the key itself is shown
// once and never stored. Every row says whose it is, these the installation's own included (R-9): a key, a token and
// a switch hold for the user they were made or listed for.

import type { Migration } from "./migrations";

export const APP_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "keys, page tokens and switches",
    sql: `
CREATE TABLE app_key (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('provider', 'extension', 'web')),
  last4 TEXT NOT NULL,
  made INTEGER NOT NULL,
  retired INTEGER
);
CREATE INDEX app_key_current ON app_key (kind, retired);
CREATE TABLE page_token (
  hash TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  made_by TEXT NOT NULL,
  made INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX page_token_expires ON page_token (expires);
CREATE TABLE switch (
  name TEXT NOT NULL,
  digest TEXT NOT NULL,
  kind TEXT NOT NULL,
  what TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'on', 'off')),
  listed INTEGER NOT NULL,
  changed INTEGER,
  PRIMARY KEY (name, digest)
);
`,
  },
  {
    version: 2,
    name: "keys and switches carry the user",
    // The rows already there are the install's user's, given him in this same step (R-179).
    up: (db, user) => {
      db.run(`
CREATE TABLE app_key_user (
  user TEXT NOT NULL,
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('provider', 'extension', 'web')),
  last4 TEXT NOT NULL,
  made INTEGER NOT NULL,
  retired INTEGER
);
CREATE TABLE switch_user (
  user TEXT NOT NULL,
  name TEXT NOT NULL,
  digest TEXT NOT NULL,
  kind TEXT NOT NULL,
  what TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'on', 'off')),
  listed INTEGER NOT NULL,
  changed INTEGER,
  PRIMARY KEY (user, name, digest)
);`);
      db.run("INSERT INTO app_key_user (user, hash, kind, last4, made, retired) SELECT ?, hash, kind, last4, made, retired FROM app_key", [user]);
      // Kept in the order they were listed: the newest definition of a name is the one listed last.
      db.run("INSERT INTO switch_user (rowid, user, name, digest, kind, what, state, listed, changed) SELECT rowid, ?, name, digest, kind, what, state, listed, changed FROM switch", [user]);
      db.run(`
DROP TABLE app_key;
ALTER TABLE app_key_user RENAME TO app_key;
CREATE INDEX app_key_current ON app_key (user, kind, retired);
DROP TABLE switch;
ALTER TABLE switch_user RENAME TO switch;`);
    },
  },
  {
    version: 3,
    name: "the provider key in provider_key, the web token and the extension's key in page_token",
    // Every key in force still opens what it opened: its hash moves, and a key retired already is not kept. The web token has no end, as it had none unless `auth.webKeyDays` said so; a token made from now on carries the end its setting gives it.
    up: (db) => {
      db.run(`
CREATE TABLE provider_key (
  user TEXT NOT NULL,
  hash TEXT PRIMARY KEY,
  last4 TEXT NOT NULL,
  made INTEGER NOT NULL,
  taken INTEGER NOT NULL DEFAULT 0 CHECK (taken IN (0, 1))
);
CREATE INDEX provider_key_user ON provider_key (user);
CREATE TABLE page_token_kinds (
  hash TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'web', 'extension')),
  made_by TEXT NOT NULL,
  made INTEGER NOT NULL,
  expires INTEGER
);`);
      db.run("INSERT INTO provider_key (user, hash, last4, made, taken) SELECT user, hash, last4, made, CASE WHEN last4 = '' THEN 1 ELSE 0 END FROM app_key WHERE kind = 'provider' AND retired IS NULL");
      db.run("INSERT INTO page_token_kinds (hash, user, kind, made_by, made, expires) SELECT hash, user, 'page', made_by, made, expires FROM page_token");
      db.run("INSERT INTO page_token_kinds (hash, user, kind, made_by, made, expires) SELECT hash, user, kind, CASE kind WHEN 'web' THEN 'command line' ELSE 'rpe start' END, made, NULL FROM app_key WHERE kind IN ('web', 'extension') AND retired IS NULL");
      db.run(`
DROP TABLE app_key;
DROP TABLE page_token;
ALTER TABLE page_token_kinds RENAME TO page_token;
CREATE INDEX page_token_user_kind ON page_token (user, kind);
CREATE INDEX page_token_expires ON page_token (expires);`);
    },
  },
  {
    version: 4,
    name: "the models each provider key taken at the swap opens",
    // `models`: a key taken at the swap is paired with the model names of the connections that hold it (R-109), as a JSON list; null
    // for RPE's own key, which opens the models its own connection names, and for a key taken before a row named any.
    sql: "ALTER TABLE provider_key ADD COLUMN models TEXT;",
  },
];

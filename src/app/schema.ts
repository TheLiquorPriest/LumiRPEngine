// The app area's own tables (plan Appendix B, "App"): the keys RPE was given out (provider, extension
// registration, web UI), page tokens, and the switches for anything that runs a command or calls
// out. Every key and token is kept as its SHA-256 alone; the key itself is shown once and never
// stored. Every row says whose it is, these the installation's own included (R-9): a key, a token and
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
];

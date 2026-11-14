// The app area's own tables (plan Appendix B, "App"): the keys RPE was given out (provider, extension
// registration, web UI), page tokens, and the switches for anything that runs a command or calls
// out. Every key and token is kept as its SHA-256 alone; the key itself is shown once and never
// stored. Keys and switches belong to this RPE as a whole, so only a page token carries a user.

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
];

---
description: What the migration says of a chat that holds records of the previous build and that a run did not carry - said first, ahead of the report, in what rpe migrate and rpe up print, and at the top of the Migration page while its record of why is kept - with the cause in one plain sentence made from that record, where the records are kept, and what to do; of a chat a later run carried, and when; and the closing line of a command that ends with exit code 1 for them. Each line says what is so and what to do; none asks anything. One line per name, a name, a colon, then its text. A name in double braces puts in what the run knows (a chat's name, its character's and its id, a count, a folder or a file, a command line to run, a time); a block opened with a hash and closed with a slash shows only when that value is there, and one opened with a caret only when it is not. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  migration_not_carried_head, migration_not_carried_page: the head of the notice, in a command's output and at the top of the Migration page - count, folder (where each chat's record of why is kept)
  migration_not_carried_chat: one chat not carried, in one sentence made from its record of why - label (as migration_not_carried_label names it), why (the stage it failed in), number and swipe (the message it stood at, by its place in the chat; none where it stood at none), error (the first line of the error's own words; none where the record is gone), file (its record; none where he removed it)
  migration_not_carried_label: how a chat is named, in the command's output and on the page - its name in Lumiverse (none where Lumiverse's database cannot be read or names none), its character's name (none for a chat with no character), and its id - name, character, chat
  migration_not_carried_read, migration_not_carried_fold, migration_not_carried_store, migration_not_carried_check: the stage a chat failed in - reading the previous build's records, its fold, RPE's store taking what the fold gave, the check against the previous build's state
  migration_not_carried_stands, migration_not_carried_none, migration_not_carried_kept: what of the chat RPE holds and what it does not, and that the previous build's data holds it all
  migration_not_carried_again, migration_not_carried_again_switched, migration_not_carried_back: what to do - line, the command to run
  migration_carried_now, migration_carried_page: a chat a run carried that an earlier run could not, in the command's output and on the page - label, at (when the run that carried it read the previous build's data), failed (when the run that could not was; none where its record no longer said)
  migration_not_carried_end, migration_not_carried_end_switch: a command's closing line where it ends with exit code 1 for them - count
---
migration_not_carried_head: Not carried: {{count}} chat(s) that hold records of the previous build. This run did not bring them into RPE. Each is named below with the cause, what of it RPE holds, and what to do; the rest of the report follows. The record of each failure (the error, where in RPE's code it was raised, and where in the chat's records it stood) is kept in {{folder}}, readable by your account alone, until a run carries the chat.
migration_not_carried_page: The last real run did not carry {{count}} chat(s) that hold records of the previous build. Each is named below with the cause, what of it RPE holds, and what to do. The record of each failure is kept in {{folder}} until a run carries the chat.
migration_not_carried_chat: {{label}}: {{why}}{{#number}}, at message {{number}} (swipe {{swipe}}){{/number}}{{#error}}: {{error}}{{/error}}.{{#file}} See {{file}}.{{/file}}
migration_not_carried_label: {{#name}}{{name}}{{#character}}, with {{character}}{{/character}} ({{chat}}){{/name}}{{^name}}{{chat}}{{/name}}
migration_not_carried_read: the previous build's reader could not read its records
migration_not_carried_fold: the previous build's own fold failed on it
migration_not_carried_store: RPE's store refused what the previous build's fold gave for it
migration_not_carried_check: the check against the previous build's state could not be made
migration_not_carried_stands: RPE holds it as an earlier run carried it. What was played on it in the previous build since that run is not in RPE.
migration_not_carried_none: RPE holds nothing of it: no run has carried it.
migration_not_carried_kept: The previous build's data holds all of it, unchanged.
migration_not_carried_again: Once the cause is mended, run {{line}}: it carries the chat with everything played on it since.
migration_not_carried_again_switched: Once the cause is mended, run {{line}} while RPE's service is stopped: it carries the chat with everything played on it since.
migration_not_carried_back: To go back to the previous build instead, run {{line}} and follow the steps it prints.
migration_carried_now: Carried now: {{label}}, which {{#failed}}the run of {{failed}}{{/failed}}{{^failed}}an earlier run{{/failed}} could not carry. Its record of why is closed.
migration_carried_page: {{label}} was carried by the run of {{at}}, after {{#failed}}the run of {{failed}}{{/failed}}{{^failed}}an earlier run{{/failed}} could not carry it.
migration_not_carried_end: {{count}} chat(s) that hold records of the previous build were not carried, as said ahead of the report, so this command ends with exit code 1.
migration_not_carried_end_switch: The switch went through, and RPE answers in the previous runtime's place; but {{count}} chat(s) that hold records of the previous build were not carried, as said ahead of the report, so this command ends with exit code 1.

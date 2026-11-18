---
description: What the migration says of a chat that holds records of the previous build and that a run did not carry - said first, ahead of the report, in what rpe migrate and rpe up print, and at the top of the Migration page while the last real run's report holds one - and the closing line of a command that ends with exit code 1 for it. Each line says what is so and what to do; none asks anything. One line per name, a name, a colon, then its text. A name in double braces puts in what the run knows (a chat's id, a count, a command line to run). Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  migration_not_carried_head, migration_not_carried_page: the head of the notice, in a command's output and at the top of the Migration page - count
  migration_not_carried_chat: one chat not carried, by its id, with why - chat, why
  migration_not_carried_fold, migration_not_carried_store, migration_not_carried_unopened: why a chat was not carried
  migration_not_carried_stands, migration_not_carried_none, migration_not_carried_kept: what of the chat RPE holds and what it does not, and that the previous build's data holds it all
  migration_not_carried_again, migration_not_carried_again_switched, migration_not_carried_back: what to do - line, the command to run
  migration_not_carried_end, migration_not_carried_end_switch: a command's closing line where it ends with exit code 1 for them - count
---
migration_not_carried_head: Not carried: {{count}} chat(s) that hold records of the previous build. This run did not bring them into RPE. Each is named below with why, what of it RPE holds, and what to do; the rest of the report follows.
migration_not_carried_page: The last real run did not carry {{count}} chat(s) that hold records of the previous build. Each is named below with why, what of it RPE holds, and what to do.
migration_not_carried_chat: {{chat}}: {{why}}
migration_not_carried_fold: the previous build's own fold failed on it, so its turns could not be read
migration_not_carried_store: RPE's store refused what the previous build's fold gave for it
migration_not_carried_unopened: the previous build's reader could not open it, as its world could not be read
migration_not_carried_stands: RPE holds it as an earlier run carried it. What was played on it in the previous build since that run is not in RPE.
migration_not_carried_none: RPE holds nothing of it: no run has carried it.
migration_not_carried_kept: The previous build's data holds all of it, unchanged.
migration_not_carried_again: Once the cause is mended, run {{line}}: it carries the chat with everything played on it since.
migration_not_carried_again_switched: Once the cause is mended, run {{line}} while RPE's service is stopped: it carries the chat with everything played on it since.
migration_not_carried_back: To go back to the previous build instead, run {{line}} and follow the steps it prints.
migration_not_carried_end: {{count}} chat(s) that hold records of the previous build were not carried, as said ahead of the report, so this command ends with exit code 1.
migration_not_carried_end_switch: The switch went through, and RPE answers in the previous runtime's place; but {{count}} chat(s) that hold records of the previous build were not carried, as said ahead of the report, so this command ends with exit code 1.

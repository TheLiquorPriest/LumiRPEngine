---
description: The words an agent is told about its tool calls - what RPH's own tools answer, and what a call is answered with when it could not run or its tool failed. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words; on some connections the model is then shown its provider's own note that the tool gave nothing, such as "(no tool output)".
format: lines
---
failed: {{tool}} failed.
unfinished: {{tool}} was stopped before it finished. It may have done its work, or not.
not_held: You hold no tool named {{tool}}.
invalid: {{tool}} was not run: the arguments you sent do not fit what it takes.{{#misfits}} {{argument}} {{#missing}}is missing{{/missing}}{{^missing}}does not fit{{/missing}}.{{/misfits}}{{#parameters}} It takes {{parameters}}.{{/parameters}}
cut_short: {{tool}} was not run: your message reached its length limit, so its arguments may be cut short. Call it again.
not_switched_on: {{tool}} was not run: {{name}} {{#waiting}}waits for the player to switch it on{{/waiting}}{{^waiting}}is switched off{{/waiting}}.
never: {{tool}} was not run: it writes to {{lane}}, where the player allows no writes.
declined: {{tool}} was not run: the player said no.{{#reason}} Their reason: {{reason}}{{/reason}}
clipped: [{{shown}} of {{length}} characters shown; {{left}} left out{{#reports_left}}, among them {{reports_left}} of its {{reports}} reports{{/reports_left}}.{{#path}} The whole answer is in {{path}}.{{/path}}]
missing: There is no file at {{path}}.
folder: {{path}} is a folder. List what is in it with file_find.
empty: {{path}} is empty.
past_end: {{path}} has {{lines}} lines.
refused_yours: Agents do not write at {{path}}. Outside {{writable}}, the files are the player's own: agents read them and never write them. You may write in {{writable}}.
refused_generated: {{path}} is kept by the system for agents to read. You may write in {{writable}}.
refused_mounted: {{path}} is in a shared level of files, which agents read and never write. You may write in {{writable}}.
refused_outside: {{path}} is outside the files you can see.
refused_link: {{path}} passes through a link, and links are never followed.
refused_invalid: {{path}} is not a path.
no_file: There is no file at {{path}} to change.
not_file: {{path}} is a folder, not a file.
no_match: The text to replace is not in {{path}}.
several: The text to replace is in {{path}} {{matches}} times. Give more of the text around it, or replace them all.
wrote: Wrote {{path}} ({{bytes}} bytes).
appended: Added to {{path}} ({{bytes}} bytes now).
edited: Changed {{path}} ({{bytes}} bytes now).
deleted: Deleted {{path}}.
needs: {{op}} needs {{fields}}.
none_found: Nothing found.
hit_file: {{path}}
hit_folder: {{path}}/
hit_line: {{path}}:{{line}}: {{text}}
bad_pattern: {{pattern}} is not a pattern that can be searched for.
todo: {{open}} open, {{done}} done.
no_writer: There is no agent definition named {{writer}} to write the reply.
no_draft: There is no draft to release yet.
second_reply: The reply for this turn has already gone out. Nothing more goes to the chat.
not_now: {{tool}} was not run: this call comes before the turn's own work, and the reply goes out from that work.
released: The reply went out.
not_written: {{writer}} gave no reply{{#failed}}: a call to its model failed{{/failed}}{{#limit}}: it reached one of its limits{{/limit}}{{#stopped}}: it was stopped{{/stopped}}.

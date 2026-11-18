---
description: The words an agent is told about its tool calls - what RPH's own tools answer, what a call is answered with when it did not run (a tool the host no longer offers, arguments that do not fit or are not JSON, a limit), never began, came past the count of calls in an answer or its tool failed, what a message to a sub-agent is answered with when it came past that agent's count of messages, the notes given beside a tool's own answer about a rule on it or about keeping its whole, what a tool's answer that holds no words says, what a tool of the player's own (a command, an address or a server's tool) answers when it ran out of time, answered more than is read, answered with what is not JSON, failed by its command's code or its address's status, sends a secret that is not set, or has a server that could not be started or reached or that stopped during the call, what a tool that needs a chat answers in a job that belongs to none, a search that stopped before it looked everywhere, and what the player said to an agent at work - and why a turn or a job ended failed when its session file could not be written (session_unwritten, the end of a job's report and the reason a turn's run failed; over is there when the run was stopped because the lines held passed the setting sessions.maxUnwrittenMiB). One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words, and is then sent with the line empty_answer; delete the line of a note beside a tool's own answer and the answer goes with no note. Delete empty_answer or pictures_answer and such an answer goes as it is; on some connections the model is then shown its provider's own note, such as "(no tool output)" or "(see attached image)". Delete said and the player's words go to the agent bare, with nothing to say they are the player's. Delete session_unwritten and such a run still ends failed, with no words for why.
format: lines
---
failed: {{tool}} failed.
unfinished: {{tool}} was stopped before it finished. It may have done its work, or not.
not_started: {{tool}} did not run: a limit was already spent when it was called, so it never started.
rule_unasked: A rule on what {{tool}} answered could not be asked. The answer stands as it is.
not_kept: The whole of {{tool}}'s answer could not be kept, so no file holds what was left out.
past_answer_count: {{tool}} was not run: the count of tool calls in one answer is {{max}}, and this call is past it.
past_message_count: {{agent}} was not run: the count of messages it is sent after its first answer is {{max}}, and this one is past it.
said: The player said to you while you were at work: {{words}}
not_held: You hold no tool named {{tool}}.
withdrawn: {{tool}} was not run: it is not offered any more. It was among your tools when this session began.
invalid: {{tool}} was not run: {{#unparsed}}the arguments you sent are not JSON, so none could be read.{{#parameters}} It takes {{parameters}}.{{/parameters}} What was sent: {{arguments}}{{/unparsed}}{{^unparsed}}the arguments you sent do not fit what it takes.{{#misfits}} {{argument}} {{#missing}}is missing{{/missing}}{{^missing}}does not fit{{/missing}}{{#choices}}; it takes one of {{choices}}{{/choices}}.{{/misfits}}{{#parameters}} It takes {{parameters}}.{{/parameters}}{{/unparsed}}
cut_short: {{tool}} was not run: your message reached its length limit, so its arguments may be cut short. Call it again.
not_switched_on: {{tool}} was not run: {{name}} {{#waiting}}waits for the player to switch it on{{/waiting}}{{^waiting}}is switched off{{/waiting}}.
never: {{tool}} was not run: it writes to {{lane}}, where the player allows no writes.
declined: {{tool}} was not run: the player said no.{{#reason}} Their reason: {{reason}}{{/reason}}
clipped: [{{shown}} of {{length}} characters shown; {{left}} left out{{#reports_left}}, among them {{reports_left}} of its {{reports}} reports{{/reports_left}}.{{#path}} The whole answer is in {{path}}.{{/path}}]
missing: There is no file at {{path}}.
folder: {{path}} is a folder. List what is in it with file_find.
empty: {{path}} is empty.
past_end: {{path}} has {{lines}} lines.
refused_yours: Agents do not write at {{path}}. Notes go in {{writable}}; the rest of the files are read, never written.
refused_generated: {{path}} is kept by the system for agents to read, not to write. Notes go in {{writable}}.
refused_mounted: {{path}} is in a shared level of files, which agents read and never write. Notes go in {{writable}}.
refused_outside: {{path}} is outside the files you can see. Notes go in {{writable}}.
refused_link: {{path}} passes through a link, and links are never followed. Notes go in {{writable}}.
refused_invalid: {{path}} is not a path. Notes go in {{writable}}.
no_file: There is no file at {{path}} to change.
not_file: {{path}} is a folder, not a file.
no_match: The text to replace is not in {{path}}.
several: The text to replace is in {{path}} {{matches}} times. Give more of the text around it, or replace them all.
wrote: Wrote {{path}} ({{bytes}} bytes).
appended: Added to {{path}} ({{bytes}} bytes now).
edited: Changed {{path}} ({{bytes}} bytes now).
deleted: Deleted {{path}}.
now_text: {{path}} now reads ({{lines}} lines):
now_stretch: Lines {{from}} to {{to}} of {{path}} now read:
now_line: {{line}}: {{text}}
now_removed: The lines were taken out of {{path}}. It now has {{lines}} lines; the cut is at line {{at}}.
needs: {{op}} needs {{fields}}.
none_found: Nothing found.
hit_file: {{path}}
hit_folder: {{path}}/
hit_line: {{path}}:{{line}}: {{text}}
stopped_limit: This stopped at {{max}} results, and there are more. Narrow it: {{#list}}give the path of a deeper folder.{{/list}}{{#glob}}give the path of a folder, or a closer glob.{{/glob}}{{#grep}}give the path of a folder, a glob for the files, or a closer pattern.{{/grep}}
stopped_large: {{files}} files over {{bytes}} bytes were not searched. Read one with file_read, a few lines at a time, or give the path of the file.
stopped_cut: {{lines}} of these lines were cut to {{chars}} characters. Read the file at that line with file_read to see it whole.
stopped_time: This ran out of time after {{ms}} milliseconds, so it did not look everywhere. Narrow it: give the path of a folder{{#grep}}, a glob for the files, or a closer pattern{{/grep}}.
bad_pattern: {{pattern}} is not a pattern that can be searched for.
todo: {{open}} open, {{done}} done.
no_writer: No reply was written: {{^writer}}your definition names no agent to write it{{/writer}}{{#writer}}{{writer}}, the agent your definition names to write it, {{#missing}}has no definition{{/missing}}{{#off}}is switched off{{/off}}{{#broken}}has a definition that does not load{{/broken}}{{^missing}}{{^off}}{{^broken}}cannot be used{{/broken}}{{/off}}{{/missing}}{{/writer}}.
no_draft: There is no draft to release yet.
second_reply: The reply for this turn has already gone out. Nothing more goes to the chat.
released: The reply went out.
not_written: {{writer}} gave no reply{{#failed}}: a call to its model failed{{/failed}}{{#limit}}: it reached its limit on {{hit.limit}} per {{hit.per}}, {{hit.value}} against {{hit.max}}{{/limit}}{{#stopped}}: it was stopped{{/stopped}}.
not_written_floor: {{writer}} gave no reply: of its limit of {{hit.max}} on {{hit.limit}} per {{hit.per}}, {{hit.left}} was left{{#hit.is.tokens}} once its next call's prompt was counted{{/hit.is.tokens}}, less than the least room an answer is given ({{hit.floor}} tokens), so its call was not made.
empty_answer: {{tool}} answered with nothing.
pictures_answer: {{tool}} answered with these pictures alone.
timed_out: {{tool}} did not answer within {{seconds}} seconds, so it was stopped. It may have done its work, or not.
answer_cut: {{tool}} answered with more than {{bytes}} bytes, the most that is read, so its answer was not read.
not_json: {{tool}} answered with something that is not JSON{{#said}}: {{said}}{{/said}}
command_exit: {{tool}} failed: its command ended with code {{code}}.{{#said}} It said: {{said}}{{/said}}
http_status: {{tool}} failed: its address answered {{status}}.{{#said}} It said: {{said}}{{/said}}
secret_unset: {{tool}} was not run: the secret {{secret}} it sends as {{header}} is not set. The player sets it on the Connections page.
server_failed: {{tool}} was not run: its server {{server}} could not be started or reached.
server_stopped: {{tool}} did not finish: its server {{server}} stopped during the call. It is started again at the next call.
no_chat: {{tool}} did nothing: this job belongs to no chat, so there is no chat for it to read or write.
session_unwritten: The session file {{path}} could not be written ({{reason}}){{#over}}, and the run was stopped when the lines held for it passed the {{most}} MiB allowed{{/over}}. Its lines are held, and go out with the next write that lands.

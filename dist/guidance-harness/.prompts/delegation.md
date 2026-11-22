---
description: The words an agent is told about the agents it starts with delegate and task and talks to with agent_message - the line before a sub-agent's answer, why one ended without answering, what it could not be given, what an agent that plays a character named and could not hand on (withheld - it hands on only what it holds or could read itself), a purpose its definition does not have, a call that started nobody (too many deep, too many at once, a profile its definition does not let it start, or more given than its model has room for), a message to an agent that ended with the turn's reply, what came of dropping an agent's writes with agent_drop, and what a start would hand over when delegate or job_start asks for a preview (a line before, then a line for each name with its size and who named it, for each name nobody could find, for each name withheld, and for each name left out); what task answers (a line of how many pieces started; that no notes file could be shared where the pieces were to share one and the host gives no folder they may all write in; then for each piece a line of what it used and which lines of which file hold its whole answer before its answer cut to a receipt, or why it was not started; the heading each piece's whole answer has in that file; and why a piece cannot be a fork or play whom it was asked to); the answer a fork finds to the call that started it and to the other calls of the same message; the line before the answer of a reader, the agent that answers a question a reading tool was asked with (read), and why nobody answered one (no_reader) - and how a message of the chat, the head of a lore entry, who may know the entry, and a folder named as a file (by what is in it) are laid out in what an agent is given by name, a sub-agent or the lead. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words; on some connections the model is then shown its provider's own note that the tool gave nothing, such as "(no tool output)". A question a sub-agent asks is laid out by question.md.
format: lines
---
answered: {{agent}} answered:
stopped: {{agent}} was stopped before it answered. By then it had made {{calls}} model calls and {{tools}} tool calls.{{#wrote}} What it last wrote: {{wrote}}{{/wrote}}
limit: {{agent}} reached its limit on {{limit}} per {{per}} before it answered: {{value}}, against {{max}}{{#is.time}} (milliseconds){{/is.time}}{{#is.callTime}} (milliseconds){{/is.callTime}}. By then it had made {{calls}} model calls and {{tools}} tool calls.{{#wrote}} What it last wrote: {{wrote}}{{/wrote}}
limit_floor: {{agent}} stopped before it answered: of its limit of {{max}} on {{limit}} per {{per}}, {{left}} was left{{#is.tokens}} once its next call's prompt was counted{{/is.tokens}}, less than the least room an answer is given ({{floor}} tokens), so that call was not made. By then it had made {{calls}} model calls and {{tools}} tool calls.{{#wrote}} What it last wrote: {{wrote}}{{/wrote}}
failed: {{agent}} could not go on: {{#model}}a call to its model failed{{/model}}{{^model}}the system that runs it failed{{/model}}.
missing: {{agent}} was not given {{ref}}: it could not be found.
withheld: {{agent}} was not given {{ref}}: you play a character, and hand on only what you hold or could read yourself.
no_purpose: {{agent}} has no purpose {{for}}{{#listed}}: its purposes are {{purposes}}{{/listed}}{{^listed}}: its definition names none{{/listed}}. It was handed what its definition gives a start that names no purpose.
no_agent: There is no agent definition named {{agent}}.
no_model: {{agent}} was not started: there is no model for it to run on.
no_handle: No agent you started this turn goes by {{agent}}.
busy: {{agent}} is still at work. What it says comes back to the call that set it going.
dropped: What {{agent}} wrote this turn was dropped.
not_dropped: What {{agent}} wrote this turn could not be dropped.
depth: {{agent}} was not started: it would stand {{value}} deep, and {{max}} is the most allowed.
agents: {{agent}} was not started: this turn has started {{value}} agents, and {{max}} is the most allowed.
ended: {{agent}} ended when this turn's reply went out, so it cannot be messaged now.
too_large: {{agent}} was not started: what it is given is {{size}} tokens, and its model has room for {{room}}.{{#attachments}} {{name}} is {{tokens}} tokens.{{/attachments}}
nobody_to_ask: There is no one above you to ask.
preview: Nobody was started. {{agent}}{{#for}}, started for {{for}},{{/for}} would be handed {{tokens}} tokens of what it is given by name.{{#unknown}} It has no purpose {{for}}{{#listed}} (its purposes are {{purposes}}){{/listed}}, so it would be handed what its definition gives a start that names no purpose.{{/unknown}}
preview_item: {{ref}}: {{tokens}} tokens, {{#definition}}named by its definition{{/definition}}{{#caller}}added by you{{/caller}}{{#pin}}pinned for it by the player{{/pin}}.
preview_missing: {{ref}}: it could not be found, so it would not be handed over.
preview_withheld: {{ref}}: it would not be handed over, since you play a character and hand on only what you hold or could read yourself.
preview_left: {{ref}}: its definition names it, and you leave it out.
chat_message: #{{index}} {{name}}{{#hidden}} (hidden){{/hidden}}{{#summarized}} (summarized){{/summarized}}{{#outside_story}} (outside the story){{/outside_story}}: {{text}}
lore_entry: {{title}} ({{source}})
lore_known_by: Known only to {{names}}.
lore_gate: Known only to whoever passes its gate, {{gate}}, which {{#open}}holds{{/open}}{{^open}}does not hold{{/open}} now.
folder: {{path}} is a folder.{{#empty}} It holds no files.{{/empty}}{{^empty}} Its files, each by its path and size:{{/empty}}
folder_file: {{path}}{{#bytes}} ({{bytes}} bytes){{/bytes}}
folder_more: These are the first {{max}} of its files; it holds more.
task_none: No piece was given, so nobody was started.
task: {{started}} of {{count}} pieces were started; each came back as follows.
notes_none: No notes file was shared: this work has no folder that all its pieces may write in, so each piece worked alone.
piece: {{agent}}{{#name}} ({{name}}){{/name}} made {{calls}} model calls, sent {{sent}} tokens and wrote {{written}}.{{#file}} Its whole answer is lines {{from}} to {{to}} of {{file}}, {{tokens}} tokens{{#cut}}; its first {{shown}} follow{{/cut}}.{{/file}}
piece_heading: ## {{agent}}{{#name}} ({{name}}){{/name}}
piece_not_started: {{#name}}{{name}}: {{/name}}{{why}}
piece_stopped: {{#name}}{{name}}: {{/name}}{{agent}} was stopped before it started.
not_allowed: {{agent}} was not started: you may start {{#listed}}{{starts}}{{/listed}}{{^listed}}no agent{{/listed}}.
fork_other: {{agent}} was not started: a fork is of your own definition, {{definition}}.
fork_none: {{agent}} was not started as a fork: there is no work of yours for it to start from.
fork_plays: {{agent}} was not started as a fork: a fork is you at work on a piece, and you play nobody, so it cannot play {{asked}}. Leave fork out to start an agent that plays {{asked}}.
plays_held: {{agent}} was not started: you play {{plays}}, so what you start plays {{plays}} too, not {{asked}}.
fork_here: This is the call that started you, a fork of the agent that made it. What follows is your own task.
fork_elsewhere: This call's answer went to the agent that made it, not to you.
read: {{agent}} read what you asked about and answers:
no_reader: Your question was handed to nobody: {{#agent}}there is no agent definition named {{agent}} to answer it{{/agent}}{{^agent}}no agent is set to answer questions here{{/agent}}. Call the tool again without the question and read it yourself.

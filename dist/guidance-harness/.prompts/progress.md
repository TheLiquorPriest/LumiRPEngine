---
description: The lines shown in the chat's thinking block while a turn is being worked on. One kind of line per row, a name, a colon, then its text. Change the words freely. Delete a row and that kind of line is no longer shown. The row named still is the one that keeps a long silent turn alive; without it, the chat application may give up on a turn that shows nothing for long. The row named tool is shown as a tool begins; `doing` says what it does in a person's words, from the `doing:` of its file in `.tools/` (none where its file gives none), `tool` is its own name, `name` what the agent using it is called, and `nth` which of the turn's agents of that kind it is, where it is not the first. The row named rule is shown as a rule fires; `title` is what the rule is called, from the `title:` of its file (none where its file gives none), `rule` its file's name, and `shipped` is set for a rule shipped with the application, which nobody here wrote or changed. The row named retrying is shown when a call to a model failed and is made again; `is.<kind>` says what broke it (connection, timeout, overloaded, server, other), `wait` the wait before the next try in words (none where it is made at once), `next` that try's number and `most` the most tries there will be.
format: lines
---
started: Reading the turn.
tool: {{#doing}}Now {{doing}}.{{/doing}}{{^doing}}Now using {{tool}}.{{/doing}}
rule: {{#shipped}}A rule fired{{/shipped}}{{^shipped}}A rule of yours fired{{/shipped}}: {{#title}}{{title}}{{/title}}{{^title}}{{rule}}{{/title}}.
writing: Writing.
hook_waits: Waiting for a hook of yours to see the reply.
retrying: A call to the model failed ({{#is.connection}}the connection was lost{{/is.connection}}{{#is.timeout}}it timed out{{/is.timeout}}{{#is.overloaded}}the provider is busy{{/is.overloaded}}{{#is.server}}the provider's server failed{{/is.server}}{{#is.other}}the provider failed{{/is.other}}). Trying again{{#wait}} in {{wait}}{{/wait}}{{^wait}} at once{{/wait}}, try {{next}} of {{most}}.
still: Still working ({{elapsed}}).

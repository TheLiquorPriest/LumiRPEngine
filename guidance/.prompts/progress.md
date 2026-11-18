---
description: The lines shown in the chat's thinking block while a turn is being worked on. One kind of line per row, a name, a colon, then its text. Change the words freely. Delete a row and that kind of line is no longer shown, except the row named still, which keeps a long turn alive in Lumiverse. The row named retrying is shown when a call to a model failed and is made again; `is.<kind>` says what broke it (connection, timeout, overloaded, server, other), `seconds` is the wait before the next try, `next` that try's number and `most` the most tries there will be.
format: lines
---
started: Reading the turn.
waiting_previous: Finishing the last turn's work first.
tool: {{tool}}
delegate: Asking {{agent}}.
agents: {{count}} agents at work.
question: {{agent}} has a question.
rule: A rule of yours fired: {{rule}}.
writing: Writing.
hook_waits: Waiting for a hook of yours to see the reply.
retrying: A call to the model failed ({{#is.connection}}the connection broke{{/is.connection}}{{#is.timeout}}it timed out{{/is.timeout}}{{#is.overloaded}}the provider is busy{{/is.overloaded}}{{#is.server}}the provider's server failed{{/is.server}}{{#is.other}}it failed{{/is.other}}). Trying again in {{seconds}}s, try {{next}} of {{most}}.
still: Still working ({{elapsed}}).

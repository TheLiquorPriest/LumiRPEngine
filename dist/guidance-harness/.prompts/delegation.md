---
description: The words an agent is told about the agents it starts with delegate and talks to with agent_message - the line before a sub-agent's answer, why one ended without answering, what it could not be given, a call that started nobody (too many deep, too many at once, or more given than its model has room for), a message to an agent that ended with the turn's reply, and what came of dropping an agent's writes with agent_drop - and how a message of the chat, the head of a lore entry and who may know the entry are laid out in what an agent is given by name, a sub-agent or the lead. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words; on some connections the model is then shown its provider's own note that the tool gave nothing, such as "(no tool output)". A question a sub-agent asks is laid out by question.md.
format: lines
---
answered: {{agent}} answered:
stopped: {{agent}} was stopped before it answered.
limit: {{agent}} reached one of its limits before it answered.
failed: {{agent}} could not go on: {{#model}}a call to its model failed{{/model}}{{^model}}the system that runs it failed{{/model}}.
missing: {{agent}} was not given {{ref}}: it could not be found.
no_agent: There is no agent definition named {{agent}}.
no_model: {{agent}} was not started: there is no model for it to run on.
no_handle: No agent you started this turn goes by {{agent}}.
busy: {{agent}} is still at work. What it says comes back to the call that set it going.
dropped: What {{agent}} wrote this turn was dropped.
not_dropped: What {{agent}} wrote this turn could not be dropped.
depth: {{agent}} was not started: it would stand {{value}} deep, and the player allows {{max}}.
agents: {{agent}} was not started: this turn has started {{value}} agents, and the player allows {{max}}.
ended: {{agent}} ended when this turn's reply went out, so it cannot be messaged now.
too_large: {{agent}} was not started: what it is given is {{size}} tokens, and its model has room for {{room}}.{{#attachments}} {{name}} is {{tokens}} tokens.{{/attachments}}
nobody_to_ask: There is no one above you to ask.
chat_message: #{{index}} {{name}}{{#hidden}} (hidden){{/hidden}}{{#summarized}} (summarized){{/summarized}}{{#outside_story}} (outside the story){{/outside_story}}: {{text}}
lore_entry: {{title}} ({{source}})
lore_known_by: Known only to {{names}}.
lore_gate: Known only to whoever passes its gate, {{gate}}, which {{#open}}holds{{/open}}{{^open}}does not hold{{/open}} now.

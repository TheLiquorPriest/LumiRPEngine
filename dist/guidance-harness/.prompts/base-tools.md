---
description: The words RPH's base tools answer with - chat_read, chat_search, lore_read, lore_search, gap_check, skill_load, suggest, archive_search and web_search - and how a message of the chat, a lore entry, a thing kept in another store and a search hit are laid out in their answers. A gap check names the places it searched chat, lore, and each other place by the system's own name for it, which is how its saved evidence names them too. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words; on some connections the model is then shown its provider's own note that the tool gave nothing, such as "(no tool output)".
format: lines
---
none_found: Nothing found.
chat_range: Messages #{{from}} to #{{to}} of {{length}}.{{#most}} One read gives at most {{most}}.{{/most}}{{#left_out}} {{left_out}} of them, outside the story, are left out.{{/left_out}}
chat_message: #{{index}} ({{id}}) {{name}}{{#hidden}} (hidden){{/hidden}}{{#summarized}} (summarized){{/summarized}}{{#outside_story}} (outside the story){{/outside_story}}: {{text}}
chat_withheld: #{{index}} ({{id}}) {{name}} (hidden){{#outside_story}} (outside the story){{/outside_story}}: the chat's setting keeps its text from agents.
chat_hit: #{{index}} ({{id}}) {{name}}{{#outside_story}} (outside the story){{/outside_story}}: {{snippet}}{{#meaning}} (found by meaning){{/meaning}}
chat_empty: The chat has no messages yet.
chat_outside: The chat has {{length}} messages, #0 to #{{last}}, and none of them is in the stretch asked for.
no_message: There is no message {{id}} in this chat.
lore_entry: [{{id}}] {{title}} ({{source}}){{#keys}}. Keys: {{.}}{{/keys}}
lore_known_by: Known only to {{names}}.
lore_gate: Known only to whoever passes its gate, {{gate}}, which {{#open}}holds{{/open}}{{^open}}does not hold{{/open}} now.
lore_hit: [{{id}}] {{title}} ({{source}}): {{snippet}}{{#meaning}} (found by meaning){{/meaning}}
no_entry: There is no lore entry {{id}}.
lore_unread: Not read, since one read gives at most {{most}} entries: {{ids}}.
gap_head: Gap check {{id}}: {{topic}}{{#terms}}, with {{.}}{{/terms}}.
gap_place: {{where}}: {{count}} found.
gap_place_none: {{where}}: nothing found.
gap_hit: - {{ref}} {{title}}: {{snippet}}{{#meaning}} (found by meaning){{/meaning}}
gap_failed: {{where}} could not be searched.
gap_saved: What was searched and what came back is saved as {{path}}.
gap_unsaved: What was searched and what came back is not saved: this work belongs to no turn.
gap_no_topic: Name the topic to look for.
no_skill: There is no skill named {{name}}.
suggest_target: Say what the suggestion is for - a file, a lore entry, or new lore - and name only one.
suggested: The suggestion is with the player, who may accept it, change it or dismiss it. Nothing has changed.
suggest_full: The suggestion was not kept: the chat already has {{most}} suggestions waiting for the player.
archive_hit: {{ref}} {{title}} ({{store}}): {{snippet}}{{#meaning}} (found by meaning){{/meaning}}
archive_item: {{title}} ({{store}}, {{ref}})
archive_needs: Give the words to look for, or the ref of something found to read it in full.
no_item: There is nothing to read at {{ref}}.
no_store: There is no store named {{name}}.{{#stores}} The stores are {{.}}.{{/stores}}
web_hit: {{title}} - {{ref}}: {{snippet}}
web_off: Web search is off: no web search provider is set. Nothing was searched.
sessions_store: sessions
sessions_line: This chat's earlier sessions: what was written, intended and ruled in earlier scenes.
session_hit: Session {{session}}{{#turn}}, turn {{turn}}{{/turn}}, {{entry}}

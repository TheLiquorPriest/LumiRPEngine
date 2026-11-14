---
description: The words of the prompt map - what the prompt tool answers, how a part of the prompt is laid out when an agent reads it or is given it, the notices about the prompt's shape that the briefing shows, and the views of the prompt written in each turn's folder. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer or notice is given with no words; on some connections the model is then shown its provider's own note that the tool gave nothing, such as "(no tool output)". Under views, each file of the turn's folder is given the part of the prompt named beside it, by the names prompt reads; take a file out and it is not written.
format: lines
views:
  assembled-preset-prompt.md: "*"
  visible-chat-history.md: history
  preset-guidance.md: kind(instructions)
  persona.md: kind(persona)
  character.md: kind(character)
---
map_raw: This prompt has no map yet. Its parts are named by the chat application's own block names where it gave them, and by their place where it did not: message[3] is the fourth message.
map_learned: The parts of this prompt, as the map of {{preset}} names them.
map_slice: {{marker}} - {{kind}}{{#behaviour}}, {{behaviour}}{{/behaviour}}, {{length}} characters{{#line}}: {{line}}{{/line}}
map_unclaimed: {{marker}} - text that belongs to no part of the map, {{length}} characters
map_history: history - {{count}} chat messages, #{{first}} to #{{last}}, {{length}} characters
map_lore: Lore entries in this prompt, each read as lore[id]: {{ids}}
message_head: message[{{index}}] - {{role}}, {{length}} characters{{#images}}, {{images}} pictures{{/images}}
slice_head: [{{marker}}]
history_head: #{{index}} ({{id}}){{#name}} {{name}}{{/name}}, {{role}}
entry_head: [{{id}}] {{title}} ({{source}}){{#known_by}}. Known only to {{known_by}}.{{/known_by}}{{#gate}}. Known only to whoever passes its gate, {{gate.name}}, which {{#gate.open}}holds{{/gate.open}}{{^gate.open}}does not hold{{/gate.open}} now.{{/gate}}
layout_piece: {{name}} - {{length}} characters{{#history}}, chat message #{{history.index}}{{/history}}{{#lore}}, lore{{/lore}}{{#block}}, the chat application's block {{block.name}} ({{block.type}}){{/block}}
no_part: This prompt has no part named {{name}}.
no_prompt: There is no prompt to read: this work is not for a reply.
notice_unmapped: This preset's prompt has not been mapped yet. The whole prompt is in front of you as always. Its parts are named by place until it is mapped.
notice_incomplete: The chat application joined parts of this prompt in a way that cannot be told apart, so its parts cannot be found by name this turn.
notice_changed: The text of {{marker}}, which the map says is fixed, has changed since the turn before.
notice_gone: {{marker}} is not in this prompt.
notice_unclaimed: Text that belongs to no part of the map: {{#name}}{{name}}{{/name}}{{^name}}in message[{{message}}]{{/name}}, {{length}} characters.
notice_order: {{markers}} moved: the prompt's parts are in a different order than the turn before.
notice_preset: This prompt is from {{#now}}{{now.name}}{{#now.revision}}, revision {{now.revision}}{{/now.revision}}{{/now}}{{^now}}a preset the chat application did not name{{/now}}, where the turn before was from {{#was}}{{was.name}}{{#was.revision}}, revision {{was.revision}}{{/was.revision}}{{/was}}{{^was}}a preset it did not name{{/was}}.
write_saved: The map of {{preset}} is saved: {{count}} slices.
write_kept: The player's own slices are kept as the player left them: {{markers}}.
write_unclaimed: Text that belongs to no slice: {{names}}. Read it with prompt, and write the map again to give it a slice.
write_no_preset: The chat application did not say which preset this prompt is from, so no map can be kept for it.
write_none: Give at least one slice.
write_no_parts: {{marker}} names no part of the prompt.
write_reserved: {{marker}} cannot be a marker: it is empty, or prompt reads a name of that shape itself.
write_twice: {{marker}} is the marker of two slices.
write_kind: {{marker}}: {{kind}} is not a kind. The kinds are {{kinds}}.
write_behaviour: {{marker}}: {{behaviour}} is not how a slice behaves. It is one of {{behaviours}}.
write_unknown: {{marker}}: this prompt has no part named {{part}}.
write_not_part: {{marker}}: {{part}} is not a part a slice is made of. Chat history goes by message and lore by entry, without a map.
write_starts: {{marker}}: "{{starts}}" is not in {{part}}.
write_same_start: {{marker}} and {{other}} begin at the same place. Give the later one its first words as starts.
write_left_empty: {{marker}} is left with no text of its own.
write_players: {{marker}} is the player's own marker for another part of the prompt. Choose another.
view_left_out: Messages #{{from}} to #{{last}} of the chat are not in this prompt{{#covered}}; the story's record covers them{{/covered}}. chat_read reads them.

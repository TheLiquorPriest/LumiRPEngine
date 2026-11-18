---
description: The words of the prompt map - what the prompt tool answers, what the answers to a write of the map and to the player's edits of it say, how a part of the prompt is laid out when an agent reads it or is given it, and the views of the prompt written in each turn's folder. The notices about the prompt's shape are worded in the notices part. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words; on some connections the model is then shown its provider's own note that the tool gave nothing, such as "(no tool output)". Under views, each file of the turn's folder is given the part of the prompt named beside it, by the names prompt reads; take a file out and it is not written.
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
history_head: #{{index}} ({{id}}){{#name}} {{name}}{{/name}}, {{role}}{{#summarized}}, a summary the chat application put in place of messages{{/summarized}}
entry_head: [{{id}}] {{title}} ({{source}}){{#known_by}}. Known only to {{known_by}}.{{/known_by}}{{#gate}}. Known only to whoever passes its gate, {{gate.name}}, which {{#gate.open}}holds{{/gate.open}}{{^gate.open}}does not hold{{/gate.open}} now.{{/gate}}
layout_piece: {{name}} - {{length}} characters{{#role}}, {{role}}{{/role}}{{#history}}, chat message #{{history.index}}{{#summarized}}, a summary the chat application put in place of messages{{/summarized}}{{/history}}{{#lore}}, lore{{/lore}}{{#block}}, the chat application's block {{block.name}} ({{block.type}}){{/block}}
no_part: This prompt has no part named {{name}}.
no_prompt: There is no prompt to read: this work is not for a reply.
write_saved: The map of {{preset}} is saved: {{count}} slices.
write_kept: The player's own slices are kept as the player left them: {{markers}}.
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
edit_unmapped: This turn's prompt is not mapped, so there is nothing to edit.
edit_no_marker: The map has no slice with the marker {{marker}}.
edit_taken: {{marker}} is another slice's marker already.
edit_merge_two: A merge needs two slices or more.
edit_not_found: {{marker}} is not in this turn's prompt, so its text cannot be taken.
edit_no_words: The text of {{marker}} does not hold "{{words}}" past its start, so it cannot be split there.

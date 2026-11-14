---
description: The sentences the story tools answer with (story_query, story_record). A tool's answer is data from the story record and these lines, filled with that data. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words.
format: lines
---
no_chat: There is no chat {{id}} in the engine's records.
no_turn: There is no turn {{id}} in this chat.
turn_needed: This call belongs to no turn, so nothing can be recorded. Reading needs no turn.
no_operations: operations cannot be read: send a list of operations.
unknown_op: Operation {{n}}: op cannot be read, you sent {{value}}. It is one of: {{choices}}.
unreadable: {{field}} cannot be read{{#value}}: you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}
unreadable_op: Operation {{n}} ({{op}}): {{field}} cannot be read, you sent {{value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}
needs: Operation {{n}} ({{op}}) needs {{fields}}.
needs_one: Operation {{n}} ({{op}}) needs at least one of {{fields}}.
one_name: Operation {{n}} ({{op}}): who names one person, or plot.
no_message: Operation {{n}} ({{op}}): {{field}} names no message: you sent {{value}}, and the chat's messages are numbered 0 to {{last}}.
no_clock: Operation {{n}} ({{op}}): this chat keeps no story time, so {{field}} cannot be given.
unreadable_time: Operation {{n}} ({{op}}): {{field}} cannot be read, you sent {{value}}. Write a date and time (YYYY-MM-DD HH:MM) or a span from now (two days, until dawn).
unknown_id: {{#n}}Operation {{n}} ({{op}}): {{/n}}the story record on this path holds no {{#part}}{{part}} {{/part}}{{id}}.
no_current: Operation {{n}} ({{op}}): there is no {{part}} yet. Open one with new.
nothing_recorded: Nothing was recorded. Send the call again with that put right.
never: Operation {{n}} ({{op}}) was not recorded: it writes to the {{lane}} lane, where the player allows no writes.
declined: Operation {{n}} ({{op}}) was not recorded: the player said no.{{#reason}} Their reason: {{reason}}{{/reason}}
already_closed: Operation {{n}} ({{op}}): {{id}} was already closed.
due_now: Operation {{n}} ({{op}}): it falls due at {{due}}, which is not after now ({{now}}), so it is due at once.
no_overlays: Operation {{n}} ({{op}}): this host keeps no lore overlays yet, so none was written.
overlay_unknown: Operation {{n}} (overlay): there is no lore entry {{entry}}.{{#near}} Near: {{near}}.{{/near}}
none: Nothing in the story record matches.
no_clock_due: This chat keeps no story time, so nothing falls due.
more: {{count}} more match. Ask again with a part, a range or a name to see them; the next is {{next}}.

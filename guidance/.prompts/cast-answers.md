---
description: The sentences the cast tools answer with (cast_query, cast_update). A tool's answer is data from the cast and these lines, filled with that data. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words.
format: lines
---
no_chat: There is no chat {{id}} in the engine's records.
no_turn: There is no turn {{id}} in this chat.
no_operations: operations cannot be read: send a list of operations.
unknown_op: Operation {{n}}: op cannot be read, you sent {{value}}. It is one of: {{choices}}.
unreadable: {{field}} cannot be read{{#value}}: you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}
unreadable_op: Operation {{n}} ({{op}}): {{field}} cannot be read, you sent {{value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}
out_of_range: Operation {{n}} ({{op}}): {{field}} runs from {{min}} to {{max}}, and you sent {{value}}.
needs: Operation {{n}} ({{op}}) needs {{fields}}.
needs_one: Operation {{n}} ({{op}}) needs at least one of {{fields}}.
turn_needed_op: Operation {{n}} ({{op}}) is kept with a turn, and this call belongs to none.
unknown_who: Operation {{n}} ({{op}}): there is no {{who}} in the cast. Cast them first, in this call or an earlier one.
one_source: Operation {{n}} ({{op}}) binds one source: one of {{choices}}.
no_source: Operation {{n}} ({{op}}): Lumiverse holds no {{kind}} {{id}}.
not_bound: Operation {{n}} ({{op}}): {{who}} has no {{kind}} {{id}} bound.
unknown_id: Operation {{n}} ({{op}}): {{who}} has no {{part}} {{id}} on this path.
nothing_recorded: Nothing was written. Send the call again with that put right.
never: Operation {{n}} ({{op}}) was not written: it writes to the {{lane}} lane, where the player allows no writes.
declined: Operation {{n}} ({{op}}) was not written: the player said no.{{#reason}} Their reason: {{reason}}{{/reason}}
pinned: Operation {{n}} (cast): the player pinned {{who}} as {{as}}, and that stands. Your casting is kept for when the pin is taken away.
no_cast: No one is cast on this path yet.
no_character: There is no {{who}} in the cast.
not_cast: {{who}} has no casting on this path.
more: {{count}} more in {{part}}. Ask again with skip {{skip}} to see them.

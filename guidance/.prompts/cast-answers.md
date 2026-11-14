---
description: The sentences the cast tools answer with (cast_query, cast_update, perceive, recall, remember, reflect, dream). A tool's answer is data from the cast and these lines, filled with that data. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words.
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
pinned: Operation {{n}} (cast): the player pinned {{who}} as {{as}}, and that stands. Your casting is kept for when the pin is taken away.
no_cast: No one is cast on this path yet.
no_character: There is no {{who}} in the cast.
not_cast: {{who}} has no casting on this path.
more: {{count}} more in {{part}}. Ask again with skip {{skip}} to see them.
no_perceptions: perceptions cannot be read: send a list of perceptions.
perceive_turn: A perception is kept with a turn, and this call belongs to none.
not_in_cast: Perception {{n}}: there is no {{who}} in the cast. Cast them with cast_update first.
no_message: Operation {{n}} ({{op}}): there is no reply {{message}} on this path.
not_secret: Operation {{n}} ({{op}}): {{value}} is not a secret's id. A secret is named by the id the lore map shows it with.
no_world_secret: Operation {{n}} ({{op}}): this chat plays no world the engine can read, so it holds no secrets.
no_holder: Operation {{n}} ({{op}}): no one in the world is named {{who}}, so a secret cannot be held by them.
no_teller: Operation {{n}} ({{op}}): a secret someone was told is held with its teller, and no one in the world is named {{who}}.
many_named: Operation {{n}} ({{op}}): {{count}} people in the world are named {{who}}: {{ids}}.
unknown_secret: Operation {{n}} ({{op}}): this chat holds no secret {{secret}}.
secret_refused: Operation {{n}} ({{op}}): the secret {{secret}} cannot be held by {{who}} ({{code}}).
memory_turn: A memory is kept with a turn, and this call belongs to none.
plays_none: {{tool}} is a character's own, and this agent plays no one.
no_memories_sent: memories cannot be read: send a list of memories.
no_memories: Nothing comes back for {{cue}}.
more_memories: {{count}} more memories touch {{cue}}. Recall again with skip {{skip}} to bring them back.

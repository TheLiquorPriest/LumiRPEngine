---
description: The sentences the cast tools answer with (cast_query, cast_update, perceive, recall, remember, reflect, dream, mind_set, relate). A tool's answer is data from the cast and these lines, filled with that data. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words. The lines named wants_ (what an argument takes) are words put inside the other lines. The Cast page is told in these words too when it is refused (no_chat, no_turn, no_character, unreadable, and the lines named page_, which only the page uses).
format: lines
---
no_chat: There is no chat {{id}} in the engine's records.
no_chat_run: {{tool}} works on a chat's cast, and this run belongs to no chat: nothing was done.
no_turn: There is no turn {{id}} in this chat.
turn_joined: Turn {{turn}} was joined to turn {{joined}}, the turn the continue extended, so nothing was read or written here. Address turn {{joined}} instead.
store_unread: The cast could not read that call: {{why}}
engine_fault: {{tool}} failed in the engine, not in your call: the fault is in RPE's log. Nothing was recorded.
no_operations: operations cannot be read: send a list of operations.
unknown_op: Operation {{n}}: op cannot be read, you sent {{value}}. It is one of: {{choices}}.
unreadable: {{field}} cannot be read{{#value}}: you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}
unreadable_op: Operation {{n}} ({{op}}): {{field}} cannot be read, you sent {{value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}{{#wants}} It takes {{wants}}.{{/wants}}
outside_list: Operation {{n}} ({{op}}): {{field}} {{value}} is not one of what a {{field}} can hold: {{choices}}.{{#records}} Whatever you meant by it, write it in {{records}}, which keeps your words as given.{{/records}}
wants_name: a name or an id
wants_texts: a text, or a list of texts
wants_whole: a whole number from 0
op_takes: {{op}} reads {{reads}}{{#needs}}, and needs {{needs}}{{/needs}}{{#new_needs}}, and a new one needs {{new_needs}}{{/new_needs}}.{{#ignored}} It does not read {{ignored}}.{{/ignored}}
not_read: Operation {{n}} ({{op}}) was written without {{left}}. It reads {{reads}}.
out_of_range: Operation {{n}} ({{op}}): {{field}} runs from {{min}} to {{max}}, and you sent {{value}}.
past_scale: Operation {{n}} ({{op}}): {{field}} runs from {{min}} to {{max}}, and you sent {{value}}. It was kept as sent.
no_ref: Operation {{n}} ({{op}}): {{said}} names nothing in the world{{#near}}; the nearest are {{near}}{{/near}}. It was kept as you wrote it, without a reference.
no_person: Operation {{n}} ({{op}}): no one in the world is named {{said}}{{#near}}; the nearest are {{near}}{{/near}}. The character was not tied to anyone.
needs: Operation {{n}} ({{op}}) needs {{fields}}.
needs_one: Operation {{n}} ({{op}}) needs at least one of {{fields}}.
added: {{who}} was not in the cast, so they were added to it, not yet cast.
one_source: Operation {{n}} ({{op}}) binds one source: one of {{choices}}.
no_source: Operation {{n}} ({{op}}): Lumiverse holds no {{kind}} {{id}}.{{#near}} The nearest {{kind}} ids bound in this chat: {{near}}.{{/near}}
already_so: Operation {{n}} ({{op}}): {{who}} has no {{kind}} {{id}} bound, which was already so; nothing changed.
unknown_beat: Operation {{n}} ({{op}}): the story holds no beat {{id}}, so it is not linked{{#near}}; the nearest beats are {{near}}{{/near}}.
unknown_id: Operation {{n}} ({{op}}): {{who}} has no {{part}} {{id}} on this path.{{#near}} The nearest {{who}} has: {{near}}.{{/near}}
no_file: Operation {{n}} ({{op}}): {{who}} has no old mind file {{file}} on this path.{{#files}} Theirs are: {{files}}.{{/files}}
nothing_recorded: Nothing was written. Send the call again with that put right.
unsourced: Operation {{n}} ({{op}}) names no source, so it is marked unsourced.
invented_unchecked: Operation {{n}} ({{op}}) is recorded as invented and names no gap check, so it is marked so.
invented_unconsented: Operation {{n}} ({{op}}) is recorded as invented and names no consent, so it is marked so.
pinned: Operation {{n}} (cast): the player pinned {{who}} as {{as}}, and that stands. Your casting is kept for when the pin is taken away.
no_cast: No one is cast on this path yet.
no_character: There is no {{who}} in the cast{{#near}}; the nearest names are {{near}}{{/near}}.
no_knowers: No one the cast holds knows that.
not_cast: {{who}} has no casting on this path.
more: {{count}} more in {{part}}. Ask again with skip {{skip}} to see them.
no_perceptions: perceptions cannot be read: send a list of perceptions.
no_message: Operation {{n}} ({{op}}): there is no reply {{message}} on this path.
not_secret: Operation {{n}} ({{op}}): {{value}} is not a secret's id. A secret is named by the id the lore map shows it with.
no_world_secret: Operation {{n}} ({{op}}): this chat plays no world the engine can read, so it holds no secrets.
no_holder: Operation {{n}} ({{op}}): no one in the world is named {{who}}, so a secret cannot be held by them.
no_teller: Operation {{n}} ({{op}}): a secret someone was told is held with its teller, and no one in the world is named {{who}}.
many_named: Operation {{n}} ({{op}}): {{count}} people in the world are named {{who}}: {{ids}}.
unknown_secret: Operation {{n}} ({{op}}): this chat holds no secret {{secret}}{{#near}}; the nearest it holds are {{near}}{{/near}}.
secret_refused: Operation {{n}} ({{op}}): the secret {{secret}} cannot be held by {{who}} ({{code}}).
self_teller: Operation {{n}} ({{op}}): {{who}} was named as the one who told {{who}}; it is kept as first hand.
plays_none: {{tool}} is a character's own, and this agent plays no one.
no_memories_sent: memories cannot be read: send a list of memories.
no_memories: Nothing comes back for {{cue}}.
more_memories: {{count}} more memories touch {{cue}}. Recall again with skip {{skip}} to bring them back.
top_left: Top of mind holds {{limit}} at most, so {{count}} left it to make room, the weakest first: {{ids}}. They stay memories; recall brings them back.
no_entries_sent: entries cannot be read: send what is on your mind as a list of entries.
no_relationships_sent: relationships cannot be read: send a list of the people you feel something about.
page_no_entry: {{who}} has no entry {{id}} on this chat's record.
page_pin_needs_casting: A pin holds a casting: say how large a part {{who}} plays to pin it.
page_nothing_to_edit: Nothing was sent to change in {{who}}'s record.
page_still_struck: {{id}}{{#text}} ({{text}}){{/text}} stays struck: it was struck apart from {{from}}, so taking that strike back leaves it as it is.{{#secret}} The secret it gave, {{secret}}, is not held again.{{/secret}}

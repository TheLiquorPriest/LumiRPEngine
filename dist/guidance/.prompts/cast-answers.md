---
description: The sentences the cast tools answer with (cast_query, cast_update, perceive, recall, remember, reflect, dream, mind_set, relate, self_read). A tool's answer is data from the cast and these lines, filled with that data. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words. The lines named wants_ (what an argument takes) are words put inside the other lines, and the lines named own_ are those of self_read, a character's reading of its own record. The Cast page is told in these words too when it is refused (no_chat, no_turn, no_character, unreadable, and the lines named page_, which only the page uses). A tool that writes answers with a receipt, which ends with receipt_kept, the line that names the file its whole answer is in; delete that line and those tools answer whole, and delete receipt_left and a long receipt is not cut.
format: lines
---
no_chat: There is no chat {{id}} in the engine's records.
no_chat_run: {{tool}} works on a chat's cast, and this run belongs to no chat: nothing was done.
question_none: {{tool}} handed your question to nobody: a question is answered by a reader, and you are given none (a reader has none of its own). Call it again without the question and read the answer yourself.
no_turn: There is no turn {{id}} in this chat.
turn_joined: Turn {{turn}} was joined to turn {{joined}}, the turn the continue extended, so nothing was read or written here. Address turn {{joined}} instead.
store_unread: The cast could not read that call: {{why}}
engine_fault: {{tool}} failed in the engine, not in your call: the fault is in RPE's log. Nothing was recorded.
receipt_kept: This is {{tool}}'s receipt. Its whole answer, {{chars}} characters, is in {{path}}.
receipt_left: {{left}} of the {{of}} ids {{tool}} wrote under are left out of this receipt, to hold it to its size; the file lists them all.
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
more: {{count}} more in {{part}}{{#tokens}}, {{tokens}} tokens whole{{/tokens}}. Ask again with skip {{skip}} to see them.
gists: {{#one}}This is its gist{{/one}}{{^one}}These are {{items}} gists{{/one}}: what the record holds that stands for each entry{{#first}}; where one has none, first is the first line of its text, which is no gist{{/first}}.{{#whole}} This shows {{shown}} tokens of {{whole}}; tokens is the size of each whole.{{/whole}} cast_query with the same who and part and no how reads them whole, and words narrows it.
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
own_other: {{tool}} reads your own record and nobody else's: you are {{who}}, and you asked for {{asked}}. What you know of anyone else is what your own memories, relationships and knowledge hold of them.
own_parts: These are the parts of your record, each with how many entries it holds{{#sized}} and their size whole, in tokens{{/sized}}. {{tool}} with a part reads it: by id, day, scene, name, subject or tier as the part takes, and with how gist each entry by its gist.
own_not_by: {{part}} is not read by {{field}}.{{#takes}} It is read by {{takes}}.{{/takes}}{{^takes}} It is read whole, or with how gist.{{/takes}}
own_none: You hold nothing in {{part}}{{#narrowed}} that matches{{/narrowed}}.
own_unknown_id: You have no {{id}} in {{part}}.{{#near}} The nearest you have: {{near}}.{{/near}}
own_taken: {{id}} is taken in already and is not read again here: whatever you kept of it is in your memories, and recall brings those back.
own_no_file: You carry no old mind file {{name}} that waits to be filed.{{#files}} Those that wait: {{files}}.{{/files}}
own_no_days: Nothing in {{part}} has a date, so none of it is read by day. Ask by id{{#scenes}} or by scene{{/scenes}}.
own_unknown_day: Nothing in {{part}} is of {{day}}.{{#days}} The nearest days it holds: {{days}}.{{/days}}
own_no_scenes: No scene is recorded for anything in {{part}}. Ask by id or by day.
own_unknown_scene: Nothing in {{part}} is of the scene {{scene}}: a scene is asked for by its id, as your outline names it.{{#scenes}} The latest scenes it holds: {{scenes}}.{{/scenes}}
own_no_side: The world holds no person you are: none is tied to you, and your name finds no one, or more than one.
own_side_names: This is your game side by name and count{{#whole}}: {{shown}} tokens of {{whole}}{{/whole}}. {{tool}} with part game-side and no how reads all of it.
own_gists: {{#one}}This is its gist{{/one}}{{^one}}These are {{items}} gists{{/one}}: what your record holds that stands for each entry{{#first}}; where one has none, first is the first line of its text, which is no gist{{/first}}.{{#whole}} This shows {{shown}} tokens of {{whole}}; tokens is the size of each whole.{{/whole}} {{tool}} with the same part and an id reads one whole.
own_faint: {{count}} of these {{#one}}has{{/one}}{{^one}}have{{/one}} faded and {{#one}}is{{/one}}{{^one}}are{{/one}} given by gist, marked faint. recall brings a memory back in full.
own_more: {{count}} more match{{#tokens}}, {{tokens}} tokens whole{{/tokens}}. Ask again with skip {{skip}} to read on, or narrow what you ask for.
no_memories_sent: memories cannot be read: send a list of memories.
no_memories: Nothing comes back for {{cue}}.
more_memories: {{count}} more memories touch {{cue}}. Recall again with skip {{skip}} to bring them back.
top_left: Top of mind holds {{limit}} at most, so {{count}} left it to make room, the weakest first: {{ids}}. They stay memories; recall brings them back.
recall_not_kept: The player allows no writes to the {{lane}} lane, so recalling changed nothing: no memory was strengthened{{#top}} and none was put at top of mind{{/top}}. What touches the cue is shown as it stands.
no_entries_sent: entries cannot be read: send what is on your mind as a list of entries.
no_relationships_sent: relationships cannot be read: send a list of the people you feel something about.
page_no_entry: {{who}} has no entry {{id}} on this chat's record.
page_pin_needs_casting: A pin holds a casting: say how large a part {{who}} plays to pin it.
page_nothing_to_edit: Nothing was sent to change in {{who}}'s record.
page_not_taken: The request has {{field}}, which it does not take.{{#choices}} It takes {{choices}}.{{/choices}}
page_take_in_going: {{who}}'s own agent is at work already in job {{job}}, which has what waits for it in hand, so no second job was started.
still_struck: {{id}}{{#text}} ({{text}}){{/text}} stays struck: it was struck apart from {{from}}, so taking that strike back leaves it as it is.{{#secret}} The secret it gave, {{secret}}, is not held again.{{/secret}}

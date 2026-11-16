---
description: The sentences the story tools answer with (story_query, story_record). A tool's answer is data from the story record and these lines, filled with that data. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words. The lines named wants_ (what an argument takes) are words put inside the other lines. The Story page is told in these words too when it is refused (no_chat, no_turn, unknown_id, unreadable, and the lines named page_, which only the page uses).
format: lines
---
no_chat: There is no chat {{id}} in the engine's records.
no_turn: There is no turn {{id}} in this chat.
turn_needed: Operation {{n}} ({{op}}) is your record of a turn, and this call belongs to no turn, so it was not made.
no_operations: operations cannot be read: send a list of operations.
unknown_op: Operation {{n}}: op cannot be read, you sent {{value}}. It is one of: {{choices}}.
unreadable: {{field}} cannot be read{{#value}}: you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}
unreadable_op: Operation {{n}} ({{op}}): {{field}} cannot be read, you sent {{value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}{{#wants}} It takes {{wants}}.{{/wants}}{{#says}} What you meant can go in {{says}}, which takes any words.{{/says}}
wants_names: a name, or a list of names
op_takes: {{op}} reads {{reads}}{{#needs}}, and needs {{needs}}{{/needs}}{{#new_needs}}, and a new one needs {{new_needs}}{{/new_needs}}.{{#ignored}} It does not read {{ignored}}.{{/ignored}}
not_read: Operation {{n}} ({{op}}) was recorded without {{left}}. It reads {{reads}}.
needs: Operation {{n}} ({{op}}) needs {{fields}}.
needs_one: Operation {{n}} ({{op}}) needs at least one of {{fields}}.
one_name: Operation {{n}} ({{op}}): who names one person, or plot.
no_message: Operation {{n}} ({{op}}): {{field}} names no message: you sent {{value}}, and the chat's messages are numbered 0 to {{last}}.
no_clock: Operation {{n}} ({{op}}): {{field}} is kept as you wrote it, {{value}}, but this chat keeps no story time, so it will not come up as due.
unreadable_time: Operation {{n}} ({{op}}): {{field}} is kept as you wrote it, {{value}}, but holds no date that can be counted from, so it will not come up as due. A date and time (YYYY-MM-DD HH:MM), a clock time (18:30) or a span from now (two days) can be counted.
unknown_id: {{#n}}Operation {{n}} ({{op}}): {{/n}}the story record on this path holds no {{#part}}{{part}} {{/part}}{{id}}.
no_current: Operation {{n}} ({{op}}): there is no {{part}} yet. Open one with new.
current_closed: Operation {{n}} ({{op}}): the current {{part}}, {{id}}, is closed. Open a new one with new, or name {{id}} to write to it.
nothing_recorded: Nothing was recorded. Send the call again with that put right.
already_closed: Operation {{n}} ({{op}}): {{id}} was already closed.
due_now: Operation {{n}} ({{op}}): it falls due at {{due}}, which is not after now ({{now}}), so it is due at once.
due_now_undated: Operation {{n}} ({{op}}): it falls due no later than now, so it is due at once.
overlay_unknown: Operation {{n}} (overlay): there is no lore entry {{entry}}.{{#near}} Near: {{near}}.{{/near}}
store_unread: The story record could not read that call: {{why}}
turn_joined: This turn, {{turn}}, was joined to turn {{joined}}, the turn the continue extended, so nothing was read or recorded here. Address turn {{joined}} instead.
place_unresolved: Operation {{n}} ({{op}}): the place {{place}} names no place of this world, so it is kept as the words you wrote and tied to none.
none: Nothing in the story record matches.
no_clock_due: This chat keeps no story time, so nothing falls due.
more: {{count}} more match. Ask again with a part, a range or a name to see them; the next is {{next}}.
correction_empty: Nothing of that could be corrected: {{id}} takes {{fields}}.
correction_ignored: {{id}} does not take {{fields}}, so {{fields}} was left out.
timeline_gone: The timeline has no {{id}} any more, so the page after it cannot be told. Read the timeline again from its start.
so_far_unavailable: The story so far is not worked out here.

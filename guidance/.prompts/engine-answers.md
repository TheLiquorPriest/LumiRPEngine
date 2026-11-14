---
description: The sentences the engine's tools answer with (world_query, world_search, world_apply, roll and the tools found by search). A tool's answer is data from the store and these lines, filled with that data. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words.
format: lines
---
no_chat: There is no chat {{id}} in the engine's records.
no_turn: There is no turn {{id}} in this chat.
no_world: The world this chat plays ({{id}}) is not to hand, so nothing can be read.
turn_needed: This call belongs to no turn, so nothing can be recorded. Reading needs no turn.
needs_field: This call needs {{field}}.
needs_one_field: This call needs one of {{fields}}, and only one.
unknown: {{#n}}Operation {{n}} ({{op}}): {{/n}}there is nothing called {{name}} that is a {{wanted}}.{{#near}} Near: {{near}}.{{/near}}
several: {{#n}}Operation {{n}} ({{op}}): {{/n}}{{name}} fits more than one: {{several}}. Name one by its id.
unreadable: {{field}} cannot be read{{#value}}: you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}
unreadable_op: Operation {{n}}{{#op}} ({{op}}){{/op}}: {{field}} cannot be read{{#value}}, you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}
needs: Operation {{n}} ({{op}}) needs {{fields}}.
needs_one: Operation {{n}} ({{op}}) needs one of {{fields}}, and only one.
not_applicable: {{#n}}Operation {{n}} ({{op}}): {{/n}}the engine cannot apply this at all ({{code}}).
nothing_recorded: Nothing was recorded. Send the call again with that put right.
never: Operation {{n}} ({{op}}) was not applied: it writes to the {{lane}} lane, where the player allows no writes.
declined: Operation {{n}} ({{op}}) was not applied: the player said no.{{#reason}} Their reason: {{reason}}{{/reason}}
unsourced: Operation {{n}} ({{op}}) names no source, so it is marked unsourced.
invented_unchecked: Operation {{n}} ({{op}}) is recorded as invented and names no gap check, so it is marked so.
invented_unconsented: Operation {{n}} ({{op}}) is recorded as invented and names no consent, so it is marked so.
not_applied: Operation {{n}} ({{op}}) was recorded and did not apply ({{code}}).
already_so: Operation {{n}} ({{op}}): {{what}} was already so; nothing changed.
placed_instead: Operation {{n}} ({{op}}): {{what}} was put at {{where}}, not {{asked}}, by the size of things.
rule_bent: Operation {{n}} ({{op}}): {{what}} was put with {{where}} although the world's rules for things say otherwise ({{code}}).
past_until: Operation {{n}} ({{op}}): {{until}} is not after now, so the loan was recorded with no end.
not_holding: Operation {{n}} ({{op}}): {{from}} did not hold {{what}}{{#holder}}; {{holder}} did{{/holder}}. It was given all the same.
not_owner: Operation {{n}} ({{op}}): {{to}} is not among the owners of {{what}}, so it was handed over to hold and whose it is did not change.
not_wearable: Operation {{n}} ({{op}}): {{what}} has no place to be worn ({{code}}), so {{who}} carries it.
kept_nowhere: Operation {{n}} ({{op}}): nothing says where {{what}} is kept, or it is there already; nothing moved.
exists: Operation {{n}} ({{op}}): {{name}} is there already and stands for it; no second one was made.
paid_past_held: Operation {{n}} ({{op}}): {{payer}} paid {{amount}} and could pay at most {{held}} from any one way; the payment is recorded all the same.
money_untracked: Operation {{n}} ({{op}}): this world keeps no money for {{payer}}, so no money moved.
derived: Operation {{n}} ({{op}}): {{key}} is worked out from other values and is not set itself.
follows_xp: Operation {{n}} ({{op}}): {{key}} follows {{xp}}; set {{xp}} instead.
off_the_sheet: Operation {{n}} ({{op}}): {{key}} of {{name}} is now {{value}}, outside what its sheet allows ({{type}}{{#min}}, at least {{min}}{{/min}}{{#max}}, at most {{max}}{{/max}}{{#choices}}, one of {{choices}}{{/choices}}).
no_fact_store: Operation {{n}} ({{op}}): this host keeps no statements about things yet, so nothing was recorded.
no_grid: Operation {{n}} ({{op}}): this host keeps no squares on maps yet, so a square, a neighbour or a zone cannot be given.
off_path: Operation {{n}} ({{op}}): {{quest}} went from {{from}} to {{to}}, which is not one of the ways on from {{from}}.
time_back: Operation {{n}} ({{op}}): the clock was set back from {{from}} to {{to}}.
before_start: Operation {{n}} ({{op}}): the story starts at {{start}}, so the clock went back no further.
due_unlisted: {{#n}}Operation {{n}} ({{op}}): {{/n}}what this span of time brings due is not listed by this host.
no_map: {{at}} has no map to show.
none_found: Nothing found for {{words}}.

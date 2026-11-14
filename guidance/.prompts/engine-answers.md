---
description: The sentences the engine's tools answer with (world_query, world_search, world_apply, roll and the tools found by search). A tool's answer is data from the store and these lines, filled with that data. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words. The lines named want_ (what a name was looked for as) and wants_ (what an argument takes) are words put inside the other lines.
format: lines
---
no_chat: There is no chat {{id}} in the engine's records.
no_turn: There is no turn {{id}} in this chat.
no_world: The world this chat plays ({{id}}) is not to hand, so nothing can be read.
turn_needed: This call belongs to no turn, so nothing can be recorded. Reading needs no turn.
needs_field: This call needs {{field}}.
needs_one_field: This call needs one of {{fields}}, and only one.
unknown: {{#n}}Operation {{n}} ({{op}}): {{/n}}there is nothing called {{name}} that is {{sought}}.{{#other}} By that name there is {{other}}.{{/other}}{{#near}} Near: {{near}}.{{/near}}
several: {{#n}}Operation {{n}} ({{op}}): {{/n}}{{name}} fits more than one: {{several}}. Name one by its id.
unreadable: {{field}} cannot be read{{#value}}: you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}{{#wants}} It takes {{wants}}.{{/wants}}
unreadable_op: Operation {{n}}{{#op}} ({{op}}){{/op}}: {{field}} cannot be read{{#value}}, you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}{{#wants}} It takes {{wants}}.{{/wants}}
no_operations: operations cannot be read{{#value}}: you sent {{value}}{{/value}}. It is a list of operations, each with its op, one of: {{ops}}.
needs: Operation {{n}} ({{op}}) needs {{fields}}.
needs_one: Operation {{n}} ({{op}}) needs one of {{fields}}, and only one.
needs_any: Operation {{n}} ({{op}}) needs one of {{fields}}.
op_takes: {{op}} needs {{needs}}{{#takes}}, and also takes {{takes}}{{/takes}}.{{#ignored}} It does not read {{ignored}}.{{/ignored}}
spawn_nowhere: Operation {{n}} ({{op}}): {{name}} is made as {{kind}}, a thing, which needs at, in or on to say where it is. A place is made with kind place, and needs none of them.
holds_nothing: Operation {{n}} ({{op}}): {{holder}} holds nothing and is at no place, so {{what}} cannot be made in it.
make_place: A place can be made earlier in this same call: spawn with kind place and its name, before the operation that names it.
make_person: Someone can be made earlier in this same call: spawn with kind person and their name, before the operation that names them.
make_thing: A thing can be made earlier in this same call: spawn with its name and where it is (at, in or on), before the operation that names it.
make_holder: Someone, or something that holds things, can be made earlier in this same call: spawn with kind person or container, before the operation that names it.
make_entity: Someone or something can be made earlier in this same call: spawn with its name and kind, before the operation that names it.
make_point: A place, someone or something can be made earlier in this same call: spawn with its name and kind (place for a place), before the operation that names it.
want_entity: a person or a thing
want_person: a person
want_thing: a thing
want_holder: someone or something that holds things
want_place: a place
want_point: a place, a person or a thing
want_track: a quest
want_bestiary: a row of the world's bestiary
want_check: a check of the world's
want_schedule: a schedule of the world's
wants_time: a date and time, YYYY-MM-DD HH:MM; a time of day, such as midnight, dawn or 22:00, as the next time the clock shows it; or words for a span, such as two hours
wants_minutes: a number of minutes
wants_dice: dice such as 1d20+3 or 2d6
wants_square: [column, row], two whole numbers counted from 1 at the top left, as the map prints them
wants_fields: an object of field: value
wants_amount: a number above 0, in the world's main coin
wants_amount_not_zero: a number other than 0, in the world's main coin
wants_amount_any: a number, in the world's main coin
wants_key: a field name
wants_point: world, a place, or someone or something
wants_change: a number other than 0
wants_list: a list of places, people and things, by name or id
wants_delta: a whole number, below 0 for wear and damage, above 0 for mending
wants_qty: a whole number of at least 1
wants_specs: a list of { label, value }
wants_object_or_null: an object, or null
wants_day: a whole number of days from today: 0 today, 1 tomorrow, -1 yesterday
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
made_where_said: Operation {{n}} ({{op}}): nothing goes by {{said}}, so {{what}} was made at {{where}}, and those words are kept on it as where it was said to be.
made_unrecorded: Operation {{n}} ({{op}}): nothing recorded went by {{name}}, so it was made as a thing, {{made}}.
said_where: Operation {{n}} ({{op}}): nothing goes by {{said}}, so those words are kept on {{what}} as where it was said to be.
horizon_words: Operation {{n}} ({{op}}): kept on the horizon as words, naming no place, person or thing: {{words}}.
against_rules: Operation {{n}} ({{op}}): {{#what}}{{what}}: {{/what}}applied although the world's rules would refuse it ({{code}}).
past_until: Operation {{n}} ({{op}}): {{until}} is not after now, so the loan was recorded with no end.
not_holding: Operation {{n}} ({{op}}): {{from}} did not hold {{what}}{{#holder}}; {{holder}} did{{/holder}}. It was given all the same.
not_owner: Operation {{n}} ({{op}}): {{to}} is not among the owners of {{what}}, so it was handed over to hold and whose it is did not change.
not_wearable: Operation {{n}} ({{op}}): {{what}} has no place to be worn ({{code}}), so {{who}} carries it.
not_to_hand: Operation {{n}} ({{op}}): {{what}} was not to hand{{#brought}}, and was put on {{who}} all the same{{/brought}}{{^brought}} and is gone or lost, so {{who}} went without it{{/brought}}.
used_past_held: Operation {{n}} ({{op}}): {{qty}} of {{what}} were used and there were only {{held}}; all of it is used up.
kept_nowhere: Operation {{n}} ({{op}}): nothing says where {{what}} is kept, so nothing moved.
exists: Operation {{n}} ({{op}}): {{name}} is there already and stands for it; no second one was made.
paid_past_held: Operation {{n}} ({{op}}): {{payer}} paid {{amount}} and could pay at most {{held}} from any one way; the payment is recorded all the same.
money_untracked: Operation {{n}} ({{op}}): this world keeps no money for {{payer}}, so no money moved.
closed_with_money: Operation {{n}} ({{op}}): {{what}} was closed with {{amount}} still on it.
derived: Operation {{n}} ({{op}}): {{key}} is worked out from other values and is not set itself.
follows_xp: Operation {{n}} ({{op}}): {{key}} follows {{xp}}; set {{xp}} instead.
off_the_sheet: Operation {{n}} ({{op}}): {{key}} of {{name}} is now {{value}}, outside what its sheet allows ({{type}}{{#min}}, at least {{min}}{{/min}}{{#max}}, at most {{max}}{{/max}}{{#choices}}, one of {{choices}}{{/choices}}).
no_grid: Operation {{n}} ({{op}}): this host keeps no squares on maps yet, so a square, a neighbour or a zone cannot be given.
on_map: Operation {{n}} ({{op}}): {{said}}
off_path: Operation {{n}} ({{op}}): {{quest}} went from {{from}} to {{to}}, which is not one of the ways on from {{from}}.
time_back: Operation {{n}} ({{op}}): the clock was set back from {{from}} to {{to}}.
time_left_out: Operation {{n}} ({{op}}): {{field}} cannot be read, you sent {{value}}, so it was left out and {{used}} was applied.{{#wants}} It takes {{wants}}.{{/wants}}
time_differs: Operation {{n}} ({{op}}): {{field}} reads as {{other}} and {{used}} as {{to}}; the clock was set by {{used}}.
before_start: Operation {{n}} ({{op}}): the story starts at {{start}}, so the clock went back no further.
due_unlisted: {{#n}}Operation {{n}} ({{op}}): {{/n}}what this span of time brings due is not listed by this host.
no_map: {{at}} has no map to show.
none_found: Nothing found for {{words}}.
store_failed: {{#n}}Operation {{n}} ({{op}}): {{/n}}the engine failed while applying it, so it did not apply. The error is in RPE's log.
store_unknown_revision: {{#n}}Operation {{n}} ({{op}}): {{/n}}the world revision {{revision}} is not to hand, so it did not apply.
store_bad_marker: {{#n}}Operation {{n}} ({{op}}): {{/n}}this is not a marker the engine can read, so it did not apply.
store_no_handler: {{#n}}Operation {{n}}: {{/n}}nothing in the engine applies {{op}}, so it did not apply.
store_tied: {{#n}}Operation {{n}} ({{op}}): {{/n}}it was tied to an operation that did not apply, so it did not apply either.
store_track_reset: {{#n}}Operation {{n}} ({{op}}): {{/n}}{{label}} went back from {{from}} to {{to}}, since this revision of the world no longer has the stage it was at.
store_replaces_none: {{#n}}Operation {{n}} ({{op}}): {{/n}}no standing fact {{id}} was found to replace, so the fact was recorded beside the others.

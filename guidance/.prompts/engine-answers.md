---
description: The sentences the engine's tools answer with (world_query, world_search, world_apply, roll and the tools found by search). A tool's answer is data from the store and these lines, filled with that data. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words. The lines named want_ (what a name was looked for as) and wants_ (what an argument takes) are words put inside the other lines. So is time_from_now, a time in a chat whose date nobody has set (a chat with no world, until the story sets the clock to a date and time), told as how long it is from now; with ahead or ago in minutes, or now.
format: lines
---
no_chat: There is no chat {{id}} in the engine's records.{{#exist}} There are: {{exist}}.{{/exist}}
no_turn: There is no turn {{id}} in this chat.{{#exist}} Its latest are: {{exist}}.{{/exist}}
scope_gone: This call belongs to {{what}} {{id}}, which takes no more changes: its staged changes were dropped, or its run has ended. Nothing was recorded.
turn_joined: Turn {{id}} was joined to turn {{into}}, which holds its changes now; turn {{id}} itself is not read, so how things stand is not shown. Address turn {{into}}.
engine_fault: {{tool}} failed in the engine, not in your call: the fault is in RPE's log. Nothing was recorded.
nothing_of_kind: Nothing that is {{sought}} is recorded in this world, so there is nothing near it. world_search finds what is recorded, by words.
turn_needed: This call belongs to no turn, so nothing can be recorded. Reading needs no turn.
needs_field: This call needs {{field}}.
needs_one_field: This call needs one of {{fields}}, and only one.
unknown: {{#n}}Operation {{n}} ({{op}}): {{/n}}there is nothing called {{name}} that is {{sought}}.{{#other}} By that name there is {{other}}.{{/other}}{{#near}} Near: {{near}}.{{/near}}{{#nothing}} {{nothing}}{{/nothing}}
several: {{#n}}Operation {{n}} ({{op}}): {{/n}}{{name}} fits more than one: {{several}}. Name one by its id.
unreadable: {{field}} cannot be read{{#value}}: you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}{{#wants}} It takes {{wants}}.{{/wants}}
unreadable_op: Operation {{n}}{{#op}} ({{op}}){{/op}}: {{field}} cannot be read{{#value}}, you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}{{#wants}} It takes {{wants}}.{{/wants}}
no_operations: operations cannot be read{{#value}}: you sent {{value}}{{/value}}. It is a list of operations, each with its op, one of: {{ops}}.
needs: Operation {{n}} ({{op}}) needs {{fields}}.
needs_one: Operation {{n}} ({{op}}) needs one of {{fields}}, and only one.
needs_any: Operation {{n}} ({{op}}) needs one of {{fields}}.
op_takes: {{op}} needs {{needs}}{{#takes}}, and also takes {{takes}}{{/takes}}.{{#ignored}} It does not read {{ignored}}.{{/ignored}}
spawn_nowhere: Operation {{n}} ({{op}}): {{name}} is made as {{kind}}, a thing, which needs at, in or on to say where it is. A place is made with kind place, and needs none of them.
place_unread: Operation {{n}} ({{op}}): a place has no {{unread}}, so that was not kept.
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
want_in: a place, or someone or something that holds things
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
wants_names: a name, or a list of names, each a text
wants_delta: a whole number, below 0 for wear and damage, above 0 for mending
wants_qty: a whole number of at least 1
wants_specs: a list of { label, value }
wants_object_or_null: an object, or null
wants_day: a whole number of days from today: 0 today, 1 tomorrow, -1 yesterday
time_from_now: {{#ahead}}{{ahead}} {{#one}}minute{{/one}}{{^one}}minutes{{/one}} from now{{/ahead}}{{#ago}}{{ago}} {{#one}}minute{{/one}}{{^one}}minutes{{/one}} before now{{/ago}}{{#now}}the time now{{/now}}
not_applicable: {{#n}}Operation {{n}} ({{op}}): {{/n}}the engine cannot apply this ({{code}}){{#reason}}: {{reason}}{{/reason}}.{{#choices}} It is one of: {{choices}}.{{#records}} Whatever the story meant by it, the {{records}} operation records it as given.{{/records}}{{/choices}}
not_open: Operation {{n}} ({{op}}): {{what}} is {{status}}, and the books take no money out of an account that is not open, on any path.
nothing_recorded: Nothing was recorded. Send the call again with that put right.
outside_list: Operation {{n}} ({{op}}): {{field}} {{value}} is not one of what a {{field}} can hold: {{choices}}. Whatever you meant by it, the {{records}} operation records it as given.
never: Operation {{n}} ({{op}}) was not applied: it writes to the {{lane}} lane, where the player allows no writes.
declined: Operation {{n}} ({{op}}) was not applied: the player said no.{{#reason}} Their reason: {{reason}}{{/reason}}
needs_held: Nothing was recorded: operation {{n}} ({{op}}) needs what the player held back, so the call cannot go ahead as it is.
unsourced: Operation {{n}} ({{op}}) names no source, so it is marked unsourced.
invented_unchecked: Operation {{n}} ({{op}}) is recorded as invented and names no gap check, so it is marked so.
invented_unconsented: Operation {{n}} ({{op}}) is recorded as invented and names no consent, so it is marked so.
not_applied: Operation {{n}} ({{op}}) was recorded and did not apply ({{code}}).
already_so: Operation {{n}} ({{op}}): {{what}} was already so; nothing changed.
placed_instead: Operation {{n}} ({{op}}): {{what}} was put at {{where}}, not {{asked}}, by the size of things.
rule_bent: Operation {{n}} ({{op}}): {{what}} was put with {{where}} although the world's rules for things say otherwise ({{code}}).
above_carry: Operation {{n}} ({{op}}): {{what}} is {{size}}, above what a person carries, and it is in {{holder}}'s hands all the same.
ends_before_now: Operation {{n}} ({{op}}): the end of {{what}} for {{who}}, {{until}}, is not after now; it is recorded with that end.
returned_not_owner: Operation {{n}} ({{op}}): {{to}} is not among the owners of {{what}}; the return is recorded all the same, and whose it is did not change.
taken_from: Operation {{n}} ({{op}}): {{what}} was taken from {{holder}}, who is at {{where}}, not where it went.
in_two_places: Operation {{n}} ({{op}}): {{what}} was lying at {{where}} and in {{holder}} at once; it is moved as asked.
not_taken_in_hand: Operation {{n}} ({{op}}): {{what}} is a vehicle and was not taken in hand: it changed hands where it stands.
no_condition: Operation {{n}} ({{op}}): {{what}} has no condition recorded and its field gives none to start from, so nothing was changed.
same_name: Operation {{n}} ({{op}}): {{name}} was made as asked; {{same}} stood under that name already, and is not the same one.
place_past_cap: Operation {{n}} ({{op}}): {{name}} was made; this chat had made {{made}} places in play already, and the world's number is {{cap}}.
made_as_thing: Operation {{n}} ({{op}}): {{name}} was made as a thing, since this world plays no vehicles; its class, {{class}}, is kept on it.
holder_nowhere: Operation {{n}} ({{op}}): {{holder}} is at no place, so {{name}} was made at none.
made_where_said: Operation {{n}} ({{op}}): nothing goes by {{said}}, so {{what}} was made at {{where}}{{#assumed}}, which is recorded as assumed{{/assumed}}, and those words are kept on it as where it was said to be.
said_where: Operation {{n}} ({{op}}): nothing goes by {{said}}, so those words are kept on {{what}} as where it was said to be.
horizon_words: Operation {{n}} ({{op}}): kept on the horizon as words, naming no place, person or thing: {{words}}.
against_rules: Operation {{n}} ({{op}}): {{#what}}{{what}}: {{/what}}applied although the world's rules would refuse it ({{code}}).{{#class}} It is a {{class}}{{#score}} and their score is {{score}}{{/score}}.{{/class}}{{#reason}} The rules' reason: {{reason}}.{{/reason}}
past_until: Operation {{n}} ({{op}}): {{until}} is not after now, so the loan was recorded with no end.
not_holding: Operation {{n}} ({{op}}): {{from}} did not hold {{what}}{{#holder}}; {{holder}} did{{/holder}}. It was given all the same.
not_owner: Operation {{n}} ({{op}}): {{to}} is not among the owners of {{what}}, so it was handed over to hold and whose it is did not change.
not_wearable: Operation {{n}} ({{op}}): {{what}} has no place to be worn ({{code}}), so {{who}} carries it.
not_to_hand: Operation {{n}} ({{op}}): {{what}} was not to hand{{#brought}}, and was put on {{who}} all the same{{/brought}}{{^brought}} and is gone or lost, so {{who}} went without it{{/brought}}.
used_past_held: Operation {{n}} ({{op}}): {{qty}} of {{what}} were used and there were only {{held}}; all of it is used up.
kept_nowhere: Operation {{n}} ({{op}}): nothing says where {{what}} is kept, so nothing moved.
exists: Operation {{n}} ({{op}}): {{name}} is there already and stands for it; no second one was made.
nothing_filled: Operation {{n}} ({{op}}): nothing was filled in for {{what}}: it was filled in before, or the world keeps no more detail of it at its level.
paid_past_held: Operation {{n}} ({{op}}): {{payer}} paid {{amount}} and could pay at most {{held}} from any one way; the payment is recorded all the same.
paid_from_outside: Operation {{n}} ({{op}}): the world keeps no accounts for {{payer}}, so it was paid from their money outside the world's accounts.
money_untracked: Operation {{n}} ({{op}}): this world keeps no money for {{payer}}, so no money moved.
closed_with_money: Operation {{n}} ({{op}}): {{what}} was closed with {{amount}} still on it.
derived: Operation {{n}} ({{op}}): {{key}} is worked out from other values and is not set itself.
follows_xp: Operation {{n}} ({{op}}): {{key}} follows {{xp}}; set {{xp}} instead.
off_the_sheet: Operation {{n}} ({{op}}): {{key}} of {{name}} is now {{value}}, outside what its sheet allows ({{type}}{{#min}}, at least {{min}}{{/min}}{{#max}}, at most {{max}}{{/max}}{{#choices}}, one of {{choices}}{{/choices}}).
not_numeric: Operation {{n}} ({{op}}): {{field}} of {{entity}} holds no number, so nothing was added to it and it stays as it was; the change is recorded as given.
advised: Operation {{n}} ({{op}}) was recorded, and the engine advises on it ({{code}}).
on_map: Operation {{n}} ({{op}}): {{said}}
off_path: Operation {{n}} ({{op}}): {{quest}} went from {{from}} to {{to}}, which is not one of the ways on from {{from}}.
time_back: Operation {{n}} ({{op}}): the clock was set back from {{from}} to {{to}}.
time_left_out: Operation {{n}} ({{op}}): {{field}} cannot be read, you sent {{value}}, so it was left out and {{used}} was applied.{{#wants}} It takes {{wants}}.{{/wants}}
time_differs: Operation {{n}} ({{op}}): {{field}} reads as {{other}} and {{used}} as {{to}}; the clock was set by {{used}}.
before_start: Operation {{n}} ({{op}}): the story starts at {{start}}, so the clock went back no further.
due_more: {{#n}}Operation {{n}} ({{op}}): {{/n}}only the first {{listed}} of what this span brings due are listed; {{more}} more fall due later in it.
due_more_uncounted: {{#n}}Operation {{n}} ({{op}}): {{/n}}only the first {{listed}} of what this span brings due are listed; more fall due later in it.
no_map: {{at}} has no map to show.
none_found: Nothing found for {{words}}.
store_failed: {{#n}}Operation {{n}} ({{op}}): {{/n}}the engine failed while applying it, so it did not apply. The error is in RPE's log.
store_unknown_revision: {{#n}}Operation {{n}} ({{op}}): {{/n}}the world revision {{revision}} is not to hand, so it did not apply.
store_bad_marker: {{#n}}Operation {{n}} ({{op}}): {{/n}}this is not a marker the engine can read, so it did not apply.
store_no_handler: {{#n}}Operation {{n}}: {{/n}}nothing in the engine applies {{op}}, so it did not apply.
store_tied: {{#n}}Operation {{n}} ({{op}}): {{/n}}it was tied to an operation that did not apply, so it did not apply either.
store_track_reset: {{#n}}Operation {{n}} ({{op}}): {{/n}}{{label}} went back from {{from}} to {{to}}, since this revision of the world no longer has the stage it was at.
store_replaces_none: {{#n}}Operation {{n}} ({{op}}): {{/n}}no standing fact {{id}} was found to replace, so the fact was recorded beside the others.
set_nothing_worn: Operation {{n}} ({{op}}): {{who}} wears nothing to keep as {{kind}}, so {{name}} was saved with no pieces.
set_past_max: Operation {{n}} ({{op}}): {{who}} keeps {{max}} saved outfits and loadouts, which is the most this world's rules keep; {{name}} was saved all the same.
unknown_by: Operation {{n}} ({{op}}): there is no one called {{name}} to have taken it.{{#other}} By that name there is {{other}}.{{/other}}{{#near}} Near: {{near}}.{{/near}} Something gone missing is item_lose with no by; to put it into a holder use store, and to put it somewhere use move.
wants_name: a name, of any length, with at least one character
bad_routine_value: Operation {{n}} ({{op}}): {{field}} cannot be read, you sent {{value}}.{{#wants}} It takes {{wants}}{{/wants}}{{#problems}} Cast life's problems with it: {{problems}}.{{/problems}}
wants_block_value: an object for one block of the routine (a label, an activity, a kind of fixed, flexible or optional, a length in minutes, and the start time at for a fixed block or a window from and to for another), {"off": true}, or null to put the world's block back.
wants_schedule_value: an object, either {"off": true, "until": a time or null} or its own slots as a list of {start, end} times (HH:MM) with an optional recurrence {every}, or null to put the world's schedule back.
no_weather_region: Operation {{n}} ({{op}}): {{where}} has no weather region of its own, so {{state}} was kept on the place itself; the places inside it take it unless they have theirs.
weather_state_unlisted: Operation {{n}} ({{op}}): the climate lists no state {{state}}; it was recorded as given. Its states are {{states}}.
odds_no_roll: No roll is needed.
odds_impossible: Too hard to try.
odds_story: The story decides{{#chance}}, with odds of {{chance}}%{{/chance}}.
odds_retry: A retry needs a change.
odds_retry_once: A retry needs a new scene.
odds_advantage: With advantage.
odds_disadvantage: With disadvantage.
odds_dc: DC {{dc}}.
score_assumed: Operation {{n}} ({{op}}): {{what}} has no score recorded, so the finance tables were read at {{score}}.
not_an_organization: Operation {{n}} ({{op}}): {{to}} is a person and {{from}} is not an exempt organization, which is who grants to a person; it was recorded all the same.
gives_to_itself: Operation {{n}} ({{op}}): {{who}} gave to itself, so no money moved; the gift was recorded all the same.
not_exempt: Operation {{n}} ({{op}}): {{org}} is a {{type}}, which the world's rules say cannot hold a tax exemption; it was recorded all the same.
wants_day_of_month: a whole number from 1 to 31
wants_term: a whole number of months above 0
wants_apr: a yearly percent of 0 or more
loan_paid_out: {{name}}: loan paid out
credit_card_name: {{name}} card
gift_memo: Donation to {{to}}
grant_memo: Grant to {{to}}
want_party: a person or an organization
want_organization: an organization
life_takes: Operation {{n}} ({{op}}): a life change needs a state (state), one of {{states}}, or someone to tell about it (tell), a list of people by name or id; or both.
removed_life: Operation {{n}} ({{op}}): {{who}} is out of the world, and took the state all the same.
pov_removed: Operation {{n}} ({{op}}): {{who}} is the player's character, and was removed all the same.
pov_agent: Operation {{n}} ({{op}}): {{who}} is the player's character, and was made an agent all the same; whether they have a mind of their own stays the owner's setting.
single_class: Operation {{n}} ({{op}}): {{problem}} They were recorded all the same.
related_to_self: Operation {{n}} ({{op}}): {{who}} was related to themselves by {{relation}}; it was recorded all the same.
relation_kind: Operation {{n}} ({{op}}): {{relation}} joins a {{takes}} at its {{end}} end and {{who}} is not one; it was recorded all the same.
wants_class: an object of facet: list of values, such as {"trade": ["innkeeper"]}
wants_levels: an object of domain: level, a whole number from 0 to 4, or null for the one their tier gives
org_change_takes: Operation {{n}} ({{op}}): change cannot be read, you sent {{value}}.{{^do}} It is an object whose do is one of: {{dos}}, with the fields that change takes.{{/do}}{{#do}} A {{do}} names {{takes}}.{{#missing}} Not given: {{missing}}.{{/missing}}{{/do}}
unknown_job: Operation {{n}} ({{op}}): there is no job called {{name}}.{{#jobs}} The jobs are: {{jobs}}.{{/jobs}}
plan_full: Operation {{n}} ({{op}}): the plan already holds {{most}} open {{what}}, which is as many as this world's rules keep; it was kept all the same.
not_voter: Operation {{n}} ({{op}}): {{who}} has no vote on it; the vote was kept beside the others and counts for nothing.
closed: Operation {{n}} ({{op}}): that {{what}} was closed already{{#who}}, so {{who}}'s word was kept beside what was decided, which stands{{/who}}.
not_its_place: Operation {{n}} ({{op}}): {{place}} is not one of {{org}}'s places; the change was kept all the same.
not_there: Operation {{n}} ({{op}}): the record does not place {{who}} at {{place}}; it was kept all the same.
dissolved: Operation {{n}} ({{op}}): {{org}} was dissolved on {{on}}; the change was recorded all the same.
bad_delegation: Operation {{n}} ({{op}}): {{who}} was given the delegation by themselves; it was recorded all the same.
delegation_ended: Operation {{n}} ({{op}}): the delegation ends {{until}}, which is before today; it was recorded with that end.
not_listed: Operation {{n}} ({{op}}): {{org}} is on no market, so the stake changed hands between the parties named.
named_both: Operation {{n}} ({{op}}): {{who}} is named on both sides of the fight, and a fighter is on one side only; name them on one.
no_combat_rules: Operation {{n}} ({{op}}): this world has no combat rules, so the fight was recorded with its sides and order and no budgets, hit points or rounds.
nowhere: Operation {{n}} ({{op}}): the fighters do not all stand in one place and none was named with at, so the fight is recorded at no place.
not_here: Operation {{n}} ({{op}}): {{who}} does not stand at {{place}}, where the fight is; they are in it all the same.
cannot_fight: Operation {{n}} ({{op}}): {{who}} cannot take part by the world's combat rules (no hit points to fight on, or unable to act); they are in the fight all the same.
fight_broke_off: Operation {{n}} ({{op}}): the fight under way was ended as the story moved on; no winner was recorded.
fight_still_on: Operation {{n}} ({{op}}): the fight under way is still on; nothing was recorded.

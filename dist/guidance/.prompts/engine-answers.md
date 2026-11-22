---
description: The sentences the engine's tools answer with (world_query, world_search, world_apply, roll and the tools found by search). A tool's answer is data from the store and these lines, filled with that data. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words. The lines named want_ (what a name was looked for as) and wants_ (what an argument takes) are words put inside the other lines. So is time_from_now, a time in a chat whose date nobody has set (a chat with no world, until the story sets the clock to a date and time), told as how long it is from now; with ahead or ago in minutes, or now. A tool that writes answers with a receipt, which ends with receipt_kept, the line that names the file its whole answer is in; delete that line and those tools answer whole, and delete receipt_left and a long receipt is not cut.
format: lines
---
no_chat: There is no chat {{id}} in the engine's records.{{#exist}} There are: {{exist}}.{{/exist}}
no_turn: There is no turn {{id}} in this chat.{{#exist}} Its latest are: {{exist}}.{{/exist}}
scope_gone: This call belongs to {{what}} {{id}}, which takes no more changes: its staged changes were dropped, or its run has ended. Nothing was recorded.
turn_joined: Turn {{id}} was joined to turn {{into}}, which holds its changes now; turn {{id}} itself is not read, so how things stand is not shown. Address turn {{into}}.
engine_fault: {{tool}} failed in the engine, not in your call: the fault is in RPE's log. Nothing was recorded.
no_chat_run: {{tool}} works on a chat's world, and this run belongs to no chat: nothing was done.
question_none: {{tool}} handed your question to nobody: a question is answered by a reader, and you are given none (a reader has none of its own). Call it again without the question and read the answer yourself.
receipt_kept: This is {{tool}}'s receipt. Its whole answer, {{chars}} characters, is in {{path}}.
receipt_left: {{left}} of the {{of}} ids {{tool}} wrote under are left out of this receipt, to hold it to its size; the file lists them all.
nothing_of_kind: Nothing that is {{sought}} is recorded in this world, so there is nothing near it. world_search finds what is recorded, by words.
needs_field: This call needs {{field}}.
needs_one_field: This call needs one of {{fields}}, and only one.
unknown: {{#n}}Operation {{n}} ({{op}}): {{/n}}there is nothing called {{name}} that is {{sought}}.{{#other}} By that name there is {{other}}.{{/other}}{{#near}} Near: {{near}}.{{/near}}{{#nothing}} {{nothing}}{{/nothing}}
not_yet: Operation {{n}} ({{op}}): {{name}} is not recorded yet: operation {{later}} of this call makes it, and comes after this one. Put that one first.{{#near}} Near it now: {{near}}.{{/near}}
use_store: Operation {{n}} ({{op}}): {{name}} is {{other}}, not a person, and a thing is given only to a person.{{#near}} The persons nearest that name: {{near}}.{{/near}} A thing is put in something that holds things with the store operation.
several: {{#n}}Operation {{n}} ({{op}}): {{/n}}{{name}} fits more than one: {{several}}. Name one by its id.
unreadable: {{field}} cannot be read{{#value}}: you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}{{#wants}} It takes {{wants}}.{{/wants}}
unreadable_op: Operation {{n}}{{#op}} ({{op}}){{/op}}: {{field}} cannot be read{{#value}}, you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}{{#wants}} It takes {{wants}}.{{/wants}}
no_operations: operations cannot be read{{#value}}: you sent {{value}}{{/value}}. It is a list of operations, each with its op, one of: {{ops}}.
needs: Operation {{n}} ({{op}}) needs {{fields}}.
needs_one: Operation {{n}} ({{op}}) needs one of {{fields}}, and only one.
needs_any: Operation {{n}} ({{op}}) needs one of {{fields}}.
op_takes: {{op}}{{#needs}} needs {{needs}}{{#takes}}, and also takes {{takes}}{{/takes}}{{/needs}}{{^needs}} takes {{takes}}{{/needs}}.{{#ignored}} It does not read {{ignored}}.{{/ignored}}
place_unread: Operation {{n}} ({{op}}): a place has no {{unread}}, so that was not kept.
make_place: A place can be made earlier in this same call: place with a kind of place and its name, before the operation that names it.
spawn_not_place: Operation {{n}} ({{op}}): a {{kind}} is made with the place operation (place, with its name, its kind and where it is), and spawn does not make one. spawn makes: {{choices}}.
source_unknown: Operation {{n}} ({{op}}): Lumiverse holds no lore entry {{entries}}; it is bound to the place all the same, and shows as gone.
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
want_type: a type of the catalogs
want_check: a check of the world's
want_schedule: a schedule of the world's
wants_time: a date and time, YYYY-MM-DD HH:MM; a clock time, such as 22:00, 10pm, noon or midnight, or a part of this world's day by its id or label, as the next time the clock shows it, or tomorrow's after tomorrow; or a count and a unit for a span, such as two hours, thirty seconds or an hour and twenty minutes
wants_minutes: a number of minutes, a part of one counted in seconds (0.5 is thirty seconds)
wants_seconds: a number of seconds
wants_rounds: a whole number of rounds above 0, counted by the grid of the scene, which counts rounds only on a room-scale map; otherwise give seconds or minutes
wants_timelapse_target: an object with a type: duration (and minutes), day_part (and dayPart, the part's id), at (and at, a clock reading), shift, commitment, arrival or interrupt
wants_interrupts: an object of class: stop, note or ignore, the classes being invitation, bill, decline, incident, quest, rule, arrival, overdue, needs and weather
wants_action: an id of one of the world's actions, which world_query at ruleset lists. The passing of time is no action of the world's: record it with the pass_time operation, whatever the player pressed for it
wants_dice: dice such as 1d20+3 or 2d6
wants_square: [column, row], two whole numbers counted from 1 at the top left, as the map prints them
wants_fields: an object of field: value
wants_amount: a number above 0, in the world's main coin
wants_amount_not_zero: a number other than 0, in the world's main coin
wants_amount_any: a number, in the world's main coin
wants_positive: a number above 0
same_ends: Operation {{n}} ({{op}}): a way joins two places, and both ends are {{name}}.
route_of_map: Operation {{n}} ({{op}}): the way between {{from}} and {{to}} is drawn by the map {{map}}, so it is changed there: map_edit on that map, not a second way beside it.
no_path: Operation {{n}} ({{op}}): no way of this world's own joins {{from}} and {{to}}, so there is nothing to remove.{{#others}} {{from}} has ways to: {{others}}.{{/others}}
no_path_mode: Operation {{n}} ({{op}}): the way between {{from}} and {{to}} has no {{mode}} way. Its ways of travel: {{modes}}. Give one of them, or leave mode out to remove the whole way.
wants_key: a field name
wants_point: world, a place, or someone or something
wants_change: a number other than 0
wants_list: a list of places, people and things, by name or id
wants_names: a name, or a list of names, each a text
wants_delta: a whole number, below 0 for wear and damage, above 0 for mending
wants_qty: a whole number of at least 1
wants_depth: a whole number from 0, or full
wants_sum: numbers with + - * / and brackets, and a percent sign after a number for a rate, such as 12.50 * 3 * 1.08
wants_sources: a list of lore entries, each an id or { entry, aspect } with the aspect of the place it defines
wants_specs: a list of { label, value }
wants_object_or_null: an object, or null
wants_day: a whole number of days from today: 0 today, 1 tomorrow, -1 yesterday
time_from_now: {{#ahead}}{{ahead}} {{#one}}minute{{/one}}{{^one}}minutes{{/one}} from now{{/ahead}}{{#ago}}{{ago}} {{#one}}minute{{/one}}{{^one}}minutes{{/one}} before now{{/ago}}{{#aheadSeconds}}{{aheadSeconds}} {{#one}}second{{/one}}{{^one}}seconds{{/one}} from now{{/aheadSeconds}}{{#agoSeconds}}{{agoSeconds}} {{#one}}second{{/one}}{{^one}}seconds{{/one}} before now{{/agoSeconds}}{{#now}}the time now{{/now}}
not_applicable: {{#n}}Operation {{n}} ({{op}}): {{/n}}the engine cannot apply this ({{code}}){{#reason}}: {{reason}}{{/reason}}.{{#choices}} It is one of: {{choices}}.{{#records}} Whatever the story meant by it, the {{records}} operation records it as given.{{/records}}{{/choices}}
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
level_offers: Operation {{n}} ({{op}}): {{who}} reached {{field}} {{level}}, from {{from}}; nothing was rolled or applied for it. The world's effects for {{levels}} are yours to apply or roll: {{effects}}.
level_beside_xp: Operation {{n}} ({{op}}): {{who}}'s {{field}} is {{level}}, as given, and their experience, {{xp}}, reaches {{reached}}; the level stays as given.
level_past_bounds: Operation {{n}} ({{op}}): {{who}}'s {{field}} is {{level}}, which the field's bounds ({{#least}}at least {{least}}{{/least}}{{#most}}{{#least}}, {{/least}}at most {{most}}{{/most}}) do not allow; it is set all the same.
off_the_scale: Operation {{n}} ({{op}}): {{who}}'s {{axis}} toward {{toward}} is now {{value}}, past the axis's range of {{least}} to {{most}}; it is kept as given.
made_where_said: Operation {{n}} ({{op}}): nothing goes by {{said}}, so {{what}} was made at {{where}}{{#assumed}}, which is recorded as assumed{{/assumed}}, and those words are kept on it as where it was said to be.
made_nowhere: Operation {{n}} ({{op}}): {{what}} was made at no place, since nothing recorded says where{{#said}}; {{said}} is kept as where it was said to be{{/said}}.
said_where: Operation {{n}} ({{op}}): nothing goes by {{said}}, so those words are kept on {{what}} as where it was said to be.
horizon_words: Operation {{n}} ({{op}}): {{words}} names no place, person or thing, so it is kept on the horizon as words.{{#near}} Near it: {{near}}.{{/near}}
against_rules: Operation {{n}} ({{op}}): {{#what}}{{what}}: {{/what}}applied although the world's rules would refuse it ({{code}}).{{#class}} It is a {{class}}{{#score}} and their score is {{score}}{{/score}}.{{/class}}{{#reason}} The rules' reason: {{reason}}.{{/reason}}
not_holding: Operation {{n}} ({{op}}): {{from}} did not hold {{what}}{{#holder}}; {{holder}} did{{/holder}}. It was given all the same.
not_wearable: Operation {{n}} ({{op}}): {{what}} has no place to be worn ({{code}}), so {{who}} carries it.
not_to_hand: Operation {{n}} ({{op}}): {{what}} was not to hand{{#brought}}, and was put on {{who}} all the same{{/brought}}{{^brought}} and is gone or lost, so {{who}} went without it{{/brought}}.
used_past_held: Operation {{n}} ({{op}}): {{qty}} of {{what}} were used and there were only {{held}}; all of it is used up.
kept_nowhere: Operation {{n}} ({{op}}): nothing says where {{what}} is kept, so nothing moved.
nothing_filled: Operation {{n}} ({{op}}): nothing was filled in for {{what}}: it was filled in before, or the world keeps no more detail of it at its level.
paid_past_held: Operation {{n}} ({{op}}): {{payer}} paid {{amount}} and could pay at most {{held}} from any one way; the payment is recorded all the same.
paid_from_outside: Operation {{n}} ({{op}}): the world keeps no accounts for {{payer}}, so it was paid from their money outside the world's accounts.
money_untracked: Operation {{n}} ({{op}}): this world keeps no money for {{payer}}, so no money moved.
account_not_open: Operation {{n}} ({{op}}): {{account}} is {{status}}, and {{amount}} was taken out of it all the same; it could have covered {{held}}.
corrected_past_held: Operation {{n}} ({{op}}): {{payer}}'s cash was corrected down by {{amount}} and held {{held}}; it stands below nothing, as given.
paid_past_owed: Operation {{n}} ({{op}}): {{amount}} went into {{account}}, which owed {{owed}}; the whole amount moved, {{past}} past what was owed.
goods_words: Operation {{n}} ({{op}}): {{goods}} names no one recorded thing{{#several}}; it fits {{several}}{{/several}}, so nothing was made or moved and the words are kept on the payment. A thing the story buys is made with spawn first, then named.
terms_added: Operation {{n}} ({{op}}): the world's own terms came with this payment, {{count}} more sums ({{sums}}), each recorded as its own change that stands as assumed.
way_not_held: Operation {{n}} ({{op}}): {{payer}} holds nothing that pays as {{way}}, so the payment went their usual way.
use_give: Operation {{n}} ({{op}}): {{name}} is {{other}}, which holds no money of the economy's, and a payer or payee is someone or a group.{{#near}} Nearest: {{near}}.{{/near}} A thing that holds coin is given with the give operation.
closed_with_money: Operation {{n}} ({{op}}): {{what}} was closed with {{amount}} still on it.
derived: Operation {{n}} ({{op}}): {{name}}'s {{key}} is worked out by the rules, which give {{figure}}; {{value}} was kept as given and stands over it.
world_unlisted: Operation {{n}} ({{op}}): {{key}} is not a value the world's setup lists; {{value}} is recorded as the world's own, and every level below takes it unless it sets its own.
system_keeps: Operation {{n}} ({{op}}): {{system}} keeps {{key}} itself, as {{kept}}; that stands in the tree and in the sums, and {{value}} is recorded at the world beside it.
fact_lane_default: Operation {{n}} ({{op}}): no lane was named, so this fact is recorded in the {{lane}} lane.
off_the_sheet: Operation {{n}} ({{op}}): {{key}} of {{name}} {{#kept}}was given as {{value}}{{/kept}}{{^kept}}is now {{value}}{{/kept}}, outside what its sheet allows ({{type}}{{#min}}, at least {{min}}{{/min}}{{#max}}, at most {{max}}{{/max}}{{#choices}}, one of {{choices}}{{/choices}}){{#kept}}, and is held at {{held}}, its gauge's bound{{/kept}}.
not_numeric: Operation {{n}} ({{op}}): {{field}} of {{entity}} holds no number, so nothing was added to it and it stays as it was; the change is recorded as given.
capped: Operation {{n}} ({{op}}): {{field}} of {{entity}} was {{was}} and is held to {{now}}, the cap given; the change is recorded as given.
advised: Operation {{n}} ({{op}}) was recorded, and the engine advises on it ({{code}}).
unmet_requirement: Operation {{n}} ({{op}}) was carried out, though one of the action's requirements does not hold: {{requirement}}{{#words}} ({{words}}){{/words}}.
act_takes: Operation {{n}} (act): {{action}} takes {{#takes}}{{takes}}{{/takes}}{{^takes}}no arguments{{/takes}}. For example: {{example}}
act_param: {{name}}{{#optional}}, which may be left out{{/optional}}{{#says}} ({{says}}){{/says}}{{#choices}}, one of {{choices}}{{/choices}}
on_map: Operation {{n}} ({{op}}): {{said}}
off_path: Operation {{n}} ({{op}}): {{quest}} went from {{from}} to {{to}}, which is not one of the ways on from {{from}}.
time_back: Operation {{n}} ({{op}}): the clock was set back from {{from}} to {{to}}.
time_left_out: Operation {{n}} ({{op}}): {{field}} cannot be read, you sent {{value}}, so it was left out and {{used}} was applied.{{#wants}} It takes {{wants}}.{{/wants}}
time_differs: Operation {{n}} ({{op}}): {{field}} reads as {{other}} and {{used}} as {{to}}; the clock was set by {{used}}.
clock_paused: Operation {{n}} ({{op}}): the clock was paused for this scene, and it was moved as given; the pause still holds.
standing_cut: Operation {{n}} ({{op}}): the clock stopped at {{reached}}, short of {{asked}}: what the world's own records arrange (pay, bills, standing payments) runs over a year at most, and over so many changes at most, in one go, so it ran as far as that and no further. Pass the rest of the time with another pass_time.
time_stopped: Operation {{n}} ({{op}}): the clock stopped at {{reached}}, short of {{asked}}, where something of a kind the player set to stop a skip of time came due ({{kind}}). It is listed with what fell due: decide it, and pass the rest of the time with another pass_time.
time_interrupted: Operation {{n}} ({{op}}): the clock went to {{reached}}, the first time something of a kind the player set to stop a skip of time came due ({{kind}}). It is listed with what fell due: decide it.
time_no_interruption: Operation {{n}} ({{op}}): nothing of a kind the player set to stop a skip of time falls due in the next {{days}} days, so there is no next interruption to skip to, and the clock stands. Pass a span the story gives, with minutes, for or until, or tell the player there is nothing to skip to.
time_routine_held: Operation {{n}} ({{op}}): the player holds their character where the story has them over this span, so where their own routine would put them is not listed.
before_start: Operation {{n}} ({{op}}): the story starts at {{start}}, and the clock was set back to a time before it.
due_more: {{#n}}Operation {{n}} ({{op}}): {{/n}}only the first {{listed}} of what this span brings due are listed; {{more}} more fall due later in it.
due_more_uncounted: {{#n}}Operation {{n}} ({{op}}): {{/n}}only the first {{listed}} of what this span brings due are listed; more fall due later in it.
ran_said: Operation {{n}} ({{op}}): what the world's own records arrange over this span (pay, bills, standing payments, interest and the rest of what an account or a job sets going) happened in its order, and {{total}} {{#one}}change is{{/one}}{{^one}}changes are{{/one}} recorded. ran says what they were, with times where one happened more than once. None of it needs a decision from you.
ran_more: Operation {{n}} ({{op}}): only the first {{listed}} lines of what happened are in ran; {{more}} more lines are recorded all the same.
due_open: Operation {{n}} ({{op}}): nothing in due has happened yet; where people went, what they did, a meal or a night's sleep, the weather and a quest stage met are yours to record, as the story says it went.
no_map: {{at}} has no map to show.
shown_of: This shows {{shown}} tokens of the {{whole}} that {{at}} holds in all. world_query at {{id}} with depth full reads all of it; at one of its levels, by name or id, that level alone.
no_ruleset_entry: The ruleset's {{part}} has nothing called {{id}}{{#entries}} among its {{entries}} entries{{/entries}}. ruleset_read with the part alone reads all of it.
none_found: Nothing found for {{words}}.
more_found: Only the first {{shown}} of what {{words}} matches are listed; {{more}} more were found. Narrower words, or a kind, find them.
carried_none: Turn {{turn}} carries no record of an earlier build: nothing was migrated for it.
carried_removed: {{part}} of turn {{turn}}'s old record was removed by the earlier build's clean-up before it was carried, so its words are gone.
carried_unknown: Turn {{turn}}'s old record has no part {{part}}.{{#near}} Near: {{near}}.{{/near}} Its parts: {{parts}}.
carried_cut: {{part}} goes on past {{to}} of {{of}} characters: send from {{to}} to read on.
worlds_none: {{tool}} works on the player's worlds, and none can be reached from this run, so nothing was read or written.
world_not_named: No world is named, and this chat plays none: name one with world.
world_not_found: {{why}}
world_conflict: {{why}} The draft is as it now stands in the answer's data; write again on it.
world_validation: {{why}} The world's own checks refused it, so the draft stands as it was.
world_bad_request: {{why}}
world_bad_pointer: at {{at}} is not a JSON pointer: {{why}}
world_nothing_at: The document holds nothing at {{at}}.{{#near}} What its parent holds: {{near}}.{{/near}}
world_outline: The value at {{at}} is {{size}} characters, more than one answer holds, so what it holds is outlined: read further into one member with at.
rules_unknown: There is no rule set {{rules}}. The rule sets: {{choices}}.
rules_no_world: This chat plays no world, so there is nothing to put rules on or add a row to.
rules_behind: This chat plays an older revision of its world than the newest, which has changes this chat does not have yet. Move the chat to the newest first (world_upgrade), then try again. Nothing was changed.
rules_draft_open: The world has changes in Build that are not kept yet, and a revision made for the rules would keep them too. Nothing was changed: whoever owns the world keeps them or discards them in Build first.
rules_not_conflict: At {{paths}} the world has nothing of its own that {{rules}} would change, so there is nothing to take there. What {{rules}} would change: {{conflicts}}. Nothing was changed.
rules_plan: Nothing was changed. {{rules}} would add {{added}} to this world, finds {{same}} there already, and meets {{kept}} of the world's own that it would change{{#taken}}, {{taken}} of them as you named{{/taken}}.
rules_done: {{rules}} is on this world as revision {{revision}}: {{added}} added{{#taken}}, {{taken}} of the world's own replaced as you named{{/taken}}. This chat moves to it from its next turn; the world's other chats stay on the revision they play. One Undo of the Upgrade takes it back.
rules_already: This world has all of {{rules}} already, so no revision was made.
rules_kept: The world has its own {{labels}}, where {{rules}} would write; {{#one}}it was{{/one}}{{^one}}they were{{/one}} kept as {{#one}}it is{{/one}}{{^one}}they are{{/one}}. Name {{#one}}its path{{/one}}{{^one}}their paths{{/one}} in take to put the rule set's in {{#one}}its{{/one}}{{^one}}their{{/one}} place.
rules_on: The tabletop rules are on for this chat now.
rules_no_sheet: {{count}} {{#one}}person has{{/one}}{{^one}}people have{{/one}} no sheet yet: {{names}}{{#more}} and {{more}} more{{/more}}. Give each a sheet with the stat_as action, or set their abilities.
rules_table_unknown: {{table}} is no table of the rules. They are: {{choices}}.
rules_bad_id: {{id}} cannot be a row's key: use letters, digits, underscores, dots and hyphens, at most 64.
rules_no_rules: This world has no tabletop rules yet: put a rule set on it with rules_apply first.
rules_no_table: The world's rules name no table for {{role}}, or the world does not have it.
rules_bad_row: {{id}} cannot be a row of {{table}} as given, so nothing was written:
rules_row_missing: It has no {{column}}{{#doc}}, which is {{doc}}{{/doc}}.
rules_row_extra: It has a column {{column}}, which the table does not have. The table's columns: {{columns}}.
rules_row_type: Its {{column}} is {{wants}} in the table, and the row gives something else.
rules_row_lint: The world's own checks say of it: {{message}}
rules_row_added: {{id}} is a new row of {{table}} in revision {{revision}} of the world. This chat moves to it from its next turn; the world's other chats stay on the revision they play. One Undo of the Upgrade takes it back.
rules_row_changed: {{id}} of {{table}} was changed in revision {{revision}} of the world. This chat moves to it from its next turn; the world's other chats stay on the revision they play. One Undo of the Upgrade takes it back.
rules_row_same: {{id}} is already a row of {{table}} as given, so no revision was made.
wants_patch: a list of operations, each an object with op (add, remove, replace, move, copy or test) and path, as RFC 6902 gives them, the paths JSON pointers into the document
check_needs_against: {{check}} is a check rolled against someone, and the roll names no one to roll against; target takes who it is rolled against, or against the difficulty the total has to reach.
totals_cut_short: The run ended at {{reached}}, short of {{until}}: the engine's own cap on a run of this size stopped it there. The totals are for the span up to {{reached}}.
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
wants_words: some words, at least one character
wants_name: a name, of any length, with at least one character
bad_routine_value: Operation {{n}} ({{op}}): {{field}} cannot be read, you sent {{value}}.{{#wants}} It takes {{wants}}{{/wants}}{{#problems}} Cast life's problems with it: {{problems}}.{{/problems}}
wants_block_value: an object for one block of the routine (a label, an activity, a kind of fixed, flexible or optional, a length in minutes, and the start time at for a fixed block or a window from and to for another), {"off": true}, or null to put the world's block back.
wants_schedule_value: an object, either {"off": true, "until": a time or null} or its own slots as a list of {start, end} times (HH:MM) with an optional recurrence {every}, or null to put the world's schedule back.
no_weather_region: Operation {{n}} ({{op}}): {{where}} has no weather region of its own, so {{state}} was kept on the place itself; the places inside it take it unless they have theirs.
weather_state_unlisted: Operation {{n}} ({{op}}): the climate lists no state {{state}}; it was recorded as given. Its states are {{states}}.
no_accounts: Operation {{n}} ({{op}}): {{what}} has no accounts in the world, so the cash was recorded as given, as the cash they carry; no account was opened and no sum made up.
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
pov_agent: Operation {{n}} ({{op}}): {{who}} is the player's character, and was made an agent all the same; whether they have a mind of their own stays the player's setting.
single_class: Operation {{n}} ({{op}}): {{problem}} They were recorded all the same.
related_to_self: Operation {{n}} ({{op}}): {{who}} was related to themselves by {{relation}}; it was recorded all the same.
relation_kind: Operation {{n}} ({{op}}): {{relation}} joins a {{takes}} at its {{end}} end and {{who}} is not one; it was recorded all the same.
wants_class: an object of facet: list of values, such as {"trade": ["innkeeper"]}
wants_levels: an object of domain: level, a whole number from 0 to 4, or null for the one their tier gives
org_change_takes: Operation {{n}} ({{op}}): change cannot be read, you sent {{value}}.{{^do}} It is an object whose do is one of: {{dos}}, with the fields that change takes.{{/do}}{{#do}} A {{do}} names {{takes}}.{{#missing}} Not given: {{missing}}.{{/missing}}{{/do}}
unknown_job: Operation {{n}} ({{op}}): there is no job called {{name}}.{{#jobs}} The jobs are: {{jobs}}.{{/jobs}}
plan_full: Operation {{n}} ({{op}}): the plan already holds {{most}} open {{what}}, which is as many as this world's rules keep; it was kept all the same.
revenue_not_open: Operation {{n}} ({{op}}): the author of {{stream}} left the agents off it; the adjustment was made all the same.
revenue_factor: Operation {{n}} ({{op}}): a factor of {{factor}} on {{stream}} is outside {{least}} to {{most}}, which this world's rules allow an agent; the adjustment was made all the same.
revenue_amount: Operation {{n}} ({{op}}): {{amount}} on each payment of {{stream}} is more than a whole payment of it ({{period}}), the most this world's rules allow an agent; the adjustment was made all the same.
revenue_days: Operation {{n}} ({{op}}): an adjustment of {{stream}} lasting {{days}} days is longer than the {{most}} this world's rules allow an agent; it was made all the same.
revenue_crowded: Operation {{n}} ({{op}}): {{stream}} has {{most}} adjustments in force already, which is as many as this world's rules allow an agent; this one was made all the same.
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
acted_twice: Operation {{n}} ({{op}}): {{who}} has acted in round {{round}} already (this is act {{times}} of theirs in it); it was recorded all the same.
out_of_turn: Operation {{n}} ({{op}}): the order has {{whose}} next, not {{who}}; {{who}}'s act was recorded all the same and the fight went on to the turn after.
out_of_reach: Operation {{n}} ({{op}}): {{target}} is beyond {{who}}'s reach on the map; the act was recorded all the same.
fight_cost_not_left: Operation {{n}} ({{op}}): the action costs {{cost}} of the fight's budgets, which {{who}} has not left ({{why}}); it was carried out and recorded into the fight all the same.
no_d20_rules: This world has no tabletop rules, so there is no sheet of them to read; world_query at the person reads what it holds.
d20_sheet_off: The tabletop rules are off in this chat, so they give no sheet here; what the chat's sheet holds without them is world_query at the person.
d20_roll_refused: The roll was not made: {{why}}
d20_roll_from_sheet: {{who}} has a sheet of the tabletop rules: a check from it is the world_apply operation act with action check, who {{who}}, and params skill (the skill's or ability's name){{#dc}} and difficulty {{dc}}{{/dc}}, which reads the bonus from the sheet; this roll stands as rolled, with the modifier it was given.
d20_fight_award: Operation {{n}} ({{op}}): {{party}} fought {{foes}}. Under the tabletop rules, experience for what was overcome is given with world_apply {{call}} (leave out anyone not overcome).
rounds_clock: Operation {{n}} ({{op}}): {{rounds}} {{#one}}round{{/one}}{{^one}}rounds{{/one}} on the grid moved the clock {{seconds}} seconds.
harm_kept: Operation {{n}} ({{op}}): this world's ruleset names no gauge a fight's harm comes off (its combat hp), so the {{harm}} harm to {{who}} was kept with the act and no value changed.
harm_no_gauge: Operation {{n}} ({{op}}): {{who}} has no {{gauge}}, the gauge this world's ruleset takes a fight's harm off, so the {{harm}} harm was kept with the act and no value changed.
wants_harm: a number of 0 or more, what the one it was aimed at lost
wants_fight_action: an object with who (a fighter) and did (what they did), and optionally to (whom it was aimed at), result (how it came out), harm (what they lost) and roll (the id of the roll that decided it)
fight_broke_off: Operation {{n}} ({{op}}): the fight under way was ended as the story moved on; no winner was recorded.
fight_still_on: Operation {{n}} ({{op}}): the fight under way is still on; nothing was recorded.
joined: Operation {{n}} ({{op}}): {{who}} joined the fight {{fight}}, which was under way; no one else was added.
which_fight: {{#n}}Operation {{n}} ({{op}}): {{/n}}more than one fight is under way ({{fights}}); name the one with fight, by its id.
unknown_fight: {{#n}}Operation {{n}} ({{op}}): {{/n}}no fight {{fight}} is under way; the fights under way are: {{fights}}.
no_route: Operation {{n}} ({{op}}): the world's routes give {{what}} no way to {{where}}; the drive was recorded as the call gave it, and no walk was worked out.
no_fuel: Operation {{n}} ({{op}}): {{what}} has less fuel recorded than the world's tables say the trip uses; the drive was recorded all the same.
broken: Operation {{n}} ({{op}}): {{what}} is recorded as broken down; the drive was recorded all the same.
route_short: Operation {{n}} ({{op}}): the world's routes take {{what}} as far as {{where}} and no further toward {{to}}; the drive was recorded as the call gave it, and no walk was worked out.
driver_not_aboard: Operation {{n}} ({{op}}): {{who}} drives {{what}} but is neither aboard nor at the place it stood; they were moved with it all the same.
driver_gone: Operation {{n}} ({{op}}): the driver recorded for {{what}} ({{who}}) is out of the world, so no one drives it in this drive.
not_recorded: Operation {{n}} ({{op}}): {{what}} has no {{field}} recorded, so the amount given was not added.
not_a_vehicle: Operation {{n}} ({{op}}): {{name}} is not a vehicle. The vehicles nearest that name: {{vehicles}}. To put a thing somewhere, use the move operation.
wants_number: a number
wants_yes_no: true or false
unknown_holiday: {{#n}}Operation {{n}} ({{op}}): {{/n}}no holiday {{holiday}} is on this calendar; the holidays are: {{holidays}}.
wants_date_md: a day of the year as MM-DD, such as 12-25
wants_date_rule: an object: {"type": "fixed", "month", "day"}, {"type": "nth_weekday", "month", "weekday" (0 is Sunday), "n"}, {"type": "easter", "days" from Easter} or {"type": "relative", "to" (a holiday's id), "days"}
fuel_memo: Fuel for {{what}}
service_memo: Service: {{what}}
repair_memo: Repair: {{what}}
no_effect: No effect the GM may run has {{search}} in its name. Call gm_effects with no search for all of them.
unknown_effect: Operation {{n}} ({{op}}): {{effect}} is not an effect the GM may run. Near it: {{effects}}. gm_effects lists them all, with the arguments each reads.
quest_opened: Operation {{n}} ({{op}}): opened the {{kind}} {{what}}.
quest_exists: Operation {{n}} ({{op}}): {{what}} is already a quest, so the call writes to it.
quest_written: Operation {{n}} ({{op}}): {{what}} was written: {{parts}}.
quest_world_part: Operation {{n}} ({{op}}): {{what}} is the world's own quest, so {{fields}} was left out; only its stages, what the player is shown and how it closes are written to it.
quest_way_on: {{#fails}}This makes the quest {{quest}} fail at {{from}} by its own condition, and its failing way leads to {{to}}{{/fails}}{{^fails}}This lets the quest {{quest}} move on from {{from}} to {{to}}{{/fails}}. Nothing moves it but a call: world_apply with {{call}}, and your reason as why.
unknown_thread: Operation {{n}} ({{op}}): the story record holds no thread {{thread}}.{{#near}} Its threads: {{near}}.{{/near}}
unknown_beat: Operation {{n}} ({{op}}): the story record holds no beat {{beat}}.{{#near}} Its beats near that: {{near}}.{{/near}}
fact_part_place: Operation {{n}} ({{op}}): a part names where in a place's record a fact belongs, and {{about}} is not a place. Leave the part out{{#choices}}, or write a fact about a place with one of: {{choices}}{{/choices}}.
part_needs_place: world_query reads a part of a place's record, and {{at}} is not a place. Leave the part out, or ask at a place for one of: {{choices}}.
wants_stage_list: a list of stage ids, or all, none, or default
wants_stage: an object with the stage's id in `stage`, and its `label`, `condition` and where it stands in `after`

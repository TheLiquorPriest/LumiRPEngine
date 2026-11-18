---
description: The sentences the tabletop rules layer's records say, on the turn's card, in the briefing and in an action's answer - a check, a save, an attack, harm, healing, a condition or an effect put on or taken off, a night's rest, a reload, experience, a level, a trait, ranks, a sheet from the bestiary, a state hit points brought, and what a fight's turn or the clock did of itself. Each gives the numbers and where they came from. One line per name, a name, a colon, then its text. A name in double braces puts in what the record holds (a name, a number, a total's parts), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that record is not said at all.
format: lines
keys:
  ev_d20_*: what one of the layer's records says, filled with what it holds
  d20_*: the pieces a record's words are made of - a total's parts, a roll, damage, harm, healing, a length, an outcome
  why_d20_*: why one of the layer's actions could not be worked out, and what it takes instead
---
d20_part_base: {{value}} base
d20_part_ability: {{value}} {{ability}}
d20_part_score: {{value}} {{ability}} score
d20_part_ranks: {{value}} ranks
d20_part_classes: {{value}} from classes ({{track}})
d20_part_levels: {{value}} from levels
d20_part_hit_dice: {{value}} hit dice
d20_part_size: {{value}} size
d20_part_total: {{value}} {{name}}
d20_part_limit: {{value}} at most ({{name}})
d20_part_formula: {{value}} ({{formula}})
d20_part_mod: {{value}}{{#type}} {{type}}{{/type}} {{from}}{{#note}} ({{note}}){{/note}}
d20_part_mod_lost: {{value}}{{#type}} {{type}}{{/type}} {{from}}, not counted: a better {{type}} bonus counts
d20_given: named in the call
ev_d20_check: {{who}} {{#ruled}}used {{what}}: ruled {{outcome}}, nothing rolled{{/ruled}}{{^ruled}}rolled {{what}}{{#take}} taking {{take}}{{/take}}: {{#natural}}{{natural}} on the die, {{/natural}}total {{total}}{{#parts}} ({{parts}}){{/parts}}{{#dc}} against {{dc}}{{/dc}}{{#vs}} against {{vs}}'s {{against}}{{/vs}}{{#aided}}; helped: {{aided}}{{/aided}}{{#outcome}}: {{outcome}}{{/outcome}}{{/ruled}}{{#notes}} ({{notes}}){{/notes}}.
ev_d20_save: {{who}} made a {{save}} save: {{#ruled}}ruled {{outcome}}, nothing rolled{{/ruled}}{{^ruled}}{{#natural}}{{natural}} on the die, {{/natural}}total {{total}}{{#parts}} ({{parts}}){{/parts}} against {{dc}}: {{outcome}}{{/ruled}}.
ev_d20_attack: {{who}} attacked {{target}}{{#with}} with {{with}}{{/with}}: {{told}}{{#notes}} ({{notes}}){{/notes}}
ev_d20_harm: {{who}} took {{amount}}{{#type}} {{type}}{{/type}}{{#nonlethal}} nonlethal{{/nonlethal}} harm{{#dice}} ({{dice}} rolled {{rolled}}){{/dice}}{{#by}} from {{by}}{{/by}}{{#why}}, {{why}}{{/why}}: {{told}}.
ev_d20_heal: {{who}} was healed{{#dice}} ({{dice}} rolled {{rolled}}){{/dice}}{{#why}}, {{why}}{{/why}}: {{told}}.
ev_d20_condition: {{who}} {{told}}{{#why}} ({{why}}){{/why}}.
ev_d20_effect: {{who}} {{told}}{{#why}} ({{why}}){{/why}}.
ev_d20_rest: {{who}} rested {{hours}} hours: {{told}}.
ev_d20_reload: {{who}} reloaded {{item}}: {{told}}.
ev_d20_award: {{who}} gained {{xp}} experience{{#why}}, {{why}}{{/why}}: {{told}}.
ev_d20_advance: {{who}} took a level of {{class}}: {{told}}.
ev_d20_trait: {{who}} {{told}}{{#why}} ({{why}}){{/why}}.
ev_d20_ranks: {{who}} {{told}}.
ev_d20_stat_as: {{who}} took the sheet of {{creature}}: {{told}}.
ev_d20_state: {{who}} {{told}}.
ev_d20_upkeep: {{who}}: {{told}}.
d20_outcome_success: success
d20_outcome_failure: failure
d20_outcome_rolled: rolled
d20_outcome_hit: a hit
d20_outcome_miss: a miss
d20_outcome_critical: a critical
d20_roll: {{natural}} on the die {{bonus}} makes {{total}} against {{dc}}: {{outcome}}
d20_save_ruled: the {{save}} save ruled {{outcome}}
d20_part_aid: {{value}} from help
d20_part_enhancement: {{value}} enhancement of {{from}}
d20_part_unskilled: {{value}} not proficient with {{weapon}}
d20_part_nonlethal: {{value}} to deal nonlethal harm
d20_part_secondary: {{value}} as a lesser attack
d20_part_range: {{value}} range ({{distance}} away, {{increments}} increment(s) past the first)
d20_part_shot: {{value}} {{shot}} shot
d20_untrained: {{skill}} is used only with ranks in it, and was rolled all the same
d20_aid: {{who}} helped with {{total}} against {{dc}}, {{outcome}}
d20_no_take: no number {{take}} to take (the ruleset's are {{takes}}), so the check was rolled
d20_attack_one: Attack {{n}}: {{words}}.
d20_attack_roll: {{natural}} on the die {{bonus}}{{#offset}} (a further attack, {{offset}}){{/offset}}{{#parts}} ({{parts}}){{/parts}} makes {{total}} against {{#touch}}touch {{/touch}}{{#flat}}flat-footed {{/flat}}defence {{defence}}{{#defence_parts}} ({{defence_parts}}){{/defence_parts}}: {{outcome}}{{#confirm}}; {{confirm}}{{/confirm}}
d20_attack_ruled: ruled {{outcome}}
d20_confirm: confirming {{natural}} on the die makes {{total}}: {{outcome}}
d20_concealed: concealment's {{chance}} in a hundred came up {{rolled}}: a miss
d20_damage: damage {{dice}} rolled {{rolled}}{{#times}} (the dice {{times}} times){{/times}}{{#strength}}, {{strength}} Strength{{/strength}}{{#bonus}}, {{bonus}} more{{/bonus}}: {{total}}
d20_reduction: {{amount}} stopped by {{from}}
d20_resistance: {{amount}} resisted by {{from}}
d20_rounds_spent: {{spent}} round(s) spent, {{left}} left in the magazine
d20_magazine_short: {{weapon}} held {{loaded}} of the {{spend}} round(s) the shot spends
d20_out_of_range: {{distance}} away is beyond the most the range reaches ({{most}}), rolled all the same
d20_no_shot: no shot {{said}} (the ruleset's are {{shots}}), so a single attack was made
d20_shot_not_fired: {{weapon}} has no fire mode for a {{shot}} shot, fired all the same
d20_shot_needs_trait: a {{shot}} shot needs {{trait}}, which the shooter does not have, fired all the same
d20_area_saved: {{who}} saved ({{save}}) and took nothing
d20_area_hit: {{who}} did not save ({{save}}); {{damage}}{{#stopped}}; {{stopped}}{{/stopped}}; {{harm}}
d20_harm_hp: hit points {{from}} to {{to}}
d20_harm_nonlethal: nonlethal harm {{from}} to {{to}}
d20_harm_temporary: {{absorbed}} off temporary hit points, {{left}} left
d20_harm_massive: massive harm, a save: {{save}}
d20_state: {{#on}}is now {{on}}{{/on}}{{#off}}{{#on}}, {{/on}}is no longer {{off}}{{/off}}{{#life}} ({{life}}){{/life}}
d20_heal_hp: hit points {{from}} to {{to}}
d20_heal_nonlethal: nonlethal harm {{from}} to {{to}}
d20_heal_temporary: temporary hit points {{from}} to {{to}}
d20_stabilized: made stable
d20_nothing_changed: nothing changed
d20_gauge_full: {{gauge}} {{from}} to {{to}}
d20_length: {{#rounds}}for {{rounds}} round(s){{/rounds}}{{#minutes}}{{#rounds}}, {{/rounds}}for {{minutes}} minute(s){{/minutes}}{{#save}}, until a {{save}} save against {{dc}}{{/save}}{{^rounds}}{{^minutes}}{{^save}}until it is taken off{{/save}}{{/minutes}}{{/rounds}}
d20_condition_on: is now {{condition}}{{#mods}} ({{mods}}){{/mods}} {{length}}{{#text}}: {{text}}{{/text}}
d20_condition_off: is no longer {{condition}}
d20_effect_on: is under {{label}} ({{mods}}) {{length}}
d20_effect_off: is no longer under {{label}}
d20_reloaded: rounds in the magazine {{from}} to {{to}} of {{magazine}}{{#short}}, {{short}} short: no more were carried{{/short}}
d20_awarded: experience {{from}} to {{to}}{{#open}}; it reaches level {{level}}, so {{open}} more level(s) can be taken{{/open}}
d20_advanced: level {{level}} of it, level {{total}} in all; {{kept}} hit points on a d{{die}} ({{way}}); {{points}} skill point(s) to spend{{#feat}}; a feat to choose{{/feat}}{{#ability}}; an ability point to place{{/ability}}{{#features}}; it gives {{features}}{{/features}}
d20_trait_on: has {{trait}} now{{#text}}: {{text}}{{/text}}{{#unmet}} (it requires {{unmet}}, which does not hold: taken all the same){{/unmet}}
d20_trait_off: no longer has {{trait}}
d20_ranks: has {{to}} rank(s) in {{skill}} (from {{from}}); at most {{most}}{{#over}}, so this is over the most{{/over}}{{#class_skill}}, a class skill{{/class_skill}}; {{left}} skill point(s) left
d20_stat_as: {{fields}} value(s) of the sheet and {{attacks}} attack(s)
d20_upkeep_stable: dying, rolled {{total}} and is stable
d20_upkeep_lost: dying, rolled {{total}} and lost {{lost}} hit point(s), {{from}} to {{to}}
d20_upkeep_saved: {{name}} ended on a save: {{save}}
d20_upkeep_ended: {{name}} ran out
d20_mod_to: {{value}}{{#type}} {{type}}{{/type}} to {{to}}
d20_sheet_rounds: {{loaded}} of {{magazine}} rounds loaded
d20_ruleset_skill: {{skill}} [{{id}}] ({{ability}}{{#trained}}, only with ranks in it{{/trained}}{{#armor}}, armour's check penalty applies{{/armor}})
d20_ruleset_use: Every number of these rules comes from a sheet: read one with the tool sheet. What the rules work out is done by their actions, each carried out with the world_apply operation act, which work the numbers out and answer with each one's parts: check, save, attack, harm, heal, condition, effect, d20_rest (a night's rest), reload, award (experience), advance (a level), trait, ranks and stat_as (a sheet from the bestiary). A difficulty is a number or one of the difficulties above.
why_d20_no_rules: This world has no tabletop rules, so there is nothing to work this out by.
why_d20_off: The tabletop rules are switched off in this chat; switch them on to use them.
why_d20_no_skill: {{said}} is no skill or ability of this ruleset. Skills: {{skills}}.{{#abilities}} Abilities: {{abilities}}.{{/abilities}}
why_d20_no_save: {{said}} is no save of this ruleset. Saves: {{saves}}.
why_d20_no_difficulty: A save needs a difficulty: a number, or one of the ruleset's difficulties{{#said}} ({{said}} is neither){{/said}}.
why_d20_no_target: {{#said}}{{said}} is no one in the world to attack.{{/said}}{{^said}}An attack needs a target: whom it is made against, by name or id.{{/said}}
why_d20_odds_no_difficulty: A check's chance needs a difficulty (a number, or one of the ruleset's difficulties) or someone it is rolled against (vs); without either the check is only rolled.
why_d20_no_weapon: {{who}} has nothing to attack with{{#said}} by the name {{said}}{{/said}}: no weapon readied and no attack of its own. Name a weapon it carries, one of its own attacks, or a weapons row in with.
why_d20_no_amount: {{said}} is no number and no dice.
why_d20_no_condition: {{said}} is no condition of this ruleset. Conditions: {{conditions}}.
why_d20_no_label: An effect needs a label, the name it is put on and taken off by.
why_d20_effect_mods: An effect needs its modifiers, each a number, its type and what it changes ("+2 morale to attack: a rousing song").
why_d20_no_magazine: {{who}} has no weapon with a magazine{{#said}} by the name {{said}}{{/said}} to reload.
why_d20_no_xp: Experience needs a number, or who was overcome.
why_d20_no_class: {{said}} is no class of this ruleset. Classes: {{classes}}.
why_d20_no_trait: {{said}} is no trait of this ruleset.
why_d20_no_creature: {{said}} is no creature of this ruleset's bestiary.

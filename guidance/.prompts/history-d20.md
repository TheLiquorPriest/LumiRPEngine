---
description: The sentences the tabletop rules layer's records say, on the turn's card, in the briefing and in an action's answer - a check, a save, an attack, harm, healing, a condition or an effect put on or taken off, a night's rest, a reload, experience, a level, a trait, ranks, a sheet from the bestiary, a state hit points brought, and what a fight's turn or the clock did of itself. Each gives the numbers and where they came from. One line per name, a name, a colon, then its text. A name in double braces puts in what the record holds (a name, a number, a total's parts), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that record is not said at all.
format: lines
keys:
  ev_d20_*: what one of the layer's records says, filled with what it holds
---
ev_d20_check: {{who}} rolled {{what}}{{#take}} taking {{take}}{{/take}}: {{total}}{{#parts}} ({{parts}}){{/parts}}{{#dc}} against {{dc}}{{/dc}}{{#vs}} against {{vs}}'s {{against}}{{/vs}}{{#outcome}}, {{outcome}}{{/outcome}}.
ev_d20_save: {{who}} made a {{save}} save: {{total}}{{#parts}} ({{parts}}){{/parts}} against {{dc}}, {{outcome}}.
ev_d20_attack: {{who}} attacked {{target}}{{#with}} with {{with}}{{/with}}: {{told}}
ev_d20_harm: {{who}} took {{amount}}{{#type}} {{type}}{{/type}}{{#nonlethal}} nonlethal{{/nonlethal}} harm{{#why}} ({{why}}){{/why}}{{#told}}: {{told}}{{/told}}.
ev_d20_heal: {{who}} {{told}}{{#why}} ({{why}}){{/why}}.
ev_d20_condition: {{who}} {{told}}{{#why}} ({{why}}){{/why}}.
ev_d20_effect: {{who}} {{told}}{{#why}} ({{why}}){{/why}}.
ev_d20_rest: {{who}} rested {{hours}} hours: {{told}}.
ev_d20_reload: {{who}} reloaded {{item}}: {{told}}.
ev_d20_award: {{who}} gained {{xp}} experience{{#why}} ({{why}}){{/why}}: {{told}}.
ev_d20_advance: {{who}} took a level of {{class}}: {{told}}.
ev_d20_trait: {{who}} {{told}}{{#why}} ({{why}}){{/why}}.
ev_d20_ranks: {{who}} {{told}}.
ev_d20_stat_as: {{who}} took the sheet of {{creature}}: {{told}}.
ev_d20_state: {{who}} {{told}}.
ev_d20_upkeep: {{who}}: {{told}}.

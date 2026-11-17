---
description: The player's journal, the sentences of what changed as it is told to the player - a posting between accounts, who carries a thing and where it is, a field set or unset as a sentence, a relation made or ended, a thing removed, back or made, a number that went up or down, a quest stage, and the line for a change the player may not see. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  post_between: a posting between two accounts of the player (or of anyone, on a GM's line) - label, amount, from, to; post_out_of, post_into, post_net_out, post_net_in the other forms of it, and post_label the label of one with no memo
  thing_carried_by: a thing and who carries it, thing_in and thing_at where it is - name, holder or place
  set_place: a change of a field as a sentence, one line for each field and form (set_place, set_bed_*, set_home_*, set_owner*, set_unset, set_marked, set_unmarked, set_list*, set_value, set_value_at_most) - who or whose, noun, the value; many is true where the subject is the player (a plural verb)
  rel_knows: a relation made or ended as a sentence, one line for each relation (rel_knows, rel_carried_by, rel_in, rel_uses, rel_uses_ended, rel_owns, rel_worn_by, rel_equipped, rel_member_of, rel_regard, rel_regard_none, rel_other) - from, to, now (true where it was made), many
  entity_gone: a thing removed, back, or made (entity_gone, entity_back, entity_appears) - name; add_down and add_up a number that went down or up - whose, noun, amount; stage_now a quest stage - track, stage; change_unseen the line for a change the player may not see
---
post_label: Money moved
post_between: {{label}}: {{amount}} from {{from}} to {{to}}
post_out_of: {{label}}: {{amount}} out of {{account}}
post_into: {{label}}: {{amount}} into {{account}}
post_net_out: {{label}}: −{{amount}}
post_net_in: {{label}}: +{{amount}}
thing_carried_by: {{name}} (carried by {{holder}})
thing_in: {{name}} (in {{holder}})
thing_at: {{name}} (at {{place}})
set_place: {{who}} {{#many}}are{{/many}}{{^many}}is{{/many}} now at {{place}}
set_bed_home: {{who}} now {{#many}}sleep{{/many}}{{^many}}sleeps{{/many}} at home
set_bed_at: {{who}} now {{#many}}sleep{{/many}}{{^many}}sleeps{{/many}} at {{bed}}
set_bed_in: {{who}} now {{#many}}sleep{{/many}}{{^many}}sleeps{{/many}} in {{bed}}
set_bed_on: {{who}} now {{#many}}sleep{{/many}}{{^many}}sleeps{{/many}} on {{bed}}
set_home_none: {{who}} no longer {{#many}}have{{/many}}{{^many}}has{{/many}} a home
set_home_at: {{who}} now {{#many}}live{{/many}}{{^many}}lives{{/many}} at {{home}}
set_home_in: {{who}} now {{#many}}live{{/many}}{{^many}}lives{{/many}} in {{home}}
set_owner_none: {{who}} no longer {{#many}}belong{{/many}}{{^many}}belongs{{/many}} to anyone
set_owner: {{who}} now {{#many}}belong{{/many}}{{^many}}belongs{{/many}} to {{owner}}
set_unset: {{whose}} {{noun}} is no longer set
set_marked: {{who}} {{#many}}are{{/many}}{{^many}}is{{/many}} now marked “{{noun}}”
set_unmarked: {{who}} {{#many}}are{{/many}}{{^many}}is{{/many}} no longer marked “{{noun}}”
set_list_changed: {{whose}} {{noun}} changed
set_list_none: {{whose}} {{noun}} are now none
set_list: {{whose}} {{noun}} are now {{items}}
set_value: {{whose}} {{noun}} is now {{value}}
set_value_at_most: {{whose}} {{noun}} is now at most {{value}}
rel_knows: {{from}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} {{#many}}know{{/many}}{{^many}}knows{{/many}} {{to}}
rel_carried_by: {{from}} {{#many}}are{{/many}}{{^many}}is{{/many}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} carried by {{to}}
rel_in: {{from}} {{#many}}are{{/many}}{{^many}}is{{/many}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} in {{to}}
rel_uses: {{from}} now {{#many}}borrow{{/many}}{{^many}}borrows{{/many}} {{to}}
rel_uses_ended: {{from}} gave back {{to}}
rel_owns: {{from}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} {{#many}}own{{/many}}{{^many}}owns{{/many}} {{to}}
rel_worn_by: {{from}} {{#many}}are{{/many}}{{^many}}is{{/many}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} worn by {{to}}
rel_equipped: {{from}} {{#many}}are{{/many}}{{^many}}is{{/many}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} equipped by {{to}}
rel_member_of: {{from}} {{#many}}are{{/many}}{{^many}}is{{/many}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} a member of {{to}}
rel_regard: {{whose}} regard for {{to}} changed
rel_regard_none: {{from}} no longer {{#many}}hold{{/many}}{{^many}}holds{{/many}} any regard for {{to}}
rel_other: {{from}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} {{#many}}have{{/many}}{{^many}}has{{/many}} a “{{link}}” link to {{to}}
entity_gone: {{name}} is gone
entity_back: {{name}} is back
entity_appears: {{name}} appears
add_down: {{whose}} {{noun}} went down by {{amount}}
add_up: {{whose}} {{noun}} went up by {{amount}}
stage_now: {{track}} is now at “{{stage}}”
change_unseen: A change no longer applies

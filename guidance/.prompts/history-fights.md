---
description: The sentences a fight's own narrator lines and notes say - a fight starts, fighters join, a round and whose turn it is, a fighter acts, spends, goes down or gets up, the player's character is out of it, the fight peters out, breaks off, is over or is decided; and what the narrator is told to do with it. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  fight_start: a fight began - party, foes
  fight_join: fighters joined a fight - who
  fight_turn: whose turn it is - actor
  fight_spend: a fighter spent from a budget - who, costs
  fight_act: a fighter acted - actor, what, target, outcome
  fight_down: a fighter is down - who
  fight_up: a fighter is back up - who
  fight_left: the player's character left the fight
  fight_stalemate: the fight petered out
  fight_broke_off: the fight broke off as time moved on
  fight_over: the fight is over - won or lost, from the player's side
  fight_decided: a fighter decided - choice
  fight_*: what a fight's own narrator lines and notes say (a fight starts, a round and whose turn, you are out of it, it peters out or is over) and what the narrator is told to do with it; each is filled with what it names
---
fight_start: A fight: {{party}} against {{foes}}
fight_join: {{who}} joined the fight
fight_turn: {{actor}}'s turn
fight_spend: {{who}} spends {{costs}}
fight_act: {{actor}}: {{what}}{{#target}} → {{target}}{{/target}}{{#outcome}} ({{outcome}}){{/outcome}}
fight_down: {{who}}: down
fight_up: {{who}}: back up
fight_left: You left the fight
fight_stalemate: The fight petered out
fight_broke_off: The fight broke off as time moved on
fight_over: The fight is over{{#won}}: your side won{{/won}}{{#lost}}: your side lost{{/lost}}
fight_decided: decided {{choice}}
fight_you_leave_the_fight: You leave the fight.
fight_no_one_has_attacked_or_been_hurt: No one has attacked or been hurt in {{rules}} rounds: the fight peters out.
fight_the_fight_is_over_your_side_won: The fight is over{{#if_party}}: your side won{{/if_party}}{{^if_party}}{{#if_foes}}: your side lost{{/if_foes}}{{/if_party}}.
fight_a_fight_starts_initiative_names: A fight starts. Initiative: {{names}}.
fight_you_are_out_of_the_fight_it: You are out of the fight; it goes on (round {{round}}).
fight_round_round_your_turn_left_left: Round {{round}}, your turn{{#if_left}}: {{left}} left{{/if_left}}.
fight_narrate_the_fight_in_this_order_add: Narrate the fight in this order; add no other attacks, hits or damage.
fight_the_fight_is_over: The fight is over.
fight_current_of_max_left:  ({{current}}{{#if_max}} of {{max}}{{/if_max}} left)
fight_round_round: Round {{round}}.

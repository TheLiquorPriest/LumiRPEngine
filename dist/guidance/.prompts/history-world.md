---
description: The notices the world gives the player's side - someone leaves or arrives, a need is pressing, someone invites the player to meet, a lent thing is back or overdue, what a set called for is not to hand, and someone reaches or drops to a level. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  person_leaves: someone the player sees leaves - name
  person_arrives: someone arrives where the player is - name
  thing_got_back: an owner got a lent thing back - name, thing
  need_alert: a need is pressing on the player's character - word (hungry, tired, lonely, bored)
  invitation: someone invites the player to meet - name, place (absent where the player may not know it), time
  thing_overdue: a lent thing is overdue - thing, borrower
  set_not_to_hand: what a set called for was not to hand - set, missing
  level_reached: someone reached a level - name, you, progression, level, from (absent for one level)
  level_dropped: someone dropped to a level - name, you, progression, level, from
---
person_leaves: {{name}} leaves.
person_arrives: {{name}} arrives.
thing_got_back: {{name}} got {{thing}} back.
need_alert: You are getting {{word}}.
invitation: {{name}} invites you to {{#place}}{{place}}{{/place}}{{^place}}meet up{{/place}} at {{time}}.
thing_overdue: {{thing}} is overdue from {{borrower}}.
set_not_to_hand: Not to hand for {{set}}: {{missing}}.
level_reached: {{#you}}You{{/you}}{{^you}}{{name}}{{/you}} reached {{progression}} {{level}}{{#from}} (from {{from}}){{/from}}.
level_dropped: {{#you}}You{{/you}}{{^you}}{{name}}{{/you}} dropped to {{progression}} {{level}} (from {{from}}).

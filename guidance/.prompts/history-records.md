---
description: The engine's own record lines, one per kind of record, as the GM's and the author's views and the player's journal show them (a field set, a number added, a link made or ended, a quest stage, a clock, a time lapse, a roll, a check, a thing made or removed, a class or a life change, a thing told, a workspace change and the rest), and the lines of what changed in a draft, a regard, a need or a story flag. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  ev_*: the engine's own record lines, one per kind of record, as the GM's and the author's views and the player's journal show them (ev_set, ev_add, ev_link, ev_unlink, ev_stage, ev_clock_*, ev_timelapse, ev_roll, ev_check, ev_entity*, ev_class_*, ev_life*, ev_told, ev_ws_*, and the rest named ev_) - each is filled with what it names (ev_set - name, field, value, atMost; ev_add - name, field, delta; ev_link and ev_unlink - from, rel, to; ev_roll - actor, action, outcome, rolled, why; ev_check - actor, check, outcome, total, dc)
  need_eased, need_rose: a need eased or rose - you (true where it is the player's), name, need
  need_standing, needs_none: a person's need as it stands, as the Needs view shows it, and the words where the world has every need off - name, value (of 100), word (its word once it presses, hungry), pressing, since (when it began to press by the story's clock, where its record says), tell (the point it presses from), alert (the point it falls due from), met_by
  story_flag: the record line of a story flag - name
  regard_*: what changed in someone's regard - by, whose, axis, to, moved, parts
  draft_*: what changed in a world draft - how, what, from, to, map, place
---
ev_set: {{name}}: {{field}} {{#value}}is {{#atMost}}at most{{/atMost}}{{^atMost}}now{{/atMost}} {{value}}{{/value}}{{^value}}changed{{/value}}
ev_add: {{name}}: {{field}} {{delta}}
ev_link: {{from}} {{rel}} {{to}}
ev_unlink: {{from}} no longer {{rel}} {{to}}
ev_stage: {{#track}}{{track}}{{/track}}{{^track}}A thread{{/track}}: {{#stage}}{{stage}}{{/stage}}{{^stage}}moved on{{/stage}}
ev_clock_min: +{{min}} min
ev_clock_s: +{{s}} s
ev_clock_min_s: +{{min}} min {{s}} s
ev_timelapse: timelapse {{minutes}} min
ev_materialized: {{entity}} {{domain}} detail
ev_unmaterialized: {{entity}} {{domain}} detail taken back
ev_rule: rule {{rule}}
ev_caught: {{agent}} caught up
ev_catchup_queue: catch-up queue
ev_choice: {{key}}: {{choice}}
ev_attempt: attempt on {{track}}
ev_hint_opened: hint opened on {{track}}
ev_hint_closed: hint closed on {{track}}
ev_track_revealed: {{track}} revealed
ev_clock_pause: clock pause
ev_clock_set_back: clock set back {{minutes}} min
ev_renamed: {{was}} is now called {{name}}
ev_meanwhile: what you saw meanwhile
ev_roll: {{actor}}: {{action}}, {{outcome}}{{^rolled}} (no roll: {{why}}){{/rolled}}
ev_check: {{actor}}: {{check}}, {{outcome}}{{#total}} (rolled {{total}}{{#dc}} against {{dc}}{{/dc}}){{/total}}
ev_entity_tier: is now in the {{tier}} tier
ev_entity_agent_on: now lives their own life off-screen
ev_entity_agent_off: no longer lives their own life off-screen
ev_entity_level_cleared: has {{area}} detail from their tier again
ev_entity_level: now has {{area}} detail at level {{level}}{{#label}} ({{label}}){{/label}}
ev_entity: {{name}} {{clauses}}
ev_none: none
ev_class_facet: {{whose}} {{noun}} is now {{values}}
ev_class_tags: {{whose}} tags are now {{tags}}
ev_class_none: {{name}} now has no classes and no tags
ev_life: {{name}} is now {{state}}
ev_life_you: You are now {{state}}
ev_life_reads: {{name}} {{reads}}
ev_told: {{who}} now {{#one}}knows{{/one}}{{^one}}know{{/one}} that {{name}} {{reads}}
ev_ws_written: workspace file {{path}} written
ev_ws_deleted: workspace file {{path}} deleted
ev_ws_pinned: workspace file {{path}} pinned
ev_ws_unpinned: workspace file {{path}} unpinned
ev_ws_readers_pov: workspace file {{path}} read with the player character's knowledge
ev_ws_readers_everyone: workspace file {{path}} read with everyone's knowledge
ev_ws_readers_gm: workspace file {{path}} read with the GM's knowledge
ev_output_told: {{kind}} lines told to the narrator
ev_scene_told: the scene's lore and notes told to the narrator
need_eased: {{#you}}Your{{/you}}{{^you}}{{name}}'s{{/you}} {{need}} eased
need_rose: {{#you}}Your{{/you}}{{^you}}{{name}}'s{{/you}} {{need}} rose
need_standing: {{name}} {{value}} of 100{{#pressing}}, so {{word}}{{#if_since}} since {{since}}{{/if_since}}{{/pressing}}{{^pressing}}, {{word}} from {{tell}}{{/pressing}}. Met by {{met_by}}; from {{alert}} it falls due when time passes.
needs_none: Every need is off in this world.
story_flag: flag {{name}}
regard_rose: rose by {{by}}
regard_fell: fell by {{by}}
regard_axis: {{whose}} {{axis}} toward {{to}} {{moved}}
regard_changed: {{whose}} regard for {{to}} changed: {{parts}}
regard_settles: {{whose}} regard for {{to}} settles
draft_taken_out: taken out
draft_made: made
draft_changed: changed
draft_map_settings: In this chat's world: the map settings {{how}}
draft_path: the path from {{from}} to {{to}}
draft_map: the map {{map}}
draft_place: the place {{place}}
draft_change: In this chat's world: {{what}} {{how}}

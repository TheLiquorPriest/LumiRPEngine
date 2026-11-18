---
description: The words of the map tools' answers (map_view, map_measure, map_place, map_door, map_lay, map_edit). An answer is data from the store and these lines, filled with that data; how a map itself is laid out, and every line that prints one, is `map-layout.md`'s. One line per name, a name, a colon, then its text; spaces after the first one are kept. Change the words freely. Delete a line, or leave it empty, and that part is given with no words. The lines named want_ (what a name was looked for as) are words put inside the unknown line.
format: lines
---
no_chat: There is no chat {{id}} in the engine's records.
no_turn: There is no turn {{id}} in this chat.
no_world: The world this chat plays ({{id}}) is not to hand, so nothing can be read.
needs_field: This call needs {{field}}.
needs: {{op}} needs {{fields}}.
needs_any: This call needs at least one of {{fields}}.
needs_one: {{op}}: {{who}} needs one of {{fields}}, and only one.
needs_rows: {{op}} needs rows, or a width and a height.
too_large: {{op}}: a map is at most {{most}} by {{most}} squares, and this one would be {{width}} by {{height}}. Lay it in parts: a map for each room or each part, each its own place laid over its square of a coarser map (over and square), or one map with wider squares (feet) so that it takes fewer.
unreadable: {{field}} cannot be read{{#value}}: you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}
unreadable_op: {{op}}: {{field}} cannot be read{{#value}}, you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}
unknown: {{#op}}{{op}}: {{/op}}there is nothing called {{name}} that is {{sought}}.{{#near}} Near: {{near}}.{{/near}}
want_entity: a person or a thing
want_thing: a thing
want_place: a place
want_point: a place, a person or a thing
several: {{#op}}{{op}}: {{/op}}{{name}} fits more than one: {{several}}. Name one by its id.
not_applicable: {{op}}: the engine cannot apply this ({{code}}){{#reason}}: {{reason}}{{/reason}}.{{#choices}} It is one of: {{choices}}.{{/choices}}
nothing_recorded: Nothing was recorded. Send the call again with that put right.
never: {{op}} was not applied: it writes to the {{lane}} lane, where the player allows no writes.
declined: {{op}} was not applied: the player said no.{{#reason}} Their reason: {{reason}}{{/reason}}
unsourced: {{op}} names no source, so it is marked unsourced.
invented_unchecked: {{op}} is recorded as invented and names no gap check, so it is marked so.
invented_unconsented: {{op}} is recorded as invented and names no consent, so it is marked so.
not_applied: {{op}} was recorded and did not apply ({{code}}).
store_failed: {{#op}}{{op}}: {{/op}}its handler failed ({{error}}), so it did not apply.
store_unknown_revision: {{#op}}{{op}}: {{/op}}the world revision {{revision}} is not to hand, so it did not apply.
store_bad_marker: {{#op}}{{op}}: {{/op}}this is not a marker the engine can read, so it did not apply.
store_no_handler: {{#op}}{{op}}: {{/op}}nothing in the engine applies it, so it did not apply.
store_tied: {{#op}}{{op}}: {{/op}}it was tied to a change that did not apply, so it did not apply either.
store_marker_note: {{#op}}{{op}}: {{/op}}{{note}}
already_so: {{op}}: {{what}} was already so; nothing changed.
world_map_made: Made {{what}}.
world_map_changed: Changed {{what}}: {{members}}.
world_map_removed: Removed {{what}}.
world_map_same: {{what}} stands as it is; nothing changed.
a_map_place: the place {{name}} ({{id}}) on the map {{map}}
a_map_link: the link between {{from}} and {{to}} on the map {{map}}
the_map_settings: the map settings
no_map_named: {{op}}: this chat's world has no map with the id or title {{map}}. Its maps, by id: {{maps}}.
no_map_place: {{op}}: the map {{map}} has no place with the id or name {{name}}. Its places, by id: {{places}}.
no_map_link: {{op}}: the map {{map}} has no link between {{from}} and {{to}}{{#mode}} ({{mode}}){{/mode}}, so there is nothing to remove. Its links: {{links}}.
map_links_many: {{op}}: {{from}} and {{to}} have several links on the map {{map}}, one for each of: {{modes}}. Say which with mode.
no_map_to_take_out: {{op}}: {{place}} has no map in this chat's world to take out.
lay_removed: Took the map {{map}} of {{place}} out of this chat's world.{{#off}} {{off}} stood on it and stand on no square now.{{/off}}
keep_names: Nothing was named to keep.{{#changes}} This chat has changed: {{changes}}. Name them in maps, places, paths or settings.{{/changes}}{{^changes}} This chat has changed nothing of its world's maps, places, paths or settings.{{/changes}}
keep_done: Kept in the world's draft, now at version {{version}}: {{kept}}.
keep_nothing: Nothing was written to the world's draft.
keep_not_changed: {{id}}: this chat has not changed it, so there is nothing of it to keep.
keep_in_draft_already: {{id}}: the world's draft has it so already.
keep_no_map: {{id}}: the world's draft has no such map to lay the squares on.
keep_no_world: This chat's world is not one the store keeps a draft for, so nothing could be kept.
keep_unreadable: The world's draft could not be read, so nothing was kept.
keep_busy: The world's draft kept changing while it was written, so nothing was kept; try again.
rule_bent: {{op}}: {{what}} was put with {{where}} although the world's rules for things say otherwise ({{code}}).
no_grid: {{at}}{{#place}}, at {{place}},{{/place}} has no map of squares yet. map_lay lays one for it.{{#soft}} Kept there by a zone or words: {{soft}}.{{/soft}}{{#maps}} Places near it that have a map: {{maps}}.{{/maps}}{{^maps}} No place has a map yet.{{/maps}}
bad_square: {{#op}}{{op}}: {{/op}}{{field}} cannot be read{{#value}}: you sent {{value}}{{/value}}. A square is [column, row], counted from 1 at the top left.
bad_size: {{op}}: size cannot be read, you sent {{value}}. A footprint is [columns, rows], each from 1 to {{most}}.
off_map: {{field}}: square ({{column}},{{row}}) is off the map of {{place}}, which is {{width}} by {{height}} squares.
not_on_map: {{field}}: {{name}} stands on no square of the map of {{place}}{{#words}}; they are kept as {{words}}{{/words}}.
spot: {{#name}}{{name}} {{/name}}({{column}},{{row}})
time: {{#round}}{{rounds}} {{#one}}round{{/one}}{{^one}}rounds{{/one}}, {{seconds}} seconds{{/round}}{{^round}}{{minutes}} minutes{{/round}}
far_feet: {{amount}} ft
far_metres: {{amount}} m
measure_distance: From {{from}} to {{to}}: {{squares}} squares, {{far}}.
measure_sees: {{from}} and {{to}} can see each other.
measure_sees_dark: There is a clear line between {{from}} and {{to}}, within the world's sight, and {{to}} stands in the dark.
measure_sees_beyond: There is a clear line between {{from}} and {{to}}, but {{to}} is farther than the {{radius}} squares ({{farRadius}}) the world's sight reaches{{#dark}}, and stands in the dark{{/dark}}.
measure_blind: {{from}} and {{to}} cannot see each other: a wall, a door that is not open, or something that blocks the view is between them.
measure_cover: {{to}} has {{degree}} cover from {{from}}{{#by}}, given by {{by}}{{/by}}.
measure_no_cover: {{to}} has no cover from {{from}}.
measure_way: The way from {{from}} to {{to}} is {{distance}} squares ({{far}}) and costs {{cost}} squares of movement: {{time}}.
measure_no_way: There is no way from {{from}} to {{to}} as the map stands: walls, doors that are not open, or what blocks the way close it.
measure_within: Within {{range}} squares ({{far}}) of {{from}}: {{who}}.
measure_within_none: No one and nothing stands within {{range}} squares ({{far}}) of {{from}}.
measure_area: The {{area}} from {{from}}{{#toward}} toward {{toward}}{{/toward}}, {{size}} squares ({{far}}), covers {{count}} squares.{{#who}} In it: {{who}}.{{/who}}
run: columns {{from}} to {{to}} of row {{row}}
piece_at: {{what}} stands at {{square}}.
piece_walked: {{what}} walked from {{from}} to {{to}}: {{distance}} squares ({{far}}), {{cost}} squares of movement, {{time}}.
way_taken: {{what}}: from {{from}} to {{to}} is {{distance}} squares ({{far}}), {{cost}} squares of movement, {{time}}.
piece_on: {{what}} lies on {{holder}}{{#square}}, at {{square}}{{/square}}.
piece_lifted: {{what}} was taken off {{square}} and stands on no square now.
piece_shape: {{what}} covers {{columns}} by {{rows}} squares{{#blocksWay}}, blocking the way{{/blocksWay}}{{#blocksView}}, blocking the view{{/blocksView}}.
not_a_thing: {{op}}: {{what}} is not a thing, so it cannot lie on something.
no_zone: {{op}}: this map has no zone {{zone}}.{{#zones}} Its zones: {{zones}}.{{/zones}}
not_a_door: {{op}}: there is no door at {{square}} on the map of {{place}}.{{#doors}} Its doors: {{doors}}.{{/doors}}
door_already: {{op}}: the door at {{square}} was {{state}} already; nothing changed.
door_set: The door at {{square}} is {{state}} now{{#was}}; it was {{was}}{{/was}}.
laid: {{place}} has a map now: {{width}} by {{height}} squares of {{size}}{{#defaulted}} (nobody gave a width, so the setting's is taken as an assumption){{/defaulted}}{{#round}}, counted in rounds of {{seconds}} seconds{{/round}}.
laid_off: {{who}} stood on the square the map was laid over, and stand on no square of the new map yet.
edited: {{count}} squares of the map of {{place}} were drawn anew{{#symbols}}, and its legend changed for {{symbols}}{{/symbols}}.
fixture_lifted: {{what}} was drawn on the map; it is a thing now, at {{square}}, {{columns}} by {{rows}} squares{{#blocksWay}}, blocking the way{{/blocksWay}}{{#blocksView}}, blocking the view{{/blocksView}}, and the squares it was drawn on are floor.
legend_read_floor: {{op}}: {{symbol}} was read as floor named {{words}}; with "blocks": true it would be a square nobody walks through.
legend_read_blocks: {{op}}: {{symbol}} was read as {{words}}, a square nobody walks through.
legend_unreadable: {{op}}: legend{{#symbol}} {{symbol}}{{/symbol}} cannot be read, you sent {{value}}. A legend entry is one character, and what its squares are: wall, floor or door; words, read as floor named by them, or with "blocks": true as a square nobody walks through, such as {"terrain": "deep water", "blocks": true}; {"item": a thing}; {"place": a place's id}; {"door": true, "place": a room's id}; or {"zone": a name}. A symbol not in the legend is # wall, . floor, + door, or a space for nothing.
grid_off_grid: {{#op}}{{op}}: {{/op}}{{#what}}{{what}}: {{/what}}square {{square}} is off the map, which is {{width}} by {{height}} squares.
grid_fell_off: {{#op}}{{op}}: {{/op}}{{count}} squares of stroke {{stroke}} ({{symbol}}) are off the map, which is {{width}} by {{height}} squares, and were not drawn.
grid_door_off: {{#op}}{{op}}: {{/op}}the door at {{square}} is outside the room, which is {{width}} by {{height}} squares, and was not drawn.
grid_stands_nowhere: {{#op}}{{op}}: {{/op}}{{what}} stands on no square.
grid_not_a_fixture: {{#op}}{{op}}: {{/op}}square {{square}} is not a fixture drawn on the map (terrain of a name, drawn with one symbol), so nothing was lifted there.
grid_off_edge: {{#op}}{{op}}: {{/op}}{{what}} at {{square}} reaches past the edge of the map.
grid_in_wall: {{#op}}{{op}}: {{/op}}{{what}} stands on {{squares}}, which block the way; it was put there all the same.
grid_overlaps: {{#op}}{{op}}: {{/op}}{{what}} stands over {{with}}.
grid_holder_off_grid: {{#op}}{{op}}: {{/op}}{{what}} lies on {{holder}}, which stands on no square of this map.
grid_door_on: {{#op}}{{op}}: {{/op}}the door at {{square}} was shut with {{what}} standing in it.
grid_no_way: {{#op}}{{op}}: {{/op}}{{what}} had no way from {{from}} to {{to}}, and was put there all the same.
grid_brought: {{#op}}{{op}}: {{/op}}{{what}} was {{#from}}at {{from}}{{/from}}{{^from}}nowhere{{/from}}, and was brought to {{to}} first.
grid_has_grid: {{#op}}{{op}}: {{/op}}{{place}} had a map already ({{grid}}). This one is laid over it for this chat only: the world's own map is untouched, and a swipe of this turn takes it back. map_edit changes part of a map without redrawing it.
grid_id_taken: {{#op}}{{op}}: {{/op}}{{id}} is a map or grid of the world already{{#held}} (the map of {{held}}){{/held}}, so this one is {{fresh}}.
grid_bad_map: {{#op}}{{op}}: {{/op}}the map's format cannot hold that, at {{at}}{{#why}}: {{why}}{{/why}}.
grid_no_grid: {{#op}}{{op}}: {{/op}}{{place}} has no map of squares, so no square of it exists. map_lay lays one for it first.{{#maps}} Places near it that have a map: {{maps}}.{{/maps}}
grid_needs_place: {{#op}}{{op}}: {{/op}}no place is drawn on square {{square}}; place names the new one.
grid_no_place: {{#op}}{{op}}: {{/op}}there is no place {{place}}.
grid_no_map: {{#op}}{{op}}: {{/op}}{{place}} has no map drawn row by row to change.
grid_bad_symbol: {{#op}}{{op}}: {{/op}}{{symbol}} is not one character.
grid_not_in_legend: {{#op}}{{op}}: {{/op}}no legend names {{symbol}}, so it reads as floor, and what was drawn with it is recorded as assumed. Give it an entry in the legend to say what it is.
grid_nothing_drawn: {{#op}}{{op}}: {{/op}}nothing was drawn on the map of {{place}}.
grid_light_unreadable: {{#op}}{{op}}: {{/op}}{{place}}: the light {{value}} is neither lit nor dark, so it was recorded as given and the place reads as {{reads}}. Set light to lit or dark.
grid_kept_no_map: {{#op}}{{op}}: {{/op}}{{what}} could not be put on a square: {{place}} has no map of squares. It is kept as where {{what}} is: {{kept}}.
grid_kept_no_zone: {{#op}}{{op}}: {{/op}}{{what}} could not be put in {{zone}}: the map of {{place}} has no zone by that name. It is kept as where {{what}} is.
grid_kept_nowhere: {{#op}}{{op}}: {{/op}}{{what}} could not be put beside {{near}}, who stands on no square of the map of {{place}}. It is kept as where {{what}} is: {{kept}}.
no_square_no_map: {{#op}}{{op}}: {{/op}}{{what}} cannot be put on square {{square}}: no square exists at {{place}}, which has no map of squares. map_lay lays one. Until then it can be put by a zone or by words{{#soft}}, as these are: {{soft}}{{/soft}}.{{#maps}} Places near it that have a map: {{maps}}.{{/maps}}
no_square_off: {{what}} cannot be put on square {{square}}: no such square exists on the map of {{place}}, which is {{width}} by {{height}} squares.{{#zones}} Its zones: {{zones}}.{{/zones}}{{#soft}} Kept there by words or a zone: {{soft}}.{{/soft}}
grid_place_elsewhere: {{#op}}{{op}}: {{/op}}{{place}} is not the place drawn on square {{square}}; {{held}} is, so the map was laid for {{held}}.
grid_not_drawn_there: {{#op}}{{op}}: {{/op}}{{place}} is not drawn on square {{square}} of the coarser map, so its map was laid for it alone, and the coarser map is as it was.
grid_place_id_taken: {{#op}}{{op}}: {{/op}}{{id}} is a place already, so the new place is {{fresh}}.
engine_fault: {{tool}} failed in the engine, not in your call: the fault is in RPE's log. Nothing was recorded.

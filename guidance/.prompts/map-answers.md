---
description: The words of the map tools' answers (map_view, map_measure, map_place, map_door, map_lay, map_edit), and of a map wherever one is shown (the world state, world_query, map_view). An answer is data from the store and these lines, filled with that data; a map is its picture (the column and row numbers and the map's own symbols) and the map_ and legend_ lines, shown in that order. One line per name, a name, a colon, then its text; spaces after the first one are kept. Change the words freely. Delete a line, or leave it empty, and that part is given with no words. The lines named want_ (what a name was looked for as) are words put inside the unknown line.
format: lines
---
no_chat: There is no chat {{id}} in the engine's records.
no_turn: There is no turn {{id}} in this chat.
no_world: The world this chat plays ({{id}}) is not to hand, so nothing can be read.
turn_needed: This call belongs to no turn, so nothing can be recorded. Reading needs no turn.
needs_field: This call needs {{field}}.
needs: {{op}} needs {{fields}}.
needs_any: This call needs at least one of {{fields}}.
needs_one: {{op}}: {{who}} needs one of {{fields}}, and only one.
needs_rows: {{op}} needs rows, or a width and a height.
too_large: {{op}}: a map is at most {{most}} by {{most}} squares, and this one would be {{width}} by {{height}}.
unreadable: {{field}} cannot be read{{#value}}: you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}
unreadable_op: {{op}}: {{field}} cannot be read{{#value}}, you sent {{value}}{{/value}}.{{#choices}} It is one of: {{choices}}.{{/choices}}
unknown: {{#op}}{{op}}: {{/op}}there is nothing called {{name}} that is {{sought}}.{{#near}} Near: {{near}}.{{/near}}
want_entity: a person or a thing
want_thing: a thing
want_place: a place
want_point: a place, a person or a thing
several: {{#op}}{{op}}: {{/op}}{{name}} fits more than one: {{several}}. Name one by its id.
not_applicable: {{op}}: the engine cannot apply this at all ({{code}}).
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
placed_instead: {{op}}: {{what}} was put at {{where}}, not {{asked}}, by the size of things.
rule_bent: {{op}}: {{what}} was put with {{where}} although the world's rules for things say otherwise ({{code}}).
no_grid: {{at}} has no map of squares.
bad_square: {{#op}}{{op}}: {{/op}}{{field}} cannot be read{{#value}}: you sent {{value}}{{/value}}. A square is [column, row], counted from 1 at the top left.
bad_size: {{op}}: size cannot be read, you sent {{value}}. A footprint is [columns, rows], each from 1 to {{most}}.
off_map: {{field}}: square ({{column}},{{row}}) is off the map of {{place}}, which is {{width}} by {{height}} squares.
not_on_map: {{field}}: {{name}} stands on no square of the map of {{place}}.
spot: {{#name}}{{name}} {{/name}}({{column}},{{row}})
time: {{#round}}{{rounds}} {{#one}}round{{/one}}{{^one}}rounds{{/one}}, {{seconds}} seconds{{/round}}{{^round}}{{minutes}} minutes{{/round}}
measure_distance: From {{from}} to {{to}}: {{squares}} squares, {{feet}} ft.
measure_sees: {{from}} and {{to}} can see each other.
measure_blind: {{from}} and {{to}} cannot see each other: a wall, a door that is not open, or something that blocks the view is between them.
measure_way: The way from {{from}} to {{to}} is {{distance}} squares ({{feet}} ft) and costs {{cost}} squares of movement: {{time}}.
measure_no_way: There is no way from {{from}} to {{to}} as the map stands: walls, doors that are not open, or what blocks the way close it.
measure_within: Within {{range}} squares ({{feet}} ft) of {{from}}: {{who}}.
measure_within_none: No one and nothing stands within {{range}} squares ({{feet}} ft) of {{from}}.
measure_area: The {{area}} from {{from}}{{#toward}} toward {{toward}}{{/toward}}, {{size}} squares ({{feet}} ft), covers {{count}} squares.{{#who}} In it: {{who}}.{{/who}}
map_title: Map: {{place}}. {{width}} by {{height}} squares of {{feet}} ft{{#round}}, counted in rounds of {{seconds}} seconds{{/round}}. North is up.
map_part: Shown: columns {{fromColumn}} to {{toColumn}}, rows {{fromRow}} to {{toRow}}. map_view with another centre shows the rest.
map_legend:    {{#legend}}{{.}}   {{/legend}}
legend_wall: {{symbol}} wall
legend_floor:
legend_door: {{symbol}} door
legend_nothing:
legend_terrain: {{symbol}} {{terrain}}{{#seeThrough}} (blocks the way, not the view){{/seeThrough}}
legend_item: {{symbol}} {{name}}
legend_place: {{symbol}} {{name}}
legend_room_door: {{symbol}} door to {{name}}
legend_zone: {{symbol}} {{zone}}
map_who: Who and what is where:
map_you:    you, {{name}} [{{id}}] ({{column}},{{row}})
map_piece:    {{name}} [{{id}}]{{#on}}, on {{on}}{{/on}} ({{column}},{{row}}){{#size}}, {{columns}} by {{rows}} squares{{/size}}{{#blocksWay}}, blocking the way{{/blocksWay}}{{#blocksView}}, blocking the view{{/blocksView}}{{#feet}}, {{feet}} ft from you{{/feet}}{{^shown}}, outside the part shown{{/shown}}
map_unplaced:    {{name}} [{{id}}], here with no square yet
map_doors:    {{doors}}
map_door: door ({{column}},{{row}}) {{state}}
piece_at: {{what}} stands at {{square}}.
piece_walked: {{what}} walked from {{from}} to {{to}}: {{distance}} squares ({{feet}} ft), {{cost}} squares of movement, {{time}}.
way_taken: {{what}}: from {{from}} to {{to}} is {{distance}} squares ({{feet}} ft), {{cost}} squares of movement, {{time}}.
piece_on: {{what}} lies on {{holder}}{{#square}}, at {{square}}{{/square}}.
piece_lifted: {{what}} was taken off {{square}} and stands on no square now.
piece_shape: {{what}} covers {{columns}} by {{rows}} squares{{#blocksWay}}, blocking the way{{/blocksWay}}{{#blocksView}}, blocking the view{{/blocksView}}.
not_a_thing: {{op}}: {{what}} is not a thing, so it cannot lie on something.
no_square_near: {{op}}: there is no free square beside {{near}} for {{what}}.
no_zone: {{op}}: this map has no zone {{zone}}.{{#zones}} Its zones: {{zones}}.{{/zones}}
no_square_free: {{op}}: zone {{zone}} has no free square.
not_a_door: {{op}}: there is no door at {{square}} on the map of {{place}}.{{#doors}} Its doors: {{doors}}.{{/doors}}
door_already: {{op}}: the door at {{square}} was {{state}} already; nothing changed.
door_set: The door at {{square}} is {{state}} now{{#was}}; it was {{was}}{{/was}}.
place_elsewhere: {{op}}: {{place}} is not the place drawn on square {{square}} of that map.
laid: {{place}} has a map now: {{width}} by {{height}} squares of {{feet}} ft{{#round}}, counted in rounds of {{seconds}} seconds{{/round}}.
laid_off: {{who}} stood on the square the map was laid over, and stand on no square of the new map yet.
edited: {{count}} squares of the map of {{place}} were drawn anew{{#symbols}}, and its legend changed for {{symbols}}{{/symbols}}.
grid_off_grid: {{#op}}{{op}}: {{/op}}{{#what}}{{what}}: {{/what}}square {{square}} is off the map, which is {{width}} by {{height}} squares.
grid_fell_off: {{#op}}{{op}}: {{/op}}{{count}} squares of stroke {{stroke}} ({{symbol}}) are off the map, which is {{width}} by {{height}} squares, and were not drawn.
grid_door_off: {{#op}}{{op}}: {{/op}}the door at {{square}} is outside the room, which is {{width}} by {{height}} squares, and was not drawn.
grid_stands_nowhere: {{#op}}{{op}}: {{/op}}{{what}} stands on no square.
grid_off_edge: {{#op}}{{op}}: {{/op}}{{what}} at {{square}} reaches past the edge of the map.
grid_in_wall: {{#op}}{{op}}: {{/op}}{{what}} stands on {{squares}}, which block the way; it was put there all the same.
grid_overlaps: {{#op}}{{op}}: {{/op}}{{what}} stands over {{with}}.
grid_holder_off_grid: {{#op}}{{op}}: {{/op}}{{what}} lies on {{holder}}, which stands on no square of this map.
grid_door_on: {{#op}}{{op}}: {{/op}}the door at {{square}} was shut with {{what}} standing in it.
grid_no_way: {{#op}}{{op}}: {{/op}}{{what}} had no way from {{from}} to {{to}}, and was put there all the same.
grid_brought: {{#op}}{{op}}: {{/op}}{{what}} was {{#from}}at {{from}}{{/from}}{{^from}}nowhere{{/from}}, and was brought to {{to}} first.
grid_has_grid: {{#op}}{{op}}: {{/op}}{{place}} has a map already ({{grid}}).
grid_id_taken: {{#op}}{{op}}: {{/op}}a map or grid {{id}} is there already.
grid_bad_map: {{#op}}{{op}}: {{/op}}the map's format cannot hold that, at {{at}}.
grid_no_grid: {{#op}}{{op}}: {{/op}}{{place}} has no map of squares.
grid_needs_place: {{#op}}{{op}}: {{/op}}no place is drawn on square {{square}}; place names the new one.
grid_no_place: {{#op}}{{op}}: {{/op}}there is no place {{place}}.
grid_no_map: {{#op}}{{op}}: {{/op}}{{place}} has no map drawn row by row to change.
grid_bad_symbol: {{#op}}{{op}}: {{/op}}{{symbol}} is not one character.
grid_not_in_legend: {{#op}}{{op}}: {{/op}}no legend names {{symbol}}, so it reads as floor.
grid_nothing_drawn: {{#op}}{{op}}: {{/op}}nothing was drawn on the map of {{place}}.

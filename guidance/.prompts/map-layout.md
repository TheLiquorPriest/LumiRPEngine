---
description: >-
  How a map is laid out wherever one is shown (the world state, world_query, map_view), and the words of each line that prints one. The body below puts the parts in the order it names them; take a part out, or move it, and the map follows, so a body with the list first and no picture prints the list first and no picture. The picture is the grid as drawn, with the column numbers above and each row's number at its left. The title, the part shown, the picture and the legend are the drawn layer, which the Author is given once a session and again only when it changes; the list of who and what is where, and the doors, move, and are given every turn. Each line under lines words one thing; delete a line and that thing is not shown. labelWidth is how wide the column of row numbers is. factKeys names the keys of the facts on a piece of the map that its line carries (state, as shipped, gives the chest at (8,6), locked). It lays recorded values out; it asks for nothing.
labelWidth: 4
factKeys:
  - state
lines:
  map_title: 'Map: {{place}}. {{width}} by {{height}} squares of {{size}}{{#round}}, counted in rounds of {{seconds}} seconds{{/round}}. North is up.'
  map_part: 'Shown: columns {{fromColumn}} to {{toColumn}}, rows {{fromRow}} to {{toRow}}. map_view with another centre shows the rest.'
  columns: '{{label}}  {{#numbers}}{{.}} {{/numbers}}'
  row: '{{label}}  {{#cells}}{{.}} {{/cells}}'
  map_legend: '   {{#legend}}{{.}}   {{/legend}}'
  legend_wall: '{{symbol}} wall'
  legend_door: '{{symbol}} door'
  legend_terrain: '{{symbol}} {{terrain}}{{#seeThrough}} (blocks the way, not the view){{/seeThrough}}'
  legend_item: '{{symbol}} {{name}}'
  legend_place: '{{symbol}} {{name}}'
  legend_room_door: '{{symbol}} door to {{name}}'
  legend_zone: '{{symbol}} {{zone}}'
  map_who: 'Who and what is where:'
  map_you: '   you, {{name}} [{{id}}] ({{column}},{{row}}){{#activity}}, {{activity}}{{/activity}}{{#words}}, {{words}}{{/words}}'
  map_piece: '   {{name}} [{{id}}]{{#on}}, on {{on}}{{/on}} ({{column}},{{row}}){{#size}}, {{columns}} by {{rows}} squares{{/size}}{{#blocksWay}}, blocking the way{{/blocksWay}}{{#blocksView}}, blocking the view{{/blocksView}}{{#activity}}, {{activity}}{{/activity}}{{#words}}, {{words}}{{/words}}{{#condition}}, {{condition}}{{/condition}}{{#facts}}, {{value}}{{/facts}}{{#far}}, {{far}} from you{{/far}}{{^shown}}, outside the part shown{{/shown}}'
  map_unplaced: '   {{name}} [{{id}}], here with no square yet{{#words}}, {{words}}{{/words}}'
  map_doors: '   {{doors}}'
  map_door: 'door ({{column}},{{row}}) {{state}}'
---
{{#title}}
{{title}}
{{/title}}
{{#part}}
{{part}}
{{/part}}
{{#picture}}
{{picture}}
{{/picture}}
{{#legend}}
{{legend}}
{{/legend}}
{{#list}}

{{who}}
{{list}}
{{/list}}
{{#doors}}
{{doors}}
{{/doors}}

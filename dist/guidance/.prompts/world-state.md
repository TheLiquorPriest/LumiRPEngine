---
description: The layout of the world state the Author is given at the start of every turn, and the words of every line of the world's tree, wherever it is shown (the world state, the turn's folder, world_query). Each part of the layout appears only when there is something in it; take a part out, or move it, and the world state follows. Each line below words one kind of line; change the words freely, and a kind whose line is deleted is not shown. An agent given the scene or what is due by name (world:scene, world:due) when nothing is in it is given that part with the line horizon_none or due_none, which says so. It lays recorded values out; it asks for nothing.
lines:
  level_world: '{{#name}}{{name}} {{/name}}[{{id}}] (world){{#reflection}} — {{parts}}{{/reflection}}{{^reflection}} — nothing is recorded in it yet{{/reflection}}{{#opens}} [opened by world_query at {{ref}}]{{/opens}}'
  level_place: '{{name}} [{{id}}] (place){{#reflection}} — {{parts}}{{/reflection}}{{#opens}} [opened by world_query at {{ref}}]{{/opens}}'
  level_entity: '{{name}} [{{id}}] ({{what}}{{#worn}}, worn{{/worn}}{{#equipped}}, equipped{{/equipped}}{{#gone}}, gone{{/gone}}){{#reflection}} — {{parts}}{{/reflection}}{{#opens}} [opened by world_query at {{ref}}]{{/opens}}'
  level_groups: 'Groups [{{id}}] (groups){{#reflection}} — {{parts}}{{/reflection}}{{#opens}} [opened by world_query at {{ref}}]{{/opens}}'
  level_elsewhere: 'Elsewhere [{{id}}] (not in any place){{#reflection}} — {{parts}}{{/reflection}}{{#opens}} [opened by world_query at {{ref}}]{{/opens}}'
  reflection_people: '{{n}} {{#one}}person{{/one}}{{^one}}people{{/one}}{{#notable}} ({{names}}){{/notable}}'
  reflection_things: '{{n}} {{#one}}thing{{/one}}{{^one}}things{{/one}}'
  reflection_places: '{{n}} {{#one}}place{{/one}}{{^one}}places{{/one}}'
  reflection_groups: '{{n}} {{#one}}group{{/one}}{{^one}}groups{{/one}}'
  reflection_records: '{{n}} {{#one}}record{{/one}}{{^one}}records{{/one}}'
  reflection_open: '{{n}} open'
  reflection_changed: 'changed turn {{turn}}'
  reflection_note: 'note: {{text}}'
  value: '· {{key}}: {{#value}}{{value}}{{/value}}{{^value}}none{{/value}}{{#system}} ({{system}}{{#from}}, from {{name}}{{/from}}){{/system}}{{^system}}{{#from}} (from {{#world}}the world{{/world}}{{^world}}{{name}}{{/world}}){{/from}}{{/system}}{{#facts}}{{#turn}} — {{#precision}}{{precision}}, {{/precision}}turn {{turn}}{{/turn}}{{/facts}}'
  fact: '· {{key}}: "{{value}}" ({{#precision}}{{precision}}, {{/precision}}{{#standing}}{{standing}}, {{/standing}}turn {{turn}}) [{{id}}]'
  map: '{{text}}'
  map_unavailable: 'No map is drawn here: this world state has no maps to hand.'
  horizon_words: '{{text}} (on the horizon in your own words: nothing in the world is called that)'
  due: '{{#when}}{{when}}{{/when}}{{^when}}in {{after}} minutes{{/when}}: {{kind}}{{#where}} at {{where}}{{/where}}{{#who}}, {{who}}{{/who}}{{#what}} ({{what}}){{/what}}'
  fell_due: '{{#when}}{{when}}{{/when}}{{^when}}{{ago}} minutes ago{{/when}}: {{kind}}{{#where}} at {{where}}{{/where}}{{#who}}, {{who}}{{/who}}{{#what}} ({{what}}){{/what}}'
  due_unlisted: 'What falls due is not listed here.'
  due_none: 'The world state lists nothing due in the next {{minutes}} minutes of story time.'
  horizon_none: 'Nothing is at hand: no place, person or thing is on the horizon.'
  quest: '{{label}} [{{id}}] ({{kind}}): {{stage}}{{#owner}}, {{owner}}''s{{/owner}}'
  changed: '{{lane}}: {{n}} {{#one}}change{{/one}}{{^one}}changes{{/one}}{{#ops}} ({{list}}){{/ops}}{{#touched}}, to {{names}}{{/touched}}{{#unapplied}}; {{unapplied}} did not apply{{/unapplied}}'
  unsettled_fact: '{{at}}: {{key}}: "{{value}}" ({{#precision}}{{precision}}, {{/precision}}{{#standing}}{{standing}}, {{/standing}}{{#unsourced}}unsourced, {{/unsourced}}turn {{turn}}) [{{id}}]'
  unsettled_value: '{{at}}: {{key}}: {{#value}}{{value}}{{/value}}{{^value}}none{{/value}} ({{#precision}}{{precision}}, {{/precision}}{{#standing}}{{standing}}, {{/standing}}{{#unsourced}}unsourced, {{/unsourced}}turn {{turn}})'
  unsettled_report: '{{op}}, turn {{turn}}{{^applied}}, not applied{{/applied}}: {{codes}}'
  left_out: '… and {{n}} more, left out to keep the world state within its budget (world_query opens any level)'
  left_out_uncounted: '… and more, not counted, left out to keep the world state within its budget (world_query opens any level)'
keys:
  time_zone: time zone
---
{{#horizon}}
### At hand

{{horizon}}
{{/horizon}}
{{#above}}

### Above it

{{above}}
{{/above}}
{{#around}}

### Around it

{{around}}
{{/around}}
{{#outline}}

### The rest of the world, in outline

{{outline}}
{{/outline}}
{{#passed}}

### Fell due as the clock moved last turn

{{passed}}
{{/passed}}
{{#due}}

### Due

{{due}}
{{/due}}
{{#open}}

### Open business here

{{open}}
{{/open}}
{{#changed}}

### Changed last turn

{{changed}}
{{/changed}}
{{#unsettled}}

### Unsettled

{{unsettled}}
{{/unsettled}}

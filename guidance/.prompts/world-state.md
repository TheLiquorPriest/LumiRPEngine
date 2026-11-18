---
description: The layout of the world state the Author is given at the start of every turn, and the words of every line of the world's tree, wherever it is shown (the world state, the turn's folder, world_query). Each part of the layout appears only when there is something in it; take a part out, or move it, and the world state follows. Each line below words one kind of line; change the words freely, and a kind whose line is deleted is not shown. An agent given the scene or what is due by name (world:scene, world:due) when nothing is in it is given that part with the line horizon_none or due_none, which says so. It lays recorded values out; it asks for nothing.
lines:
  level_world: '{{#name}}{{name}} {{/name}}[{{id}}] (world){{#reflection}} — {{parts}}{{/reflection}}{{^reflection}} — nothing is recorded in it yet{{/reflection}}{{#opens}} [opened by world_query at {{ref}}]{{/opens}}'
  level_place: '{{name}} [{{id}}] (place){{#reflection}} — {{parts}}{{/reflection}}{{#opens}} [opened by world_query at {{ref}}]{{/opens}}'
  level_entity: '{{name}} [{{id}}] ({{what}}{{#worn}}, worn{{/worn}}{{#equipped}}, equipped{{/equipped}}{{#on}}, on it{{/on}}{{#gone}}, gone{{/gone}}){{#reflection}} — {{parts}}{{/reflection}}{{#opens}} [opened by world_query at {{ref}}]{{/opens}}'
  level_groups: 'Groups [{{id}}] (groups){{#reflection}} — {{parts}}{{/reflection}}{{#opens}} [opened by world_query at {{ref}}]{{/opens}}'
  level_elsewhere: 'Elsewhere [{{id}}] (not in any place){{#reflection}} — {{parts}}{{/reflection}}{{#opens}} [opened by world_query at {{ref}}]{{/opens}}'
  reflection_people: '{{n}} {{#one}}person{{/one}}{{^one}}people{{/one}}{{#notable}} ({{names}}){{/notable}}'
  reflection_things: '{{n}} {{#one}}thing{{/one}}{{^one}}things{{/one}}'
  reflection_places: '{{n}} {{#one}}place{{/one}}{{^one}}places{{/one}}'
  reflection_groups: '{{n}} {{#one}}group{{/one}}{{^one}}groups{{/one}}'
  reflection_records: '{{n}} {{#one}}record{{/one}}{{^one}}records{{/one}}'
  reflection_open: '{{n}} open'
  reflection_due: '{{#n}}{{n}} due{{/n}}{{#more}}more than one due{{/more}}, the soonest in {{after}} minutes ({{kind}})'
  reflection_changed: 'changed turn {{turn}}'
  reflection_note: 'note: {{text}}'
  value: '· {{key}}: {{#value}}{{value}}{{/value}}{{^value}}none{{/value}}{{#paused}} (the clock is paused for this scene){{/paused}}{{#system}} ({{system}}{{#from}}, from {{name}}{{/from}}){{/system}}{{^system}}{{#from}} (from {{#world}}the world{{/world}}{{^world}}{{name}}{{/world}}){{/from}}{{/system}}{{#unchecked}} (invented without a gap check or consent){{/unchecked}}{{#facts}}{{#turn}} — {{#precision}}{{precision}}, {{/precision}}turn {{turn}}{{/turn}}{{/facts}}'
  fact: '· {{key}}: "{{value}}" ({{#precision}}{{precision}}, {{/precision}}{{#standing}}{{standing}}, {{/standing}}turn {{turn}}) [{{id}}]'
  map: '{{text}}'
  horizon_words: '{{text}} (on the horizon in your own words: nothing in the world is called that)'
  on_the_way: '{{who}} is on the way to {{to}}{{#after}}, arriving in {{after}} minutes{{/after}}'
  due: '{{#when}}{{when}}{{/when}}{{^when}}in {{after}} minutes{{/when}}: {{kind}}{{#where}} at {{where}}{{/where}}{{#who}}, {{who}}{{/who}}{{#what}} ({{what}}){{/what}}'
  fell_due: '{{#when}}{{when}}{{/when}}{{^when}}{{ago}} minutes ago{{/when}}: {{kind}}{{#where}} at {{where}}{{/where}}{{#who}}, {{who}}{{/who}}{{#what}} ({{what}}){{/what}}'
  fell_left: '{{left}} of the {{total}} that fell due {{#one}}has{{/one}}{{^one}}have{{/one}} no change recorded for {{#one}}it{{/one}}{{^one}}them{{/one}}:'
  due_none: 'The world state lists nothing due in the next {{minutes}} minutes of story time.'
  due_scene: 'Due in the scene'
  due_around: 'Due in the places beside it'
  due_beyond: 'Due elsewhere'
  horizon_none: 'Nothing is at hand: no place, person or thing is on the horizon.'
  quest: '{{label}} [{{id}}] ({{kind}}): {{stage}}{{#owner}}, {{owner}}''s{{/owner}}{{#unchecked}} (invented without a gap check or consent){{/unchecked}}{{#turn}} — {{#precision}}{{precision}}, {{/precision}}{{#standing}}{{standing}}, {{/standing}}{{#unsourced}}unsourced, {{/unsourced}}turn {{turn}}{{/turn}}{{#way}}. {{#fails}}It fails here by its own condition, and its failing way leads to {{to}}{{/fails}}{{^fails}}Its way on to {{to}} holds now{{/fails}}: nothing moves it but a call, world_apply with {{call}} and your reason as why{{/way}}'
  changed: '{{lane}}: {{n}} {{#one}}change{{/one}}{{^one}}changes{{/one}}{{#ops}} ({{list}}){{/ops}}{{#touched}}, to {{names}}{{/touched}}{{#by}}, by {{names}}{{/by}}{{#unapplied}}; {{unapplied}} did not apply{{/unapplied}}'
  changed_his: '{{lane}}: {{n}} {{#one}}change{{/one}}{{^one}}changes{{/one}} of the player''s own{{#ops}} ({{list}}){{/ops}}{{#touched}}, to {{names}}{{/touched}}{{#unapplied}}; {{unapplied}} did not apply{{/unapplied}}'
  changed_none: '{{lane}}: nothing changed'
  realism: 'Realism: {{preset}}{{#standing}} ({{standing}}: the shipped defaults, which nobody chose){{/standing}}. Levels (0 off, 1 narrative, 2 simple, 3 detailed, 4 simulation): money {{money}}, gear {{gear}}, vehicles {{vehicles}}, cast life {{castlife}}, relationships {{relationships}}, space {{space}}, calendar {{calendar}}, weather {{weather}}, sheets {{sheets}}.'
  unsettled_fact: '{{at}}: {{key}}: "{{value}}" ({{#precision}}{{precision}}, {{/precision}}{{#standing}}{{standing}}, {{/standing}}{{#unsourced}}unsourced, {{/unsourced}}{{#unchecked}}invented without a gap check or consent, {{/unchecked}}turn {{turn}}) [{{id}}]'
  unsettled_value: '{{at}}: {{key}}: {{#value}}{{value}}{{/value}}{{^value}}none{{/value}} ({{#precision}}{{precision}}, {{/precision}}{{#standing}}{{standing}}, {{/standing}}{{#unsourced}}unsourced, {{/unsourced}}{{#unchecked}}invented without a gap check or consent, {{/unchecked}}turn {{turn}})'
  unsettled_change: '{{op}}{{#turn}}, turn {{turn}}{{/turn}}{{#between}}, between turns{{/between}}{{#by}}, by {{by}}{{/by}}{{#about}}, about {{names}}{{/about}}{{^applied}}, not applied{{/applied}}{{#unsourced}}, no source{{/unsourced}}{{#unchecked}}, invented without a gap check or consent{{/unchecked}}{{#reports}}: {{parts}}{{/reports}} — {{value}}'
  unsettled_code: '{{code}}{{#values}} {{values}}{{/values}}'
  unsettled_stopped: '{{op}}{{#turn}}, turn {{turn}}{{/turn}}{{#between}}, between turns{{/between}}{{#about}}, about {{names}}{{/about}}, no longer applies: {{codes}} — {{value}}'
  unsettled_hold: '{{kind}}: {{#things}}{{names}}{{/things}}{{#fix}}; the tidy would {{parts}}{{/fix}}'
  fix_move: 'move {{item}} to {{to}}'
  fix_wear: 'take {{item}} off {{who}}'
  fix_label: 'mark {{item}} as {{size}}'
  fix_own: 'give {{item}} back to its owner {{owner}}'
  fix_grant: 'let {{who}} hold {{item}}'
  fix_merge: 'merge {{drop}} into {{keep}}'
  left_out: '… and {{n}} more, left out to keep the world state within its budget (world_query opens any level)'
  left_out_uncounted: '… and more, not counted, left out to keep the world state within its budget (world_query opens any level)'
  walk_stopped: 'The engine stopped following {{from}} at {{at}}: {{setting}} lets it go {{limit}} steps, so what lies past it is not counted.'
  place_chain_stopped: 'What {{place}} takes from the places above it stops at {{at}}: {{setting}} lets it reach {{limit}} places up.'
  place_since: '· since — {{value}} ({{key}}; turn {{turn}}{{#time}}, {{time}}{{/time}}{{#beat}}; beat {{id}}{{#text}}: "{{text}}"{{/text}}{{#message}}, message {{message}}{{/message}}{{/beat}}{{#precision}}; {{precision}}{{/precision}}{{#standing}}; {{standing}}{{/standing}}{{#source}}; source {{source}}{{/source}}) [{{id}}]'
  place_feature: '· feature — {{value}} ({{key}}; turn {{turn}}{{#time}}, {{time}}{{/time}}{{#beat}}; beat {{id}}{{#text}}: "{{text}}"{{/text}}{{#message}}, message {{message}}{{/message}}{{/beat}}{{#precision}}; {{precision}}{{/precision}}{{#standing}}; {{standing}}{{/standing}}{{#source}}; source {{source}}{{/source}}) [{{id}}]'
  place_access: '· access — {{value}} ({{key}}; turn {{turn}}{{#time}}, {{time}}{{/time}}{{#beat}}; beat {{id}}{{#text}}: "{{text}}"{{/text}}{{#message}}, message {{message}}{{/message}}{{/beat}}{{#precision}}; {{precision}}{{/precision}}{{#standing}}; {{standing}}{{/standing}}{{#source}}; source {{source}}{{/source}}) [{{id}}]'
  place_fixture: '· fixture — {{name}}, at {{at}}, {{size}} squares'
  place_zone: '· zone — {{name}}, covering {{squares}} squares'
  place_entry: '· entry — {{audience}}{{#from}} (set by {{from}}){{/from}}'
  place_door: '· door — at {{at}}, {{state}}'
  place_light: '· light — {{light}}'
  place_more: '· … {{n}} more of its {{part}}; {{ask}} reads the rest'
  place_none: '· {{part}} — nothing is recorded'
  place_base: '· base — {{text}}{{#world}} (the world''s own words){{/world}}{{#older}} (older than an entry bound to the place, which has changed since){{/older}}{{#by}} (written by {{by}}){{/by}}'
  place_source: '· source — {{entry}} defines its {{aspect}}{{#title}}: {{title}}{{/title}}{{#gone}} (Lumiverse holds no such entry){{/gone}}{{#newer}} (changed since the base was drawn){{/newer}}'
  place_way: '· way — {{to}} [{{id}}], direction {{dir}}{{#modes}}; by {{mode}}: {{minutes}} minutes{{#km}}, {{km}} km{{/km}}{{/modes}}{{#laid}}; laid in this chat{{/laid}}'
  place_adjoining: '· adjoining — {{name}} [{{id}}] ({{how}})'
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

### Not yet sure, sourced or applied

{{unsettled}}
{{/unsettled}}

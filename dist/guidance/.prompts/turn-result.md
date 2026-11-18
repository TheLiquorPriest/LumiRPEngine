---
description: The layout of a turn's result as an agent is given it by name (turn:result). The beats the turn opened in the story record, in order, then the changes staged in the engine's lane and in the story's lane, each lane's in the order recorded, a change that was not applied marked so. Each change is its operation and its value as JSON. When the turn holds none of them, the none part says so. It lays the result out; it asks for nothing.
---
{{#beats}}
- Beat opened: {{text}}
{{/beats}}
{{#engine}}
- Engine change, {{op}}{{#refused}}, not applied{{/refused}}: {{value}}
{{/engine}}
{{#story}}
- Story change, {{op}}{{#refused}}, not applied{{/refused}}: {{value}}
{{/story}}
{{#none}}
This turn has opened no beat and staged no change in either lane.
{{/none}}

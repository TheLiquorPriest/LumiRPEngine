---
description: Tells the Author, at a turn's start, when growth a character's own reflection proposed has waited for its decision for as many turns as the header says (one, as shipped), naming who and what. A proposal decided, accepted or struck, is no longer named. The header says how many turns; change it and the reminder follows. A reminder of what `TURN.md` asks of proposed growth.
title: Proposed growth waiting for a decision
agents: [author]
needs: TURN
fact: cast.growth.waiting >= 1
at: turn-start
repeat: once per turn
---
Growth these characters' own reflections proposed waits for your decision: {{cast.growth.waiting.names}}.
{{#cast.growth.waiting.proposed}}
- {{who}} ({{casting}}), {{id}}: "{{text}}"{{#cause}}, from {{cause}}{{/cause}}; proposed at message {{since}}, {{turns}} turn(s) ago.
{{/cast.growth.waiting.proposed}}
Decide each with `cast_update`'s `growth` operation and its `id`: `accept` makes it growth from now on, `drop` strikes it, with the reason. See `TURN.md`, "A character's reflection proposed growth".

---
description: Tells the Author, at a turn's start, when someone was on stage in an earlier turn and has no perception recorded for it (the run was cut short, say). The header says whose perceptions count. A reminder of the perceptions rule.
agents: [author]
needs: perceptions
fact: path.unperceived(principal, supporting) > 0
at: turn-start
repeat: once per turn
---
These characters were on stage in earlier turns and have no perception recorded for them: {{path.unperceived.names}}.
{{#path.unperceived.read.owner}}
In {{path.unperceived.read.owner}} of the earlier turns no scene was recorded, so who was on stage there is who the world state placed where the player's character was.
{{/path.unperceived.read.owner}}
See the perceptions rule, "If one is missing".

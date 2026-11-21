---
description: Reminds the Author when someone on stage has no perception for this turn. The header says whose perceptions count; change it and the reminder follows.
title: Perceptions owed for someone on stage this turn
agents: [author]
needs: perceptions
fact: stage.unperceived(principal, supporting) > 0
at: run-end
repeat: once per turn
---
These characters were on stage this turn and have no perception recorded for it: {{stage.unperceived.names}}.
The stage was read from {{stage.unperceived.read}}: scene means the open scene and who the world state places in its place; owner means no scene is recorded, so it is who the world state places where the player's character is.
Write them now, or start a job that will. See the perceptions rule.

---
description: Tells the Author, at a turn's start, when someone was on stage in an earlier turn and has no perception recorded for it (the run was cut short, say), naming each turn by its message, its story time and its place. The header says whose perceptions count. A reminder of the perceptions rule.
title: Perceptions missing for someone who was on stage
agents: [author]
needs: perceptions
fact: path.unperceived(principal, supporting) > 0
at: turn-start
repeat: once per turn
---
These characters were on stage in earlier turns and have no perception recorded for them: {{path.unperceived.names}}.
{{#path.unperceived.missing}}
- {{name}} ({{casting}}):{{#turns}} message {{message}}{{#time}}, {{time}}{{/time}}{{#place}}, {{place}}{{/place}};{{/turns}}
{{/path.unperceived.missing}}
{{#path.unperceived.read.owner}}
In {{path.unperceived.read.owner}} of the earlier turns no scene was recorded, so who was on stage there is who the world state placed where the player's character was.
{{/path.unperceived.read.owner}}
Write each with `perceive` and that `message`. Where nothing reached one of them then, a perception with reach `none` says so, and that turn is settled for them. See the perceptions rule, "If one is missing".

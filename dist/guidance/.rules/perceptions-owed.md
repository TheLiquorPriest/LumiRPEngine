---
description: Reminds the Author when someone on stage has no perception for this turn. The header says whose perceptions count; change it and the reminder follows.
agents: [author]
needs: perceptions
fact: stage.unperceived(principal, supporting) > 0
at: run-end
repeat: once per turn
---
These characters were on stage this turn and have no perception recorded for it: {{stage.unperceived.names}}.
Write them now, or start a job that will. See the perceptions rule.

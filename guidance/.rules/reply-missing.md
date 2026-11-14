---
description: Catches a turn that is about to end without a reply.
agents: [author]
fact: reply.released == false
at: run-end
repeat: once per turn
---
You are about to end the turn and the player has no reply. Write it now, marked the way the reply contract says.

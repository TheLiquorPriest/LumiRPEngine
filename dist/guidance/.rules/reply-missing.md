---
description: Catches a turn that is about to end without a reply.
agents: [author]
fact: turn.owes.reply > 0
at: run-end
repeat: once per turn
---
This turn is about to end, and the player has no reply. The reply is still owed: write it now, in your answer to this, marked the way the reply contract says. Reading or recording more does not write it.

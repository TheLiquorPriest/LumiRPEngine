---
description: Reminds the Author, as the calls of a message come back, when it has written no intent record for this turn and its reply has not gone out, so that the record still comes before the reply. `TURN.md` is the one home of what the intent record is and when it is written; this only reminds. The header's group `unreleased` keeps it from speaking once the reply is out.
agents: [author]
needs: TURN
fact: turn.without.intent(unreleased) > 0
at: after-message
repeat: once per turn
---
You have not written an intent record for this turn, and your reply has not gone out. Write it now, at the head of your next message, marked the way the reply contract says, before you go on. See `TURN.md`, "Intent first".
{{#turns.without.intent}}
The {{turns.without.intent}} turns before this one went without one too.
{{/turns.without.intent}}

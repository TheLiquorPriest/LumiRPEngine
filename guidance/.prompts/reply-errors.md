---
description: The plain line the chat shows the player when a turn ends without a reply, one line for each reason, a name, a colon, then its text. Where thinking had already gone out, the message the chat keeps shows the same line in its thinking, filled with no detail (the provider's or the error's own words, which go to the player's notice alone), since what is kept in the thinking can reach a later prompt; so a line reads whole without it. The lines whose names begin `pass-` are for a request the chat application sent to RPE's connection to be passed on to a model, and that has no answer, because no connection could pass it on, because something in it cannot be carried by that connection, because the provider failed, or because it was stopped. Change the words freely. Delete a line and that reason is shown with no words.
format: lines
---
no-reply: The Author ended this turn without writing a reply. RPE's Turn page shows what it did.
limit: The turn reached its limit of {{max}} on {{limit}} before a reply was written.
provider: The model's provider failed before a reply was written{{#detail}}: {{detail}}{{/detail}}{{^detail}}.{{/detail}}
stopped: The turn was stopped before a reply was written.
failed: The turn could not be played{{#detail}}: {{detail}}{{/detail}}{{^detail}}.{{/detail}}
pass-no-connection: The request could not be passed on: RPE has no connection to pass it on by{{#detail}}: {{detail}}{{/detail}}{{^detail}}.{{/detail}}
pass-not-carried: The request was not sent, because something in it cannot be carried by the connection it goes to{{#detail}}: {{detail}}{{/detail}}{{^detail}}.{{/detail}} Nothing was sent with that part left out.
pass-provider: The model's provider failed before an answer was written{{#detail}}: {{detail}}{{/detail}}{{^detail}}.{{/detail}}
pass-stopped: The request was stopped before an answer was written.

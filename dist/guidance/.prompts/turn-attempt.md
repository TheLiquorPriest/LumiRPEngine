---
description: The layout of each file in `previous-attempts/` in a turn's folder, for a swipe or a regenerate. One earlier attempt at the reply being written again, with its intent record where it wrote one and what the player typed about it where there was something. It lays the attempt out; it asks for nothing.
---
# Attempt {{n}} (turn {{turn}})
{{#mode}}

The player asked for the next attempt in the mode {{mode}}.
{{/mode}}
{{#intent}}

## Its intent record

{{intent}}
{{/intent}}
{{#reply}}

## Its reply

{{reply}}
{{/reply}}
{{#feedback}}

## What the player said about it

{{feedback}}
{{/feedback}}
{{#unseparated}}

## Feedback that could not be told apart

Lumiverse put feedback of the player's into the prompt{{#position}}, in a {{position}} message{{/position}}, and RPE could not tell it apart from the rest of that message. It is not in the feedback above.
{{/unseparated}}

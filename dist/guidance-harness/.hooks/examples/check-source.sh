#!/bin/sh
# Example hook, for `before-tool` (see hooks.yml beside this file). It refuses a world_apply call that names no source anywhere in its arguments, and says why.
#
# The call arrives as JSON on the standard input: {hook, event, scope, agent, tool, callId, args}.
# Exiting with 2 (the setting hooks.blockExit) blocks the call, and what is written on the standard error is the reason the agent is told. Exiting with 0 lets it through.
input=$(cat)

# Only world_apply is looked at: any other tool goes through.
printf '%s' "$input" | grep -Eq '"tool" *: *"world_apply"' || exit 0

# A call that names a source for what it does goes through. This looks for the word only; to check that every operation has one, parse the JSON with a tool such as jq.
printf '%s' "$input" | grep -q '"source"' && exit 0

echo "This world_apply call names no source. Give each operation its source: where the change comes from (a lore entry, a message, a roll, or invented), as the file for every agent says." >&2
exit 2

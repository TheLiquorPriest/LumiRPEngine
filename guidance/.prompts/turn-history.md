---
description: The layout of `visible-chat-history.md` in each turn's folder. The chat's messages that are in this turn's prompt, each with its place in the chat, its id and its speaker, and a line for the earlier messages the prompt leaves out. Places are counted as the chat counts them, from 0. It lays the history out; it asks for nothing.
---
{{#left_out}}
Messages {{from}} to {{to}} of the chat are not in the prompt.

{{/left_out}}
{{#messages}}
## Message {{at}} [{{id}}]{{#speaker}}, {{speaker}}{{/speaker}}

{{text}}

{{/messages}}

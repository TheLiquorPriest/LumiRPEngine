---
description: The layout of `assembled-preset-prompt.md` in each turn's folder, for the agents a turn delegates to and for you. Every message of the prompt the chat application sent for this reply, in order, with its role. It lays the prompt out; it asks for nothing.
---
{{#messages}}
## Message {{n}}, {{role}}{{#pictures}} (with {{pictures}} picture(s), not shown here){{/pictures}}

{{text}}

{{/messages}}

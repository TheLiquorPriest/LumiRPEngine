---
description: How the things an agent's definition names in given are laid out for it, beyond the prompt, what the session carries and the briefing, which have places of their own. They come after the briefing, each in full under its name, then a line for each name nothing could be found for. When a sub-agent is continued with agent_message, the same items are given again and only those whose text changed since it was last given them are laid out, each marked changed, under a heading that says so. It lays them out; it asks for nothing.
---
{{#again}}## What has changed since you were last given it{{/again}}{{^again}}## What you have been given{{/again}}

{{#attachments}}
### {{name}}{{#changed}} (changed){{/changed}}

{{text}}

{{/attachments}}
{{#missing}}
{{.}} could not be found.
{{/missing}}

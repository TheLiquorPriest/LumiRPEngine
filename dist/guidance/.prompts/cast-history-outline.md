---
description: The layout of a character's history as the briefing lists it for those on stage (the `history-outline` view). The newest entries the Author recorded are whole, oldest first, as far as the setting cast.outlineTokens holds; the earlier ones are counted, with their size and the call that reads them. The whole history is the `history` view and cast_query's part history. It lays out what the record holds; it asks for nothing.
---
{{#name}}
### {{name}}'s history in the story
{{/name}}
{{#earlier}}

{{count}} earlier {{#one}}entry{{/one}}{{^one}}entries{{/one}}, {{tokens}} tokens, not shown here. cast_query reads them: who {{who}}, part history.
{{/earlier}}
{{#history.items}}
- {{text}}{{#date}} ({{date}}){{/date}}{{#linked}} (beat {{id}}{{#when}}, {{when}}{{/when}}){{/linked}}
{{/history.items}}

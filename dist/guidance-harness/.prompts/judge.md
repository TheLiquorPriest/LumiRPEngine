---
description: What the model that answers a rule's yes-or-no question (`question:`) is sent - the rule's question (`question`), what an agent wrote that it is asked about (`text`), and which that is (`about.reply`, `about.text` or `about.thinking`); `rule` is the rule's name. `yes` in this header names the answer that makes the rule fire, read as the first word of the model's answer whatever its case; any other answer does not.
yes: "yes"
---
Answer with one word: yes or no.

{{question}}

{{#about.reply}}The reply the player was shown{{/about.reply}}{{#about.text}}What was written{{/about.text}}{{#about.thinking}}What was thought{{/about.thinking}}:

{{text}}

---
description: What the model that judges a rule's yes-or-no question is sent. The question is the rule's own (`question`); the text is what the agent just wrote (`text`), and `about.reply`, `about.text` or `about.thinking` says which that is. Its answer decides only whether the rule's text is put in front of the agent. `yes` is the word that counts as a yes; any other answer is a no.
yes: "yes"
---
Read the text and answer one question about it. Answer with the single word yes or the single word no, and nothing else.

Question: {{question}}

{{#about.reply}}The reply the player was shown{{/about.reply}}{{#about.text}}What was written{{/about.text}}{{#about.thinking}}What was thought{{/about.thinking}}:

{{text}}

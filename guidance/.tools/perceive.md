---
description: perceive as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  perceptions: The perceptions, written in order, in one write.
  perceptions.who: "The character, by name or id, as the cast holds them."
  perceptions.id: "A perception to correct, by its id. The fields you send replace those it had. Leave it out to write a new one."
  perceptions.message: "The number of an earlier reply this perception is of. Leave it out for this turn."
  perceptions.moment: "Which moment of the turn it belongs to, in a few words."
  perceptions.reach: "How much of it reached them: whole, part, told (someone told them), or none."
  perceptions.content: "What reached their senses from where they stood and what they were attending to."
  perceptions.missed: "What happened that they did not get."
  perceptions.knows: "What they now know, as short statements. Each is added to their knowledge."
  perceptions.secrets: "Secrets the lore marks that they now hold, by the id the lore map shows."
  perceptions.told_by: "Who told them, by name. Leave it out when it reached them first hand."
  perceptions.reliability: "How reliable the telling is."
  perceptions.drop: "true to strike the perception named by id; say why."
  perceptions.why: "With drop: why it goes."
---
Records what reached each character of a moment of this turn, one perception per character and moment, many in one call. A perception belongs to this turn: if the turn is swiped or deleted, it goes, with what it added to their knowledge and the secrets it made theirs. The answer gives each perception's id, how it now stands, and the ids of the knowledge it added.

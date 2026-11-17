---
description: perceive as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  perceptions: The perceptions, written in order, in one write.
  perceptions.who: "The character, by name or id. Someone the cast does not hold yet is added, not yet cast."
  perceptions.id: "A perception to correct, by its id. The fields you send replace those it had: a new list of what they now know, or of the secrets they hold, strikes from their knowledge what the old one gave and the new one does not, and a secret no longer given is theirs no longer, unless other knowledge of theirs still gives it. Leave it out to write a new one."
  perceptions.message: "The number of an earlier reply this perception is of. Leave it out for this turn."
  perceptions.moment: "Which moment of the turn it belongs to, in a few words."
  perceptions.reach: "How much of it reached them: whole, part, told (someone told them), or none."
  perceptions.content: "What reached their senses from where they stood and what they were attending to."
  perceptions.missed: "What happened that they did not get."
  perceptions.knows: "What they now know, as short statements. Each is added to their knowledge."
  perceptions.secrets: "Secrets the lore marks that they now hold, by the id the lore map shows (e-112, e-112#2, w-31)."
  perceptions.learned: "With secrets: how they came by them: authored, witnessed, told, inferred or guessed. Left out: told when someone told them, else witnessed."
  perceptions.belief: "With secrets: what they take them to be: true, false or uncertain. Left out: true."
  perceptions.sure: "With secrets: how sure they are, from 0 to 1. Left out: the setting cast.secretConfidence."
  perceptions.told_by: "Who told them, by name. Leave it out when it reached them first hand."
  perceptions.reliability: "How reliable the telling is."
  perceptions.drop: "true to strike the perception named by id; say why. What it added to their knowledge is struck with it, and the secrets it made theirs are theirs no longer, unless other knowledge of theirs still gives them. false to take the strike back: the knowledge it struck with it stands again and the secrets that knowledge gives are theirs again, unless they hold them now; knowledge struck apart from it stays struck, and is said."
  perceptions.why: "With drop: why it goes."
  perceptions.source: "Where the perception comes from, which is not who told it (told_by): its kind alone (prose, lore, author, gm, character, player, default or invented), or an object with the kind in from. lore, message and roll cite an entry, message or roll by id; an invention cites its gap_check and consent."
  perceptions.precision: "How exact what you write is: exact, approximate, vague or unknown."
  perceptions.standing: "How sure what you write is: established, proposed or assumed."
---
Records what reached each character of a moment of this turn, one perception per character and moment, many in one call. A perception belongs to this turn: if the turn is swiped or deleted, it goes, with what it added to their knowledge and the secrets it made theirs. The answer gives each perception's id, how it now stands, the ids of the knowledge it added, and, for one struck or corrected, the knowledge struck with it and the secrets let go.

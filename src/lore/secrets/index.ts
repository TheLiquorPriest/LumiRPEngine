// The lore's secrets: the settings that decide what the narrator knows of them and when a holding counts, and RPE's answer to the extension's question.

export { markWording, SECRET_MARKS, type QuestionEntryLike, type SecrecyAnswer, type SecrecyDeps, type SecrecyQuestion, secrecyAt, secrecyRules, secretMarkLines } from "./answer";
export { KNOWLEDGE_BY, KNOWLEDGE_LANE, knowledgeApplied, knowledgeChange, knowledgeRecorded, narratorOf, type SecretSettings, type SecretSettingsFor, type SecretsFor, secretSettings, secretSettingsFor, secretsHeld } from "./settings";
export { HoldersAt, peopleOf } from "./holders";
export { type SecretIds, type SecretIdsDeps, secretIds } from "./ids";
export { bookRead, SECRET_MARK_LINE, type SecretWords, secretWords, type ShownSecret } from "./shown";

// LumiAH's side of the boundary (HARNESS-SLICE3 "Boundary with LumiAH"): the shapes of `lumi-ah`
// that the harness engine reads and answers with, each LumiAH's own, under LumiAH's own name. This
// file holds no copy: it is where the backend's code outside `backend/harness/` (the engine's tools
// and their tests) reads those shapes from, so that nothing else under `src/` names the package
// (`test/boundaries.test.ts`).
//
// Two of LumiAH's names mean something else in RPEngine, and keep LumiAH's meaning here:
// - `ToolTier` is what approval is decided by (read, write, external), not a role's writer tier
//   (`shared/agent-tools.ts`: read, story, gm).
// - `AgentBudget` is a definition's budget as LumiAH takes it (null for no limit), not a role's
//   (`shared/agent-settings.ts`: "none").

export type {
  AgentBudget,
  AgentDefinition,
  AgentRef,
  AgentSettings,
  AgentUsage,
  ChatClaim,
  ChatInfo,
  ClaimAsk,
  DefinitionsAsk,
  ExtensionDefinitions,
  GuidanceLevel,
  HarnessExtension,
  JobAllowance,
  JobState,
  JobView,
  JobWhen,
  JsonObject,
  JsonValue,
  Limit,
  ModelEffort,
  ModelMessage,
  ModelPart,
  ModelThinkingBlock,
  RecordJob,
  RemoteTool,
  RemoteToolCall,
  ReplyWritten,
  RunBegan,
  RunEnded,
  RunKind,
  Skill,
  StorySetting,
  StorySource,
  ToolsPort,
  ToolTier,
  TurnKind,
  TurnRecord,
  TurnStatus,
  WriterRequest,
} from "lumi-ah/core";

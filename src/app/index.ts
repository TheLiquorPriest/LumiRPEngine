// The app's public face (plan §4.4): what other areas use to bring their tables, add their routes,
// queue their writes and publish live events, and what the composition uses to run RPE. The
// switch's setter is not here: switching on anything that runs a command or calls out is the
// command line's alone (cli.ts, switches.ts).

export { appRoutes, lineLog, openApp, STATUS_PATH, UPDATE_PATH, type App, type Area, type OpenAppOptions } from "./app";
export { type AppFile, type BuildsStatus, type RestartState } from "./update";
export { Auth, AuthRefused, bearerOf, KEY_PREFIXES, NO_OWNER, type KeyKind, type MadeKey, type PageToken, type TokenMaker } from "./auth";
export {
  CONFIG_DEFAULTS,
  CONFIG_ENV,
  ConfigError,
  dataPaths,
  defaultDataFolder,
  GLOBAL_CONFIG_FILE,
  loadConfig,
  prepareDataFolder,
  type AppConfig,
  type DataPaths,
  type Env,
} from "./config";
export { connectionRoutes, MODELS_KEY, modelsPort, storedKey, type ConnectionShown, type ConnectionsApi, type ConnectionsShown, type ConnectionTested, type SaveConnection } from "./connections";
export { openDatabase, WriteQueue, WritesClosed, WriteWaited } from "./database";
export { Following, LIVE_PATH, LIVE_PROTOCOL, LiveHub, TOKEN_PROTOCOL_PREFIX, type LiveBatch, type LiveEvent, type LivePublish, type LiveReader } from "./live";
export { migrate, MIGRATION_AREAS, MigrationError, Migrations, type Migration, type MigrationArea, type MigrationOutcome } from "./migrations";
export {
  METHODS,
  rawRoute,
  route,
  RouteError,
  RouteTable,
  type Access,
  type JsonRoute,
  type Method,
  type ParamNames,
  type PathParams,
  type RawCall,
  type RawRoute,
  type Route,
  type RouteBody,
  type RouteCall,
  type RouteInfo,
  type RouteReply,
  type UserFor,
} from "./routes";
export { SecretsFile } from "./secrets";
export type { RunningServer } from "./server";
export { switchDigest, Switches, type SwitchEntry, type SwitchState } from "./switches";

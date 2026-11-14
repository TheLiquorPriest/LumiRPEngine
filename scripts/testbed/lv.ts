// One call to the test instance's Lumiverse, signed in as the scripts are (the CLI's saved token):
//   bun lv.ts GET /api/v1/spindle
//   bun lv.ts POST /api/v1/spindle/<id>/restart
//   bun lv.ts POST /api/v1/spindle/<id>/permissions '{"permissions":["cors_proxy"]}'
// Prints the answer as JSON. The environment is the one the other scripts read (see README.md).

import { readEnv } from "./lib/env";
import { Lumiverse, savedToken } from "./lib/lumiverse";

const [method, path, body] = process.argv.slice(2);
if (method === undefined || path === undefined || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
  console.error("usage: bun lv.ts <GET|POST|PUT|PATCH|DELETE> <path> [json body]");
  process.exit(2);
}
const env = readEnv();
const host = new Lumiverse(env.hostUrl, savedToken(env));
const answer = await host.call<unknown>(method as "GET", path, body === undefined ? undefined : JSON.parse(body));
console.log(JSON.stringify(answer, null, 2));

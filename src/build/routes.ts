// Build's one route (plan §14): a page sends one of today's messages, as today's page sends it to the
// extension's backend, and is answered with today's answer and the pushes the request caused. It is a
// tunnel for the previous build's message envelope, declared as such (`src/app/tunnel.ts`), until Build's
// own routes replace it.

import { draftChanged, errorMessage, requestMessage, resultMessage, route, shape } from "../app";
import { type BuildService } from "./serve";

export const BUILD_PATH = "/api/v1/build";

export function buildRoutes(service: BuildService) {
  return [
    route({
      method: "POST",
      path: BUILD_PATH,
      access: "page",
      group: "worlds",
      does: "Tunnel for the previous build's messages: Build's page sends one of today's messages as it sends it to the extension's backend, and is answered with today's answer and the pushes the request caused.",
      body: requestMessage,
      reply: shape.named("BuildTunnelReply", "Today's answer to the message, and the pushes the request caused.", shape.object({ result: shape.union(resultMessage, errorMessage), pushes: shape.list(draftChanged) })),
      handle: ({ body, user }) => service.answer(body, user),
    }),
  ] as const;
}

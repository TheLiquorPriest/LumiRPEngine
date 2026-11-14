// Build's one route (plan §14): a page sends one of today's messages, as today's page sends it to the
// extension's backend, and is answered with today's answer and the pushes the request caused.

import { route, RouteError } from "../app";
import type { FrontendToBackend } from "../shared/protocol";
import { type BuildService, isRequest } from "./serve";

export const BUILD_PATH = "/api/v1/build";

export function buildRoutes(service: BuildService) {
  return [
    route({
      method: "POST",
      path: BUILD_PATH,
      access: "page",
      body: (value: unknown): FrontendToBackend => {
        if (!isRequest(value)) throw new RouteError(400, "The body is one of today's messages: { lre: 1, type, reqId, … }.");
        return value;
      },
      handle: ({ body, user }) => service.answer(body, user),
    }),
  ] as const;
}

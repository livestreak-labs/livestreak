import { LiveStreakConfigError } from "@livestreak/core";
import type { IncomingMessage, ServerResponse } from "node:http";
import { bootstrapHostServerConfig, defaultHostServerConfig } from "../descriptor/config.js";
import { createHostRouteDeps, type HostRouteDeps } from "./deps.js";
import { createHostModules, descriptorRoutes } from "./modules.js";
import { mountEnabledRoutes } from "./registry.js";
import { jsonFailure, jsonSuccess, type JsonResponse } from "./response.js";
import type { MatchedRoute, RouteDefinition } from "./types.js";

// --- exports ---

export type { JsonResponse, JsonSuccess, JsonFailure } from "./response.js";
export { jsonSuccess, jsonFailure } from "./response.js";
export type { RouteContext, RouteDefinition, RouteHandler, MatchedRoute } from "./types.js";
export { createHostRouteDeps, type HostRouteDeps } from "./deps.js";
export { bootstrapHostServerConfig } from "../descriptor/config.js";

export const matchRoute = (
  method: string,
  pathname: string,
  routes: readonly RouteDefinition[]
): MatchedRoute | undefined => {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }

    const match = route.pattern.exec(pathname);
    if (match === null) {
      continue;
    }

    return {
      route,
      params: match.groups ?? {}
    };
  }

  return undefined;
};

export const routeNotFound = (method: string, pathname: string): JsonResponse<unknown> =>
  jsonFailure(
    404,
    new LiveStreakConfigError({
      message: `No route for ${method} ${pathname}`,
      metadata: { retryable: false }
    })
  );

export const createHostRoutes = (
  config = defaultHostServerConfig()
): RouteDefinition[] => {
  const deps = createHostRouteDeps(config);
  return [...descriptorRoutes(), ...mountEnabledRoutes(createHostModules(deps))];
};

export const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new LiveStreakConfigError({
      message: "Malformed JSON request body",
      metadata: { retryable: false }
    });
  }
};

export const writeJsonResponse = (response: ServerResponse, payload: JsonResponse<unknown>): void => {
  const body = payload.ok
    ? payload.body
    : {
        error: payload.error
      };

  response.statusCode = payload.status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
};

export const dispatchHttpRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  routes: readonly RouteDefinition[],
  deps: HostRouteDeps
): Promise<void> => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const matched = matchRoute(method, url.pathname, routes);

  if (matched === undefined) {
    writeJsonResponse(response, routeNotFound(method, url.pathname));
    return;
  }

  try {
    const body =
      method === "POST" || method === "PUT" || method === "PATCH"
        ? await readJsonBody(request)
        : undefined;
    const result = await matched.route.handler({
      params: matched.params,
      body,
      deps
    });
    writeJsonResponse(response, result);
  } catch (error) {
    if (error instanceof LiveStreakConfigError) {
      writeJsonResponse(response, jsonFailure(400, error));
      return;
    }

    writeJsonResponse(response, jsonFailure(500, error));
  }
};

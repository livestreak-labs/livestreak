import { LiveStreakConfigError } from "@livestreak/core";
import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, param, sendRouteResult } from "../middleware/respond.js";
import { parseSignalPayload, type SignalPayload } from "../../services/webrtc/signal.js";
import { iceServersForHost, readTurnConfig } from "../../services/webrtc/turn.js";

// --- exports ---

const badRequest = (message: string) => ({
  ok: false as const,
  status: 400,
  error: new LiveStreakConfigError({ message, metadata: { retryable: false } })
});

const notFound = (message: string) => ({
  ok: false as const,
  status: 404,
  error: new LiveStreakConfigError({ message, metadata: { retryable: false } })
});

export const createWebrtcController = (deps: HostRouteDeps) => {
  const store = deps.signaling;
  return {
    postOffer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const streamId = param(req.params.streamId);
      const payload = parseSignalPayload(req.body, "offer");
      if (streamId.length === 0 || payload === null) {
        sendRouteResult(res, badRequest("offer requires { type:'offer', sdp }"), next);
        return;
      }
      store.setOffer(streamId, payload);
      sendRouteResult(res, { ok: true, result: { ok: true } }, next, 201);
    }),

    getOffer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const offer = store.getOffer(param(req.params.streamId));
      if (offer === null) {
        sendRouteResult(res, notFound("no_offer"), next);
        return;
      }
      sendRouteResult(res, { ok: true, result: offer as SignalPayload }, next);
    }),

    postAnswer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const streamId = param(req.params.streamId);
      const payload = parseSignalPayload(req.body, "answer");
      if (streamId.length === 0 || payload === null) {
        sendRouteResult(res, badRequest("answer requires { type:'answer', sdp }"), next);
        return;
      }
      if (store.getOffer(streamId) === null) {
        sendRouteResult(res, notFound("no_offer_to_answer"), next);
        return;
      }
      store.setAnswer(streamId, payload);
      sendRouteResult(res, { ok: true, result: { ok: true } }, next, 201);
    }),

    getAnswer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const answer = store.getAnswer(param(req.params.streamId));
      if (answer === null) {
        sendRouteResult(res, notFound("no_answer"), next);
        return;
      }
      sendRouteResult(res, { ok: true, result: answer as SignalPayload }, next);
    }),

    clear: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      store.clear(param(req.params.streamId));
      sendRouteResult(res, { ok: true, result: { ok: true } }, next);
    }),

    // The host advertises ITS embedded relay: hand back TURN/STUN on the same host the caller reached us at
    // (so a browser gets localhost/LAN and a container gets host.docker.internal, each reachable for them).
    // relayOnly is advised because the dev peers (Docker container, Chromium mDNS host candidates) can't do
    // direct — the reachable path is the relay.
    getIce: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const config = readTurnConfig();
      const hostname = (req.headers.host ?? "").split(":")[0] || "127.0.0.1";
      const iceServers = config.enabled
        ? iceServersForHost(hostname, config)
        : [{ urls: "stun:stun.l.google.com:19302" }];
      sendRouteResult(
        res,
        { ok: true, result: { iceServers, relayOnly: config.enabled } },
        next
      );
    })
  };
};

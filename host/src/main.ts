#!/usr/bin/env tsx
/**
 * LiveStreak host dev server — HTTP on :8787 with AA (embedded Alto bundler + paymaster).
 *
 * Prereqs: anvil + `npm run deploy -- --name localhost` in packages/contracts
 *
 * Run:
 *   npm run dev
 */

import { createServer } from "node:http";
import { bootstrapHostServer } from "./server.js";
import { attachRemoteWss } from "./infrastructure/ws/server.js";
import { attachLiveWss } from "./infrastructure/ws/live-server.js";
import { readTurnConfig, startTurnServer } from "./services/webrtc/turn.js";

// The AA config assembly loads the deploy snapshot as read-only INPUT (config/aa/deploy-env.ts) —
// env is never mutated here. LIVESTREAK_AA_FROM_DEPLOY=0 / LIVESTREAK_DEPLOY_SNAPSHOT are honored there.
const { config, deps, app } = await bootstrapHostServer();

// Explicit http.Server so the WSS transports (Remote Bridge Console + live fMP4 fan-out) can share the
// port (Express 5 has no built-in WebSocket support). Each attach registers an `upgrade` listener that
// claims ONLY its own path prefix (/remote, /live) and returns silently otherwise, so they cooperate on
// the one server. A final listener 404s any upgrade neither claimed (registered LAST so the claimers run
// first — Node invokes upgrade listeners in registration order).
const httpServer = createServer(app);
attachRemoteWss(httpServer, deps);
attachLiveWss(httpServer, deps.live);
httpServer.on("upgrade", (req, socket) => {
  const path = (req.url ?? "").split("?")[0] ?? "";
  if (path.startsWith("/remote/") || path.startsWith("/live/")) return; // a claimer already handled it
  socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
  socket.destroy();
});

// The host IS the WebRTC media relay: embed a STUN/TURN server so producers/viewers behind NAT route media
// through us (no separate coturn). `GET /webrtc/ice` advertises how to reach it. Disable with LIVESTREAK_TURN_ENABLED=0.
const turnConfig = readTurnConfig();
const turn = startTurnServer(turnConfig);

httpServer.listen(config.bindPort, config.bindHost, () => {
  console.log(`[host]: listening on http://${config.bindHost}:${config.bindPort}`);
  if (turn !== null) {
    console.log(
      `  turn/relay listening on 0.0.0.0:${turnConfig.port} relay-ip=${turnConfig.relayIp} realm=${turnConfig.realm} (advertised at GET /webrtc/ice)`
    );
  } else {
    console.log("  turn/relay DISABLED (LIVESTREAK_TURN_ENABLED=0)");
  }
  for (const chain of deps.aa.aa.chains) {
    console.log(
      `  aa/${chain.routeKey} chainId=${chain.chainId} bundler=/aa/bundler/${chain.routeKey} paymaster=/aa/paymaster/${chain.routeKey}`
    );
  }
});

const shutdownTurn = (): void => {
  if (turn !== null) turn.stop();
};
process.once("SIGINT", shutdownTurn);
process.once("SIGTERM", shutdownTurn);

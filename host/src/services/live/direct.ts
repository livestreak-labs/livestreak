import { LiveStreakConfigError } from "@livestreak/core";

// --- Direct-stream signaling (the host's ONLY jobs on the direct lane; zero media bytes) ---
//
//   echo      dial the broadcaster back from OUTSIDE — the reachability truth its go-live gate needs
//   announce  publish the broadcaster's watch URL so viewers can find the direct door
//
// Auth posture mirrors the live ingest/watch legs: an always-on, stream-id-scoped open surface.
// The echo only ever dials the CALLER's own observed address — it cannot be pointed at third
// parties, so it is not a port-scan/SSRF primitive.

export interface DirectAnnounce {
  readonly streamId: string;
  readonly watchUrl: string;
  readonly announcedAtMs: number;
}

export interface DirectAnnounceStore {
  readonly announce: (streamId: string, watchUrl: string) => DirectAnnounce;
  readonly lookup: (streamId: string) => DirectAnnounce | undefined;
  readonly withdraw: (streamId: string) => boolean;
}

const MAX_ANNOUNCES = 500;

export const createDirectAnnounceStore = (): DirectAnnounceStore => {
  const announces = new Map<string, DirectAnnounce>();
  return {
    announce: (streamId, watchUrl) => {
      // Bounded: evict the oldest announce rather than grow without limit (announces are
      // live-session ephemera; a stale one just means that stream re-announces on go-live).
      if (!announces.has(streamId) && announces.size >= MAX_ANNOUNCES) {
        const oldest = announces.keys().next().value;
        if (oldest !== undefined) announces.delete(oldest);
      }
      const record: DirectAnnounce = { streamId, watchUrl, announcedAtMs: Date.now() };
      announces.set(streamId, record);
      return record;
    },
    lookup: (streamId) => announces.get(streamId),
    withdraw: (streamId) => announces.delete(streamId)
  };
};

export type DirectRouteResponse<T> =
  | { readonly ok: true; readonly status: number; readonly result: T }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

const failure = (status: number, message: string): DirectRouteResponse<never> => ({
  ok: false,
  status,
  error: new LiveStreakConfigError({ message })
});

export const handleDirectAnnounce = (
  streamId: string,
  body: unknown,
  store: DirectAnnounceStore
): DirectRouteResponse<DirectAnnounce> => {
  if (streamId.trim().length === 0) {
    return failure(400, "streamId is required");
  }
  const watchUrl = (body as { watchUrl?: unknown } | null)?.watchUrl;
  if (typeof watchUrl !== "string" || !/^wss?:\/\//.test(watchUrl)) {
    return failure(400, "watchUrl must be a ws:// or wss:// URL");
  }
  return { ok: true, status: 201, result: store.announce(streamId.trim(), watchUrl) };
};

export const handleDirectLookup = (
  streamId: string,
  store: DirectAnnounceStore
): DirectRouteResponse<DirectAnnounce> => {
  const found = store.lookup(streamId);
  if (found === undefined) {
    return failure(404, `No direct announce for stream "${streamId}"`);
  }
  return { ok: true, status: 200, result: found };
};

export const handleDirectWithdraw = (
  streamId: string,
  store: DirectAnnounceStore
): DirectRouteResponse<{ readonly withdrawn: boolean }> => ({
  ok: true,
  status: 200,
  result: { withdrawn: store.withdraw(streamId) }
});

export interface ReachabilityEchoResult {
  readonly reachable: boolean;
  readonly dialedIp: string;
  readonly dialedPort: number;
}

/** Injectable TCP dialer (tests fake it); resolves true when the handshake completes in time. */
export type TcpDialer = (ip: string, port: number, timeoutMs: number) => Promise<boolean>;

export const tcpDial: TcpDialer = async (ip, port, timeoutMs) => {
  const { connect } = await import("node:net");
  return new Promise((resolve) => {
    const socket = connect({ host: ip, port });
    const done = (reachable: boolean): void => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
};

export const handleReachabilityEcho = async (
  body: unknown,
  callerIp: string | undefined,
  dial: TcpDialer = tcpDial
): Promise<DirectRouteResponse<ReachabilityEchoResult>> => {
  const port = (body as { port?: unknown } | null)?.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    return failure(400, "port must be an integer in 1..65535");
  }
  if (callerIp === undefined || callerIp.length === 0) {
    return failure(400, "Could not determine the caller's address");
  }
  // Only the caller's own observed address is ever dialed (see the auth-posture note above).
  const ip = normalizeIp(callerIp);
  const reachable = await dial(ip, port, 3_000);
  return { ok: true, status: 200, result: { reachable, dialedIp: ip, dialedPort: port } };
};

// Express reports IPv4 peers as IPv6-mapped ("::ffff:84.12.9.3"); unwrap for the dial-back.
const normalizeIp = (ip: string): string =>
  ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;

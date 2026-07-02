import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";

/**
 * fMP4 ingest transport — the ONE outbound connection the producer ships its encoded stream over.
 *
 * The fMP4 sink encodes once and sends the init segment first, then each media fragment as it closes, over
 * a single connection to the host ingest endpoint (the host ring-buffers and fans out to N viewers). This
 * interface is the seam: production wraps a host WebSocket (see {@link createHostFmp4IngestTransport}); a
 * fake drives the sink-lifecycle tests. Kept dependency-free so observe's barrel stays Node-free for the
 * browser bundle — the `ws` import lives behind a lazy dynamic import in the host impl.
 */
export interface Fmp4IngestTransport {
  /** Send (or re-send on reconnect) the init segment. The host caches it for late joiners. */
  readonly sendInit: (data: Uint8Array) => Effect.Effect<void, LiveStreakError>;
  /** Send one media fragment (moof+mdat). Ordered; the host appends to its ring buffer. */
  readonly sendFragment: (data: Uint8Array) => Effect.Effect<void, LiveStreakError>;
  /** Signal a clean end of stream so the host tells viewers the feed ended, then close the connection. */
  readonly end: (reason?: string) => Effect.Effect<void, LiveStreakError>;
}

// Framing on the wire (host ingest WS): a 1-byte tag prefixes each binary frame so the host can route
// without a second channel. INIT and FRAGMENT carry bytes; END is a lone tag (+ optional utf8 reason).
export const FMP4_FRAME_INIT = 0x01;
export const FMP4_FRAME_FRAGMENT = 0x02;
export const FMP4_FRAME_END = 0x03;

export const frameFmp4 = (tag: number, body?: Uint8Array): Uint8Array => {
  const out = new Uint8Array(1 + (body?.length ?? 0));
  out[0] = tag;
  if (body !== undefined) out.set(body, 1);
  return out;
};

/** Minimal binary WebSocket surface the transport needs; a fake implements this in tests. */
export interface WebSocketLike {
  readonly send: (data: Uint8Array) => void;
  readonly close: (code?: number, reason?: string) => void;
  readonly readyState: number;
  readonly on: (event: "open" | "close" | "error", listener: (arg?: unknown) => void) => void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface HostFmp4IngestInput {
  /** Host base URL, e.g. `http://127.0.0.1:8787` (upgraded to ws:// / wss:// for the ingest socket). */
  readonly baseUrl: string;
  /** Stream/market id keying the host ring buffer (the per-stream feed key the viewer consumes under). */
  readonly streamId: string;
  /** Injectable WS factory (defaults to a lazily-imported `ws` client — Node only). */
  readonly webSocketFactory?: WebSocketFactory;
  /** Milliseconds to wait for the socket to open before failing; defaults to 15000. */
  readonly openTimeoutMs?: number;
}

const OPEN = 1;
const defaultOpenTimeoutMs = 15_000;

const toWsUrl = (baseUrl: string, streamId: string): string => {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const ws = trimmed.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  return `${ws}/live/ingest/${encodeURIComponent(streamId)}`;
};

// Lazily import `ws` (Node only) so observe's barrel never eagerly pulls it into the browser bundle —
// same posture as the wrtc/child_process dynamic imports elsewhere.
const importNode = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

const resolveWebSocketFactory = (
  injected: WebSocketFactory | undefined
): Effect.Effect<WebSocketFactory, LiveStreakError> =>
  injected !== undefined
    ? Effect.succeed(injected)
    : Effect.gen(function* () {
        // A global WebSocket (browser / Node 22+) is send/close/addEventListener-shaped, not `ws`-shaped —
        // adapt it. Otherwise dynamically import the `ws` client used across the CLI/host.
        const globalWs = (globalThis as { WebSocket?: unknown }).WebSocket;
        if (typeof globalWs === "function") {
          return (url: string) => adaptGlobalWebSocket(new (globalWs as new (u: string) => unknown)(url));
        }
        const mod = (yield* Effect.tryPromise({
          try: () => importNode("ws"),
          catch: (cause) =>
            new LiveStreakRuntimeError({
              message: "fMP4 ingest requires a WebSocket: no global WebSocket and `ws` import failed",
              metadata: { details: cause instanceof Error ? cause.message : String(cause) }
            })
        })) as { default?: new (u: string) => WebSocketLike } | (new (u: string) => WebSocketLike);
        const Ctor = (mod as { default?: new (u: string) => WebSocketLike }).default ??
          (mod as new (u: string) => WebSocketLike);
        return (url: string) => new Ctor(url);
      });

interface GlobalWebSocketLike {
  send: (data: Uint8Array) => void;
  close: (code?: number, reason?: string) => void;
  readyState: number;
  addEventListener: (type: string, listener: () => void) => void;
}

const adaptGlobalWebSocket = (ws: unknown): WebSocketLike => {
  const g = ws as GlobalWebSocketLike;
  return {
    send: (data) => g.send(data),
    close: (code, reason) => g.close(code, reason),
    get readyState() {
      return g.readyState;
    },
    on: (event, listener) => g.addEventListener(event, () => listener())
  };
};

/**
 * Host-mediated fMP4 ingest over ONE WebSocket. Opens the socket, then ships tagged binary frames
 * (init/fragment/end). The socket is opened lazily on the first send so the sink can attach before a
 * connection exists, then reuses it. init is re-sendable (the sink re-sends on a reconnect).
 */
export const createHostFmp4IngestTransport = (
  input: HostFmp4IngestInput
): Fmp4IngestTransport => {
  if (typeof input.baseUrl !== "string" || input.baseUrl.trim().length === 0) {
    throw new LiveStreakConfigError({ message: "fMP4 ingest requires a baseUrl" });
  }
  if (typeof input.streamId !== "string" || input.streamId.trim().length === 0) {
    throw new LiveStreakConfigError({ message: "fMP4 ingest requires a streamId" });
  }

  const url = toWsUrl(input.baseUrl, input.streamId);
  const openTimeoutMs = input.openTimeoutMs ?? defaultOpenTimeoutMs;
  let socket: WebSocketLike | undefined;
  let opening: Promise<WebSocketLike> | undefined;

  const openSocket = (): Effect.Effect<WebSocketLike, LiveStreakError> =>
    Effect.gen(function* () {
      if (socket !== undefined && socket.readyState === OPEN) return socket;
      const factory = yield* resolveWebSocketFactory(input.webSocketFactory);
      if (opening === undefined) {
        opening = new Promise<WebSocketLike>((resolve, reject) => {
          const ws = factory(url);
          const timer = setTimeout(() => reject(new Error(`fMP4 ingest socket open timed out (${url})`)), openTimeoutMs);
          if (typeof (timer as { unref?: () => void }).unref === "function") {
            (timer as { unref: () => void }).unref();
          }
          ws.on("open", () => {
            clearTimeout(timer);
            socket = ws;
            resolve(ws);
          });
          ws.on("error", (err) => {
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          });
          ws.on("close", () => {
            socket = undefined;
            opening = undefined;
          });
          // A factory that hands back an already-open socket (test fake) never fires "open".
          if (ws.readyState === OPEN) {
            clearTimeout(timer);
            socket = ws;
            resolve(ws);
          }
        });
      }
      return yield* Effect.tryPromise({
        try: () => opening!,
        catch: (cause) =>
          new LiveStreakRuntimeError({
            message: "fMP4 ingest socket failed to open",
            metadata: { details: cause instanceof Error ? cause.message : String(cause) }
          })
      });
    });

  const send = (frame: Uint8Array): Effect.Effect<void, LiveStreakError> =>
    Effect.gen(function* () {
      const ws = yield* openSocket();
      yield* Effect.try({
        try: () => ws.send(frame),
        catch: (cause) =>
          new LiveStreakRuntimeError({
            message: "fMP4 ingest send failed",
            metadata: { details: cause instanceof Error ? cause.message : String(cause) }
          })
      });
    });

  return {
    sendInit: (data) => send(frameFmp4(FMP4_FRAME_INIT, data)),
    sendFragment: (data) => send(frameFmp4(FMP4_FRAME_FRAGMENT, data)),
    end: (reason) =>
      Effect.gen(function* () {
        const body = reason === undefined ? undefined : new TextEncoder().encode(reason);
        // Best-effort end signal, then close — a dead socket at teardown is not an error.
        yield* send(frameFmp4(FMP4_FRAME_END, body)).pipe(Effect.catchAll(() => Effect.void));
        if (socket !== undefined) {
          try {
            socket.close(1000, reason);
          } catch {
            /* ignore */
          }
          socket = undefined;
          opening = undefined;
        }
      })
  };
};

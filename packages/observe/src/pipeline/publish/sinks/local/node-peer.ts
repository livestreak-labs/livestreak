import { Effect } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type {
  RtcPeerConnectionFactory,
  RtcPeerConnectionLike,
  RtcVideoTrackHandle
} from "./signaling.js";
import { gatheredLocalDescription, resolveDefaultPeerFactory } from "./signaling.js";

/**
 * Node.js RTCPeerConnection factory for the CLI file→WebRTC producer.
 *
 * Tries `@roamhq/wrtc` when installed (optional dependency). Plain Node without
 * WebRTC fails with a clear message — inject a factory in tests via loopback.
 */

interface NodeVideoTrack {
  stop: () => void;
}

interface NodeRtcVideoSource {
  createTrack: () => NodeVideoTrack;
  onFrame: (frame: { width: number; height: number; data: Uint8ClampedArray }) => void;
}

type WrtcModule = {
  readonly RTCPeerConnection: new (config?: unknown) => NodeRtcPeer;
  readonly nonstandard?: {
    readonly RTCVideoSource: new () => NodeRtcVideoSource;
  };
};

const importNode = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

interface NodeRtcPeer {
  addTrack: (track: NodeVideoTrack) => unknown;
  createOffer: () => Promise<{ type: "offer" | "answer"; sdp: string }>;
  createAnswer: () => Promise<{ type: "offer" | "answer"; sdp: string }>;
  setLocalDescription: (d: { type: "offer" | "answer"; sdp: string }) => Promise<void>;
  setRemoteDescription: (d: { type: "offer" | "answer"; sdp: string }) => Promise<void>;
  readonly iceGatheringState: string;
  readonly localDescription: { type: "offer" | "answer"; sdp: string } | null;
  close: () => void;
}

const adaptNodeVideoTrack = (
  peer: NodeRtcPeer,
  VideoSource: new () => NodeRtcVideoSource
): RtcVideoTrackHandle => {
  const source = new VideoSource();
  const track = source.createTrack();
  peer.addTrack(track);
  return {
    // RTCVideoSource wants an I420 buffer as Uint8ClampedArray; wrap the frame bytes without copying.
    pushFrame: (frame) =>
      source.onFrame({
        width: frame.width,
        height: frame.height,
        data:
          frame.data instanceof Uint8ClampedArray
            ? frame.data
            : new Uint8ClampedArray(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)
      }),
    stop: () => track.stop()
  };
};

const adaptNodePeer = (
  peer: NodeRtcPeer,
  VideoSource: (new () => NodeRtcVideoSource) | undefined
): RtcPeerConnectionLike => {
  const adapter: RtcPeerConnectionLike = {
    createOffer: () => peer.createOffer(),
    createAnswer: () => peer.createAnswer(),
    setLocalDescription: (d) => peer.setLocalDescription(d),
    setRemoteDescription: (d) => peer.setRemoteDescription(d),
    localDescriptionWithCandidates: (fallback) => gatheredLocalDescription(peer, fallback),
    close: () => peer.close(),
    ontrack: null,
    ...(VideoSource === undefined ? {} : { addVideoTrack: () => adaptNodeVideoTrack(peer, VideoSource) })
  };
  return adapter;
};

export const resolveNodePeerConnectionFactory = (): Effect.Effect<
  RtcPeerConnectionFactory,
  LiveStreakError
> =>
  Effect.gen(function* () {
    if ((globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection !== undefined) {
      return yield* resolveDefaultPeerFactory();
    }

    let wrtc: WrtcModule | undefined;
    try {
      // @roamhq/wrtc is CJS — under ESM `import()` its exports land on `.default`, so unwrap it.
      const mod = (yield* Effect.promise(() => importNode("@roamhq/wrtc"))) as
        | WrtcModule
        | { readonly default?: WrtcModule };
      wrtc = (mod as { default?: WrtcModule }).default ?? (mod as WrtcModule);
    } catch {
      wrtc = undefined;
    }

    if (wrtc?.RTCPeerConnection === undefined) {
      return yield* Effect.fail(
        new LiveStreakRuntimeError({
          message:
            "Node file→WebRTC requires @roamhq/wrtc (optional dep) or a peerConnectionFactory injection"
        })
      );
    }

    const Ctor = wrtc.RTCPeerConnection;
    const VideoSource = wrtc.nonstandard?.RTCVideoSource;
    // ICE servers are env-overridable (LIVESTREAK_ICE_SERVERS = JSON array) so a
    // Dockerized/remote producer can point at a TURN relay; default stays STUN-only.
    const iceServers: { urls: string; username?: string; credential?: string }[] = (() => {
      const raw = process.env.LIVESTREAK_ICE_SERVERS;
      if (raw !== undefined && raw.trim() !== "") {
        try {
          return JSON.parse(raw) as { urls: string; username?: string; credential?: string }[];
        } catch {
          /* malformed → STUN default */
        }
      }
      return [{ urls: "stun:stun.l.google.com:19302" }];
    })();
    // Relay-only (LIVESTREAK_ICE_RELAY_ONLY=1) forces TURN. A Dockerized producer's
    // host candidates are container-private (unreachable from the viewer), so without
    // this ICE stalls on them instead of using the reachable TURN relay.
    const relayOnly = process.env.LIVESTREAK_ICE_RELAY_ONLY === "1";
    return () =>
      adaptNodePeer(
        new Ctor(relayOnly ? { iceServers, iceTransportPolicy: "relay" } : { iceServers }),
        VideoSource
      );
  });

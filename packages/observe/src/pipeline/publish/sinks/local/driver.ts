import { Effect } from "effect";
import {
  LiveStreakConfigError,
  LiveStreakRuntimeError,
  type LiveStreakError
} from "@livestreak/core";
import type {
  DescriptorValueSchema,
  RegistryFlagDescriptor,
  SinkAttachment,
  SinkDeliveryItem,
  SinkDriver,
  SinkDriverDescriptor,
  SinkFinalizeResult,
  SinkStageHealth
} from "#pipeline/publish/index.js";
import type { DescribeControlContext, ControlCellDefinition } from "#run/control/bus/types.js";
import {
  resolveDefaultPeerFactory,
  type RtcPeerConnectionFactory,
  type RtcPeerConnectionLike,
  type RtcVideoFrame,
  type RtcVideoTrackHandle,
  type SinkSignalingChannel
} from "./signaling.js";

/**
 * Local WebRTC preview sink — REAL-TIME video over a WebRTC media track.
 *
 * The producer adds an outbound video track (`RTCVideoSource` via @roamhq/wrtc), performs a self-contained
 * SDP handshake (offer with the video m-line → publish → await the consumer's answer), then pushes each
 * decoded I420 frame into the track as it arrives. Frames ride native RTP (VP8) with congestion control and
 * a jitter buffer, and the browser viewer receives them as a normal `MediaStreamTrack` (`<video>.srcObject`).
 *
 * The capture stage decodes the source directly to I420 (`yuv420p`) at real time (ffmpeg `-re`) — see the
 * file capture `pixelFormat`/`realtime` config — so frames feed `onFrame` with no color conversion and the
 * stream is paced at wall-clock FPS. This is streaming, not store-and-forward.
 */
export interface LocalSinkConfig {
  /** Local SDP signaling channel (sink emits offer, consumer answers). */
  readonly signaling: SinkSignalingChannel;
  /**
   * Stream/market id this sink publishes (per-stream feed): the control cell + feed are scoped to this id so
   * each stream gets ITS own feed. Optional for the in-process verify path.
   */
  readonly streamId?: string;
  /** Optional override of the WebRTC peer factory (tests inject a real @roamhq/wrtc factory). */
  readonly peerConnectionFactory?: RtcPeerConnectionFactory;
  /** Milliseconds to wait for the consumer's answer before failing the handshake; defaults to 30000. */
  readonly answerTimeoutMs?: number;
}

export interface LocalSinkDriverOptions {
  /** Default peer factory used when the config does not supply one. */
  readonly peerConnectionFactory?: RtcPeerConnectionFactory;
  /** Default answer timeout in milliseconds. */
  readonly answerTimeoutMs?: number;
}

import {
  localSinkCloseCommand,
  localSinkConfigureCommand
} from "./commands.js";

const attachmentId = "local-preview";
const defaultAnswerTimeoutMs = 30_000;

const stringValue = (description: string, required = false): DescriptorValueSchema => ({
  type: "string",
  description,
  required
});

const flag = (
  name: string,
  value: DescriptorValueSchema,
  help: string,
  extras: Omit<RegistryFlagDescriptor, "name" | "value" | "help"> = {}
): RegistryFlagDescriptor => ({
  name,
  value,
  help,
  ...extras
});

const configError = (message: string, details?: string): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message,
    metadata: details === undefined ? undefined : { details }
  });

export const localSinkDescriptor: SinkDriverDescriptor = {
  kind: "publish",
  id: "local",
  version: "0.1.0",
  displayName: "Local Preview Sink",
  summary: "Stream rendered video to a local peer over a WebRTC media track.",
  capabilityScopes: ["sink:local:*"],
  flags: [
    flag(
      "streamId",
      stringValue("Stream/market id this preview feed is scoped to."),
      "Scope the local WebRTC preview feed to a stream id."
    )
  ],
  commands: [localSinkConfigureCommand, localSinkCloseCommand],
  mode: "local",
  requiresHost: false,
  debugOnly: false
};

export const validateLocalSinkConfig = (
  config: LocalSinkConfig
): Effect.Effect<LocalSinkConfig, LiveStreakError> =>
  Effect.gen(function* () {
    if (config.signaling === null || typeof config.signaling !== "object") {
      return yield* Effect.fail(configError("Local sink requires a signaling channel"));
    }
    if (typeof config.signaling.publishOffer !== "function") {
      return yield* Effect.fail(
        configError("Local sink signaling channel must provide publishOffer")
      );
    }
    if (
      config.answerTimeoutMs !== undefined &&
      (!Number.isFinite(config.answerTimeoutMs) || config.answerTimeoutMs <= 0)
    ) {
      return yield* Effect.fail(
        configError("Local sink answerTimeoutMs must be a positive number")
      );
    }

    return config;
  });

export const createLocalSinkDriver = (
  options: LocalSinkDriverOptions = {}
): SinkDriver<LocalSinkConfig> => ({
  descriptor: localSinkDescriptor,
  mode: "local",
  validate: validateLocalSinkConfig,
  describeControl: (config, context) =>
    Effect.succeed(describeLocalSinkCell(config, context)),
  attach: (config) =>
    Effect.gen(function* () {
      const answerTimeoutMs =
        config.answerTimeoutMs ?? options.answerTimeoutMs ?? defaultAnswerTimeoutMs;

      const factory =
        config.peerConnectionFactory ??
        options.peerConnectionFactory ??
        (yield* resolveDefaultPeerFactory());

      const stats = {
        deliveredItems: 0,
        status: "starting" as "starting" | "running" | "stopped" | "failed",
        message: "local sink streaming video over a WebRTC media track"
      };

      const peer = factory();
      if (peer.addVideoTrack === undefined) {
        return yield* Effect.fail(
          new LiveStreakRuntimeError({
            message:
              "Local sink requires a WebRTC transport with video-track support (@roamhq/wrtc RTCVideoSource)"
          })
        );
      }
      const track = peer.addVideoTrack();

      let finalized = false;

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (!finalized) {
            track.stop();
            peer.close();
          }
        }).pipe(Effect.catchAll(() => Effect.void))
      );

      // Signaling handshake: offer (now carrying the video m-line) -> publish -> await the consumer's answer.
      // We do NOT block on media connectivity — frames are pushed continuously and the viewer joins live.
      yield* handshake(peer, config.signaling, answerTimeoutMs);
      stats.status = "running";

      const deliver = (item: SinkDeliveryItem): Effect.Effect<void, LiveStreakError> =>
        Effect.gen(function* () {
          if (item.kind === "marker") {
            return;
          }
          const frame = yield* readI420Frame(item.payload);
          track.pushFrame(frame);
          stats.deliveredItems += 1;
        });

      const finalize: Effect.Effect<SinkFinalizeResult, LiveStreakError> = Effect.sync(() => {
        if (!finalized) {
          finalized = true;
          track.stop();
          peer.close();
          if (stats.status !== "failed") {
            stats.status = "stopped";
          }
        }
        return { deliveredItems: stats.deliveredItems, output: { kind: "memory" } };
      });

      const health: Effect.Effect<SinkStageHealth, LiveStreakError> = Effect.sync(() => ({
        stage: "publish",
        descriptorId: localSinkDescriptor.id,
        status: stats.status,
        message: stats.message,
        updatedAtMs: Date.now(),
        attachmentId,
        deliveredItems: stats.deliveredItems
      }));

      const attachment: SinkAttachment = {
        id: attachmentId,
        deliver,
        finalize,
        health,
        detach: Effect.void
      };

      return attachment;
    })
});

// --- helpers ---

const describeLocalSinkCell = (
  config: LocalSinkConfig,
  context: DescribeControlContext
): ControlCellDefinition => {
  const nowMs = context.nowMs ?? Date.now();
  const instanceId = context.instanceId ?? config.streamId ?? "local-preview";

  return {
    id: `sink:${instanceId}`,
    cell: {
      label: "Local Preview",
      catalog: "sink:local",
      status: ["idle", null, nowMs],
      settings: {
        transport: "webrtc-media-track",
        subscribe: ["publish.video.rendered"]
      },
      readonly: config.streamId === undefined ? {} : { streamId: config.streamId },
      functions: []
    }
  };
};

const handshake = (
  peer: RtcPeerConnectionLike,
  signaling: SinkSignalingChannel,
  answerTimeoutMs: number
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const offer = yield* Effect.tryPromise({
      try: () => peer.createOffer(),
      catch: (cause) => runtimeError("Local sink failed to create an offer", cause)
    });
    yield* Effect.tryPromise({
      try: () => peer.setLocalDescription(offer),
      catch: (cause) => runtimeError("Local sink failed to set the local description", cause)
    });

    // Non-trickle ICE: embed the gathered candidates in the offer before publishing — the signaling relays
    // only the SDP, so without this the viewer never learns where to connect and media never flows.
    const localOffer = yield* Effect.tryPromise({
      try: () => peer.localDescriptionWithCandidates(offer),
      catch: (cause) => runtimeError("Local sink failed to gather ICE candidates", cause)
    });

    yield* signaling.publishOffer(localOffer);

    const answer = yield* signaling.awaitAnswer.pipe(
      Effect.timeoutFail({
        duration: `${answerTimeoutMs} millis`,
        onTimeout: () =>
          new LiveStreakRuntimeError({
            message: "Local sink timed out waiting for the viewer's WebRTC answer"
          })
      })
    );
    yield* Effect.tryPromise({
      try: () => peer.setRemoteDescription(answer),
      catch: (cause) => runtimeError("Local sink failed to set the remote description", cause)
    });
  });

const readI420Frame = (payload: unknown): Effect.Effect<RtcVideoFrame, LiveStreakError> =>
  Effect.gen(function* () {
    if (payload === null || typeof payload !== "object") {
      return yield* Effect.fail(configError("Local sink received an invalid video payload"));
    }
    const candidate = payload as {
      data?: unknown;
      width?: unknown;
      height?: unknown;
      byteFormat?: unknown;
    };
    if (!(candidate.data instanceof Uint8Array) || candidate.data.byteLength === 0) {
      return yield* Effect.fail(
        configError("Local sink received a video payload without frame bytes")
      );
    }
    if (
      typeof candidate.width !== "number" ||
      typeof candidate.height !== "number" ||
      candidate.width <= 0 ||
      candidate.height <= 0
    ) {
      return yield* Effect.fail(
        configError("Local sink video frame requires positive width and height")
      );
    }
    // The media track needs I420. The capture is wired to decode `yuv420p` for this sink; a mismatch is a
    // pipeline misconfiguration, so fail loudly rather than push garbage into RTCVideoSource.
    if (candidate.byteFormat !== "yuv420p") {
      return yield* Effect.fail(
        configError(
          `Local sink requires I420 (yuv420p) frames, received "${String(candidate.byteFormat)}" — ` +
            "configure the capture with pixelFormat: 'yuv420p'"
        )
      );
    }
    const expected = (candidate.width * candidate.height * 3) / 2;
    if (candidate.data.byteLength !== expected) {
      return yield* Effect.fail(
        configError(
          `Local sink I420 frame size mismatch: expected ${expected} bytes for ${candidate.width}x${candidate.height}, got ${candidate.data.byteLength}`
        )
      );
    }
    return { width: candidate.width, height: candidate.height, data: candidate.data };
  });

const runtimeError = (message: string, cause: unknown): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message,
    metadata: { details: cause instanceof Error ? cause.message : String(cause) }
  });

import { describe, expect, it } from "vitest";
import { Effect, Fiber } from "effect";
import type { SinkDeliveryItem } from "#pipeline/publish/index.js";
import { createLocalSinkDriver } from "#pipeline/publish/sinks/local/driver.js";
import {
  createLocalSignalingHub,
  type RtcPeerConnectionLike,
  type SinkSignalingChannel
} from "#pipeline/publish/sinks/local/signaling.js";
import { resolveNodePeerConnectionFactory } from "#pipeline/publish/sinks/local/node-peer.js";

/**
 * Media-track delivery — the REAL-TIME path. Two @roamhq/wrtc peers exchange a live video track in one
 * process: the local sink adds an RTCVideoSource track and pushes I420 frames; the consumer receives them
 * through an RTCVideoSink. Proves frames traverse a native RTP media track (not a data channel) end-to-end.
 * Skips cleanly if native wrtc is unavailable (the loopback transport has no media support by design).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Wrtc = any;

const loadWrtc = async (): Promise<Wrtc | undefined> => {
  try {
    const mod = (await import("@roamhq/wrtc")) as { default?: Wrtc };
    return mod.default ?? (mod as Wrtc);
  } catch {
    return undefined;
  }
};

const W = 320;
const H = 240;

const grayI420 = (): Uint8Array => {
  const y = W * H;
  const frame = new Uint8Array((W * H * 3) / 2);
  frame.fill(128, 0, y); // luma mid-gray
  frame.fill(128, y); // chroma neutral
  return frame;
};

const makeI420Item = (sequence: number, data: Uint8Array): SinkDeliveryItem => ({
  kind: "video",
  sinkId: "local-preview",
  trackId: "publish.video.rendered",
  role: "publish.video.rendered",
  sequence,
  epoch: 0,
  mediaTimeMs: sequence * 33,
  wallTimeMs: Date.now(),
  payloadBytes: data.byteLength,
  payload: { data, width: W, height: H, byteFormat: "yuv420p", encoding: "raw", expectedFps: 30 }
});

const gatherIce = (peer: { iceGatheringState: string; localDescription: unknown }): Promise<void> =>
  new Promise((resolve) => {
    const started = Date.now();
    const tick = (): void => {
      if (peer.iceGatheringState === "complete" || Date.now() - started > 3000) {
        resolve();
        return;
      }
      setTimeout(tick, 30);
    };
    tick();
  });

describe("local sink media-track delivery", () => {
  it("streams I420 frames over a WebRTC video track to a consumer", async () => {
    const wrtc = await loadWrtc();
    if (wrtc === undefined) {
      return; // native wrtc absent — media track cannot be exercised in-process
    }
    const { RTCVideoSink } = wrtc.nonstandard as {
      RTCVideoSink: new (track: unknown) => { onframe: ((e: { frame: { width: number; height: number } }) => void) | null; stop: () => void };
    };

    const hub = createLocalSignalingHub();
    const received: { width: number; height: number }[] = [];

    // Consumer peer: answer the sink's offer and collect frames from the inbound track via RTCVideoSink.
    const consumerPeer = new wrtc.RTCPeerConnection({ iceServers: [] });
    let videoSink: { stop: () => void } | undefined;
    consumerPeer.ontrack = (event: { track: unknown }) => {
      const sink = new RTCVideoSink(event.track);
      videoSink = sink;
      sink.onframe = (e) => received.push({ width: e.frame.width, height: e.frame.height });
    };

    const runConsumer = Effect.gen(function* () {
      const offer = yield* hub.consumer.awaitOffer;
      yield* Effect.promise(() => consumerPeer.setRemoteDescription(offer));
      const answer = yield* Effect.promise(() => consumerPeer.createAnswer());
      yield* Effect.promise(() => consumerPeer.setLocalDescription(answer));
      yield* Effect.promise(() => gatherIce(consumerPeer));
      yield* hub.consumer.publishAnswer(consumerPeer.localDescription);
    });

    const program = Effect.scoped(
      Effect.gen(function* () {
        const factory = yield* resolveNodePeerConnectionFactory();
        const driver = createLocalSinkDriver();

        // Consumer must be awaiting the offer before the sink publishes it.
        const consumerFiber = yield* Effect.fork(runConsumer);

        const attachment = yield* driver.attach({
          signaling: hub.sink,
          streamId: "track-test",
          peerConnectionFactory: factory
        });
        yield* Fiber.join(consumerFiber);

        // Push frames until the consumer has received several (tolerating ICE connect latency) or we time out.
        const frame = grayI420();
        for (let i = 0; i < 200 && received.length < 3; i += 1) {
          yield* attachment.deliver(makeI420Item(i, frame));
          yield* Effect.sleep("33 millis");
        }
        yield* attachment.finalize;
      })
    );

    await Effect.runPromise(program);
    videoSink?.stop();
    consumerPeer.close();

    expect(received.length).toBeGreaterThan(0);
    expect(received[0]?.width).toBe(W);
    expect(received[0]?.height).toBe(H);
  }, 20000);

  it("attach publishes the offer and returns without blocking on the viewer's answer", async () => {
    // Regression: a live producer streams continuously and the viewer's WebRTC answer arrives whenever a
    // viewer opens the page. attach must publish the offer and return IMMEDIATELY (applying the answer in a
    // background fiber) so the worker loop can start and hold the run open. If attach blocked on awaitAnswer,
    // nothing would hold the run's scope open before the worker loop and the whole run gets interrupted — the
    // producer's peer closes before any viewer can connect. Here awaitAnswer never resolves, yet attach must
    // still return an attachment that delivers frames.
    const pushedWidths: number[] = [];
    let offerPublished = false;
    const fakeTrack = {
      pushFrame: (frame: { width: number }) => pushedWidths.push(frame.width),
      stop: () => {}
    };
    const fakePeer: RtcPeerConnectionLike = {
      createOffer: () => Promise.resolve({ type: "offer", sdp: "v=0\r\n" }),
      createAnswer: () => Promise.resolve({ type: "answer", sdp: "v=0\r\n" }),
      setLocalDescription: () => Promise.resolve(),
      setRemoteDescription: () => Promise.resolve(),
      localDescriptionWithCandidates: (offer) => Promise.resolve(offer),
      close: () => {},
      ontrack: null,
      addVideoTrack: () => fakeTrack
    };
    const signaling: SinkSignalingChannel = {
      publishOffer: () =>
        Effect.sync(() => {
          offerPublished = true;
        }),
      // The viewer never answers — attach must not hang on this.
      awaitAnswer: Effect.never
    };

    const program = Effect.scoped(
      Effect.gen(function* () {
        const attachment = yield* createLocalSinkDriver().attach({
          signaling,
          streamId: "no-viewer",
          peerConnectionFactory: () => fakePeer
        });
        // attach returned despite no answer — the sink is live and delivers frames immediately.
        yield* attachment.deliver(makeI420Item(0, grayI420()));
        yield* attachment.finalize;
      })
    );

    // A 5s test timeout: if attach blocked on awaitAnswer (Effect.never), this rejects instead of passing.
    await Effect.runPromise(program);
    expect(offerPublished).toBe(true);
    expect(pushedWidths).toEqual([W]);
  }, 5000);
});

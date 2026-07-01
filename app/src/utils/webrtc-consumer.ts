import { Effect } from 'effect'
import {
  createHostMediatedConsumerSignaling,
  type RtcPeerConnectionFactory,
  type SignalingFetch,
} from '@livestreak/observe'

import type { StreamFeedDetail, StreamPointer } from '#/utils/stream'

export type WebRtcConsumerStatus = 'idle' | 'connecting' | 'ready' | 'error'

export interface ConsumeHostWebRtcInput {
  readonly baseUrl: string
  readonly streamId: string
  readonly fetch?: SignalingFetch
  readonly peerConnectionFactory?: RtcPeerConnectionFactory
  readonly pollIntervalMs?: number
  readonly offerTimeoutMs?: number
  readonly signal?: AbortSignal
}

export interface ConsumeHostWebRtcResult {
  /** The live inbound `MediaStream` to assign to `<video>.srcObject`. */
  readonly stream: MediaStream
  /** Tear down the peer connection. MUST be called when the viewer is done — a live stream keeps the
   *  peer open to receive media, so (unlike the old blob) it is not self-contained. */
  readonly close: () => void
}

/**
 * True when the stream is LIVE — then we take the realtime WebRTC feed. A `watchUrl` is the recording
 * (the goLive storage pointer / archived blob); it's for REPLAY once the stream has ended, so it must not
 * pre-empt the live feed while the producer is still broadcasting.
 */
export function shouldUseHostWebRtcFeed(
  pointer: StreamPointer | undefined,
  host: StreamFeedDetail | null | undefined,
): boolean {
  return pointer?.status === 'live' || host?.isLive === true
}

/** Sticky-latched WebRTC eligibility, scoped to one streamId. */
export interface WebRtcLatch {
  readonly streamId: string
  readonly enabled: boolean
}

/**
 * Latch step. `eligible` flickers with the ~3s board poll; this HOLDS `enabled` true across transient
 * drops so an in-flight MP4 transfer is never aborted. Releases only when the pointer reports `ended`;
 * a new `streamId` re-evaluates from scratch. Returns `prev` unchanged when nothing moved (no re-render).
 */
export function nextWebRtcLatch(
  prev: WebRtcLatch,
  streamId: string,
  eligible: boolean,
  ended: boolean,
): WebRtcLatch {
  const fresh = prev.streamId !== streamId
  const enabled = ended ? false : fresh ? eligible : prev.enabled || eligible
  return !fresh && enabled === prev.enabled ? prev : { streamId, enabled }
}

/**
 * Derived `enabled` the consumer sees: the latched value for THIS stream, OR live eligibility right now.
 * The live clause keeps go-live instant (no extra-render lag); the streamId guard stops a stale latch from
 * a previous market leaking into a freshly navigated stream; `ended` releases immediately (no render lag).
 */
export function resolveWebRtcEnabled(
  latch: WebRtcLatch,
  streamId: string,
  eligible: boolean,
  ended: boolean,
): boolean {
  return !ended && ((latch.streamId === streamId && latch.enabled) || eligible)
}

/**
 * Host-mediated browser consumer: poll the relay for the producer's offer, answer it, and surface the live
 * inbound video track as a `MediaStream` for `<video>.srcObject`. This is real-time — frames render as they
 * arrive over the RTP media track; there is no file to assemble. The peer stays OPEN to keep receiving media
 * (the caller closes it via the returned `close`).
 */
export async function consumeHostWebRtcFeed(
  input: ConsumeHostWebRtcInput,
): Promise<ConsumeHostWebRtcResult> {
  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  // A unique id for THIS viewer — the producer serves many viewers, minting a dedicated offer/peer per id.
  const viewerId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `v-${Math.random().toString(36).slice(2)}`

  const signaling = createHostMediatedConsumerSignaling({
    baseUrl: input.baseUrl,
    streamId: input.streamId,
    viewerId,
    fetch: input.fetch,
    pollIntervalMs: input.pollIntervalMs,
    offerTimeoutMs: input.offerTimeoutMs,
  })

  const abortPromise = input.signal
    ? new Promise<never>((_, reject) => {
        const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
        if (input.signal!.aborted) {
          onAbort()
          return
        }
        input.signal!.addEventListener('abort', onAbort, { once: true })
      })
    : null

  let peer: ReturnType<RtcPeerConnectionFactory> | undefined

  try {
    // Announce this viewer so the producer's accept loop mints a dedicated offer for us.
    await Promise.race([
      Effect.runPromise(signaling.register),
      ...(abortPromise ? [abortPromise] : []),
    ])
    const offer = await Promise.race([
      Effect.runPromise(signaling.awaitOffer),
      ...(abortPromise ? [abortPromise] : []),
    ])

    const factory = input.peerConnectionFactory ?? resolveBrowserPeerFactory()
    peer = factory()

    let resolveStream!: (stream: MediaStream) => void
    const streamReady = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve
    })
    // The inbound video track arrives as the remote description is applied. Prefer the sender's stream;
    // fall back to a fresh MediaStream around the raw track (the producer adds the track without a stream).
    peer.ontrack = (event) => {
      const provided = event.streams[0] as MediaStream | undefined
      const stream = provided ?? new MediaStream([event.track as MediaStreamTrack])
      resolveStream(stream)
    }

    await peer.setRemoteDescription(offer)
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    // Non-trickle ICE: publish the answer WITH its gathered candidates (the relay carries only the SDP, so
    // the producer never learns our address otherwise and media never flows).
    const localAnswer = await peer.localDescriptionWithCandidates(answer)
    await Promise.race([
      Effect.runPromise(signaling.publishAnswer(localAnswer)),
      ...(abortPromise ? [abortPromise] : []),
    ])

    const stream = await Promise.race([
      streamReady,
      ...(abortPromise ? [abortPromise] : []),
    ])

    const activePeer = peer
    return { stream, close: () => activePeer.close() }
  } catch (error) {
    peer?.close()
    throw error
  }
}

const resolveBrowserPeerFactory = (): RtcPeerConnectionFactory => {
  const Ctor = (globalThis as { RTCPeerConnection?: new (config?: RTCConfiguration) => RTCPeerConnection })
    .RTCPeerConnection
  if (Ctor === undefined) {
    throw new Error('consumeHostWebRtcFeed requires RTCPeerConnection or peerConnectionFactory')
  }
  // The native peer is structurally an RtcPeerConnectionLike; wrap it to add the non-trickle gather step —
  // wait for ICE gathering, then return the candidate-rich local description so the answer carries them.
  // STUN (symmetric with the producer) yields a server-reflexive candidate; without it the browser offers
  // only an mDNS-obfuscated host candidate (`<uuid>.local`) the non-browser producer cannot resolve. Across
  // real networks/NAT a TURN relay is still required for the strict-NAT minority.
  // ICE servers are build-time overridable (VITE_LIVESTREAK_ICE_SERVERS = JSON
  // array) so the viewer can use a TURN relay for a Dockerized/remote producer.
  const iceServers: RTCIceServer[] = (() => {
    const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_LIVESTREAK_ICE_SERVERS
    if (raw !== undefined && raw.trim() !== '') {
      try {
        return JSON.parse(raw) as RTCIceServer[]
      } catch {
        /* malformed → STUN default */
      }
    }
    return [{ urls: 'stun:stun.l.google.com:19302' }]
  })()
  return () => {
    const relayOnly = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_LIVESTREAK_ICE_RELAY_ONLY === '1'
    const peer = new Ctor(relayOnly ? { iceServers, iceTransportPolicy: 'relay' } : { iceServers })
    const like = peer as unknown as ReturnType<RtcPeerConnectionFactory>
    like.localDescriptionWithCandidates = async (fallback) => {
      const deadline = Date.now() + 3000
      while (peer.iceGatheringState !== 'complete' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return (peer.localDescription as unknown as typeof fallback) ?? fallback
    }
    return like
  }
}

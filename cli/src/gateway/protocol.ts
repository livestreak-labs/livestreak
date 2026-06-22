// Leg-A (gateway ⇄ host) message protocol for the Remote Bridge Console.
//
// ONE shared protocol with the host lane (agent-1). Shapes proposed in audit/scope-cli-gateway.md
// (G-WSS) and filed for host ratification — keep this file in sync with the host's relay router.
// JSON, `type`-tagged. The seed NEVER appears in any frame (asserted in the WSS client + tests).

import type { CapabilityScope, CallActionEnvelope } from "@livestreak/schema";

// ── gateway → host ───────────────────────────────────────────────────────────
export interface RegisterFrame {
  readonly type: "register";
  readonly sessionId: string;
  readonly scopes: readonly CapabilityScope[];
  readonly ttlMs: number;
  readonly spendCapUSDC?: string; // atomic 6dp string, optional
}

export interface RevokeFrame {
  readonly type: "revoke";
  readonly sessionId: string;
}

export interface CallResultFrame {
  readonly type: "call_result";
  readonly callId: string;
  readonly sessionId: string;
  readonly ok: boolean;
  readonly result?: { readonly txId?: string; readonly tokenId?: string };
  readonly error?: string;
}

export interface BoardPatchFrame {
  readonly type: "board_patch";
  readonly sessionId: string;
  readonly board: unknown; // OptionsBoard projection
}

export type GatewayFrame = RegisterFrame | RevokeFrame | CallResultFrame | BoardPatchFrame;

// ── host → gateway ───────────────────────────────────────────────────────────
export interface AckFrame {
  readonly type: "ack";
  readonly sessionId: string;
  readonly remoteUrl?: string;
}

export interface CallFrame {
  readonly type: "call";
  readonly callId: string;
  readonly sessionId: string;
  readonly envelope: CallActionEnvelope;
}

export interface SessionClosedFrame {
  readonly type: "session_closed";
  readonly sessionId: string;
  readonly reason: "ttl_expired" | "revoked" | "ui_disconnect";
}

export type HostFrame = AckFrame | CallFrame | SessionClosedFrame;

export const isHostFrame = (value: unknown): value is HostFrame => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const t = (value as { type?: unknown }).type;
  return t === "ack" || t === "call" || t === "session_closed";
};

import {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  type CapabilityGrant,
  type CapabilityScope
} from "@livestreak/schema";

// --- Remote Bridge Console wire protocol (P4) ---
//
// ONE leg-A protocol is shared with the cli gateway lane (agent-2). Shapes are
// `type`-tagged JSON, aligned with `audit/scope-cli-gateway.md` (register / revoke
// / call_result / board_patch ⇄ ack / call / session_closed), extended with the
// `passwordVerifier` + `gatewayToken` the host needs for admission + leg-A auth.
//
// Leg B (UI ⇄ host) is the host's to define; the app (P5) implements the peer.

// ---- leg A: gateway -> host ----
export interface GwRegisterMsg {
  readonly type: "register";
  readonly sessionId: string;
  readonly scopes: readonly CapabilityScope[];
  readonly ttlMs: number;
  readonly passwordVerifier: string;
  readonly gatewayToken?: string;
}

export interface GwCallResultMsg {
  readonly type: "call_result";
  readonly callId: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { readonly code?: string | number; readonly message: string };
}

export interface GwBoardPatchMsg {
  readonly type: "board_patch";
  readonly sessionId: string;
  readonly target?: string;
  readonly board: unknown;
}

export interface GwRevokeMsg {
  readonly type: "revoke";
  readonly sessionId: string;
}

export type GatewayMessage = GwRegisterMsg | GwCallResultMsg | GwBoardPatchMsg | GwRevokeMsg;

// ---- leg A: host -> gateway ----
export interface HostAckMsg {
  readonly type: "ack";
  readonly sessionId: string;
  readonly remoteUrl: string;
}
export interface HostCallMsg {
  readonly type: "call";
  readonly callId: string;
  readonly sessionId: string;
  readonly target?: string;
  readonly envelope: unknown;
}
export interface HostSessionClosedMsg {
  readonly type: "session_closed";
  readonly sessionId: string;
  readonly reason: "ttl_expired" | "revoked" | "gateway_down";
}

// ---- leg B: UI -> host ----
export interface UiHelloMsg {
  readonly type: "ui.hello";
  readonly sessionId: string;
  readonly grant: CapabilityGrant;
  readonly seq: number;
}
export interface UiCallMsg {
  readonly type: "call";
  readonly callId: string;
  readonly seq: number;
  readonly nonce: string;
  readonly target?: string;
  readonly envelope: { readonly scope?: string; readonly action?: string; readonly args?: unknown };
}
export type UiMessage = UiHelloMsg | UiCallMsg;

// ---- leg B: host -> UI ----
export interface UiReadyMsg {
  readonly type: "ready";
  readonly sessionId: string;
}
export interface UiErrorMsg {
  readonly type: "error";
  readonly code: number;
  readonly message: string;
}
export interface UiRevokedMsg {
  readonly type: "revoked";
}

export const parseJson = (raw: unknown): Record<string, unknown> | null => {
  // Already a decoded object (in-process callers / tests) — pass through.
  if (raw !== null && typeof raw === "object" && !Buffer.isBuffer(raw) && !ArrayBuffer.isView(raw)) {
    return raw as Record<string, unknown>;
  }
  try {
    const text = typeof raw === "string" ? raw : decodeBytes(raw);
    if (text === null) {
      return null;
    }
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const decodeBytes = (raw: unknown): string | null => {
  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8");
  }
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8");
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }
  return null;
};

// The host re-derives the required scope from the call type — it NEVER trusts the
// UI's self-asserted `envelope.scope`. v0 is coarse (per scope-host B.5): every
// action write requires `bridge:action`; board reads/subscribes their scopes.
// Per-action granularity lands with P1's functions[] (tracked, not this pass).
export const requiredScopeForCall = (msg: UiCallMsg): CapabilityScope => {
  const action = msg.envelope.action ?? "";
  if (action === "board" || action === "read") {
    return bridgeBoardReadScope;
  }
  if (action === "subscribe") {
    return bridgeBoardSubscribeScope;
  }
  return bridgeActionScope;
};

// --- exports ---

import type { PointerScheme } from "@livestreak/host";

export type OptionsStreamStatus = "none" | "live" | "ended";

export interface OptionsStreamState {
  readonly status: OptionsStreamStatus;
  readonly scheme: PointerScheme;
  readonly id: string;
  readonly updatedAtMs: number;
  readonly endedAtMs: number;
}

export interface OptionsStreamMedia {
  readonly status: OptionsStreamStatus;
  readonly vodUrl?: string;
}

export type GatewayOverrides = Partial<Record<PointerScheme, string>>;

export const SCHEME_GATEWAY: Record<PointerScheme, string> = {
  "walrus-testnet": "https://aggregator.walrus-testnet.walrus.space/v1/blobs/",
  "walrus-mainnet": "https://aggregator.walrus-mainnet.walrus.space/v1/blobs/",
  ipfs: "https://ipfs.io/ipfs/",
  arweave: "https://arweave.net/"
};

export const resolveStreamMedia = (
  state: OptionsStreamState,
  gatewayOverrides?: GatewayOverrides
): OptionsStreamMedia => {
  if (state.status === "ended") {
    const base = gatewayOverrides?.[state.scheme] ?? SCHEME_GATEWAY[state.scheme];
    return {
      status: "ended",
      vodUrl: `${base}${state.id}`
    };
  }

  if (state.status === "live") {
    return { status: "live" };
  }

  return { status: "none" };
};

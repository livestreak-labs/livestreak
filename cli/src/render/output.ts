import type { OnChainStreamState } from "../edges/market.js";

export interface ProduceRenderInput {
  readonly title: string;
  readonly marketId: `0x${string}`;
  readonly streamId: `0x${string}`;
  readonly vodUrl: string;
  readonly goLiveTx: string;
  readonly setEndedTx: string;
  readonly streamState: OnChainStreamState;
  readonly mp4Path: string;
}

export const formatMarketId = (marketId: string): string => marketId;

export const formatStreamState = (state: OnChainStreamState): string =>
  JSON.stringify(
    {
      status: state.status,
      scheme: state.scheme,
      id: state.id,
      updatedAt: state.updatedAt.toString(),
      endedAt: state.endedAt.toString()
    },
    null,
    2
  );

export const renderProduceResult = (input: ProduceRenderInput): string => {
  const lines = [
    "livestreak produce — complete",
    "",
    `title:      ${input.title}`,
    `marketId:   ${formatMarketId(input.marketId)}`,
    `streamId:   ${input.streamId}`,
    `mp4:        ${input.mp4Path}`,
    `vodUrl:     ${input.vodUrl}`,
    `goLiveTx:   ${input.goLiveTx}`,
    `setEndedTx: ${input.setEndedTx}`,
    "",
    "streamState:",
    formatStreamState(input.streamState)
  ];

  return lines.join("\n");
};

export const renderHostHealth = (input: {
  readonly baseUrl: string;
  readonly healthy: boolean;
  readonly walrusNetwork: string | null;
}): string =>
  [
    "livestreak host",
    "",
    `url:     ${input.baseUrl}`,
    `health:  ${input.healthy ? "ok" : "degraded"}`,
    `walrus:  ${input.walrusNetwork ?? "not configured"}`
  ].join("\n");

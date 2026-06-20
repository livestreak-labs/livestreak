import { Schema } from "effect";
import { MemoryNetwork, MemoryTrustModel } from "./descriptor.js";

// --- exports ---

export const MemoryAccessRequest = Schema.Struct({
  marketId: Schema.NonEmptyString,
  suiDelegate: Schema.NonEmptyString
});

export type MemoryAccessRequest = Schema.Schema.Type<typeof MemoryAccessRequest>;

export const MemoryAccessResponse = Schema.Struct({
  relayerUrl: Schema.NonEmptyString,
  namespace: Schema.NonEmptyString,
  accountId: Schema.NonEmptyString
});

export type MemoryAccessResponse = Schema.Schema.Type<typeof MemoryAccessResponse>;

export const MarketMemoryBinding = Schema.Struct({
  marketId: Schema.NonEmptyString,
  memWalAccountId: Schema.NonEmptyString,
  namespace: Schema.NonEmptyString
});

export type MarketMemoryBinding = Schema.Schema.Type<typeof MarketMemoryBinding>;

export { MemoryNetwork, MemoryTrustModel };

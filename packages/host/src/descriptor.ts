import { OutputMode } from "@livestreak/schema";
import { Schema } from "effect";

// --- exports ---

export { OutputMode, type OutputMode as HostOutputMode } from "@livestreak/schema";

export const HostModuleToken = Schema.Literal(
  "aa",
  "media",
  "memory",
  "discovery",
  "runtime",
  "tenancy"
);

export type HostModuleToken = Schema.Schema.Type<typeof HostModuleToken>;

export const MemoryTrustModel = Schema.Literal(
  "plaintext-relayer",
  "client-encrypted",
  "tee-attested"
);

export type MemoryTrustModel = Schema.Schema.Type<typeof MemoryTrustModel>;

export const MemoryNetwork = Schema.Literal("mainnet", "testnet");

export type MemoryNetwork = Schema.Schema.Type<typeof MemoryNetwork>;

export const MemoryDescriptorAdvert = Schema.Struct({
  relayerUrl: Schema.Union(Schema.Null, Schema.NonEmptyString),
  namespaceTemplate: Schema.Literal("market:{marketId}"),
  trustModel: MemoryTrustModel,
  network: Schema.Union(MemoryNetwork, Schema.Null)
});

export type MemoryDescriptorAdvert = Schema.Schema.Type<typeof MemoryDescriptorAdvert>;

export const MediaDescriptorAdvert = Schema.Struct({
  simulcastAvailable: Schema.Boolean
});

export type MediaDescriptorAdvert = Schema.Schema.Type<typeof MediaDescriptorAdvert>;

export const HostProviderDescriptor = Schema.Struct({
  version: Schema.Literal("0.1.0"),
  hostId: Schema.NonEmptyString,
  baseUrl: Schema.NonEmptyString,
  modules: Schema.Array(HostModuleToken),
  supportedOutputs: Schema.Array(OutputMode),
  media: MediaDescriptorAdvert,
  memory: MemoryDescriptorAdvert,
  termsVersion: Schema.optional(Schema.NonEmptyString)
});

export type HostProviderDescriptor = Schema.Schema.Type<typeof HostProviderDescriptor>;

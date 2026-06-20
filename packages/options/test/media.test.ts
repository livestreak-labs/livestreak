import { describe, expect, it } from "vitest";

import { asMarketId } from "../src/model/ids.js";
import {
  resolveStreamMedia,
  SCHEME_GATEWAY,
  type OptionsStreamState
} from "../src/model/media.js";
import { getStreamMedia } from "../src/read/media.js";
import { createFakeOptionsReadTransport } from "./helpers/fake-transport.js";

const marketId = asMarketId("market_01");
const blobId = "blob_test_id";

const streamState = (
  status: OptionsStreamState["status"],
  scheme: OptionsStreamState["scheme"],
  id = blobId
): OptionsStreamState => ({
  status,
  scheme,
  id,
  updatedAtMs: 1_700_000_000_000,
  endedAtMs: status === "ended" ? 1_700_001_000_000 : 0
});

describe("resolveStreamMedia", () => {
  it("returns ended vodUrl with walrus-testnet gateway for scheme 0", () => {
    const media = resolveStreamMedia(streamState("ended", "walrus-testnet"));

    expect(media).toEqual({
      status: "ended",
      vodUrl: "https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob_test_id"
    });
  });

  it("returns live without vodUrl", () => {
    expect(resolveStreamMedia(streamState("live", "walrus-testnet"))).toEqual({
      status: "live"
    });
  });

  it("returns none without vodUrl", () => {
    expect(resolveStreamMedia(streamState("none", "walrus-testnet"))).toEqual({
      status: "none"
    });
  });

  it("maps each storage scheme to the expected gateway base", () => {
    expect(SCHEME_GATEWAY["walrus-testnet"]).toBe(
      "https://aggregator.walrus-testnet.walrus.space/v1/blobs/"
    );
    expect(SCHEME_GATEWAY["walrus-mainnet"]).toBe(
      "https://aggregator.walrus-mainnet.walrus.space/v1/blobs/"
    );
    expect(SCHEME_GATEWAY.ipfs).toBe("https://ipfs.io/ipfs/");
    expect(SCHEME_GATEWAY.arweave).toBe("https://arweave.net/");

    const endedWalrusMainnet = resolveStreamMedia(streamState("ended", "walrus-mainnet", "main-blob"));
    expect(endedWalrusMainnet.vodUrl).toBe(
      "https://aggregator.walrus-mainnet.walrus.space/v1/blobs/main-blob"
    );

    const endedIpfs = resolveStreamMedia(streamState("ended", "ipfs", "QmExample"));
    expect(endedIpfs.vodUrl).toBe("https://ipfs.io/ipfs/QmExample");

    const endedArweave = resolveStreamMedia(streamState("ended", "arweave", "tx-id"));
    expect(endedArweave.vodUrl).toBe("https://arweave.net/tx-id");
  });

  it("uses gatewayOverrides instead of the default base", () => {
    const media = resolveStreamMedia(streamState("ended", "ipfs"), {
      ipfs: "https://custom.gateway/ipfs/"
    });

    expect(media.vodUrl).toBe("https://custom.gateway/ipfs/blob_test_id");
  });
});

describe("getStreamMedia", () => {
  it("reads stream state from transport then resolves media", async () => {
    const transport = createFakeOptionsReadTransport({
      streamStates: {
        market_01: streamState("ended", "walrus-testnet")
      }
    });

    const media = await getStreamMedia(transport, marketId);

    expect(media.status).toBe("ended");
    expect(media.vodUrl).toBe(
      "https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob_test_id"
    );
  });
});

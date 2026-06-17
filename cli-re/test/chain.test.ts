import { describe, expect, it } from "vitest";
import {
  anvilPlanPayload,
  anvilShellPayload,
  chainShellPayload
} from "../src/chain.js";

describe("chain Anvil CLI scaffold", () => {
  it("exposes chain and anvil command surfaces", () => {
    expect(chainShellPayload().commands).toContain(
      "chain anvil config [--chain-id <id>] [--rpc-url <url>] [--fork-url <url>]"
    );
    expect(anvilShellPayload().commands).toEqual(["config", "deploy", "status"]);
  });

  it("prints config plans without starting Anvil or writing files", () => {
    const payload = anvilPlanPayload("config", {
      chainId: 31_337,
      rpcUrl: "http://127.0.0.1:8545",
      forkUrl: "https://example.invalid/rpc"
    });

    expect(payload.command).toBe("chain anvil config");
    expect(payload.localNetwork).toMatchObject({
      kind: "anvil",
      chainId: 31_337,
      rpcUrl: "http://127.0.0.1:8545",
      forkUrl: "https://example.invalid/rpc"
    });
    expect(payload.process).toMatchObject({
      expectedExternal: true,
      startedByCli: false,
      stoppedByCli: false,
      pid: null
    });
    expect(payload.config).toMatchObject({
      writesFiles: false
    });
  });

  it("prints deploy plans without fabricating deployments", () => {
    const payload = anvilPlanPayload("deploy", {});

    expect(payload.command).toBe("chain anvil deploy");
    expect(payload.localNetwork.chainId).toBe(31_337);
    expect(payload.probing.attempted).toBe(false);
    expect(payload.deployment).toMatchObject({
      attempted: false,
      metadataOwner: "contracts-re",
      artifactOwner: "contracts-re",
      writesDeploymentMetadata: false
    });
  });

  it("prints status plans without probing RPC health", () => {
    const payload = anvilPlanPayload("status", {});

    expect(payload.command).toBe("chain anvil status");
    expect(payload.probing.attempted).toBe(false);
    expect(payload.status).toBe("scaffold");
    expect(payload.anvilStatus).toMatchObject({
      chainReachable: null,
      blockNumber: null,
      contractsDeployed: null
    });
  });
});

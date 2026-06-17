import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  protocolPlanPayload,
  protocolPreviewPayload,
  protocolShellPayload,
  type ProtocolFamily
} from "../src/protocol.js";

const addresses = {
  vault: "0x0000000000000000000000000000000000000001",
  flowToken: "0x0000000000000000000000000000000000000002",
  agentRegistry: "0x0000000000000000000000000000000000000003",
  steward: "0x0000000000000000000000000000000000000005"
} as const;

const vaultId = `0x${"a".repeat(64)}`;

describe("protocol descriptor preview CLI scaffold", () => {
  it("exposes plan commands for each protocol family", () => {
    for (const family of ["vault", "flow", "bookmaker", "steward"] as const) {
      const payload = protocolShellPayload(family);

      expect(payload.command).toBe(family);
      expect(payload.commands[0]).toContain(`${family} plan`);
      expect(payload.message).toContain("sdk-options owns live protocol IO");
    }
  });

  it.each([
    ["vault", "create", "Vault", "createVault"],
    ["flow", "balance", "FlowToken", "balanceOf"],
    ["bookmaker", "register", "AgentRegistry", "registerAgent"],
    ["steward", "propose", "Steward", "propose"]
  ] as const)(
    "builds a schema-shaped %s descriptor preview for %s",
    (family, operation, contractName, functionName) => {
      const payload = protocolPreviewPayload(family, {
        operation,
        chainId: 31_337,
        addressBook: "local-anvil"
      });

      expect(payload).toMatchObject({
        ok: true,
        command: `${family} plan`,
        status: "preview",
        acceptedArgs: {
          operation,
          chainId: 31_337,
          addressBook: "local-anvil"
        },
        descriptorPlan: {
          source: "scaffold",
          liveIoOwner: "sdk-options",
          planner: "makeProtocolActionPlanner",
          descriptorPlanner: "makeProtocolCallPlanner",
          protocolClient: "makeProtocolClient",
          contractName,
          functionName
        },
        liveIo: {
          attempted: false,
          transactionSent: false,
          readPerformed: false
        }
      });
    }
  );

  it("does not duplicate ABI fragments in preview payloads", () => {
    const payload = protocolPreviewPayload("vault", {
      operation: "stream"
    });
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain("\"inputs\"");
    expect(serialized).not.toContain("\"outputs\"");
    expect(serialized).not.toContain("\"components\"");
    expect(serialized).not.toContain("\"events\"");
  });

  it("rejects operations outside the selected family", () => {
    const payload = protocolPreviewPayload("flow", {
      operation: "propose"
    });

    expect(payload).toMatchObject({
      ok: false,
      command: "flow plan",
      status: "invalid"
    });
    expect(JSON.stringify(payload)).toContain(
      "flow plan accepts --operation balance|stake|unstake|claim-dividends|pending-rewards."
    );
  });

  it("uses sensible family defaults", () => {
    const expected: Record<ProtocolFamily, string> = {
      vault: "createVault",
      flow: "balanceOf",
      bookmaker: "registerAgent",
      steward: "propose"
    };

    for (const family of Object.keys(expected) as ProtocolFamily[]) {
      const payload = protocolPreviewPayload(family, {});

      expect(payload.ok).toBe(true);
      if (payload.ok) {
        expect(payload.descriptorPlan.functionName).toBe(expected[family]);
      }
    }
  });

  it.each([
    [
      "vault",
      {
        operation: "create",
        chainId: 31_337,
        vaultAddress: addresses.vault,
        option: "Launch ships this week",
        optionType: "momentum",
        durationSeconds: "3600",
        stake: "100",
        side: "yes"
      },
      {
        contractName: "Vault",
        address: addresses.vault,
        functionName: "createVault",
        args: ["Launch ships this week", 0, "3600", "100", true]
      }
    ],
    [
      "flow",
      {
        operation: "balance",
        addressBook: JSON.stringify({
          chainId: 31_337,
          contracts: {
            FlowToken: addresses.flowToken
          }
        }),
        account: "0x0000000000000000000000000000000000000099"
      },
      {
        contractName: "FlowToken",
        address: addresses.flowToken,
        functionName: "balanceOf",
        args: ["0x0000000000000000000000000000000000000099"]
      }
    ],
    [
      "bookmaker",
      {
        operation: "register",
        chainId: 31_337,
        agentRegistryAddress: addresses.agentRegistry,
        name: "Bookie",
        agentType: "bookmaker"
      },
      {
        contractName: "AgentRegistry",
        address: addresses.agentRegistry,
        functionName: "registerAgent",
        args: ["Bookie", 0]
      }
    ],
    [
      "steward",
      {
        operation: "propose",
        chainId: 31_337,
        stewardAddress: addresses.steward,
        vaultId,
        actionType: "boost",
        data: "0x1234",
        flowStake: "50"
      },
      {
        contractName: "Steward",
        address: addresses.steward,
        functionName: "propose",
        args: [vaultId, 0, "0x1234", "50"]
      }
    ]
  ] as const)(
    "plans an actual %s descriptor through sdk-options",
    async (family, options, expected) => {
      const payload = await Effect.runPromise(protocolPlanPayload(family, options));

      expect(payload).toMatchObject({
        ok: true,
        command: `${family} plan`,
        status: "planned",
        descriptor: expected,
        liveIo: {
          attempted: false,
          transactionSent: false,
          readPerformed: false,
          calldataEncoded: false
        }
      });
      expect(JSON.stringify(payload)).not.toContain("\"inputs\"");
      expect(JSON.stringify(payload)).not.toContain("\"outputs\"");
    }
  );

  it("returns a typed missing-address error for complete params without a configured contract", async () => {
    const payload = await Effect.runPromise(
      protocolPlanPayload("vault", {
        operation: "create",
        chainId: 31_337,
        option: "Launch ships this week",
        optionType: "momentum",
        durationSeconds: "3600",
        stake: "100",
        side: "yes"
      })
    );

    expect(payload).toMatchObject({
      ok: false,
      command: "vault plan",
      status: "invalid",
      error: {
        tag: "FlowStreamConfigError",
        message: "Missing configured address for Vault",
        retryable: false
      }
    });
  });
});

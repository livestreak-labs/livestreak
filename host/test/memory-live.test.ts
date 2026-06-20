import { describe, expect, it } from "vitest";
import { MemWal } from "@mysten-incubation/memwal";
import {
  createAccount,
  addDelegateKey,
  generateDelegateKey
} from "@mysten-incubation/memwal/account";
import { fetchRelayerDeploymentConfig } from "#memory/relayer-config.js";

const liveEnabled = process.env.MEMWAL_LIVE === "1";
const ownerKey = process.env.LIVESTREAK_MEMORY_SUI_OWNER_KEY;
const registryId = process.env.LIVESTREAK_MEMORY_REGISTRY_ID;

describe.skipIf(!liveEnabled || ownerKey === undefined || registryId === undefined)(
  "memory live integration",
  () => {
    it("provisions, grants, remembers, and recalls via the hosted relayer", async () => {
      const relayerUrl = process.env.LIVESTREAK_MEMORY_RELAYER_URL ?? "https://relayer.memwal.ai";
      const deployment = await fetchRelayerDeploymentConfig(relayerUrl);
      const delegate = await generateDelegateKey();
      const namespace = `livestreak-host-m1-${Date.now()}`;

      const created = await createAccount({
        packageId: deployment.packageId,
        registryId: registryId!,
        suiPrivateKey: ownerKey!,
        suiNetwork: deployment.network
      });

      expect(created.accountId.length).toBeGreaterThan(0);

      await addDelegateKey({
        packageId: deployment.packageId,
        accountId: created.accountId,
        publicKey: delegate.publicKey,
        label: "livestreak-host-m1",
        suiPrivateKey: ownerKey!,
        suiNetwork: deployment.network
      });

      const memwal = MemWal.create({
        key: delegate.privateKey,
        accountId: created.accountId,
        serverUrl: relayerUrl,
        namespace
      });

      const remembered = await memwal.rememberAndWait(
        "Flowstream host memory-live integration marker",
        namespace,
        { timeoutMs: 120_000 }
      );

      expect(remembered.namespace).toBe(namespace);

      const recalled = await memwal.recall({
        query: "Flowstream host memory-live integration marker",
        namespace,
        limit: 3
      });

      expect(recalled.results.length).toBeGreaterThan(0);
      expect(recalled.results[0]?.text).toContain("Flowstream host memory-live");
    });
  }
);

// --- exports ---

export interface RelayerDeploymentConfig {
  readonly packageId: string;
  readonly network: "testnet" | "mainnet";
  readonly suiRpcUrl: string;
}

export const fetchRelayerDeploymentConfig = async (
  serverUrl: string
): Promise<RelayerDeploymentConfig> => {
  const base = serverUrl.replace(/\/$/u, "");
  const response = await fetch(`${base}/config`);

  if (!response.ok) {
    throw new Error(`MemWal relayer config fetch failed (${response.status})`);
  }

  const body = (await response.json()) as {
    packageId?: string;
    network?: string;
    suiRpcUrl?: string;
  };

  if (
    body.packageId === undefined ||
    body.network === undefined ||
    body.suiRpcUrl === undefined
  ) {
    throw new Error("MemWal relayer /config missing packageId, network, or suiRpcUrl");
  }

  if (body.network !== "testnet" && body.network !== "mainnet") {
    throw new Error(`Unsupported MemWal relayer network: ${body.network}`);
  }

  return {
    packageId: body.packageId,
    network: body.network,
    suiRpcUrl: body.suiRpcUrl
  };
};

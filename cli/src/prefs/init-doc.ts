import { readFile, writeFile } from "node:fs/promises";
import type { WalrusNetwork } from "@livestreak/host";
import type { EvmWalletInitConfig } from "@livestreak/schema";

export interface LivestreakChainConfig {
  readonly rpc: string;
  readonly marketRegistry: `0x${string}`;
  readonly chainId: number;
}

export interface LivestreakHostConfig {
  readonly url: string;
  readonly walrusNetwork: WalrusNetwork;
}

export interface LivestreakWalletConfig {
  readonly config: EvmWalletInitConfig;
}

export interface LivestreakRunCache {
  readonly runId: string;
  readonly streamId?: `0x${string}`;
  readonly marketId?: `0x${string}`;
  readonly status?: "pending" | "registered" | "ended" | "failed";
}

export interface LivestreakInitDoc {
  readonly chain: LivestreakChainConfig;
  readonly host: LivestreakHostConfig;
  readonly wallet: LivestreakWalletConfig;
  readonly run?: LivestreakRunCache;
}

const FORBIDDEN_SERIALIZED_KEYS = ["seed", "seedHex", "password", "mnemonic", "secret"] as const;

export const defaultInitDocPath = "livestreak.json";

export const loadInitDoc = async (path: string = defaultInitDocPath): Promise<LivestreakInitDoc> => {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return validateInitDoc(parsed);
};

export const saveInitDoc = async (
  path: string,
  doc: LivestreakInitDoc
): Promise<void> => {
  const serialized = JSON.stringify(doc, null, 2);
  for (const key of FORBIDDEN_SERIALIZED_KEYS) {
    if (serialized.includes(`"${key}"`)) {
      throw new Error(`Refusing to persist forbidden key "${key}" in init doc`);
    }
  }

  await writeFile(path, `${serialized}\n`, "utf8");
};

export const validateInitDoc = (input: unknown): LivestreakInitDoc => {
  if (typeof input !== "object" || input === null) {
    throw new Error("livestreak.json must be an object");
  }

  const record = input as Record<string, unknown>;
  assertNoForbiddenKeys(record);

  const chain = readChain(record["chain"]);
  const host = readHost(record["host"]);
  const wallet = readWallet(record["wallet"]);
  const run = record["run"] === undefined ? undefined : readRun(record["run"]);

  return { chain, host, wallet, ...(run === undefined ? {} : { run }) };
};

// --- helpers ---

const assertNoForbiddenKeys = (value: unknown, path = "root"): void => {
  if (typeof value !== "object" || value === null) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if ((FORBIDDEN_SERIALIZED_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Forbidden key "${key}" at ${path}`);
    }
    assertNoForbiddenKeys(nested, `${path}.${key}`);
  }
};

const readChain = (value: unknown): LivestreakChainConfig => {
  if (typeof value !== "object" || value === null) {
    throw new Error("chain config required");
  }

  const record = value as Record<string, unknown>;
  const rpc = readNonEmptyString(record["rpc"], "chain.rpc");
  const marketRegistry = readAddress(record["marketRegistry"], "chain.marketRegistry");
  const chainId = readNumber(record["chainId"], "chain.chainId");

  return { rpc, marketRegistry, chainId };
};

const readHost = (value: unknown): LivestreakHostConfig => {
  if (typeof value !== "object" || value === null) {
    throw new Error("host config required");
  }

  const record = value as Record<string, unknown>;
  const url = readNonEmptyString(record["url"], "host.url");
  const walrusNetwork = record["walrusNetwork"];

  if (walrusNetwork !== "testnet" && walrusNetwork !== "mainnet") {
    throw new Error("host.walrusNetwork must be testnet or mainnet");
  }

  return { url, walrusNetwork };
};

const readWallet = (value: unknown): LivestreakWalletConfig => {
  if (typeof value !== "object" || value === null) {
    throw new Error("wallet config required");
  }

  const record = value as Record<string, unknown>;
  const config = record["config"];
  if (typeof config !== "object" || config === null) {
    throw new Error("wallet.config required");
  }

  return { config: config as EvmWalletInitConfig };
};

const readRun = (value: unknown): LivestreakRunCache => {
  if (typeof value !== "object" || value === null) {
    throw new Error("run cache must be an object");
  }

  const record = value as Record<string, unknown>;
  const runId = readNonEmptyString(record["runId"], "run.runId");

  return {
    runId,
    ...(typeof record["streamId"] === "string"
      ? { streamId: record["streamId"] as `0x${string}` }
      : {}),
    ...(typeof record["marketId"] === "string"
      ? { marketId: record["marketId"] as `0x${string}` }
      : {}),
    ...(record["status"] === "pending" ||
    record["status"] === "registered" ||
    record["status"] === "ended" ||
    record["status"] === "failed"
      ? { status: record["status"] }
      : {})
  };
};

const readNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const readAddress = (value: unknown, label: string): `0x${string}` => {
  const text = readNonEmptyString(value, label);
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
    throw new Error(`${label} must be a 0x-prefixed EVM address`);
  }
  return text.toLowerCase() as `0x${string}`;
};

const readNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
};

import { Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

export type AnvilCommand = "config" | "deploy" | "status";

export interface AnvilOptions {
  readonly chainId?: number;
  readonly rpcUrl?: string;
  readonly forkUrl?: string;
}

const defaultAnvil = {
  chainId: 31_337,
  rpcUrl: "http://127.0.0.1:8545"
} as const;

const ownership = {
  cli: "Parses local Anvil command intent and prints plan JSON.",
  sdkOptions:
    "Owns protocol descriptor construction and live protocol IO when a provider/client is bound.",
  contractsRe:
    "Owns contract artifact names, artifact metadata, and deployment metadata.",
  anvil:
    "External developer process; this CLI surface does not start or fake a chain process."
} as const;

const optionValue = <A>(value: Option.Option<A>): A | undefined =>
  Option.match(value, {
    onNone: () => undefined,
    onSome: (item) => item
  });

const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2));

const normalizeRpcUrl = (value: string | undefined): string =>
  value?.trim() ? value.trim() : defaultAnvil.rpcUrl;

const normalizeChainId = (value: number | undefined): number =>
  value !== undefined && Number.isSafeInteger(value) && value > 0
    ? value
    : defaultAnvil.chainId;

export const anvilOptions = {
  chainId: Options.integer("chain-id").pipe(
    Options.optional,
    Options.withDescription("Local Anvil chain id. Defaults to 31337.")
  ),
  rpcUrl: Options.text("rpc-url").pipe(
    Options.optional,
    Options.withDescription("Local Anvil RPC URL. Defaults to http://127.0.0.1:8545.")
  ),
  forkUrl: Options.text("fork-url").pipe(
    Options.optional,
    Options.withDescription("Optional upstream fork URL to include in the config plan.")
  )
};

export const normalizeAnvilOptions = (options: {
  readonly chainId: Option.Option<number>;
  readonly rpcUrl: Option.Option<string>;
  readonly forkUrl: Option.Option<string>;
}): AnvilOptions => ({
  chainId: optionValue(options.chainId),
  rpcUrl: optionValue(options.rpcUrl),
  forkUrl: optionValue(options.forkUrl)
});

export const chainShellPayload = () => ({
  ok: true,
  command: "chain",
  status: "scaffold",
  message:
    "chain exposes local developer-network planning only. It does not start Anvil, deploy contracts, or perform protocol IO.",
  ownership,
  commands: [
    "chain anvil config [--chain-id <id>] [--rpc-url <url>] [--fork-url <url>]",
    "chain anvil deploy [--chain-id <id>] [--rpc-url <url>]",
    "chain anvil status [--chain-id <id>] [--rpc-url <url>]"
  ]
});

export const anvilShellPayload = () => ({
  ok: true,
  command: "chain anvil",
  status: "scaffold",
  message:
    "Local Anvil command surface is plan-only. Start/stop/process management is not implemented here.",
  ownership,
  commands: ["config", "deploy", "status"]
});

export const anvilPlanPayload = (
  command: AnvilCommand,
  options: AnvilOptions
) => {
  const chainId = normalizeChainId(options.chainId);
  const rpcUrl = normalizeRpcUrl(options.rpcUrl);
  const forkUrl = options.forkUrl?.trim() ? options.forkUrl.trim() : undefined;

  return {
    ok: true,
    command: `chain anvil ${command}`,
    status: "scaffold",
    message:
      command === "deploy"
        ? "Anvil deployment is a plan only. contracts-re remains the owner of artifact and deployment metadata."
        : "Anvil command accepted as plan-only local developer-network output.",
    ownership,
    localNetwork: {
      kind: "anvil",
      chainId,
      rpcUrl,
      forkUrl: forkUrl ?? null
    },
    process: {
      expectedExternal: true,
      startedByCli: false,
      stoppedByCli: false,
      pid: null
    },
    probing: {
      attempted: false,
      reason:
        "This command surface is honest scaffolding; it does not probe RPC health or fabricate chain status."
    },
    deployment:
      command === "deploy"
        ? {
            attempted: false,
            metadataOwner: "contracts-re",
            artifactOwner: "contracts-re",
            writesDeploymentMetadata: false,
            nextIntegrationStep:
              "Bind to contracts-re deployment metadata and a real deploy runner before emitting addresses."
          }
        : null,
    config:
      command === "config"
        ? {
            suggestedEnvironment: {
              FLOWSTREAM_CHAIN_ID: String(chainId),
              FLOWSTREAM_RPC_URL: rpcUrl,
              ...(forkUrl === undefined ? {} : { ANVIL_FORK_URL: forkUrl })
            },
            writesFiles: false
          }
        : null,
    anvilStatus:
      command === "status"
        ? {
            chainReachable: null,
            blockNumber: null,
            contractsDeployed: null,
            reason: "No RPC probe is performed by this scaffold."
          }
        : null
  };
};

export const runChainShell = (): Effect.Effect<void> =>
  printJson(chainShellPayload());

export const runAnvilShell = (): Effect.Effect<void> =>
  printJson(anvilShellPayload());

export const runAnvilPlan = (
  command: AnvilCommand,
  options: AnvilOptions
): Effect.Effect<void> => printJson(anvilPlanPayload(command, options));

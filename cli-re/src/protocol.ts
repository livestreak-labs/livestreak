import { readFileSync } from "node:fs";
import { Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { FlowStreamCommandError, FlowStreamConfigError } from "@flowstream-re/core";
import {
  makeProtocolActionPlanner,
  makeProtocolClient,
  type AgentRegistrationType,
  type FlowStreamProtocolConfig,
  type ProtocolContractAddresses,
  type StewardProposalActionType,
  type StewardRegistrationTier,
  type VaultOptionType,
  type VaultResolutionOutcome
} from "@flowstream-re/sdk-options";
import { formatCliError } from "./cli-error.js";

export type ProtocolFamily = "vault" | "flow" | "bookmaker" | "steward";
export type VaultOperation =
  | "create"
  | "stream"
  | "resolve"
  | "finalize"
  | "withdraw"
  | "get-vault"
  | "get-position";
export type FlowOperation =
  | "balance"
  | "stake"
  | "unstake"
  | "claim-dividends"
  | "pending-rewards";
export type BookmakerOperation = "register" | "create-vault" | "stream";
export type StewardOperation =
  | "register"
  | "propose"
  | "challenge"
  | "execute"
  | "veto";

export type ProtocolOperation =
  | VaultOperation
  | FlowOperation
  | BookmakerOperation
  | StewardOperation;

export interface ProtocolPreviewOptions {
  readonly chainId?: number;
  readonly addressBook?: string;
  readonly operation?: string;
}

export interface ProtocolPlanOptions extends ProtocolPreviewOptions {
  readonly vaultAddress?: string;
  readonly flowTokenAddress?: string;
  readonly agentRegistryAddress?: string;
  readonly observerRegistryAddress?: string;
  readonly stewardAddress?: string;
  readonly option?: string;
  readonly optionType?: string;
  readonly durationSeconds?: string;
  readonly stake?: string;
  readonly side?: string;
  readonly vaultId?: string;
  readonly amount?: string;
  readonly outcome?: string;
  readonly proofCid?: string;
  readonly account?: string;
  readonly name?: string;
  readonly agentType?: string;
  readonly tier?: string;
  readonly actionType?: string;
  readonly data?: string;
  readonly flowStake?: string;
  readonly proposalId?: string;
}

type ProtocolDescriptorTarget = {
  readonly contractName: string;
  readonly functionName: string;
};

type PlannerInput =
  | {
      readonly plannerMethod: "createVault";
      readonly addressKey: "Vault";
      readonly fields: readonly (keyof ProtocolPlanOptions)[];
    }
  | {
      readonly plannerMethod: "streamIntoVault";
      readonly addressKey: "Vault";
      readonly fields: readonly (keyof ProtocolPlanOptions)[];
    }
  | {
      readonly plannerMethod: "resolveVault";
      readonly addressKey: "Vault";
      readonly fields: readonly (keyof ProtocolPlanOptions)[];
    }
  | {
      readonly plannerMethod: "finalizeVault" | "withdrawVault";
      readonly addressKey: "Vault";
      readonly fields: readonly (keyof ProtocolPlanOptions)[];
    }
  | {
      readonly plannerMethod: "readFlowBalance" | "readPendingFlowRewards";
      readonly addressKey: "FlowToken";
      readonly fields: readonly (keyof ProtocolPlanOptions)[];
    }
  | {
      readonly plannerMethod: "stakeFlow" | "unstakeFlow";
      readonly addressKey: "FlowToken";
      readonly fields: readonly (keyof ProtocolPlanOptions)[];
    }
  | {
      readonly plannerMethod: "claimFlowRewards";
      readonly addressKey: "FlowToken";
      readonly fields: readonly (keyof ProtocolPlanOptions)[];
    }
  | {
      readonly plannerMethod: "registerAgent";
      readonly addressKey: "AgentRegistry";
      readonly fields: readonly (keyof ProtocolPlanOptions)[];
    }
  | {
      readonly plannerMethod: "registerSteward";
      readonly addressKey: "Steward";
      readonly fields: readonly (keyof ProtocolPlanOptions)[];
    }
  | {
      readonly plannerMethod: "proposeStewardAction";
      readonly addressKey: "Steward";
      readonly fields: readonly (keyof ProtocolPlanOptions)[];
    }
  | {
      readonly plannerMethod: "challengeStewardProposal";
      readonly addressKey: "Steward";
      readonly fields: readonly (keyof ProtocolPlanOptions)[];
    }
  | {
      readonly plannerMethod: "executeStewardProposal" | "vetoStewardProposal";
      readonly addressKey: "Steward";
      readonly fields: readonly (keyof ProtocolPlanOptions)[];
    };

type AddressBookPayload = {
  readonly chainId?: unknown;
  readonly contracts?: unknown;
} & Readonly<Record<string, unknown>>;

const ownership = {
  cli: "Parses preview options and prints schema-shaped descriptor plans only.",
  sdkOptions:
    "Owns ProtocolClient, makeProtocolActionPlanner, makeProtocolCallPlanner, address resolution, ABI lookup, descriptor validation, and live protocol IO.",
  contractsRe:
    "Owns contract artifact names, ABI fragments, events, and deployment metadata."
} as const;

const optionValue = <A>(value: Option.Option<A>): A | undefined =>
  Option.match(value, {
    onNone: () => undefined,
    onSome: (item) => item
  });

const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2));

export const protocolPreviewOptions = {
  operation: Options.text("operation").pipe(
    Options.optional,
    Options.withDescription("Protocol operation to preview. Defaults to the family read/write headline operation.")
  ),
  chainId: Options.integer("chain-id").pipe(
    Options.optional,
    Options.withDescription("Chain id to include in the descriptor preview.")
  ),
  addressBook: Options.text("address-book").pipe(
    Options.optional,
    Options.withDescription("JSON string or JSON file path with { chainId, contracts } for local descriptor planning.")
  ),
  vaultAddress: Options.text("vault-address").pipe(
    Options.optional,
    Options.withDescription("Vault contract address for local descriptor planning.")
  ),
  flowTokenAddress: Options.text("flow-token-address").pipe(
    Options.optional,
    Options.withDescription("FlowToken contract address for local descriptor planning.")
  ),
  agentRegistryAddress: Options.text("agent-registry-address").pipe(
    Options.optional,
    Options.withDescription("AgentRegistry contract address for local descriptor planning.")
  ),
  observerRegistryAddress: Options.text("observer-registry-address").pipe(
    Options.optional,
    Options.withDescription("ObserverRegistry contract address for local descriptor planning.")
  ),
  stewardAddress: Options.text("steward-address").pipe(
    Options.optional,
    Options.withDescription("Steward contract address for local descriptor planning.")
  ),
  option: Options.text("option").pipe(
    Options.optional,
    Options.withDescription("Vault option text for create-vault planning.")
  ),
  optionType: Options.text("option-type").pipe(
    Options.optional,
    Options.withDescription("Vault option type name or numeric value.")
  ),
  durationSeconds: Options.text("duration-seconds").pipe(
    Options.optional,
    Options.withDescription("Vault duration in seconds.")
  ),
  stake: Options.text("stake").pipe(
    Options.optional,
    Options.withDescription("Vault creator stake as a uint256 decimal or hex string.")
  ),
  side: Options.text("side").pipe(
    Options.optional,
    Options.withDescription("Vault side: yes or no.")
  ),
  vaultId: Options.text("vault-id").pipe(
    Options.optional,
    Options.withDescription("Vault bytes32 id.")
  ),
  amount: Options.text("amount").pipe(
    Options.optional,
    Options.withDescription("FLOW or vault amount as a uint256 decimal or hex string.")
  ),
  outcome: Options.text("outcome").pipe(
    Options.optional,
    Options.withDescription("Vault resolution outcome: yes, no, or numeric value.")
  ),
  proofCid: Options.text("proof-cid").pipe(
    Options.optional,
    Options.withDescription("Resolution proof bytes32 id.")
  ),
  account: Options.text("account").pipe(
    Options.optional,
    Options.withDescription("Account address for read descriptor planning.")
  ),
  name: Options.text("name").pipe(
    Options.optional,
    Options.withDescription("Agent or steward display name.")
  ),
  agentType: Options.text("agent-type").pipe(
    Options.optional,
    Options.withDescription("Agent type name or numeric value.")
  ),
  tier: Options.text("tier").pipe(
    Options.optional,
    Options.withDescription("Steward tier name or numeric value.")
  ),
  actionType: Options.text("action-type").pipe(
    Options.optional,
    Options.withDescription("Steward action type name or numeric value.")
  ),
  data: Options.text("data").pipe(
    Options.optional,
    Options.withDescription("Steward proposal data bytes.")
  ),
  flowStake: Options.text("flow-stake").pipe(
    Options.optional,
    Options.withDescription("Steward FLOW stake as a uint256 decimal or hex string.")
  ),
  proposalId: Options.text("proposal-id").pipe(
    Options.optional,
    Options.withDescription("Steward proposal id as a uint256 decimal or hex string.")
  )
};

export const normalizeProtocolPreviewOptions = (options: {
  readonly operation: Option.Option<string>;
  readonly chainId: Option.Option<number>;
  readonly addressBook: Option.Option<string>;
  readonly vaultAddress: Option.Option<string>;
  readonly flowTokenAddress: Option.Option<string>;
  readonly agentRegistryAddress: Option.Option<string>;
  readonly observerRegistryAddress: Option.Option<string>;
  readonly stewardAddress: Option.Option<string>;
  readonly option: Option.Option<string>;
  readonly optionType: Option.Option<string>;
  readonly durationSeconds: Option.Option<string>;
  readonly stake: Option.Option<string>;
  readonly side: Option.Option<string>;
  readonly vaultId: Option.Option<string>;
  readonly amount: Option.Option<string>;
  readonly outcome: Option.Option<string>;
  readonly proofCid: Option.Option<string>;
  readonly account: Option.Option<string>;
  readonly name: Option.Option<string>;
  readonly agentType: Option.Option<string>;
  readonly tier: Option.Option<string>;
  readonly actionType: Option.Option<string>;
  readonly data: Option.Option<string>;
  readonly flowStake: Option.Option<string>;
  readonly proposalId: Option.Option<string>;
}): ProtocolPlanOptions => ({
  operation: optionValue(options.operation),
  chainId: optionValue(options.chainId),
  addressBook: optionValue(options.addressBook),
  vaultAddress: optionValue(options.vaultAddress),
  flowTokenAddress: optionValue(options.flowTokenAddress),
  agentRegistryAddress: optionValue(options.agentRegistryAddress),
  observerRegistryAddress: optionValue(options.observerRegistryAddress),
  stewardAddress: optionValue(options.stewardAddress),
  option: optionValue(options.option),
  optionType: optionValue(options.optionType),
  durationSeconds: optionValue(options.durationSeconds),
  stake: optionValue(options.stake),
  side: optionValue(options.side),
  vaultId: optionValue(options.vaultId),
  amount: optionValue(options.amount),
  outcome: optionValue(options.outcome),
  proofCid: optionValue(options.proofCid),
  account: optionValue(options.account),
  name: optionValue(options.name),
  agentType: optionValue(options.agentType),
  tier: optionValue(options.tier),
  actionType: optionValue(options.actionType),
  data: optionValue(options.data),
  flowStake: optionValue(options.flowStake),
  proposalId: optionValue(options.proposalId)
});

const defaultOperation = (family: ProtocolFamily): ProtocolOperation => {
  switch (family) {
    case "vault":
      return "create";
    case "flow":
      return "balance";
    case "bookmaker":
      return "register";
    case "steward":
      return "propose";
  }
};

const targetFor = (
  family: ProtocolFamily,
  operation: ProtocolOperation
): ProtocolDescriptorTarget | undefined => {
  if (family === "vault") {
    switch (operation) {
      case "create":
        return { contractName: "Vault", functionName: "createVault" };
      case "stream":
        return { contractName: "Vault", functionName: "stream" };
      case "resolve":
        return { contractName: "Vault", functionName: "resolve" };
      case "finalize":
        return { contractName: "Vault", functionName: "finalize" };
      case "withdraw":
        return { contractName: "Vault", functionName: "withdraw" };
      case "get-vault":
        return { contractName: "Vault", functionName: "getVault" };
      case "get-position":
        return { contractName: "Vault", functionName: "getPosition" };
    }
  }

  if (family === "flow") {
    switch (operation) {
      case "balance":
        return { contractName: "FlowToken", functionName: "balanceOf" };
      case "stake":
        return { contractName: "FlowToken", functionName: "stake" };
      case "unstake":
        return { contractName: "FlowToken", functionName: "unstake" };
      case "claim-dividends":
        return { contractName: "FlowToken", functionName: "claimDividends" };
      case "pending-rewards":
        return { contractName: "FlowToken", functionName: "pendingRewards" };
    }
  }

  if (family === "bookmaker") {
    switch (operation) {
      case "register":
        return { contractName: "AgentRegistry", functionName: "registerAgent" };
      case "create-vault":
        return { contractName: "Vault", functionName: "createVault" };
      case "stream":
        return { contractName: "Vault", functionName: "stream" };
    }
  }

  if (family === "steward") {
    switch (operation) {
      case "register":
        return { contractName: "Steward", functionName: "registerSteward" };
      case "propose":
        return { contractName: "Steward", functionName: "propose" };
      case "challenge":
        return { contractName: "Steward", functionName: "challengeProposal" };
      case "execute":
        return { contractName: "Steward", functionName: "executeProposal" };
      case "veto":
        return { contractName: "Steward", functionName: "veto" };
    }
  }

  return undefined;
};

const operationsFor = (family: ProtocolFamily): readonly string[] => {
  switch (family) {
    case "vault":
      return [
        "create",
        "stream",
        "resolve",
        "finalize",
        "withdraw",
        "get-vault",
        "get-position"
      ];
    case "flow":
      return [
        "balance",
        "stake",
        "unstake",
        "claim-dividends",
        "pending-rewards"
      ];
    case "bookmaker":
      return ["register", "create-vault", "stream"];
    case "steward":
      return ["register", "propose", "challenge", "execute", "veto"];
  }
};

const normalizeOperation = (
  family: ProtocolFamily,
  operation: string | undefined
): ProtocolOperation | undefined => {
  const selected = operation?.trim() || defaultOperation(family);
  return operationsFor(family).includes(selected) ? selected as ProtocolOperation : undefined;
};

const configError = (message: string, details?: string): FlowStreamConfigError =>
  new FlowStreamConfigError({
    message,
    metadata: {
      details,
      retryable: false
    }
  });

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isAddress = (value: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(value);

const parseAddress = (field: string, value: string): Effect.Effect<string, FlowStreamConfigError> =>
  isAddress(value)
    ? Effect.succeed(value)
    : Effect.fail(configError(`${field} must be an EVM address`, `Received: ${value}`));

const parseSafeInteger = (
  field: string,
  value: string
): Effect.Effect<number, FlowStreamConfigError> => {
  if (/^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return Effect.succeed(parsed);
  }

  return Effect.fail(configError(`${field} must be a safe decimal integer`, `Received: ${value}`));
};

const parseUint256 = (
  field: string,
  value: string
): Effect.Effect<bigint, FlowStreamConfigError> => {
  if (/^(0x[0-9a-fA-F]+|\d+)$/.test(value)) {
    return Effect.succeed(BigInt(value));
  }

  return Effect.fail(configError(`${field} must be a uint256 decimal or hex string`, `Received: ${value}`));
};

const parseEnum = (field: string, value: string): string | number =>
  /^\d+$/.test(value) ? Number(value) : value;

const parseSide = (value: string): Effect.Effect<"yes" | "no", FlowStreamConfigError> => {
  const normalized = value.toLowerCase();
  return normalized === "yes" || normalized === "no"
    ? Effect.succeed(normalized)
    : Effect.fail(configError("side must be yes or no", `Received: ${value}`));
};

const requireString = (
  field: keyof ProtocolPlanOptions,
  options: ProtocolPlanOptions
): Effect.Effect<string, FlowStreamConfigError> => {
  const value = options[field];
  return typeof value === "string" && value.trim() !== ""
    ? Effect.succeed(value)
    : Effect.fail(configError(`${String(field)} is required`));
};

const readAddressBook = (source: string): Effect.Effect<AddressBookPayload, FlowStreamConfigError> =>
  Effect.try({
    try: () => {
      const trimmed = source.trim();
      const jsonText = trimmed.startsWith("{")
        ? trimmed
        : readFileSync(trimmed, "utf8");
      const parsed = JSON.parse(jsonText) as unknown;

      if (!isRecord(parsed)) {
        throw new Error("Address book JSON must be an object.");
      }

      return parsed;
    },
    catch: (error) =>
      configError(
        "Invalid protocol address book",
        error instanceof Error ? error.message : String(error)
      )
  });

const parseContracts = (
  contracts: unknown,
  source: string
): Effect.Effect<ProtocolContractAddresses, FlowStreamConfigError> => {
  if (contracts === undefined) return Effect.succeed({});

  if (!isRecord(contracts)) {
    return Effect.fail(configError(`${source}.contracts must be an object`));
  }

  return Effect.gen(function* () {
    const entries: [string, string | undefined][] = [];

    for (const [key, value] of Object.entries(contracts)) {
      if (value === undefined || value === null || value === "") {
        entries.push([key, undefined]);
      } else if (typeof value === "string") {
        entries.push([key, yield* parseAddress(`${source}.contracts.${key}`, value)]);
      } else {
        return yield* Effect.fail(
          configError(`${source}.contracts.${key} must be an EVM address string`)
        );
      }
    }

    return Object.fromEntries(entries);
  });
};

const addressBookContractsInput = (addressBook: AddressBookPayload): unknown => {
  if (addressBook.contracts !== undefined) return addressBook.contracts;

  return Object.fromEntries(
    Object.entries(addressBook).filter(([key]) => key !== "chainId" && key !== "rpcUrl")
  );
};

const parseProtocolConfig = (
  options: ProtocolPlanOptions
): Effect.Effect<FlowStreamProtocolConfig, FlowStreamConfigError> =>
  Effect.gen(function* () {
    const addressBook = options.addressBook
      ? yield* readAddressBook(options.addressBook)
      : undefined;
    const addressBookContracts = addressBook
      ? yield* parseContracts(addressBookContractsInput(addressBook), "addressBook")
      : {};
    const explicitContracts: ProtocolContractAddresses = {};

    if (options.vaultAddress) explicitContracts.Vault = yield* parseAddress("vaultAddress", options.vaultAddress);
    if (options.flowTokenAddress) {
      explicitContracts.FlowToken = yield* parseAddress("flowTokenAddress", options.flowTokenAddress);
    }
    if (options.agentRegistryAddress) {
      explicitContracts.AgentRegistry = yield* parseAddress("agentRegistryAddress", options.agentRegistryAddress);
    }
    if (options.observerRegistryAddress) {
      explicitContracts.ObserverRegistry = yield* parseAddress(
        "observerRegistryAddress",
        options.observerRegistryAddress
      );
    }
    if (options.stewardAddress) {
      explicitContracts.Steward = yield* parseAddress("stewardAddress", options.stewardAddress);
    }

    const chainIdValue = options.chainId ?? addressBook?.chainId;
    const chainId = typeof chainIdValue === "number"
      ? chainIdValue
      : typeof chainIdValue === "string"
        ? yield* parseSafeInteger("chainId", chainIdValue)
        : undefined;

    if (chainId === undefined) {
      return yield* Effect.fail(
        configError("chainId is required for actual protocol descriptor planning")
      );
    }

    return {
      chainId,
      contracts: {
        ...addressBookContracts,
        ...explicitContracts
      }
    };
  });

const plannerInputFor = (
  family: ProtocolFamily,
  operation: ProtocolOperation
): PlannerInput | undefined => {
  if (family === "vault") {
    switch (operation) {
      case "create":
        return {
          plannerMethod: "createVault",
          addressKey: "Vault",
          fields: ["option", "optionType", "durationSeconds", "stake", "side"]
        };
      case "stream":
        return {
          plannerMethod: "streamIntoVault",
          addressKey: "Vault",
          fields: ["vaultId", "side", "amount"]
        };
      case "resolve":
        return {
          plannerMethod: "resolveVault",
          addressKey: "Vault",
          fields: ["vaultId", "outcome", "proofCid"]
        };
      case "finalize":
        return { plannerMethod: "finalizeVault", addressKey: "Vault", fields: ["vaultId"] };
      case "withdraw":
        return { plannerMethod: "withdrawVault", addressKey: "Vault", fields: ["vaultId"] };
      case "get-vault":
      case "get-position":
        return undefined;
    }
  }

  if (family === "flow") {
    switch (operation) {
      case "balance":
        return { plannerMethod: "readFlowBalance", addressKey: "FlowToken", fields: ["account"] };
      case "stake":
        return { plannerMethod: "stakeFlow", addressKey: "FlowToken", fields: ["amount"] };
      case "unstake":
        return { plannerMethod: "unstakeFlow", addressKey: "FlowToken", fields: ["amount"] };
      case "claim-dividends":
        return { plannerMethod: "claimFlowRewards", addressKey: "FlowToken", fields: [] };
      case "pending-rewards":
        return { plannerMethod: "readPendingFlowRewards", addressKey: "FlowToken", fields: ["account"] };
    }
  }

  if (family === "bookmaker") {
    switch (operation) {
      case "register":
        return { plannerMethod: "registerAgent", addressKey: "AgentRegistry", fields: ["name", "agentType"] };
      case "create-vault":
        return {
          plannerMethod: "createVault",
          addressKey: "Vault",
          fields: ["option", "optionType", "durationSeconds", "stake", "side"]
        };
      case "stream":
        return {
          plannerMethod: "streamIntoVault",
          addressKey: "Vault",
          fields: ["vaultId", "side", "amount"]
        };
    }
  }

  if (family === "steward") {
    switch (operation) {
      case "register":
        return { plannerMethod: "registerSteward", addressKey: "Steward", fields: ["name", "tier"] };
      case "propose":
        return {
          plannerMethod: "proposeStewardAction",
          addressKey: "Steward",
          fields: ["vaultId", "actionType", "data", "flowStake"]
        };
      case "challenge":
        return {
          plannerMethod: "challengeStewardProposal",
          addressKey: "Steward",
          fields: ["proposalId", "flowStake"]
        };
      case "execute":
        return { plannerMethod: "executeStewardProposal", addressKey: "Steward", fields: ["proposalId"] };
      case "veto":
        return { plannerMethod: "vetoStewardProposal", addressKey: "Steward", fields: ["proposalId"] };
    }
  }

  return undefined;
};

const missingFields = (
  input: PlannerInput,
  options: ProtocolPlanOptions
): readonly string[] =>
  input.fields.filter((field) => options[field] === undefined || options[field] === "");

const validateConfigHints = (
  options: ProtocolPlanOptions
): Effect.Effect<void, FlowStreamConfigError> =>
  Effect.gen(function* () {
    if (options.addressBook) {
      const addressBook = yield* readAddressBook(options.addressBook);
      yield* parseContracts(addressBookContractsInput(addressBook), "addressBook");
    }

    if (options.vaultAddress) yield* parseAddress("vaultAddress", options.vaultAddress);
    if (options.flowTokenAddress) yield* parseAddress("flowTokenAddress", options.flowTokenAddress);
    if (options.agentRegistryAddress) {
      yield* parseAddress("agentRegistryAddress", options.agentRegistryAddress);
    }
    if (options.observerRegistryAddress) {
      yield* parseAddress("observerRegistryAddress", options.observerRegistryAddress);
    }
    if (options.stewardAddress) yield* parseAddress("stewardAddress", options.stewardAddress);
  });

const buildDescriptor = (
  input: PlannerInput,
  options: ProtocolPlanOptions,
  config: FlowStreamProtocolConfig
) =>
  Effect.gen(function* () {
    const client = yield* makeProtocolClient(config);
    const planner = makeProtocolActionPlanner(client);

    switch (input.plannerMethod) {
      case "createVault":
        return yield* planner.createVault({
          option: yield* requireString("option", options),
          optionType: parseEnum(
            "optionType",
            yield* requireString("optionType", options)
          ) as VaultOptionType,
          durationSeconds: yield* parseSafeInteger("durationSeconds", yield* requireString("durationSeconds", options)),
          stake: yield* parseUint256("stake", yield* requireString("stake", options)),
          side: yield* parseSide(yield* requireString("side", options))
        });
      case "streamIntoVault":
        return yield* planner.streamIntoVault({
          vaultId: yield* requireString("vaultId", options),
          side: yield* parseSide(yield* requireString("side", options)),
          amount: yield* parseUint256("amount", yield* requireString("amount", options))
        });
      case "resolveVault":
        return yield* planner.resolveVault({
          vaultId: yield* requireString("vaultId", options),
          outcome: parseEnum(
            "outcome",
            yield* requireString("outcome", options)
          ) as VaultResolutionOutcome,
          proofCid: yield* requireString("proofCid", options)
        });
      case "finalizeVault":
        return yield* planner.finalizeVault({ vaultId: yield* requireString("vaultId", options) });
      case "withdrawVault":
        return yield* planner.withdrawVault({ vaultId: yield* requireString("vaultId", options) });
      case "readFlowBalance":
        return yield* planner.readFlowBalance({ account: yield* requireString("account", options) });
      case "stakeFlow":
        return yield* planner.stakeFlow({ amount: yield* parseUint256("amount", yield* requireString("amount", options)) });
      case "unstakeFlow":
        return yield* planner.unstakeFlow({ amount: yield* parseUint256("amount", yield* requireString("amount", options)) });
      case "claimFlowRewards":
        return yield* planner.claimFlowRewards();
      case "readPendingFlowRewards":
        return yield* planner.readPendingFlowRewards({ account: yield* requireString("account", options) });
      case "registerAgent":
        return yield* planner.registerAgent({
          name: yield* requireString("name", options),
          agentType: parseEnum(
            "agentType",
            yield* requireString("agentType", options)
          ) as AgentRegistrationType
        });
      case "registerSteward":
        return yield* planner.registerSteward({
          name: yield* requireString("name", options),
          tier: parseEnum(
            "tier",
            yield* requireString("tier", options)
          ) as StewardRegistrationTier
        });
      case "proposeStewardAction":
        return yield* planner.proposeStewardAction({
          vaultId: yield* requireString("vaultId", options),
          actionType: parseEnum(
            "actionType",
            yield* requireString("actionType", options)
          ) as StewardProposalActionType,
          data: yield* requireString("data", options),
          flowStake: yield* parseUint256("flowStake", yield* requireString("flowStake", options))
        });
      case "challengeStewardProposal":
        return yield* planner.challengeStewardProposal({
          proposalId: yield* parseUint256("proposalId", yield* requireString("proposalId", options)),
          flowStake: yield* parseUint256("flowStake", yield* requireString("flowStake", options))
        });
      case "executeStewardProposal":
        return yield* planner.executeStewardProposal({
          proposalId: yield* parseUint256("proposalId", yield* requireString("proposalId", options))
        });
      case "vetoStewardProposal":
        return yield* planner.vetoStewardProposal({
          proposalId: yield* parseUint256("proposalId", yield* requireString("proposalId", options))
        });
    }
  });

const jsonSafe = (value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }

  return value;
};

const protocolPlanInvalidPayload = (
  family: ProtocolFamily,
  operation: ProtocolOperation,
  error: unknown
) => ({
  ok: false,
  command: `${family} plan`,
  status: "invalid",
  errors: [error instanceof Error ? error.message : String(error)],
  error: formatCliError(error),
  acceptedArgs: {
    operation
  },
  ownership
});

export const protocolShellPayload = (family: ProtocolFamily) => ({
  ok: true,
  command: family,
  status: "scaffold",
  message:
    `${family} exposes descriptor preview JSON only. sdk-options owns live protocol IO and descriptor validation.`,
  ownership,
  commands: [
    `${family} plan [--operation ${operationsFor(family).join("|")}] [--chain-id <id>] [--address-book <json|path>] [address flags] [action params]`
  ],
  operations: operationsFor(family)
});

export const protocolPreviewInvalidPayload = (
  family: ProtocolFamily,
  operation: string | undefined
) => {
  const message = `${family} plan accepts --operation ${operationsFor(family).join("|")}.`;

  return {
    ok: false,
    command: `${family} plan`,
    status: "invalid",
    errors: [message],
    error: formatCliError(
      new FlowStreamCommandError({
        commandScope: `${family} plan`,
        message,
        metadata: {
          details: `Received operation: ${operation ?? "<default>"}`,
          retryable: false
        }
      })
    ),
    received: {
      operation: operation ?? null
    },
    ownership
  };
};

export const protocolPreviewPayload = (
  family: ProtocolFamily,
  options: ProtocolPreviewOptions
) => {
  const operation = normalizeOperation(family, options.operation);

  if (operation === undefined) {
    return protocolPreviewInvalidPayload(family, options.operation);
  }

  const target = targetFor(family, operation);

  return {
    ok: true,
    command: `${family} plan`,
    status: "preview",
    message:
      "Schema-shaped descriptor preview only. No wallet, provider, address lookup, ABI lookup, calldata encoding, transaction, or read call was performed.",
    ownership,
    acceptedArgs: {
      operation,
      chainId: options.chainId ?? null,
      addressBook: options.addressBook ?? null
    },
    descriptorPlan: {
      source: "scaffold",
      liveIoOwner: "sdk-options",
      planner: "makeProtocolActionPlanner",
      descriptorPlanner: "makeProtocolCallPlanner",
      protocolClient: "makeProtocolClient",
      contractName: target?.contractName ?? null,
      functionName: target?.functionName ?? null,
      address: {
        resolved: false,
        source: "sdk-options ProtocolClient.address with contracts-re deployment metadata"
      },
      arguments: {
        resolved: false,
        source: "SDK domain workflow input; CLI does not duplicate contract ABI fragments"
      },
      stateMutability: {
        resolved: false,
        source: "contracts-re artifact metadata via sdk-options"
      }
    },
    liveIo: {
      attempted: false,
      transactionSent: false,
      readPerformed: false
    },
    limitations: [
      "The CLI does not duplicate ABI fragments.",
      "The CLI does not own protocol descriptors or deployment metadata.",
      "Wire sdk-options public APIs here after cli-re declares the dependency and the integration is ready."
    ]
  };
};

export const protocolPlanPayload = (
  family: ProtocolFamily,
  options: ProtocolPlanOptions
): Effect.Effect<unknown> => {
  const operation = normalizeOperation(family, options.operation);

  if (operation === undefined) {
    return Effect.succeed(protocolPreviewInvalidPayload(family, options.operation));
  }

  const input = plannerInputFor(family, operation);
  if (input === undefined) {
    return Effect.succeed(protocolPreviewPayload(family, options));
  }

  const missing = missingFields(input, options);
  if (missing.length > 0) {
    const preview = protocolPreviewPayload(family, options);

    if (!("descriptorPlan" in preview)) {
      return Effect.succeed(preview);
    }

    return validateConfigHints(options).pipe(
      Effect.as({
        ...preview,
        descriptorPlan: {
          ...preview.descriptorPlan,
          source: "scaffold",
          actualDescriptorAvailableWhen: {
            planner: "makeProtocolActionPlanner",
            missingParams: missing,
            requiredAddress: input.addressKey
          }
        }
      }),
      Effect.catchAll((error) =>
        Effect.succeed(protocolPlanInvalidPayload(family, operation, error))
      )
    );
  }

  return Effect.gen(function* () {
    const config = yield* parseProtocolConfig(options);
    const descriptor = yield* buildDescriptor(input, options, config);

    return {
      ok: true,
      command: `${family} plan`,
      status: "planned",
      message:
        "Actual protocol descriptor planned by sdk-options. No wallet, provider, calldata encoding, transaction, or read call was performed.",
      ownership,
      acceptedArgs: {
        operation,
        chainId: config.chainId,
        addressBook: options.addressBook ?? null
      },
      descriptor: jsonSafe(descriptor),
      descriptorEncoding: {
        bigint: "decimal-string"
      },
      liveIo: {
        attempted: false,
        transactionSent: false,
        readPerformed: false,
        calldataEncoded: false
      },
      limitations: [
        "The CLI did not duplicate ABI fragments.",
        "The CLI did not send a transaction.",
        "The CLI did not perform a contract read.",
        "The CLI did not encode calldata."
      ]
    };
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed(protocolPlanInvalidPayload(family, operation, error))
    )
  );
};

export const runProtocolShell = (
  family: ProtocolFamily
): Effect.Effect<void> => printJson(protocolShellPayload(family));

export const runProtocolPreview = (
  family: ProtocolFamily,
  options: ProtocolPlanOptions
): Effect.Effect<void> =>
  protocolPlanPayload(family, options).pipe(Effect.flatMap(printJson));

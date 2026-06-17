#!/usr/bin/env node
import { Command } from "@effect/cli";
import { Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console, Effect, type Option } from "effect";
import {
  optionValue,
  runFootballAssetsRepair,
  runFootballAssetsVerify
} from "./assets.js";
import {
  anvilOptions,
  normalizeAnvilOptions,
  runAnvilPlan,
  runAnvilShell,
  runChainShell
} from "./chain.js";
import { runDoctor } from "./doctor.js";
import {
  hostHelp,
  hostPolicyOptions,
  hostProviderOptions,
  hostReadinessOptions,
  normalizeHostPolicyOptions,
  normalizeHostProviderOptions,
  normalizeHostReadinessOptions,
  runHostConstraints,
  runHostConfigure,
  runHostDescribe,
  runHostLogin,
  runHostPolicy,
  runHostReadiness,
  runHostShell
} from "./host.js";
import {
  networkDoctorOptions,
  normalizeNetworkDoctorOptions,
  runNetworkDoctor
} from "./network.js";
import {
  normalizeObserveOptions,
  observeCommandOptions,
  observeRegistryHelp,
  runObserve
} from "./observe.js";
import {
  normalizeProtocolPreviewOptions,
  protocolPreviewOptions,
  runProtocolPreview,
  runProtocolShell,
  type ProtocolFamily
} from "./protocol.js";
import {
  normalizeSessionControlOptions,
  normalizeSessionIdOptions,
  runSessionControl,
  runSessionHealth,
  runSessionInspect,
  runSessionList,
  runSessionShell,
  sessionCommandOptions,
  sessionControlCommandOptions,
  sessionHelp
} from "./session.js";
import { runUpdatePlan, runUpdateShell } from "./update.js";

type CommandFamily = {
  readonly name: string;
  readonly summary: string;
  readonly owns: readonly string[];
  readonly next: readonly string[];
};

const version = "0.1.0";

const families = [
  {
    name: "setup",
    summary: "Prepare local FlowStream runtime prerequisites.",
    owns: ["local configuration", "developer machine bootstrap"],
    next: ["asset verification", "runtime dependency installation"]
  },
  {
    name: "doctor",
    summary: "Inspect local readiness without changing state.",
    owns: ["environment checks", "asset status", "registry visibility"],
    next: ["typed health checks", "repair hints"]
  },
  {
    name: "assets",
    summary: "Inspect and repair content-pack assets.",
    owns: ["asset manifests", "football model readiness"],
    next: ["assets list", "assets verify", "assets repair football"]
  },
  {
    name: "host",
    summary: "Inspect host/cache configuration and hosted output readiness.",
    owns: ["host policy display", "HostProviderClient preview display"],
    next: ["provider config binding", "endpoint manifest display", "cache receipt display"]
  },
  {
    name: "observe",
    summary: "Prepare future observe workflows for file and live sources.",
    owns: ["observe command surface", "registry flag help"],
    next: ["file debug broadcast", "webcapture source controls"]
  },
  {
    name: "session",
    summary: "Inspect and control SDK-owned runtime sessions.",
    owns: ["local control plane display", "RuntimeStore command shape", "CapabilityGrantStore grant shape"],
    next: ["daemon/store binding", "capability validation", "RuntimeStore lifecycle calls"]
  },
  {
    name: "chain",
    summary: "Expose local developer-chain planning entry points.",
    owns: ["Anvil config/deploy/status plan display", "network selection shell"],
    next: ["contracts-re deployment metadata binding", "real Anvil process/status integration"]
  },
  {
    name: "vault",
    summary: "Preview vault protocol descriptor plans.",
    owns: ["vault command parsing", "descriptor plan display"],
    next: ["sdk-options ProtocolActionPlanner integration"]
  },
  {
    name: "flow",
    summary: "Preview FlowToken protocol descriptor plans.",
    owns: ["flow command parsing", "descriptor plan display"],
    next: ["sdk-options ProtocolActionPlanner integration"]
  },
  {
    name: "bookmaker",
    summary: "Preview bookmaker agent protocol descriptor plans.",
    owns: ["bookmaker command parsing", "descriptor plan display"],
    next: ["sdk-options ProtocolActionPlanner integration"]
  },
  {
    name: "steward",
    summary: "Preview steward protocol descriptor plans.",
    owns: ["steward command parsing", "descriptor plan display"],
    next: ["sdk-options ProtocolActionPlanner integration"]
  },
  {
    name: "update",
    summary: "Expose CLI software update scaffolds.",
    owns: ["CLI software update command parsing", "update policy display"],
    next: ["package manager update provider binding"]
  }
] as const satisfies readonly CommandFamily[];

const findFamily = (name: string): CommandFamily =>
  families.find((family) => family.name === name) ?? {
    name,
    summary: "Unknown command family.",
    owns: [],
    next: []
  };

const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2));

const shellMessage = (family: CommandFamily) =>
  printJson({
    ok: true,
    command: family.name,
    status: "scaffold",
    message: `${family.name} is available as a CLI shell. No session was started and no contracts were required.`,
    summary: family.summary,
    owns: family.owns,
    next: family.next
  });

const familyHelp = (family: CommandFamily) =>
  Console.log(`FlowStream RE CLI v${version}

USAGE

$ flowstream-re ${family.name}

DESCRIPTION

${family.summary}

OWNED BY CLI

${family.owns.map((item) => `- ${item}`).join("\n")}

NEXT IMPLEMENTATION

${family.next.map((item) => `- ${item}`).join("\n")}
${family.name === "observe" ? `\n${observeRegistryHelp()}\n` : ""}
`);

const commandFamilyHelp = (argv: readonly string[]): Effect.Effect<void> | undefined => {
  const args = argv.slice(2);
  if (args.length < 2 || (args[1] !== "--help" && args[1] !== "-h")) return undefined;

  const family = families.find((item) => item.name === args[0]);
  if (family === undefined) return undefined;
  if (family.name === "session") return Console.log(sessionHelp(version));
  if (family.name === "host") return Console.log(hostHelp(version));
  return familyHelp(family);
};

const familyCommand = (family: CommandFamily) =>
  Command.make(family.name, {}, () => shellMessage(family)).pipe(
    Command.withDescription(family.summary)
  );

const footballAssetOptions = {
  assetRoot: Options.text("asset-root").pipe(
    Options.optional,
    Options.withDescription(
      "Football asset root. Defaults to FLOWSTREAM_FOOTBALL_ASSET_ROOT or the SDK content-pack weight directory."
    )
  )
};

const normalizeFootballAssetOptions = (options: {
  readonly assetRoot: Option.Option<string>;
}) => ({
  assetRoot: optionValue(options.assetRoot)
});

const doctorFamily = findFamily("doctor");
const doctorCommand = Command.make(doctorFamily.name, footballAssetOptions, (options) =>
  runDoctor(normalizeFootballAssetOptions(options))
).pipe(Command.withDescription(doctorFamily.summary));

const assetsFamily = findFamily("assets");
const assetsFootballVerifyCommand = Command.make(
  "football",
  footballAssetOptions,
  (options) => runFootballAssetsVerify(normalizeFootballAssetOptions(options))
).pipe(Command.withDescription("Verify football content-pack asset readiness."));

const assetsFootballRepairCommand = Command.make(
  "football",
  footballAssetOptions,
  (options) => runFootballAssetsRepair(normalizeFootballAssetOptions(options))
).pipe(Command.withDescription("Show the scaffolded football asset repair path."));

const assetsVerifyCommand = Command.make("verify", {}, () =>
  printJson({
    ok: true,
    command: "assets verify",
    status: "scaffold",
    message: "Select a content pack to verify.",
    next: ["assets verify football"]
  })
).pipe(
  Command.withDescription("Verify content-pack assets."),
  Command.withSubcommands([assetsFootballVerifyCommand])
);

const assetsRepairCommand = Command.make("repair", {}, () =>
  printJson({
    ok: true,
    command: "assets repair",
    status: "scaffold",
    message: "Select a content pack to repair.",
    next: ["assets repair football"]
  })
).pipe(
  Command.withDescription("Repair content-pack assets when a repair provider is available."),
  Command.withSubcommands([assetsFootballRepairCommand])
);

const assetsCommand = Command.make(assetsFamily.name, {}, () => shellMessage(assetsFamily)).pipe(
  Command.withDescription(assetsFamily.summary),
  Command.withSubcommands([assetsVerifyCommand, assetsRepairCommand])
);

const observeFamily = findFamily("observe");

const observeCommand = Command.make(
  observeFamily.name,
  observeCommandOptions,
  (options) => runObserve(normalizeObserveOptions(options), shellMessage(observeFamily))
).pipe(Command.withDescription(observeFamily.summary));

const hostFamily = findFamily("host");

const hostConfigureCommand = Command.make("configure", hostProviderOptions, (options) =>
  runHostConfigure(normalizeHostProviderOptions(options))
).pipe(Command.withDescription("Validate and save selected HTTP host provider config without logging in."));

const hostLoginCommand = Command.make("login", hostProviderOptions, (options) =>
  runHostLogin(normalizeHostProviderOptions(options))
).pipe(Command.withDescription("Validate selected HTTP host provider config and read provider readiness JSON."));

const hostReadinessCommand = Command.make("readiness", hostReadinessOptions, (options) =>
  runHostReadiness(normalizeHostReadinessOptions(options))
).pipe(Command.withDescription("Report whether saved host config can create a ready HTTP HostProviderClient."));

const hostDescribeCommand = Command.make("describe", {}, () => runHostDescribe()).pipe(
  Command.withDescription("Describe HostProviderClient expectations without requiring host login.")
);

const hostConstraintsCommand = Command.make("constraints", {}, () => runHostConstraints()).pipe(
  Command.withDescription("Show SDK-accessible host provider constraint notes.")
);

const hostPolicyCommand = Command.make("policy", hostPolicyOptions, (options) =>
  runHostPolicy(normalizeHostPolicyOptions(options))
).pipe(Command.withDescription("Preview SDK host policy for an output shape without binding a provider."));

const hostNetworkCommand = Command.make("network", networkDoctorOptions, (options) =>
  runNetworkDoctor(normalizeNetworkDoctorOptions(options))
).pipe(
  Command.withDescription(
    "Explain hosted/local/LAN/degraded network shapes without probing or opening ports."
  )
);

const hostCommand = Command.make(hostFamily.name, {}, () => runHostShell()).pipe(
  Command.withDescription(hostFamily.summary),
  Command.withSubcommands([
    hostConfigureCommand,
    hostLoginCommand,
    hostReadinessCommand,
    hostDescribeCommand,
    hostConstraintsCommand,
    hostPolicyCommand,
    hostNetworkCommand
  ])
);

const sessionFamily = findFamily("session");

const sessionListCommand = Command.make("list", {}, () => runSessionList()).pipe(
  Command.withDescription("List RuntimeStore sessions when a host store binding is available.")
);

const sessionInspectCommand = Command.make(
  "inspect",
  sessionCommandOptions,
  (options) => runSessionInspect(normalizeSessionIdOptions(options))
).pipe(Command.withDescription("Inspect a RuntimeStore session scaffold by id."));

const sessionHealthCommand = Command.make(
  "health",
  sessionCommandOptions,
  (options) => runSessionHealth(normalizeSessionIdOptions(options))
).pipe(Command.withDescription("Inspect RuntimeStore session health scaffold by id."));

const sessionLifecycleCommand = (command: "prepare" | "start" | "pause" | "resume" | "stop") =>
  Command.make(command, sessionControlCommandOptions, (options) =>
    runSessionControl(command, normalizeSessionControlOptions(options))
  ).pipe(Command.withDescription(`Validate the session ${command} command shape.`));

const sessionCommand = Command.make(sessionFamily.name, {}, () => runSessionShell()).pipe(
  Command.withDescription(sessionFamily.summary),
  Command.withSubcommands([
    sessionListCommand,
    sessionInspectCommand,
    sessionHealthCommand,
    sessionLifecycleCommand("prepare"),
    sessionLifecycleCommand("start"),
    sessionLifecycleCommand("pause"),
    sessionLifecycleCommand("resume"),
    sessionLifecycleCommand("stop")
  ])
);

const chainFamily = findFamily("chain");

const anvilConfigCommand = Command.make("config", anvilOptions, (options) =>
  runAnvilPlan("config", normalizeAnvilOptions(options))
).pipe(Command.withDescription("Print local Anvil config plan JSON without writing files."));

const anvilDeployCommand = Command.make("deploy", anvilOptions, (options) =>
  runAnvilPlan("deploy", normalizeAnvilOptions(options))
).pipe(Command.withDescription("Print local Anvil deployment plan JSON without deploying contracts."));

const anvilStatusCommand = Command.make("status", anvilOptions, (options) =>
  runAnvilPlan("status", normalizeAnvilOptions(options))
).pipe(Command.withDescription("Print local Anvil status plan JSON without probing RPC."));

const chainAnvilCommand = Command.make("anvil", {}, () => runAnvilShell()).pipe(
  Command.withDescription("Local Anvil plan-only command surface."),
  Command.withSubcommands([
    anvilConfigCommand,
    anvilDeployCommand,
    anvilStatusCommand
  ])
);

const chainCommand = Command.make(chainFamily.name, {}, () => runChainShell()).pipe(
  Command.withDescription(chainFamily.summary),
  Command.withSubcommands([chainAnvilCommand])
);

const protocolPlanCommand = (family: ProtocolFamily) =>
  Command.make("plan", protocolPreviewOptions, (options) =>
    runProtocolPreview(family, normalizeProtocolPreviewOptions(options))
  ).pipe(
    Command.withDescription(
      `Print a ${family} protocol descriptor preview without live IO.`
    )
  );

const protocolCommand = (family: ProtocolFamily) => {
  const commandFamily = findFamily(family);

  return Command.make(family, {}, () => runProtocolShell(family)).pipe(
    Command.withDescription(commandFamily.summary),
    Command.withSubcommands([protocolPlanCommand(family)])
  );
};

const updateFamily = findFamily("update");

const updateCheckCommand = Command.make("check", {}, () =>
  runUpdatePlan("check")
).pipe(Command.withDescription("Check for CLI software updates without querying a package provider."));

const updateApplyCommand = Command.make("apply", {}, () =>
  runUpdatePlan("apply")
).pipe(Command.withDescription("Apply a CLI software update when a provider is bound."));

const updateCommand = Command.make(updateFamily.name, {}, () => runUpdateShell()).pipe(
  Command.withDescription(updateFamily.summary),
  Command.withSubcommands([updateCheckCommand, updateApplyCommand])
);

const rootCommand = Command.make("flowstream-re", {}, () =>
  printJson({
    ok: true,
    command: "flowstream-re",
    status: "scaffold",
    message: "FlowStream rewrite CLI shell is ready. Use --help or a command-family --help to inspect available surfaces.",
    commands: families.map((family) => ({
      name: family.name,
      summary: family.summary
    }))
  })
).pipe(
  Command.withDescription(
    "FlowStream rewrite CLI shell. Parsing and display live here; SDK workflow logic stays in packages."
  ),
  Command.withSubcommands([
    familyCommand(findFamily("setup")),
    doctorCommand,
    assetsCommand,
    hostCommand,
    observeCommand,
    sessionCommand,
    chainCommand,
    protocolCommand("vault"),
    protocolCommand("flow"),
    protocolCommand("bookmaker"),
    protocolCommand("steward"),
    updateCommand
  ])
);

const cli = Command.run(rootCommand, {
  name: "FlowStream RE CLI",
  version: `v${version}`,
  executable: "flowstream-re"
});

const explicitFamilyHelp = commandFamilyHelp(process.argv);

(explicitFamilyHelp ?? cli(process.argv)).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);

import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { resolveOperatorContext } from "../gateway/operator.js";
import { parseVaultId, configOpt, passwordOpt, readCommandConfig } from "./args.js";
import { parseOutcomeArg, resolveVaultEvm, type VaultOutcome } from "../adapters/steward.js";
import { renderTxResult } from "../render/output.js";

// `steward resolve` — the steward (operator/dev key) resolves a vault so the loop can settle.
// Surfaced as `--vault`/`--outcome` to match the house @effect/cli style (vault create uses
// `--market`, nft mint uses `--market`, etc.). Dispatch is per active chain: the CLI operator
// wallet is EVM today, so EVM is wired here; the Sui leg slots in once the CLI gains a Sui operator
// context (scope-e2e-agent.md §A/§F) — the chain-agnostic seam lives in adapters/steward.ts.

export const runStewardResolve = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly vault: string;
  readonly outcome: string;
}): Promise<string> => {
  const vaultId = parseVaultId(input.vault);
  const outcome: VaultOutcome = parseOutcomeArg(input.outcome);

  const ctx = await resolveOperatorContext(input);

  const tx = await resolveVaultEvm({
    account: ctx.account,
    stewardRegistry: ctx.doc.options.stewardRegistry,
    vaultId: vaultId as `0x${string}`,
    outcome
  });

  return renderTxResult("steward resolve", { vault: vaultId, outcome, tx });
};

const stewardResolveCommand = Command.make(
  "resolve",
  {
    vault: Options.text("vault").pipe(Options.withDescription("Vault id (0x-prefixed bytes32)")),
    outcome: Options.text("outcome").pipe(Options.withDescription('Winning side: "yes" or "no"')),
    config: configOpt,
    password: passwordOpt
  },
  ({ vault, outcome, config, password }) =>
    Effect.tryPromise({
      try: () => runStewardResolve({ vault, outcome, ...readCommandConfig(config, password) }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const stewardCommand = Command.make("steward", {}).pipe(
  Command.withSubcommands([stewardResolveCommand])
);

export const stewardCommands = [stewardCommand];

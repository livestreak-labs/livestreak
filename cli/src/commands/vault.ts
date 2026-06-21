import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import {
  asMarketId,
  validateOptionsVaultSide
} from "@livestreak/options";
import { operatorCreateVault } from "../adapters/onchain.js";
import { resolveOperatorContext } from "../gateway/operator.js";
import { createOptionsEdge } from "../adapters/options.js";
import { configOpt, parseBigIntArg, passwordOpt, readCommandConfig } from "./args.js";
import { renderVaultCreateResult } from "../render/output.js";

export const runVaultCreate = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly marketId: string;
  readonly question: string;
  readonly side: string;
  readonly rate: string;
  readonly deposit: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const side = validateOptionsVaultSide(input.side);
  const usdc = await createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress,
    marketId: asMarketId(input.marketId)
  }).chain.reader.readUsdcAddress();

  const result = await operatorCreateVault({
    account: ctx.account,
    publicClient: ctx.publicClient,
    vaultDriverAddress: ctx.doc.options.vaultDriver,
    usdcAddress: usdc,
    marketId: asMarketId(input.marketId),
    question: input.question,
    side,
    rate: parseBigIntArg(input.rate, "rate"),
    deposit: parseBigIntArg(input.deposit, "deposit")
  });

  return renderVaultCreateResult(result);
};

const vaultCreateCommand = Command.make(
  "create",
  {
    market: Options.text("market"),
    question: Options.text("question"),
    side: Options.text("side"),
    rate: Options.text("rate"),
    deposit: Options.text("deposit"),
    config: configOpt,
    password: passwordOpt
  },
  ({ market, question, side, rate, deposit, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runVaultCreate({
          marketId: market,
          question,
          side,
          rate,
          deposit,
          ...readCommandConfig(config, password)
        }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const vaultCommand = Command.make("vault", {}).pipe(
  Command.withSubcommands([vaultCreateCommand])
);

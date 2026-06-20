import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import {
  asUserAddress,
  type ApproveNftInput,
  type SetApprovalForAllInput,
  type TransferNftInput
} from "@livestreak/options";
import { resolveOperatorContext } from "./context.js";
import { createOptionsEdge } from "../edges/options.js";
import {
  configOpt,
  parseApprovedFlag,
  parseTokenId,
  passwordOpt,
  readCommandConfig
} from "./cli-args.js";
import { renderTxResult } from "../render/output.js";

export const runNftTransfer = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly token: string;
  readonly from: string;
  readonly to: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const args: TransferNftInput = {
    tokenId: parseTokenId(input.token),
    from: asUserAddress(input.from),
    to: asUserAddress(input.to)
  };

  const tx = await edge.callAction("transferNft", args);
  return renderTxResult("nft transfer", { tx });
};

export const runNftApprove = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly token: string;
  readonly operator: string;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const args: ApproveNftInput = {
    tokenId: parseTokenId(input.token),
    operator: asUserAddress(input.operator)
  };

  const tx = await edge.callAction("approveNft", args);
  return renderTxResult("nft approve", { tx });
};

export const runNftApproveAll = async (input: {
  readonly configPath?: string;
  readonly password?: string;
  readonly operator: string;
  readonly approved: boolean;
}): Promise<string> => {
  const ctx = await resolveOperatorContext(input);
  const edge = createOptionsEdge({
    doc: ctx.doc,
    walletInit: ctx.walletInit,
    seed: ctx.seed,
    userAddress: ctx.userAddress
  });

  const args: SetApprovalForAllInput = {
    operator: asUserAddress(input.operator),
    approved: parseApprovedFlag(input.approved)
  };

  const tx = await edge.callAction("setApprovalForAll", args);
  return renderTxResult("nft approve-all", { tx });
};

const nftTransferCommand = Command.make(
  "transfer",
  {
    token: Options.text("token"),
    from: Options.text("from"),
    to: Options.text("to"),
    config: configOpt,
    password: passwordOpt
  },
  ({ token, from, to, config, password }) =>
    Effect.tryPromise({
      try: () => runNftTransfer({ token, from, to, ...readCommandConfig(config, password) }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

const nftApproveCommand = Command.make(
  "approve",
  {
    token: Options.text("token"),
    operator: Options.text("operator"),
    config: configOpt,
    password: passwordOpt
  },
  ({ token, operator, config, password }) =>
    Effect.tryPromise({
      try: () => runNftApprove({ token, operator, ...readCommandConfig(config, password) }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

const nftApproveAllCommand = Command.make(
  "approve-all",
  {
    operator: Options.text("operator"),
    approved: Options.boolean("approved"),
    config: configOpt,
    password: passwordOpt
  },
  ({ operator, approved, config, password }) =>
    Effect.tryPromise({
      try: () =>
        runNftApproveAll({ operator, approved, ...readCommandConfig(config, password) }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error)))
    }).pipe(Effect.flatMap((output) => Console.log(output)))
);

export const nftCommand = Command.make("nft", {}).pipe(
  Command.withSubcommands([nftTransferCommand, nftApproveCommand, nftApproveAllCommand])
);

export const nftCommands = [nftCommand];

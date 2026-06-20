#!/usr/bin/env node

import { Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { hostCommand, produceCommand } from "./commands/produce.js";
import { optionsCommands } from "./commands/options.js";

const root = Command.make("livestreak", {}, () => Effect.void).pipe(
  Command.withSubcommands([produceCommand, hostCommand, ...optionsCommands])
);

const cli = Command.run(root, {
  name: "livestreak",
  version: "0.1.0"
});

cli(process.argv).pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);

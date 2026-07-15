// Gateway-injected bootstrap: PackageRuntimeInit → a live observe runtime with the T0 shell run
// mounted (pristine board, system:config + market lifecycle wired). The runtime lives in a
// process-lifetime scope so the streaming worker forked by startRun survives across dispatch calls.
// Effect-typed (observe src stays runPromise-free); the promise boundary is the consumer's.

import { Effect, Scope, Exit } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { PackageRuntimeInit } from "@livestreak/schema";

import { makeObserveRun } from "#run/run.js";
import { shellRunConfig } from "#run/config/helpers.js";
import { mountObserveT0Bus } from "#run/board-first.js";
import { createObserveRuntime, type ObserveRuntime } from "#run/runtime.js";

export interface ObserveConsoleRuntimeHandle {
  readonly runtime: ObserveRuntime;
  readonly close: Effect.Effect<void>;
}

export const openObserveConsoleRuntime = (input: {
  readonly sessionInit: PackageRuntimeInit;
  readonly runId: string;
}): Effect.Effect<ObserveConsoleRuntimeHandle, LiveStreakError> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const runtime = yield* createObserveRuntime({ sessionInit: input.sessionInit }).pipe(
      Effect.provideService(Scope.Scope, scope)
    );
    yield* ensureObserveShellRun(runtime, input);
    return {
      runtime,
      close: Scope.close(scope, Exit.void)
    };
  });

/** Idempotent: mount the pristine T0 shell run for `runId` if the store doesn't hold it yet. */
export const ensureObserveShellRun = (
  runtime: ObserveRuntime,
  input: { readonly sessionInit: PackageRuntimeInit; readonly runId: string }
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const existing = yield* runtime.store.get(input.runId);
    if (existing !== undefined) {
      return;
    }
    const run = yield* makeObserveRun(shellRunConfig(input.runId));
    const mounted = yield* mountObserveT0Bus(run, { sessionInit: input.sessionInit });
    yield* runtime.store.put(mounted);
  });

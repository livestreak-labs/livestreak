import { Effect, Exit } from "effect";
import { FlowStreamConfigError, type FlowStreamError } from "@flowstream-re2/core";
import { setBoardRunStatus } from "./control/board/model.js";
import { systemRunStopScope } from "./control/system/run.js";
import type { ObserveRunResult } from "./kernel.js";
import { callStoredRunFunction, type ObserveRunHandle, type RunStore } from "./store.js";

export const defaultStopTimeoutMs = 5000;

export interface StopRunOptions {
  readonly reason?: string;
  readonly timeoutMs?: number;
}

export const stopObserveRun = (
  store: RunStore,
  runId: string,
  options?: StopRunOptions
): Effect.Effect<ObserveRunResult, FlowStreamError> =>
  Effect.gen(function* () {
    const handle = yield* store.requireHandle(runId);
    const timeoutMs = yield* validateStopTimeoutMs(options?.timeoutMs);

    yield* callStoredRunFunction(store, {
      callId: `stop-${runId}`,
      runId,
      scope: systemRunStopScope,
      ...(options?.reason === undefined ? {} : { payload: { reason: options.reason } })
    });

    const raced = yield* Effect.race(
      handle.awaitResult().pipe(Effect.map((result) => ({ tag: "completed" as const, result }))),
      Effect.sleep(`${timeoutMs} millis`).pipe(Effect.map(() => ({ tag: "timeout" as const })))
    );

    if (raced.tag === "completed") {
      return raced.result;
    }

    yield* handle.interrupt;

    const afterInterrupt = yield* Effect.exit(handle.awaitResult());
    if (Exit.isSuccess(afterInterrupt)) {
      return afterInterrupt.value;
    }

    return yield* buildInterruptedStopResult(handle, timeoutMs);
  });

const buildInterruptedStopResult = (
  handle: ObserveRunHandle,
  timeoutMs: number
): Effect.Effect<ObserveRunResult, FlowStreamError> =>
  Effect.gen(function* () {
    const message = `Stop timed out after ${timeoutMs}ms; worker interrupted`;
    const currentBoard = yield* handle.bus.readBoard();
    yield* handle.bus.commitBoard(setBoardRunStatus(currentBoard, "failed", message));
    const board = yield* handle.bus.readBoard();

    return {
      outcome: "interrupted",
      board
    };
  });

const validateStopTimeoutMs = (
  timeoutMs: unknown
): Effect.Effect<number, FlowStreamConfigError> => {
  if (timeoutMs === undefined) {
    return Effect.succeed(defaultStopTimeoutMs);
  }

  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    return Effect.fail(
      new FlowStreamConfigError({
        message: "stopRun timeoutMs must be a finite number"
      })
    );
  }

  if (timeoutMs < 0) {
    return Effect.fail(
      new FlowStreamConfigError({
        message: "stopRun timeoutMs must be greater than or equal to 0"
      })
    );
  }

  return Effect.succeed(timeoutMs);
};

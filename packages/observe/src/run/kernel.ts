import { Effect, Fiber, type Scope } from "effect";
import { FlowStreamConfigError, FlowStreamRuntimeError, type FlowStreamError } from "@flowstream-re2/core";
import { getBuiltInCaptureDriver, getBuiltInSinkDriver } from "#builtins.js";
import type { CaptureDriver } from "#pipeline/capture/types.js";
import type { SinkDriver } from "#pipeline/publish/types.js";
import type { Board } from "./control/board/model.js";
import { setBoardRunPrepared, setBoardRunStatus } from "./control/board/model.js";
import { buildControlCatalog } from "./control/catalog.js";
import { createControlBus, stageCellSurface } from "./control/bus/bus.js";
import { applyWorkerSnapshotToBoard } from "./control/board/worker-snapshot.js";
import { validateBoardSettings } from "./control/board/settings.js";
import { createSystemPauseSurface } from "./control/system/pause.js";
import { createSystemRunSurface } from "./control/system/run.js";
import type { DescribeControlContext } from "./control/bus/types.js";
import type { ObserveRun } from "./run.js";
import type { ObserveRunHandle } from "./store.js";
import type { WorkerRunOutcome } from "./worker/worker.js";
import { runScopedWorkerUntilStoppedWithBoard } from "./worker/worker.js";
import { createWorkerBoardWake } from "./worker/wake.js";
import type { WorkerSnapshot } from "./worker/snapshot.js";
import type { SinkStageState } from "./worker/state.js";

export type { WorkerRunOutcome } from "./worker/worker.js";

export type ObserveRunOutcome = WorkerRunOutcome | "interrupted";

export interface ObserveRunResult {
  readonly outcome: ObserveRunOutcome;
  readonly board: Board;
  readonly snapshot?: WorkerSnapshot;
  readonly outputUri?: string;
}

export interface ObserveRunKernelOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injected capture drivers carry heterogeneous config shapes
  readonly captureDriver?: CaptureDriver<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injected sink drivers carry heterogeneous config shapes
  readonly sinkDriver?: SinkDriver<any>;
}

export const defaultObserveRunMaxTurns = 4096;

export const prepareObserveRun = (
  run: ObserveRun,
  options: ObserveRunKernelOptions = {}
): Effect.Effect<ObserveRun, FlowStreamError> =>
  Effect.gen(function* () {
    const captureDriver = yield* resolveCaptureDriver(run.config.capture.driverId, options);
    const sinkDriver = yield* resolveSinkDriver(run.config.sink.driverId, options);

    const captureConfig = yield* captureDriver.validate(run.config.capture.config);
    const sinkConfig = yield* sinkDriver.validate(run.config.sink.config);

    let board = setBoardRunStatus(run.board, "preparing", "validating observe run");

    const bus = yield* createControlBus({
      runId: run.config.runId,
      board,
      catalog: buildControlCatalog(),
      surfaces: [createSystemPauseSurface(), createSystemRunSurface()]
    });

    const nowMs = Date.now();
    const sinkInstanceId = run.config.sink.instanceId ?? "file-export";
    const captureContext: DescribeControlContext = {
      runId: run.config.runId,
      nowMs
    };
    const sinkContext: DescribeControlContext = {
      runId: run.config.runId,
      instanceId: sinkInstanceId,
      nowMs
    };

    const captureCell = yield* captureDriver.describeControl(captureConfig, captureContext);
    yield* bus.mountSurface(stageCellSurface(captureCell));

    const sinkCell = yield* sinkDriver.describeControl(sinkConfig, sinkContext);
    yield* bus.mountSurface(stageCellSurface(sinkCell));

    board = yield* bus.readBoard();
    yield* validateBoardSettings(board);

    board = setBoardRunStatus(board, "prepared", "observe run is ready to start");
    board = setBoardRunPrepared(board, true);
    yield* bus.commitBoard(board);

    return {
      config: run.config,
      board: yield* bus.readBoard(),
      bus,
      manifest: run.manifest,
      prepared: true
    };
  });

export const startObserveRun = (
  run: ObserveRun,
  options: ObserveRunKernelOptions & { readonly maxTurns?: number } = {}
): Effect.Effect<ObserveRunResult, FlowStreamError> => {
  if (run.prepared === false || run.bus === undefined) {
    return Effect.fail(
      new FlowStreamRuntimeError({
        message: "Observe run must be prepared before start"
      })
    );
  }

  const preparedBus = run.bus;

  return Effect.scoped(
    Effect.gen(function* () {
      const bus = preparedBus;

      yield* bus.commitBoard(
        setBoardRunStatus(yield* bus.readBoard(), "starting", "starting observe run")
      );

      const captureDriver = yield* resolveCaptureDriver(run.config.capture.driverId, options);
      const sinkDriver = yield* resolveSinkDriver(run.config.sink.driverId, options);

      const captureConfig = yield* captureDriver.validate(run.config.capture.config);
      const sinkConfig = yield* sinkDriver.validate(run.config.sink.config);

      const attachment = yield* sinkDriver.attach(sinkConfig);
      if (attachment.control !== undefined) {
        yield* bus.mountSurface(attachment.control);
      }

      const sinkInstanceId = run.config.sink.instanceId ?? "file-export";
      const sinks: Record<string, SinkStageState> = {
        [sinkInstanceId]: {
          attachment,
          finalized: false,
          deliveredItems: 0,
          drainedTracks: {}
        }
      };

      const boardWake = yield* createWorkerBoardWake();
      yield* bus.registerWakeWorker(() => boardWake.notify());

      const result = yield* runScopedWorkerUntilStoppedWithBoard({
        runId: run.config.runId,
        manifest: run.manifest,
        sinks,
        bus,
        boardWake,
        maxTurns: options.maxTurns ?? defaultObserveRunMaxTurns,
        prepareCapture: captureDriver.create(captureConfig)
      });

      const board = applyWorkerSnapshotToBoard(yield* bus.readBoard(), result.snapshot);
      yield* bus.commitBoard(board);

      return {
        outcome: result.outcome,
        board,
        snapshot: result.snapshot,
        outputUri: readOutputUri(result.snapshot, sinkInstanceId)
      };
    })
  );
};

export interface StartObserveRunAsyncInput {
  readonly run: ObserveRun;
  readonly options?: ObserveRunKernelOptions & { readonly maxTurns?: number };
}

export const startObserveRunAsync = (
  input: StartObserveRunAsyncInput
): Effect.Effect<ObserveRunHandle, FlowStreamError, Scope.Scope> =>
  Effect.gen(function* () {
    const { run, options } = input;

    if (run.prepared === false || run.bus === undefined) {
      return yield* Effect.fail(
        new FlowStreamRuntimeError({
          message: "Observe run must be prepared before start"
        })
      );
    }

    const fiber = yield* Effect.forkScoped(startObserveRun(run, options ?? {}));
    let interrupted = false;

    const handle: ObserveRunHandle = {
      runId: run.config.runId,
      run,
      bus: run.bus,
      startedAtMs: Date.now(),
      awaitResult: () => Fiber.join(fiber),
      interrupt: Effect.gen(function* () {
        if (interrupted) {
          return;
        }

        interrupted = true;
        yield* Fiber.interrupt(fiber);
      })
    };

    return handle;
  });

// --- helpers ---

const resolveSinkDriver = (
  sinkDriverId: string,
  options: ObserveRunKernelOptions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- built-in and injected drivers share one resolution path
): Effect.Effect<SinkDriver<any>, FlowStreamConfigError> => {
  if (options.sinkDriver !== undefined) {
    if (options.sinkDriver.descriptor.id !== sinkDriverId) {
      return Effect.fail(
        new FlowStreamConfigError({
          message: `Injected sink driver id "${options.sinkDriver.descriptor.id}" does not match requested "${sinkDriverId}"`
        })
      );
    }
    return Effect.succeed(options.sinkDriver);
  }

  if (sinkDriverId === "file") {
    return Effect.succeed(getBuiltInSinkDriver("file"));
  }

  return Effect.fail(
    new FlowStreamConfigError({
      message: `Unknown sink driver "${sinkDriverId}"`
    })
  );
};

const resolveCaptureDriver = (
  captureDriverId: string,
  options: ObserveRunKernelOptions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- built-in and injected drivers share one resolution path
): Effect.Effect<CaptureDriver<any>, FlowStreamConfigError> => {
  if (options.captureDriver !== undefined) {
    if (options.captureDriver.descriptor.id !== captureDriverId) {
      return Effect.fail(
        new FlowStreamConfigError({
          message: `Injected capture driver id "${options.captureDriver.descriptor.id}" does not match requested "${captureDriverId}"`
        })
      );
    }
    return Effect.succeed(options.captureDriver);
  }

  if (captureDriverId === "file") {
    return Effect.succeed(getBuiltInCaptureDriver("file"));
  }

  return Effect.fail(
    new FlowStreamConfigError({
      message: `Unknown capture driver "${captureDriverId}"`
    })
  );
};

const readOutputUri = (snapshot: WorkerSnapshot, sinkInstanceId: string): string | undefined => {
  const sink = snapshot.sinks[sinkInstanceId];
  if (sink === undefined) {
    return undefined;
  }
  return sink.finalizeResult?.output?.uri;
};

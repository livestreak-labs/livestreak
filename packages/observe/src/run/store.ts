import { Effect } from "effect";
import { FlowStreamConfigError, type FlowStreamError } from "@flowstream-re2/core";
import { validateArtifactIdInput } from "./artifact-id.js";
import type { ControlArtifact, ControlCallEnvelope, ControlCallResult } from "./control/bus/calls.js";
import type { ArtifactSubscription, BoardSubscription, ControlBus } from "./control/bus/types.js";
import type { ControlPanel } from "./control/bus/types.js";
import type { Board } from "./control/board/model.js";
import type { ObserveRunResult } from "./kernel.js";
import type { ObserveRun } from "./run.js";

export interface ObserveRunHandle {
  readonly runId: string;
  readonly run: ObserveRun;
  readonly bus: ControlBus;
  readonly startedAtMs: number;
  readonly awaitResult: () => Effect.Effect<ObserveRunResult, FlowStreamError>;
  readonly interrupt: Effect.Effect<void, FlowStreamError>;
}

const activeHandleExistsError = (runId: string) =>
  new FlowStreamConfigError({
    message: `Active handle for run ${runId} already exists in store`
  });

export const failIfActiveHandleExists = (
  store: RunStore,
  runId: string
): Effect.Effect<void, FlowStreamConfigError> =>
  Effect.gen(function* () {
    const existing = yield* store.getHandle(runId);
    if (existing !== undefined) {
      return yield* Effect.fail(activeHandleExistsError(runId));
    }
  });

export interface RunStore {
  readonly put: (run: ObserveRun) => Effect.Effect<void, FlowStreamConfigError>;
  readonly get: (runId: string) => Effect.Effect<ObserveRun | undefined>;
  readonly require: (runId: string) => Effect.Effect<ObserveRun, FlowStreamConfigError>;
  readonly remove: (runId: string) => Effect.Effect<void>;
  readonly list: () => Effect.Effect<readonly ObserveRun[]>;

  readonly putHandle: (handle: ObserveRunHandle) => Effect.Effect<void, FlowStreamConfigError>;
  readonly getHandle: (runId: string) => Effect.Effect<ObserveRunHandle | undefined>;
  readonly requireHandle: (runId: string) => Effect.Effect<ObserveRunHandle, FlowStreamConfigError>;
  readonly removeHandle: (runId: string) => Effect.Effect<void>;
  readonly listHandles: () => Effect.Effect<readonly ObserveRunHandle[]>;
}

export const createRunStore = (): RunStore => {
  const runs = new Map<string, ObserveRun>();
  const runInsertionOrder: string[] = [];
  const handles = new Map<string, ObserveRunHandle>();
  const handleInsertionOrder: string[] = [];

  return {
    put: (run) => {
      const runId = run.config.runId;
      if (runs.has(runId)) {
        return Effect.fail(
          new FlowStreamConfigError({
            message: `Run ${runId} already exists in store`
          })
        );
      }

      return Effect.sync(() => {
        runs.set(runId, run);
        runInsertionOrder.push(runId);
      });
    },

    get: (runId) => Effect.succeed(runs.get(runId)),

    require: (runId) => {
      const run = runs.get(runId);
      if (run === undefined) {
        return Effect.fail(
          new FlowStreamConfigError({
            message: `Run ${runId} not found in store`
          })
        );
      }

      return Effect.succeed(run);
    },

    remove: (runId) =>
      Effect.sync(() => {
        if (!runs.delete(runId)) {
          return;
        }

        const index = runInsertionOrder.indexOf(runId);
        if (index !== -1) {
          runInsertionOrder.splice(index, 1);
        }
      }),

    list: () => Effect.succeed(runInsertionOrder.map((id) => runs.get(id)!)),

    putHandle: (handle) => {
      const runId = handle.runId;
      if (handles.has(runId)) {
        return Effect.fail(activeHandleExistsError(runId));
      }

      return Effect.sync(() => {
        handles.set(runId, handle);
        handleInsertionOrder.push(runId);
      });
    },

    getHandle: (runId) => Effect.succeed(handles.get(runId)),

    requireHandle: (runId) => {
      const handle = handles.get(runId);
      if (handle === undefined) {
        return Effect.fail(
          new FlowStreamConfigError({
            message: `Active handle for run ${runId} not found in store`
          })
        );
      }

      return Effect.succeed(handle);
    },

    removeHandle: (runId) =>
      Effect.sync(() => {
        if (!handles.delete(runId)) {
          return;
        }

        const index = handleInsertionOrder.indexOf(runId);
        if (index !== -1) {
          handleInsertionOrder.splice(index, 1);
        }
      }),

    listHandles: () => Effect.succeed(handleInsertionOrder.map((id) => handles.get(id)!))
  };
};

export const readStoredRunBoard = (
  store: RunStore,
  runId: string
): Effect.Effect<Board, FlowStreamError> =>
  Effect.gen(function* () {
    const bus = yield* resolveStoredRunBus(store, runId);
    return yield* bus.readBoard();
  });

export const readStoredRunPanel = (
  store: RunStore,
  runId: string,
  options?: { readonly includeCatalog?: boolean }
): Effect.Effect<ControlPanel, FlowStreamError> =>
  Effect.gen(function* () {
    const bus = yield* resolveStoredRunBus(store, runId);
    return yield* bus.readPanel(options);
  });

export const getStoredRunArtifact = (
  store: RunStore,
  runId: string,
  artifactId: unknown
): Effect.Effect<ControlArtifact, FlowStreamError> =>
  Effect.gen(function* () {
    const validArtifactId = yield* validateArtifactIdInput(artifactId);
    const bus = yield* resolveStoredRunBus(store, runId);
    const artifact = yield* bus.getArtifact(validArtifactId);

    if (artifact === undefined) {
      return yield* Effect.fail(
        new FlowStreamConfigError({
          message: `Artifact ${validArtifactId} not found for run ${runId}`
        })
      );
    }

    return artifact;
  });

export const subscribeStoredRunBoard = (
  store: RunStore,
  runId: string,
  listener: (board: Board) => void
): Effect.Effect<BoardSubscription, FlowStreamError> =>
  Effect.gen(function* () {
    const bus = yield* resolveStoredRunBus(store, runId);
    return yield* bus.subscribeBoard(listener);
  });

export const subscribeStoredRunArtifacts = (
  store: RunStore,
  runId: string,
  listener: (artifact: ControlArtifact) => void
): Effect.Effect<ArtifactSubscription, FlowStreamError> =>
  Effect.gen(function* () {
    const bus = yield* resolveStoredRunBus(store, runId);
    return yield* bus.subscribeArtifacts(listener);
  });

export const callStoredRunFunction = (
  store: RunStore,
  envelope: ControlCallEnvelope
): Effect.Effect<ControlCallResult, FlowStreamError> =>
  Effect.gen(function* () {
    const bus = yield* resolveStoredRunBus(store, envelope.runId);
    return yield* bus.callFunction(envelope);
  });

const resolveStoredRunBus = (
  store: RunStore,
  runId: string
): Effect.Effect<ControlBus, FlowStreamError> =>
  Effect.gen(function* () {
    const handle = yield* store.getHandle(runId);
    if (handle !== undefined) {
      return handle.bus;
    }

    const run = yield* store.require(runId);
    if (run.bus === undefined) {
      return yield* Effect.fail(
        new FlowStreamConfigError({
          message: `Run ${runId} has no control bus`
        })
      );
    }

    return run.bus;
  });

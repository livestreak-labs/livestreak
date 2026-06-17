import type { FlowStreamError } from "@flowstream-re2/core";
import type { OutputMode } from "@flowstream-re2/schema";
import type { Effect, Scope } from "effect";
import type { PausePresentation } from "#pipeline/capture/pause.js";
import type { TimelineMarker } from "#pipeline/timeline/index.js";
import type { RegistryDescriptorBase, StageHealthSnapshotBase } from "#pipeline/shared.js";
import type {
  ControlCellDefinition,
  ControlSurface,
  DescribeControlContext
} from "#run/control/bus/types.js";

export type {
  DescriptorValueSchema,
  RegistryCommandDescriptor,
  RegistryCommandScope,
  RegistryDescriptorKind,
  RegistryFlagDescriptor,
  StageHealth
} from "#pipeline/shared.js";

export interface SinkDriverDescriptor extends RegistryDescriptorBase<"publish"> {
  readonly mode: OutputMode;
  readonly requiresHost: boolean;
  readonly debugOnly: boolean;
}

export interface SinkStageHealth extends StageHealthSnapshotBase<"publish"> {
  readonly attachmentId?: string;
  readonly deliveredItems: number;
  readonly deliveryFps?: number;
}

export interface VideoSinkDeliveryItem<Payload = unknown> {
  readonly kind: "video";
  readonly sinkId: string;
  readonly trackId: string;
  readonly role: string;
  readonly sequence: number;
  readonly epoch: number;
  readonly mediaTimeMs: number;
  readonly wallTimeMs: number;
  readonly payloadBytes: number;
  readonly payload: Payload;
}

export interface MarkerSinkDeliveryItem {
  readonly kind: "marker";
  readonly sinkId: string;
  readonly trackId: string;
  readonly role: string;
  readonly sequence: number;
  readonly epoch: number;
  readonly mediaTimeMs?: number;
  readonly wallTimeMs: number;
  readonly marker: TimelineMarker;
}

export type SinkDeliveryItem<Payload = unknown> =
  | VideoSinkDeliveryItem<Payload>
  | MarkerSinkDeliveryItem;

export interface SinkFinalizeResult {
  readonly deliveredItems: number;
  readonly output?: {
    readonly kind: "file" | "memory" | "simulcast";
    readonly uri?: string;
  };
}

export interface SinkPausePresentation {
  readonly whilePaused: PausePresentation;
  readonly slateAssetId?: string;
}

export interface SinkPresentationControls {
  readonly pausePresentation: (
    presentation: SinkPausePresentation
  ) => Effect.Effect<void, FlowStreamError>;

  readonly resumePresentation: Effect.Effect<void, FlowStreamError>;
}

export interface SinkAttachment {
  readonly id: string;
  readonly deliver: (item: SinkDeliveryItem) => Effect.Effect<void, FlowStreamError>;
  readonly finalize: Effect.Effect<SinkFinalizeResult, FlowStreamError>;
  readonly health: Effect.Effect<SinkStageHealth, FlowStreamError>;
  readonly detach: Effect.Effect<void, FlowStreamError>;
  readonly control?: ControlSurface;
  readonly presentation?: SinkPresentationControls;
}

export interface SinkDriver<Config = unknown> {
  readonly descriptor: SinkDriverDescriptor;
  readonly mode: OutputMode;
  readonly validate: (config: Config) => Effect.Effect<Config, FlowStreamError>;
  readonly attach: (config: Config) => Effect.Effect<SinkAttachment, FlowStreamError, Scope.Scope>;
  readonly describeControl: (
    config: Config,
    context: DescribeControlContext
  ) => Effect.Effect<ControlCellDefinition, FlowStreamError>;
}

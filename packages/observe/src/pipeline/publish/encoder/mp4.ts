import { Effect } from "effect";
import {
  FlowStreamConfigError,
  FlowStreamRuntimeError,
  type FlowStreamError
} from "@flowstream-re2/core";
import {
  concatBytes,
  bytesToUtf8,
  spawnChild,
  validateVideoDimensions,
  waitForProcessClose,
  writeStdinWithBackpressure,
  type FfmpegBinaries,
  type NodeChildProcess
} from "#adapters/ffmpeg/index.js";

export type Mp4EncoderInputFormat = "rgb" | "jpeg" | "png";

export interface Mp4VideoEncoderConfig {
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly inputFormat: Mp4EncoderInputFormat;
  readonly binaries?: FfmpegBinaries;
}

export interface RgbMp4EncoderConfig {
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly binaries?: FfmpegBinaries;
}

export interface Mp4VideoEncoder {
  readonly writeFrame: (data: Uint8Array) => Effect.Effect<void, FlowStreamError>;
  readonly finalize: Effect.Effect<{ readonly outputPath: string }, FlowStreamError>;
}

export type RgbMp4Encoder = Mp4VideoEncoder;

export const createMp4VideoEncoder = (
  config: Mp4VideoEncoderConfig
): Effect.Effect<Mp4VideoEncoder, FlowStreamError> => {
  if (config.inputFormat === "rgb") {
    return createRgbMp4Encoder(config);
  }

  return createImageSequenceMp4Encoder(config);
};

export const createRgbMp4Encoder = (
  config: RgbMp4EncoderConfig
): Effect.Effect<RgbMp4Encoder, FlowStreamError> =>
  Effect.gen(function* () {
    yield* validateVideoDimensions(config.width, config.height);
    yield* validateFps(config.fps);

    const frameSize = config.width * config.height * 3;
    const ffmpeg = config.binaries?.ffmpegPath ?? "ffmpeg";
    const encodeArguments = makeFfmpegMp4EncodeArguments(config);
    const child = yield* spawnChild(ffmpeg, encodeArguments);
    const stderr: Uint8Array[] = [];
    let finalized = false;
    let closed = false;

    child.stderr.on("data", (chunk) => stderr.push(chunk));

    const writeFrame = (data: Uint8Array): Effect.Effect<void, FlowStreamError> => {
      if (finalized) {
        return Effect.fail(new FlowStreamRuntimeError({ message: "MP4 encoder is finalized" }));
      }
      if (data.byteLength !== frameSize) {
        return Effect.fail(
          new FlowStreamRuntimeError({
            message: "MP4 encoder received a frame with the wrong byte length",
            metadata: {
              details: `expected ${frameSize}, received ${data.byteLength}`
            }
          })
        );
      }

      return writeStdinWithBackpressure(child.stdin, data, "MP4 encoder");
    };

    const finalize = Effect.gen(function* () {
      if (finalized) {
        return { outputPath: config.outputPath };
      }
      finalized = true;
      child.stdin.end();

      if (closed === false) {
        yield* waitForProcessClose(child, stderr, "MP4 encoder");
        closed = true;
      }

      return { outputPath: config.outputPath };
    });

    return {
      writeFrame,
      finalize
    };
  });

export const createImageSequenceMp4Encoder = (
  config: Mp4VideoEncoderConfig
): Effect.Effect<Mp4VideoEncoder, FlowStreamError> =>
  Effect.gen(function* () {
    yield* validateVideoDimensions(config.width, config.height);
    yield* validateFps(config.fps);

    if (config.inputFormat !== "jpeg" && config.inputFormat !== "png") {
      return yield* Effect.fail(
        new FlowStreamConfigError({
          message: "Image sequence MP4 encoder requires jpeg or png input"
        })
      );
    }

    const ffmpeg = config.binaries?.ffmpegPath ?? "ffmpeg";
    const encodeArguments = makeFfmpegImageSequenceMp4EncodeArguments(config);
    const child = yield* spawnChild(ffmpeg, encodeArguments);
    const stderr: Uint8Array[] = [];
    let finalized = false;
    let closed = false;

    child.stderr.on("data", (chunk) => stderr.push(chunk));

    const writeFrame = (data: Uint8Array): Effect.Effect<void, FlowStreamError> => {
      if (finalized) {
        return Effect.fail(new FlowStreamRuntimeError({ message: "MP4 encoder is finalized" }));
      }
      if (data.byteLength === 0) {
        return Effect.fail(
          new FlowStreamRuntimeError({
            message: "MP4 encoder received an empty image frame"
          })
        );
      }

      return writeStdinWithBackpressure(child.stdin, data, "MP4 encoder");
    };

    const finalize = Effect.gen(function* () {
      if (finalized) {
        return { outputPath: config.outputPath };
      }
      finalized = true;
      child.stdin.end();

      if (closed === false) {
        yield* waitForProcessClose(child, stderr, "MP4 encoder");
        closed = true;
      }

      return { outputPath: config.outputPath };
    });

    return {
      writeFrame,
      finalize
    };
  });

export const makeFfmpegImageSequenceMp4EncodeArguments = (
  config: Mp4VideoEncoderConfig
): readonly string[] => {
  const vcodec = config.inputFormat === "png" ? "png" : "mjpeg";

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "image2pipe",
    "-vcodec",
    vcodec,
    "-framerate",
    config.fps.toString(),
    "-i",
    "pipe:0",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    config.outputPath
  ];
};

export const makeFfmpegMp4EncodeArguments = (config: RgbMp4EncoderConfig): readonly string[] => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "rawvideo",
  "-pix_fmt",
  "rgb24",
  "-s",
  `${config.width}x${config.height}`,
  "-r",
  config.fps.toString(),
  "-i",
  "pipe:0",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "23",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  config.outputPath
];

// --- helpers ---

const validateFps = (fps: number): Effect.Effect<void, FlowStreamConfigError> => {
  if (!Number.isFinite(fps)) {
    return Effect.fail(
      new FlowStreamConfigError({
        message: "MP4 encoder fps must be a finite number"
      })
    );
  }
  if (fps <= 0) {
    return Effect.fail(
      new FlowStreamConfigError({
        message: "MP4 encoder fps must be greater than zero"
      })
    );
  }

  return Effect.void;
};

export const readProcessFailure = (
  child: NodeChildProcess,
  stderrChunks: readonly Uint8Array[],
  label: string
): FlowStreamRuntimeError =>
  new FlowStreamRuntimeError({
    message: `${label} failed`,
    metadata: {
      details: bytesToUtf8(concatBytes(stderrChunks)).trim()
    }
  });

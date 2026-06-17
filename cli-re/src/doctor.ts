import { Console, Effect } from "effect";
import {
  readFootballAssetReadiness,
  readinessView,
  type FootballAssetCliOptions
} from "./assets.js";
import { formatCliError } from "./cli-error.js";

const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2));

export const doctorPayload = (
  summary: Parameters<typeof readinessView>[0]
) => ({
  ok: summary.ready,
  command: "doctor",
  status: summary.ready ? "ready" : "not-ready",
  message: "Inspected local FlowStream readiness without changing state.",
  footballAssets: readinessView(summary)
});

export const runDoctor = (options: FootballAssetCliOptions) =>
  readFootballAssetReadiness(options).pipe(
    Effect.map(doctorPayload),
    Effect.catchAll((error) =>
      Effect.succeed({
        ok: false,
        command: "doctor",
        status: "sdk-error",
        message: "Doctor could not inspect football asset readiness.",
        error: formatCliError(error)
      })
    ),
    Effect.flatMap(printJson)
  );

import { Console, Effect, Option } from "effect";
import {
  summarizeFootballAssetReadiness,
  verifyFootballAssets,
  type FootballAssetReadinessSummary
} from "@flowstream-re/sdk-stats";
import { formatCliError } from "./cli-error.js";

export interface FootballAssetCliOptions {
  readonly assetRoot?: string;
}

export const optionValue = <A>(value: Option.Option<A>): A | undefined =>
  Option.match(value, {
    onNone: () => undefined,
    onSome: (item) => item
  });

const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2));

export const repairHint = (summary: FootballAssetReadinessSummary): string =>
  summary.ready
    ? "No repair needed; football assets are verified."
    : `Run flowstream-re assets repair football --asset-root ${summary.assetRoot} to inspect the scaffolded host/LFS/R2 repair path. This CLI does not download assets yet.`;

export const readinessView = (summary: FootballAssetReadinessSummary) => ({
  assetRoot: summary.assetRoot,
  ready: summary.ready,
  total: summary.total,
  readyCount: summary.readyCount,
  failureCount: summary.failureCount,
  byStatus: summary.byStatus,
  checkedAtMs: summary.checkedAtMs,
  repairHint: repairHint(summary)
});

export const readFootballAssetReadiness = (
  options: FootballAssetCliOptions
) =>
  Effect.map(
    verifyFootballAssets({ assetRoot: options.assetRoot }),
    (report) => summarizeFootballAssetReadiness(report)
  );

export const footballAssetsVerifyPayload = (
  summary: FootballAssetReadinessSummary
) => ({
  ok: summary.ready,
  command: "assets verify football",
  status: summary.ready ? "ready" : "not-ready",
  message: summary.message,
  footballAssets: readinessView(summary)
});

export const footballAssetsRepairPayload = (
  summary: FootballAssetReadinessSummary
) => ({
  ok: false,
  command: "assets repair football",
  status: "repair-scaffold",
  message:
    "Football asset repair is intentionally scaffolded; no files were downloaded or modified.",
  footballAssets: readinessView(summary),
  repair: {
    mutation: false,
    retryable: false,
    docsPath: "context/v2/06-implementation-roadmap.md#m2-football-pack-assets-and-python-cv",
    futurePath: [
      "resolve signed host asset manifest",
      "prefer verified Git LFS object when available",
      "fallback to hosted R2 content-addressed weights",
      "write only after size and SHA-256 verification"
    ],
    hint:
      "Until the host/LFS/R2 repair path is wired, place the canonical weights in assetRoot or set FLOWSTREAM_FOOTBALL_ASSET_ROOT."
  }
});

export const runFootballAssetsVerify = (options: FootballAssetCliOptions) =>
  readFootballAssetReadiness(options).pipe(
    Effect.map(footballAssetsVerifyPayload),
    Effect.catchAll((error) =>
      Effect.succeed({
        ok: false,
        command: "assets verify football",
        status: "sdk-error",
        message: "Football asset verification failed before readiness could be reported.",
        error: formatCliError(error)
      })
    ),
    Effect.flatMap(printJson)
  );

export const runFootballAssetsRepair = (options: FootballAssetCliOptions) =>
  readFootballAssetReadiness(options).pipe(
    Effect.map(footballAssetsRepairPayload),
    Effect.catchAll((error) =>
      Effect.succeed({
        ok: false,
        command: "assets repair football",
        status: "sdk-error",
        message: "Football asset repair scaffold could not inspect readiness.",
        repair: {
          mutation: false,
          retryable: false,
          docsPath:
            "context/v2/06-implementation-roadmap.md#m2-football-pack-assets-and-python-cv"
        },
        error: formatCliError(error)
      })
    ),
    Effect.flatMap(printJson)
  );

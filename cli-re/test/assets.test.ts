import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  footballAssetsRepairPayload,
  footballAssetsVerifyPayload,
  readFootballAssetReadiness
} from "../src/assets.js";
import { doctorPayload } from "../src/doctor.js";

const withTempDir = async <A>(run: (dir: string) => Promise<A>): Promise<A> => {
  const dir = await mkdtemp(join(tmpdir(), "flowstream-cli-assets-"));

  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe("football asset CLI readiness", () => {
  it("builds doctor JSON around SDK football asset readiness without mutating", async () =>
    withTempDir(async (dir) => {
      const summary = await Effect.runPromise(
        readFootballAssetReadiness({ assetRoot: dir })
      );
      const payload = doctorPayload(summary);

      expect(payload.command).toBe("doctor");
      expect(payload.status).toBe("not-ready");
      expect(payload.footballAssets.assetRoot).toBe(dir);
      expect(payload.footballAssets.readyCount).toBe(0);
      expect(payload.footballAssets.failureCount).toBe(3);
      expect(payload.footballAssets.byStatus.missing).toBe(3);
      expect(payload.footballAssets.repairHint).toContain("assets repair football");
    }));

  it("builds assets verify football JSON from SDK readiness", async () =>
    withTempDir(async (dir) => {
      const summary = await Effect.runPromise(
        readFootballAssetReadiness({ assetRoot: dir })
      );
      const payload = footballAssetsVerifyPayload(summary);

      expect(payload.command).toBe("assets verify football");
      expect(payload.ok).toBe(false);
      expect(payload.status).toBe("not-ready");
      expect(payload.footballAssets.assetRoot).toBe(dir);
      expect(payload.footballAssets.failureCount).toBe(3);
      expect(payload.footballAssets.byStatus.ready).toBe(0);
    }));

  it("builds a non-mutating assets repair football scaffold", async () =>
    withTempDir(async (dir) => {
      const summary = await Effect.runPromise(
        readFootballAssetReadiness({ assetRoot: dir })
      );
      const payload = footballAssetsRepairPayload(summary);

      expect(payload.command).toBe("assets repair football");
      expect(payload.status).toBe("repair-scaffold");
      expect(payload.message).toContain("no files were downloaded or modified");
      expect(payload.repair.mutation).toBe(false);
      expect(payload.repair.futurePath).toContain(
        "fallback to hosted R2 content-addressed weights"
      );
      expect(payload.footballAssets.failureCount).toBe(3);
    }));
});

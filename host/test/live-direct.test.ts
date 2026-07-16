import { describe, expect, it } from "vitest";
import {
  createDirectAnnounceStore,
  handleDirectAnnounce,
  handleDirectLookup,
  handleDirectWithdraw,
  handleReachabilityEcho,
  type TcpDialer
} from "../src/services/live/direct.js";

describe("direct announce store", () => {
  it("announces, looks up, withdraws", () => {
    const store = createDirectAnnounceStore();

    const announced = handleDirectAnnounce("m1", { watchUrl: "ws://84.12.9.3:48700/live/watch/m1" }, store);
    expect(announced.ok).toBe(true);
    if (announced.ok) expect(announced.status).toBe(201);

    const found = handleDirectLookup("m1", store);
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.result.watchUrl).toBe("ws://84.12.9.3:48700/live/watch/m1");

    const withdrawn = handleDirectWithdraw("m1", store);
    expect(withdrawn.ok).toBe(true);
    if (withdrawn.ok) expect(withdrawn.result.withdrawn).toBe(true);

    expect(handleDirectLookup("m1", store).ok).toBe(false);
  });

  it("rejects a non-ws watch URL and a blank stream id", () => {
    const store = createDirectAnnounceStore();
    const badUrl = handleDirectAnnounce("m1", { watchUrl: "http://84.12.9.3/x" }, store);
    expect(badUrl.ok).toBe(false);
    if (!badUrl.ok) expect(badUrl.status).toBe(400);

    const blank = handleDirectAnnounce("  ", { watchUrl: "ws://a/b" }, store);
    expect(blank.ok).toBe(false);
  });

  it("re-announce replaces the previous door", () => {
    const store = createDirectAnnounceStore();
    handleDirectAnnounce("m1", { watchUrl: "ws://a:1/live/watch/m1" }, store);
    handleDirectAnnounce("m1", { watchUrl: "ws://b:2/live/watch/m1" }, store);
    const found = handleDirectLookup("m1", store);
    if (found.ok) expect(found.result.watchUrl).toBe("ws://b:2/live/watch/m1");
  });

  it("404s an unknown stream", () => {
    const result = handleDirectLookup("nope", createDirectAnnounceStore());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

describe("reachability echo", () => {
  const dialerRecording = (): { dialed: Array<{ ip: string; port: number }>; dial: TcpDialer } => {
    const dialed: Array<{ ip: string; port: number }> = [];
    return {
      dialed,
      dial: async (ip, port) => {
        dialed.push({ ip, port });
        return true;
      }
    };
  };

  it("dials ONLY the caller's own observed address (no SSRF surface)", async () => {
    const { dialed, dial } = dialerRecording();
    const result = await handleReachabilityEcho({ port: 48700 }, "84.12.9.3", dial);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result).toEqual({ reachable: true, dialedIp: "84.12.9.3", dialedPort: 48700 });
    expect(dialed).toEqual([{ ip: "84.12.9.3", port: 48700 }]);
  });

  it("unwraps IPv6-mapped IPv4 callers", async () => {
    const { dialed, dial } = dialerRecording();
    await handleReachabilityEcho({ port: 48700 }, "::ffff:84.12.9.3", dial);
    expect(dialed[0]?.ip).toBe("84.12.9.3");
  });

  it("reports an unreachable door honestly", async () => {
    const result = await handleReachabilityEcho({ port: 48700 }, "84.12.9.3", async () => false);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.reachable).toBe(false);
  });

  it("rejects a bad port and a missing caller address", async () => {
    expect((await handleReachabilityEcho({ port: 0 }, "1.2.3.4")).ok).toBe(false);
    expect((await handleReachabilityEcho({ port: 70000 }, "1.2.3.4")).ok).toBe(false);
    expect((await handleReachabilityEcho({ port: 48700 }, undefined)).ok).toBe(false);
  });
});

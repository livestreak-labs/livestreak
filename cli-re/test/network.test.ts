import { describe, expect, it } from "vitest";
import {
  networkDoctorInvalidPayload,
  networkDoctorPayload,
  parseNetworkDoctorRequest
} from "../src/network.js";

describe("host network CLI scaffold", () => {
  it("accepts all network doctor modes", () => {
    for (const mode of ["hosted", "local-dev", "lan", "degraded"] as const) {
      expect(parseNetworkDoctorRequest({ mode })).toEqual({
        _tag: "network",
        mode,
        provider: "generic"
      });
    }
  });

  it("adds the Cloudflare WHIP/WHEP paired-only note", () => {
    const request = parseNetworkDoctorRequest({
      mode: "hosted",
      provider: "cloudflare"
    });

    expect(request._tag).toBe("network");
    if (request._tag === "network") {
      const serialized = JSON.stringify(networkDoctorPayload(request));

      expect(serialized).toContain("WHIP/WHEP paired-only");
      expect(serialized).toContain("No mixed WHIP-to-HLS/DASH");
    }
  });

  it("hosted output says outbound-only 443 and probed false", () => {
    const request = parseNetworkDoctorRequest({
      mode: "hosted",
      provider: "generic"
    });

    expect(request._tag).toBe("network");
    if (request._tag === "network") {
      const payload = networkDoctorPayload(request);
      const serialized = JSON.stringify(payload);

      expect(payload.probed).toBe(false);
      expect(payload.portsOpened).toBe(false);
      expect(payload.hostLoginRequired).toBe(false);
      expect(serialized).toContain("outbound-only HTTPS/TLS on port 443");
      expect(serialized).toContain("outbound tcp/443");
    }
  });

  it("lan output warns and says host cache policy remains separate", () => {
    const request = parseNetworkDoctorRequest({
      mode: "lan",
      provider: "generic"
    });

    expect(request._tag).toBe("network");
    if (request._tag === "network") {
      const serialized = JSON.stringify(networkDoctorPayload(request));

      expect(serialized).toContain("personal/risky");
      expect(serialized).toContain("host cache policy remains separate");
      expect(serialized).toContain("portsOpened");
    }
  });

  it("rejects invalid mode and provider through the parser helper", () => {
    const request = parseNetworkDoctorRequest({
      mode: "cache",
      provider: "host"
    });

    expect(request._tag).toBe("invalid");
    if (request._tag === "invalid") {
      expect(request.errors).toContain(
        "host network requires --mode hosted|local-dev|lan|degraded."
      );
      expect(request.errors).toContain(
        "host network accepts --provider cloudflare|generic."
      );
      expect(networkDoctorInvalidPayload(request.errors)).toMatchObject({
        ok: false,
        command: "host network",
        status: "invalid",
        probed: false,
        portsOpened: false,
        hostLoginRequired: false
      });
    }
  });
});


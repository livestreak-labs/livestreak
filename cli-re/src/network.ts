import { Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

export type NetworkDoctorMode = "hosted" | "local-dev" | "lan" | "degraded";
export type NetworkDoctorProvider = "cloudflare" | "generic";

export interface NetworkDoctorCliOptions {
  readonly mode?: string;
  readonly provider?: string;
}

export type NetworkDoctorRequest =
  | { readonly _tag: "invalid"; readonly errors: readonly string[] }
  | {
      readonly _tag: "network";
      readonly mode: NetworkDoctorMode;
      readonly provider: NetworkDoctorProvider;
    };

const acceptedModes = ["hosted", "local-dev", "lan", "degraded"] as const;
const acceptedProviders = ["cloudflare", "generic"] as const;

const hostBinding = {
  selectedProvider: null,
  loggedIn: false,
  configBound: false,
  message:
    "No host login or provider network config is bound in this CLI; network output is a display scaffold only."
} as const;

const ownership = {
  cli: "Parses arguments and displays network readiness scaffolds.",
  sdk: "Owns host/provider policy behavior and future network capability checks.",
  hostProvider:
    "Owns real relay/SFU/TURN configuration, endpoint manifests, provider auth, and live evidence.",
  steward: "Not involved; host is not steward."
} as const;

const optionValue = <A>(value: Option.Option<A>): A | undefined =>
  Option.match(value, {
    onNone: () => undefined,
    onSome: (item) => item
  });

const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2));

const parseMode = (value: string | undefined): NetworkDoctorMode | undefined =>
  acceptedModes.includes(value as NetworkDoctorMode)
    ? (value as NetworkDoctorMode)
    : undefined;

const parseProvider = (
  value: string | undefined
): NetworkDoctorProvider | undefined =>
  value === undefined
    ? "generic"
    : acceptedProviders.includes(value as NetworkDoctorProvider)
      ? (value as NetworkDoctorProvider)
      : undefined;

export const networkDoctorOptions = {
  mode: Options.text("mode").pipe(
    Options.withDescription(
      "Network mode to explain. Accepted: hosted, local-dev, lan, degraded."
    )
  ),
  provider: Options.text("provider").pipe(
    Options.optional,
    Options.withDescription("Optional provider hint. Accepted: cloudflare, generic.")
  )
};

export const normalizeNetworkDoctorOptions = (options: {
  readonly mode: string;
  readonly provider: Option.Option<string>;
}): NetworkDoctorCliOptions => ({
  mode: options.mode,
  provider: optionValue(options.provider)
});

export const parseNetworkDoctorRequest = (
  options: NetworkDoctorCliOptions
): NetworkDoctorRequest => {
  const errors: string[] = [];
  const mode = parseMode(options.mode);
  const provider = parseProvider(options.provider);

  if (mode === undefined) {
    errors.push("host network requires --mode hosted|local-dev|lan|degraded.");
  }

  if (provider === undefined) {
    errors.push("host network accepts --provider cloudflare|generic.");
  }

  return errors.length > 0
    ? { _tag: "invalid", errors }
    : {
        _tag: "network",
        mode: mode!,
        provider: provider!
      };
};

const modeGuidance = (mode: NetworkDoctorMode) => {
  switch (mode) {
    case "hosted":
      return {
        summary:
          "Hosted mode should default to outbound-only HTTPS/TLS on port 443 from the broadcaster or host process.",
        recommendedPorts: ["outbound tcp/443"],
        notes: [
          "Do not require inbound public ports on the operator machine for hosted output.",
          "Use provider relay/fallback paths when UDP, peer-to-peer media, CGNAT, corporate firewalls, or captive networks block direct connectivity.",
          "The CLI did not verify that a provider relay is configured."
        ]
      };
    case "local-dev":
      return {
        summary:
          "Local debug mode is localhost-only and should not imply public exposure.",
        recommendedPorts: ["127.0.0.1 only"],
        notes: [
          "Use this for local development loops, demos, and SDK adapter work.",
          "No LAN or internet listener was opened by this command.",
          "Public ingress, provider login, and cache evidence remain outside this scaffold."
        ]
      };
    case "lan":
      return {
        summary:
          "LAN mode can expose local ports to nearby devices; that is personal/risky and should be treated as an explicit operator choice.",
        recommendedPorts: ["operator-selected LAN ports only"],
        notes: [
          "The CLI did not open firewall rules, routers, tunnels, NAT mappings, or local listeners.",
          "host cache policy remains separate and still applies unless a debug/local policy mode explicitly skips it.",
          "Prefer hosted outbound-only mode for viewers outside the trusted LAN."
        ]
      };
    case "degraded":
      return {
        summary:
          "Degraded mode explains the fallback shape for locked networks without claiming TURN, TCP, or TLS relay has been configured.",
        recommendedPorts: ["outbound tcp/443 when available"],
        notes: [
          "Locked networks include CGNAT, corporate firewalls, UDP blocks, captive networks, and restrictive egress policies.",
          "A future provider integration may use TURN/TCP/TLS or equivalent relay fallback for media/control paths.",
          "This command did not probe TURN, SFU, browser media, or provider relay health."
        ]
      };
  }
};

const providerGuidance = (provider: NetworkDoctorProvider) =>
  provider === "cloudflare"
    ? {
        provider,
        notes: [
          "Cloudflare-style WebRTC media graphs are modeled as WHIP/WHEP paired-only.",
          "No mixed WHIP-to-HLS/DASH or mixed protocol egress is claimed by this scaffold.",
          "Provider login and endpoint provisioning are not performed by this CLI command."
        ]
      }
    : {
        provider,
        notes: [
          "Generic provider mode does not assume a specific SFU, TURN service, relay product, or protocol bridge.",
          "Provider-specific constraints should come from the SDK/host provider once bound."
        ]
      };

export const networkDoctorPayload = (
  request: Extract<NetworkDoctorRequest, { readonly _tag: "network" }>
) => ({
  ok: true,
  command: "host network",
  status: "scaffold",
  probed: false,
  portsOpened: false,
  hostLoginRequired: false,
  message:
    "Network doctor scaffold only. The CLI explains expected connectivity shapes and does not perform real probes or mutate network state.",
  acceptedArgs: {
    mode: request.mode,
    provider: request.provider
  },
  binding: hostBinding,
  ownership,
  mode: modeGuidance(request.mode),
  provider: providerGuidance(request.provider),
  limitations: [
    "No TURN, SFU, WHIP, WHEP, browser, provider login, DNS, firewall, CGNAT, or port reachability probe was run.",
    "No local, LAN, router, cloud firewall, tunnel, or provider port was opened.",
    "Cache is still host policy/evidence and is not an output mode."
  ],
  nextIntegrationStep:
    "Bind this display surface to SDK/host-provider network capability descriptors and relay health evidence when a real provider is selected."
});

export const networkDoctorInvalidPayload = (errors: readonly string[]) => ({
  ok: false,
  command: "host network",
  status: "invalid",
  probed: false,
  portsOpened: false,
  hostLoginRequired: false,
  errors
});

export const runNetworkDoctor = (
  options: NetworkDoctorCliOptions
): Effect.Effect<void> => {
  const request = parseNetworkDoctorRequest(options);
  return request._tag === "invalid"
    ? printJson(networkDoctorInvalidPayload(request.errors))
    : printJson(networkDoctorPayload(request));
};


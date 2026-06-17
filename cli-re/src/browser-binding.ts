import { Effect } from "effect";
import { FlowStreamCapabilityError, type FlowStreamError } from "@flowstream-re/core";
import {
  makeBrowserPageFactoryCaptureAdapter,
  type BrowserCaptureOpenOptions,
  type BrowserPageCaptureAdapterKind
} from "@flowstream-re/sdk-stats";

export type BrowserBindingKind = BrowserPageCaptureAdapterKind;

export interface BrowserBindingCliOptions {
  readonly browserKind?: BrowserBindingKind;
  readonly browserEndpoint?: string;
  readonly browserPageName?: string;
}

export type BrowserBindingPlan =
  | {
      readonly configured: false;
      readonly mode: "missing";
      readonly message: string;
    }
  | {
      readonly configured: true;
      readonly mode: "external-cdp";
      readonly kind: "cdp";
      readonly endpoint: string;
      readonly pageName?: string;
      readonly adapterOwner: "cli";
      readonly message: string;
    }
  | {
      readonly configured: true;
      readonly mode: "caller-page-adapter";
      readonly kind: Exclude<BrowserBindingKind, "cdp">;
      readonly pageName?: string;
      readonly adapterOwner: "caller";
      readonly message: string;
    };

export interface BrowserBindingResolution {
  readonly plan?: BrowserBindingPlan;
  readonly errors: readonly string[];
}

export interface ExternalCdpPageTarget {
  readonly endpoint: string;
  readonly pageName?: string;
  readonly openOptions: BrowserCaptureOpenOptions;
}

export interface BrowserBindingAdapterRuntime {
  readonly externalCdpPage?: (
    target: ExternalCdpPageTarget
  ) => Effect.Effect<unknown, FlowStreamError>;
}

export interface BrowserBindingDeliveryProof {
  readonly mode: BrowserBindingPlan["mode"];
  readonly kind: BrowserBindingKind | null;
  readonly endpoint: string | null;
  readonly pageName: string | null;
  readonly adapterOwner: "cli" | "caller" | null;
  readonly adapterFactoryInjected: boolean;
  readonly browserLaunchClaimed: false;
  readonly browserStarted: false;
  readonly pageAdapterDeliveredToSdk: true;
  readonly framesDelivered: false;
  readonly message: string;
}

const missingBrowserBindingMessage =
  "No CLI browser binding is configured; browser dependencies and page adapters are caller/CLI owned, not sdk-stats owned.";

const configuredBrowserBindingMessage =
  "Browser binding is a CLI-owned readiness plan only; no browser was launched and no page adapter was delivered to sdk-stats.";

const deliveredBrowserBindingMessage =
  "Browser binding used an injected CLI-owned page factory and delivered a page adapter through the sdk-stats adapter boundary. No browser was launched and no media frames were delivered.";

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

const isCdpEndpoint = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return ["http:", "https:", "ws:", "wss:"].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const hasBrowserBindingInput = (options: BrowserBindingCliOptions): boolean =>
  options.browserKind !== undefined ||
  nonEmpty(options.browserEndpoint) !== undefined ||
  nonEmpty(options.browserPageName) !== undefined;

export const browserBindingFlagsPresent = hasBrowserBindingInput;

export const resolveBrowserBindingPlan = (
  options: BrowserBindingCliOptions
): BrowserBindingResolution => {
  const endpoint = nonEmpty(options.browserEndpoint);
  const pageName = nonEmpty(options.browserPageName);
  const errors: string[] = [];

  if (!hasBrowserBindingInput(options)) {
    return {
      plan: {
        configured: false,
        mode: "missing",
        message: missingBrowserBindingMessage
      },
      errors
    };
  }

  if (options.browserKind === undefined) {
    errors.push("--browser-kind is required when configuring a WebCapture browser binding.");
  }

  if (options.browserKind === "cdp") {
    if (endpoint === undefined) {
      errors.push("--browser-endpoint is required when --browser-kind cdp.");
    } else if (!isCdpEndpoint(endpoint)) {
      errors.push("--browser-endpoint must be an http(s) or ws(s) URL for --browser-kind cdp.");
    }
  } else if (options.browserKind !== undefined && endpoint !== undefined) {
    errors.push("--browser-endpoint is scoped to --browser-kind cdp external bindings.");
  }

  if (errors.length > 0 || options.browserKind === undefined) {
    return { errors };
  }

  if (options.browserKind === "cdp") {
    return {
      plan: {
        configured: true,
        mode: "external-cdp",
        kind: "cdp",
        endpoint: endpoint!,
        ...(pageName === undefined ? {} : { pageName }),
        adapterOwner: "cli",
        message: configuredBrowserBindingMessage
      },
      errors
    };
  }

  return {
    plan: {
      configured: true,
      mode: "caller-page-adapter",
      kind: options.browserKind,
      ...(pageName === undefined ? {} : { pageName }),
      adapterOwner: "caller",
      message: configuredBrowserBindingMessage
    },
    errors
  };
};

export const browserBindingReadinessPayload = (plan: BrowserBindingPlan) => ({
  configured: plan.configured,
  mode: plan.mode,
  kind: plan.configured ? plan.kind : null,
  endpoint: plan.configured && plan.mode === "external-cdp" ? plan.endpoint : null,
  pageName: plan.configured ? plan.pageName ?? null : null,
  adapterOwner: plan.configured ? plan.adapterOwner : null,
  adapterFactoryInjected: false,
  sdkStatsOwnsBrowserDependencies: false,
  browserLaunchClaimed: false,
  browserStarted: false,
  pageAdapterDeliveredToSdk: false,
  framesDelivered: false,
  message: plan.message
});

export const browserBindingReadinessPayloadWithDelivery = (
  plan: BrowserBindingPlan,
  delivery?: BrowserBindingDeliveryProof
) => ({
  ...browserBindingReadinessPayload(plan),
  ...(delivery === undefined
    ? {}
    : {
        adapterFactoryInjected: delivery.adapterFactoryInjected,
        pageAdapterDeliveredToSdk: delivery.pageAdapterDeliveredToSdk,
        framesDelivered: delivery.framesDelivered,
        message: delivery.message
      })
});

export const browserBindingDeliveryNotReadyError = (
  plan: BrowserBindingPlan
): FlowStreamCapabilityError =>
  new FlowStreamCapabilityError({
    message: plan.configured
      ? "WebCapture browser binding requires an injected CLI page factory"
      : "WebCapture browser binding is not configured",
    requiredScope: plan.configured
      ? `browser:webcapture:${plan.mode}`
      : "browser:webcapture",
    metadata: {
      details: plan.configured
        ? "The CLI parsed browser binding flags, but no injected external CDP/page factory was provided. No hidden browser was launched."
        : "Provide --browser-kind cdp with --browser-endpoint, or inject a caller-owned page adapter."
    }
  });

export const deliverBrowserBindingToSdk = (
  plan: BrowserBindingPlan,
  openOptions: BrowserCaptureOpenOptions,
  runtime: BrowserBindingAdapterRuntime = {}
): Effect.Effect<BrowserBindingDeliveryProof, FlowStreamError> =>
  Effect.gen(function* () {
    if (!plan.configured) {
      return yield* Effect.fail(browserBindingDeliveryNotReadyError(plan));
    }

    if (plan.mode !== "external-cdp" || runtime.externalCdpPage === undefined) {
      return yield* Effect.fail(browserBindingDeliveryNotReadyError(plan));
    }

    const adapter = makeBrowserPageFactoryCaptureAdapter(
      (options) =>
        runtime.externalCdpPage!({
          endpoint: plan.endpoint,
          ...(plan.pageName === undefined ? {} : { pageName: plan.pageName }),
          openOptions: options
        }),
      {
        kind: "cdp",
        ...(plan.pageName === undefined ? {} : { pageName: plan.pageName })
      }
    );
    const page = yield* adapter.openPage(openOptions);
    yield* page.close;

    return {
      mode: plan.mode,
      kind: plan.kind,
      endpoint: plan.endpoint,
      pageName: plan.pageName ?? null,
      adapterOwner: plan.adapterOwner,
      adapterFactoryInjected: true,
      browserLaunchClaimed: false,
      browserStarted: false,
      pageAdapterDeliveredToSdk: true,
      framesDelivered: false,
      message: deliveredBrowserBindingMessage
    };
  });

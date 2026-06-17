import { Console, Effect } from "effect";

export type UpdateCommand = "check" | "apply";

const ownership = {
  cli: "Owns CLI software update command presentation and policy display.",
  packageManager:
    "Owns real package resolution, download, verification, and installation when wired.",
  assets:
    "Content-pack assets and model files are handled by assets verify/repair, not CLI software update."
} as const;

const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2));

export const updateShellPayload = () => ({
  ok: true,
  command: "update",
  status: "scaffold",
  message:
    "CLI software update apply scaffold. No package manager binding is configured, so no files were changed.",
  ownership,
  softwareUpdateOnly: true,
  excludes: [
    "content-pack asset repair",
    "football model downloads",
    "observer content updates",
    "host cache repair",
    "protocol deployment repair"
  ],
  checkFirst: "update check",
  operation: {
    attempted: false,
    mutation: false
  }
});

export const updatePlanPayload = (command: UpdateCommand) => ({
  ok: true,
  command: command === "check" ? "update check" : "update apply",
  status: "scaffold",
  message:
    command === "check"
      ? "CLI software update check scaffold. No network request or package manager query was performed."
      : "CLI software update apply scaffold. No package download, verification, installation, or restart was performed.",
  ownership,
  softwareUpdateOnly: true,
  excludes: [
    "asset/content/model repair",
    "football weights",
    "host cache evidence",
    "contract artifact/deployment updates"
  ],
  currentVersion: null,
  latestVersion: null,
  updateAvailable: null,
  packageManager: {
    bound: false,
    checked: false,
    applied: false
  },
  operation: {
    attempted: false,
    mutation: false
  },
  nextIntegrationStep:
    "Bind an explicit CLI package update provider before reporting available versions or mutating installed files."
});

export const runUpdateShell = (): Effect.Effect<void> =>
  printJson(updateShellPayload());

export const runUpdatePlan = (
  command: UpdateCommand
): Effect.Effect<void> => printJson(updatePlanPayload(command));

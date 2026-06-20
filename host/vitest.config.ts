import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.resolve(packageDirectory, "src");

export default defineConfig({
  test: {
    testTimeout: 10_000
  },
  resolve: {
    alias: [
      { find: /^#server\//, replacement: `${sourceDirectory}/server/` },
      { find: /^#descriptor\//, replacement: `${sourceDirectory}/descriptor/` },
      { find: /^#media\//, replacement: `${sourceDirectory}/media/` },
      { find: /^#discovery\//, replacement: `${sourceDirectory}/discovery/` },
      { find: /^#memory\//, replacement: `${sourceDirectory}/memory/` },
      { find: /^#aa\//, replacement: `${sourceDirectory}/aa/` },
      { find: /^#test\//, replacement: `${packageDirectory}/test/` }
    ]
  }
});

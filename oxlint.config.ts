import { defineConfig } from "oxlint";
import sharedConfig from "@alchemy.run/oxlint-config/base-config";

export default defineConfig({
  ...sharedConfig,
  ignorePatterns: [
    ...(sharedConfig.ignorePatterns ?? []),
    "projects/cloudflare-tools/workers-sdk/**",
    "projects/distilled/packages/*/specs/**",
  ],
  rules: {
    ...sharedConfig.rules,
    "no-misused-new": "off",
    "require-yield": "off",
    "no-non-null-asserted-optional-chain": "off",
  },
});

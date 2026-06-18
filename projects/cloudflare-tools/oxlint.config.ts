import { defineConfig } from "oxlint";
import sharedConfig from "@alchemy.run/oxlint-config/effect-config";

export default defineConfig({
  ...sharedConfig,
  ignorePatterns: [...(sharedConfig.ignorePatterns ?? []), "workers-sdk/**", "**/routeTree.gen.ts"],
  overrides: [
    ...((sharedConfig.overrides ?? []) as Array<object>),
    {
      files: [
        "packages/cloudflare-rolldown-plugin/src/**/*.ts",
        "packages/cloudflare-vite-plugin/src/**/*.ts",
      ],
      rules: {
        "eslint/no-console": "error",
      },
    },
    {
      files: [
        "packages/cloudflare-runtime/src/**/*.ts",
        "packages/cloudflare-runtime/sandbox/**/*.ts",
      ],
      rules: {
        "import/extensions": ["error", "ignorePackages"],
      },
    },
    {
      files: ["packages/vendor/*/src/**/*.ts"],
      rules: {
        "eslint/no-unmodified-loop-condition": "off",
        "eslint/no-useless-constructor": "off",
      },
    },
  ],
});

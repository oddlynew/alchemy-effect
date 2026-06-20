import {
  InternalWorkerExportPlugin,
  InternalWorkerImportPlugin,
} from "@oddlynew/distilled-build-utils";
import cloudflare from "@oddlynew/distilled-cloudflare-rolldown-plugin";
import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/**/*.worker.ts"],
    outDir: "dist/workers",
    clean: true,
    tsconfig: "tsconfig.workers.json",
    format: "esm",
    minify: {
      mangle: false,
    },
    plugins: [cloudflare({ compatibilityDate: "2026-03-10" }), InternalWorkerExportPlugin()],
    deps: {
      alwaysBundle: [/.+/],
    },
    dts: false,
    outputOptions: {
      entryFileNames: "[name].mjs",
    },
  },
  {
    entry: ["src/**/*.ts", "!src/**/*.worker.ts", "!src/global.d.ts"],
    exports: false,
    outDir: "dist/node",
    clean: false,
    tsconfig: "tsconfig.node.json",
    unbundle: true,
    dts: { tsgo: true },
    shims: false,
    target: "esnext",
    format: "esm",
    inputOptions: { makeAbsoluteExternalsRelative: true },
    outputOptions: {
      exports: "named",
    },
    plugins: [InternalWorkerImportPlugin()],
  },
]);

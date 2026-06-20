import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/**/*.ts"],
  exports: false,
  outDir: "dist",
  clean: true,
  tsconfig: "tsconfig.build.json",
  unbundle: true,
  dts: { tsgo: true },
  shims: false,
  target: "esnext",
  format: "esm",
  inputOptions: { makeAbsoluteExternalsRelative: true },
  outputOptions: {
    exports: "named",
  },
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/index.ts",
  format: ["esm"],
  outDir: "dist",
  dts: {
    tsgo: true,
    sourcemap: true,
    build: true,
  },
  sourcemap: true,
  clean: true,
  tsconfig: "tsconfig.src.json",
  target: "esnext",
  platform: "neutral",
  treeshake: true,
  minify: false,

  deps: { skipNodeModulesBundle: true },
});

export default {
  rules: {
    "no-misused-new": "off",
    "require-yield": "off",
    "no-non-null-asserted-optional-chain": "off",
  },
  ignorePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "**/lib/**",
    "**/.cache/**",
    "**/.tsbuild/**",
    "**/*.tsbuildinfo",
    "**/routeTree.gen.ts",
    "**/__snapshots__/**",
  ],
};

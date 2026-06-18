import { createRequire } from "node:module";
import path from "node:path";
import type * as rolldown from "rolldown";

export const InternalWorkerImportPlugin = (): rolldown.Plugin => {
  return {
    name: "distilled:internal-worker-import",
    resolveId: {
      filter: { id: /^worker:.*$/ },
      async handler(id, importer) {
        const require = createRequire(importer ?? import.meta.url);
        const specifier = id.slice(7);
        const absolutePath = require.resolve(specifier);
        const relativePathTs = path.relative(path.resolve("./src"), absolutePath);
        const relativePathMjs = relativePathTs.replace(/\.ts$/, ".mjs");
        const resolvedId = path.resolve("./workers", relativePathMjs);
        return {
          id: resolvedId,
          external: "relative",
        };
      },
    },
  };
};

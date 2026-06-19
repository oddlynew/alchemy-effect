import { defineEcConfig } from "@astrojs/starlight/expressive-code";
import { alchemyWalnutTheme } from "./plugins/alchemy-walnut-theme.mjs";
import { capitalizedIdentifierColor } from "./plugins/capitalized-identifier-color.mjs";
import {
  twoslashDiffPrefixAnnotate,
  twoslashDiffPrefixStrip,
} from "./plugins/twoslash-diff-prefix.mjs";
import { twoslashErrorTransform } from "./plugins/twoslash-error-transform.mjs";

const baseUrl = new URL("../../../../", import.meta.url).pathname;

// `DOCS_FAST=1` (the `docs:check` target) skips expressive-code-twoslash.
// Each `twoslash` block spins up a TypeScript program to typecheck the sample,
// which dominates build time. Shiki highlighting / the `<Code>` component stay
// enabled so pages still render and the build-time link checkers can run.
const fast = !!process.env.DOCS_FAST;

const twoslashPlugins = fast
  ? []
  : await (async () => {
      let ecTwoSlash;
      try {
        ({ default: ecTwoSlash } = await import("expressive-code-twoslash"));
      } catch (error) {
        console.warn(
          `[docs] expressive-code-twoslash disabled: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return [];
      }

      return [
        twoslashDiffPrefixStrip(),
        ecTwoSlash({
          instanceConfigs: {
            twoslash: {
              explicitTrigger: true,
              languages: ["ts", "tsx", "typescript"],
            },
          },
          twoslashOptions: {
            customTags: ["error", "warn", "log", "annotate"],
            compilerOptions: {
              moduleResolution: /** @type {any} */ (100), // Bundler
              module: /** @type {any} */ (99), // ESNext
              target: /** @type {any} */ (9), // ES2022
              strict: true,
              types: ["bun"],
              baseUrl,
              paths: {
                alchemy: ["./projects/alchemy/packages/alchemy/src/index.ts"],
                "@oddlynew/alchemy/*": [
                  "./projects/alchemy/packages/alchemy/src/*",
                ],
              },
            },
          },
        }),
        twoslashDiffPrefixAnnotate(),
        twoslashErrorTransform(),
      ];
    })();

export default defineEcConfig({
  themes: [alchemyWalnutTheme],
  plugins: [...(fast ? [] : twoslashPlugins), capitalizedIdentifierColor()],
});

import * as Alchemy from "@oddlynew/alchemy";
import * as Cloudflare from "@oddlynew/alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "CloudflareReactRouterRscFixture",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* Cloudflare.Vite("ReactRouterRscFixture", {
      assets: {
        runWorkerFirst: true,
      },
      compatibility: {
        date: "2026-03-10",
        flags: ["nodejs_compat"],
      },
      memo: {
        include: [
          "app/**",
          "react-router-vite/**",
          "package.json",
          "tsconfig.json",
          "vite.config.ts",
        ],
      },
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    });

    return {
      url: worker.url,
    };
  }),
);

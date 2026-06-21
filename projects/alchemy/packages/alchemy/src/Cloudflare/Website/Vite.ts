import * as Effect from "effect/Effect";
import type { MemoOptions } from "../../Build/Memo.ts";
import type { InputProps } from "../../Input.ts";
import { effectClass } from "../../Util/effect.ts";
import type { Providers } from "../Providers.ts";
import type { AssetsConfig } from "../Workers/Assets.ts";
import {
  Worker,
  type NormalizedBindings,
  type WorkerAssetsConfig,
  type WorkerBindingProps,
  type WorkerProps,
} from "../Workers/Worker.ts";
import type { CloudflareVitePluginOptionsWithAssets } from "../Workers/Vite.ts";
export interface ViteProps<
  Bindings extends WorkerBindingProps = {},
> extends Omit<WorkerProps<Bindings>, "vite" | "main" | "assets"> {
  /**
   * Root directory passed to Vite's `root` option.
   * Defaults to the current working directory (`process.cwd()`).
   */
  rootDir?: string;
  /**
   * Controls which files are hashed to decide whether a rebuild is needed.
   * By default every non-gitignored file in `cwd` is hashed, plus the nearest
   * lockfile. Provide explicit globs to narrow the scope.
   *
   * @see {@link MemoOptions}
   */
  memo?: MemoOptions;
  /**
   * Optional configuration for static asset routing behavior.
   * Supports `runWorkerFirst`, `htmlHandling`, `notFoundHandling`, etc.
   */
  assets?: AssetsConfig;
  /**
   * Advanced Vite environment topology for Worker builds. RSC apps usually
   * run the Worker in the `rsc` environment and load `ssr` as a child.
   */
  viteEnvironment?: CloudflareVitePluginOptionsWithAssets["viteEnvironment"];
}

/**
 * A Cloudflare Worker deployed from a Vite project.
 *
 * `Vite` uses the Cloudflare Vite plugin to build both the server bundle
 * and client assets in a single `vite build` invocation — no manual
 * `main` entrypoint, build command, output directory, or Wrangler
 * configuration required.
 *
 * Input files are content-hashed (respecting `.gitignore` by default) so
 * unchanged projects skip the build and deploy entirely.
 *
 * @resource
 * @product Website
 * @category Workers & Compute
 *
 * @section Vite Config vs Cloudflare.Vite
 * Keep framework configuration in `vite.config.ts`: React, Vue, Tailwind,
 * React Router/RSC plugins, framework entries, and extra Vite build inputs
 * belong there.
 *
 * Keep Cloudflare and Alchemy configuration in `Cloudflare.Vite`: resource
 * bindings, compatibility flags, asset routing, and Worker environment
 * topology belong here.
 *
 * Do not add `@oddlynew/distilled-cloudflare-vite-plugin` manually to your Vite
 * config when using `Cloudflare.Vite`. Alchemy loads the app's normal Vite
 * config and injects the distilled Cloudflare Vite plugin programmatically so
 * its options stay aligned with Alchemy's resources, bindings, asset settings,
 * compatibility settings, deploy diffs, and local dev runtime.
 *
 * Plain `vite dev` can still be useful for framework-only work, but it does
 * not provide Alchemy-managed Cloudflare bindings. Use `alchemy dev` for the
 * authoritative local Worker dev path when the app depends on Alchemy
 * resources.
 *
 * @section Deploying a Static Site
 * For a pure static site (no SSR), a single call is all you need.
 * Vite builds the project and Alchemy deploys the output as a
 * Cloudflare Worker with static assets.
 *
 * @example Static Vite site
 * ```typescript
 * const site = yield* Cloudflare.Vite("Website");
 * ```
 *
 * @section SSR Frameworks
 * For SSR frameworks like TanStack Start, SolidStart, or Nuxt, enable
 * `nodejs_compat` so the server bundle can use Node.js APIs.
 *
 * @example TanStack Start
 * ```typescript
 * const app = yield* Cloudflare.Vite("TanStackStart", {
 *   compatibility: {
 *     flags: ["nodejs_compat"],
 *   },
 * });
 * ```
 *
 * @example SolidStart with worker-first routing
 * ```typescript
 * const app = yield* Cloudflare.Vite("SolidStart", {
 *   compatibility: {
 *     flags: ["nodejs_compat"],
 *   },
 *   assets: {
 *     runWorkerFirst: true,
 *   },
 * });
 * ```
 *
 * @section React Server Components
 * For RSC frameworks that use Vite child environments, pass the Worker
 * topology through `viteEnvironment`. Alchemy requires the distilled build
 * manifest for this topology so it can upload the full Worker module set. The
 * framework's RSC entries still belong in `vite.config.ts`; `viteEnvironment`
 * tells Alchemy which Vite environment is the Cloudflare Worker and which child
 * environments must be available to it at runtime.
 * Keep the app's `vite.config.ts` focused on framework plugins; do not add a
 * Cloudflare Vite plugin there. `Cloudflare.Vite` injects the Cloudflare
 * integration when it runs Vite for dev and deploy.
 *
 * @example RSC topology
 * ```typescript
 * const app = yield* Cloudflare.Vite("ReactRouter", {
 *   compatibility: {
 *     flags: ["nodejs_compat"],
 *   },
 *   viteEnvironment: {
 *     name: "rsc",
 *     childEnvironments: ["ssr"],
 *   },
 * });
 * ```
 *
 * @section Single-Page Applications
 * For SPAs (React, Vue, etc.), configure asset handling so all
 * routes fall back to `index.html`.
 *
 * @example Vue SPA
 * ```typescript
 * const app = yield* Cloudflare.Vite("Vue", {
 *   compatibility: {
 *     flags: ["nodejs_compat"],
 *   },
 *   assets: {
 *     htmlHandling: "auto-trailing-slash",
 *     notFoundHandling: "single-page-application",
 *   },
 * });
 * ```
 *
 * @section Vite Worker With Durable Objects
 * For Vite apps that own their Worker entrypoint, configure the entry in the
 * Vite project (usually via the framework plugin, or `environments.ssr.build`
 * for custom apps). Export the default Worker handler and any local Durable
 * Object classes from that Vite entry. Alchemy deploys the Vite-built Worker
 * module set and attaches the bindings, Durable Object metadata, migrations,
 * compatibility settings, and assets to the same Worker script.
 * Declare each local Durable Object with `Cloudflare.DurableObjectNamespace` in
 * `env`; exporting the class from the Vite entry makes it available to the
 * Worker module, while the `env` binding is what gives Alchemy ownership of the
 * namespace and migrations.
 *
 * @example One Worker With A Local Durable Object
 * ```typescript
 * // alchemy.run.ts
 * import type { Counter } from "./src/worker.ts";
 *
 * const app = yield* Cloudflare.Vite("App", {
 *   env: {
 *     Counter: Cloudflare.DurableObjectNamespace<Counter>("Counter", {
 *       className: "Counter",
 *     }),
 *   },
 *   assets: {
 *     runWorkerFirst: ["/api/*"],
 *   },
 * });
 *
 * // src/worker.ts
 * import { DurableObject } from "cloudflare:workers";
 *
 * export class Counter extends DurableObject {
 *   async increment() {
 *     return 1;
 *   }
 * }
 *
 * export default {
 *   async fetch(request, env) {
 *     const count = await env.Counter.getByName("main").increment();
 *     return Response.json({ count });
 *   },
 * };
 * ```
 *
 * @section Local Development With Bindings
 * During `alchemy dev`, Vite still owns the dev server and HMR loop.
 * Alchemy starts the Worker locally through the Cloudflare runtime and
 * resolves the `env` map into the runtime binding hooks used by the Vite
 * Cloudflare plugin. Binding types with a local runtime implementation, such
 * as Durable Objects, Queues, Workflows, service bindings, and static assets,
 * run locally. Binding types that Cloudflare exposes through remote bindings,
 * such as R2, KV, D1, AI, Images, Vectorize, and similar account resources,
 * connect to the real Cloudflare resource.
 *
 * @example Vite Worker With R2 In Local Dev
 * ```typescript
 * const bucket = yield* Cloudflare.R2Bucket("Uploads");
 *
 * const app = yield* Cloudflare.Vite("App", {
 *   env: {
 *     BUCKET: bucket,
 *   },
 *   assets: {
 *     runWorkerFirst: ["/api/*"],
 *   },
 * });
 * ```
 *
 * @section Custom Rebuild Scope
 * By default, every non-gitignored file is hashed to decide whether
 * a rebuild is needed. Use `memo` to narrow the scope when your
 * project has large directories that don't affect the build output.
 *
 * @example Narrowing the memo scope
 * ```typescript
 * const site = yield* Cloudflare.Vite("Docs", {
 *   memo: {
 *     include: ["src/**", "content/**", "package.json"],
 *   },
 * });
 * ```
 *
 * @section Class Form
 * Calling `Vite` with no arguments returns a constructor you can
 * `extend` to declare the Worker as a named class. The class is both
 * an `Effect` you can `yield*` to deploy and a type you can reference
 * elsewhere — useful when other resources need to bind to this Worker.
 *
 * @example Declaring a Worker class
 * ```typescript
 * class Website extends Cloudflare.Vite<Website>()("Website", {
 *   compatibility: { flags: ["nodejs_compat"] },
 * }) {}
 *
 * const site = yield* Website;
 * ```
 */
export const Vite: {
  <Self>(): {
    <const Bindings extends WorkerBindingProps = {}, Req = never>(
      id: string,
      propsEff?:
        | InputProps<ViteProps<Bindings>>
        | Effect.Effect<InputProps<ViteProps<Bindings>>, never, Req>,
    ): Effect.Effect<Self, never, Req | Providers> & {
      new (): Worker<{
        [binding in keyof NormalizedBindings<
          Bindings,
          WorkerAssetsConfig
        >]: NormalizedBindings<Bindings, WorkerAssetsConfig>[binding];
      }>;
    };
  };
  <const Bindings extends WorkerBindingProps = {}, Req = never>(
    id: string,
    propsEff?:
      | InputProps<ViteProps<Bindings>>
      | Effect.Effect<InputProps<ViteProps<Bindings>>, never, Req>,
  ): Effect.Effect<
    Worker<{
      [binding in keyof NormalizedBindings<
        Bindings,
        WorkerAssetsConfig
      >]: NormalizedBindings<Bindings, WorkerAssetsConfig>[binding];
    }>,
    never,
    Req | Providers
  >;
} = ((id?: any, propsEff?: any) =>
  id === undefined
    ? (id: string, propsEff: any) => effectClass(Vite(id, propsEff))
    : Worker(
        id,
        Effect.map(
          Effect.isEffect(propsEff) ? propsEff : Effect.succeed(propsEff),
          (props) => {
            const viteEnvironment = props?.viteEnvironment;
            return {
              ...props,
              main: undefined!,
              vite: {
                rootDir: props?.rootDir,
                memo: props?.memo,
                viteEnvironment,
              },
            };
          },
        ),
      )) as any;

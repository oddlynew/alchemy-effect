import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

export class AccessError extends Schema.TaggedErrorClass<AccessError>()("AccessError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class Access extends Context.Service<
  Access,
  {
    readonly getAccessHeaders: (
      domain: string,
    ) => Effect.Effect<Record<string, string>, AccessError>;
  }
>()("@distilled/cloudflare/Access") {}

export const layer = Layer.effect(
  Access,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const domainUsesAccess = yield* cachedFunction((domain: string) =>
      Effect.promise((signal) => fetch(`https://${domain}`, { redirect: "manual", signal })).pipe(
        Effect.map(
          (response) =>
            response.status === 302 &&
            (response.headers.get("location")?.includes("cloudflareaccess.com") ?? false),
        ),
        Effect.timeout(1000),
        Effect.catch(() => Effect.succeed(false)),
      ),
    );
    const login = (domain: string) =>
      ChildProcess.make("cloudflared", ["access", "login", domain]).pipe(
        spawner.spawn,
        Effect.flatMap((process) => Stream.runCollect(process.stdout)),
        Effect.mapError(
          (error) =>
            new AccessError({
              message:
                `The domain "${domain}" uses Cloudflare Access, but \`cloudflared\` is not installed. ` +
                `Please install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation.`,
              cause: error,
            }),
        ),
        Effect.flatMap((stdout) => {
          const matches = stdout.toString().match(/fetched your token:\n\n(.*)/m);
          return matches && matches.length >= 2
            ? Effect.succeed({ Cookie: `CF_Authorization=${matches[1]}` })
            : Effect.fail(
                new AccessError({
                  message: "Failed to authenticate with Cloudflare Access",
                }),
              );
        }),
        Effect.scoped,
      );

    const getEnv = (name: string) =>
      Config.string(name)
        .asEffect()
        .pipe(Effect.catchTag("ConfigError", () => Effect.succeed(undefined)));

    return Access.of({
      getAccessHeaders: Effect.fn(function* (domain) {
        if (!(yield* domainUsesAccess(domain))) {
          return {};
        }
        const clientId = yield* getEnv("CLOUDFLARE_ACCESS_CLIENT_ID");
        const clientSecret = yield* getEnv("CLOUDFLARE_ACCESS_CLIENT_SECRET");
        if (clientId && clientSecret) {
          return {
            "CF-Access-Client-Id": clientId,
            "CF-Access-Client-Secret": clientSecret,
          } as Record<string, string>;
        }

        if (clientId !== undefined || clientSecret !== undefined) {
          yield* Effect.logWarning(
            "Both CLOUDFLARE_ACCESS_CLIENT_ID and CLOUDFLARE_ACCESS_CLIENT_SECRET must be set to use Access Service Token authentication. " +
              `Only ${
                clientId !== undefined
                  ? "CLOUDFLARE_ACCESS_CLIENT_ID"
                  : "CLOUDFLARE_ACCESS_CLIENT_SECRET"
              } was found.`,
          );
        }

        return yield* login(domain);
      }),
    });
  }),
);

/**
 * Options for creating a cached function.
 */
export interface CachedFunctionOptions<A> {
  /**
   * Function to convert arguments to a cache key string.
   * Defaults to `JSON.stringify`.
   */
  readonly key?: (args: A) => string;
}

/**
 * Creates a memoized version of a function that returns an Effect.
 *
 * The key feature is deduplication of concurrent calls with the same inputs -
 * only one execution happens while other callers wait for and receive the same result.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import { cachedFunction } from "~/lib/cached-function";
 *
 * const fetchUser = (id: string) =>
 *   Effect.promise(() => fetch(`/users/${id}`).then(r => r.json()));
 *
 * const program = Effect.gen(function* () {
 *   const cachedFetchUser = yield* cachedFunction(fetchUser);
 *
 *   // These concurrent calls will only trigger one fetch
 *   const [user1, user2] = yield* Effect.all([
 *     cachedFetchUser("123"),
 *     cachedFetchUser("123"),
 *   ]);
 * });
 * ```
 */
export const cachedFunction = <A, B, E, R>(
  fn: (args: A) => Effect.Effect<B, E, R>,
  options?: CachedFunctionOptions<A>,
): Effect.Effect<(args: A) => Effect.Effect<B, E, R>> =>
  Effect.sync(() => {
    const keyFn = options?.key ?? JSON.stringify;
    const cache = new Map<string, Deferred.Deferred<B, E>>();

    return (args: A): Effect.Effect<B, E, R> =>
      Effect.suspend(() => {
        const cacheKey = keyFn(args);
        const existing = cache.get(cacheKey);

        // If there's already a deferred for this key, wait on it
        if (existing) {
          return Deferred.await(existing);
        }

        // Create a new deferred and store it
        return Effect.gen(function* () {
          const deferred = yield* Deferred.make<B, E>();
          cache.set(cacheKey, deferred);

          // Execute the effect and complete the deferred
          const exit = yield* Effect.exit(fn(args));
          yield* Deferred.done(deferred, exit);

          if (exit._tag === "Failure") {
            cache.delete(cacheKey);
          }

          // Return the result
          return yield* exit;
        });
      });
  });

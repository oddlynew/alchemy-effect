import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export type CacheScope = "trusted" | "branch";
export type CacheRole = "trusted" | "branch";

export class CacheAuthError extends Data.TaggedError("CacheAuthError")<{
  readonly scope: CacheScope;
  readonly status: 401 | 403;
  readonly message: string;
}> {}

export interface CacheAuth {
  readonly authorize: (
    request: Request,
    scope: CacheScope,
  ) => Effect.Effect<CacheRole, CacheAuthError>;
}

export function parseBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function makeCacheAuth(options: {
  readonly trustedToken: Redacted.Redacted<string>;
  readonly branchToken: Redacted.Redacted<string>;
}): CacheAuth {
  const trustedToken = Redacted.value(options.trustedToken);
  const branchToken = Redacted.value(options.branchToken);

  return {
    authorize: (request, scope) =>
      Effect.gen(function* () {
        const token = parseBearerToken(request.headers.get("Authorization"));

        if (!token) {
          return yield* Effect.fail(
            new CacheAuthError({
              scope,
              status: 401,
              message: "Missing bearer token.",
            }),
          );
        }

        const role: CacheRole | null =
          token === trustedToken
            ? "trusted"
            : token === branchToken
              ? "branch"
              : null;

        if (!role) {
          return yield* Effect.fail(
            new CacheAuthError({
              scope,
              status: 401,
              message: "Invalid bearer token.",
            }),
          );
        }

        if (scope === "trusted" && role !== "trusted") {
          return yield* Effect.fail(
            new CacheAuthError({
              scope,
              status: 403,
              message: "Branch cache token cannot access trusted cache.",
            }),
          );
        }

        if (scope === "branch" && role !== "branch") {
          return yield* Effect.fail(
            new CacheAuthError({
              scope,
              status: 403,
              message: "Trusted cache token cannot access branch cache.",
            }),
          );
        }

        return role;
      }),
  };
}

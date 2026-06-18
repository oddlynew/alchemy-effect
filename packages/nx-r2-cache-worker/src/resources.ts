import * as Cloudflare from "alchemy/Cloudflare";
import type * as Effect from "effect/Effect";

const dayInSeconds = 24 * 60 * 60;

export const TrustedCacheBucket: Effect.Effect<
  Cloudflare.R2Bucket,
  never,
  Cloudflare.Providers
> = Cloudflare.R2Bucket("TrustedCacheBucket", {
  name: "alchemy-run-nx-cache-trusted",
  jurisdiction: "eu",
  locationHint: "weur",
  lifecycleRules: [
    {
      id: "delete-trusted-cache-after-90-days",
      enabled: true,
      deleteObjectsTransition: {
        condition: {
          type: "Age",
          maxAge: 90 * dayInSeconds,
        },
      },
    },
  ],
});

export const BranchCacheBucket: Effect.Effect<
  Cloudflare.R2Bucket,
  never,
  Cloudflare.Providers
> = Cloudflare.R2Bucket("BranchCacheBucket", {
  name: "alchemy-run-nx-cache-branches",
  jurisdiction: "eu",
  locationHint: "weur",
  lifecycleRules: [
    {
      id: "delete-branch-cache-after-30-days",
      enabled: true,
      deleteObjectsTransition: {
        condition: {
          type: "Age",
          maxAge: 30 * dayInSeconds,
        },
      },
    },
  ],
});

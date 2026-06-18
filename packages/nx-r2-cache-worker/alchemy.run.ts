import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { BranchCacheBucket, TrustedCacheBucket } from "./src/resources";
import NxR2CacheWorker from "./src/worker";

export default Alchemy.Stack(
  "nx-r2-cache-worker",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const trustedCache = yield* TrustedCacheBucket;
    const branchCache = yield* BranchCacheBucket;
    const worker = yield* NxR2CacheWorker;

    return {
      workerUrl: worker.url,
      trustedBucketName: trustedCache.bucketName,
      branchBucketName: branchCache.bucketName,
    };
  }),
);

import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { makeCacheAuth } from "./auth";
import { handleCacheRequest } from "./cache";
import { BranchCacheBucket, TrustedCacheBucket } from "./resources";
import { makeR2CacheStorage } from "./storage";

const workerProps = {
  main: import.meta.filename,
  compatibility: {
    date: "2026-06-09",
  },
} satisfies Cloudflare.WorkerProps;

const workerRuntime = Effect.gen(function* () {
  const trusted = yield* Cloudflare.R2Bucket.bind(TrustedCacheBucket);
  const branch = yield* Cloudflare.R2Bucket.bind(BranchCacheBucket);
  const trustedToken = yield* Config.redacted("NX_R2_CACHE_TRUSTED_TOKEN");
  const branchToken = yield* Config.redacted("NX_R2_CACHE_BRANCH_TOKEN");
  const services = {
    auth: makeCacheAuth({ trustedToken, branchToken }),
    storage: makeR2CacheStorage({
      trusted,
      branch,
    }),
  };

  const fetch = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;

    if (!(request.source instanceof Request)) {
      return HttpServerResponse.text("Unsupported request adapter.", {
        status: 500,
      });
    }

    const response = yield* handleCacheRequest(request.source, services);
    return HttpServerResponse.fromWeb(response);
  });

  return { fetch };
}).pipe(Effect.provide(Cloudflare.R2BucketBindingLive));

export default class NxR2CacheWorker extends Cloudflare.Worker<NxR2CacheWorker>()(
  "NxR2CacheWorker",
  workerProps,
  workerRuntime,
) {}

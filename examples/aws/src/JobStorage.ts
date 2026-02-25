import * as S3 from "alchemy-effect/AWS/S3";
import type { Credentials } from "distilled-aws/Credentials";
import type { Region } from "distilled-aws/Region";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServiceMap from "effect/ServiceMap";
import * as Stream from "effect/Stream";

import type { ExecutionContext } from "alchemy-effect";
import type { HttpClient } from "effect/unstable/http/HttpClient";
import type { Job } from "./Job.ts";

export class JobStorage extends ServiceMap.Service<
  JobStorage,
  {
    bucket: S3.Bucket;
    putJob(job: Job): Effect.Effect<void>;
    getJob(jobId: string): Effect.Effect<Job | undefined>;
    subscribe<Err = never, Req = never>(
      fn: (stream: Stream.Stream<Job>) => Effect.Effect<void, Err, Req>,
      // TODO(sam): don't leak this out to the caller
    ): Effect.Effect<
      void,
      never,
      ExecutionContext | Credentials | Region | HttpClient
    >;
  }
>()("JobStorage") {}

export const jobStorage = Layer.effect(
  JobStorage,
  Effect.gen(function* () {
    const bucket = yield* S3.Bucket("JobsBucket");

    const getObject = yield* S3.GetObject(bucket);
    const putObject = yield* S3.PutObject(bucket);

    const putJob = (job: Job) =>
      putObject({
        Key: job.id,
        Body: JSON.stringify(job),
      }).pipe(
        Effect.flatMap(() => Effect.void),
        Effect.orDie,
      );

    const getJob = (jobId: string) =>
      getObject({
        Key: jobId,
      }).pipe(
        Effect.map((item) => item.Body as any),
        Effect.orDie,
      );

    return JobStorage.of({
      bucket,
      putJob,
      getJob,
      subscribe: (fn) =>
        S3.notifications(bucket).subscribe((stream) =>
          stream.pipe(
            Stream.flatMap((item) =>
              Stream.fromEffect(getJob(item.key).pipe(Effect.orDie)),
            ),
            fn,
          ),
        ),
    });
  }),
);

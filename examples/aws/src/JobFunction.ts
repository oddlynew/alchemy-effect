import * as Lambda from "alchemy-effect/AWS/Lambda";
import * as S3 from "alchemy-effect/AWS/S3";
import * as SQS from "alchemy-effect/AWS/SQS";
import * as Http from "alchemy-effect/Http";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { JobStorage, jobStorage } from "./JobStorage.ts";
import { jobApi, JobApi } from "./api/index.ts";

export default Lambda.Function(
  "JobFunction",
  Effect.gen(function* () {
    // serve our API
    yield* startServer;

    // process jobs in the background
    yield* startWorker;

    return {
      main: import.meta.filename,
      memory: 1024,
      url: true,
    } as const;
  }).pipe(Effect.provide(Layer.provideMerge(jobApi, jobStorage))),
);

const startServer = Effect.gen(function* () {
  const _jobApi = yield* JobApi;

  yield* Http.serve(
    // @ts-expect-error
    () => handler,
  );
});

const startWorker = Effect.gen(function* () {
  const { bucket, getJob } = yield* JobStorage;
  const queue = yield* SQS.Queue("JobsQueue");
  const sink = yield* SQS.sink(queue);

  yield* S3.notifications(bucket).subscribe((stream) =>
    stream.pipe(
      Stream.flatMap((item) =>
        Stream.fromEffect(getJob(item.key).pipe(Effect.orDie)),
      ),
      Stream.map((msg) => JSON.stringify(msg)),
      Stream.tapSink(sink),
      Stream.runDrain,
    ),
  );
});

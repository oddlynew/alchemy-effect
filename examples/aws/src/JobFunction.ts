import * as AWS from "alchemy-effect/AWS";
import * as Layer from "effect/Layer";
import { jobApi, JobApi } from "./JobApi.ts";
import { S3JobQueue } from "./JobQueue.ts";
import { JobsBucket } from "./JobsBucket.ts";
import { S3JobStorage } from "./JobStorage.ts";
import { JobWorker, jobWorker } from "./JobWorker.ts";

// TAG (a way to reference the Lambda without bloating bundle)
export class JobFunction extends AWS.Lambda.Function<JobFunction>()(
  "JobFunction",
  {
    services: [JobApi, JobWorker],
  },
) {}

// class MyDbConnection extends Cloudflare.Hyperdrive("MyDbConnection", {
//   database: MyDb,
// }) {}

const jobFunction = JobFunction.pipe(
  Layer.provide(
    Layer.mergeAll(jobApi, jobWorker).pipe(
      Layer.provide(Layer.provideMerge(S3JobQueue, S3JobStorage)),
    ),
  ),
  AWS.Lambda.make({
    main: import.meta.filename,
    memory: 1024,
    runtime: "nodejs22.x",
    // env
    // policyStatements
  }),
  // Add infra dependencies and enforce least privilege IAM policies
  AWS.Lambda.bind(
    AWS.S3.GetObject(JobsBucket),
    AWS.S3.PutObject(JobsBucket),
    AWS.Lambda.BucketEventSource("JobsBucketEventSource", JobsBucket),
    // MyDbConnection,
  ),
);

// IMPLEMENTATION (provide all the runtime layers and infra dependencies)
export default jobFunction;

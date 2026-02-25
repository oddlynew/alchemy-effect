import * as Effect from "effect/Effect";

import { Api, Schema as S } from "alchemy-effect";

import { Job, JobId } from "../Job.ts";
import { JobStorage } from "../JobStorage.ts";
import { InvalidJobId } from "./InvalidJobId.ts";

export class GetJobRequest extends Api.Request("GetJobRequest", {
  jobId: JobId,
}) {}

export class GetJobResponse extends Api.Response("GetJobResponse", {
  job: S.optional(Job),
}) {}

export class GetJob extends Api.Operation("GetJob", {
  input: GetJobRequest,
  output: GetJobResponse,
  errors: [InvalidJobId],
}) {}

export const getJob = GetJob.layer(
  Effect.gen(function* () {
    const jobStorage = yield* JobStorage;
    return Effect.fn(function* (request: GetJobRequest) {
      return {
        job: yield* jobStorage.getJob(request.jobId),
      };
    });
  }),
);

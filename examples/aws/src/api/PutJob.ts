import * as S from "alchemy-effect/Schema";
import * as Effect from "effect/Effect";

import { Api } from "alchemy-effect";
import { Job } from "../Job.ts";
import { JobStorage } from "../JobStorage.ts";
import { InvalidJobId } from "./InvalidJobId.ts";

export class PutJobRequest extends Api.Request("PutJobRequest", {
  content: S.String,
}) {}

export class PutJobResponse extends Api.Response("PutJobResponse", {
  job: Job,
}) {}

export class PutJob extends Api.Operation("PutJob", {
  input: PutJobRequest,
  output: PutJobResponse,
  errors: [InvalidJobId],
}) {}

export const putJob = PutJob.layer(
  Effect.gen(function* () {
    const jobStorage = yield* JobStorage;
    return Effect.fn(function* (request) {
      const job = new Job({
        id: "",
        content: request.content,
      });
      yield* jobStorage.putJob(job);
      return {
        job,
      } satisfies PutJobResponse;
    });
  }),
);

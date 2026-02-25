import * as Api from "alchemy-effect/Server";
import * as Layer from "effect/Layer";

export * from "./GetJob.ts";
export * from "./PutJob.ts";

import { getJob, GetJob } from "./GetJob.ts";
import { putJob, PutJob } from "./PutJob.ts";

export class JobApi extends Api.Endpoint("JobApi", {
  operations: [GetJob, PutJob],
}) {}

export const jobApi = Layer.mergeAll(getJob, putJob);

import { defineStack, defineStages } from "alchemy-effect";
import * as Layer from "effect/Layer";
import JobFunction from "./src/JobFunction.ts";

// group into stack
export default defineStack({
  name: "job-service",
  resources: [JobFunction],
  providers: Layer.empty,
  stages: defineStages(() => ({
    aws: {
      profile: "default",
      region: "us-east-1",
    },
  })),
});

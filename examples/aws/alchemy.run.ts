import { defineStack } from "alchemy-effect";
import JobFunction from "./src/JobFunction.ts";

// group into stack
export default defineStack((stage) => ({
  name: "job-service-prod",
  resources: stage === "prod" ? [JobFunction, CDN] : [JobFunction],
}));

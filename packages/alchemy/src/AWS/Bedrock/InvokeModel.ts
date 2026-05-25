import { Region } from "@distilled.cloud/aws/Region";
import * as bedrockRuntime from "@distilled.cloud/aws/bedrock-runtime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Binding from "../../Binding.ts";
import { AWSEnvironment } from "../Environment.ts";
import { isFunction } from "../Lambda/Function.ts";
import { resolveModelArns } from "./ModelArn.ts";

export interface InvokeModelRequest extends Omit<
  bedrockRuntime.InvokeModelRequest,
  "modelId"
> {}

export class InvokeModel extends Binding.Service<
  InvokeModel,
  (
    modelId: string,
  ) => Effect.Effect<
    (
      request: InvokeModelRequest,
    ) => Effect.Effect<
      bedrockRuntime.InvokeModelResponse,
      bedrockRuntime.InvokeModelError
    >
  >
>()("AWS.Bedrock.InvokeModel") {}

export const InvokeModelLive = Layer.effect(
  InvokeModel,
  Effect.gen(function* () {
    const Policy = yield* InvokeModelPolicy;
    const invokeModel = yield* bedrockRuntime.invokeModel;

    return Effect.fn(function* (modelId: string) {
      yield* Policy(modelId);
      return Effect.fn(function* (request: InvokeModelRequest) {
        return yield* invokeModel({ ...request, modelId });
      });
    });
  }),
);

export class InvokeModelPolicy extends Binding.Policy<
  InvokeModelPolicy,
  (modelId: string) => Effect.Effect<void>
>()("AWS.Bedrock.InvokeModel") {}

export const InvokeModelPolicyLive = InvokeModelPolicy.layer.effect(
  Effect.gen(function* () {
    const region = yield* Region;
    const { accountId } = yield* AWSEnvironment;

    return Effect.fn(function* (host, modelId) {
      if (isFunction(host)) {
        yield* host.bind`Allow(${host}, AWS.Bedrock.InvokeModel(${modelId}))`({
          policyStatements: [
            {
              Effect: "Allow",
              Action: ["bedrock:InvokeModel"],
              Resource: resolveModelArns({ modelId, region, accountId }),
            },
          ],
        });
      } else {
        return yield* Effect.die(
          `InvokeModelPolicy does not support runtime '${host.Type}'`,
        );
      }
    });
  }),
);

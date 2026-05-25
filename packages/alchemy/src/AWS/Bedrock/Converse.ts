import { Region } from "@distilled.cloud/aws/Region";
import * as bedrockRuntime from "@distilled.cloud/aws/bedrock-runtime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Binding from "../../Binding.ts";
import { AWSEnvironment } from "../Environment.ts";
import { isFunction } from "../Lambda/Function.ts";
import { resolveModelArns } from "./ModelArn.ts";

export interface ConverseRequest extends Omit<
  bedrockRuntime.ConverseRequest,
  "modelId"
> {}

export class Converse extends Binding.Service<
  Converse,
  (
    modelId: string,
  ) => Effect.Effect<
    (
      request: ConverseRequest,
    ) => Effect.Effect<
      bedrockRuntime.ConverseResponse,
      bedrockRuntime.ConverseError
    >
  >
>()("AWS.Bedrock.Converse") {}

export const ConverseLive = Layer.effect(
  Converse,
  Effect.gen(function* () {
    const Policy = yield* ConversePolicy;
    const converse = yield* bedrockRuntime.converse;

    return Effect.fn(function* (modelId: string) {
      yield* Policy(modelId);
      return Effect.fn(function* (request: ConverseRequest) {
        return yield* converse({ ...request, modelId });
      });
    });
  }),
);

export class ConversePolicy extends Binding.Policy<
  ConversePolicy,
  (modelId: string) => Effect.Effect<void>
>()("AWS.Bedrock.Converse") {}

export const ConversePolicyLive = ConversePolicy.layer.effect(
  Effect.gen(function* () {
    const region = yield* Region;
    const { accountId } = yield* AWSEnvironment;

    return Effect.fn(function* (host, modelId) {
      if (isFunction(host)) {
        yield* host.bind`Allow(${host}, AWS.Bedrock.Converse(${modelId}))`({
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
          `ConversePolicy does not support runtime '${host.Type}'`,
        );
      }
    });
  }),
);

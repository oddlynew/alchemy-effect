import { Region } from "@distilled.cloud/aws/Region";
import * as bedrockRuntime from "@distilled.cloud/aws/bedrock-runtime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Binding from "../../Binding.ts";
import { AWSEnvironment } from "../Environment.ts";
import { isFunction } from "../Lambda/Function.ts";
import { resolveModelArns } from "./ModelArn.ts";

export interface ConverseStreamRequest extends Omit<
  bedrockRuntime.ConverseStreamRequest,
  "modelId"
> {}

export class ConverseStream extends Binding.Service<
  ConverseStream,
  (
    modelId: string,
  ) => Effect.Effect<
    (
      request: ConverseStreamRequest,
    ) => Effect.Effect<
      bedrockRuntime.ConverseStreamResponse,
      bedrockRuntime.ConverseStreamError
    >
  >
>()("AWS.Bedrock.ConverseStream") {}

export const ConverseStreamLive = Layer.effect(
  ConverseStream,
  Effect.gen(function* () {
    const Policy = yield* ConverseStreamPolicy;
    const converseStream = yield* bedrockRuntime.converseStream;

    return Effect.fn(function* (modelId: string) {
      yield* Policy(modelId);
      return Effect.fn(function* (request: ConverseStreamRequest) {
        return yield* converseStream({ ...request, modelId });
      });
    });
  }),
);

export class ConverseStreamPolicy extends Binding.Policy<
  ConverseStreamPolicy,
  (modelId: string) => Effect.Effect<void>
>()("AWS.Bedrock.ConverseStream") {}

export const ConverseStreamPolicyLive = ConverseStreamPolicy.layer.effect(
  Effect.gen(function* () {
    const region = yield* Region;
    const { accountId } = yield* AWSEnvironment;

    return Effect.fn(function* (host, modelId) {
      if (isFunction(host)) {
        yield* host.bind`Allow(${host}, AWS.Bedrock.ConverseStream(${modelId}))`(
          {
            policyStatements: [
              {
                Effect: "Allow",
                Action: ["bedrock:InvokeModelWithResponseStream"],
                Resource: resolveModelArns({ modelId, region, accountId }),
              },
            ],
          },
        );
      } else {
        return yield* Effect.die(
          `ConverseStreamPolicy does not support runtime '${host.Type}'`,
        );
      }
    });
  }),
);

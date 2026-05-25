import { Region } from "@distilled.cloud/aws/Region";
import * as bedrockRuntime from "@distilled.cloud/aws/bedrock-runtime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Binding from "../../Binding.ts";
import { AWSEnvironment } from "../Environment.ts";
import { isFunction } from "../Lambda/Function.ts";
import { resolveModelArns } from "./ModelArn.ts";

export interface InvokeModelWithResponseStreamRequest extends Omit<
  bedrockRuntime.InvokeModelWithResponseStreamRequest,
  "modelId"
> {}

export class InvokeModelWithResponseStream extends Binding.Service<
  InvokeModelWithResponseStream,
  (
    modelId: string,
  ) => Effect.Effect<
    (
      request: InvokeModelWithResponseStreamRequest,
    ) => Effect.Effect<
      bedrockRuntime.InvokeModelWithResponseStreamResponse,
      bedrockRuntime.InvokeModelWithResponseStreamError
    >
  >
>()("AWS.Bedrock.InvokeModelWithResponseStream") {}

export const InvokeModelWithResponseStreamLive = Layer.effect(
  InvokeModelWithResponseStream,
  Effect.gen(function* () {
    const Policy = yield* InvokeModelWithResponseStreamPolicy;
    const invokeModelWithResponseStream =
      yield* bedrockRuntime.invokeModelWithResponseStream;

    return Effect.fn(function* (modelId: string) {
      yield* Policy(modelId);
      return Effect.fn(function* (
        request: InvokeModelWithResponseStreamRequest,
      ) {
        return yield* invokeModelWithResponseStream({ ...request, modelId });
      });
    });
  }),
);

export class InvokeModelWithResponseStreamPolicy extends Binding.Policy<
  InvokeModelWithResponseStreamPolicy,
  (modelId: string) => Effect.Effect<void>
>()("AWS.Bedrock.InvokeModelWithResponseStream") {}

export const InvokeModelWithResponseStreamPolicyLive =
  InvokeModelWithResponseStreamPolicy.layer.effect(
    Effect.gen(function* () {
      const region = yield* Region;
      const { accountId } = yield* AWSEnvironment;

      return Effect.fn(function* (host, modelId) {
        if (isFunction(host)) {
          yield* host.bind`Allow(${host}, AWS.Bedrock.InvokeModelWithResponseStream(${modelId}))`(
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
            `InvokeModelWithResponseStreamPolicy does not support runtime '${host.Type}'`,
          );
        }
      });
    }),
  );

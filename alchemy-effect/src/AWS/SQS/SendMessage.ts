import * as sqs from "distilled-aws/sqs";
import * as Effect from "effect/Effect";
import type { Capability } from "../../Capability.ts";
import { declare, type To } from "../../Capability.ts";
import { toEnvKey } from "../../Env.ts";
import { Queue } from "./Queue.ts";

export interface SendMessage<Q = Queue> extends Capability<
  "AWS.SQS.SendMessage",
  Q
> {}

export const SendMessage = Binding("AWS.SQS.SendMessage")<
  <Q extends Queue>(queue: Q) => SendMessage<To<Q>>
>();

export const sendMessage = Effect.fnUntraced(function* <Q extends Queue>(
  queue: Q,
  message: Q["props"]["schema"]["Type"],
) {
  yield* declare<SendMessage<To<Q>>>();
  const url = process.env[toEnvKey(queue.id, "QUEUE_URL")]!;
  return yield* sqs.sendMessage({
    QueueUrl: url,
    MessageBody: JSON.stringify(message),
  });
});

export const sendMessageFromLambdaFunction = () =>
  SendMessage.provider.succeed({
    attach: ({ source: queue }) => ({
      env: {
        // ask what attribute is needed to interact? e.g. is it the Queue ARN or the Queue URL?
        [toEnvKey(queue.id, "QUEUE_URL")]: queue.attr.queueUrl,
      },
      policyStatements: [
        {
          Sid: "SendMessage",
          Effect: "Allow",
          Action: ["sqs:SendMessage"], // <- ask LLM how to generate this
          Resource: [queue.attr.queueArn],
        },
      ],
    }),
  });

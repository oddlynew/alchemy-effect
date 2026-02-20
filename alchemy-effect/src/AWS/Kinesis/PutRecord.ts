import * as Kinesis from "distilled-aws/kinesis";
import * as Effect from "effect/Effect";

import type { Capability } from "../../Capability.ts";
import { declare, type To } from "../../Capability.ts";
import { toEnvKey } from "../../Env.ts";
import { Stream } from "./Stream.ts";

export interface PutRecord<S = Stream> extends Capability<
  "AWS.Kinesis.PutRecord",
  S
> {}

export const PutRecord = Binding("AWS.Kinesis.PutRecord")<
  <S extends Stream>(stream: S) => PutRecord<To<S>>
>();

export interface PutRecordOptions {
  /**
   * The partition key used to distribute records across shards.
   */
  partitionKey: string;
  /**
   * The hash value used to explicitly determine the shard the data record is assigned to.
   * Overrides partition key hashing.
   */
  explicitHashKey?: string;
  /**
   * Guarantees strictly increasing sequence numbers within a shard.
   */
  sequenceNumberForOrdering?: string;
}

export const putRecord = Effect.fnUntraced(function* <S extends Stream>(
  stream: S,
  data: S["props"]["schema"]["Type"],
  options: PutRecordOptions,
) {
  yield* declare<PutRecord<To<S>>>();
  const streamName = process.env[toEnvKey(stream.id, "STREAM_NAME")]!;
  return yield* Kinesis.putRecord({
    StreamName: streamName,
    Data: new TextEncoder().encode(JSON.stringify(data)),
    PartitionKey: options.partitionKey,
    ExplicitHashKey: options.explicitHashKey,
    SequenceNumberForOrdering: options.sequenceNumberForOrdering,
  });
});

export const PutRecordBinding = () =>
  PutRecord.provider.succeed({
    attach: ({ source: stream }) => ({
      env: {
        [toEnvKey(stream.id, "STREAM_NAME")]: stream.attr.streamName,
        [toEnvKey(stream.id, "STREAM_ARN")]: stream.attr.streamArn,
      },
      policyStatements: [
        {
          Sid: "PutRecord",
          Effect: "Allow",
          Action: ["kinesis:PutRecord"],
          Resource: [stream.attr.streamArn],
        },
      ],
    }),
  });

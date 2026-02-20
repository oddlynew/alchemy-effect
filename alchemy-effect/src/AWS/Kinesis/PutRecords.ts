import * as Kinesis from "distilled-aws/kinesis";
import * as Effect from "effect/Effect";
import { declare, type Capability, type To } from "../../Capability.ts";
import { toEnvKey } from "../../Env.ts";
import { Stream } from "./Stream.ts";

export interface PutRecords<S = Stream> extends Capability<
  "AWS.Kinesis.PutRecords",
  S
> {}

export const PutRecords = Binding("AWS.Kinesis.PutRecords")<
  <S extends Stream>(stream: S) => PutRecords<To<S>>
>();

export interface PutRecordsEntry<Data> {
  /**
   * The data for the record.
   */
  data: Data;
  /**
   * The partition key used to distribute records across shards.
   */
  partitionKey: string;
  /**
   * The hash value used to explicitly determine the shard the data record is assigned to.
   */
  explicitHashKey?: string;
}

export const putRecords = Effect.fnUntraced(function* <S extends Stream>(
  stream: S,
  records: PutRecordsEntry<S["props"]["schema"]["Type"]>[],
) {
  yield* declare<PutRecords<To<S>>>();
  const streamName = process.env[toEnvKey(stream.id, "STREAM_NAME")]!;
  return yield* Kinesis.putRecords({
    StreamName: streamName,
    Records: records.map((r) => ({
      Data: new TextEncoder().encode(JSON.stringify(r.data)),
      PartitionKey: r.partitionKey,
      ExplicitHashKey: r.explicitHashKey,
    })),
  });
});

export const PutRecordsBinding = () =>
  PutRecords.provider.succeed({
    attach: ({ source: stream }) => ({
      env: {
        [toEnvKey(stream.id, "STREAM_NAME")]: stream.attr.streamName,
        [toEnvKey(stream.id, "STREAM_ARN")]: stream.attr.streamArn,
      },
      policyStatements: [
        {
          Sid: "PutRecord",
          Effect: "Allow",
          Action: ["kinesis:PutRecords"],
          Resource: [stream.attr.streamArn],
        },
      ],
    }),
  });

import * as Effect from "effect/Effect";

import * as S3 from "distilled-aws/s3";
import {
  declare,
  type Capability,
  type From,
  type To,
} from "../../Capability.ts";
import { toEnvKey } from "../../Env.ts";
import { Bucket } from "./Bucket.ts";

export interface GetObject<B = Bucket> extends Capability<
  "AWS.S3.GetObject",
  B
> {}

export const GetObject =
  Binding("AWS.S3.GetObject")<
    <B extends Bucket>(bucket: B) => GetObject<From<B>>
  >();

export interface GetObjectOptions {
  key: string;
  versionId?: string;
  range?: string;
  ifMatch?: string;
  ifNoneMatch?: string;
  ifModifiedSince?: Date;
  ifUnmodifiedSince?: Date;
}

export const getObject = Effect.fnUntraced(function* <B extends Bucket>(
  bucket: B,
  options: GetObjectOptions,
) {
  yield* declare<GetObject<To<B>>>();
  const bucketName = process.env[toEnvKey(bucket.id, "BUCKET_NAME")]!;

  return yield* S3.getObject({
    Bucket: bucketName,
    Key: options.key,
    VersionId: options.versionId,
    Range: options.range,
    IfMatch: options.ifMatch,
    IfNoneMatch: options.ifNoneMatch,
    IfModifiedSince: options.ifModifiedSince,
    IfUnmodifiedSince: options.ifUnmodifiedSince,
  });
});

export const GetObjectBinding = () =>
  GetObject.provider.succeed({
    attach: ({ source: bucket }) => ({
      env: {
        [toEnvKey(bucket.id, "BUCKET_NAME")]: bucket.attr.bucketName,
        [toEnvKey(bucket.id, "BUCKET_ARN")]: bucket.attr.bucketArn,
      },
      policyStatements: [
        {
          Sid: "GetObject",
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:GetObjectVersion"],
          Resource: [`${bucket.attr.bucketArn}/*`],
        },
      ],
    }),
  });

import * as Effect from "effect/Effect";

import * as S3 from "distilled-aws/s3";
import { declare, type Capability, type To } from "../../Capability.ts";
import { toEnvKey } from "../../Env.ts";
import { Bucket } from "./Bucket.ts";

export interface AbortMultipartUpload<B = Bucket> extends Capability<
  "AWS.S3.AbortMultipartUpload",
  B
> {}

export const AbortMultipartUpload = Binding("AWS.S3.AbortMultipartUpload")<
  <B extends Bucket>(bucket: B) => AbortMultipartUpload<To<B>>
>();

export interface AbortMultipartUploadOptions {
  key: string;
  uploadId: string;
}

export const abortMultipartUpload = Effect.fnUntraced(function* <
  B extends Bucket,
>(bucket: B, options: AbortMultipartUploadOptions) {
  yield* declare<AbortMultipartUpload<To<B>>>();
  const bucketName = process.env[toEnvKey(bucket.id, "BUCKET_NAME")]!;

  return yield* S3.abortMultipartUpload({
    Bucket: bucketName,
    Key: options.key,
    UploadId: options.uploadId,
  });
});

export const AbortMultipartUploadBinding = () =>
  AbortMultipartUpload.provider.succeed({
    attach: ({ source: bucket }) => ({
      env: {
        [toEnvKey(bucket.id, "BUCKET_NAME")]: bucket.attr.bucketName,
        [toEnvKey(bucket.id, "BUCKET_ARN")]: bucket.attr.bucketArn,
      },
      policyStatements: [
        {
          Sid: "AbortMultipartUpload",
          Effect: "Allow",
          Action: ["s3:AbortMultipartUpload"],
          Resource: [`${bucket.attr.bucketArn}/*`],
        },
      ],
    }),
  });

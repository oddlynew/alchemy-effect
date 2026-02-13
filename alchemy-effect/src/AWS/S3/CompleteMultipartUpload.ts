import * as Effect from "effect/Effect";

import * as S3 from "distilled-aws/s3";
import { Binding } from "../../Binding.ts";
import { declare, type Capability, type To } from "../../Capability.ts";
import { toEnvKey } from "../../Env.ts";
import { Bucket } from "./Bucket.ts";

export interface CompleteMultipartUpload<B = Bucket> extends Capability<
  "AWS.S3.CompleteMultipartUpload",
  B
> {}

export const CompleteMultipartUpload = Binding(
  "AWS.S3.CompleteMultipartUpload",
)<<B extends Bucket>(bucket: B) => CompleteMultipartUpload<To<B>>>();

export interface CompletedPart {
  etag: string;
  partNumber: number;
}

export interface CompleteMultipartUploadOptions {
  key: string;
  uploadId: string;
  parts: CompletedPart[];
}

export const completeMultipartUpload = Effect.fnUntraced(function* <
  B extends Bucket,
>(bucket: B, options: CompleteMultipartUploadOptions) {
  yield* declare<CompleteMultipartUpload<To<B>>>();
  const bucketName = process.env[toEnvKey(bucket.id, "BUCKET_NAME")]!;

  return yield* S3.completeMultipartUpload({
    Bucket: bucketName,
    Key: options.key,
    UploadId: options.uploadId,
    MultipartUpload: {
      Parts: options.parts.map((part) => ({
        ETag: part.etag,
        PartNumber: part.partNumber,
      })),
    },
  });
});

export const CompleteMultipartUploadBinding = () =>
  CompleteMultipartUpload.provider.succeed({
    attach: ({ source: bucket }) => ({
      env: {
        [toEnvKey(bucket.id, "BUCKET_NAME")]: bucket.attr.bucketName,
        [toEnvKey(bucket.id, "BUCKET_ARN")]: bucket.attr.bucketArn,
      },
      policyStatements: [
        {
          Sid: "CompleteMultipartUpload",
          Effect: "Allow",
          Action: ["s3:PutObject"],
          Resource: [`${bucket.attr.bucketArn}/*`],
        },
      ],
    }),
  });

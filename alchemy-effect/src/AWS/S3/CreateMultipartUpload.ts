import * as Effect from "effect/Effect";

import * as S3 from "distilled-aws/s3";
import { Binding } from "../../Binding.ts";
import { declare, type Capability, type To } from "../../Capability.ts";
import { toEnvKey } from "../../Env.ts";
import { Bucket } from "./Bucket.ts";

export interface CreateMultipartUpload<B = Bucket> extends Capability<
  "AWS.S3.CreateMultipartUpload",
  B
> {}

export const CreateMultipartUpload = Binding("AWS.S3.CreateMultipartUpload")<
  <B extends Bucket>(bucket: B) => CreateMultipartUpload<To<B>>
>();

export interface CreateMultipartUploadOptions {
  key: string;
  contentType?: string;
  contentEncoding?: string;
  contentDisposition?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
  storageClass?:
    | "STANDARD"
    | "REDUCED_REDUNDANCY"
    | "STANDARD_IA"
    | "ONEZONE_IA"
    | "INTELLIGENT_TIERING"
    | "GLACIER"
    | "DEEP_ARCHIVE"
    | "GLACIER_IR";
  serverSideEncryption?: "AES256" | "aws:kms" | "aws:kms:dsse";
  sseKmsKeyId?: string;
  tagging?: string;
}

export const createMultipartUpload = Effect.fnUntraced(function* <
  B extends Bucket,
>(bucket: B, options: CreateMultipartUploadOptions) {
  yield* declare<CreateMultipartUpload<To<B>>>();
  const bucketName = process.env[toEnvKey(bucket.id, "BUCKET_NAME")]!;

  return yield* S3.createMultipartUpload({
    Bucket: bucketName,
    Key: options.key,
    ContentType: options.contentType,
    ContentEncoding: options.contentEncoding,
    ContentDisposition: options.contentDisposition,
    CacheControl: options.cacheControl,
    Metadata: options.metadata,
    StorageClass: options.storageClass,
    ServerSideEncryption: options.serverSideEncryption,
    SSEKMSKeyId: options.sseKmsKeyId,
    Tagging: options.tagging,
  });
});

export const CreateMultipartUploadBinding = () =>
  CreateMultipartUpload.provider.succeed({
    attach: ({ source: bucket }) => ({
      env: {
        [toEnvKey(bucket.id, "BUCKET_NAME")]: bucket.attr.bucketName,
        [toEnvKey(bucket.id, "BUCKET_ARN")]: bucket.attr.bucketArn,
      },
      policyStatements: [
        {
          Sid: "CreateMultipartUpload",
          Effect: "Allow",
          Action: ["s3:PutObject"],
          Resource: [`${bucket.attr.bucketArn}/*`],
        },
      ],
    }),
  });

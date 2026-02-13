import * as Effect from "effect/Effect";

import * as S3 from "distilled-aws/s3";
import { Binding } from "../../Binding.ts";
import {
  declare,
  type Capability,
  type In,
  type To,
} from "../../Capability.ts";
import { toEnvKey } from "../../Env.ts";
import { Bucket } from "./Bucket.ts";

export interface DeleteObject<B = Bucket> extends Capability<
  "AWS.S3.DeleteObject",
  B
> {}

export const DeleteObject = Binding("AWS.S3.DeleteObject")<
  <B extends Bucket>(bucket: B) => DeleteObject<In<B>>
>();

export interface DeleteObjectOptions {
  key: string;
  versionId?: string;
}

export const deleteObject = Effect.fnUntraced(function* <B extends Bucket>(
  bucket: B,
  options: DeleteObjectOptions,
) {
  yield* declare<DeleteObject<To<B>>>();
  const bucketName = process.env[toEnvKey(bucket.id, "BUCKET_NAME")]!;

  return yield* S3.deleteObject({
    Bucket: bucketName,
    Key: options.key,
    VersionId: options.versionId,
  });
});

export const DeleteObjectBinding = () =>
  DeleteObject.provider.succeed({
    attach: ({ source: bucket }) => ({
      env: {
        [toEnvKey(bucket.id, "BUCKET_NAME")]: bucket.attr.bucketName,
        [toEnvKey(bucket.id, "BUCKET_ARN")]: bucket.attr.bucketArn,
      },
      policyStatements: [
        {
          Sid: "DeleteObject",
          Effect: "Allow",
          Action: ["s3:DeleteObject", "s3:DeleteObjectVersion"],
          Resource: [`${bucket.attr.bucketArn}/*`],
        },
      ],
    }),
  });

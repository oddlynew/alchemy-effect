import * as Schema from "effect/Schema";

export const AIBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("ai"),
});
export type AIBinding = typeof AIBinding.Type;

export const AnalyticsEngineBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("analytics_engine"),
  dataset: Schema.String,
});
export type AnalyticsEngineBinding = typeof AnalyticsEngineBinding.Type;

export const AssetsBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("assets"),
});
export type AssetsBinding = typeof AssetsBinding.Type;

export const BrowserBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("browser"),
});
export type BrowserBinding = typeof BrowserBinding.Type;

export const D1Binding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("d1"),
  id: Schema.String,
});
export type D1Binding = typeof D1Binding.Type;

export const DataBlobBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("data_blob"),
  part: Schema.String,
});
export type DataBlobBinding = typeof DataBlobBinding.Type;

export const DispatchNamespaceBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("dispatch_namespace"),
  namespace: Schema.String,
  outbound: Schema.optional(
    Schema.Struct({
      params: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
      worker: Schema.optional(
        Schema.Struct({
          service: Schema.optional(Schema.String),
          environment: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
});
export type DispatchNamespaceBinding = typeof DispatchNamespaceBinding.Type;

export const DurableObjectNamespaceBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("durable_object_namespace"),
  class_name: Schema.optional(Schema.String),
  environment: Schema.optional(Schema.String),
  namespace_id: Schema.optional(Schema.String.check(Schema.isLengthBetween(32, 32))),
  script_name: Schema.optional(Schema.String),
});
export type DurableObjectNamespaceBinding = typeof DurableObjectNamespaceBinding.Type;

export const HyperdriveBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("hyperdrive"),
  id: Schema.String,
});
export type HyperdriveBinding = typeof HyperdriveBinding.Type;

// TODO: handle in version service
// export const InheritBinding = Schema.Struct({
//   name: Schema.String,
//   type: Schema.Literal("inherit"),
//   old_name: Schema.optional(Schema.String),
//   version_id: Schema.optional(Schema.String),
// });

export const ImagesBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("images"),
});
export type ImagesBinding = typeof ImagesBinding.Type;

export const JsonBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("json"),
  json: Schema.String,
});
export type JsonBinding = typeof JsonBinding.Type;

export const KVNamespaceBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("kv_namespace"),
  namespace_id: Schema.String.check(Schema.isLengthBetween(32, 32)),
});
export type KVNamespaceBinding = typeof KVNamespaceBinding.Type;

export const MTLSCertificateBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("mtls_certificate"),
  certificate_id: Schema.String,
});
export type MTLSCertificateBinding = typeof MTLSCertificateBinding.Type;

export const PlainTextBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("plain_text"),
  text: Schema.String,
});
export type PlainTextBinding = typeof PlainTextBinding.Type;

export const PipelinesBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("pipelines"),
  pipeline: Schema.String,
});
export type PipelinesBinding = typeof PipelinesBinding.Type;

export const QueueBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("queue"),
  queue_name: Schema.String,
});
export type QueueBinding = typeof QueueBinding.Type;

export const R2BucketBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("r2_bucket"),
  bucket_name: Schema.String,
  jurisdiction: Schema.optional(Schema.Literals(["eu", "fedramp"])),
});
export type R2BucketBinding = typeof R2BucketBinding.Type;

export const SecretTextBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("secret_text"),
  text: Schema.String,
});
export type SecretTextBinding = typeof SecretTextBinding.Type;

export const SendEmailBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("send_email"),
  allowed_destination_addresses: Schema.optional(Schema.Array(Schema.String)),
  allowed_sender_addresses: Schema.optional(Schema.Array(Schema.String)),
  destination_address: Schema.optional(Schema.String),
});
export type SendEmailBinding = typeof SendEmailBinding.Type;

export const ServiceBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("service"),
  service: Schema.String,
  environment: Schema.optional(Schema.String),
});
export type ServiceBinding = typeof ServiceBinding.Type;

export const TextBlobBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("text_blob"),
  part: Schema.String,
});
export type TextBlobBinding = typeof TextBlobBinding.Type;

export const VectorizeBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("vectorize"),
  index_name: Schema.String,
});
export type VectorizeBinding = typeof VectorizeBinding.Type;

export const VersionMetadataBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("version_metadata"),
});
export type VersionMetadataBinding = typeof VersionMetadataBinding.Type;

export const SecretsStoreSecretBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("secrets_store_secret"),
  secret_name: Schema.String,
  store_id: Schema.String,
});
export type SecretsStoreSecretBinding = typeof SecretsStoreSecretBinding.Type;

export const SecretKeyBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("secret_key"),
  algorithm: Schema.Unknown,
  format: Schema.Literals(["raw", "pkcs8", "spki", "jwk"]),
  usages: Schema.Array(
    Schema.Literals([
      "encrypt",
      "decrypt",
      "sign",
      "verify",
      "deriveKey",
      "deriveBits",
      "wrapKey",
      "unwrapKey",
    ]),
  ),
  key_base64: Schema.optional(Schema.String),
  key_jwk: Schema.optional(Schema.Unknown),
});
export type SecretKeyBinding = typeof SecretKeyBinding.Type;

export const WorkflowBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("workflow"),
  workflow_name: Schema.String,
  class_name: Schema.optional(Schema.String),
  script_name: Schema.optional(Schema.String),
});
export type WorkflowBinding = typeof WorkflowBinding.Type;

export const WasmModuleBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("wasm_module"),
  part: Schema.String,
});
export type WasmModuleBinding = typeof WasmModuleBinding.Type;

export const Binding = Schema.Union([
  AIBinding,
  AnalyticsEngineBinding,
  AssetsBinding,
  BrowserBinding,
  D1Binding,
  DataBlobBinding,
  DispatchNamespaceBinding,
  DurableObjectNamespaceBinding,
  HyperdriveBinding,
  // InheritBinding,
  ImagesBinding,
  JsonBinding,
  KVNamespaceBinding,
  MTLSCertificateBinding,
  PlainTextBinding,
  PipelinesBinding,
  QueueBinding,
  R2BucketBinding,
  SecretTextBinding,
  SendEmailBinding,
  ServiceBinding,
  TextBlobBinding,
  VectorizeBinding,
  VersionMetadataBinding,
  SecretsStoreSecretBinding,
  SecretKeyBinding,
  WorkflowBinding,
  WasmModuleBinding,
]);
export type Binding = typeof Binding.Type;

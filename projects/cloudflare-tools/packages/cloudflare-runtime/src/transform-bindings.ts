import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Schema from "effect/Schema";
import type { Binding } from "./Binding";
import type { Worker_Binding } from "./runtime/config.types";

export class UnsupportedBindingError extends Schema.TaggedErrorClass<UnsupportedBindingError>()(
  "UnsupportedBindingError",
  {
    name: Schema.String,
    type: Schema.String,
  },
) {}

const bind = (binding: Worker_Binding) => Effect.succeed(binding);
const unsupported = (binding: Binding) =>
  Effect.fail(new UnsupportedBindingError({ name: binding.name, type: binding.type }));

export const transformBinding = Match.type<Binding>().pipe(
  Match.discriminatorsExhaustive("type")({
    json: (b) => bind({ name: b.name, json: b.json }),
    ai: (b) => unsupported(b),
    analytics_engine: (b) => unsupported(b),
    assets: (b) => unsupported(b),
    browser: (b) => unsupported(b),
    d1: (b) => unsupported(b),
    data_blob: (b) => bind({ name: b.name, data: Buffer.from(b.part) }),
    dispatch_namespace: (b) => unsupported(b),
    service: (b) => unsupported(b),
    durable_object_namespace: (b) => unsupported(b),
    hyperdrive: (b) => unsupported(b),
    images: (b) => unsupported(b),
    kv_namespace: (b) => unsupported(b),
    mtls_certificate: (b) => unsupported(b),
    plain_text: (b) => bind({ name: b.name, text: b.text }),
    pipelines: (b) => unsupported(b),
    queue: (b) => unsupported(b),
    r2_bucket: (b) => unsupported(b),
    secret_text: (b) => bind({ name: b.name, text: b.text }),
    send_email: (b) => unsupported(b),
    text_blob: (b) => bind({ name: b.name, text: b.part }),
    vectorize: (b) => unsupported(b),
    version_metadata: (b) => unsupported(b),
    secrets_store_secret: (b) => unsupported(b),
    secret_key: (b) => unsupported(b),
    wasm_module: (b) => bind({ name: b.name, wasmModule: Buffer.from(b.part) }),
    workflow: (b) => unsupported(b),
  }),
);

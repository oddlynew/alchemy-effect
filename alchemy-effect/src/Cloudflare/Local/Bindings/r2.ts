import type * as cf from "@cloudflare/workers-types";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  Rpc,
  RpcClient,
  RpcGroup,
  RpcSerialization,
} from "effect/unstable/rpc";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const StringRecord = Schema.Record(Schema.String, Schema.String);

export const R2ObjectInfo = Schema.Struct({
  key: Schema.String,
  version: Schema.String,
  size: Schema.Number,
  etag: Schema.String,
  httpEtag: Schema.String,
  storageClass: Schema.String,
  uploaded: Schema.String,
  httpMetadata: Schema.optional(StringRecord),
  customMetadata: Schema.optional(StringRecord),
});

export type R2ObjectInfo = typeof R2ObjectInfo.Type;

const R2GetResult = Schema.Struct({
  ...R2ObjectInfo.fields,
  base64Body: Schema.NullOr(Schema.String),
});

const R2ListResult = Schema.Struct({
  objects: Schema.Array(Schema.Struct({ ...R2ObjectInfo.fields })),
  truncated: Schema.Boolean,
  cursor: Schema.optional(Schema.String),
  delimitedPrefixes: Schema.Array(Schema.String),
});

const r2Get = Rpc.make("r2Get", {
  payload: { bucket: Schema.String, key: Schema.String },
  success: Schema.NullOr(R2GetResult),
});

const r2Put = Rpc.make("r2Put", {
  payload: {
    bucket: Schema.String,
    key: Schema.String,
    base64Body: Schema.String,
    httpMetadata: Schema.optional(StringRecord),
    customMetadata: Schema.optional(StringRecord),
  },
  success: R2ObjectInfo,
});

const r2Delete = Rpc.make("r2Delete", {
  payload: {
    bucket: Schema.String,
    keys: Schema.Array(Schema.String),
  },
  success: Schema.Void,
});

const r2Head = Rpc.make("r2Head", {
  payload: { bucket: Schema.String, key: Schema.String },
  success: Schema.NullOr(R2ObjectInfo),
});

const r2List = Rpc.make("r2List", {
  payload: {
    bucket: Schema.String,
    limit: Schema.optional(Schema.Number),
    prefix: Schema.optional(Schema.String),
    cursor: Schema.optional(Schema.String),
    delimiter: Schema.optional(Schema.String),
    startAfter: Schema.optional(Schema.String),
  },
  success: R2ListResult,
});

export class R2Rpcs extends RpcGroup.make(
  r2Get,
  r2Put,
  r2Delete,
  r2Head,
  r2List,
) {}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function serializeR2Object(obj: cf.R2Object): R2ObjectInfo {
  const httpMetadata = obj.httpMetadata
    ? Object.fromEntries(
        Object.entries(obj.httpMetadata).filter(
          ([, v]) => v !== undefined && typeof v === "string",
        ),
      )
    : undefined;
  const customMetadata =
    obj.customMetadata && Object.keys(obj.customMetadata).length > 0
      ? obj.customMetadata
      : undefined;
  return {
    key: obj.key,
    version: obj.version,
    size: obj.size,
    etag: obj.etag,
    httpEtag: obj.httpEtag,
    storageClass: obj.storageClass,
    uploaded: obj.uploaded.toISOString(),
    httpMetadata:
      httpMetadata && Object.keys(httpMetadata).length > 0
        ? httpMetadata
        : undefined,
    customMetadata,
  };
}

// ---------------------------------------------------------------------------
// Server-side handlers (runs inside the proxy worker)
// ---------------------------------------------------------------------------

export const makeR2Handlers = (env: Record<string, any>) =>
  R2Rpcs.toLayer({
    r2Get: ({ bucket, key }) =>
      Effect.tryPromise(async () => {
        const r2: cf.R2Bucket = env[bucket];
        const obj = await r2.get(key);
        if (!obj) return null;
        const bytes = await obj.arrayBuffer();
        const base64Body = btoa(
          String.fromCharCode(...new Uint8Array(bytes)),
        );
        return { ...serializeR2Object(obj), base64Body };
      }),
    r2Put: ({ bucket, key, base64Body, httpMetadata, customMetadata }) =>
      Effect.tryPromise(async () => {
        const r2: cf.R2Bucket = env[bucket];
        const body = Uint8Array.from(atob(base64Body), (c) => c.charCodeAt(0));
        const obj = await r2.put(key, body, {
          httpMetadata: httpMetadata as Record<string, string> | undefined,
          customMetadata: customMetadata as Record<string, string> | undefined,
        });
        return serializeR2Object(obj!);
      }),
    r2Delete: ({ bucket, keys }) =>
      Effect.tryPromise(async () => {
        const r2: cf.R2Bucket = env[bucket];
        await r2.delete(keys as string[]);
      }),
    r2Head: ({ bucket, key }) =>
      Effect.tryPromise(async () => {
        const r2: cf.R2Bucket = env[bucket];
        const obj = await r2.head(key);
        if (!obj) return null;
        return serializeR2Object(obj);
      }),
    r2List: ({ bucket, ...options }) =>
      Effect.tryPromise(async () => {
        const r2: cf.R2Bucket = env[bucket];
        const result = await r2.list(options);
        return {
          objects: result.objects.map(serializeR2Object),
          truncated: result.truncated,
          cursor: result.truncated ? result.cursor : undefined,
          delimitedPrefixes: result.delimitedPrefixes,
        };
      }),
  });

// ---------------------------------------------------------------------------
// Client-side facade (runs locally)
// ---------------------------------------------------------------------------

type R2RpcClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof R2Rpcs>, any>;

export interface R2BucketFacade {
  get(key: string): Promise<R2ObjectBodyFacade | null>;
  put(
    key: string,
    value: string | ArrayBuffer | Uint8Array,
    options?: {
      httpMetadata?: Record<string, string>;
      customMetadata?: Record<string, string>;
    },
  ): Promise<R2ObjectInfo>;
  delete(keys: string | string[]): Promise<void>;
  head(key: string): Promise<R2ObjectInfo | null>;
  list(options?: {
    limit?: number;
    prefix?: string;
    cursor?: string;
    delimiter?: string;
    startAfter?: string;
  }): Promise<{
    objects: readonly R2ObjectInfo[];
    truncated: boolean;
    cursor?: string;
    delimitedPrefixes: readonly string[];
  }>;
}

export interface R2ObjectBodyFacade extends R2ObjectInfo {
  readonly body: ReadableStream<Uint8Array>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  json<T>(): Promise<T>;
}

function toBase64(value: string | ArrayBuffer | Uint8Array): string {
  if (typeof value === "string") {
    return btoa(value);
  }
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function makeR2Facade(
  client: R2RpcClient,
  bucket: string,
): R2BucketFacade {
  return {
    async get(key) {
      const result = await Effect.runPromise(client.r2Get({ bucket, key }));
      if (!result) return null;
      const { base64Body, ...info } = result;
      const bytes = base64Body ? fromBase64(base64Body) : new Uint8Array(0);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      return {
        ...info,
        body: stream,
        async text() {
          return new TextDecoder().decode(bytes);
        },
        async arrayBuffer() {
          return bytes.buffer as ArrayBuffer;
        },
        async json<T>() {
          return JSON.parse(new TextDecoder().decode(bytes)) as T;
        },
      };
    },
    async put(key, value, options) {
      return Effect.runPromise(
        client.r2Put({
          bucket,
          key,
          base64Body: toBase64(value),
          httpMetadata: options?.httpMetadata,
          customMetadata: options?.customMetadata,
        }),
      );
    },
    async delete(keys) {
      const keyArray = typeof keys === "string" ? [keys] : keys;
      await Effect.runPromise(client.r2Delete({ bucket, keys: keyArray }));
    },
    async head(key) {
      return Effect.runPromise(client.r2Head({ bucket, key }));
    },
    async list(options) {
      return Effect.runPromise(client.r2List({ bucket, ...options }));
    },
  };
}

/**
 * Create an R2 RPC client connected to the proxy worker over HTTP.
 * Returns a factory for creating R2BucketFacade instances by binding name.
 */
export const makeR2Client = (workerUrl: string) =>
  Effect.gen(function* () {
    const baseClient = yield* HttpClient.HttpClient;
    const rpcClient = HttpClient.mapRequest(
      baseClient,
      HttpClientRequest.prependUrl(`${workerUrl}/rpc`),
    );
    const protocol = yield* RpcClient.makeProtocolHttp(rpcClient).pipe(
      Effect.provide(RpcSerialization.layerJson),
    );
    const client = yield* RpcClient.make(R2Rpcs).pipe(
      Effect.provideService(RpcClient.Protocol, protocol),
    );
    return {
      r2: (bucket: string) => makeR2Facade(client, bucket),
    };
  });

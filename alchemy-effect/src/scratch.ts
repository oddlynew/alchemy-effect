import type { HttpClient } from "@effect/platform/HttpClient";
import type { Credentials } from "distilled-aws/Credentials";
import type { Region } from "distilled-aws/Region";
import * as s3 from "distilled-aws/s3";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Pipeable } from "effect/Pipeable";
import * as S from "effect/Schema";

import type { PolicyStatement } from "./AWS/IAM/Policy.ts";
import type { Bucket } from "./AWS/S3/Bucket.ts";
import type { S3EventType } from "./AWS/S3/S3Event.ts";
import * as Binding from "./Binding.ts";
import * as Bus from "./Bus/index.ts";
import { Capability, declare } from "./Capability.ts";
import { env, toEnvKey } from "./Env.ts";
import * as Environment from "./Environment.ts";
import * as Output from "./Output/index.ts";
import type { Instance } from "./Util/instance.ts";

export class Job extends S.Class<Job>("Job")({
  id: S.String,
  name: S.String,
  description: S.String,
}) {}

// declare an Event Source containing Job events
export class JobQueue extends Bus.EventSource("JobQueue", {
  schema: Job,
}) {}

export class SomeDep extends Context.Tag("SomeDep")<SomeDep, {}>() {}

export interface GetObject<B> extends Capability<"AWS.S3.GetObject", B> {}

export interface GetObjectRequest<B> extends Omit<
  s3.GetObjectRequest,
  "Bucket"
> {
  Bucket: B;
}

export const getObject = Effect.fn("getObject")(function* <const B>(
  input: GetObjectRequest<B>,
) {
  yield* declare<GetObject<B>>();
  return yield* s3.getObject({
    ...input,
    Bucket: env[toEnvKey(input.Bucket.id, "BUCKET_NAME")]!,
  });
});

export const GetObject =
  <B extends Bucket>(bucket: B) =>
  <F extends Lambda.FunctionEnvironment>(env: F) => {
    if (env.class.type === "AWS.Lambda.Function") {
      return Binding.call<GetObjectFromLambda>("GetObjectFromLambda")(
        env,
        bucket,
      );
    } else if (env.class.type === "Cloudflare.Worker") {
      // TODO: implement
    }
  };

export class GetObjectFromLambda extends Binding.fn(
  "GetObjectFromLambda",
  <B extends Bucket>(target: Lambda.FunctionEnvironment, bucket: B) =>
    Binding.satisfy<GetObject<B>>()(target, {
      env: {
        [toEnvKey(bucket.id, "BUCKET_NAME")]: bucket.bucketName,
        [toEnvKey(bucket.id, "BUCKET_ARN")]: bucket.bucketArn,
      },
      policyStatements: [
        {
          Sid: "GetObject",
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:GetObjectVersion"],
          Resource: [Output.interpolate`${Output.of(bucket).bucketArn}/*`],
        },
      ],
    }),
) {}

export declare const putObject: <const B>(
  b: B,
) => Effect.Effect<any, never, PutObject<B>>;

export interface PutObject<B> extends Capability<"AWS.S3.PutObject", B> {}

export const PutObject = Binding.make(
  "AWS.S3.PutObject",
  <B extends Bucket>(bucket: B) =>
    <F extends Lambda.FunctionEnvironment>(env: F) => {
      if (env.class.type === "AWS.Lambda.Function") {
        return Binding.call<PutObjectFromLambda>("PutObjectFromLambda")(
          env,
          bucket,
        );
      }
    },
);

export class PutObjectFromLambda extends Binding.fn(
  "PutObjectFromLambda",
  <B extends Bucket>(target: Lambda.FunctionEnvironment, bucket: B) =>
    Binding.satisfy<PutObject<B>>()(target, {
      env: {
        [toEnvKey(bucket.id, "BUCKET_NAME")]: bucket.attr.bucketName,
        [toEnvKey(bucket.id, "BUCKET_ARN")]: bucket.attr.bucketArn,
      },
      policyStatements: [
        {
          Sid: "GetObject",
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:GetObjectVersion"],
          Resource: [Output.interpolate`${Output.of(bucket).bucketArn}/*`],
        },
      ],
    }),
) {}

export interface ConsumeBucketEvents<B> extends Capability<
  "AWS.S3.ConsumeBucketEvents",
  B
> {}

export class ConsumeBucketEventsFromLambda extends Binding.fn(
  "ConsumeBucketEventsFromLambda",
  <B extends Bucket>(target: Lambda.FunctionEnvironment, bucket: B) =>
    Binding.satisfy<ConsumeBucketEvents<B>>()(target, {
      env: {
        [toEnvKey(bucket.id, "BUCKET_NAME")]: bucket.attr.bucketName,
        [toEnvKey(bucket.id, "BUCKET_ARN")]: bucket.attr.bucketArn,
      },
    }),
) {}

export interface BucketEventSourceProps {
  /**
   * S3 event types to trigger the Lambda function.
   * @default - ["s3:ObjectCreated:*"]
   */
  events?: S3EventType[];
  /**
   * Only trigger for objects with keys starting with this prefix.
   */
  filterPrefix?: string;
  /**
   * Only trigger for objects with keys ending with this suffix.
   */
  filterSuffix?: string;
}

export interface BucketEventSource<B> extends Binding.Binding<
  ConsumeBucketEvents<B>,
  BucketEventSourceProps
> {}

export const BucketEventSource = Binding.make(
  "BucketEventSource",
  <B extends Bucket, Props extends BucketEventSourceProps = never>(
    bucket: B,
    props?: Props,
  ) =>
    <F extends Lambda.FunctionEnvironment>(env: F) => {
      const proxy = Binding.call<BindBucketEventSource>(
        "BindBucketEventSource",
      );
      return proxy(env, bucket, props);
    },
);

export class BindBucketEventSource extends Binding.fn(
  "BindBucketEventSource",
  Effect.fn(function* <
    B extends Bucket,
    Props extends BucketEventSourceProps = never,
  >(target: Lambda.FunctionEnvironment, bucket: B, props?: Props) {
    const eventSourceMapping = EventSourceMapping("TODO", {
      FunctionName: target.functionName,
    });

    yield* Binding.satisfy<ConsumeBucketEvents<B>>()(target, {
      env: {
        [toEnvKey(bucket.id, "BUCKET_NAME")]: bucket.attr.bucketName,
        [toEnvKey(bucket.id, "BUCKET_ARN")]: bucket.attr.bucketArn,
      },
    });
  }),
) {}
// AWS.Lambda.Function

class JobFunction extends Lambda.Function("JobFunction", {
  services: [],
}) {}

const endpoint = JobFunction.pipe(
  Lambda.Function.make(
    import.meta.filename,
    Effect.gen(function* (event, context) {
      const _jobQueue = yield* SomeDep;
      return Effect.fn(function* (_event) {
        const object = yield* getObject("foo");
        return object;
      });
    }),
  ),
  Lambda.Function.provide(Layer.succeed(SomeDep, undefined!)), // not errorr
  // Lambda.Function.provide(Layer.empty), // is error (under-provided)
  // Lambda.Function.bind(), // error (under-bound)
  // Lambda.Function.bind(GetObject("foo"), PutObject("foo")), // error (over-bound)
  // Lambda.Function.bind(GetObject("foo")),
);

const _endpoint2 = JobFunction.pipe(
  Lambda.Function.make(
    import.meta.filename,
    Effect.fn(function* (_event) {
      const object = yield* getObject("foo");
      return object;
    }),
  ),
  // Lambda.Function.provide(Layer.succeed(SomeDep, undefined!)), // error (over-provided)
  Lambda.Function.provide(Layer.empty), // not error (exact)
  // Lambda.Function.bind(), // error (under-bound)
  // Lambda.Function.bind(GetObject("foo"), PutObject("foo")), // error (over-bound)
  Lambda.Function.bind(GetObject("foo")),
);

export default endpoint;

namespace Lambda {
  export type Context = {};

  export interface FunctionClassProps<
    Services = any,
  > extends Environment.EnvironmentProps<Services> {
    url?: boolean;
  }

  export interface FunctionProps {}

  export interface FunctionBindingProps {
    env?: Record<string, any>;
    policyStatements?: PolicyStatement[];
  }

  export type FunctionClass<
    Id extends string = string,
    Props extends FunctionClassProps = FunctionClassProps,
  > = Props &
    Pipeable & {
      type: "AWS.Lambda.Function";
      id: Id;
      binding: FunctionBindingProps;
      new (): FunctionClass<Id, Props>;
    };

  export type Function<
    Env extends FunctionClass,
    Props extends FunctionProps,
  > = {
    type: "AWS.Lambda.Function";
    functionArn: string;
    functionName: string;
    functionUrl: Env["url"] extends true ? string : undefined;
    roleName: string;
    roleArn: string;
    code: {
      hash: string;
    };
  };

  export interface FunctionEnvironment<
    in out Req = any,
    in out Cap = any,
  > extends Environment.Environment<FunctionClass, Req, Cap> {}

  export const Function = Environment.make(
    "AWS.Lambda.Function",
    (() => {}) as any as {
      <
        const Id extends string,
        const Props extends FunctionClassProps = FunctionClassProps,
      >(
        id: Id,
        props: Props,
      ): FunctionClass<Id, Props>;

      make<Req1 = never, Req2 = never>(
        main: string,
        effect: Effect.Effect<
          (
            event: any,
            context: Lambda.Context,
          ) => Effect.Effect<any, never, Req2>,
          never,
          Req1
        >,
      ): <Func extends FunctionClass<string, any>>(
        func: Func,
      ) => Environment.Environment<
        Instance<Func>,
        Exclude<Req1 | Req2, Capability>,
        Extract<Req1 | Req2, Capability>
      >;
      make<Req1 = never>(
        main: string,
        handler: (
          event: any,
          context: Lambda.Context,
        ) => Effect.Effect<any, never, Req1>,
      ): <Func extends FunctionClass<string, any>>(
        func: Func,
      ) => Environment.Environment<
        Instance<Func>,
        Exclude<Req1, Capability>,
        Extract<Req1, Capability>
      >;
      provide<
        ROut,
        Err,
        // these are allowed to bubble out to Function.bind, but nothing else
        RIn extends Capability | Region | HttpClient | Credentials,
      >(
        layer: Layer.Layer<ROut, Err, RIn>,
      ): <Self, Cap>(
        self: Environment.Environment<Self, ROut, Cap>,
      ) => Environment.Environment<Self, never, Cap | Extract<RIn, Capability>>;
      bind<Caps extends (Capability | Binding.Binding<Capability, any>)[]>(
        ...caps: Caps
      ): <Self extends FunctionClass, Props extends FunctionProps>(
        infra: Environment.Environment<
          Self,
          never,
          Caps[number] extends Binding.Binding<infer Cap, any>
            ? Cap
            : Caps[number]
        >,
      ) => Function<Self, Props>;
    },
  );
}
